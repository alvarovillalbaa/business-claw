import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerPolicy } from '../server/policy.mjs';
import { defaultIntent } from '../web/domain.mjs';

const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const initialTime = '2026-10-31T12:00:00.000Z';
const copy = value => structuredClone(value);
const memberKey = (orgId, userId) => `${orgId}/${userId}`;
const denied = (promise, status, code) => assert.rejects(promise, error => error.status === status && error.code === code && error.message === `business_claw_server_${code}`);

function harness() {
  let at = initialTime, sequence = 1000, tokenSequence = 0, queue = Promise.resolve();
  let database = { sessions: new Map(), organizations: new Map(), memberships: new Map(), invites: new Map(), transfers: new Map(), audit: [] };
  const identities = new Map(), faults = {}, submittedAudit = [], mutationChecks = [];
  for (const [index, name] of ['owner', 'administrator', 'member', 'viewer', 'recipient', 'stranger'].entries()) {
    const principal = { userId: uuid(index + 1), email: `${name}@fixture.invalid`, emailConfirmed: true, handleHash: String(index + 1).repeat(64), supabaseSessionId: uuid(100 + index) };
    identities.set(name, principal);
    database.sessions.set(principal.handleHash, { handleHash: principal.handleHash, userId: principal.userId, supabaseSessionId: principal.supabaseSessionId, authenticatedAt: initialTime, expiresAt: '2026-10-31T13:00:00.000Z', revokedAt: null });
  }
  const detached = value => value === undefined ? null : copy(value);
  const cloneDatabase = source => ({ ...Object.fromEntries(['sessions', 'organizations', 'memberships', 'invites', 'transfers'].map(name => [name, new Map([...source[name]].map(([key, value]) => [key, copy(value)]))])), audit: copy(source.audit) });
  const store = {
    transaction(action) {
      const pending = queue.then(async () => {
        const draft = cloneDatabase(database);
        let membershipWrites = 0;
        const tx = {
          readSession: async key => detached(draft.sessions.get(key)),
          readOrganization: async orgId => detached(draft.organizations.get(orgId)),
          findBootstrap: async (userId, requestId) => detached([...draft.organizations.values()].find(row => row.createdBy === userId && row.createRequestId === requestId)),
          insertOrganization: async row => {
            if (draft.organizations.has(row.id) || [...draft.organizations.values()].some(item => item.createdBy === row.createdBy && item.createRequestId === row.createRequestId)) return false;
            draft.organizations.set(row.id, copy(row)); return true;
          },
          writeOrganization: async ({ orgId, expectedRevision, next }) => {
            if (faults.cas || draft.organizations.get(orgId)?.revision !== expectedRevision) return false;
            draft.organizations.set(orgId, copy(next)); return true;
          },
          readMembership: async (orgId, userId) => detached(draft.memberships.get(memberKey(orgId, userId))),
          listMemberships: async orgId => [...draft.memberships.values()].filter(row => row.orgId === orgId).map(copy),
          writeMembership: async row => { membershipWrites++; if (faults.membership || faults.membershipAt === membershipWrites) return false; draft.memberships.set(memberKey(row.orgId, row.userId), copy(row)); return true; },
          readInvite: async inviteId => detached(draft.invites.get(inviteId)),
          insertInvite: async row => { if (draft.invites.has(row.id)) return false; draft.invites.set(row.id, copy(row)); return true; },
          writeInvite: async row => { if (faults.invite) return false; draft.invites.set(row.id, copy(row)); return true; },
          readTransfer: async transferId => detached(draft.transfers.get(transferId)),
          insertTransfer: async row => { if (draft.transfers.has(row.id)) return false; draft.transfers.set(row.id, copy(row)); return true; },
          writeTransfer: async row => { if (faults.transfer) return false; draft.transfers.set(row.id, copy(row)); return true; },
          appendAudit: async row => {
            submittedAudit.push(row);
            if (faults.auditThrow) throw new Error('authored-private-port-message');
            if (faults.audit) return false;
            draft.audit.push(copy(row)); return true;
          },
        };
        const result = await action(tx);
        database = draft;
        return result;
      });
      queue = pending.catch(() => {});
      return pending;
    },
  };
  const ports = {
    identity: {
      verify: async context => detached(identities.get(context)),
      verifyMutation: async (context, proof) => { mutationChecks.push({ context, proof }); return !faults.integrity; },
    },
    store, clock: { now: () => at },
    random: { uuid: () => uuid(sequence++), bytes: size => new Uint8Array(size).fill(++tokenSequence) },
  };
  const api = createServerPolicy(ports);
  return {
    api, ports, identities, faults, submittedAudit, mutationChecks,
    get db() { return database; },
    setTime(value) { at = value; },
    principal: name => identities.get(name),
    session: name => database.sessions.get(identities.get(name).handleHash),
    member: (orgId, name) => database.memberships.get(memberKey(orgId, identities.get(name).userId)),
    seedMember(orgId, name, role) { const userId = identities.get(name).userId; database.memberships.set(memberKey(orgId, userId), { orgId, userId, role, revokedAt: null }); },
    snapshot: () => cloneDatabase(database),
  };
}
async function bootstrap(h, requestId = uuid(200)) {
  const result = await h.api.bootstrap('owner', { requestId, name: 'Authored organization' });
  for (const role of ['administrator', 'member', 'viewer']) h.seedMember(result.workspace.organization.id, role, role);
  h.seedMember(result.workspace.organization.id, 'recipient', 'member');
  return result;
}
const target = (result, extra = {}) => ({ orgId: result.workspace.organization.id, instanceId: result.workspace.instance.id, expectedGeneration: result.workspace.instance.generation, expectedRevision: result.serverRevision, ...extra });
const operationInput = (result, extra = {}) => target(result, { operationId: result.operation.id, planHash: result.operation.planHash, ...extra });
const request = (h, result, extra = {}, context = 'owner') => h.api.requestOperation(context, target(result, { operationId: uuid(300), kind: 'configure', ...extra }));
const orgInput = (result, extra = {}) => ({ orgId: result.orgId ?? result.workspace.organization.id, expectedRevision: result.serverRevision, ...extra });
const invite = (h, result, extra = {}, context = 'owner') => h.api.createInvite(context, orgInput(result, { inviteId: uuid(400), email: h.principal('stranger').email, role: 'member', ...extra }));
function renewSession(h, context, at) {
  h.session(context).authenticatedAt = at;
  h.session(context).expiresAt = new Date(Date.parse(at) + 60 * 60 * 1000).toISOString();
}
const inviteAcceptance = created => ({ inviteId: created.ack.inviteId, token: created.delivery.token });

