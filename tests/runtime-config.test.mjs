import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runtimeConfigLimits, normalizeRuntimeBinding, normalizeConfigObservation,
  normalizeConfigReceipt, reconcileConfigReceipt,
} from '../runtime/config-observation.mjs';

const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const receivedAt = '2026-10-31T12:00:00.000Z', observedAt = '2026-10-31T12:01:00.000Z';
const binding = overrides => ({ orgId: uuid(1), instanceId: uuid(2), generation: 1, installationId: uuid(3), releaseCommit: 'a'.repeat(40), ...overrides });
const receipt = overrides => ({ binding: binding(), operationId: uuid(4), receivedAt, method: 'patch', outcome: 'success', rawToken: 'raw CAS / authored revision', noop: false, restartRequired: false, changedPaths: ['gateway.mode'], ...overrides });
const observation = overrides => ({ binding: binding(), observedAt, valid: true, rawToken: 'raw CAS / authored revision', sourceToken: 'effective source: α', appliedToken: 'effective source: α', ...overrides });
const clone = value => JSON.parse(JSON.stringify(value));

test('opaque raw CAS tokens are independent of source application tokens and absent-file raw null is valid', () => {
  const result = normalizeConfigObservation(observation({ rawToken: 'arbitrary raw {CAS} / 版本', sourceToken: 'opaque source + spaces', appliedToken: 'opaque source + spaces' }));
  assert.equal(result.application, 'applied'); assert.equal(result.rawToken, 'arbitrary raw {CAS} / 版本');
  const absentFile = normalizeConfigObservation(observation({ rawToken: null }));
  assert.equal(absentFile.application, 'applied'); assert.equal(absentFile.rawToken, null);
  assert.equal(absentFile.ready, false); assert.equal(absentFile.readiness, 'unproven');
  const unrelated = normalizeConfigObservation(observation({ rawToken: 'same-as-applied', sourceToken: 'different-source', appliedToken: 'same-as-applied' }));
  assert.equal(unrelated.application, 'unapplied');
});

test('missing application tokens stay unavailable while two present unequal tokens are unapplied', () => {
  for (const input of [observation({ valid: false, sourceToken: null, appliedToken: null }), observation({ valid: false, sourceToken: null }), observation({ appliedToken: null })]) {
    const normalized = normalizeConfigObservation(input);
    assert.equal(normalized.application, 'unavailable'); assert.equal(normalized.ready, false);
  }
  assert.equal(normalizeConfigObservation(observation({ appliedToken: 'older effective source' })).application, 'unapplied');
});

test('snapshot validity requires a source token and invalid snapshots cannot carry one', () => {
  assert.throws(() => normalizeConfigObservation(observation({ valid: true, sourceToken: null })), /business_claw_runtime_observation_invalid/);
  assert.throws(() => normalizeConfigObservation(observation({ valid: false })), /business_claw_runtime_observation_invalid/);
  const invalid = normalizeConfigObservation(observation({ valid: false, sourceToken: null, rawToken: 'invalid-file CAS' }));
  assert.equal(invalid.valid, false); assert.equal(invalid.application, 'unavailable');
});

test('reconciliation rejects each different organization instance generation installation and release binding', () => {
  for (const overrides of [{ orgId: uuid(10) }, { instanceId: uuid(11) }, { generation: 2 }, { installationId: uuid(12) }, { releaseCommit: 'b'.repeat(40) }]) {
    assert.throws(() => reconcileConfigReceipt(receipt(), observation({ binding: binding(overrides) })), /business_claw_runtime_binding_mismatch/);
  }
  const matched = reconcileConfigReceipt(receipt(), observation());
  assert.deepEqual(matched.binding, binding()); assert.equal(matched.rawRevision, 'matched');
});

test('an observation before the receipt is rejected and an equal-time observation is allowed', () => {
  assert.throws(() => reconcileConfigReceipt(receipt(), observation({ observedAt: '2026-10-31T11:59:59.999Z' })), /business_claw_runtime_timestamp_order/);
  const sameTime = reconcileConfigReceipt(receipt(), observation({ observedAt: receivedAt }));
  assert.equal(sameTime.observedAt, receivedAt); assert.equal(sameTime.writeApplication, 'applied');
});

