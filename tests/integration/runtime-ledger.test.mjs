import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { createWorkspace } from '../../web/domain.mjs';
import { createRuntimeLedger, RuntimeLedgerError } from '../../server/runtime-ledger.mjs';
import { createComputeProvider, computeRequestHash } from '../../runtime/compute-provider.mjs';

// T3: real PostgreSQL transactions/grants in the fresh task-owned CI service only.
// Never run this fixture against a local/shared/Supabase database or provider.
const fixtureUrl = 'postgresql://postgres:authored-ci-only@127.0.0.1:5432/business_claw_runtime_checks';
if (process.env.CI !== 'true' || process.env.BC_DISPOSABLE_DB !== 'business-claw-runtime-ci-v1'
  || process.env.PG_RUNTIME_TEST_URL !== fixtureUrl) throw new Error('Disposable runtime CI database required');

const uuid = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const instant = '2026-10-31T12:00:00.000Z';
const userId = uuid(1), orgId = uuid(2), instanceId = uuid(3), otherOrgId = uuid(20);
const bound = () => ({ orgId, instanceId, generation: 1, installationId: uuid(30), releaseCommit: 'a'.repeat(40) });
const grant = () => ({ operationId: uuid(4), requestId: uuid(5), fence: 1, binding: bound(), action: 'create', serverId: null,
  manifest: { creationRequestId: uuid(5), name: 'authored-runtime', serverType: 'cx23', location: 'nbg1', imageId: 10, networkIds: [11], firewallIds: [12], volumeIds: [13], sshKeyIds: [14], ipv4Id: 15, ipv6Id: 16 } });
function descriptor(overrides = {}) {
  const a = grant();
  for (const key of ['operationId', 'requestId', 'fence', 'binding', 'action', 'serverId']) if (Object.hasOwn(overrides, key)) a[key] = overrides[key];
  if (a.action === 'create') a.manifest.creationRequestId = a.requestId;
  return { operationId: a.operationId, requestId: a.requestId, fence: a.fence, binding: a.binding,
    action: a.action, serverId: a.serverId, requestHash: computeRequestHash(a), observedAt: instant, ...overrides };
}
const next = (row, patch = {}) => ({ ...row, revision: row.revision + 1, observedAt: '2026-10-31T12:00:01.000Z', state: 'uncertain', errorCode: 'transport_unavailable', ...patch });
const pending = row => next(row, { state: 'pending', serverId: 101, actionIds: [201], providerStatus: 'initializing', actionStatus: 'running', errorCode: null });
const code = expected => error => error instanceof RuntimeLedgerError && error.code === expected;
let admin, pool, ledger, ownedService = false;
const eventCount = async operationId => Number((await admin.query('select count(*) as n from bc_private.runtime_operation_events where operation_id=$1', [operationId])).rows[0].n);
const operationCount = async () => Number((await admin.query('select count(*) as n from bc_private.runtime_operations')).rows[0].n);
async function asRole(role, sql, parameters = [], selectedPool = admin) {
  assert.ok(['bc_runtime_worker', 'bc_runtime_login', 'bc_bff', 'anon', 'authenticated', 'service_role'].includes(role));
  const client = await selectedPool.connect(); let broken = false;
  try { await client.query('begin'); await client.query(`set local role ${role}`); return await client.query(sql, parameters); }
  finally { try { await client.query('rollback'); } catch { broken = true; } client.release(broken); }
}
function loseOneCommitAcknowledgment() {
  let armed = true;
  return { async connect() {
    const client = await pool.connect();
    return { async query(...args) {
      // Execute the real SQL first; only the response after a committed transaction is lost.
      const result = await client.query(...args);
      if (armed && args[0] === 'commit') { armed = false; throw new Error('authored commit acknowledgment loss'); }
      return result;
    }, release: broken => client.release(broken) };
  } };
}

