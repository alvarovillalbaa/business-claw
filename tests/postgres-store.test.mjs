import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Pool } from 'pg';
import { createPostgresStore } from '../server/postgres-store.mjs';
import { createServerPolicy } from '../server/policy.mjs';

// This destructive fixture setup belongs only to the workflow's disposable PG service.
const fixtureUrl = 'postgresql://postgres:authored-ci-only@127.0.0.1:5432/business_claw_checks';
if (process.env.CI !== 'true' || process.env.BC_DISPOSABLE_DB !== 'business-claw-backend-ci-v1'
  || process.env.PG_TEST_URL !== fixtureUrl) throw new Error('Disposable CI database required');

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const instant = '2026-10-31T12:00:00.000Z';
const denied = (promise, status, code) => assert.rejects(promise, error => error.status === status && error.code === code);
let admin, pool, store, policy, sequence, identities, sessions;
const envelope = value => ({ version: 1, iv: Buffer.alloc(12, 1).toString('base64url'), tag: Buffer.alloc(16, 2).toString('base64url'), ciphertext: Buffer.from(value).toString('base64url') });
const identity = {
  verify: async context => structuredClone(identities[context] ?? null),
  verifyMutation: async () => true,
};
const makePolicy = selectedStore => createServerPolicy({ identity, store: selectedStore, clock: { now: () => instant }, random: { uuid: () => uuid(sequence++), bytes: size => new Uint8Array(size).fill(9) } });
const target = (result, extra = {}) => ({ orgId: result.workspace.organization.id, instanceId: result.workspace.instance.id,
  expectedGeneration: result.workspace.instance.generation, expectedRevision: result.serverRevision, ...extra });
const bootstrap = (name = 'owner', label = 'Authored organization', requestId = uuid(200)) => policy.bootstrap(name, { requestId, name: label });
const auditCount = async orgId => Number((await admin.query('select count(*) as n from bc_private.audit where org_id=$1', [orgId])).rows[0].n);
const withAuditFailure = () => makePolicy({ transaction: callback => store.transaction(tx => callback({ ...tx, appendAudit: async () => { throw new Error('authored audit outage'); } })) });

