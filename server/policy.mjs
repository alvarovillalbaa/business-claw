import {
  createWorkspace, normalizeWorkspace, updateIntent as domainIntent, requestOperation as domainRequest,
  reviewOperation as domainReview, confirmOperation as domainConfirm, cancelOperation as domainCancel,
} from '../web/domain.mjs';
import { capabilitiesFor, currentSession, freshAuthentication, activeMembership, requireCapability, requireKind, sessionRow, verifiedPrincipal } from './access.mjs';
import { call, choice, digest, fail, freeze, hash, id, PolicyError, port, record, revision, text, time } from './data.mjs';
import { createMembershipMethods } from './membership.mjs';

const disabled = Object.freeze({ adapter: 'unbound', dispatchAllowed: false, chatAdmissionAllowed: false, readiness: 'unproven', ready: false });

function organizationRow(value) {
  if (value === null) fail(404, 'not_found');
  const input = record(value, ['id', 'state', 'revision', 'createdBy', 'createRequestId', 'requestHash', 'createdAt', 'updatedAt', 'workspace']);
  const workspace = normalizeWorkspace(input.workspace);
  const row = { id: id(input.id), state: choice(input.state, ['active', 'deleting', 'deleted']), revision: revision(input.revision),
    createdBy: id(input.createdBy), createRequestId: id(input.createRequestId), requestHash: digest(input.requestHash),
    createdAt: time(input.createdAt), updatedAt: time(input.updatedAt), workspace };
  if (row.id !== workspace.organization.id || row.createdAt !== workspace.createdAt || workspace.updatedAt > row.updatedAt || row.updatedAt < row.createdAt || workspace.revision > row.revision) fail(503, 'store_invalid');
  return freeze(row);
}