test('set reports persistence only even when a later matching snapshot observes application', () => {
  const raw = receipt({ method: 'set', restartRequired: null, changedPaths: null });
  const normalized = normalizeConfigReceipt(raw);
  assert.equal(normalized.persistence, 'confirmed'); assert.equal(normalized.application, 'persistence-only');
  const reconciled = reconcileConfigReceipt(raw, observation());
  assert.equal(reconciled.receiptApplication, 'persistence-only'); assert.equal(reconciled.writeApplication, 'applied');
  assert.equal(reconciled.ready, false); assert.equal(reconciled.readiness, 'unproven');
});

test('apply and patch preserve restart-required reported-applied and unavailable restart evidence', () => {
  for (const method of ['apply', 'patch']) for (const [restartRequired, expected] of [[true, 'restart-required'], [false, 'reported-applied'], [null, 'unproven']]) {
    const result = normalizeConfigReceipt(receipt({ method, restartRequired, changedPaths: method === 'patch' ? ['gateway.mode'] : null }));
    assert.equal(result.persistence, 'confirmed'); assert.equal(result.application, expected);
    assert.equal(result.ready, false); assert.equal(result.readiness, 'unproven');
  }
});

test('committed-unapplied retains its receipt outcome when a matching later read observes application', () => {
  const raw = receipt({ outcome: 'committed-unapplied', restartRequired: null, changedPaths: null });
  const normalized = normalizeConfigReceipt(raw);
  assert.equal(normalized.persistence, 'confirmed'); assert.equal(normalized.application, 'committed-unapplied');
  const later = reconcileConfigReceipt(raw, observation());
  assert.equal(later.receiptOutcome, 'committed-unapplied'); assert.equal(later.receiptApplication, 'committed-unapplied');
  assert.equal(later.rawRevision, 'matched'); assert.equal(later.writeApplication, 'applied');
  const missingRaw = reconcileConfigReceipt(receipt({ ...raw, rawToken: null }), observation());
  assert.equal(missingRaw.rawRevision, 'unavailable'); assert.equal(missingRaw.writeApplication, 'unavailable');
  assert.equal(missingRaw.observedApplication, 'applied');
});

test('a successful no-op never credits persistence or recovery from a later applied snapshot', () => {
  const raw = receipt({ noop: true, rawToken: null, restartRequired: null, changedPaths: [] });
  const normalized = normalizeConfigReceipt(raw), reconciled = reconcileConfigReceipt(raw, observation());
  assert.equal(normalized.persistence, 'not-established'); assert.equal(normalized.application, 'unproven');
  assert.equal(reconciled.rawRevision, 'unavailable'); assert.equal(reconciled.writeApplication, 'unavailable');
  assert.equal(reconciled.observedApplication, 'applied');
  for (const overrides of [{ rawToken: 'invented write CAS' }, { restartRequired: false }, { changedPaths: ['gateway.mode'] }, { method: 'apply', changedPaths: null }]) {
    assert.throws(() => normalizeConfigReceipt({ ...raw, ...overrides }), /business_claw_runtime_receipt_invalid/);
  }
});

test('empty changed paths without noop still reports an authored persistence attempt', () => {
  const raw = receipt({ changedPaths: [], noop: false });
  const result = normalizeConfigReceipt(raw);
  assert.deepEqual(result.changedPaths, []); assert.equal(result.noop, false);
  assert.equal(result.persistence, 'confirmed'); assert.equal(result.application, 'reported-applied');
  assert.equal(reconcileConfigReceipt(raw, observation()).writeApplication, 'applied');
});

test('raw revision mismatch or missing CAS loses write attribution without hiding current application', () => {
  const changed = reconcileConfigReceipt(receipt(), observation({ rawToken: 'some other authored write' }));
  assert.equal(changed.rawRevision, 'changed'); assert.equal(changed.writeApplication, 'unavailable');
  assert.equal(changed.observedApplication, 'applied'); assert.equal(changed.receiptApplication, 'reported-applied');
  for (const [rawReceipt, rawObservation] of [[receipt({ rawToken: null }), observation()], [receipt(), observation({ rawToken: null })]]) {
    const result = reconcileConfigReceipt(rawReceipt, rawObservation);
    assert.equal(result.rawRevision, 'unavailable'); assert.equal(result.writeApplication, 'unavailable');
    assert.equal(result.observedApplication, 'applied');
  }
});

