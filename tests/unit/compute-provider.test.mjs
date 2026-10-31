import test from 'node:test';
import assert from 'node:assert/strict';
import { createComputeProvider, normalizeComputeAdmission, normalizeComputeDescriptor, normalizeComputeReceipt, computeRequestHash, computeLimits } from '../../runtime/compute-provider.mjs';

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-10-31T12:00:00.000Z';
const clone = value => structuredClone(value);
const binding = () => ({ orgId: uuid(1), instanceId: uuid(2), generation: 1, installationId: uuid(3), releaseCommit: 'a'.repeat(40) });
const grant = overrides => ({ operationId: uuid(4), requestId: uuid(5), fence: 1, binding: binding(), action: 'create', serverId: null,
  manifest: { creationRequestId: uuid(5), name: 'claw-org-one', serverType: 'cx23', location: 'nbg1', imageId: 10, networkIds: [11], firewallIds: [12], volumeIds: [13], sshKeyIds: [14], ipv4Id: 15, ipv6Id: 16 }, ...overrides });
const labels = a => ({ bc_org: a.binding.orgId, bc_instance: a.binding.instanceId, bc_generation: String(a.binding.generation), bc_installation: a.binding.installationId, bc_release: a.binding.releaseCommit, bc_request: a.manifest.creationRequestId });
const server = (a, overrides) => ({ id: 101, name: a.manifest.name, labels: labels(a), server_type: { name: 'cx23' }, location: { name: 'nbg1' }, image: { id: 10 }, locked: false, status: 'off', private_net: [{ network: 11 }], volumes: [13], public_net: { ipv4: { id: 15 }, ipv6: { id: 16 }, firewalls: [{ id: 12 }] }, ...overrides });
const action = (id = 201, status = 'running', serverId = 101) => ({ id, status, command: 'provider-owned', resources: [{ type: 'server', id: serverId }] });
const response = (status, body) => ({ status, body: JSON.stringify(body) });
function fixture(input = grant()) {
  const f = { input, rows: new Map(), calls: [], providerServer: server(input), providerAction: action(), nextActions: [], now: at, commitOK: true, reserveThrow: false, authorizeCalls: 0, handler: null };
  const admission = { authorize: async id => { f.authorizeCalls++; if (id !== f.input.operationId) throw Error('private admission detail'); return clone(f.input); } };
  const ledger = {
    async reserve(d) {
      if (f.reserveThrow) throw Error('private DB detail');
      const existing = f.rows.get(d.operationId);
      if (existing) return { acquired: false, receipt: clone(existing) };
      const receipt = { operationId: d.operationId, requestId: d.requestId, fence: d.fence, binding: clone(d.binding), action: d.action, requestHash: d.requestHash, revision: 1, state: 'reserved', serverId: d.serverId, actionIds: [], providerStatus: null, actionStatus: null, observedAt: d.observedAt, errorCode: null };
      f.rows.set(d.operationId, clone(receipt)); return { acquired: true, receipt };
    },
    async read(id) { return clone(f.rows.get(id) ?? null); },
    async commit({ expectedRevision, receipt }) {
      const old = f.rows.get(receipt.operationId);
      if (!f.commitOK || old?.revision !== expectedRevision || old.fence !== receipt.fence) return false;
      f.rows.set(receipt.operationId, clone(receipt)); return true;
    },
  };
  const transport = async request => {
    const url = new URL(request.url), body = request.body === null ? null : JSON.parse(request.body);
    f.calls.push({ method: request.method, path: url.pathname, search: url.search, body, signal: request.signal, maximum: request.maxResponseBytes });
    const override = await f.handler?.(request, url, body);
    if (override !== undefined) return override;
    if (request.method === 'GET' && /^\/v1\/(networks|firewalls|volumes|primary_ips)\//.test(url.pathname)) {
      const [, , type, rawId] = url.pathname.split('/'), id = Number(rawId), key = { networks: 'network', firewalls: 'firewall', volumes: 'volume', primary_ips: 'primary_ip' }[type];
      return response(200, { [key]: { id, labels: labels(f.input), server: null, assignee_id: null, location: { name: 'nbg1' }, auto_delete: false, type: id === 15 ? 'ipv4' : 'ipv6' } });
    }
    if (request.method === 'POST' && url.pathname === '/v1/servers') return response(201, { server: f.providerServer, action: f.providerAction, next_actions: f.nextActions, root_password: 'do-not-publish-this-secret' });
    if (request.method === 'GET' && url.pathname === '/v1/servers') return response(200, { servers: f.providerServer ? [f.providerServer] : [], meta: { pagination: { next_page: null } } });
    if (request.method === 'GET' && url.pathname === '/v1/servers/101') return f.providerServer ? response(200, { server: f.providerServer }) : response(404, { error: { code: 'not_found' } });
    if (request.method === 'GET' && /^\/v1\/actions\//.test(url.pathname)) return response(200, { action: { ...f.providerAction, id: Number(url.pathname.split('/').at(-1)) } });
    if (request.method === 'POST' && /^\/v1\/servers\/101\/actions\/(poweron|shutdown)$/.test(url.pathname)) return response(201, { action: f.providerAction });
    if (request.method === 'DELETE' && url.pathname === '/v1/servers/101') return response(200, { action: f.providerAction });
    throw Error('unexpected fixture request');
  };
  f.ports = { transport, admission, ledger, clock: () => f.now };
  f.adapter = createComputeProvider(f.ports); return f;
}
const writes = f => f.calls.filter(c => c.method !== 'GET');

test('missing trusted ports and malformed caller IDs cannot dispatch or consult admission', async () => {
  assert.throws(() => createComputeProvider(), /ports_unavailable/);
  const f = fixture(); await assert.rejects(f.adapter.execute({ operationId: uuid(4), approved: true }), /identity_invalid/);
  await assert.rejects(f.adapter.execute('https://evil.test'), /identity_invalid/);
  assert.equal(f.authorizeCalls, 0); assert.equal(f.calls.length, 0);
  for (const timeoutMs of [0, 10001, Infinity, 1.5]) assert.throws(() => createComputeProvider({ ...f.ports, timeoutMs }), /timeout_invalid/);
});

test('creation preflights owned dependencies and persists asynchronous IDs without credentials or readiness', async () => {
  const f = fixture(), out = await f.adapter.execute(uuid(4));
  assert.deepEqual(f.calls.slice(0, 5).map(c => c.path), ['/v1/networks/11', '/v1/firewalls/12', '/v1/volumes/13', '/v1/primary_ips/15', '/v1/primary_ips/16']);
  assert.equal(f.authorizeCalls, 2); assert.equal(writes(f).length, 1);
  const post = writes(f)[0]; assert.equal(post.path, '/v1/servers'); assert.equal(post.body.start_after_create, false); assert.equal(post.body.automount, false);
  assert.deepEqual(post.body.public_net, { enable_ipv4: true, enable_ipv6: true, ipv4: 15, ipv6: 16 });
  assert.deepEqual(post.body.firewalls, [{ firewall: 12 }]); assert.deepEqual(post.body.labels, labels(f.input));
  assert.equal(Object.hasOwn(post.body, 'user_data'), false); assert.equal(Object.hasOwn(post.body, 'root_password'), false);
  assert.equal(out.receipt.state, 'pending'); assert.equal(out.receipt.serverId, 101); assert.deepEqual(out.receipt.actionIds, [201]);
  assert.equal(out.persistence, 'confirmed'); assert.equal(out.ready, false); assert.equal(out.readiness, 'unproven');
  assert.equal(JSON.stringify(out).includes('do-not-publish'), false); assert.equal(Object.isFrozen(out.receipt.binding), true);
});

test('action success and exact powered-off observation are both required after asynchronous creation', async () => {
  const f = fixture(); f.providerServer.locked = true; f.providerServer.volumes = [];
  const created = await f.adapter.execute(uuid(4)); assert.equal(created.receipt.serverId, 101); assert.equal(created.receipt.state, 'pending');
  const incomplete = await f.adapter.reconcile(uuid(4)); assert.equal(incomplete.receipt.state, 'uncertain'); assert.equal(incomplete.receipt.errorCode, 'ownership_mismatch');
  f.providerServer = server(f.input); const running = await f.adapter.reconcile(uuid(4)); assert.equal(running.receipt.state, 'pending');
  f.providerAction.status = 'success'; const done = await f.adapter.reconcile(uuid(4)); assert.equal(done.receipt.state, 'succeeded'); assert.equal(done.ready, false);
  assert.equal(writes(f).length, 1);
});

test('lost creation acknowledgement recovers by stable owned request labels and never resends allocation', async () => {
  const f = fixture(); f.handler = async r => { if (r.method === 'POST') throw Error('secret provider connection'); };
  const lost = await f.adapter.execute(uuid(4)); assert.equal(lost.receipt.state, 'uncertain'); assert.equal(lost.receipt.serverId, null);
  f.handler = null;
  const recovered = await f.adapter.execute(uuid(4)); assert.equal(recovered.receipt.serverId, 101); assert.equal(recovered.receipt.state, 'succeeded'); assert.equal(recovered.receipt.actionStatus, null);
  const query = f.calls.find(c => c.search); assert.match(decodeURIComponent(query.search), /bc_request=00000000-0000-4000-8000-000000000005/);
  assert.equal(writes(f).length, 1); assert.equal(recovered.ready, false);
});

test('missing ambiguous or paginated lost-ack recovery cannot allocate another server', async () => {
  for (const mode of ['missing', 'duplicate', 'pagination']) {
    const f = fixture(); f.handler = async r => { if (r.method === 'POST') throw Error('lost'); };
    await f.adapter.execute(uuid(4));
    f.handler = async (r, url) => url.pathname === '/v1/servers' ? response(200, { servers: mode === 'missing' ? [] : mode === 'duplicate' ? [f.providerServer, { ...f.providerServer, id: 102 }] : [f.providerServer], meta: { pagination: { next_page: mode === 'pagination' ? 2 : null } } }) : undefined;
    const out = await f.adapter.execute(uuid(4)); assert.equal(out.receipt.state, 'uncertain');
    assert.equal(out.receipt.errorCode, mode === 'missing' ? 'resource_missing' : mode === 'duplicate' ? 'recovery_ambiguous' : 'response_invalid'); assert.equal(writes(f).length, 1);
  }
});

test('foreign dependencies and withdrawn fresh admission fail before provider mutation', async () => {
  const f = fixture(); f.handler = async (r, url) => url.pathname === '/v1/volumes/13' ? response(200, { volume: { id: 13, server: null, labels: { ...labels(f.input), bc_org: uuid(90) } } }) : undefined;
  const foreign = await f.adapter.execute(uuid(4)); assert.equal(foreign.receipt.state, 'failed'); assert.equal(foreign.receipt.errorCode, 'ownership_mismatch'); assert.equal(writes(f).length, 0);
  const g = fixture(); g.ports.admission.authorize = async () => { if (++g.authorizeCalls > 1) throw Error('revoked'); return clone(g.input); };
  await assert.rejects(g.adapter.execute(uuid(4)), /admission_denied/); assert.equal(writes(g).length, 0); assert.equal(g.rows.get(uuid(4)).state, 'reserved');
});

test('every existing-target owner label and stored ID is checked before power or deletion', async () => {
  for (const actionName of ['poweron', 'shutdown', 'delete']) for (const field of ['bc_org', 'bc_instance', 'bc_generation', 'bc_installation', 'bc_release', 'bc_request', 'id']) {
    const f = fixture(grant({ action: actionName, serverId: 101, requestId: uuid(6) }));
    if (field === 'id') f.providerServer.id = 102; else f.providerServer.labels[field] = 'foreign';
    const out = await f.adapter.execute(uuid(4)); assert.equal(out.receipt.state, 'failed'); assert.equal(writes(f).length, 0);
  }
});

test('new power operation keeps creation identity and reconciles running state without a readiness grant', async () => {
  for (const status of [200, 201]) {
    const f = fixture(grant({ action: 'poweron', serverId: 101, requestId: uuid(6) }));
    f.handler = async r => r.method === 'POST' ? response(status, { action: f.providerAction }) : undefined;
    const out = await f.adapter.execute(uuid(4)); assert.equal(out.receipt.state, 'pending'); assert.equal(writes(f)[0].path, '/v1/servers/101/actions/poweron'); assert.equal(writes(f)[0].body, null);
    f.providerAction.status = 'success'; assert.equal((await f.adapter.reconcile(uuid(4))).receipt.state, 'pending');
    f.providerServer.status = 'running'; const running = await f.adapter.reconcile(uuid(4)); assert.equal(running.receipt.state, 'succeeded'); assert.equal(running.ready, false);
    await f.adapter.execute(uuid(4)); assert.equal(writes(f).length, 1);
  }
  const unsupported = fixture(grant({ action: 'poweron', serverId: 101, requestId: uuid(6) }));
  unsupported.handler = async r => r.method === 'POST' ? response(202, { action: unsupported.providerAction }) : undefined;
  assert.equal((await unsupported.adapter.execute(uuid(4))).receipt.state, 'failed'); assert.equal(writes(unsupported).length, 1);
});

test('graceful shutdown is explicit and never silently forces poweroff', async () => {
  for (const status of [200, 201]) {
    const f = fixture(grant({ action: 'shutdown', serverId: 101, requestId: uuid(6) })); f.providerServer.status = 'running';
    f.handler = async r => r.method === 'POST' ? response(status, { action: f.providerAction }) : undefined;
    await f.adapter.execute(uuid(4)); assert.equal(writes(f)[0].path, '/v1/servers/101/actions/shutdown');
    f.providerAction.status = 'success'; assert.equal((await f.adapter.reconcile(uuid(4))).receipt.state, 'pending');
    f.providerServer.status = 'off'; assert.equal((await f.adapter.reconcile(uuid(4))).receipt.state, 'succeeded');
    assert.equal(f.calls.some(c => c.path.endsWith('/poweroff')), false); assert.equal(writes(f).length, 1);
  }
});

test('deletion needs absent exact resource and terminal action while retaining external resource limits', async () => {
  const f = fixture(grant({ action: 'delete', serverId: 101, requestId: uuid(6) }));
  await f.adapter.execute(uuid(4)); assert.equal(writes(f)[0].method, 'DELETE');
  f.providerServer = null; const waiting = await f.adapter.reconcile(uuid(4)); assert.equal(waiting.receipt.state, 'pending'); assert.equal(waiting.resourceExists, false);
  f.providerAction.status = 'success'; const removed = await f.adapter.reconcile(uuid(4)); assert.equal(removed.receipt.state, 'succeeded'); assert.equal(removed.receipt.serverId, 101); assert.equal(removed.ready, false);
  assert.deepEqual(writes(f).map(c => c.path), ['/v1/servers/101']); assert.equal(JSON.stringify(removed).includes('physical'), false);
});

test('wrong action resources duplicate IDs and failed provider actions never establish successful compute', async () => {
  for (const mode of ['foreign', 'duplicate', 'error']) {
    const f = fixture(); if (mode === 'foreign') f.providerAction = action(201, 'success', 102);
    if (mode === 'duplicate') f.nextActions = [action()]; if (mode === 'error') f.providerAction.status = 'error';
    const out = await f.adapter.execute(uuid(4)); assert.equal(out.receipt.state, mode === 'error' ? 'failed' : 'uncertain');
    assert.equal(writes(f).length, 1); assert.notEqual(f.rows.get(uuid(4)).state, 'succeeded');
  }
});

test('provider rejection rate limits malformed bodies and server failures remain bounded redacted outcomes', async () => {
  for (const [status, body, expectedState, expectedCode] of [[403, JSON.stringify({ error: { code: 'forbidden', message: 'secret' } }), 'failed', 'forbidden'], [429, JSON.stringify({ error: { code: 'rate_limit_exceeded' } }), 'failed', 'rate_limit_exceeded'], [503, '{}', 'uncertain', 'provider_unavailable'], [201, 'invalid JSON secret', 'uncertain', 'response_invalid'], [201, 'x'.repeat(computeLimits.responseBytes + 1), 'uncertain', 'response_limit']]) {
    const f = fixture(); f.handler = async r => r.method === 'POST' ? { status, body } : undefined;
    const out = await f.adapter.execute(uuid(4)); assert.equal(out.receipt.state, expectedState); assert.equal(out.receipt.errorCode, expectedCode); assert.equal(JSON.stringify(out).includes('secret'), false);
    assert.ok(f.calls.every(c => c.maximum === 262144 && c.signal instanceof AbortSignal)); assert.equal(writes(f).length, 1);
  }
});

test('transport deadline aborts a hung creation and its next attempt only observes', async () => {
  const f = fixture(); let signal;
  f.handler = async r => { if (r.method === 'POST') { signal = r.signal; return new Promise(() => {}); } };
  f.adapter = createComputeProvider({ ...f.ports, timeoutMs: 10 });
  const out = await f.adapter.execute(uuid(4)); assert.equal(out.receipt.state, 'uncertain'); assert.equal(out.receipt.errorCode, 'request_timeout'); assert.equal(signal.aborted, true);
  f.handler = null; await f.adapter.execute(uuid(4)); assert.equal(writes(f).length, 1);
  const late = fixture();
  late.handler = async r => r.method === 'POST' ? new Promise(resolve => r.signal.addEventListener('abort', () => resolve(response(201, { server: late.providerServer, action: action(201, 'success'), next_actions: [] })), { once: true })) : undefined;
  late.adapter = createComputeProvider({ ...late.ports, timeoutMs: 10 });
  const expired = await late.adapter.execute(uuid(4)); assert.equal(expired.receipt.state, 'uncertain'); assert.equal(expired.receipt.errorCode, 'request_timeout'); assert.equal(expired.receipt.serverId, null);
});

test('durable reservation and CAS failures do not permit a second mutation or false persistence result', async () => {
  const denied = fixture(); denied.reserveThrow = true; await assert.rejects(denied.adapter.execute(uuid(4)), /ledger_unavailable/); assert.equal(denied.calls.length, 0);
  const f = fixture(); f.commitOK = false;
  await assert.rejects(f.adapter.execute(uuid(4)), /ledger_conflict/); assert.equal(f.rows.get(uuid(4)).state, 'reserved'); assert.equal(writes(f).length, 1);
  f.commitOK = true; await f.adapter.execute(uuid(4)); assert.equal(writes(f).length, 1);
  f.input.fence = 2; await assert.rejects(f.adapter.execute(uuid(4)), /ledger_mismatch/); assert.equal(writes(f).length, 1);
  f.input.fence = 1; f.input.manifest.imageId = 99; await assert.rejects(f.adapter.reconcile(uuid(4)), /ledger_mismatch/); assert.equal(writes(f).length, 1);
});

test('strict DTOs reject getters inheritance sparse arrays unsafe IDs and contradictory receipts without mutation', () => {
  const a = grant(), original = clone(a); const normalized = normalizeComputeAdmission(a); assert.deepEqual(a, original); assert.equal(Object.isFrozen(a.manifest), false); assert.equal(Object.isFrozen(normalized.manifest.networkIds), true);
  let reads = 0; const getter = grant(); Object.defineProperty(getter, 'manifest', { enumerable: true, get() { reads++; return a.manifest; } });
  assert.throws(() => normalizeComputeAdmission(getter), /field_invalid/); assert.equal(reads, 0);
  for (const bad of [Object.assign(Object.create({ approved: true }), a), { ...a, approved: true }, { ...a, serverId: 101 }, { ...a, manifest: { ...a.manifest, networkIds: [, 11] } }, { ...a, manifest: { ...a.manifest, networkIds: [11, 11] } }, { ...a, manifest: { ...a.manifest, imageId: Number.MAX_SAFE_INTEGER + 1 } }, { ...a, manifest: { ...a.manifest, name: '../escape' } }, { ...a, manifest: { ...a.manifest, creationRequestId: uuid(90) } }]) assert.throws(() => normalizeComputeAdmission(bad));
  const d = normalizeComputeDescriptor({ operationId: a.operationId, requestId: a.requestId, fence: a.fence, binding: a.binding, action: a.action, serverId: null, requestHash: computeRequestHash(a), observedAt: at });
  const r = { operationId: d.operationId, requestId: d.requestId, fence: d.fence, binding: d.binding, action: d.action, requestHash: d.requestHash, revision: 1, state: 'reserved', serverId: null, actionIds: [], providerStatus: null, actionStatus: null, observedAt: at, errorCode: null };
  assert.throws(() => normalizeComputeReceipt({ ...r, state: 'succeeded' }), /receipt_invalid/); assert.throws(() => normalizeComputeReceipt({ ...r, observedAt: '2026-02-30T12:00:00.000Z' }), /timestamp_invalid/);
  assert.equal(computeRequestHash(a), computeRequestHash({ ...a, fence: 9 })); assert.notEqual(computeRequestHash(a), computeRequestHash({ ...a, manifest: { ...a.manifest, imageId: 99 } }));
});

test('backward clocks missing operations and mismatched server topology stay fenced without writes', async () => {
  const missing = fixture(); await assert.rejects(missing.adapter.reconcile(uuid(4)), /operation_missing/); assert.equal(missing.calls.length, 0);
  const f = fixture(); await f.adapter.execute(uuid(4)); f.now = '2026-10-31T11:59:59.999Z'; await assert.rejects(f.adapter.reconcile(uuid(4)), /timestamp_order/); assert.equal(writes(f).length, 1);
  const g = fixture(grant({ action: 'delete', serverId: 101, requestId: uuid(6) })); g.providerServer.volumes = [999];
  const out = await g.adapter.execute(uuid(4)); assert.equal(out.receipt.state, 'failed'); assert.equal(out.receipt.errorCode, 'ownership_mismatch'); assert.equal(writes(g).length, 0);
});
