export const runtimeConfigLimits = Object.freeze({ token: 1024, paths: 256, path: 1024, bytes: 32768 });
const own = (value, key) => Object.hasOwn(value, key);
const fail = code => { throw new TypeError(`business_claw_runtime_${code}`); };

function record(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('record_invalid');
  for (const key of Reflect.ownKeys(value)) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !fields.includes(key) || !field.enumerable || !own(field, 'value')) fail('field_invalid');
  }
  for (const key of fields) if (!own(value, key)) fail('field_invalid');
  return value;
}
function text(value, maximum) {
  if (typeof value !== 'string' || value.length > maximum || !value.trim() || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)) fail('text_invalid');
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) fail('text_invalid'); }
    else if (code >= 0xdc00 && code <= 0xdfff) fail('text_invalid');
  }
  return value;
}
function id(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value)) fail('identity_invalid');
  return value;
}
function time(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) fail('timestamp_invalid');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) fail('timestamp_invalid');
  return value;
}
function choice(value, allowed) { if (!allowed.includes(value)) fail('field_invalid'); return value; }
function boolean(value) { if (typeof value !== 'boolean') fail('field_invalid'); return value; }
function token(value) { return value === null ? null : text(value, runtimeConfigLimits.token); }
function paths(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail('array_invalid');
  if (value.length > runtimeConfigLimits.paths) fail('limit_exceeded');
  for (const key of Reflect.ownKeys(value)) if (key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) fail('array_invalid');
  const result = [];
  for (let index = 0; index < value.length; index++) {
    const field = Object.getOwnPropertyDescriptor(value, String(index));
    if (!field || !own(field, 'value') || !field.enumerable) fail('array_invalid');
    result.push(text(field.value, runtimeConfigLimits.path));
  }
  if (new Set(result).size !== result.length) fail('path_duplicate');
  return result;
}
function freeze(value) { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
function finish(value) {
  if (new TextEncoder().encode(JSON.stringify(value)).length > runtimeConfigLimits.bytes) fail('limit_exceeded');
  return freeze(value);
}

export function normalizeRuntimeBinding(value) {
  const input = record(value, ['orgId', 'instanceId', 'generation', 'installationId', 'releaseCommit']);
  if (!Number.isSafeInteger(input.generation) || input.generation < 1 || input.generation > 1_000_000) fail('generation_invalid');
  if (typeof input.releaseCommit !== 'string' || !/^[a-f0-9]{40}$/.test(input.releaseCommit)) fail('release_invalid');
  const result = { orgId: id(input.orgId), instanceId: id(input.instanceId), generation: input.generation, installationId: id(input.installationId), releaseCommit: input.releaseCommit };
  if (result.orgId === result.instanceId) fail('ownership_mismatch');
  return finish(result);
}

export function normalizeConfigObservation(value) {
  const input = record(value, ['binding', 'observedAt', 'valid', 'rawToken', 'sourceToken', 'appliedToken']);
  const result = { binding: normalizeRuntimeBinding(input.binding), observedAt: time(input.observedAt), valid: boolean(input.valid), rawToken: token(input.rawToken), sourceToken: token(input.sourceToken), appliedToken: token(input.appliedToken) };
  if (result.valid !== (result.sourceToken !== null)) fail('observation_invalid');
  const application = result.sourceToken === null || result.appliedToken === null ? 'unavailable' : result.sourceToken === result.appliedToken ? 'applied' : 'unapplied';
  return finish({ ...result, application, readiness: 'unproven', ready: false });
}

export function normalizeConfigReceipt(value) {
  const input = record(value, ['binding', 'operationId', 'receivedAt', 'method', 'outcome', 'rawToken', 'noop', 'restartRequired', 'changedPaths']);
  const result = {
    binding: normalizeRuntimeBinding(input.binding), operationId: id(input.operationId), receivedAt: time(input.receivedAt),
    method: choice(input.method, ['set', 'apply', 'patch']), outcome: choice(input.outcome, ['success', 'committed-unapplied', 'rejected', 'publication-failed']),
    rawToken: token(input.rawToken), noop: boolean(input.noop), restartRequired: input.restartRequired === null ? null : boolean(input.restartRequired),
    changedPaths: input.changedPaths === null ? null : paths(input.changedPaths),
  };
  if (result.method !== 'patch' && result.changedPaths !== null) fail('receipt_invalid');
  if (result.outcome === 'success' && result.method === 'patch' && result.changedPaths === null) fail('receipt_invalid');
  if (result.outcome !== 'success' && result.changedPaths !== null) fail('receipt_invalid');
  if (result.method === 'set' && (result.restartRequired !== null || result.outcome === 'committed-unapplied')) fail('receipt_invalid');
  if (result.noop && (result.method !== 'patch' || result.outcome !== 'success' || result.rawToken !== null || result.restartRequired !== null || result.changedPaths.length !== 0)) fail('receipt_invalid');
  if (['rejected', 'publication-failed'].includes(result.outcome) && (result.rawToken !== null || result.restartRequired !== null || result.noop)) fail('receipt_invalid');
  const persistence = (result.outcome === 'success' && !result.noop) || result.outcome === 'committed-unapplied' ? 'confirmed' : 'not-established';
  const application = result.outcome === 'committed-unapplied' ? 'committed-unapplied'
    : result.outcome !== 'success' || result.noop ? 'unproven'
    : result.method === 'set' ? 'persistence-only'
    : result.restartRequired === true ? 'restart-required'
    : result.restartRequired === false ? 'reported-applied' : 'unproven';
  return finish({ ...result, persistence, application, readiness: 'unproven', ready: false });
}

export function reconcileConfigReceipt(receiptValue, observationValue) {
  const receipt = normalizeConfigReceipt(receiptValue), observation = normalizeConfigObservation(observationValue);
  for (const key of ['orgId', 'instanceId', 'generation', 'installationId', 'releaseCommit']) if (receipt.binding[key] !== observation.binding[key]) fail('binding_mismatch');
  if (observation.observedAt < receipt.receivedAt) fail('timestamp_order');
  const rawRevision = receipt.persistence !== 'confirmed' || receipt.rawToken === null || observation.rawToken === null ? 'unavailable'
    : receipt.rawToken === observation.rawToken ? 'matched' : 'changed';
  return finish({ binding: receipt.binding, operationId: receipt.operationId, receivedAt: receipt.receivedAt, observedAt: observation.observedAt,
    receiptOutcome: receipt.outcome, receiptApplication: receipt.application, rawRevision,
    writeApplication: rawRevision === 'matched' ? observation.application : 'unavailable', observedApplication: observation.application,
    readiness: 'unproven', ready: false });
}
