import test from 'node:test';
import assert from 'node:assert/strict';
import {
  limits, defaultIntent, normalizeWorkspace, createWorkspace, parseWorkspace, serializeWorkspace,
  updateIntent, requestOperation, reviewOperation, confirmOperation, cancelOperation,
  recordObservation, proposedCommands, workspaceStatus,
} from '../web/domain.mjs';

const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const now = '2026-10-31T12:00:00.000Z', later = '2026-10-31T12:01:00.000Z';
const actorId = uuid(3), operationId = uuid(10);
const create = () => createWorkspace({ orgId: uuid(1), instanceId: uuid(2), name: 'Authored organization', now });
const guard = (workspace, at = now) => ({ expectedRevision: workspace.revision, expectedGeneration: workspace.instance.generation, now: at });
const request = (workspace, overrides = {}) => requestOperation(workspace, { id: operationId, kind: 'provision', actorId, ...overrides }, guard(workspace));
const review = workspace => reviewOperation(workspace, operationId, { decision: 'reviewed', actorId }, guard(workspace));
const confirm = workspace => confirmOperation(workspace, operationId, { actorId }, guard(workspace));
const clone = workspace => JSON.parse(serializeWorkspace(workspace));
const receipt = overrides => ({ id: uuid(100), orgId: uuid(1), instanceId: uuid(2), generation: 1, operationId: null, kind: 'health-reported', recordedAt: now, ...overrides });

test('new workspaces are detached frozen plans and never claim connected or ready infrastructure', () => {
  const workspace = create();
  assert.deepEqual(workspace.instance.desiredSetup, defaultIntent);
  assert.deepEqual(workspaceStatus(workspace), { adapter: 'unbound', readiness: 'unverified', ready: false, revision: 0, generation: 1, desiredRevision: 0, pendingOperations: 0, proposedCommands: 0, observationCount: 0 });
  for (const value of [workspace, workspace.organization, workspace.instance, workspace.instance.desiredSetup, workspace.operations, workspace.observations]) assert.equal(Object.isFrozen(value), true);
  assert.deepEqual(proposedCommands(workspace), []);
  assert.throws(() => { workspace.instance.generation = 9; }, TypeError);
});

test('canonical JSON roundtrips one organization and accepts only data-only null-prototype records', () => {
  const workspace = create(), source = clone(workspace);
  source.organization = Object.assign(Object.create(null), source.organization);
  const normalized = normalizeWorkspace(source);
  assert.deepEqual(normalized, workspace); assert.notEqual(normalized.organization, source.organization);
  assert.equal(serializeWorkspace(normalized), `${JSON.stringify(normalized, null, 2)}\n`);
  assert.deepEqual(parseWorkspace(serializeWorkspace(normalized)), normalized);
  source.organization.name = 'Changed outside the domain';
  assert.equal(normalized.organization.name, 'Authored organization');
});

test('strict records and dense arrays reject unknown hidden symbol accessor and inherited fields', () => {
  for (const change of [value => { value.token = 'authored'; }, value => { value.instance.rawConfig = {}; }, value => { value[Symbol('extra')] = true; }, value => { value.operations = new Array(1); }, value => { value.observations.extra = true; }]) {
    const source = clone(create()); change(source); assert.throws(() => normalizeWorkspace(source));
  }
  let reads = 0; const source = clone(create());
  Object.defineProperty(source, 'organization', { enumerable: true, get() { reads++; return {}; } });
  assert.throws(() => normalizeWorkspace(source), /business_claw_field_invalid/); assert.equal(reads, 0);
  const hidden = clone(create()); Object.defineProperty(hidden.organization, 'name', { value: 'Hidden', enumerable: false }); assert.throws(() => normalizeWorkspace(hidden));
  const inherited = clone(create()); inherited.organization = Object.create(inherited.organization); assert.throws(() => normalizeWorkspace(inherited));
});

test('ownership generation and revision validation reject transplanted and impossible records', () => {
  for (const change of [value => { value.instance.orgId = uuid(90); }, value => { value.instance.id = value.organization.id; }, value => { value.instance.revision = 1; }, value => { value.revision = Infinity; }]) {
    const source = clone(create()); change(source); assert.throws(() => normalizeWorkspace(source));
  }
  const requested = request(create());
  for (const change of [value => { value.operations[0].orgId = uuid(90); }, value => { value.operations[0].instanceId = uuid(90); }, value => { value.operations[0].generation = 2; }, value => { value.operations[0].revision = value.revision + 1; }]) {
    const source = clone(requested); change(source); assert.throws(() => normalizeWorkspace(source));
  }
});

