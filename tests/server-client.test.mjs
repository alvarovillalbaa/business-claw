import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerClient, ServerRequestError } from '../web/server-client.mjs';

const orgId = '10000000-0000-4000-8000-000000000001';
const operationId = '10000000-0000-4000-8000-000000000002';
const user = { id: '10000000-0000-4000-8000-000000000003', email: 'authored@fixture.invalid' };
const session = (csrfToken, authenticated = false) => ({ authenticated, user: authenticated ? user : null, csrfToken, organizations: [], execution: { adapter: 'unbound', dispatchAllowed: false, chatAdmissionAllowed: false, readiness: 'unproven', ready: false } });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const bootstrapBody = () => ({ requestId: operationId, name: 'Authored organization' });
const rejectsCode = (promise, code, uncertain) => assert.rejects(promise, error => error instanceof ServerRequestError && error.code === code && error.uncertain === uncertain);

test('construction performs no request and BFF calls retain same-origin credentials and session CSRF', async () => {
  const calls = [], client = createServerClient({ fetchImpl: async (url, options) => { calls.push({ url, options }); return json(url.endsWith('/auth/session') ? session('opaque-csrf-one') : { acknowledged: true }); } });
  assert.equal(calls.length, 0);
  await client.session(); await client.bootstrap(bootstrapBody());
  assert.equal(calls[0].url, '/api/v1/auth/session'); assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.body, undefined);
  assert.equal(calls[1].url, '/api/v1/orgs'); assert.equal(calls[1].options.headers['X-BC-CSRF'], 'opaque-csrf-one');
  assert.deepEqual(JSON.parse(calls[1].options.body), bootstrapBody());
  for (const { options } of calls) { assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error'); }
});

test('login logout and password responses rotate only the in-memory CSRF used by later requests', async () => {
  const calls = [], client = createServerClient({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/session')) return json(session('initial'));
    if (url.endsWith('/auth/login')) return json(session('after-login', true));
    if (url.endsWith('/auth/logout')) return json(session('after-logout'));
    if (url.endsWith('/auth/password')) return json(session('after-password', true));
    return json({ accepted: true, delivery: 'unverified' });
  } });
  await client.session(); await client.login({ email: user.email, password: 'authored-password-only' });
  await client.recover({ email: user.email }); await client.logout();
  await client.signup({ email: user.email, password: 'another-authored-password' }); await client.password({ password: 'replacement-authored-password' });
  await client.bootstrap(bootstrapBody()); await client.organizations();
  assert.equal(calls[1].options.headers['X-BC-CSRF'], 'initial');
  assert.equal(calls[2].options.headers['X-BC-CSRF'], 'after-login');
  assert.equal(calls[3].options.headers['X-BC-CSRF'], 'after-login');
  assert.equal(calls[4].options.headers['X-BC-CSRF'], 'after-logout');
  assert.equal(calls[5].options.headers['X-BC-CSRF'], 'after-logout');
  assert.equal(calls[6].options.headers['X-BC-CSRF'], 'after-password');
  assert.equal(calls[7].url, '/api/v1/orgs');
  assert.equal(calls[7].options.headers['X-BC-CSRF'], undefined);
});

test('a session read started before login cannot replace the newer authentication CSRF', async () => {
  let sessions = 0, resolveOld; const calls = [];
  const client = createServerClient({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/session')) { sessions++; if (sessions === 2) return new Promise(resolve => { resolveOld = resolve; }); return json(session('initial')); }
    if (url.endsWith('/auth/login')) return json(session('current-login', true));
    return json({ acknowledged: true });
  } });
  await client.session(); const oldRead = client.session();
  await client.login({ email: user.email, password: 'authored-password-only' });
  resolveOld(json(session('stale-anonymous'))); await oldRead;
  await client.bootstrap(bootstrapBody());
  assert.equal(calls.at(-1).options.headers['X-BC-CSRF'], 'current-login');
});

test('expired-session and request-integrity errors require a fresh session before another mutation', async () => {
  for (const [status, code] of [[401, 'unauthenticated'], [403, 'request_integrity']]) {
    let posts = 0; const calls = [];
    const client = createServerClient({ fetchImpl: async (url, options) => { calls.push({ url, options }); if (options.method === 'GET') return json(session(`fresh-${calls.length}`)); posts++; return posts === 1 ? json({ error: { code } }, status) : json({ acknowledged: true }); } });
    await client.session(); await rejectsCode(client.bootstrap(bootstrapBody()), code, false);
    await rejectsCode(client.bootstrap(bootstrapBody()), 'session_required', false);
    assert.equal(posts, 1);
    await client.session(); await client.bootstrap(bootstrapBody()); assert.equal(posts, 2);
  }
});

test('failed mutations are never retried automatically and an explicit retry preserves caller request identity', async () => {
  for (const mode of ['network', 'server']) {
    const calls = []; let posts = 0;
    const client = createServerClient({ fetchImpl: async (url, options) => { calls.push({ url, options }); if (options.method === 'GET') return json(session('csrf')); posts++; if (posts === 1) { if (mode === 'network') throw new TypeError('authored-private-network-detail'); return json({ error: { code: 'port_failed' } }, 503); } return json({ replayed: true }); } });
    const body = bootstrapBody(); await client.session();
    await rejectsCode(client.bootstrap(body), mode === 'network' ? 'network_unavailable' : 'port_failed', true);
    assert.equal(posts, 1);
    const result = await client.bootstrap(body); assert.equal(result.replayed, true); assert.equal(posts, 2);
    assert.equal(calls[1].options.body, calls[2].options.body); assert.deepEqual(body, bootstrapBody());
  }
});