export function createServerPolicy(ports) {
  for (const [owner, name] of [[ports?.identity, 'verify'], [ports?.identity, 'verifyMutation'], [ports?.store, 'transaction'], [ports?.clock, 'now'], [ports?.random, 'uuid'], [ports?.random, 'bytes']]) port(owner, name);
  const now = () => time(call(ports.clock, 'now'));
  const newId = () => id(call(ports.random, 'uuid'));
  const newToken = () => {
    const bytes = call(ports.random, 'bytes', 32);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 32) fail(503, 'random_invalid');
    const token = Buffer.from(bytes).toString('hex'); return freeze({ token, tokenHash: hash(token) });
  };
  async function run(context, mutation, action) {
    try {
      const principal = await verifiedPrincipal(ports.identity, context, mutation);
      let entered = false, completed = false, outcome;
      await call(ports.store, 'transaction', async tx => {
        if (entered) fail(503, 'transaction_invalid'); entered = true;
        const session = sessionRow(await call(tx, 'readSession', principal.handleHash));
        currentSession(principal, session, now());
        outcome = await action(tx, freeze({ principal, session })); completed = true; return outcome;
      });
      if (!completed || !outcome || typeof outcome !== 'object') fail(503, 'transaction_invalid');
      return outcome;
    } catch (error) {
      if (error instanceof PolicyError) throw error;
      if (error instanceof TypeError && /^business_claw_[a-z_]+$/.test(error.message)) {
        const conflict = /conflict|stale|transition|limit_exceeded/.test(error.message);
        fail(conflict ? 409 : 400, conflict ? 'domain_conflict' : 'domain_input_invalid');
      }
      fail(503, 'port_failed');
    }
  }
  function live(auth, org = null) {
    const at = now(); currentSession(auth.principal, auth.session, at);
    if (org && (org.state !== 'active' || org.updatedAt > at)) fail(org.state !== 'active' ? 404 : 409, org.state !== 'active' ? 'not_found' : 'clock_conflict');
    return at;
  }
  async function loadOrganization(tx, auth, orgId, requireMember = true) {
    const org = organizationRow(await call(tx, 'readOrganization', id(orgId)));
    if (org.id !== orgId) fail(404, 'not_found');
    live(auth, org);
    const membership = requireMember ? activeMembership(await call(tx, 'readMembership', org.id, auth.principal.userId), org.id, auth.principal.userId) : null;
    live(auth, org); return { org, membership };
  }
  function expected(org, input, instance = false) {
    if (revision(input.expectedRevision) !== org.revision) fail(409, 'revision_conflict');
    if (instance) {
      if (id(input.instanceId) !== org.workspace.instance.id) fail(404, 'not_found');
      if (revision(input.expectedGeneration, 1) !== org.workspace.instance.generation) fail(409, 'generation_conflict');
    }
  }
  async function audit(tx, auth, orgId, action, metadata, at) {
    const row = freeze({ id: newId(), orgId, actorId: auth.principal.userId, sessionId: auth.principal.supabaseSessionId, action, at,
      metadata: { ...metadata, appSessionHash: auth.principal.handleHash } });
    if (await call(tx, 'appendAudit', row) !== true) fail(503, 'audit_failed');
  }
  async function commit(tx, auth, org, action, metadata, { workspace = org.workspace, effect = async () => {} } = {}) {
    const at = live(auth, org);
    if (org.revision === 1_000_000) fail(409, 'revision_limit');
    const next = freeze({ ...org, revision: org.revision + 1, updatedAt: at, workspace });
    if (await call(tx, 'writeOrganization', freeze({ orgId: org.id, expectedRevision: org.revision, next })) !== true) fail(409, 'revision_conflict');
    await effect();
    await audit(tx, auth, org.id, action, { ...metadata, serverRevision: next.revision }, at);
    return next;
  }
  function publicWorkspace(org, membership) {
    return freeze({ serverRevision: org.revision, organizationState: org.state, role: membership.role, capabilities: [...capabilitiesFor(membership.role)], workspace: org.workspace,
      operationPreviews: org.workspace.operations.map(operation => ({ operationId: operation.id, kind: operation.kind, state: operation.state, planHash: planHash(operation) })), execution: disabled });
  }
  const guard = (org, at) => ({ expectedRevision: org.workspace.revision, expectedGeneration: org.workspace.instance.generation, now: at });
  function planHash(operation) {
    return hash({ schemaVersion: 'business-claw.review-plan.v1', orgId: operation.orgId, instanceId: operation.instanceId, generation: operation.generation,
      operationId: operation.id, kind: operation.kind, requesterId: operation.actorId, plan: operation.plan });
  }
  function operationResult(org, membership, operationId, replayed) {
    const operation = org.workspace.operations.find(item => item.id === operationId);
    if (!operation) fail(404, 'not_found');
    return freeze({ ...publicWorkspace(org, membership), operation: { id: operation.id, kind: operation.kind, state: operation.state, planHash: planHash(operation) }, replayed });
  }
  async function operationChange(context, value, action) {
    return run(context, true, async (tx, auth) => {
      const fields = ['orgId', 'instanceId', 'expectedGeneration', 'expectedRevision', 'operationId'];
      const input = record(value, action === 'request' ? [...fields, 'kind'] : action === 'review' ? [...fields, 'planHash', 'decision'] : [...fields, 'planHash']);
      const { org, membership } = await loadOrganization(tx, auth, id(input.orgId)); expected(org, input, true);
      requireCapability(membership, `operation:${action}`); const operationId = id(input.operationId);
      const old = org.workspace.operations.find(item => item.id === operationId);
      const kind = action === 'request' ? choice(input.kind, ['provision', 'configure', 'pause', 'resume', 'delete']) : old?.kind;
      if (!kind) fail(404, 'not_found'); requireKind(membership, kind);
      const at = live(auth, org); if (['provision', 'delete'].includes(kind)) freshAuthentication(auth.session, at);
      if (action !== 'request' && digest(input.planHash) !== planHash(old)) fail(409, 'plan_conflict');
      const actor = { actorId: auth.principal.userId }, snapshotGuard = guard(org, at);
      const workspace = action === 'request' ? domainRequest(org.workspace, { id: operationId, kind, ...actor }, snapshotGuard)
        : action === 'review' ? domainReview(org.workspace, operationId, { decision: choice(input.decision, ['reviewed', 'rejected']), ...actor }, snapshotGuard)
        : action === 'confirm' ? domainConfirm(org.workspace, operationId, actor, snapshotGuard)
        : domainCancel(org.workspace, operationId, actor, snapshotGuard);
      const replayed = JSON.stringify(workspace) === JSON.stringify(org.workspace);
      const changed = workspace.operations.find(item => item.id === operationId);
      const next = replayed ? org : await commit(tx, auth, org, `operation.${action}`, { operationId, kind, planHash: planHash(changed), state: changed.state }, { workspace });
      return operationResult(next, membership, operationId, replayed);
    });
  }
  const methods = {
    bootstrap(context, value) {
      return run(context, true, async (tx, auth) => {
        const input = record(value, ['requestId', 'name']), requestId = id(input.requestId), name = text(input.name, 80);
        const requestHash = hash({ userId: auth.principal.userId, requestId, name });
        const existing = await call(tx, 'findBootstrap', auth.principal.userId, requestId);
        if (existing !== null) {
          const org = organizationRow(existing);
          if (org.createdBy !== auth.principal.userId || org.createRequestId !== requestId || org.requestHash !== requestHash) fail(409, 'request_conflict');
          const current = await loadOrganization(tx, auth, org.id);
          return freeze({ ...publicWorkspace(current.org, current.membership), replayed: true });
        }
        const at = live(auth), orgId = newId(), instanceId = newId();
        if (orgId === instanceId) fail(503, 'random_invalid');
        const workspace = createWorkspace({ orgId, instanceId, name, now: at });
        const org = freeze({ id: orgId, state: 'active', revision: 0, createdBy: auth.principal.userId, createRequestId: requestId, requestHash, createdAt: at, updatedAt: at, workspace });
        const membership = freeze({ orgId, userId: auth.principal.userId, role: 'owner', revokedAt: null });
        if (await call(tx, 'insertOrganization', org) !== true || await call(tx, 'writeMembership', membership) !== true) fail(409, 'request_conflict');
        await audit(tx, auth, orgId, 'organization.bootstrap', { requestId, serverRevision: 0 }, at);
        return freeze({ ...publicWorkspace(org, membership), replayed: false });
      });
    },
    readWorkspace(context, value) {
      return run(context, false, async (tx, auth) => { const input = record(value, ['orgId']); const { org, membership } = await loadOrganization(tx, auth, id(input.orgId)); return publicWorkspace(org, membership); });
    },
    updateIntent(context, value) {
      return run(context, true, async (tx, auth) => {
        const input = record(value, ['orgId', 'instanceId', 'expectedRevision', 'expectedGeneration', 'intent']);
        const { org, membership } = await loadOrganization(tx, auth, id(input.orgId)); expected(org, input, true); requireCapability(membership, 'intent:write');
        const workspace = domainIntent(org.workspace, input.intent, guard(org, live(auth, org)));
        const replayed = JSON.stringify(workspace) === JSON.stringify(org.workspace);
        const next = replayed ? org : await commit(tx, auth, org, 'workspace.intent', { intentHash: hash(workspace.instance.desiredSetup) }, { workspace });
        return freeze({ ...publicWorkspace(next, membership), replayed });
      });
    },
    requestOperation: (context, value) => operationChange(context, value, 'request'),
    reviewOperation: (context, value) => operationChange(context, value, 'review'),
    confirmOperation: (context, value) => operationChange(context, value, 'confirm'),
    cancelOperation: (context, value) => operationChange(context, value, 'cancel'),
  };
  const core = { run, now, newId, newToken, live, loadOrganization, expected, audit, commit, publicWorkspace, organizationRow };
  return Object.freeze({ ...methods, ...createMembershipMethods(core) });
}
