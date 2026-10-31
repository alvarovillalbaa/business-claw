import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuth, readAuthConfiguration } from '../server/auth.mjs';
import { createHttpHandler } from '../server/http.mjs';
import { readDatabaseConfiguration } from '../api/v1.mjs';
import { PolicyError } from '../server/data.mjs';

const USER = '11111111-1111-4111-8111-111111111111', SESSION_ID = '22222222-2222-4222-8222-222222222222';
const ORG = '33333333-3333-4333-8333-333333333333', INSTANCE = '44444444-4444-4444-8444-444444444444', OP = '55555555-5555-4555-8555-555555555555';
const origin = 'https://business-claw.example.test', providerUrl = 'https://abcdefghijklmnopqrst.supabase.co';
const configuration = () => ({ BC_APP_ORIGIN: origin, SUPABASE_URL: providerUrl, SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'a'.repeat(32)}`, BC_AUTH_TOKEN_KEY_V1: Buffer.alloc(32, 7).toString('base64') });
const isCode = code => error => error instanceof PolicyError && error.code === code;
function applyCookies(jar, set) {
  for (const value of set) { const pair = value.split(';')[0], at = pair.indexOf('='), name = pair.slice(0, at); if (value.includes('Max-Age=0')) delete jar[name]; else jar[name] = pair.slice(at + 1); }
}
const cookieHeader = jar => Object.entries(jar).map(([name, value]) => `${name}=${value}`).join('; ');
function fixture(flags = {}) {
  const state = { now: Date.parse('2026-10-31T18:00:00.000Z'), userPatch: {}, claimPatch: {}, requests: [], rows: new Map(), refreshes: 0, fail: null, sequence: 0, tokens: null };
  const config = readAuthConfiguration({ ...configuration(), ...flags });
  function tokens() {
    const seconds = Math.floor(state.now / 1000);
    const payload = { sub: USER, session_id: SESSION_ID, iss: `${providerUrl}/auth/v1`, aud: 'authenticated', role: 'authenticated', is_anonymous: false, iat: seconds, exp: seconds + 3600, ...state.claimPatch };
    const access_token = `${Buffer.from('{"alg":"fixture"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.c2lnbmF0dXJl`;
    return { access_token, refresh_token: `authored-refresh-${String(state.sequence++).padStart(16, '0')}`, token_type: 'bearer' };
  }
  const user = () => ({ id: USER, email: 'owner@example.test', email_confirmed_at: '2026-10-31T17:59:00.000Z', is_anonymous: false, ...state.userPatch });
  const fetcher = async (url, options) => {
    const parsed = new URL(url), body = options.body ? JSON.parse(options.body) : null;
    assert.equal(parsed.origin, providerUrl); state.requests.push({ path: parsed.pathname, query: parsed.search, options, body });
    if (state.fail) return new Response(JSON.stringify({ code: 'fixture_provider_error', msg: 'DO_NOT_LEAK_PROVIDER_DETAIL' }), { status: state.fail, headers: { 'Content-Type': 'application/json' } });
    let result;
    if (parsed.pathname.endsWith('/token')) { if (parsed.searchParams.get('grant_type') === 'refresh_token') state.refreshes++; state.tokens = tokens(); result = state.tokens; }
    else if (parsed.pathname.endsWith('/user')) result = user();
    else if (parsed.pathname.endsWith('/logout')) return new Response(null, { status: 204 });
    else result = {};
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  };
  let tail = Promise.resolve();
  const store = { authTransaction(_handle, action) {
    const result = tail.then(() => action({
      readAuthSession: async handle => state.rows.get(handle) ?? null,
      insertAuthSession: async row => { if (state.rows.has(row.session.handleHash)) return false; state.rows.set(row.session.handleHash, row); return true; },
      writeAuthSession: async row => { if (!state.rows.has(row.session.handleHash)) return false; state.rows.set(row.session.handleHash, row); return true; },
      revokeAuthSession: async (handle, at) => { const row = state.rows.get(handle); if (!row) return false; state.rows.set(handle, { ...row, session: { ...row.session, revokedAt: row.session.revokedAt ?? at } }); return true; },
      listOrganizations: async () => [{ orgId: ORG, name: 'Authored organization', instanceId: INSTANCE, generation: 1, serverRevision: 0, role: 'owner' }],
    })); tail = result.catch(() => {}); return result;
  } };
  const auth = createAuth({ store, config, fetch: fetcher, now: () => new Date(state.now).toISOString(), bytes: size => Buffer.alloc(size, ++state.sequence) });
  const jar = {}, context = csrf => ({ headers: { cookie: cookieHeader(jar), origin, 'x-bc-csrf': csrf } });
  async function preauth() { const result = await auth.session({ headers: {} }); applyCookies(jar, result.cookies); return result; }
  async function login() { const before = await preauth(), result = await auth.login(context(before.body.csrfToken), { email: 'owner@example.test', password: 'authored password 123' }); applyCookies(jar, result.cookies); return result; }
  return { state, config, auth, jar, context, preauth, login };
}
function response() {
  return { statusCode: null, headers: {}, raw: '', setHeader(name, value) { this.headers[name] = value; }, end(raw) { this.raw = raw; this.body = JSON.parse(raw); } };
}
async function invoke(handler, method, url, body = undefined, headers = {}) {
  const result = response();
  await handler({ method, url, body, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers } }, result);
  return result;
}
function routed() {
  const calls = [], auth = {
    requireMutation: () => true,
    session: async () => ({ body: { authenticated: true, organizations: [], csrfToken: 'authored' }, cookies: ['fixture=authored'] }),
    callback: async (_context, input, kind) => { calls.push({ method: 'callback', input, kind }); return { body: {}, cookies: [], redirect: '/#server' }; },
  };
  const methods = ['bootstrap', 'readWorkspace', 'updateIntent', 'requestOperation', 'reviewOperation', 'confirmOperation', 'cancelOperation', 'createInvite', 'acceptInvite', 'revokeInvite', 'changeMemberRole', 'revokeMember', 'requestOwnerTransfer', 'acceptOwnerTransfer'];
  const policy = Object.fromEntries(methods.map(method => [method, async (_context, input) => { calls.push({ method, input }); return { method, input, execution: { ready: false } }; }]));
  return { calls, auth, policy, handler: createHttpHandler({ auth, policy }) };
}