test('missing trusted ports fail closed and exposed capability ceilings never admit chat or dispatch', async () => {
  const h = harness(); let transactions = 0;
  const observedPorts = { ...h.ports, store: { transaction: action => { transactions++; return h.ports.store.transaction(action); } } };
  for (const name of ['identity', 'store', 'clock', 'random']) assert.throws(() => createServerPolicy({ ...observedPorts, [name]: null }), error => error.status === 503 && error.code === 'ports_unbound');
  createServerPolicy(observedPorts);
  assert.equal(transactions, 0); assert.equal(h.mutationChecks.length, 0); assert.equal(h.db.organizations.size, 0); assert.equal(h.db.audit.length, 0);
  const fabricated = createServerPolicy({ ...h.ports, store: { transaction: async () => ({ ready: true, role: 'owner' }) } });
  await denied(fabricated.bootstrap('owner', { requestId: uuid(200), name: 'Fixture' }), 503, 'transaction_invalid');
  assert.equal(h.db.organizations.size, 0); assert.equal(h.db.audit.length, 0);
  const result = await bootstrap(h);
  assert.deepEqual(result.execution, { adapter: 'unbound', dispatchAllowed: false, chatAdmissionAllowed: false, readiness: 'unproven', ready: false });
  assert.equal(typeof h.api.dispatchOperation, 'undefined'); assert.equal(typeof h.api.admitChat, 'undefined');
  assert.ok(result.capabilities.includes('chat:write')); assert.equal(result.execution.chatAdmissionAllowed, false);
});

test('admission requires a confirmed trusted principal rather than caller identity fields', async () => {
  const h = harness();
  await denied(h.api.bootstrap('unknown', { requestId: uuid(200), name: 'Fixture' }), 401, 'unauthenticated');
  h.principal('owner').emailConfirmed = false;
  await denied(h.api.bootstrap('owner', { requestId: uuid(200), name: 'Fixture' }), 401, 'email_unconfirmed');
  h.principal('owner').emailConfirmed = true;
  await denied(h.api.bootstrap('owner', { requestId: uuid(200), name: 'Fixture', actorId: h.principal('stranger').userId }), 400, 'field_invalid');
  assert.equal(h.db.organizations.size, 0); assert.equal(h.db.audit.length, 0);
});

test('application sessions must match the verified handle subject and provider session independently', async () => {
  for (const field of ['handleHash', 'userId', 'supabaseSessionId']) {
    const h = harness(), session = h.session('owner');
    session[field] = field === 'handleHash' ? 'f'.repeat(64) : uuid(900);
    await denied(h.api.bootstrap('owner', { requestId: uuid(200), name: 'Fixture' }), 401, 'session_binding');
    assert.equal(h.db.organizations.size, 0);
  }
  const h = harness(); h.principal('owner').userId = uuid(901);
  await denied(h.api.bootstrap('owner', { requestId: uuid(200), name: 'Fixture' }), 401, 'session_binding');
});