test('rejection and publication failure establish no persistence even beside a later applied snapshot', () => {
  for (const outcome of ['rejected', 'publication-failed']) {
    const raw = receipt({ outcome, rawToken: null, restartRequired: null, changedPaths: null });
    const normalized = normalizeConfigReceipt(raw), reconciled = reconcileConfigReceipt(raw, observation());
    assert.equal(normalized.persistence, 'not-established'); assert.equal(normalized.application, 'unproven');
    assert.equal(reconciled.rawRevision, 'unavailable'); assert.equal(reconciled.writeApplication, 'unavailable');
    assert.equal(reconciled.observedApplication, 'applied');
    for (const overrides of [{ rawToken: 'fabricated persistence CAS' }, { restartRequired: true }, { noop: true }]) assert.throws(() => normalizeConfigReceipt({ ...raw, ...overrides }), /business_claw_runtime_receipt_invalid/);
  }
});

test('lost acknowledgment and generic unavailable outcomes cannot impersonate committed receipts', () => {
  for (const outcome of ['lost-acknowledgment', 'UNAVAILABLE', 'unknown', null]) {
    assert.throws(() => normalizeConfigReceipt(receipt({ outcome })), /business_claw_runtime_field_invalid/);
  }
  assert.throws(() => normalizeConfigReceipt(receipt({ method: 'set', outcome: 'committed-unapplied', restartRequired: null, changedPaths: null })), /business_claw_runtime_receipt_invalid/);
});

test('strict records reject extra credential config inherited hidden symbol and accessor properties without reads', () => {
  for (const input of [observation({ rawConfig: { token: 'authored-private-fixture' } }), observation({ credentials: 'authored-private-fixture' }), receipt({ endpoint: 'https://fixture.invalid' })]) {
    const normalize = Object.hasOwn(input, 'observedAt') ? normalizeConfigObservation : normalizeConfigReceipt;
    assert.throws(() => normalize(input), error => error.message === 'business_claw_runtime_field_invalid' && !error.message.includes('authored-private-fixture'));
  }
  assert.throws(() => normalizeConfigObservation(Object.create(observation())), /business_claw_runtime_record_invalid/);
  for (const key of ['__proto__', 'constructor']) {
    const protectedField = observation();
    Object.defineProperty(protectedField, key, { value: { authored: true }, enumerable: true });
    assert.throws(() => normalizeConfigObservation(protectedField), /business_claw_runtime_field_invalid/);
  }
  const hidden = observation(); Object.defineProperty(hidden, 'rawToken', { value: 'hidden CAS', enumerable: false });
  assert.throws(() => normalizeConfigObservation(hidden), /business_claw_runtime_field_invalid/);
  const symbolic = receipt(); symbolic[Symbol('extra')] = true;
  assert.throws(() => normalizeConfigReceipt(symbolic), /business_claw_runtime_field_invalid/);
  let reads = 0; const accessor = observation();
  Object.defineProperty(accessor, 'binding', { enumerable: true, get() { reads++; return binding(); } });
  assert.throws(() => normalizeConfigObservation(accessor), /business_claw_runtime_field_invalid/); assert.equal(reads, 0);
  const nullRecord = Object.assign(Object.create(null), observation({ binding: Object.assign(Object.create(null), binding()) }));
  assert.equal(normalizeConfigObservation(nullRecord).application, 'applied');
});

test('changed path arrays must be dense ordinary unique enumerable data without accessor reads', () => {
  const sparse = new Array(1), extended = ['gateway.mode'], symbolic = ['gateway.mode'];
  extended.extra = 'not an element'; symbolic[Symbol('extra')] = true;
  const inherited = Object.setPrototypeOf(['gateway.mode'], null);
  const hidden = []; Object.defineProperty(hidden, '0', { value: 'gateway.mode', enumerable: false });
  let reads = 0; const accessor = [];
  Object.defineProperty(accessor, '0', { enumerable: true, get() { reads++; return 'gateway.mode'; } });
  for (const changedPaths of [sparse, extended, symbolic, inherited, hidden, accessor]) assert.throws(() => normalizeConfigReceipt(receipt({ changedPaths })), /business_claw_runtime_array_invalid/);
  assert.equal(reads, 0);
  assert.throws(() => normalizeConfigReceipt(receipt({ changedPaths: ['gateway.mode', 'gateway.mode'] })), /business_claw_runtime_path_duplicate/);
});