test('a finite timeout aborts the fake transport and preserves uncertainty for an already dispatched write', async () => {
  let postedSignal, posts = 0;
  const client = createServerClient({ timeoutMs: 10, fetchImpl: async (url, options) => {
    if (options.method === 'GET') return json(session('csrf'));
    posts++; postedSignal = options.signal;
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Authored abort', 'AbortError')), { once: true }));
  } });
  await client.session(); await rejectsCode(client.bootstrap(bootstrapBody()), 'request_timeout', true);
  assert.equal(posts, 1); assert.equal(postedSignal.aborted, true);
});

test('caller cancellation before dispatch is distinct from an interrupted in-flight write', async () => {
  let posts = 0;
  const client = createServerClient({ fetchImpl: async (url, options) => {
    if (options.method === 'GET') return json(session('csrf'));
    posts++;
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Authored abort', 'AbortError')), { once: true }));
  } });
  await client.session();
  const before = new AbortController(); before.abort();
  await rejectsCode(client.bootstrap(bootstrapBody(), { signal: before.signal }), 'request_aborted', false); assert.equal(posts, 0);
  const during = new AbortController(), write = client.bootstrap(bootstrapBody(), { signal: during.signal }); during.abort();
  await rejectsCode(write, 'request_aborted', true); assert.equal(posts, 1);
});

test('foreign-shaped targets unsupported actions and invalid local payloads never reach a transport', async () => {
  let calls = 0; const client = createServerClient({ fetchImpl: async () => { calls++; return json(session('csrf')); } });
  for (const target of ['https://fixture.invalid', `${orgId}/../`, 'A0000000-0000-4000-8000-000000000001', null]) assert.throws(() => client.workspace(target), error => error.code === 'invalid_target');
  assert.throws(() => client.operation(orgId, operationId, 'dispatch', {}), error => error.code === 'invalid_action');
  assert.throws(() => createServerClient({ timeoutMs: 0 }), error => error.code === 'invalid_client');
  assert.equal(calls, 0);
  await client.session(); const cyclic = {}; cyclic.self = cyclic;
  await rejectsCode(client.bootstrap(cyclic), 'invalid_request', false); assert.equal(calls, 1);
});

test('malformed UTF-8 JSON and non-record replies fail visibly and a malformed write acknowledgment stays uncertain', async () => {
  for (const raw of [new Uint8Array([0xc3, 0x28]), '{not-json}', '<html>authored-private-response</html>', 'null', '[]']) {
    const client = createServerClient({ fetchImpl: async () => new Response(raw, { headers: { 'content-type': 'application/json' } }) });
    await rejectsCode(client.session(), 'invalid_response', false);
  }
  let calls = 0;
  const client = createServerClient({ fetchImpl: async () => ++calls === 1 ? json(session('csrf')) : new Response('{incomplete', { headers: { 'content-type': 'application/json' } }) });
  await client.session(); await rejectsCode(client.bootstrap(bootstrapBody()), 'invalid_response', true); assert.equal(calls, 2);
});

test('declared and streamed oversized replies are bounded without accepting partial JSON', async () => {
  const limit = 512 * 1024;
  const declared = createServerClient({ fetchImpl: async () => new Response('{}', { headers: { 'content-length': String(limit + 1) } }) });
  await rejectsCode(declared.session(), 'invalid_response', false);
  let cancelled = false;
  const streamed = createServerClient({ fetchImpl: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(limit + 1)); }, cancel() { cancelled = true; } })) });
  await rejectsCode(streamed.session(), 'invalid_response', false); assert.equal(cancelled, true);
});

test('redirect refusal missing responders and fixed server errors do not expose transport or provider details', async () => {
  let calls = 0;
  const redirect = createServerClient({ fetchImpl: async (url, options) => { calls++; assert.equal(options.redirect, 'error'); throw new TypeError('authored-private-redirect'); } });
  await rejectsCode(redirect.session(), 'network_unavailable', false); assert.equal(calls, 1);
  const empty = createServerClient({ fetchImpl: async () => new Response(null, { status: 204 }) });
  await rejectsCode(empty.session(), 'invalid_response', false);
  const fixed = createServerClient({ fetchImpl: async () => json({ error: { code: 'backend_unconfigured', message: 'authored-private-provider-detail' } }, 503) });
  await assert.rejects(fixed.session(), error => error.code === 'backend_unconfigured' && error.status === 503 && !error.message.includes('authored-private-provider-detail'));
});

test('malformed authentication envelopes clear cached CSRF until another valid session is read', async () => {
  for (const change of [{ user: null }, { csrfToken: '' }, { csrfToken: 'a\nb' }, { csrfToken: 'x'.repeat(513) }, { organizations: null }, { authenticated: false, user }]) {
    let calls = 0;
    const client = createServerClient({ fetchImpl: async () => ++calls === 1 ? json(session('before')) : json({ ...session('after', true), ...change }) });
    await client.session(); await rejectsCode(client.login({ email: user.email, password: 'authored-password-only' }), 'invalid_response', true);
    await rejectsCode(client.bootstrap(bootstrapBody()), 'session_required', false); assert.equal(calls, 2);
  }
});