test('revoked expired future-authenticated and overlong application sessions deny admission', async () => {
  for (const change of [session => { session.revokedAt = initialTime; }, session => { session.expiresAt = initialTime; }, session => { session.authenticatedAt = '2026-10-31T12:00:00.001Z'; }, session => { session.expiresAt = '2026-10-31T20:00:00.001Z'; }]) {
    const h = harness(); change(h.session('owner'));
    await denied(h.api.bootstrap('owner', { requestId: uuid(200), name: 'Fixture' }), 401, 'session_inactive');
    assert.equal(h.db.organizations.size, 0);
  }
});

test('mutation integrity is checked with the verified handle while admitted reads remain available', async () => {
  const h = harness(), result = await bootstrap(h); h.faults.integrity = true;
  const read = await h.api.readWorkspace('owner', { orgId: result.workspace.organization.id });
  assert.equal(read.role, 'owner');
  await denied(request(h, result), 403, 'request_integrity');
  assert.equal(h.mutationChecks.at(-1).proof.handleHash, h.principal('owner').handleHash);
  assert.equal(h.db.audit.length, 1);
});

test('active organization and current membership rows are re-read after revocation and role changes', async () => {
  const h = harness(), result = await bootstrap(h), orgId = result.workspace.organization.id;
  assert.equal((await h.api.readWorkspace('administrator', { orgId })).role, 'administrator');
  h.member(orgId, 'administrator').role = 'viewer';
  assert.equal((await h.api.readWorkspace('administrator', { orgId })).role, 'viewer');
  await denied(request(h, result, {}, 'administrator'), 403, 'forbidden');
  h.member(orgId, 'viewer').revokedAt = initialTime;
  await denied(h.api.readWorkspace('viewer', { orgId }), 404, 'not_found');
  h.db.organizations.get(orgId).state = 'deleting';
  await denied(h.api.readWorkspace('owner', { orgId }), 404, 'not_found');
});

test('the role and operation-kind matrix denies member viewer and administrator retirement paths', async () => {
  for (const context of ['owner', 'administrator', 'member', 'viewer']) {
    const h = harness(); let current = await bootstrap(h);
    for (const [index, kind] of ['provision', 'configure', 'pause', 'resume', 'delete'].entries()) {
      const action = request(h, current, { operationId: uuid(310 + index), kind }, context);
      const permitted = context === 'owner' || context === 'administrator' && ['configure', 'pause', 'resume'].includes(kind);
      if (permitted) { current = await action; assert.equal(current.operation.kind, kind); }
      else await denied(action, 403, 'forbidden');
    }
  }
  const h = harness(), initial = await bootstrap(h), provision = await request(h, initial, { kind: 'provision' });
  await denied(h.api.reviewOperation('administrator', operationInput(provision, { decision: 'reviewed' })), 403, 'forbidden');
});

test('foreign organization instance and operation identifiers return no cross-organization workspace', async () => {
  const h = harness(), result = await bootstrap(h), before = h.snapshot();
  await denied(h.api.readWorkspace('stranger', { orgId: result.workspace.organization.id }), 404, 'not_found');
  await denied(h.api.readWorkspace('owner', { orgId: uuid(999) }), 404, 'not_found');
  await denied(request(h, result, { instanceId: uuid(999) }), 404, 'not_found');
  await denied(h.api.reviewOperation('owner', target(result, { operationId: uuid(999), planHash: 'a'.repeat(64), decision: 'reviewed' })), 404, 'not_found');
  const foreign = await h.api.bootstrap('stranger', { requestId: uuid(201), name: 'Other authored organization' });
  await denied(h.api.readWorkspace('owner', { orgId: foreign.workspace.organization.id }), 404, 'not_found');
  assert.deepEqual(h.db.organizations.get(result.workspace.organization.id), before.organizations.get(result.workspace.organization.id));
});

test('provision and delete require Owner authentication within five minutes including the exact boundary', async () => {
  for (const kind of ['provision', 'delete']) {
    const h = harness(), initial = await bootstrap(h); h.setTime('2026-10-31T12:05:00.000Z');
    const allowed = await request(h, initial, { kind }); assert.equal(allowed.operation.kind, kind);
    h.setTime('2026-10-31T12:05:00.001Z');
    await denied(h.api.reviewOperation('owner', operationInput(allowed, { decision: 'reviewed' })), 401, 'fresh_auth_required');
  }
  const h = harness(), initial = await bootstrap(h); h.setTime('2026-10-31T12:06:00.000Z');
  assert.equal((await request(h, initial)).operation.kind, 'configure');
});