before(async () => {
  admin = new Pool({ connectionString: fixtureUrl, max: 2, connectionTimeoutMillis: 3000, query_timeout: 10000 });
  const facts = (await admin.query("select current_database() as database,current_setting('server_version_num')::integer as version")).rows[0];
  assert.equal(facts.database, 'business_claw_runtime_checks'); assert.ok(facts.version >= 170000 && facts.version < 180000);
  const existing = Number((await admin.query("select count(*) as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg_%' and n.nspname<>'information_schema' and c.relkind in ('r','p')")).rows[0].n);
  assert.equal(existing, 0, 'The runtime service must start with no user tables');
  const client = await admin.connect();
  try {
    await client.query('begin');
    try {
      await client.query('create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role;');
      await client.query(readFileSync(new URL('../../db/schema.sql', import.meta.url), 'utf8'));
      await client.query(readFileSync(new URL('../../db/runtime-ledger.sql', import.meta.url), 'utf8'));
      await client.query('commit');
    } catch (error) { await client.query('rollback'); throw error; }
  } finally { client.release(); }
  await admin.query("alter role bc_runtime_login password 'authored-ci-only'");
  pool = new Pool({ host: '127.0.0.1', port: 5432, database: 'business_claw_runtime_checks', user: 'bc_runtime_login', password: 'authored-ci-only', max: 4, connectionTimeoutMillis: 3000, query_timeout: 10000 });
  ledger = createRuntimeLedger({ pool });
  ownedService = true;
});
beforeEach(async () => {
  if (!ownedService) throw new Error('Task-owned runtime fixture unavailable');
  // All these tables were created above in this empty, explicitly guarded service.
  await admin.query('truncate bc_private.runtime_operation_events,bc_private.runtime_operations,bc_private.audit,bc_private.owner_transfers,bc_private.invites,bc_private.auth_token_envelopes,bc_private.app_sessions,bc_private.memberships,bc_private.organizations,auth.users');
  await admin.query('insert into auth.users(id) values($1)', [userId]);
  for (const [selectedOrg, selectedInstance, requestId] of [[orgId, instanceId, uuid(100)], [otherOrgId, uuid(21), uuid(101)]]) {
    const workspace = createWorkspace({ orgId: selectedOrg, instanceId: selectedInstance, name: 'Authored runtime organization', now: instant });
    await admin.query("insert into bc_private.organizations(id,state,revision,created_by,create_request_id,request_hash,created_at,updated_at,workspace) values($1,'active',0,$2,$3,$4,$5,$5,$6::jsonb)",
      [selectedOrg, userId, requestId, 'a'.repeat(64), instant, JSON.stringify(workspace)]);
  }
  await admin.query('insert into bc_private.app_sessions(handle_hash,user_id,supabase_session_id,authenticated_at,expires_at,revoked_at) values($1,$2,$3,$4,$5,null)', ['b'.repeat(64), userId, uuid(40), instant, '2026-10-31T20:00:00.000Z']);
  await admin.query('insert into bc_private.auth_token_envelopes(handle_hash,version,iv,tag,ciphertext) values($1,1,$2,$3,$4)', ['b'.repeat(64), Buffer.alloc(12, 1), Buffer.alloc(16, 2), Buffer.from('authored private envelope')]);
});
after(async () => {
  ownedService = false;
  const results = await Promise.allSettled([pool?.end(), admin?.end()]);
  for (const result of results) if (result.status === 'rejected') throw result.reason;
});