test('malformed identities generations timestamps text and bounded arrays fail without truncation', () => {
  for (const overrides of [{ orgId: 'A0000000-0000-4000-8000-000000000001' }, { instanceId: 2 }, { installationId: 'installation' }, { releaseCommit: 'A'.repeat(40) }, { orgId: uuid(2) }]) assert.throws(() => normalizeRuntimeBinding(binding(overrides)));
  for (const generation of [0, 1_000_001, -1, 1.5, NaN, Infinity, '1']) assert.throws(() => normalizeRuntimeBinding(binding({ generation })), /business_claw_runtime_generation_invalid/);
  for (const time of ['2026-02-30T12:00:00.000Z', '2026-10-31T12:00:00Z', '2026-10-31T12:00:00.000+00:00']) {
    assert.throws(() => normalizeConfigObservation(observation({ observedAt: time })), /business_claw_runtime_timestamp_invalid/);
    assert.throws(() => normalizeConfigReceipt(receipt({ receivedAt: time })), /business_claw_runtime_timestamp_invalid/);
  }
  for (const rawToken of ['', '   ', 'line\nbreak', '\ud800', 1, 'x'.repeat(runtimeConfigLimits.token + 1)]) assert.throws(() => normalizeConfigObservation(observation({ rawToken })), /business_claw_runtime_text_invalid/);
  assert.equal(normalizeConfigObservation(observation({ rawToken: 'x'.repeat(runtimeConfigLimits.token) })).rawToken.length, runtimeConfigLimits.token);
  assert.throws(() => normalizeConfigReceipt(receipt({ changedPaths: ['x'.repeat(runtimeConfigLimits.path + 1)] })), /business_claw_runtime_text_invalid/);
  assert.throws(() => normalizeConfigReceipt(receipt({ changedPaths: Array.from({ length: runtimeConfigLimits.paths + 1 }, (_, index) => `path.${index}`) })), /business_claw_runtime_limit_exceeded/);
  assert.throws(() => normalizeConfigReceipt(receipt({ changedPaths: Array.from({ length: 40 }, (_, index) => `${index}:${'x'.repeat(1000)}`) })), /business_claw_runtime_limit_exceeded/);
});

test('normalizers and reconciliation return frozen detached data without mutating or freezing inputs', () => {
  const rawReceipt = receipt(), rawObservation = observation(), beforeReceipt = clone(rawReceipt), beforeObservation = clone(rawObservation);
  const normalizedReceipt = normalizeConfigReceipt(rawReceipt), normalizedObservation = normalizeConfigObservation(rawObservation), result = reconcileConfigReceipt(rawReceipt, rawObservation);
  assert.deepEqual(rawReceipt, beforeReceipt); assert.deepEqual(rawObservation, beforeObservation);
  for (const input of [rawReceipt, rawReceipt.binding, rawReceipt.changedPaths, rawObservation, rawObservation.binding]) assert.equal(Object.isFrozen(input), false);
  for (const output of [normalizedReceipt, normalizedReceipt.binding, normalizedReceipt.changedPaths, normalizedObservation, normalizedObservation.binding, result, result.binding]) assert.equal(Object.isFrozen(output), true);
  assert.notEqual(normalizedReceipt.binding, rawReceipt.binding); assert.notEqual(normalizedReceipt.changedPaths, rawReceipt.changedPaths);
  rawReceipt.changedPaths.push('new.path'); rawReceipt.binding.generation = 9; rawObservation.sourceToken = 'changed outside';
  assert.deepEqual(normalizedReceipt.changedPaths, ['gateway.mode']); assert.equal(result.binding.generation, 1); assert.equal(normalizedObservation.sourceToken, 'effective source: α');
  assert.throws(() => { result.ready = true; }, TypeError); assert.throws(() => normalizedReceipt.changedPaths.push('forbidden'), TypeError);
});

test('receipt shape rules and exact reconciliation DTOs reject nullable fields and enriched outputs', () => {
  for (const overrides of [{ method: 'set', changedPaths: null, restartRequired: false }, { method: 'apply', changedPaths: [] }, { changedPaths: null }, { outcome: 'committed-unapplied', changedPaths: [] }, { noop: null }, { restartRequired: 'false' }, { operationId: 'not-an-id' }]) assert.throws(() => normalizeConfigReceipt(receipt(overrides)));
  assert.throws(() => reconcileConfigReceipt(normalizeConfigReceipt(receipt()), observation()), /business_claw_runtime_field_invalid/);
  assert.throws(() => reconcileConfigReceipt(receipt(), normalizeConfigObservation(observation())), /business_claw_runtime_field_invalid/);
  assert.equal(reconcileConfigReceipt(receipt(), observation()).writeApplication, 'applied');
});