test('configuration rejects missing bindings and nonproduction key or origins', () => {
  for (const patch of [{ BC_APP_ORIGIN: undefined }, { BC_APP_ORIGIN: 'http://localhost' }, { BC_APP_ORIGIN: `${origin}/path` }, { SUPABASE_URL: 'https://other.example.test' }, { SUPABASE_PUBLISHABLE_KEY: 'service_role_fixture' }, { BC_AUTH_TOKEN_KEY_V1: Buffer.alloc(31).toString('base64') }]) assert.throws(() => readAuthConfiguration({ ...configuration(), ...patch }), isCode('backend_unconfigured'));
});
test('configuration defaults both email actions to disabled', () => {
  const config = readAuthConfiguration(configuration()); assert.equal(config.signupEnabled, false); assert.equal(config.recoveryEnabled, false); assert.ok(Object.isFrozen(config));
});
test('signed-out discovery returns preauth CSRF without contacting provider or store', async () => {
  const f = fixture(), result = await f.preauth(); assert.equal(result.body.authenticated, false); assert.match(result.body.csrfToken, /^[a-f0-9]{64}$/); assert.match(result.cookies[0], /^__Host-bc_csrf=.*Secure; HttpOnly; SameSite=Lax/); assert.equal(f.state.requests.length, 0); assert.equal(f.state.rows.size, 0);
});
test('login binds online identity to an encrypted eight-hour opaque host session', async () => {
  const f = fixture(), result = await f.login(), [row] = f.state.rows.values();
  assert.equal(result.body.user.id, USER); assert.equal(result.body.organizations[0].id, ORG); assert.equal(result.body.execution.ready, false);
  assert.equal(row.session.supabaseSessionId, SESSION_ID); assert.equal(Date.parse(row.session.expiresAt) - Date.parse(row.session.authenticatedAt), 8 * 3600000);
  assert.match(result.cookies[0], /^__Host-bc_session=[a-f0-9]{64}; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=28800$/);
  assert.equal(JSON.stringify(result.body).includes(f.state.tokens.access_token), false); assert.equal(JSON.stringify(row).includes(f.state.tokens.refresh_token), false);
  assert.deepEqual(f.state.requests.map(item => item.path), ['/auth/v1/token', '/auth/v1/user']);
});
test('login refuses unconfirmed anonymous and mismatched provider identity evidence', async () => {
  const variants = [
    { userPatch: { email_confirmed_at: null } }, { userPatch: { is_anonymous: true } }, { claimPatch: { session_id: undefined } },
    { claimPatch: { sub: ORG } }, { claimPatch: { iss: 'https://other.example.test/auth/v1' } }, { claimPatch: { aud: 'anon' } }, { claimPatch: { exp: 1 } },
  ];
  for (const patch of variants) { const f = fixture(); Object.assign(f.state, patch); await assert.rejects(f.login(), error => error instanceof PolicyError && error.status === 401); assert.equal(f.state.rows.size, 0); }
});
test('authentication mutations reject cross-origin missing and non-ASCII CSRF', async () => {
  const f = fixture(), before = await f.preauth(), input = { email: 'owner@example.test', password: 'authored password 123' };
  for (const patch of [{ origin: 'https://evil.example.test' }, { 'x-bc-csrf': '' }, { 'x-bc-csrf': 'é'.repeat(64) }, { 'sec-fetch-site': 'cross-site' }]) await assert.rejects(f.auth.login({ headers: { ...f.context(before.body.csrfToken).headers, ...patch } }, input), isCode('request_integrity'));
  assert.equal(f.state.requests.length, 0);
});
test('refresh rotates encrypted tokens without extending session or fresh-login time', async () => {
  const f = fixture(), login = await f.login(), original = [...f.state.rows.values()][0]; f.state.now += 3590000;
  const principal = await f.auth.verify(f.context(login.body.csrfToken)), updated = [...f.state.rows.values()][0];
  assert.equal(principal.userId, USER); assert.equal(f.state.refreshes, 1); assert.deepEqual(updated.session, original.session); assert.notEqual(updated.envelope.ciphertext, original.envelope.ciphertext);
});
test('concurrent requests serialize refresh through the session transaction seam', async () => {
  const f = fixture(), login = await f.login(); f.state.now += 3590000;
  const result = await Promise.all([f.auth.verify(f.context(login.body.csrfToken)), f.auth.verify(f.context(login.body.csrfToken))]);
  assert.equal(result.length, 2); assert.equal(f.state.refreshes, 1);
});
test('revoked and absolute-expired application sessions are denied before provider access', async () => {
  for (const revoked of [true, false]) { const f = fixture(), login = await f.login(), [key, row] = [...f.state.rows.entries()][0];
    if (revoked) f.state.rows.set(key, { ...row, session: { ...row.session, revokedAt: new Date(f.state.now).toISOString() } }); else f.state.now += 8 * 3600000;
    const previous = f.state.requests.length; await assert.rejects(f.auth.verify(f.context(login.body.csrfToken)), isCode('session_inactive')); assert.equal(f.state.requests.length, previous);
  }
});
test('modified ciphertext and changed provider-session bindings cannot authenticate', async () => {
  const f = fixture(), login = await f.login(), [key, row] = [...f.state.rows.entries()][0];
  f.state.rows.set(key, { ...row, envelope: { ...row.envelope, ciphertext: `${row.envelope.ciphertext.slice(0, -1)}!` } });
  await assert.rejects(f.auth.verify(f.context(login.body.csrfToken)), isCode('session_invalid'));
  f.state.rows.set(key, row); f.state.now += 3590000; f.state.claimPatch = { session_id: ORG };
  await assert.rejects(f.auth.verify(f.context(login.body.csrfToken)), isCode('session_binding'));
});
test('logout revokes the application even when provider signout is unavailable', async () => {
  const f = fixture(), login = await f.login(); f.state.fail = 503;
  const result = await f.auth.logout(f.context(login.body.csrfToken), {});
  assert.equal(result.body.authenticated, false); assert.equal(result.body.providerSignout, 'unverified'); assert.notEqual([...f.state.rows.values()][0].session.revokedAt, null); assert.ok(result.cookies.some(value => value.startsWith('__Host-bc_session=;')));
});
test('unqualified email actions make no provider request', async () => {
  const f = fixture(), before = await f.preauth();
  await assert.rejects(f.auth.signup(f.context(before.body.csrfToken), { email: 'owner@example.test', password: 'authored password 123' }), isCode('mail_unavailable'));
  await assert.rejects(f.auth.recover(f.context(before.body.csrfToken), { email: 'owner@example.test' }), isCode('mail_unavailable')); assert.equal(f.state.requests.length, 0);
});
test('enabled signup uses S256 PKCE and a bounded encrypted flow cookie', async () => {
  const f = fixture({ BC_AUTH_SIGNUP_ENABLED: 'true' }), before = await f.preauth(), result = await f.auth.signup(f.context(before.body.csrfToken), { email: 'owner@example.test', password: 'authored password 123' });
  const request = f.state.requests[0], redirect = new URL(new URL(`${providerUrl}${request.path}${request.query}`).searchParams.get('redirect_to'));
  assert.equal(request.body.code_challenge_method, 's256'); assert.match(request.body.code_challenge, /^[A-Za-z0-9_-]{43}$/); assert.equal(redirect.origin, origin); assert.equal(redirect.pathname, '/api/v1/auth/callback');
  assert.deepEqual(result.body, { accepted: true, delivery: 'unverified' }); assert.match(result.cookies[0], /HttpOnly; SameSite=Lax; Max-Age=600$/); assert.equal(result.cookies[0].includes('authored password'), false);
});
test('callback requires matching same-browser state before exchanging its one-use code', async () => {
  const f = fixture({ BC_AUTH_SIGNUP_ENABLED: 'true' }), before = await f.preauth(), started = await f.auth.signup(f.context(before.body.csrfToken), { email: 'owner@example.test', password: 'authored password 123' }); applyCookies(f.jar, started.cookies);
  const redirect = new URL(new URL(`${providerUrl}${f.state.requests[0].path}${f.state.requests[0].query}`).searchParams.get('redirect_to')), state = redirect.searchParams.get('state'), code = 'authored-code-1234567890';
  await assert.rejects(f.auth.callback(f.context(before.body.csrfToken), { state: 'f'.repeat(64), code }, 'signup'), isCode('callback_invalid')); assert.equal(f.state.requests.length, 1);
  const result = await f.auth.callback(f.context(before.body.csrfToken), { state, code }, 'signup'); assert.equal(result.redirect, '/#server'); assert.equal(result.body.user.id, USER); assert.equal(f.state.requests[1].body.auth_code, code);
});
test('recovery changes password only inside a verified unexpired recovery session', async () => {
  const f = fixture({ BC_AUTH_RECOVERY_ENABLED: 'true' }), before = await f.preauth(), started = await f.auth.recover(f.context(before.body.csrfToken), { email: 'owner@example.test' }); applyCookies(f.jar, started.cookies);
  const target = new URL(new URL(`${providerUrl}${f.state.requests[0].path}${f.state.requests[0].query}`).searchParams.get('redirect_to'));
  const recovered = await f.auth.callback(f.context(before.body.csrfToken), { code: 'authored-recovery-code-123', state: target.searchParams.get('state') }, 'recovery'); applyCookies(f.jar, recovered.cookies);
  assert.equal(recovered.redirect, '/#server-recovery'); const changed = await f.auth.password(f.context(recovered.body.csrfToken), { password: 'another authored password 123' }); applyCookies(f.jar, changed.cookies);
  assert.equal(changed.body.authenticated, true); assert.ok(f.state.requests.some(item => item.options.method === 'PUT' && item.path === '/auth/v1/user'));
  await assert.rejects(f.auth.password(f.context(changed.body.csrfToken), { password: 'third authored password 123' }), isCode('recovery_required'));
});
test('provider failures remain finite and do not copy provider details', async () => {
  const f = fixture(), before = await f.preauth(); f.state.fail = 503;
  await assert.rejects(f.auth.login(f.context(before.body.csrfToken), { email: 'owner@example.test', password: 'authored password 123' }), error => error.code === 'auth_unavailable' && !error.message.includes('DO_NOT_LEAK'));
});
test('duplicate opaque cookies fail closed before authentication', async () => {
  const f = fixture(); await assert.rejects(f.auth.session({ headers: { cookie: `__Host-bc_session=${'a'.repeat(64)}; __Host-bc_session=${'b'.repeat(64)}` } }), isCode('cookie_invalid'));
});
test('HTTP session discovery uses private no-store headers and propagates host cookies', async () => {
  const f = routed(), result = await invoke(f.handler, 'GET', '/api/v1/auth/session');
  assert.equal(result.statusCode, 200); assert.match(result.headers['Cache-Control'], /private, no-store/); assert.equal(result.headers['Referrer-Policy'], 'no-referrer'); assert.deepEqual(result.headers['Set-Cookie'], ['fixture=authored']); assert.equal(result.headers['Access-Control-Allow-Origin'], undefined);
});
test('HTTP refuses path body ownership substitutions before policy invocation', async () => {
  const f = routed(), result = await invoke(f.handler, 'POST', `/api/v1/orgs/${ORG}/intent`, { orgId: USER }); assert.equal(result.statusCode, 400); assert.equal(result.body.error.code, 'path_binding'); assert.equal(f.calls.length, 0);
});
test('HTTP maps each lifecycle action to the existing exact policy method', async () => {
  const f = routed(); for (const action of ['request', 'review', 'confirm', 'cancel']) {
    const body = { orgId: ORG, operationId: OP, instanceId: INSTANCE, expectedRevision: 7, expectedGeneration: 1 };
    const result = await invoke(f.handler, 'POST', `/api/v1/orgs/${ORG}/operations/${OP}/${action}`, body); assert.equal(result.statusCode, 200); assert.equal(f.calls.at(-1).method, `${action}Operation`); assert.deepEqual(f.calls.at(-1).input, body);
  }
});
test('HTTP rewrite accepts both matching Vercel URL shapes and refuses route overrides', async () => {
  const f = routed();
  for (const path of ['/api/v1?bc_route=auth/session', '/api/v1/auth/session?bc_route=auth/session']) assert.equal((await invoke(f.handler, 'GET', path)).statusCode, 200);
  for (const path of ['/api/v1?bc_route=auth/session&bc_route=orgs', '/api/v1/auth/session?bc_route=orgs', '/api/v1?bc_route=../auth/session', '/api/v1/auth/callback?code=authored-code-12345&state=abc&bc_route=auth/session']) { const result = await invoke(f.handler, 'GET', path); assert.equal(result.statusCode, 400); }
  assert.equal(f.calls.length, 0);
});
test('HTTP bounds JSON requests and rejects malformed or non-JSON bodies', async () => {
  const f = routed();
  assert.equal((await invoke(f.handler, 'POST', '/api/v1/orgs', '{invalid')).statusCode, 400);
  assert.equal((await invoke(f.handler, 'POST', '/api/v1/orgs', 'a'.repeat(65537))).statusCode, 413);
  assert.equal((await invoke(f.handler, 'POST', '/api/v1/orgs', {}, { 'content-type': 'text/plain' })).statusCode, 415);
  assert.equal((await invoke(f.handler, 'POST', '/api/v1/orgs', [])).statusCode, 400); assert.equal(f.calls.length, 0);
});
test('HTTP maps thrown adapter details to a finite public error', async () => {
  const f = routed(); f.policy.bootstrap = async () => { throw new Error('authored-secret-DO_NOT_LEAK'); };
  const result = await invoke(f.handler, 'POST', '/api/v1/orgs', { requestId: OP, name: 'Authored' }); assert.equal(result.statusCode, 503); assert.deepEqual(result.body, { error: { code: 'backend_unavailable' } }); assert.equal(result.raw.includes('DO_NOT_LEAK'), false);
});
test('HTTP runtime routes authorize organization read and always refuse dispatch', async () => {
  const f = routed(), result = await invoke(f.handler, 'POST', `/api/v1/orgs/${ORG}/chat`, {});
  assert.equal(result.statusCode, 503); assert.equal(result.body.error.code, 'runtime_unbound'); assert.deepEqual(f.calls, [{ method: 'readWorkspace', input: { orgId: ORG } }]);
});
test('database configuration requires explicit strict transaction-pooler metadata', () => {
  const env = { SUPABASE_URL: providerUrl, DATABASE_URL: `postgresql://bc_pool_login.abcdefghijklmnopqrst:authored-password@aws-0-eu-central-1.pooler.supabase.com:6543/postgres` };
  const value = readDatabaseConfiguration(env); assert.equal(value.max, 1); assert.deepEqual(value.ssl, { rejectUnauthorized: true });
  for (const DATABASE_URL of [undefined, env.DATABASE_URL.replace(':6543', ':5432'), `${env.DATABASE_URL}?sslmode=disable`, env.DATABASE_URL.replace('pooler.supabase.com', 'evil.example.test'), env.DATABASE_URL.replace('bc_pool_login.', 'postgres.')]) assert.throws(() => readDatabaseConfiguration({ ...env, DATABASE_URL }), isCode('database_unconfigured'));
});
test('HTTP refuses oversized output instead of truncating a workspace', async () => {
  const f = routed(); f.policy.readWorkspace = async () => ({ text: 'a'.repeat(2 * 1024 * 1024) });
  const result = await invoke(f.handler, 'GET', `/api/v1/orgs/${ORG}/workspace`); assert.equal(result.statusCode, 503); assert.deepEqual(result.body, { error: { code: 'response_limit' } });
});
