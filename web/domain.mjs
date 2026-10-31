export const limits = Object.freeze({ operations: 50, observations: 100, bytes: 262144 });
export const defaultIntent = Object.freeze({ purpose: '', provider: 'unselected', channel: 'web-chat', notion: 'off', memory: 'workspace', selfBuilding: 'review-required' });
const encoder = new TextEncoder();
const own = (value, key) => Object.hasOwn(value, key);
const active = new Set(['requested', 'reviewed', 'confirmed']);
const kinds = ['provision', 'configure', 'pause', 'resume', 'delete'];
const observationKinds = ['resource-reported', 'configuration-persisted', 'configuration-applied', 'health-reported', 'failure-reported'];
const fail = code => { throw new TypeError(`business_claw_${code}`); };

function record(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('record_invalid');
  for (const key of Reflect.ownKeys(value)) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !fields.includes(key) || !field.enumerable || !own(field, 'value')) fail('field_invalid');
  }
  for (const key of fields) if (!own(value, key)) fail('field_invalid');
  return value;
}
function array(value, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail('array_invalid');
  if (value.length > maximum) fail('limit_exceeded');
  for (const key of Reflect.ownKeys(value)) if (key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) fail('array_invalid');
  const values = [];
  for (let index = 0; index < value.length; index++) {
    const field = Object.getOwnPropertyDescriptor(value, String(index));
    if (!field || !own(field, 'value') || !field.enumerable) fail('array_invalid');
    values.push(field.value);
  }
  return values;
}
function text(value, maximum, empty = false) {
  if (typeof value !== 'string' || value.length > maximum || (!empty && !value.trim()) || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)) fail('text_invalid');
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) fail('text_invalid'); }
    else if (code >= 0xdc00 && code <= 0xdfff) fail('text_invalid');
  }
  if (/-----BEGIN .*PRIVATE KEY|\b(?:bearer\s+\S+|(?:api[ _-]?key|authorization|password|secret|token)\s*[:=]\s*\S+)|\b(?:sk-[a-z0-9_-]{12,}|ghp_[a-z0-9]+|github_pat_[a-z0-9_]+|xox[baprs]-[a-z0-9-]+)/i.test(value)) fail('secret_like_text');
  return value;
}
function id(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value)) fail('identity_invalid');
  return value;
}
function integer(value, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum || value > 1_000_000) fail('integer_invalid');
  return value;
}
function choice(value, allowed) { if (!allowed.includes(value)) fail('field_invalid'); return value; }
function time(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) fail('timestamp_invalid');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) fail('timestamp_invalid');
  return value;
}
function between(value, from, until) { if (value < from || value > until) fail('timestamp_order'); }
function freeze(value) { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
function intent(value) {
  const input = record(value, ['purpose', 'provider', 'channel', 'notion', 'memory', 'selfBuilding']);
  return {
    purpose: text(input.purpose, 280, true), provider: choice(input.provider, ['unselected', 'organization-owned']),
    channel: choice(input.channel, ['web-chat']), notion: choice(input.notion, ['off', 'requested']),
    memory: choice(input.memory, ['off', 'workspace']), selfBuilding: choice(input.selfBuilding, ['off', 'review-required']),
  };
}
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function actorRecord(value, review, createdAt, updatedAt) {
  if (value === null) return null;
  const input = record(value, review ? ['actorId', 'decision', 'at'] : ['actorId', 'at']);
  const result = { actorId: id(input.actorId), ...(review ? { decision: choice(input.decision, ['reviewed', 'rejected']) } : {}), at: time(input.at) };
  between(result.at, createdAt, updatedAt); return result;
}
function operation(value, owner) {
  const input = record(value, ['id', 'orgId', 'instanceId', 'generation', 'revision', 'kind', 'actorId', 'state', 'createdAt', 'updatedAt', 'plan', 'review', 'confirmation', 'cancellation']);
  const createdAt = time(input.createdAt), updatedAt = time(input.updatedAt);
  between(createdAt, owner.createdAt, owner.updatedAt); between(updatedAt, createdAt, owner.updatedAt);
  const plan = record(input.plan, ['instanceRevision', 'desiredSetup']);
  const result = {
    id: id(input.id), orgId: id(input.orgId), instanceId: id(input.instanceId), generation: integer(input.generation, 1),
    revision: integer(input.revision), kind: choice(input.kind, kinds), actorId: id(input.actorId),
    state: choice(input.state, ['requested', 'reviewed', 'confirmed', 'rejected', 'cancelled', 'superseded']), createdAt, updatedAt,
    plan: { instanceRevision: integer(plan.instanceRevision), desiredSetup: intent(plan.desiredSetup) },
    review: actorRecord(input.review, true, createdAt, updatedAt), confirmation: actorRecord(input.confirmation, false, createdAt, updatedAt), cancellation: actorRecord(input.cancellation, false, createdAt, updatedAt),
  };
  if (result.orgId !== owner.orgId || result.instanceId !== owner.instance.id) fail('ownership_mismatch');
  if (result.generation !== owner.instance.generation) fail('generation_conflict');
  if (result.revision > owner.revision) fail('revision_conflict');
  if (result.plan.instanceRevision > owner.instance.revision) fail('revision_conflict');
  if (active.has(result.state) && (result.plan.instanceRevision !== owner.instance.revision || !same(result.plan.desiredSetup, owner.instance.desiredSetup))) fail('plan_stale');
  const reviewed = result.review?.decision === 'reviewed', rejected = result.review?.decision === 'rejected';
  if ((result.confirmation && !reviewed) || (result.confirmation && result.confirmation.at < result.review.at)
    || (result.cancellation && result.cancellation.at < (result.confirmation?.at ?? result.review?.at ?? createdAt))) fail('transition_invalid');
  if ((result.state === 'requested' && (result.review || result.confirmation || result.cancellation))
    || (result.state === 'reviewed' && (!reviewed || result.confirmation || result.cancellation))
    || (result.state === 'confirmed' && (!reviewed || !result.confirmation || result.cancellation))
    || (result.state === 'rejected' && (!rejected || result.confirmation || result.cancellation))
    || (result.state === 'cancelled' && (!result.cancellation || rejected))
    || (result.state === 'superseded' && (result.cancellation || rejected))) fail('transition_invalid');
  return result;
}
function observation(value, owner, operations) {
  const input = record(value, ['id', 'orgId', 'instanceId', 'generation', 'operationId', 'kind', 'recordedAt', 'source', 'verification']);
  const result = {
    id: id(input.id), orgId: id(input.orgId), instanceId: id(input.instanceId), generation: integer(input.generation, 1),
    operationId: input.operationId === null ? null : id(input.operationId), kind: choice(input.kind, observationKinds), recordedAt: time(input.recordedAt),
    source: choice(input.source, ['authored', 'imported']), verification: choice(input.verification, ['unverified']),
  };
  if (result.orgId !== owner.orgId || result.instanceId !== owner.instance.id) fail('ownership_mismatch');
  if (result.generation !== owner.instance.generation) fail('generation_conflict');
  between(result.recordedAt, owner.createdAt, owner.updatedAt);
  if (result.operationId !== null) {
    const target = operations.find(item => item.id === result.operationId);
    if (!target) fail('operation_missing');
    if (result.recordedAt < target.createdAt) fail('timestamp_order');
  }
  return result;
}

export function normalizeWorkspace(value) {
  const input = record(value, ['schemaVersion', 'revision', 'createdAt', 'updatedAt', 'organization', 'instance', 'operations', 'observations']);
  if (input.schemaVersion !== 'business-claw.workspace.v1') fail('schema_invalid');
  const org = record(input.organization, ['id', 'name']), rawInstance = record(input.instance, ['id', 'orgId', 'generation', 'revision', 'desiredSetup']);
  const organization = { id: id(org.id), name: text(org.name, 80) };
  const instance = { id: id(rawInstance.id), orgId: id(rawInstance.orgId), generation: integer(rawInstance.generation, 1), revision: integer(rawInstance.revision), desiredSetup: intent(rawInstance.desiredSetup) };
  if (organization.id !== instance.orgId || organization.id === instance.id) fail('ownership_mismatch');
  const createdAt = time(input.createdAt), updatedAt = time(input.updatedAt);
  if (updatedAt < createdAt) fail('timestamp_order');
  const revision = integer(input.revision);
  if (instance.revision > revision) fail('revision_conflict');
  const owner = { orgId: organization.id, instance, createdAt, updatedAt, revision };
  const operations = array(input.operations, limits.operations).map(item => operation(item, owner));
  if (new Set(operations.map(item => item.id)).size !== operations.length) fail('operation_identity_conflict');
  const observations = array(input.observations, limits.observations).map(item => observation(item, owner, operations));
  if (new Set(observations.map(item => item.id)).size !== observations.length) fail('observation_identity_conflict');
  const result = { schemaVersion: 'business-claw.workspace.v1', revision, createdAt, updatedAt, organization, instance, operations, observations };
  if (encoder.encode(`${JSON.stringify(result, null, 2)}\n`).length > limits.bytes) fail('limit_exceeded');
  return freeze(result);
}

export function createWorkspace(value) {
  const input = record(value, ['orgId', 'instanceId', 'name', 'now']);
  return normalizeWorkspace({ schemaVersion: 'business-claw.workspace.v1', revision: 0, createdAt: input.now, updatedAt: input.now,
    organization: { id: input.orgId, name: input.name }, instance: { id: input.instanceId, orgId: input.orgId, generation: 1, revision: 0, desiredSetup: defaultIntent }, operations: [], observations: [] });
}
export function parseWorkspace(value) {
  if (typeof value !== 'string') fail('json_invalid');
  if (value.length > limits.bytes || encoder.encode(value).length > limits.bytes) fail('limit_exceeded');
  let parsed; try { parsed = JSON.parse(value); } catch { fail('json_invalid'); }
  return normalizeWorkspace(parsed);
}
export function serializeWorkspace(value) { return `${JSON.stringify(normalizeWorkspace(value), null, 2)}\n`; }

function guarded(value, rawGuard) {
  const workspace = normalizeWorkspace(value), guard = record(rawGuard, ['expectedRevision', 'expectedGeneration', 'now']);
  if (integer(guard.expectedRevision) !== workspace.revision) fail('revision_conflict');
  if (integer(guard.expectedGeneration, 1) !== workspace.instance.generation) fail('generation_conflict');
  const now = time(guard.now); if (now < workspace.updatedAt) fail('timestamp_order');
  return { workspace, now };
}
function finish(workspace, now, changes) { return normalizeWorkspace({ ...workspace, ...changes, revision: workspace.revision + 1, updatedAt: now }); }
function find(workspace, operationId) { const result = workspace.operations.find(item => item.id === id(operationId)); if (!result) fail('operation_missing'); return result; }
function actor(value) { return id(record(value, ['actorId']).actorId); }
function fresh(workspace, item) { if (item.generation !== workspace.instance.generation || item.plan.instanceRevision !== workspace.instance.revision || !same(item.plan.desiredSetup, workspace.instance.desiredSetup)) fail('plan_stale'); }

export function updateIntent(value, rawIntent, rawGuard) {
  const { workspace, now } = guarded(value, rawGuard), desiredSetup = intent(rawIntent);
  if (same(desiredSetup, workspace.instance.desiredSetup)) return workspace;
  return finish(workspace, now, { instance: { ...workspace.instance, revision: workspace.instance.revision + 1, desiredSetup },
    operations: workspace.operations.map(item => active.has(item.state) ? { ...item, state: 'superseded', revision: item.revision + 1, updatedAt: now } : item) });
}
export function requestOperation(value, request, rawGuard) {
  const { workspace, now } = guarded(value, rawGuard), input = record(request, ['id', 'kind', 'actorId']);
  const operationId = id(input.id), kind = choice(input.kind, kinds), actorId = id(input.actorId), existing = workspace.operations.find(item => item.id === operationId);
  const plan = { instanceRevision: workspace.instance.revision, desiredSetup: workspace.instance.desiredSetup };
  if (existing) { if (existing.kind !== kind || existing.actorId !== actorId || existing.generation !== workspace.instance.generation || !same(existing.plan, plan)) fail('operation_identity_conflict'); return workspace; }
  return finish(workspace, now, { operations: [...workspace.operations, { id: operationId, orgId: workspace.organization.id, instanceId: workspace.instance.id, generation: workspace.instance.generation,
    revision: 0, kind, actorId, state: 'requested', createdAt: now, updatedAt: now, plan, review: null, confirmation: null, cancellation: null }] });
}
function transition(value, operationId, rawGuard, apply) {
  const { workspace, now } = guarded(value, rawGuard), item = find(workspace, operationId);
  const next = apply(item, now);
  if (next === item) return workspace;
  fresh(workspace, item);
  return finish(workspace, now, { operations: workspace.operations.map(entry => entry.id === item.id ? { ...next, revision: item.revision + 1, updatedAt: now } : entry) });
}
export function reviewOperation(value, operationId, review, rawGuard) {
  const input = record(review, ['decision', 'actorId']), decision = choice(input.decision, ['reviewed', 'rejected']), actorId = id(input.actorId);
  return transition(value, operationId, rawGuard, (item, now) => {
    if (item.state === decision && item.review?.actorId === actorId && item.review.decision === decision) return item;
    if (item.state !== 'requested') fail('transition_invalid');
    return { ...item, state: decision, review: { actorId, decision, at: now } };
  });
}
export function confirmOperation(value, operationId, confirmation, rawGuard) {
  const actorId = actor(confirmation);
  return transition(value, operationId, rawGuard, (item, now) => {
    if (item.state === 'confirmed' && item.confirmation?.actorId === actorId) return item;
    if (item.state !== 'reviewed') fail('transition_invalid');
    return { ...item, state: 'confirmed', confirmation: { actorId, at: now } };
  });
}
export function cancelOperation(value, operationId, cancellation, rawGuard) {
  const actorId = actor(cancellation);
  return transition(value, operationId, rawGuard, (item, now) => {
    if (item.state === 'cancelled' && item.cancellation?.actorId === actorId) return item;
    if (!active.has(item.state)) fail('transition_invalid');
    return { ...item, state: 'cancelled', cancellation: { actorId, at: now } };
  });
}
export function recordObservation(value, receipt, rawGuard) {
  const { workspace, now } = guarded(value, rawGuard);
  const input = record(receipt, ['id', 'orgId', 'instanceId', 'generation', 'operationId', 'kind', 'recordedAt']);
  const normalized = observation({ ...input, source: 'authored', verification: 'unverified' }, { orgId: workspace.organization.id, instance: workspace.instance, createdAt: workspace.createdAt, updatedAt: now }, workspace.operations);
  const existing = workspace.observations.find(item => item.id === normalized.id);
  if (existing) { if (!same(existing, normalized)) fail('observation_identity_conflict'); return workspace; }
  return finish(workspace, now, { observations: [...workspace.observations, normalized] });
}
export function proposedCommands(value) {
  const workspace = normalizeWorkspace(value);
  return freeze(workspace.operations.filter(item => item.state === 'confirmed').map(item => ({
    schemaVersion: 'business-claw.command.v1', operationId: item.id, kind: item.kind, orgId: item.orgId, instanceId: item.instanceId,
    generation: item.generation, instanceRevision: item.plan.instanceRevision, desiredSetup: item.plan.desiredSetup,
    mode: 'proposal-only', adapter: 'unbound', executionAuthority: 'not-granted',
  })));
}
export function workspaceStatus(value) {
  const workspace = normalizeWorkspace(value);
  return Object.freeze({ adapter: 'unbound', readiness: 'unverified', ready: false, revision: workspace.revision, generation: workspace.instance.generation,
    desiredRevision: workspace.instance.revision, pendingOperations: workspace.operations.filter(item => active.has(item.state)).length,
    proposedCommands: workspace.operations.filter(item => item.state === 'confirmed').length, observationCount: workspace.observations.length });
}