test('first reservation durably commits the current receipt and its first history event', async () => {
  const d = descriptor(), result = await ledger.reserve(d);
  assert.equal(result.acquired, true); assert.equal(result.receipt.state, 'reserved'); assert.equal(result.receipt.revision, 1);
  assert.equal(await operationCount(), 1); assert.equal(await eventCount(d.operationId), 1);
  const restarted = createRuntimeLedger({ pool }); assert.deepEqual(await restarted.read(d.operationId), result.receipt);
  const event = (await admin.query('select receipt from bc_private.runtime_operation_events where operation_id=$1', [d.operationId])).rows[0];
  assert.deepEqual(event.receipt, result.receipt); assert.ok(Object.isFrozen(result.receipt.binding));
});
test('exact reservation replay retains the committed receipt without another history event', async () => {
  const d = descriptor(), first = await ledger.reserve(d), replay = await ledger.reserve({ ...d, observedAt: '2026-10-31T12:01:00.000Z' });
  assert.equal(replay.acquired, false); assert.deepEqual(replay.receipt, first.receipt); assert.equal(await eventCount(d.operationId), 1);
});
test('concurrent real clients acquire a reservation exactly once', async () => {
  const d = descriptor(), results = await Promise.all([ledger.reserve(d), createRuntimeLedger({ pool }).reserve(d)]);
  assert.equal(results.filter(value => value.acquired).length, 1); assert.deepEqual(results[0].receipt, results[1].receipt);
  assert.equal(await operationCount(), 1); assert.equal(await eventCount(d.operationId), 1);
});
test('a globally reused request ID cannot create a second operation row', async () => {
  const d = descriptor(); await ledger.reserve(d);
  await assert.rejects(ledger.reserve({ ...d, operationId: uuid(90) }), code('identity_conflict'));
  assert.equal(await ledger.read(uuid(90)), null); assert.equal(await operationCount(), 1); assert.equal(await eventCount(d.operationId), 1);
});
test('changed fence binding release and request hash cannot reacquire an existing operation', async () => {
  const d = descriptor(), first = await ledger.reserve(d);
  for (const altered of [{ ...d, fence: 2 }, { ...d, binding: { ...d.binding, generation: 2 } }, { ...d, binding: { ...d.binding, orgId: otherOrgId } }, { ...d, binding: { ...d.binding, releaseCommit: 'c'.repeat(40) } }, { ...d, requestHash: 'd'.repeat(64) }]) await assert.rejects(ledger.reserve(altered), code('identity_conflict'));
  assert.deepEqual(await ledger.read(d.operationId), first.receipt); assert.equal(await eventCount(d.operationId), 1);
});
test('concurrent receipt CAS permits one winner and appends only its committed revision', async () => {
  const first = (await ledger.reserve(descriptor())).receipt, choices = [next(first), pending(first)];
  const accepted = await Promise.all(choices.map(receipt => createRuntimeLedger({ pool }).commit({ expectedRevision: 1, receipt })));
  assert.equal(accepted.filter(Boolean).length, 1); assert.deepEqual(await ledger.read(first.operationId), choices[accepted.indexOf(true)]);
  assert.equal(await eventCount(first.operationId), 2);
});
test('an established server ID cannot be replaced or erased through a later receipt', async () => {
  const first = (await ledger.reserve(descriptor())).receipt, known = pending(first); assert.equal(await ledger.commit({ expectedRevision: 1, receipt: known }), true);
  await assert.rejects(ledger.commit({ expectedRevision: 2, receipt: next(known, { serverId: 102 }) }), code('identity_conflict'));
  await assert.rejects(ledger.commit({ expectedRevision: 2, receipt: next(known, { serverId: null, actionIds: [], providerStatus: null, actionStatus: null }) }), code('identity_conflict'));
  assert.deepEqual(await ledger.read(first.operationId), known); assert.equal(await eventCount(first.operationId), 2);
});
test('action history accepts an append but refuses erasure reordering and replacement', async () => {
  const first = (await ledger.reserve(descriptor())).receipt, known = pending(first); await ledger.commit({ expectedRevision: 1, receipt: known });
  const appended = next(known, { state: 'pending', errorCode: null, actionIds: [201, 202] }); assert.equal(await ledger.commit({ expectedRevision: 2, receipt: appended }), true);
  for (const actionIds of [[202], [202, 201], [999]]) await assert.rejects(ledger.commit({ expectedRevision: 3, receipt: next(appended, { actionIds }) }), code('identity_conflict'));
  assert.deepEqual(await ledger.read(first.operationId), appended); assert.equal(await eventCount(first.operationId), 3);
});
test('runtime worker can read history but cannot update delete or truncate committed events', async () => {
  const first = await ledger.reserve(descriptor());
  assert.equal((await asRole('bc_runtime_worker', 'select receipt from bc_private.runtime_operation_events', [], pool)).rowCount, 1);
  for (const sql of ['update bc_private.runtime_operation_events set revision=revision', 'delete from bc_private.runtime_operation_events', 'truncate bc_private.runtime_operation_events']) await assert.rejects(asRole('bc_runtime_worker', sql, [], pool), error => error.code === '42501');
  assert.equal(await eventCount(first.receipt.operationId), 1);
});
test('forced RLS journal tables and role grants exclude BFF and all browser identities', async () => {
  const tables = (await admin.query("select relname,relrowsecurity,relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='bc_private' and c.relname in ('runtime_operations','runtime_operation_events') order by relname")).rows;
  assert.equal(tables.length, 2); assert.ok(tables.every(row => row.relrowsecurity && row.relforcerowsecurity));
  for (const role of ['bc_bff', 'anon', 'authenticated', 'service_role']) for (const row of tables) {
    assert.equal((await admin.query("select has_table_privilege($1,$2,'select,insert,update,delete') as allowed", [role, `bc_private.${row.relname}`])).rows[0].allowed, false);
    await assert.rejects(asRole(role, `select * from bc_private.${row.relname}`), error => error.code === '42501');
  }
  const roles = (await admin.query("select rolname,rolinherit,rolsuper,rolbypassrls from pg_roles where rolname in ('bc_runtime_worker','bc_runtime_login') order by rolname")).rows;
  assert.equal(roles.length, 2); assert.ok(roles.every(row => !row.rolinherit && !row.rolsuper && !row.rolbypassrls));
});
test('runtime credentials cannot read Auth envelopes or mutate ordinary organization state', async () => {
  await ledger.reserve(descriptor());
  for (const role of ['bc_runtime_worker', 'bc_runtime_login']) {
    await assert.rejects(asRole(role, 'select * from bc_private.auth_token_envelopes', [], pool), error => error.code === '42501');
    await assert.rejects(asRole(role, 'select * from bc_private.app_sessions', [], pool), error => error.code === '42501');
    await assert.rejects(asRole(role, "update bc_private.organizations set state='deleted' where id=$1", [orgId], pool), error => error.code === '42501');
  }
  assert.equal((await admin.query('select state from bc_private.organizations where id=$1', [orgId])).rows[0].state, 'active');
  assert.equal((await admin.query('select count(*) as n from bc_private.auth_token_envelopes')).rows[0].n, '1');
});
test('an actual event insertion failure rolls back both first reservation and receipt CAS', async () => {
  const failingId = uuid(88), failedDescriptor = descriptor({ operationId: failingId, requestId: uuid(188) });
  await admin.query("create function bc_private.authored_runtime_event_failure() returns trigger language plpgsql as $$ begin if new.revision=2 or new.operation_id='00000000-0000-4000-8000-000000000088'::uuid then raise exception 'authored event insertion failure' using errcode='P0001'; end if; return new; end; $$; create trigger authored_runtime_event_failure before insert on bc_private.runtime_operation_events for each row execute function bc_private.authored_runtime_event_failure();");
  let initial;
  try {
    await assert.rejects(ledger.reserve(failedDescriptor), code('database_unavailable')); assert.equal(await ledger.read(failingId), null); assert.equal(await eventCount(failingId), 0);
    initial = (await ledger.reserve(descriptor())).receipt;
    await assert.rejects(ledger.commit({ expectedRevision: 1, receipt: pending(initial) }), code('database_unavailable'));
    assert.deepEqual(await ledger.read(initial.operationId), initial); assert.equal(await eventCount(initial.operationId), 1);
  } finally { await admin.query('drop trigger authored_runtime_event_failure on bc_private.runtime_operation_events; drop function bc_private.authored_runtime_event_failure();'); }
  assert.equal(await ledger.commit({ expectedRevision: 1, receipt: pending(initial) }), true);
  assert.equal((await ledger.reserve(failedDescriptor)).acquired, true);
});
test('lost real COMMIT acknowledgments never reacquire reservations or duplicate committed revisions', async () => {
  const d = descriptor(), uncertain = createRuntimeLedger({ pool: loseOneCommitAcknowledgment() });
  await assert.rejects(uncertain.reserve(d), code('database_unavailable'));
  const recovered = await ledger.reserve(d); assert.equal(recovered.acquired, false); assert.equal(recovered.receipt.revision, 1); assert.equal(await eventCount(d.operationId), 1);
  const changed = pending(recovered.receipt), lostUpdate = createRuntimeLedger({ pool: loseOneCommitAcknowledgment() });
  await assert.rejects(lostUpdate.commit({ expectedRevision: 1, receipt: changed }), code('database_unavailable'));
  assert.deepEqual(await ledger.read(d.operationId), changed); assert.equal(await eventCount(d.operationId), 2);
  assert.equal(await ledger.commit({ expectedRevision: 1, receipt: changed }), false);
  assert.equal((await ledger.reserve(d)).acquired, false); assert.equal(await eventCount(d.operationId), 2);
});
test('a restarted compute adapter reconciles a lost allocation acknowledgment without a second POST', async () => {
  const a = grant(), labels = { bc_org: a.binding.orgId, bc_instance: a.binding.instanceId, bc_generation: '1', bc_installation: a.binding.installationId, bc_release: a.binding.releaseCommit, bc_request: a.requestId };
  let posts = 0, created = false;
  const cloudServer = { id: 101, name: a.manifest.name, labels, server_type: { name: 'cx23' }, location: { name: 'nbg1' }, image: { id: 10 }, locked: false, status: 'off', private_net: [{ network: 11 }], volumes: [13], public_net: { ipv4: { id: 15 }, ipv6: { id: 16 }, firewalls: [{ id: 12 }] } };
  const transport = async request => {
    const url = new URL(request.url); assert.equal(url.origin, 'https://api.hetzner.cloud');
    if (request.method === 'POST' && url.pathname === '/v1/servers') { posts++; created = true; throw new Error('authored lost cloud acknowledgment'); }
    if (request.method === 'GET' && url.pathname === '/v1/servers') return { status: 200, body: JSON.stringify({ servers: created ? [cloudServer] : [], meta: { pagination: { next_page: null } } }) };
    const match = url.pathname.match(/^\/v1\/(networks|firewalls|volumes|primary_ips)\/(\d+)$/);
    if (request.method === 'GET' && match) {
      const selectedId = Number(match[2]), key = { networks: 'network', firewalls: 'firewall', volumes: 'volume', primary_ips: 'primary_ip' }[match[1]];
      return { status: 200, body: JSON.stringify({ [key]: { id: selectedId, labels, server: null, assignee_id: null, location: { name: 'nbg1' }, auto_delete: false, type: selectedId === 15 ? 'ipv4' : 'ipv6' } }) };
    }
    throw new Error('Unexpected authored transport request');
  };
  const ports = { transport, admission: { authorize: async operationId => { assert.equal(operationId, a.operationId); return structuredClone(a); } }, clock: () => instant };
  const first = await createComputeProvider({ ...ports, ledger }).execute(a.operationId);
  assert.equal(first.receipt.state, 'uncertain'); assert.equal(first.receipt.serverId, null); assert.equal(posts, 1);
  const restarted = createComputeProvider({ ...ports, ledger: createRuntimeLedger({ pool }) });
  const observed = await restarted.execute(a.operationId);
  assert.equal(observed.receipt.state, 'succeeded'); assert.equal(observed.receipt.serverId, 101); assert.equal(posts, 1);
  assert.equal(observed.persistence, 'confirmed'); assert.equal(observed.ready, false); assert.equal(observed.readiness, 'unproven');
  assert.equal(await eventCount(a.operationId), 3);
});