test('setup intents are exact bounded public settings and credential-like input fails with safe codes', () => {
  const workspace = create();
  const intent = { purpose: 'Support the Équipe 🌊', provider: 'organization-owned', channel: 'web-chat', notion: 'requested', memory: 'off', selfBuilding: 'off' };
  const updated = updateIntent(workspace, intent, guard(workspace));
  assert.deepEqual(updated.instance.desiredSetup, intent); assert.equal(workspace.instance.desiredSetup.purpose, '');
  for (const replacement of [{ provider: 'automatic-shared-key' }, { channel: 'arbitrary-url' }, { notion: 'connected' }, { purpose: 'x'.repeat(281) }, { purpose: 'a\nb' }, { purpose: '\ud800' }, { token: 'authored' }]) assert.throws(() => updateIntent(workspace, { ...defaultIntent, ...replacement }, guard(workspace)));
  for (const secret of ['Bearer authored-fixture-value', 'api_key=authored-fixture-value', 'sk-authoredsyntheticcredential12345', '-----BEGIN PRIVATE KEY-----']) {
    try { updateIntent(workspace, { ...defaultIntent, purpose: secret }, guard(workspace)); assert.fail('credential-shaped input accepted'); }
    catch (error) { assert.equal(error.message, 'business_claw_secret_like_text'); assert.ok(!error.message.includes(secret)); }
  }
  assert.throws(() => createWorkspace({ orgId: uuid(1), instanceId: uuid(2), name: 'x'.repeat(81), now }));
});

test('JSON imports reject malformed oversized unsafe schema and timestamp data without echoing it', () => {
  for (const value of ['{not JSON}', '', null]) assert.throws(() => parseWorkspace(value), /business_claw_json_invalid/);
  assert.throws(() => parseWorkspace(' '.repeat(limits.bytes + 1)), /business_claw_limit_exceeded/);
  const wrongSchema = clone(create()); wrongSchema.schemaVersion = 'business-claw.workspace.v2'; assert.throws(() => normalizeWorkspace(wrongSchema), /business_claw_schema_invalid/);
  for (const timestamp of ['2026-02-31T12:00:00.000Z', '2026-10-31', '2026-10-31T12:00:00Z']) {
    const value = clone(create()); value.updatedAt = timestamp; assert.throws(() => normalizeWorkspace(value), /business_claw_timestamp_invalid/);
  }
});

test('request identities are idempotent only for the same actor kind and immutable plan', () => {
  const workspace = create(), requested = request(workspace);
  assert.equal(requested.revision, 1); assert.equal(requested.operations[0].revision, 0);
  assert.deepEqual(requested.operations[0].plan, { instanceRevision: 0, desiredSetup: defaultIntent });
  assert.deepEqual(request(requested), requested);
  for (const replacement of [{ kind: 'delete' }, { actorId: uuid(90) }]) assert.throws(() => request(requested, replacement), /business_claw_operation_identity_conflict/);
  const changed = updateIntent(requested, { ...defaultIntent, purpose: 'Changed plan' }, guard(requested));
  assert.throws(() => request(changed), /business_claw_operation_identity_conflict/);
  assert.deepEqual(proposedCommands(requested), []); assert.equal(workspace.operations.length, 0);
});

test('reviewed and confirmed workflow data produces only explicit unbound command proposals', () => {
  const requested = request(create()), reviewed = review(requested), confirmed = confirm(reviewed);
  assert.equal(reviewed.operations[0].state, 'reviewed'); assert.equal(confirmed.operations[0].state, 'confirmed');
  assert.equal(confirmed.operations[0].revision, 2); assert.equal(confirmed.revision, 3);
  assert.deepEqual(confirm(confirmed), confirmed);
  const commands = proposedCommands(confirmed);
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0], { schemaVersion: 'business-claw.command.v1', operationId, kind: 'provision', orgId: uuid(1), instanceId: uuid(2), generation: 1, instanceRevision: 0, desiredSetup: defaultIntent, mode: 'proposal-only', adapter: 'unbound', executionAuthority: 'not-granted' });
  assert.equal(Object.isFrozen(commands[0]), true);
  assert.equal(workspaceStatus(confirmed).ready, false); assert.equal(workspaceStatus(confirmed).proposedCommands, 1);
});

test('invalid transitions cannot skip review revise completed decisions or manufacture success', () => {
  const requested = request(create());
  assert.throws(() => confirm(requested), /business_claw_transition_invalid/);
  const rejected = reviewOperation(requested, operationId, { decision: 'rejected', actorId }, guard(requested));
  assert.throws(() => confirm(rejected), /business_claw_transition_invalid/);
  assert.throws(() => cancelOperation(rejected, operationId, { actorId }, guard(rejected)), /business_claw_transition_invalid/);
  const forged = clone(requested); forged.operations[0].state = 'succeeded'; assert.throws(() => normalizeWorkspace(forged));
  const missingReview = clone(requested); missingReview.operations[0].state = 'confirmed'; assert.throws(() => normalizeWorkspace(missingReview), /business_claw_transition_invalid/);
});