test('bootstrap generates authoritative organization instance and Owner actor records in one audit', async () => {
  const h = harness(), result = await bootstrap(h), orgId = result.workspace.organization.id;
  assert.notEqual(orgId, result.workspace.instance.id); assert.equal(h.db.organizations.get(orgId).createdBy, h.principal('owner').userId);
  assert.equal(h.member(orgId, 'owner').role, 'owner'); assert.equal(h.db.audit.length, 1);
  assert.equal(h.db.audit[0].actorId, h.principal('owner').userId); assert.equal(h.db.audit[0].sessionId, h.principal('owner').supabaseSessionId);
  const before = h.snapshot();
  for (const extra of [{ orgId: uuid(900) }, { role: 'owner' }, { workspace: result.workspace }]) await denied(h.api.bootstrap('owner', { requestId: uuid(202), name: 'Other', ...extra }), 400, 'field_invalid');
  assert.deepEqual(h.snapshot(), before);
});

test('stable bootstrap retries recover only the same principal request and name without another audit', async () => {
  const h = harness(), first = await bootstrap(h), before = h.snapshot();
  const replay = await h.api.bootstrap('owner', { requestId: uuid(200), name: 'Authored organization' });
  assert.equal(replay.replayed, true); assert.equal(replay.workspace.organization.id, first.workspace.organization.id);
  assert.deepEqual(h.snapshot(), before);
  await denied(h.api.bootstrap('owner', { requestId: uuid(200), name: 'Conflicting name' }), 409, 'request_conflict');
});

test('bootstrap replay cannot restore a revoked first Owner membership', async () => {
  const h = harness(), result = await bootstrap(h), orgId = result.workspace.organization.id;
  h.member(orgId, 'owner').revokedAt = initialTime; const before = h.snapshot();
  await denied(h.api.bootstrap('owner', { requestId: uuid(200), name: 'Authored organization' }), 404, 'not_found');
  assert.deepEqual(h.snapshot(), before); assert.equal(h.member(orgId, 'owner').revokedAt, initialTime);
});

test('request self-review and separate confirmation retain one immutable plan hash across current CAS values', async () => {
  const h = harness(), initial = await bootstrap(h), requested = await request(h, initial);
  const reviewed = await h.api.reviewOperation('owner', operationInput(requested, { decision: 'reviewed' }));
  const confirmed = await h.api.confirmOperation('owner', operationInput(reviewed));
  assert.equal(requested.operation.planHash, reviewed.operation.planHash); assert.equal(reviewed.operation.planHash, confirmed.operation.planHash);
  assert.equal(requested.serverRevision, 1); assert.equal(reviewed.serverRevision, 2); assert.equal(confirmed.serverRevision, 3);
  assert.equal(confirmed.workspace.operations[0].review.actorId, h.principal('owner').userId);
  assert.equal(confirmed.workspace.operations[0].confirmation.actorId, h.principal('owner').userId);
  assert.equal(h.db.audit.at(-1).metadata.planHash, requested.operation.planHash);
  assert.equal(confirmed.execution.dispatchAllowed, false);
});

test('stale server revisions generations and changed review hashes cannot mutate a current plan', async () => {
  const h = harness(), initial = await bootstrap(h), requested = await request(h, initial), before = h.snapshot();
  await denied(h.api.reviewOperation('owner', operationInput(requested, { expectedRevision: initial.serverRevision, decision: 'reviewed' })), 409, 'revision_conflict');
  await denied(h.api.reviewOperation('owner', operationInput(requested, { expectedGeneration: 2, decision: 'reviewed' })), 409, 'generation_conflict');
  await denied(h.api.reviewOperation('owner', operationInput(requested, { planHash: 'b'.repeat(64), decision: 'reviewed' })), 409, 'plan_conflict');
  assert.deepEqual(h.snapshot(), before);
});

test('exact operation and terminal retries require current CAS and do not create duplicate audit records', async () => {
  const h = harness(), initial = await bootstrap(h); let current = await request(h, initial);
  const requestReplay = await request(h, current); assert.equal(requestReplay.replayed, true); assert.equal(h.db.audit.length, 2);
  await denied(request(h, current, { kind: 'pause' }), 409, 'domain_conflict');
  current = await h.api.reviewOperation('owner', operationInput(current, { decision: 'reviewed' }));
  assert.equal((await h.api.reviewOperation('owner', operationInput(current, { decision: 'reviewed' }))).replayed, true);
  current = await h.api.confirmOperation('owner', operationInput(current));
  assert.equal((await h.api.confirmOperation('owner', operationInput(current))).replayed, true);
  current = await h.api.cancelOperation('owner', operationInput(current));
  assert.equal((await h.api.cancelOperation('owner', operationInput(current))).replayed, true);
  assert.equal(h.db.audit.length, 5); assert.equal(current.serverRevision, 4);
});

