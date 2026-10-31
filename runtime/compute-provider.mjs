import { createHash } from 'node:crypto';
import { normalizeRuntimeBinding } from './config-observation.mjs';

export const computeLimits = Object.freeze({ responseBytes: 262144, timeoutMs: 10000, actions: 16, resources: 8 });
const actions = ['create', 'poweron', 'shutdown', 'delete'];
const states = ['reserved', 'uncertain', 'pending', 'succeeded', 'failed'];
const statuses = ['initializing', 'starting', 'running', 'stopping', 'off', 'deleting', 'rebuilding', 'migrating', 'unknown', 'absent'];
const codes = ['transport_unavailable', 'request_timeout', 'response_invalid', 'response_limit', 'provider_unavailable', 'provider_rejected', 'ownership_mismatch', 'resource_missing', 'recovery_ambiguous', 'action_failed', 'unauthorized', 'forbidden', 'rate_limit_exceeded', 'protected', 'locked', 'resource_limit_exceeded', 'resource_unavailable'];
export class ComputeProviderError extends Error {
  constructor(code) { super(`business_claw_compute_${code}`); this.name = 'ComputeProviderError'; this.code = code; }
}
const fail = code => { throw new ComputeProviderError(code); };
function record(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('record_invalid');
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !fields.includes(key) || !d.enumerable || !Object.hasOwn(d, 'value')) fail('field_invalid');
  }
  for (const key of fields) if (!Object.hasOwn(value, key)) fail('field_invalid');
  return value;
}
function array(value, maximum, convert) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) fail('array_invalid');
  for (const key of Reflect.ownKeys(value)) if (key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) fail('array_invalid');
  const result = [];
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) fail('array_invalid');
    result.push(convert(d.value));
  }
  if (new Set(result).size !== result.length) fail('array_duplicate');
  return result;
}
function uuid(value) { if (typeof value !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value)) fail('identity_invalid'); return value; }
function integer(value) { if (!Number.isSafeInteger(value) || value < 1) fail('integer_invalid'); return value; }
function nullableId(value) { return value === null ? null : integer(value); }
function name(value) { if (typeof value !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)) fail('name_invalid'); return value; }
function choice(value, allowed) { if (!allowed.includes(value)) fail('field_invalid'); return value; }
function time(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) fail('timestamp_invalid');
  const d = new Date(value); if (!Number.isFinite(d.getTime()) || d.toISOString() !== value) fail('timestamp_invalid'); return value;
}
function hash(value) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail('hash_invalid'); return value; }
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function binding(value) { try { return normalizeRuntimeBinding(value); } catch { fail('binding_invalid'); } }
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function manifest(value) {
  const v = record(value, ['creationRequestId', 'name', 'serverType', 'location', 'imageId', 'networkIds', 'firewallIds', 'volumeIds', 'sshKeyIds', 'ipv4Id', 'ipv6Id']);
  const result = { creationRequestId: uuid(v.creationRequestId), name: name(v.name), serverType: name(v.serverType), location: name(v.location), imageId: integer(v.imageId),
    networkIds: array(v.networkIds, 3, integer), firewallIds: array(v.firewallIds, computeLimits.resources, integer),
    volumeIds: array(v.volumeIds, computeLimits.resources, integer), sshKeyIds: array(v.sshKeyIds, computeLimits.resources, integer),
    ipv4Id: nullableId(v.ipv4Id), ipv6Id: nullableId(v.ipv6Id) };
  if (!result.networkIds.length || !result.firewallIds.length || !result.sshKeyIds.length) fail('manifest_invalid');
  return freeze(result);
}
export function normalizeComputeAdmission(value) {
  const v = record(value, ['operationId', 'requestId', 'fence', 'binding', 'action', 'serverId', 'manifest']);
  const result = { operationId: uuid(v.operationId), requestId: uuid(v.requestId), fence: integer(v.fence), binding: binding(v.binding), action: choice(v.action, actions), serverId: nullableId(v.serverId), manifest: manifest(v.manifest) };
  if ((result.action === 'create') !== (result.serverId === null)) fail('target_invalid');
  if (result.action === 'create' && result.requestId !== result.manifest.creationRequestId) fail('target_invalid');
  return freeze(result);
}
export function computeRequestHash(value) {
  const a = normalizeComputeAdmission(value);
  return createHash('sha256').update(JSON.stringify({ operationId: a.operationId, requestId: a.requestId, binding: a.binding, action: a.action, serverId: a.serverId, manifest: a.manifest })).digest('hex');
}
export function normalizeComputeDescriptor(value) {
  const v = record(value, ['operationId', 'requestId', 'fence', 'binding', 'action', 'serverId', 'requestHash', 'observedAt']);
  const result = { operationId: uuid(v.operationId), requestId: uuid(v.requestId), fence: integer(v.fence), binding: binding(v.binding), action: choice(v.action, actions), serverId: nullableId(v.serverId), requestHash: hash(v.requestHash), observedAt: time(v.observedAt) };
  if ((result.action === 'create') !== (result.serverId === null)) fail('target_invalid');
  return freeze(result);
}
export function normalizeComputeReceipt(value) {
  const v = record(value, ['operationId', 'requestId', 'fence', 'binding', 'action', 'requestHash', 'revision', 'state', 'serverId', 'actionIds', 'providerStatus', 'actionStatus', 'observedAt', 'errorCode']);
  const result = { operationId: uuid(v.operationId), requestId: uuid(v.requestId), fence: integer(v.fence), binding: binding(v.binding), action: choice(v.action, actions), requestHash: hash(v.requestHash),
    revision: integer(v.revision), state: choice(v.state, states), serverId: nullableId(v.serverId), actionIds: array(v.actionIds, computeLimits.actions, integer),
    providerStatus: v.providerStatus === null ? null : choice(v.providerStatus, statuses), actionStatus: v.actionStatus === null ? null : choice(v.actionStatus, ['running', 'success', 'error']),
    observedAt: time(v.observedAt), errorCode: v.errorCode === null ? null : choice(v.errorCode, codes) };
  if (result.action !== 'create' && result.serverId === null) fail('target_invalid');
  if (result.serverId === null && result.actionIds.length) fail('target_invalid');
  if (result.state === 'reserved' && (result.revision !== 1 || result.actionIds.length || result.providerStatus !== null || result.actionStatus !== null || result.errorCode !== null)) fail('receipt_invalid');
  if (['uncertain', 'failed'].includes(result.state) && result.errorCode === null) fail('receipt_invalid');
  if (['pending', 'succeeded'].includes(result.state) && (result.serverId === null || result.errorCode !== null)) fail('receipt_invalid');
  if (result.state === 'succeeded' && (result.providerStatus !== (result.action === 'delete' ? 'absent' : result.action === 'poweron' ? 'running' : 'off') || ['running', 'error'].includes(result.actionStatus))) fail('receipt_invalid');
  return freeze(result);
}
function labels(a) {
  return { bc_org: a.binding.orgId, bc_instance: a.binding.instanceId, bc_generation: String(a.binding.generation), bc_installation: a.binding.installationId, bc_release: a.binding.releaseCommit, bc_request: a.manifest.creationRequestId };
}
function sameSet(actual, expected) { return actual.length === expected.length && new Set(actual).size === actual.length && actual.every(id => expected.includes(id)); }
function server(raw, a, expectedId, complete = true) {
  const m = a.manifest, b = labels(a);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Number.isSafeInteger(raw.id) || raw.id < 1) fail('response_invalid');
  if (raw.id !== expectedId || Object.entries(b).some(([k, v]) => !raw.labels || !Object.hasOwn(raw.labels, k) || raw.labels[k] !== v)) fail('ownership_mismatch');
  if (raw.name !== m.name || raw.server_type?.name !== m.serverType || raw.location?.name !== m.location || raw.image?.id !== m.imageId || typeof raw.locked !== 'boolean') fail('ownership_mismatch');
  if (complete && (!Array.isArray(raw.private_net) || !sameSet(raw.private_net.map(n => n?.network), m.networkIds) || !Array.isArray(raw.volumes) || !sameSet(raw.volumes, m.volumeIds) || !Array.isArray(raw.public_net?.firewalls) || !sameSet(raw.public_net.firewalls.map(f => f?.id), m.firewallIds))) fail('ownership_mismatch');
  if (complete && ((raw.public_net.ipv4?.id ?? null) !== m.ipv4Id || (raw.public_net.ipv6?.id ?? null) !== m.ipv6Id)) fail('ownership_mismatch');
  return { id: raw.id, status: statuses.includes(raw.status) && raw.status !== 'absent' ? raw.status : 'unknown', locked: raw.locked };
}
function action(raw, serverId, expectedId = null) {
  if (!raw || typeof raw !== 'object' || !Number.isSafeInteger(raw.id) || raw.id < 1 || raw.id !== (expectedId ?? raw.id) || !['running', 'success', 'error'].includes(raw.status) || !Array.isArray(raw.resources) || !raw.resources.some(r => r?.type === 'server' && r.id === serverId) || raw.resources.some(r => r?.type === 'server' && r.id !== serverId)) fail('response_invalid');
  return { id: raw.id, status: raw.status };
}
function initial(d) { return normalizeComputeReceipt({ operationId: d.operationId, requestId: d.requestId, fence: d.fence, binding: d.binding, action: d.action, requestHash: d.requestHash, revision: 1, state: 'reserved', serverId: d.serverId, actionIds: [], providerStatus: null, actionStatus: null, observedAt: d.observedAt, errorCode: null }); }
function matched(r, d) {
  for (const key of ['operationId', 'requestId', 'fence', 'binding', 'action', 'requestHash']) if (!equal(r[key], d[key])) fail('ledger_mismatch');
  if (d.serverId !== null && r.serverId !== d.serverId) fail('ledger_mismatch');
  if (r.observedAt > d.observedAt) fail('timestamp_order');
  return r;
}