test('cancellation preserves reviewed plans and removes proposals at every active workflow stage', () => {
  const requested = request(create());
  for (const workspace of [requested, review(requested), confirm(review(requested))]) {
    const cancelled = cancelOperation(workspace, operationId, { actorId }, guard(workspace));
    assert.equal(cancelled.operations[0].state, 'cancelled'); assert.deepEqual(cancelled.operations[0].plan, workspace.operations[0].plan);
    assert.deepEqual(cancelled.operations[0].review, workspace.operations[0].review);
    assert.deepEqual(cancelled.operations[0].confirmation, workspace.operations[0].confirmation);
    assert.deepEqual(proposedCommands(cancelled), []);
    assert.deepEqual(cancelOperation(cancelled, operationId, { actorId }, guard(cancelled)), cancelled);
  }
});

test('intent revisions supersede active plans while identical terminal retries remain harmless', () => {
  const confirmed = confirm(review(request(create())));
  assert.deepEqual(updateIntent(confirmed, defaultIntent, guard(confirmed)), confirmed);
  const changed = updateIntent(confirmed, { ...defaultIntent, notion: 'requested' }, guard(confirmed));
  assert.equal(changed.instance.revision, 1); assert.equal(changed.operations[0].state, 'superseded');
  assert.deepEqual(changed.operations[0].plan, confirmed.operations[0].plan); assert.deepEqual(proposedCommands(changed), []);
  assert.throws(() => confirm(changed));
  const pending = request(create());
  const cancelled = cancelOperation(pending, operationId, { actorId }, guard(pending));
  const editedCancelled = updateIntent(cancelled, { ...defaultIntent, purpose: 'Later intent' }, guard(cancelled));
  assert.deepEqual(cancelOperation(editedCancelled, operationId, { actorId }, guard(editedCancelled)), editedCancelled);
  assert.throws(() => cancelOperation(editedCancelled, operationId, { actorId }, guard(cancelled)), /business_claw_revision_conflict/);
  const rejected = reviewOperation(pending, operationId, { decision: 'rejected', actorId }, guard(pending));
  const editedRejected = updateIntent(rejected, { ...defaultIntent, purpose: 'Later intent' }, guard(rejected));
  assert.deepEqual(reviewOperation(editedRejected, operationId, { decision: 'rejected', actorId }, guard(editedRejected)), editedRejected);
});

test('snapshot guards reject stale revisions generations and time before considering retries', () => {
  const initial = create(), requested = request(initial), before = serializeWorkspace(requested);
  assert.throws(() => requestOperation(requested, { id: operationId, kind: 'provision', actorId }, guard(initial)), /business_claw_revision_conflict/);
  assert.throws(() => updateIntent(requested, defaultIntent, { ...guard(requested), expectedGeneration: 2 }), /business_claw_generation_conflict/);
  assert.throws(() => updateIntent(requested, defaultIntent, guard(requested, '2026-10-31T11:59:00.000Z')), /business_claw_timestamp_order/);
  assert.equal(serializeWorkspace(requested), before);
});

test('unverified observations remain non-authoritative and require owned targets valid links and times', () => {
  const workspace = request(create()), observed = recordObservation(workspace, receipt({ operationId }), guard(workspace));
  assert.equal(observed.operations[0].state, 'requested'); assert.equal(observed.observations[0].verification, 'unverified');
  assert.equal(workspaceStatus(observed).ready, false); assert.equal(workspaceStatus(observed).observationCount, 1);
  assert.deepEqual(recordObservation(observed, receipt({ operationId }), guard(observed)), observed);
  for (const replacement of [{ orgId: uuid(90) }, { instanceId: uuid(90) }, { generation: 2 }, { operationId: uuid(90) }, { recordedAt: '2026-10-31T11:59:00.000Z' }, { recordedAt: later }]) assert.throws(() => recordObservation(workspace, receipt(replacement), guard(workspace)));
  assert.throws(() => recordObservation(observed, receipt({ kind: 'resource-reported' }), guard(observed)), /business_claw_observation_identity_conflict/);
  const forged = clone(observed); forged.observations[0].verification = 'verified'; assert.throws(() => normalizeWorkspace(forged));
  const unsafe = clone(observed); unsafe.observations[0].rawOutput = 'provider credential'; assert.throws(() => normalizeWorkspace(unsafe), /business_claw_field_invalid/);
});

test('portable operation and observation history has explicit limits without dropping existing data', () => {
  let operations = create();
  for (let index = 0; index < limits.operations; index++) operations = request(operations, { id: uuid(1000 + index), kind: ['provision', 'configure', 'pause', 'resume', 'delete'][index % 5] });
  const before = serializeWorkspace(operations);
  assert.throws(() => request(operations, { id: uuid(2000) }), /business_claw_limit_exceeded/);
  assert.equal(serializeWorkspace(operations), before);
  let observations = create();
  for (let index = 0; index < limits.observations; index++) observations = recordObservation(observations, receipt({ id: uuid(3000 + index) }), guard(observations));
  assert.throws(() => recordObservation(observations, receipt({ id: uuid(4000) }), guard(observations)), /business_claw_limit_exceeded/);
  assert.equal(observations.observations.length, limits.observations); assert.equal(workspaceStatus(observations).ready, false);
});