test('intent changes supersede active reviewed plans and identical intent saves add no audit', async () => {
  const h = harness(), initial = await bootstrap(h), requested = await request(h, initial);
  const reviewed = await h.api.reviewOperation('owner', operationInput(requested, { decision: 'reviewed' }));
  const changed = await h.api.updateIntent('owner', target(reviewed, { intent: { ...defaultIntent, purpose: 'A changed authored purpose' } }));
  assert.equal(changed.workspace.operations[0].state, 'superseded');
  await denied(h.api.confirmOperation('owner', operationInput(reviewed, { expectedRevision: changed.serverRevision })), 409, 'domain_conflict');
  const before = h.snapshot(), replay = await h.api.updateIntent('owner', target(changed, { intent: changed.workspace.instance.desiredSetup }));
  assert.equal(replay.replayed, true); assert.deepEqual(h.snapshot(), before);
});

test('CAS refusal and audit failure roll back the domain mutation and its server revision together', async () => {
  for (const failureMode of ['cas', 'audit', 'auditThrow']) {
    const h = harness(), initial = await bootstrap(h), before = h.snapshot(); h.faults[failureMode] = true;
    await denied(request(h, initial), failureMode === 'cas' ? 409 : 503, failureMode === 'cas' ? 'revision_conflict' : failureMode === 'audit' ? 'audit_failed' : 'port_failed');
    assert.deepEqual(h.snapshot(), before);
  }
  for (const failureMode of ['membership', 'audit', 'auditThrow']) {
    const h = harness(), before = h.snapshot(); h.faults[failureMode] = true;
    await denied(h.api.bootstrap('owner', { requestId: uuid(200), name: 'Fixture' }), failureMode === 'membership' ? 409 : 503, failureMode === 'membership' ? 'request_conflict' : failureMode === 'audit' ? 'audit_failed' : 'port_failed');
    assert.deepEqual(h.snapshot(), before);
    assert.equal(h.db.organizations.size, 0); assert.equal(h.db.memberships.size, 0); assert.equal(h.db.audit.length, 0);
  }
});

test('independent serialized transactions permit one concurrent CAS winner and retain exactly one mutation audit', async () => {
  const h = harness(), initial = await bootstrap(h);
  const outcomes = await Promise.allSettled([request(h, initial, { operationId: uuid(301) }), request(h, initial, { operationId: uuid(302) })]);
  assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1);
  const rejected = outcomes.find(value => value.status === 'rejected'); assert.equal(rejected.reason.status, 409); assert.equal(rejected.reason.code, 'revision_conflict');
  const current = await h.api.readWorkspace('owner', { orgId: initial.workspace.organization.id });
  assert.equal(current.serverRevision, 1); assert.equal(current.workspace.operations.length, 1); assert.equal(h.db.audit.length, 2);
});

test('public records and submitted audits are frozen detached data with server-only actor and minimal metadata', async () => {
  const h = harness(), initial = await bootstrap(h), result = await request(h, initial);
  for (const value of [result, result.workspace, result.workspace.instance, result.operation, result.capabilities, result.execution, h.submittedAudit.at(-1), h.submittedAudit.at(-1).metadata]) assert.equal(Object.isFrozen(value), true);
  assert.throws(() => { result.workspace.organization.name = 'Mutated'; }, TypeError);
  assert.notEqual(result.workspace, h.db.organizations.get(result.workspace.organization.id).workspace);
  const audit = h.db.audit.at(-1); assert.equal(audit.actorId, h.principal('owner').userId);
  assert.ok(!JSON.stringify(audit).includes('Authored organization')); assert.ok(!JSON.stringify(audit).includes(h.principal('owner').email));
  const read = await h.api.readWorkspace('viewer', { orgId: result.workspace.organization.id });
  assert.equal(read.role, 'viewer'); assert.equal(read.execution.chatAdmissionAllowed, false);
});

test('strict caller records reject authority extras prototypes accessors and malformed targets without getter reads', async () => {
  const h = harness(), initial = await bootstrap(h), before = h.snapshot();
  for (const extra of [{ actorId: uuid(900) }, { role: 'owner' }, { resourceUrl: 'https://fixture.invalid' }, { workspace: initial.workspace }]) await denied(request(h, initial, extra), 400, 'field_invalid');
  await denied(request(h, initial, { operationId: 'foreign-input' }), 400, 'identity_invalid');
  const inherited = Object.create(target(initial, { operationId: uuid(300), kind: 'configure' }));
  await denied(h.api.requestOperation('owner', inherited), 400, 'record_invalid');
  let reads = 0; const accessor = target(initial, { operationId: uuid(300), kind: 'configure' });
  Object.defineProperty(accessor, 'kind', { enumerable: true, get() { reads++; return 'configure'; } });
  await denied(h.api.requestOperation('owner', accessor), 400, 'field_invalid');
  assert.equal(reads, 0); assert.deepEqual(h.snapshot(), before);
});