export function createComputeProvider({ transport, admission, ledger, clock, timeoutMs = computeLimits.timeoutMs } = {}) {
  if (typeof transport !== 'function' || typeof admission?.authorize !== 'function' || typeof ledger?.reserve !== 'function' || typeof ledger?.read !== 'function' || typeof ledger?.commit !== 'function' || typeof clock !== 'function') fail('ports_unavailable');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > computeLimits.timeoutMs) fail('timeout_invalid');
  const now = () => time(clock());
  async function admitted(operationId) {
    uuid(operationId);
    let value; try { value = await admission.authorize(operationId); } catch { fail('admission_denied'); }
    const a = normalizeComputeAdmission(value); if (a.operationId !== operationId) fail('admission_denied');
    const d = normalizeComputeDescriptor({ operationId: a.operationId, requestId: a.requestId, fence: a.fence, binding: a.binding, action: a.action, serverId: a.serverId, requestHash: computeRequestHash(a), observedAt: now() });
    return { a, d };
  }
  async function request(method, path, body = null) {
    const controller = new AbortController(); let timer, timedOut = false;
    try {
      const response = await Promise.race([
        Promise.resolve().then(() => transport(Object.freeze({ method, url: `https://api.hetzner.cloud/v1${path}`, body: body === null ? null : JSON.stringify(body), signal: controller.signal, maxResponseBytes: computeLimits.responseBytes }))),
        new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(new ComputeProviderError('request_timeout')); controller.abort(); }, timeoutMs); }),
      ]);
      if (timedOut) fail('request_timeout');
      try { record(response, ['status', 'body']); } catch { fail('response_invalid'); }
      if (!Number.isSafeInteger(response.status) || response.status < 100 || response.status > 599 || typeof response.body !== 'string') fail('response_invalid');
      if (Buffer.byteLength(response.body, 'utf8') > computeLimits.responseBytes) fail('response_limit');
      let data; try { data = JSON.parse(response.body); } catch { fail('response_invalid'); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) fail('response_invalid');
      return { status: response.status, data };
    } catch (e) { if (e instanceof ComputeProviderError) throw e; fail('transport_unavailable'); }
    finally { clearTimeout(timer); }
  }
  function checked(response, expected) {
    if (Array.isArray(expected) ? expected.includes(response.status) : response.status === expected) return response.data;
    const supplied = response.data.error?.code;
    const code = response.status >= 500 ? 'provider_unavailable' : ['unauthorized', 'forbidden', 'rate_limit_exceeded', 'protected', 'locked', 'resource_limit_exceeded', 'resource_unavailable'].includes(supplied) ? supplied : 'provider_rejected';
    fail(code);
  }
  async function fresh(a) {
    let current; try { current = normalizeComputeAdmission(await admission.authorize(a.operationId)); } catch { fail('admission_denied'); }
    if (!equal(current, a)) fail('admission_denied');
  }
  async function dependencies(a) {
    const m = a.manifest, required = labels(a);
    const groups = [['networks', 'network', m.networkIds], ['firewalls', 'firewall', m.firewallIds], ['volumes', 'volume', m.volumeIds], ['primary_ips', 'primary_ip', [m.ipv4Id, m.ipv6Id].filter(x => x !== null)]];
    for (const [path, key, ids] of groups) for (const id of ids) {
      const resource = checked(await request('GET', `/${path}/${id}`), 200)[key];
      if (!resource || resource.id !== id || ['bc_org', 'bc_instance', 'bc_generation', 'bc_installation'].some(k => !resource.labels || !Object.hasOwn(resource.labels, k) || resource.labels[k] !== required[k])) fail('ownership_mismatch');
      if (key === 'volume' && resource.server !== null) fail('ownership_mismatch');
      if (key === 'primary_ip' && (resource.assignee_id !== null || resource.location?.name !== m.location || resource.auto_delete !== false || resource.type !== (id === m.ipv4Id ? 'ipv4' : 'ipv6'))) fail('ownership_mismatch');
    }
  }
  async function save(r, patch) {
    const observedAt = now(); if (observedAt < r.observedAt) fail('timestamp_order');
    const next = normalizeComputeReceipt({ ...r, ...patch, revision: r.revision + 1, observedAt });
    let ok; try { ok = await ledger.commit(freeze({ expectedRevision: r.revision, receipt: next })); } catch { fail('ledger_unavailable'); }
    if (ok !== true) fail('ledger_conflict');
    return next;
  }
  const result = r => freeze({ receipt: r, persistence: 'confirmed', resourceExists: r.providerStatus === null ? null : r.providerStatus !== 'absent', ready: false, readiness: 'unproven' });
  async function observe(a, r) {
    let found = null;
    if (r.serverId === null) {
      const selector = Object.entries(labels(a)).map(([k, v]) => `${k}=${v}`).join(',');
      const data = checked(await request('GET', `/servers?label_selector=${encodeURIComponent(selector)}&per_page=50&page=1`), 200);
      if (!Array.isArray(data.servers) || data.servers.length > 50 || data.meta?.pagination?.next_page !== null) fail('response_invalid');
      if (data.servers.length > 1) fail('recovery_ambiguous');
      if (data.servers.length) found = server(data.servers[0], a, data.servers[0]?.id);
      else return save(r, { state: 'uncertain', errorCode: 'resource_missing' });
    } else {
      const response = await request('GET', `/servers/${r.serverId}`);
      if (response.status === 404) {
        const observed = [];
        for (const id of r.actionIds) observed.push(action(checked(await request('GET', `/actions/${id}`), 200).action, r.serverId, id));
        const actionStatus = observed.some(x => x.status === 'error') ? 'error' : observed.some(x => x.status === 'running') ? 'running' : observed.length ? 'success' : null;
        return save(r, { state: a.action !== 'delete' || actionStatus === 'error' ? 'failed' : actionStatus === 'running' ? 'pending' : 'succeeded', providerStatus: 'absent', actionStatus, errorCode: actionStatus === 'error' ? 'action_failed' : a.action === 'delete' ? null : 'resource_missing' });
      }
      found = server(checked(response, 200).server, a, r.serverId);
    }
    const observed = [];
    for (const id of r.actionIds) observed.push(action(checked(await request('GET', `/actions/${id}`), 200).action, found.id, id));
    const actionStatus = observed.some(x => x.status === 'error') ? 'error' : observed.some(x => x.status === 'running') ? 'running' : observed.length ? 'success' : null;
    const desired = a.action === 'poweron' ? 'running' : 'off';
    const done = a.action !== 'delete' && found.status === desired && !found.locked && actionStatus !== 'running';
    return save(r, { serverId: found.id, providerStatus: found.status, actionStatus, state: actionStatus === 'error' ? 'failed' : done ? 'succeeded' : 'pending', errorCode: actionStatus === 'error' ? 'action_failed' : null });
  }
  async function reconcileWith(a, d, raw) {
    if (raw === null) fail('operation_missing');
    const r = matched(normalizeComputeReceipt(raw), d);
    try { return result(await observe(a, r)); }
    catch (e) {
      if (!(e instanceof ComputeProviderError) || !codes.includes(e.code)) throw e;
      return result(await save(r, { state: 'uncertain', errorCode: e.code }));
    }
  }
  return Object.freeze({
    async execute(operationId) {
      const { a, d } = await admitted(operationId);
      let reservation; try { reservation = await ledger.reserve(d); } catch { fail('ledger_unavailable'); }
      record(reservation, ['acquired', 'receipt']); if (typeof reservation.acquired !== 'boolean') fail('ledger_mismatch');
      let r = matched(normalizeComputeReceipt(reservation.receipt), d);
      if (!reservation.acquired) return reconcileWith(a, d, r);
      if (!equal(r, initial(d))) fail('ledger_mismatch');
      try {
        let response;
        if (a.action === 'create') {
          const m = a.manifest;
          await dependencies(a); await fresh(a);
          response = await request('POST', '/servers', { name: m.name, server_type: m.serverType, location: m.location, image: m.imageId, ssh_keys: m.sshKeyIds, labels: labels(a), start_after_create: false, automount: false, volumes: m.volumeIds, networks: m.networkIds, firewalls: m.firewallIds.map(id => ({ firewall: id })), public_net: { enable_ipv4: m.ipv4Id !== null, enable_ipv6: m.ipv6Id !== null, ...(m.ipv4Id === null ? {} : { ipv4: m.ipv4Id }), ...(m.ipv6Id === null ? {} : { ipv6: m.ipv6Id }) } });
          const data = checked(response, 201), found = server(data.server, a, data.server?.id, false);
          if (!Array.isArray(data.next_actions) || data.next_actions.length >= computeLimits.actions) fail('response_invalid');
          const received = [action(data.action, found.id), ...data.next_actions.map(x => action(x, found.id))];
          if (new Set(received.map(x => x.id)).size !== received.length) fail('response_invalid');
          r = await save(r, { serverId: found.id, actionIds: received.map(x => x.id), providerStatus: found.status, actionStatus: received.some(x => x.status === 'error') ? 'error' : received.some(x => x.status === 'running') ? 'running' : 'success', state: received.some(x => x.status === 'error') ? 'failed' : 'pending', errorCode: received.some(x => x.status === 'error') ? 'action_failed' : null });
        } else {
          const current = checked(await request('GET', `/servers/${a.serverId}`), 200);
          server(current.server, a, a.serverId);
          await fresh(a);
          response = await request(a.action === 'delete' ? 'DELETE' : 'POST', a.action === 'delete' ? `/servers/${a.serverId}` : `/servers/${a.serverId}/actions/${a.action}`);
          const received = action(checked(response, a.action === 'delete' ? 200 : [200, 201]).action, a.serverId);
          r = await save(r, { actionIds: [received.id], actionStatus: received.status, state: received.status === 'error' ? 'failed' : 'pending', errorCode: received.status === 'error' ? 'action_failed' : null });
        }
        return result(r);
      } catch (e) {
        if (!(e instanceof ComputeProviderError) || !codes.includes(e.code)) throw e;
        const uncertain = ['transport_unavailable', 'request_timeout', 'response_invalid', 'response_limit', 'provider_unavailable'].includes(e.code);
        return result(await save(r, { state: uncertain ? 'uncertain' : 'failed', errorCode: e.code }));
      }
    },
    async reconcile(operationId) {
      const { a, d } = await admitted(operationId);
      let raw; try { raw = await ledger.read(operationId); } catch { fail('ledger_unavailable'); }
      return reconcileWith(a, d, raw);
    },
  });
}