before(async () => {
  admin = new Pool({ connectionString: fixtureUrl, max: 1 });
  await admin.query('create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role;');
  const setup = await admin.connect();
  try {
    await setup.query('begin');
    try { await setup.query(fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')); await setup.query('commit'); }
    catch (error) { await setup.query('rollback'); throw error; }
  } finally { setup.release(); }
  await admin.query("alter role bc_pool_login password 'authored-ci-only'");
  pool = new Pool({ host: '127.0.0.1', port: 5432, database: 'business_claw_checks', user: 'bc_pool_login', password: 'authored-ci-only', max: 4, connectionTimeoutMillis: 3000, query_timeout: 10000 });
  store = createPostgresStore({ pool });
});
beforeEach(async () => {
  await admin.query('truncate bc_private.audit,bc_private.owner_transfers,bc_private.invites,bc_private.auth_token_envelopes,bc_private.app_sessions,bc_private.memberships,bc_private.organizations,auth.users');
  sequence = 1000; identities = {}; sessions = {};
  for (const [index, name] of ['owner', 'recipient', 'stranger'].entries()) {
    const userId = uuid(index + 1), handleHash = String(index + 1).repeat(64), supabaseSessionId = uuid(index + 100);
    await admin.query('insert into auth.users(id) values($1)', [userId]);
    identities[name] = { userId, email: `${name}@fixture.invalid`, emailConfirmed: true, handleHash, supabaseSessionId };
    sessions[name] = { handleHash, userId, supabaseSessionId, authenticatedAt: instant, expiresAt: '2026-10-31T20:00:00.000Z', revokedAt: null };
    await store.authTransaction(null, tx => tx.insertAuthSession({ session: sessions[name], envelope: envelope(`authored-${name}`) }));
  }
  policy = makePolicy(store);
});
after(async () => { await pool?.end(); await admin?.end(); });

test('private tables force RLS and browser roles have neither schema usage nor table grants', async () => {
  const tables = (await admin.query("select c.relname,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='bc_private' and c.relkind='r' order by c.relname")).rows;
  assert.equal(tables.length, 7); assert(tables.every(row => row.relrowsecurity && row.relforcerowsecurity));
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal((await admin.query("select has_schema_privilege($1,'bc_private','usage') as allowed", [role])).rows[0].allowed, false);
    for (const row of tables) assert.equal((await admin.query("select has_table_privilege($1,$2,'select,insert,update,delete') as allowed", [role, `bc_private.${row.relname}`])).rows[0].allowed, false);
  }
  assert.equal((await admin.query("select has_table_privilege('bc_bff','bc_private.audit','update,delete') as allowed")).rows[0].allowed, false);
  const login = (await admin.query("select rolinherit,rolsuper,rolbypassrls from pg_roles where rolname='bc_pool_login'")).rows[0];
  assert.deepEqual(login, { rolinherit: false, rolsuper: false, rolbypassrls: false });
});

test('the private login round-trips only encrypted token bytes and the exact bound session DTO', async () => {
  const found = await store.authTransaction(sessions.owner.handleHash, tx => tx.readAuthSession(sessions.owner.handleHash));
  assert.deepEqual(found, { session: sessions.owner, envelope: envelope('authored-owner') });
  const changed = { session: sessions.owner, envelope: envelope('authored-rotated') };
  await store.authTransaction(sessions.owner.handleHash, async tx => { await tx.readAuthSession(sessions.owner.handleHash); assert.equal(await tx.writeAuthSession(changed), true); });
  const next = await store.authTransaction(sessions.owner.handleHash, tx => tx.readAuthSession(sessions.owner.handleHash));
  assert.deepEqual(next.envelope, changed.envelope);
  assert.equal((await admin.query('select token_revision from bc_private.app_sessions where handle_hash=$1', [sessions.owner.handleHash])).rows[0].token_revision, 1);
});

test('bootstrap commits organization membership and audit atomically and parameterizes authored labels', async () => {
  const label = "Équipe <Team> '); drop schema bc_private cascade; --";
  const first = await bootstrap('owner', label), orgId = first.workspace.organization.id;
  assert.equal(first.workspace.organization.name, label); assert.equal(first.role, 'owner');
  assert.equal(first.execution.ready, false); assert.equal(first.execution.dispatchAllowed, false);
  const replay = await bootstrap('owner', label);
  assert.equal(replay.workspace.organization.id, orgId); assert.equal(replay.replayed, true);
  assert.equal(await auditCount(orgId), 1);
  assert.equal(Number((await admin.query('select count(*) as n from bc_private.memberships')).rows[0].n), 1);
});

test('concurrent retries of one bootstrap key recover one organization and one audit', async () => {
  const results = await Promise.all([bootstrap(), bootstrap()]);
  assert.equal(results[0].workspace.organization.id, results[1].workspace.organization.id);
  assert.equal(results.filter(row => row.replayed).length, 1);
  assert.equal(await auditCount(results[0].workspace.organization.id), 1);
});

test('a failed bootstrap audit rolls back the organization and initial Owner together', async () => {
  await denied(withAuditFailure().bootstrap('owner', { requestId: uuid(200), name: 'Rollback fixture' }), 503, 'database_unavailable');
  for (const table of ['organizations', 'memberships', 'audit']) assert.equal(Number((await admin.query(`select count(*) as n from bc_private.${table}`)).rows[0].n), 0);
  assert.equal((await bootstrap()).role, 'owner');
});

test('actual rows reject cross-organization reads and intent writes', async () => {
  const a = await bootstrap(), b = await bootstrap('stranger', 'Other organization');
  await denied(policy.readWorkspace('stranger', { orgId: a.workspace.organization.id }), 404, 'not_found');
  await denied(policy.updateIntent('owner', target(b, { intent: { ...b.workspace.instance.desiredSetup, purpose: 'foreign change' } })), 404, 'not_found');
  assert.equal((await policy.readWorkspace('owner', { orgId: a.workspace.organization.id })).serverRevision, a.serverRevision);
});

test('stored membership revocation denies the next policy request while its token remains unchanged', async () => {
  const result = await bootstrap(), orgId = result.workspace.organization.id;
  await admin.query('update bc_private.memberships set revoked_at=$1 where org_id=$2 and user_id=$3', [instant, orgId, identities.owner.userId]);
  await denied(policy.readWorkspace('owner', { orgId }), 404, 'not_found');
  assert.equal((await store.authTransaction(sessions.owner.handleHash, tx => tx.readAuthSession(sessions.owner.handleHash))).session.revokedAt, null);
});

test('persisted Viewer role cannot mutate intent and the last Owner cannot be revoked', async () => {
  const result = await bootstrap(), orgId = result.workspace.organization.id;
  await admin.query("insert into bc_private.memberships(org_id,user_id,role) values($1,$2,'viewer')", [orgId, identities.recipient.userId]);
  await denied(policy.updateIntent('recipient', target(result, { intent: { ...result.workspace.instance.desiredSetup, purpose: 'forbidden change' } })), 403, 'forbidden');
  await denied(policy.revokeMember('owner', { orgId, expectedRevision: result.serverRevision, userId: identities.owner.userId }), 409, 'last_owner');
  assert.equal(await auditCount(orgId), 1);
});

test('stored reviewed plans retain one hash through confirmation and cancellation without runtime admission', async () => {
  const first = await bootstrap(), operationId = uuid(400);
  const request = await policy.requestOperation('owner', target(first, { operationId, kind: 'provision' }));
  const review = await policy.reviewOperation('owner', target(request, { operationId, planHash: request.operation.planHash, decision: 'reviewed' }));
  const confirmed = await policy.confirmOperation('owner', target(review, { operationId, planHash: review.operation.planHash }));
  assert.equal(confirmed.operation.planHash, request.operation.planHash); assert.equal(confirmed.operation.state, 'confirmed');
  assert.equal(confirmed.execution.chatAdmissionAllowed, false);
  const cancelled = await policy.cancelOperation('owner', target(confirmed, { operationId, planHash: confirmed.operation.planHash }));
  assert.equal(cancelled.operation.state, 'cancelled');
  assert.equal((await policy.readWorkspace('owner', { orgId: first.workspace.organization.id })).workspace.operations[0].state, 'cancelled');
});

test('concurrent database clients permit one revision winner and no lost intent update', async () => {
  const first = await bootstrap(), orgId = first.workspace.organization.id;
  const changed = purpose => policy.updateIntent('owner', target(first, { intent: { ...first.workspace.instance.desiredSetup, purpose } }));
  const results = await Promise.allSettled([changed('first contender'), changed('second contender')]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  const failure = results.find(row => row.status === 'rejected').reason;
  assert.equal(failure.status, 409); assert.equal(failure.code, 'revision_conflict');
  const read = await policy.readWorkspace('owner', { orgId });
  assert.equal(read.serverRevision, first.serverRevision + 1); assert.equal(await auditCount(orgId), 2);
});

test('audit failure after an actual CAS rolls back workspace revision and releases the client', async () => {
  const first = await bootstrap(), orgId = first.workspace.organization.id;
  await denied(withAuditFailure().updateIntent('owner', target(first, { intent: { ...first.workspace.instance.desiredSetup, purpose: 'must roll back' } })), 503, 'database_unavailable');
  const read = await policy.readWorkspace('owner', { orgId });
  assert.deepEqual(read.workspace, first.workspace); assert.equal(read.serverRevision, first.serverRevision); assert.equal(await auditCount(orgId), 1);
  assert.equal((await policy.updateIntent('owner', target(read, { intent: { ...read.workspace.instance.desiredSetup, purpose: 'subsequent write' } }))).serverRevision, first.serverRevision + 1);
});

test('invite acceptance persists only its token hash and a replay cannot restore revoked membership', async () => {
  const first = await bootstrap(), orgId = first.workspace.organization.id;
  const invited = await policy.createInvite('owner', { orgId, expectedRevision: first.serverRevision, inviteId: uuid(500), email: identities.recipient.email, role: 'member' });
  const row = (await admin.query('select token_hash from bc_private.invites where id=$1', [uuid(500)])).rows[0];
  assert.match(row.token_hash, /^[a-f0-9]{64}$/); assert.notEqual(row.token_hash, invited.delivery.token);
  const accepted = await policy.acceptInvite('recipient', { inviteId: uuid(500), token: invited.delivery.token });
  assert.equal(accepted.state, 'accepted');
  const revoked = await policy.revokeMember('owner', { orgId, expectedRevision: accepted.serverRevision, userId: identities.recipient.userId });
  const replay = await policy.acceptInvite('recipient', { inviteId: uuid(500), token: invited.delivery.token });
  assert.equal(replay.replayed, true); assert.equal(replay.serverRevision, accepted.serverRevision);
  await denied(policy.readWorkspace('recipient', { orgId }), 404, 'not_found');
  assert.equal((await policy.readWorkspace('owner', { orgId })).serverRevision, revoked.serverRevision);
});

test('both owner-transfer membership writes roll back together and later recipient acceptance succeeds', async () => {
  const first = await bootstrap(), orgId = first.workspace.organization.id;
  await admin.query("insert into bc_private.memberships(org_id,user_id,role) values($1,$2,'member')", [orgId, identities.recipient.userId]);
  const transfer = await policy.requestOwnerTransfer('owner', { orgId, expectedRevision: first.serverRevision, transferId: uuid(600), toUserId: identities.recipient.userId });
  const faulty = makePolicy({ transaction: callback => store.transaction(tx => { let writes = 0; return callback({ ...tx, writeMembership: row => ++writes === 2 ? Promise.resolve(false) : tx.writeMembership(row) }); }) });
  await denied(faulty.acceptOwnerTransfer('recipient', { orgId, transferId: uuid(600), expectedRevision: transfer.serverRevision }), 503, 'membership_failed');
  let rows = (await admin.query('select user_id,role from bc_private.memberships where org_id=$1 order by user_id', [orgId])).rows;
  assert.deepEqual(rows.map(row => row.role), ['owner', 'member']); assert.equal(await auditCount(orgId), 2);
  await policy.acceptOwnerTransfer('recipient', { orgId, transferId: uuid(600), expectedRevision: transfer.serverRevision });
  rows = (await admin.query('select user_id,role from bc_private.memberships where org_id=$1 order by user_id', [orgId])).rows;
  assert.deepEqual(rows.map(row => row.role), ['administrator', 'owner']); assert.equal(await auditCount(orgId), 3);
});

test('application session revocation persists and denies access independently of identity evidence', async () => {
  const first = await bootstrap(), orgId = first.workspace.organization.id;
  await store.authTransaction(sessions.owner.handleHash, async tx => { await tx.readAuthSession(sessions.owner.handleHash); assert.equal(await tx.revokeAuthSession(sessions.owner.handleHash, instant), true); });
  await denied(policy.readWorkspace('owner', { orgId }), 401, 'session_inactive');
  const stored = await store.authTransaction(sessions.owner.handleHash, tx => tx.readAuthSession(sessions.owner.handleHash));
  assert.equal(stored.session.revokedAt, instant); assert.equal(await auditCount(orgId), 1);
});