test('invitation plaintext appears only in its first private unbound delivery envelope and never the store or audit', async () => {
  const h = harness(), initial = await bootstrap(h), created = await invite(h, initial);
  assert.equal(created.delivery.delivery, 'unbound'); assert.match(created.delivery.token, /^[a-f0-9]{64}$/);
  const row = h.db.invites.get(created.ack.inviteId);
  assert.match(row.tokenHash, /^[a-f0-9]{64}$/); assert.notEqual(row.tokenHash, created.delivery.token);
  assert.ok(!JSON.stringify(row).includes(created.delivery.token)); assert.ok(!JSON.stringify(h.db.audit).includes(created.delivery.token));
  assert.ok(!JSON.stringify(created.ack).includes(created.delivery.token)); assert.ok(!JSON.stringify(h.db.audit).includes(h.principal('stranger').email));
  const before = h.snapshot(), replay = await invite(h, created.ack);
  assert.equal(replay.ack.replayed, true); assert.equal(replay.delivery, null); assert.deepEqual(h.snapshot(), before);
  assert.equal(Object.isFrozen(created.delivery), true); assert.equal(Object.isFrozen(created.ack), true);
});

test('only a current Owner may invite or alter membership and no direct path can grant Owner', async () => {
  const h = harness(), initial = await bootstrap(h);
  for (const context of ['administrator', 'member', 'viewer']) {
    await denied(invite(h, initial, {}, context), 403, 'forbidden');
    await denied(h.api.changeMemberRole(context, orgInput(initial, { userId: h.principal('recipient').userId, role: 'viewer' })), 403, 'forbidden');
  }
  await denied(invite(h, initial, { role: 'owner' }), 400, 'field_invalid');
  await denied(h.api.changeMemberRole('owner', orgInput(initial, { userId: h.principal('recipient').userId, role: 'owner' })), 400, 'field_invalid');
  assert.equal(h.db.invites.size, 0); assert.equal(h.db.audit.length, 1);
});

test('invite acceptance binds the exact token and confirmed recipient email before any membership write', async () => {
  const h = harness(), initial = await bootstrap(h), created = await invite(h, initial), before = h.snapshot();
  await denied(h.api.acceptInvite('recipient', inviteAcceptance(created)), 404, 'not_found');
  await denied(h.api.acceptInvite('stranger', { inviteId: created.ack.inviteId, token: 'f'.repeat(64) }), 404, 'not_found');
  h.principal('stranger').emailConfirmed = false;
  await denied(h.api.acceptInvite('stranger', inviteAcceptance(created)), 401, 'email_unconfirmed');
  assert.deepEqual(h.snapshot(), before); assert.equal(h.member(initial.workspace.organization.id, 'stranger'), undefined);
});

test('expired revoked and inactive-issuer invitations cannot admit a recipient', async () => {
  for (const mode of ['expired', 'revoked', 'issuer-revoked', 'issuer-demoted']) {
    const h = harness(), initial = await bootstrap(h), created = await invite(h, initial), orgId = initial.workspace.organization.id;
    let status = 409, code = 'invite_inactive';
    if (mode === 'expired') { const at = created.ack.expiresAt; h.setTime(at); renewSession(h, 'stranger', at); }
    if (mode === 'revoked') await h.api.revokeInvite('owner', orgInput(created.ack, { inviteId: created.ack.inviteId }));
    if (mode === 'issuer-revoked') { h.member(orgId, 'owner').revokedAt = initialTime; status = 404; code = 'not_found'; }
    if (mode === 'issuer-demoted') { h.member(orgId, 'owner').role = 'administrator'; status = 403; code = 'forbidden'; }
    const before = h.snapshot();
    await denied(h.api.acceptInvite('stranger', inviteAcceptance(created)), status, code);
    assert.deepEqual(h.snapshot(), before); assert.equal(h.member(orgId, 'stranger'), undefined);
  }
});

