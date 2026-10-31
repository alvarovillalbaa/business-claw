import { normalizeWorkspace } from '../web/domain.mjs';
import { membershipRow, sessionRow } from './access.mjs';
import { choice, digest, email, fail, freeze, id, nullableTime, PolicyError, port, record, revision, rows, time } from './data.mjs';

const orgColumns = `id,state,revision,created_by AS "createdBy",create_request_id AS "createRequestId",request_hash AS "requestHash",created_at AS "createdAt",updated_at AS "updatedAt",workspace`;
const sessionColumns = `handle_hash AS "handleHash",user_id AS "userId",supabase_session_id AS "supabaseSessionId",authenticated_at AS "authenticatedAt",expires_at AS "expiresAt",revoked_at AS "revokedAt"`;
const inviteColumns = `id,org_id AS "orgId",email,role,invited_by AS "invitedBy",request_hash AS "requestHash",token_hash AS "tokenHash",created_at AS "createdAt",expires_at AS "expiresAt",revoked_at AS "revokedAt",accepted_by AS "acceptedBy",accepted_at AS "acceptedAt",accepted_revision AS "acceptedRevision"`;
const transferColumns = `id,org_id AS "orgId",from_user_id AS "fromUserId",to_user_id AS "toUserId",from_session_hash AS "fromSessionHash",from_supabase_session_id AS "fromSupabaseSessionId",from_authenticated_at AS "fromAuthenticatedAt",request_hash AS "requestHash",created_at AS "createdAt",expires_at AS "expiresAt",accepted_by AS "acceptedBy",accepted_at AS "acceptedAt",accepted_revision AS "acceptedRevision"`;
const orgFields = ['id','state','revision','createdBy','createRequestId','requestHash','createdAt','updatedAt','workspace'];
const inviteFields = ['id','orgId','email','role','invitedBy','requestHash','tokenHash','createdAt','expiresAt','revokedAt','acceptedBy','acceptedAt','acceptedRevision'];
const transferFields = ['id','orgId','fromUserId','toUserId','fromSessionHash','fromSupabaseSessionId','fromAuthenticatedAt','requestHash','createdAt','expiresAt','acceptedBy','acceptedAt','acceptedRevision'];
const iso = value => value instanceof Date ? time(value.toISOString()) : time(value);
const optionalIso = value => value === null ? null : iso(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function organization(value, fromDatabase = false) {
  const input = record(value, orgFields), workspace = normalizeWorkspace(input.workspace);
  const result = { id: id(input.id), state: choice(input.state,['active','deleting','deleted']), revision: revision(input.revision), createdBy: id(input.createdBy), createRequestId: id(input.createRequestId), requestHash: digest(input.requestHash),
    createdAt: fromDatabase ? iso(input.createdAt) : time(input.createdAt), updatedAt: fromDatabase ? iso(input.updatedAt) : time(input.updatedAt), workspace };
  if (result.id !== workspace.organization.id || result.createdAt !== workspace.createdAt || result.updatedAt < workspace.updatedAt || result.updatedAt < result.createdAt || result.revision < workspace.revision) fail(503,'store_invalid');
  return freeze(result);
}
function session(value, fromDatabase = false) {
  return sessionRow(fromDatabase ? { ...value, authenticatedAt: iso(value.authenticatedAt), expiresAt: iso(value.expiresAt), revokedAt: optionalIso(value.revokedAt) } : value);
}
function invitation(value, fromDatabase = false) {
  const input = record(value,inviteFields), result = {};
  for (const key of inviteFields) result[key] = input[key];
  for (const key of ['id','orgId','invitedBy']) result[key] = id(result[key]);
  for (const key of ['requestHash','tokenHash']) result[key] = digest(result[key]);
  result.email = email(result.email); result.role = choice(result.role,['administrator','member','viewer']);
  for (const key of ['createdAt','expiresAt']) result[key] = fromDatabase ? iso(result[key]) : time(result[key]);
  for (const key of ['revokedAt','acceptedAt']) result[key] = fromDatabase ? optionalIso(result[key]) : nullableTime(result[key]);
  result.acceptedBy = result.acceptedBy === null ? null : id(result.acceptedBy);
  result.acceptedRevision = result.acceptedRevision === null ? null : revision(result.acceptedRevision,1);
  return freeze(result);
}
function transfer(value, fromDatabase = false) {
  const input = record(value,transferFields), result = {};
  for (const key of transferFields) result[key] = input[key];
  for (const key of ['id','orgId','fromUserId','toUserId','fromSupabaseSessionId']) result[key] = id(result[key]);
  for (const key of ['fromSessionHash','requestHash']) result[key] = digest(result[key]);
  for (const key of ['fromAuthenticatedAt','createdAt','expiresAt']) result[key] = fromDatabase ? iso(result[key]) : time(result[key]);
  result.acceptedAt = fromDatabase ? optionalIso(result.acceptedAt) : nullableTime(result.acceptedAt);
  result.acceptedBy = result.acceptedBy === null ? null : id(result.acceptedBy);
  result.acceptedRevision = result.acceptedRevision === null ? null : revision(result.acceptedRevision,1);
  return freeze(result);
}
function encoded(value, size, maximum = size) {
  if (typeof value !== 'string' || value.length > Math.ceil(maximum * 4 / 3) + 4 || !/^[A-Za-z0-9_-]+$/.test(value)) fail(400,'envelope_invalid');
  const bytes = Buffer.from(value,'base64url');
  if (bytes.length < size || bytes.length > maximum || bytes.toString('base64url') !== value) fail(400,'envelope_invalid');
  return bytes;
}
function authRow(value) {
  const input = record(value,['session','envelope']), envelope = record(input.envelope,['version','iv','tag','ciphertext']);
  if (envelope.version !== 1) fail(400,'envelope_invalid');
  encoded(envelope.iv,12); encoded(envelope.tag,16); encoded(envelope.ciphertext,1,65536);
  return freeze({ session: session(input.session), envelope: { version:1,iv:envelope.iv,tag:envelope.tag,ciphertext:envelope.ciphertext } });
}

export function createPostgresStore({ pool }) {
  const connect = port(pool,'connect');
  async function transaction(action, authMode = false, initialHandle = null) {
    if (typeof action !== 'function') fail(400,'transaction_invalid');
    if (initialHandle !== null) digest(initialHandle);
    let client, begun = false, broken = false, active = true, pending = 0;
    const orgs = new Map(), sessions = new Map(), authRows = new Map(), invites = new Map(), transfers = new Map(), bootstrapKeys = new Set();
    const query = async (sql, values = []) => {
      if (!active) fail(503,'transaction_closed'); pending++;
      try { return await client.query(sql,values); } finally { pending--; }
    };
    async function lockOrg(orgId) {
      id(orgId);
      if (orgs.size && !orgs.has(orgId)) fail(404,'not_found');
      if (orgs.has(orgId)) return orgs.get(orgId);
      const result = await query(`select ${orgColumns} from bc_private.organizations where id=$1 for update`,[orgId]);
      const row = result.rows.length ? organization(result.rows[0],true) : null;
      if (row) orgs.set(orgId,row); return row;
    }
    function lockedOrg(orgId) { const row = orgs.get(id(orgId)); if (!row) fail(503,'transaction_order'); return row; }
    async function readSession(handleHash, exclusive = false) {
      digest(handleHash);
      const old = sessions.get(handleHash);
      if (old && (!exclusive || old.exclusive)) return old.row;
      const result = await query(`select ${sessionColumns},token_revision as "tokenRevision" from bc_private.app_sessions where handle_hash=$1 for ${exclusive ? 'update' : 'share'}`,[handleHash]);
      if (!result.rows.length) return null;
      const { tokenRevision,...raw } = result.rows[0], row = session(raw,true);
      sessions.set(handleHash,{ row,tokenRevision:revision(tokenRevision),exclusive }); return row;
    }
    const policyTx = {
      readSession: handleHash => readSession(handleHash),
      readOrganization: orgId => lockOrg(orgId),
      async findBootstrap(userId,requestId) {
        id(userId); id(requestId); const key = `${userId}:${requestId}`;
        await query('select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,0))',[`business-claw.bootstrap:${key}`]); bootstrapKeys.add(key);
        const found = await query('select id from bc_private.organizations where created_by=$1 and create_request_id=$2',[userId,requestId]);
        return found.rows.length ? lockOrg(found.rows[0].id) : null;
      },
      async insertOrganization(value) {
        const row = organization(value); if (!bootstrapKeys.has(`${row.createdBy}:${row.createRequestId}`) || row.revision !== 0 || orgs.size) fail(503,'transaction_order');
        const result = await query('insert into bc_private.organizations(id,state,revision,created_by,create_request_id,request_hash,created_at,updated_at,workspace) values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) on conflict do nothing returning id',orgFields.map(key => key === 'workspace' ? JSON.stringify(row.workspace) : row[key]));
        if (result.rowCount === 1) orgs.set(row.id,row); return result.rowCount === 1;
      },
      async writeOrganization(value) {
        const input = record(value,['orgId','expectedRevision','next']), old = lockedOrg(input.orgId), next = organization(input.next);
        if (revision(input.expectedRevision) !== old.revision) return false;
        if (next.id !== old.id || next.revision !== old.revision+1 || next.state !== old.state || next.updatedAt < old.updatedAt
          || ['createdBy','createRequestId','requestHash','createdAt'].some(key => next[key] !== old[key])
          || next.workspace.instance.id !== old.workspace.instance.id || next.workspace.instance.generation !== old.workspace.instance.generation) fail(400,'store_transition_invalid');
        const result = await query('update bc_private.organizations set revision=$3,updated_at=$4,workspace=$5::jsonb where id=$1 and revision=$2 returning id',[old.id,old.revision,next.revision,next.updatedAt,JSON.stringify(next.workspace)]);
        if (result.rowCount === 1) orgs.set(old.id,next); return result.rowCount === 1;
      },
      async readMembership(orgId,userId) {
        await lockOrg(id(orgId)); id(userId);
        const result = await query('select org_id as "orgId",user_id as "userId",role,revoked_at as "revokedAt" from bc_private.memberships where org_id=$1 and user_id=$2 for update',[orgId,userId]);
        return result.rows.length ? membershipRow({ ...result.rows[0],revokedAt:optionalIso(result.rows[0].revokedAt) }) : null;
      },
      async listMemberships(orgId) {
        await lockOrg(id(orgId));
        const result = await query('select org_id as "orgId",user_id as "userId",role,revoked_at as "revokedAt" from bc_private.memberships where org_id=$1 order by user_id limit 1001 for update',[orgId]);
        return freeze(rows(result.rows).map(row => membershipRow({ ...row,revokedAt:optionalIso(row.revokedAt) })));
      },
      async writeMembership(value) {
        const row = membershipRow(value); if (!row) fail(400,'record_invalid'); lockedOrg(row.orgId);
        const result = await query('insert into bc_private.memberships(org_id,user_id,role,revoked_at) values($1,$2,$3,$4) on conflict(org_id,user_id) do update set role=excluded.role,revoked_at=excluded.revoked_at returning user_id',[row.orgId,row.userId,row.role,row.revokedAt]);
        return result.rowCount === 1;
      },
      async readInvite(inviteId) {
        id(inviteId); const found = await query('select org_id as "orgId" from bc_private.invites where id=$1',[inviteId]); if (!found.rows.length) return null;
        await lockOrg(found.rows[0].orgId);
        const result = await query(`select ${inviteColumns} from bc_private.invites where id=$1 for update`,[inviteId]);
        const row = result.rows.length ? invitation(result.rows[0],true) : null; if (row) invites.set(row.id,row); return row;
      },
      async insertInvite(value) {
        const row = invitation(value); lockedOrg(row.orgId);
        const result = await query('insert into bc_private.invites(id,org_id,email,role,invited_by,request_hash,token_hash,created_at,expires_at,revoked_at,accepted_by,accepted_at,accepted_revision) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict do nothing returning id',inviteFields.map(key => row[key]));
        if (result.rowCount === 1) invites.set(row.id,row); return result.rowCount === 1;
      },
      async writeInvite(value) {
        const row = invitation(value), old = invites.get(row.id); lockedOrg(row.orgId);
        if (!old || inviteFields.filter(key => !['revokedAt','acceptedBy','acceptedAt','acceptedRevision'].includes(key)).some(key => !same(row[key],old[key]))
          || (old.acceptedBy !== null && !same(row,old)) || (old.revokedAt !== null && !same(row,old))) fail(400,'store_transition_invalid');
        const result = await query('update bc_private.invites set revoked_at=$3,accepted_by=$4,accepted_at=$5,accepted_revision=$6 where id=$1 and org_id=$2 returning id',[row.id,row.orgId,row.revokedAt,row.acceptedBy,row.acceptedAt,row.acceptedRevision]);
        if (result.rowCount === 1) invites.set(row.id,row); return result.rowCount === 1;
      },
      async readTransfer(transferId) {
        id(transferId); const found = await query('select org_id as "orgId" from bc_private.owner_transfers where id=$1',[transferId]); if (!found.rows.length) return null;
        await lockOrg(found.rows[0].orgId);
        const result = await query(`select ${transferColumns} from bc_private.owner_transfers where id=$1 for update`,[transferId]);
        const row = result.rows.length ? transfer(result.rows[0],true) : null; if (row) transfers.set(row.id,row); return row;
      },
      async insertTransfer(value) {
        const row = transfer(value); lockedOrg(row.orgId);
        const result = await query('insert into bc_private.owner_transfers(id,org_id,from_user_id,to_user_id,from_session_hash,from_supabase_session_id,from_authenticated_at,request_hash,created_at,expires_at,accepted_by,accepted_at,accepted_revision) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict do nothing returning id',transferFields.map(key => row[key]));
        if (result.rowCount === 1) transfers.set(row.id,row); return result.rowCount === 1;
      },
      async writeTransfer(value) {
        const row = transfer(value), old = transfers.get(row.id); lockedOrg(row.orgId);
        if (!old || transferFields.filter(key => !['acceptedBy','acceptedAt','acceptedRevision'].includes(key)).some(key => !same(row[key],old[key])) || (old.acceptedBy !== null && !same(row,old))) fail(400,'store_transition_invalid');
        const result = await query('update bc_private.owner_transfers set accepted_by=$3,accepted_at=$4,accepted_revision=$5 where id=$1 and org_id=$2 returning id',[row.id,row.orgId,row.acceptedBy,row.acceptedAt,row.acceptedRevision]);
        if (result.rowCount === 1) transfers.set(row.id,row); return result.rowCount === 1;
      },
      async appendAudit(value) {
        const row = record(value,['id','orgId','actorId','sessionId','action','at','metadata']), org = lockedOrg(id(row.orgId));
        id(row.id); id(row.actorId); id(row.sessionId); time(row.at);
        const fields = Object.hasOwn(auditFields,row.action) ? auditFields[row.action] : null; if (!fields) fail(400,'audit_invalid'); const metadata = record(row.metadata,fields);
        if (revision(metadata.serverRevision) !== org.revision || row.at !== org.updatedAt) fail(400,'audit_invalid');
        const actorSession = sessions.get(digest(metadata.appSessionHash))?.row;
        if (!actorSession || actorSession.userId !== row.actorId || actorSession.supabaseSessionId !== row.sessionId || actorSession.revokedAt !== null) fail(400,'audit_invalid');
        for (const key of fields) {
          if (key.endsWith('Hash')) digest(metadata[key]);
          else if (key.endsWith('Id') || key === 'invitedBy') id(metadata[key]);
          else if (key === 'kind') choice(metadata[key],['provision','configure','pause','resume','delete']);
          else if (key === 'role') choice(metadata[key],['owner','administrator','member','viewer']);
          else if (key === 'state') choice(metadata[key],['requested','reviewed','confirmed','rejected','cancelled','superseded']);
        }
        const result = await query('insert into bc_private.audit(id,org_id,actor_id,session_id,action,at,metadata) values($1,$2,$3,$4,$5,$6,$7::jsonb) on conflict do nothing returning id',[row.id,row.orgId,row.actorId,row.sessionId,row.action,row.at,JSON.stringify(metadata)]);
        return result.rowCount === 1;
      },
    };
    const authTx = {
      async readAuthSession(handleHash) {
        const row = await readSession(digest(handleHash),true); if (!row) return null;
        const result = await query('select version,iv,tag,ciphertext from bc_private.auth_token_envelopes where handle_hash=$1 for update',[handleHash]);
        if (result.rows.length !== 1) fail(503,'store_invalid'); const envelope = result.rows[0];
        const resultRow = authRow({ session:row,envelope:{ version:envelope.version,iv:envelope.iv.toString('base64url'),tag:envelope.tag.toString('base64url'),ciphertext:envelope.ciphertext.toString('base64url') } });
        authRows.set(handleHash,resultRow); return resultRow;
      },
      async insertAuthSession(value) {
        const row = authRow(value), s = row.session; if (s.revokedAt !== null) fail(400,'store_transition_invalid');
        const inserted = await query('insert into bc_private.app_sessions(handle_hash,user_id,supabase_session_id,authenticated_at,expires_at,revoked_at) values($1,$2,$3,$4,$5,$6) on conflict do nothing returning handle_hash',[s.handleHash,s.userId,s.supabaseSessionId,s.authenticatedAt,s.expiresAt,s.revokedAt]);
        if (inserted.rowCount !== 1) return false;
        const e = row.envelope; await query('insert into bc_private.auth_token_envelopes(handle_hash,version,iv,tag,ciphertext) values($1,$2,$3,$4,$5)',[s.handleHash,e.version,encoded(e.iv,12),encoded(e.tag,16),encoded(e.ciphertext,1,65536)]);
        sessions.set(s.handleHash,{ row:s,tokenRevision:0,exclusive:true }); authRows.set(s.handleHash,row); return true;
      },
      async writeAuthSession(value) {
        const row = authRow(value), s = row.session, old = authRows.get(s.handleHash), locked = sessions.get(s.handleHash);
        if (!old || !locked?.exclusive || !same(s,old.session) || s.revokedAt !== null) fail(400,'store_transition_invalid');
        const updated = await query('update bc_private.app_sessions set token_revision=token_revision+1 where handle_hash=$1 and token_revision=$2 and revoked_at is null returning token_revision',[s.handleHash,locked.tokenRevision]);
        if (updated.rowCount !== 1) return false;
        const e = row.envelope; const changed = await query('update bc_private.auth_token_envelopes set version=$2,iv=$3,tag=$4,ciphertext=$5 where handle_hash=$1',[s.handleHash,e.version,encoded(e.iv,12),encoded(e.tag,16),encoded(e.ciphertext,1,65536)]);
        if (changed.rowCount !== 1) fail(503,'store_invalid');
        sessions.set(s.handleHash,{ ...locked,tokenRevision:locked.tokenRevision+1 }); authRows.set(s.handleHash,row); return true;
      },
      async revokeAuthSession(handleHash,at) {
        digest(handleHash); time(at); const locked = sessions.get(handleHash); if (!locked) return false; if (!locked.exclusive) fail(503,'transaction_order');
        const result = await query(`update bc_private.app_sessions set token_revision=case when revoked_at is null then token_revision+1 else token_revision end,revoked_at=coalesce(revoked_at,greatest(authenticated_at,$2::timestamptz)) where handle_hash=$1 returning ${sessionColumns},token_revision as "tokenRevision"`,[handleHash,at]);
        if (!result.rows.length) return false;
        const { tokenRevision,...raw } = result.rows[0]; sessions.set(handleHash,{ row:session(raw,true),tokenRevision,exclusive:true }); authRows.delete(handleHash); return true;
      },
      async listOrganizations(userId,handleHash) {
        id(userId); digest(handleHash); const actor = sessions.get(handleHash)?.row; if (!actor || actor.userId !== userId || actor.revokedAt !== null) return freeze([]);
        const result = await query(`select o.id,o.state,o.revision,o.created_by as "createdBy",o.create_request_id as "createRequestId",o.request_hash as "requestHash",o.created_at as "createdAt",o.updated_at as "updatedAt",o.workspace,m.role from bc_private.organizations o join bc_private.memberships m on m.org_id=o.id join bc_private.app_sessions s on s.handle_hash=$2 and s.user_id=m.user_id where m.user_id=$1 and m.revoked_at is null and o.state='active' and s.revoked_at is null and s.expires_at>clock_timestamp() and s.authenticated_at<=clock_timestamp() order by o.id limit 1001`,[userId,handleHash]);
        return freeze(rows(result.rows).map(raw => { const { role,...fields } = raw, org = organization(fields,true); return { orgId:org.id,name:org.workspace.organization.name,instanceId:org.workspace.instance.id,generation:org.workspace.instance.generation,serverRevision:org.revision,role:choice(role,['owner','administrator','member','viewer']) }; }));
      },
    };
    try {
      client = await connect(); port(client,'query'); port(client,'release');
      await client.query('begin isolation level read committed'); begun = true;
      await client.query("set local statement_timeout='8000ms'; set local lock_timeout='3000ms'; set local idle_in_transaction_session_timeout='30000ms'; set local search_path=pg_catalog; set local timezone='UTC'; set local role bc_bff");
      if (authMode && initialHandle !== null) await authTx.readAuthSession(initialHandle);
      const result = await action(Object.freeze(authMode ? authTx : policyTx)); active = false;
      if (pending) fail(503,'transaction_unawaited');
      await client.query('commit'); begun = false; return result;
    } catch (error) {
      active = false;
      if (begun) try { await client.query('rollback'); } catch { broken = true; }
      if (error instanceof PolicyError) throw error;
      if (['40001','40P01','55P03'].includes(error?.code)) fail(409,'transaction_conflict');
      fail(503,'database_unavailable');
    } finally { active = false; if (client && typeof client.release === 'function') client.release(broken); }
  }
  return Object.freeze({ transaction: action => transaction(action), authTransaction: (handleHash,action) => transaction(action,true,handleHash) });
}

const baseAudit = ['serverRevision','appSessionHash'];
const auditFields = Object.freeze({
  'organization.bootstrap':['requestId',...baseAudit], 'workspace.intent':['intentHash',...baseAudit],
  ...Object.fromEntries(['request','review','confirm','cancel'].map(action => [`operation.${action}`,['operationId','kind','planHash','state',...baseAudit]])),
  'invite.create':['inviteId','role','recipientHash',...baseAudit], 'invite.accept':['inviteId','role','invitedBy',...baseAudit], 'invite.revoke':['inviteId',...baseAudit],
  'membership.role':['userId','role',...baseAudit], 'membership.revoke':['userId','role',...baseAudit],
  'ownership.request':['transferId','toUserId',...baseAudit], 'ownership.accept':['transferId','fromUserId',...baseAudit],
});
