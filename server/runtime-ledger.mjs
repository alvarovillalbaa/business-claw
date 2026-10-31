import { normalizeComputeDescriptor, normalizeComputeReceipt } from '../runtime/compute-provider.mjs';
import { id, record } from './data.mjs';

export class RuntimeLedgerError extends Error {
  constructor(code) { super(`business_claw_runtime_ledger_${code}`); this.name = 'RuntimeLedgerError'; this.code = code; }
}
const fail = code => { throw new RuntimeLedgerError(code); };
const identity = row => JSON.stringify([row.operationId, row.requestId, row.fence, row.binding, row.action, row.requestHash]);
const columns = 'operation_id,request_id,org_id,request_hash,fence,revision,receipt,updated_at';
function encoded(receipt) {
  const value = JSON.stringify(receipt);
  if (Buffer.byteLength(value) > 32768) fail('receipt_limit');
  return value;
}
function stored(row) {
  const receipt = normalizeComputeReceipt(row.receipt);
  if (receipt.operationId !== row.operation_id || receipt.requestId !== row.request_id || receipt.binding.orgId !== row.org_id
    || receipt.requestHash !== row.request_hash || receipt.fence !== Number(row.fence) || receipt.revision !== Number(row.revision)
    || receipt.observedAt !== new Date(row.updated_at).toISOString()) fail('store_invalid');
  return receipt;
}
function initial(descriptor) {
  return normalizeComputeReceipt({ operationId: descriptor.operationId, requestId: descriptor.requestId,
    fence: descriptor.fence, binding: descriptor.binding, action: descriptor.action, requestHash: descriptor.requestHash,
    revision: 1, state: 'reserved', serverId: descriptor.serverId, actionIds: [], providerStatus: null,
    actionStatus: null, observedAt: descriptor.observedAt, errorCode: null });
}

// A worker-owned durable journal. This object grants no dispatch or paid-resource authority.
export function createRuntimeLedger({ pool } = {}) {
  if (typeof pool?.connect !== 'function') fail('ports_unavailable');
  async function atomic(action) {
    let client, begun = false, committing = false, broken = false;
    try {
      client = await pool.connect();
      if (typeof client?.query !== 'function' || typeof client?.release !== 'function') fail('ports_unavailable');
      await client.query('begin isolation level read committed'); begun = true;
      await client.query("set local role bc_runtime_worker; set local search_path=pg_catalog; set local time zone 'UTC'; set local statement_timeout='8000ms'; set local lock_timeout='3000ms'; set local idle_in_transaction_session_timeout='15000ms'");
      const result = await action(client);
      committing = true; await client.query('commit'); begun = false; committing = false;
      return result;
    } catch (error) {
      if (committing) broken = true;
      if (begun) try { await client.query('rollback'); } catch { broken = true; }
      if (error instanceof RuntimeLedgerError) throw error;
      if (['40001', '40P01', '55P03'].includes(error?.code)) fail('transaction_conflict');
      fail('database_unavailable');
    } finally { if (typeof client?.release === 'function') client.release(broken); }
  }
  const append = (client, receipt) => client.query('insert into bc_private.runtime_operation_events(operation_id,fence,revision,receipt,observed_at) values($1,$2,$3,$4::jsonb,$5)',
    [receipt.operationId, receipt.fence, receipt.revision, encoded(receipt), receipt.observedAt]);

  return Object.freeze({
    reserve(value) {
      const descriptor = normalizeComputeDescriptor(value), receipt = initial(descriptor);
      return atomic(async client => {
        const inserted = await client.query(`insert into bc_private.runtime_operations(operation_id,request_id,org_id,request_hash,fence,revision,receipt,created_at,updated_at)
          values($1,$2,$3,$4,$5,1,$6::jsonb,$7,$7) on conflict do nothing returning ${columns}`,
        [descriptor.operationId, descriptor.requestId, descriptor.binding.orgId, descriptor.requestHash, descriptor.fence, encoded(receipt), descriptor.observedAt]);
        if (inserted.rowCount === 1) {
          const saved = stored(inserted.rows[0]); await append(client, saved);
          return Object.freeze({ acquired: true, receipt: saved });
        }
        const found = await client.query(`select ${columns} from bc_private.runtime_operations where operation_id=$1 for update`, [descriptor.operationId]);
        if (found.rowCount !== 1) fail('identity_conflict');
        const saved = stored(found.rows[0]);
        if (identity(saved) !== identity(descriptor) || (descriptor.serverId !== null && saved.serverId !== descriptor.serverId)) fail('identity_conflict');
        return Object.freeze({ acquired: false, receipt: saved });
      });
    },
    read(operationId) {
      id(operationId);
      return atomic(async client => {
        const found = await client.query(`select ${columns} from bc_private.runtime_operations where operation_id=$1`, [operationId]);
        return found.rowCount ? stored(found.rows[0]) : null;
      });
    },
    commit(value) {
      const input = record(value, ['expectedRevision', 'receipt']), receipt = normalizeComputeReceipt(input.receipt), expected = input.expectedRevision;
      if (!Number.isSafeInteger(expected) || expected < 1 || expected >= Number.MAX_SAFE_INTEGER || receipt.revision !== expected + 1) fail('revision_invalid');
      return atomic(async client => {
        const found = await client.query(`select ${columns} from bc_private.runtime_operations where operation_id=$1 for update`, [receipt.operationId]);
        if (found.rowCount !== 1) return false;
        const old = stored(found.rows[0]); if (old.revision !== expected) return false;
        if (identity(old) !== identity(receipt) || receipt.observedAt < old.observedAt
          || (old.serverId !== null && receipt.serverId !== old.serverId)
          || old.actionIds.some((actionId, index) => receipt.actionIds[index] !== actionId)) fail('identity_conflict');
        const updated = await client.query('update bc_private.runtime_operations set revision=$3,receipt=$4::jsonb,updated_at=$5 where operation_id=$1 and revision=$2 and fence=$6 returning operation_id',
          [receipt.operationId, expected, receipt.revision, encoded(receipt), receipt.observedAt, receipt.fence]);
        if (updated.rowCount !== 1) return false;
        await append(client, receipt); return true;
      });
    },
  });
}