test('a matching invite creates only its specified organization role and returns an idempotent acknowledgment', async () => {
  const h = harness(), initial = await bootstrap(h), created = await invite(h, initial, { role: 'viewer' });
  const accepted = await h.api.acceptInvite('stranger', inviteAcceptance(created)), orgId = initial.workspace.organization.id;
  assert.equal(accepted.state, 'accepted'); assert.equal(accepted.acceptedBy, h.principal('stranger').userId); assert.equal(accepted.role, 'viewer');
  assert.deepEqual(h.member(orgId, 'stranger'), { orgId, userId: h.principal('stranger').userId, role: 'viewer', revokedAt: null });
  assert.equal(accepted.workspace, undefined); assert.equal(accepted.capabilities, undefined); assert.equal(accepted.token, undefined);
  const before = h.snapshot(), replay = await h.api.acceptInvite('stranger', inviteAcceptance(created));
  assert.equal(replay.replayed, true); assert.equal(replay.serverRevision, accepted.serverRevision); assert.deepEqual(h.snapshot(), before);
});

test('accepted token replay cannot restore revocation and re-admission needs a strictly newer invite', async () => {
  const h = harness(), initial = await bootstrap(h), created = await invite(h, initial);
  const accepted = await h.api.acceptInvite('stranger', inviteAcceptance(created));
  const revoked = await h.api.revokeMember('owner', orgInput(accepted, { userId: h.principal('stranger').userId }));
  const before = h.snapshot(), replay = await h.api.acceptInvite('stranger', inviteAcceptance(created));
  assert.equal(replay.replayed, true); assert.equal(replay.serverRevision, accepted.serverRevision);
  assert.deepEqual(h.snapshot(), before); assert.equal(h.member(initial.workspace.organization.id, 'stranger').revokedAt, initialTime);
  const sameTime = await invite(h, revoked, { inviteId: uuid(401) });
  await denied(h.api.acceptInvite('stranger', inviteAcceptance(sameTime)), 409, 'invite_predates_revocation');
  h.setTime('2026-10-31T12:00:00.001Z');
  const newer = await invite(h, sameTime.ack, { inviteId: uuid(402) });
  const readmitted = await h.api.acceptInvite('stranger', inviteAcceptance(newer));
  assert.equal(readmitted.replayed, false); assert.equal(h.member(initial.workspace.organization.id, 'stranger').revokedAt, null);
});

test('invite acceptance cannot overwrite an active role and explicit role changes or revocation affect the next request', async () => {
  const h = harness(), initial = await bootstrap(h), orgId = initial.workspace.organization.id;
  const created = await invite(h, initial, { email: h.principal('recipient').email, role: 'viewer' });
  await denied(h.api.acceptInvite('recipient', inviteAcceptance(created)), 409, 'membership_conflict');
  const changed = await h.api.changeMemberRole('owner', orgInput(created.ack, { userId: h.principal('recipient').userId, role: 'viewer' }));
  assert.equal((await h.api.readWorkspace('recipient', { orgId })).role, 'viewer');
  const revoked = await h.api.revokeMember('owner', orgInput(changed, { userId: h.principal('recipient').userId }));
  assert.equal(revoked.revokedAt, initialTime); await denied(h.api.readWorkspace('recipient', { orgId }), 404, 'not_found');
});

test('the last active Owner cannot be demoted or revoked while removing an additional Owner is permitted', async () => {
  const h = harness(), initial = await bootstrap(h), orgId = initial.workspace.organization.id, before = h.snapshot();
  await denied(h.api.changeMemberRole('owner', orgInput(initial, { userId: h.principal('owner').userId, role: 'administrator' })), 409, 'last_owner');
  await denied(h.api.revokeMember('owner', orgInput(initial, { userId: h.principal('owner').userId })), 409, 'last_owner');
  assert.deepEqual(h.snapshot(), before);
  h.seedMember(orgId, 'recipient', 'owner');
  const changed = await h.api.revokeMember('owner', orgInput(initial, { userId: h.principal('recipient').userId }));
  assert.equal(changed.revokedAt, initialTime); assert.equal(h.member(orgId, 'owner').role, 'owner');
});

test('Owner transfer changes both roles only on exact recipient acceptance and replay adds no audit', async () => {
  const h = harness(), initial = await bootstrap(h), orgId = initial.workspace.organization.id;
  const requested = await h.api.requestOwnerTransfer('owner', orgInput(initial, { transferId: uuid(500), toUserId: h.principal('recipient').userId }));
  assert.equal(h.member(orgId, 'owner').role, 'owner'); assert.equal(h.member(orgId, 'recipient').role, 'member');
  assert.equal(h.db.transfers.get(uuid(500)).fromSessionHash, h.principal('owner').handleHash);
  const accepted = await h.api.acceptOwnerTransfer('recipient', orgInput(requested, { transferId: uuid(500) }));
  assert.equal(h.member(orgId, 'owner').role, 'administrator'); assert.equal(h.member(orgId, 'recipient').role, 'owner');
  assert.equal(accepted.serverRevision, 2); assert.equal(accepted.acceptedAt, initialTime);
  const before = h.snapshot(), replay = await h.api.acceptOwnerTransfer('recipient', orgInput(accepted, { transferId: uuid(500) }));
  assert.equal(replay.replayed, true); assert.deepEqual(h.snapshot(), before);
});

test('Owner transfer rechecks recipient issuer role issuer session and five-minute authentication freshness', async () => {
  for (const mode of ['wrong-recipient', 'recipient-revoked', 'issuer-demoted', 'issuer-revoked-session', 'issuer-session-changed', 'issuer-reauthenticated', 'expired']) {
    const h = harness(), initial = await bootstrap(h), orgId = initial.workspace.organization.id;
    const pending = await h.api.requestOwnerTransfer('owner', orgInput(initial, { transferId: uuid(500), toUserId: h.principal('recipient').userId }));
    let context = 'recipient', status = 401, code = 'session_inactive';
    if (mode === 'wrong-recipient') { context = 'member'; status = 404; code = 'not_found'; }
    if (mode === 'recipient-revoked') { h.member(orgId, 'recipient').revokedAt = initialTime; status = 404; code = 'not_found'; }
    if (mode === 'issuer-demoted') { h.member(orgId, 'owner').role = 'administrator'; status = 403; code = 'forbidden'; }
    if (mode === 'issuer-revoked-session') h.session('owner').revokedAt = initialTime;
    if (mode === 'issuer-session-changed') { h.session('owner').supabaseSessionId = uuid(900); code = 'session_binding'; }
    if (mode === 'issuer-reauthenticated') { h.setTime('2026-10-31T12:00:00.001Z'); renewSession(h, 'owner', '2026-10-31T12:00:00.001Z'); status = 409; code = 'transfer_inactive'; }
    if (mode === 'expired') { h.setTime('2026-10-31T12:05:00.001Z'); code = 'fresh_auth_required'; }
    const before = h.snapshot();
    await denied(h.api.acceptOwnerTransfer(context, orgInput(pending, { transferId: uuid(500) })), status, code);
    assert.deepEqual(h.snapshot(), before);
  }
  const h = harness(), initial = await bootstrap(h); h.setTime('2026-10-31T12:05:00.001Z');
  await denied(h.api.requestOwnerTransfer('owner', orgInput(initial, { transferId: uuid(500), toUserId: h.principal('recipient').userId })), 401, 'fresh_auth_required');
});

test('membership invitation and two-role transfer effects roll back atomically when a later write or audit fails', async () => {
  const invited = harness(), initial = await bootstrap(invited), invitation = await invite(invited, initial), beforeInvite = invited.snapshot();
  invited.faults.invite = true;
  await denied(invited.api.acceptInvite('stranger', inviteAcceptance(invitation)), 503, 'invite_failed');
  assert.deepEqual(invited.snapshot(), beforeInvite);
  for (const mode of ['second-member', 'transfer', 'audit']) {
    const h = harness(), initial = await bootstrap(h);
    const pending = await h.api.requestOwnerTransfer('owner', orgInput(initial, { transferId: uuid(500), toUserId: h.principal('recipient').userId }));
    const before = h.snapshot(); if (mode === 'second-member') h.faults.membershipAt = 2; else h.faults[mode] = true;
    await denied(h.api.acceptOwnerTransfer('recipient', orgInput(pending, { transferId: uuid(500) })), 503, mode === 'second-member' ? 'membership_failed' : mode === 'transfer' ? 'transfer_failed' : 'audit_failed');
    assert.deepEqual(h.snapshot(), before);
  }
});

test('membership bodies retain current CAS exact foreign-target fences and acknowledgment-only responses', async () => {
  const h = harness(), initial = await bootstrap(h), created = await invite(h, initial);
  await denied(h.api.revokeInvite('owner', orgInput(initial, { inviteId: created.ack.inviteId })), 409, 'revision_conflict');
  await denied(h.api.changeMemberRole('owner', orgInput(created.ack, { userId: uuid(900), role: 'member' })), 404, 'not_found');
  await denied(h.api.revokeInvite('owner', orgInput(created.ack, { inviteId: created.ack.inviteId, actorId: uuid(900) })), 400, 'field_invalid');
  const foreign = await h.api.bootstrap('stranger', { requestId: uuid(201), name: 'Other authored organization' });
  await denied(h.api.revokeInvite('stranger', orgInput(foreign, { inviteId: created.ack.inviteId })), 404, 'not_found');
  const revoked = await h.api.revokeInvite('owner', orgInput(created.ack, { inviteId: created.ack.inviteId }));
  assert.equal(Object.isFrozen(revoked), true); assert.equal(revoked.state, 'revoked');
  assert.equal(revoked.workspace, undefined); assert.equal(revoked.capabilities, undefined); assert.equal(revoked.token, undefined);
});
