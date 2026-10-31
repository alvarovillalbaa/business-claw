import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { currentSession, sessionRow } from './access.mjs';
import { call, email, fail, freeze, id, PolicyError, record, text, time } from './data.mjs';

const SESSION = '__Host-bc_session', CSRF = '__Host-bc_csrf', FLOW = '__Host-bc_flow';
const EIGHT_HOURS = 8 * 60 * 60 * 1000, FLOW_AGE = 10 * 60 * 1000;
const disabled = freeze({ adapter: 'unbound', dispatchAllowed: false, chatAdmissionAllowed: false, readiness: 'unproven', ready: false });
const sha = value => createHash('sha256').update(value).digest('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const equal = (left, right) => typeof left === 'string' && typeof right === 'string' && Buffer.byteLength(left) === Buffer.byteLength(right) && timingSafeEqual(Buffer.from(left), Buffer.from(right));
const cookie = (name, value, age) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
const clear = name => cookie(name, '', 0);
export function requestHeader(context, name) {
  const value = context?.headers?.[name.toLowerCase()];
  return typeof value === 'string' ? value : '';
}
function cookies(context) {
  const raw = requestHeader(context, 'cookie');
  if (raw.length > 8192) fail(400, 'cookie_invalid');
  const result = Object.create(null);
  for (const part of raw.split(';')) {
    const at = part.indexOf('='); if (at < 0) continue;
    const name = part.slice(0, at).trim(), value = part.slice(at + 1).trim();
    if (![SESSION, CSRF, FLOW].includes(name)) continue;
    if (Object.hasOwn(result, name)) fail(400, 'cookie_invalid'); result[name] = value;
  }
  return result;
}
function password(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value) || Buffer.byteLength(value, 'utf8') > 1024) fail(400, 'password_invalid');
  return value;
}
function base64(value, size = null) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 90000) fail(401, 'session_invalid');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value || (size !== null && bytes.length !== size)) fail(401, 'session_invalid');
  return bytes;
}
function token(value) { if (typeof value !== 'string' || value.length < 16 || value.length > 16384 || /[^\x21-\x7e]/.test(value)) fail(401, 'provider_identity_invalid'); return value; }
function claims(value) {
  try {
    token(value); const parts = value.split('.'); if (parts.length !== 3) fail(401, 'provider_identity_invalid');
    const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(base64(parts[1])));
    if (!result || typeof result !== 'object' || Array.isArray(result)) fail(401, 'provider_identity_invalid');
    return result;
  } catch { fail(401, 'provider_identity_invalid'); }
}
export function readAuthConfiguration(env = process.env) {
  try {
    const app = new URL(env.BC_APP_ORIGIN), provider = new URL(env.SUPABASE_URL);
    if (app.protocol !== 'https:' || app.origin !== env.BC_APP_ORIGIN || app.username || app.password || provider.protocol !== 'https:' || provider.origin !== env.SUPABASE_URL || !/^[a-z]{20}\.supabase\.co$/.test(provider.hostname)) fail(503, 'backend_unconfigured');
    const key = Buffer.from(env.BC_AUTH_TOKEN_KEY_V1 ?? '', 'base64');
    if (key.length !== 32 || key.toString('base64') !== env.BC_AUTH_TOKEN_KEY_V1 || typeof env.SUPABASE_PUBLISHABLE_KEY !== 'string' || !/^sb_publishable_[A-Za-z0-9_-]{16,256}$/.test(env.SUPABASE_PUBLISHABLE_KEY)) fail(503, 'backend_unconfigured');
    return Object.freeze({ origin: app.origin, supabaseUrl: provider.origin, publishableKey: env.SUPABASE_PUBLISHABLE_KEY, key, signupEnabled: env.BC_AUTH_SIGNUP_ENABLED === 'true', recoveryEnabled: env.BC_AUTH_RECOVERY_ENABLED === 'true' });
  } catch { fail(503, 'backend_unconfigured'); }
}

export function createAuth({ store, config, fetch: fetcher = globalThis.fetch, now = () => new Date().toISOString(), bytes = randomBytes }) {
  if (!store || typeof store.authTransaction !== 'function' || !config || !(config.key instanceof Uint8Array) || config.key.length !== 32 || typeof fetcher !== 'function') fail(503, 'backend_unconfigured');
  const cache = new WeakMap();
  const at = () => time(now());
  const random = size => { const result = bytes(size); if (!(result instanceof Uint8Array) || result.length !== size) fail(503, 'random_invalid'); return Buffer.from(result); };
  const csrfFor = handle => createHmac('sha256', config.key).update(`business-claw:csrf:v1:${handle}`).digest('hex');
  function seal(value, aad) {
    const iv = random(12), cipher = createCipheriv('aes-256-gcm', config.key, iv); cipher.setAAD(Buffer.from(aad));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return freeze({ version: 1, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url') });
  }
  function open(value, aad) {
    try {
      record(value, ['version', 'iv', 'tag', 'ciphertext']); if (value.version !== 1) fail(401, 'session_invalid');
      const decipher = createDecipheriv('aes-256-gcm', config.key, base64(value.iv, 12)); decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(base64(value.tag, 16));
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat([decipher.update(base64(value.ciphertext)), decipher.final()])));
    } catch { fail(401, 'session_invalid'); }
  }
  const aad = session => JSON.stringify(['business-claw.auth.v1', session.handleHash, session.userId, session.supabaseSessionId]);
  function secret(row) {
    const result = record(open(row.envelope, aad(row.session)), ['accessToken', 'refreshToken', 'recoveryUntil']);
    token(result.accessToken); token(result.refreshToken); if (result.recoveryUntil !== null) time(result.recoveryUntil); return result;
  }
  async function provider(path, { method = 'POST', body, bearer, neutralExisting = false } = {}) {
    const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 8000);
    let reader;
    try {
      const response = await fetcher(`${config.supabaseUrl}/auth/v1${path}`, { method, redirect: 'error', signal: controller.signal,
        headers: { apikey: config.publishableKey, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (response.status === 204 && response.ok) return {};
      if (!/^application\/json\b/i.test(response.headers.get('content-type') ?? '') || Number(response.headers.get('content-length') ?? 0) > 65536) fail(503, 'auth_unavailable');
      reader = response.body?.getReader(); if (!reader) fail(503, 'auth_unavailable');
      const chunks = []; let size = 0;
      while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 65536) fail(503, 'auth_unavailable'); chunks.push(part.value); }
      const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      if (!response.ok) {
        if (neutralExisting && ['user_already_exists', 'email_exists'].includes(result?.code ?? result?.error_code)) return {};
        if (response.status === 429) fail(429, 'auth_rate_limited');
        fail(response.status >= 500 ? 503 : 401, response.status >= 500 ? 'auth_unavailable' : 'auth_failed');
      }
      if (!result || typeof result !== 'object' || Array.isArray(result)) fail(503, 'auth_unavailable');
      return result;
    } catch (error) { if (error instanceof PolicyError) throw error; fail(503, 'auth_unavailable'); }
    finally { clearTimeout(deadline); controller.abort(); if (reader) await reader.cancel().catch(() => {}); }
  }
  async function verified(accessToken) {
    const user = await provider('/user', { method: 'GET', bearer: token(accessToken) });
    try {
      const jwt = claims(accessToken), nowSeconds = Date.parse(at()) / 1000;
      if (user.is_anonymous !== false || jwt.is_anonymous !== false || !user.email_confirmed_at || !Number.isFinite(Date.parse(user.email_confirmed_at)) || jwt.role !== 'authenticated' || !(jwt.aud === 'authenticated' || (Array.isArray(jwt.aud) && jwt.aud.length === 1 && jwt.aud[0] === 'authenticated')) || jwt.iss !== `${config.supabaseUrl}/auth/v1` || !Number.isSafeInteger(jwt.exp) || jwt.exp <= nowSeconds || !Number.isSafeInteger(jwt.iat) || jwt.iat > nowSeconds + 30 || jwt.iat <= 0 || jwt.exp <= jwt.iat) fail(401, 'provider_identity_invalid');
      const result = { userId: id(user.id), email: email(user.email), supabaseSessionId: id(jwt.session_id) };
      if (id(jwt.sub) !== result.userId) fail(401, 'provider_identity_invalid'); return freeze(result);
    } catch { fail(401, 'provider_identity_invalid'); }
  }
  function mutation(context, expectedHandle = null) {
    const jar = cookies(context), handle = jar[SESSION];
    if (requestHeader(context, 'origin') !== config.origin || requestHeader(context, 'sec-fetch-site') === 'cross-site') fail(403, 'request_integrity');
    if (expectedHandle !== null && (!hex(handle) || sha(handle) !== expectedHandle)) fail(403, 'request_integrity');
    const expected = hex(handle) ? csrfFor(handle) : jar[CSRF];
    const received = requestHeader(context, 'x-bc-csrf');
    if (!hex(expected) || !hex(received) || !equal(expected, received)) fail(403, 'request_integrity'); return true;
  }
  async function authenticate(context) {
    if (cache.has(context)) return cache.get(context);
    const pending = (async () => {
      const handle = cookies(context)[SESSION]; if (!hex(handle)) return null;
      const handleHash = sha(handle);
      return store.authTransaction(handleHash, async tx => {
        const raw = await call(tx, 'readAuthSession', handleHash); if (raw === null) fail(401, 'session_inactive');
        record(raw, ['session', 'envelope']); const session = sessionRow(raw.session);
        const principal = { userId: session.userId, handleHash, supabaseSessionId: session.supabaseSessionId };
        currentSession(principal, session, at()); let tokens = secret(raw), changed = false;
        const currentClaims = claims(tokens.accessToken);
        if (!Number.isSafeInteger(currentClaims.exp)) fail(401, 'provider_identity_invalid');
        if (currentClaims.exp <= Date.parse(at()) / 1000 + 30) {
          const refreshed = await provider('/token?grant_type=refresh_token', { body: { refresh_token: tokens.refreshToken } });
          tokens = { ...tokens, accessToken: token(refreshed.access_token), refreshToken: token(refreshed.refresh_token) }; changed = true;
        }
        const user = await verified(tokens.accessToken);
        if (user.userId !== session.userId || user.supabaseSessionId !== session.supabaseSessionId) fail(401, 'session_binding');
        currentSession(principal, session, at());
        if (changed && await call(tx, 'writeAuthSession', freeze({ session, envelope: seal(tokens, aad(session)) })) !== true) fail(503, 'session_store_failed');
        return freeze({ principal: { ...user, emailConfirmed: true, handleHash }, session, tokens });
      });
    })(); cache.set(context, pending); return pending;
  }
  async function organizations(auth) {
    const result = await store.authTransaction(auth.session.handleHash, tx => call(tx, 'listOrganizations', auth.principal.userId, auth.session.handleHash));
    if (!Array.isArray(result) || result.length > 1000) fail(503, 'store_invalid');
    const seen = new Set();
    return result.map(row => {
      record(row, ['orgId', 'name', 'instanceId', 'generation', 'serverRevision', 'role']); const orgId = id(row.orgId);
      if (seen.has(orgId) || !['owner', 'administrator', 'member', 'viewer'].includes(row.role) || !Number.isSafeInteger(row.serverRevision) || row.serverRevision < 0) fail(503, 'store_invalid');
      seen.add(orgId); return freeze({ id: orgId, name: text(row.name, 80), role: row.role, serverRevision: row.serverRevision });
    });
  }
  async function sessionResponse(context, auth = undefined, extraCookies = []) {
    let current = auth, reset = false;
    if (current === undefined) try { current = await authenticate(context); } catch (error) { if (!(error instanceof PolicyError) || error.status !== 401) throw error; current = null; reset = true; }
    const jar = cookies(context);
    if (current) return { body: freeze({ authenticated: true, user: { id: current.principal.userId, email: current.principal.email }, csrfToken: csrfFor(jar[SESSION]), organizations: await organizations(current), execution: disabled }), cookies: extraCookies };
    const csrf = !reset && hex(jar[CSRF]) ? jar[CSRF] : random(32).toString('hex');
    return { body: freeze({ authenticated: false, user: null, csrfToken: csrf, organizations: [], execution: disabled }), cookies: [...extraCookies, ...(reset ? [clear(SESSION)] : []), cookie(CSRF, csrf, EIGHT_HOURS / 1000)] };
  }
  async function establish(context, tokens, user, recoveryUntil = null) {
    const handle = random(32).toString('hex'), handleHash = sha(handle), nowAt = at();
    const session = freeze({ handleHash, userId: user.userId, supabaseSessionId: user.supabaseSessionId, authenticatedAt: nowAt, expiresAt: new Date(Date.parse(nowAt) + EIGHT_HOURS).toISOString(), revokedAt: null });
    const envelope = seal({ accessToken: token(tokens.access_token), refreshToken: token(tokens.refresh_token), recoveryUntil }, aad(session));
    const old = cookies(context)[SESSION], oldHash = hex(old) ? sha(old) : null;
    await store.authTransaction(oldHash, async tx => {
      if (oldHash) { const previous = await call(tx, 'readAuthSession', oldHash); if (previous !== null && await call(tx, 'revokeAuthSession', oldHash, nowAt) !== true) fail(503, 'session_store_failed'); }
      if (await call(tx, 'insertAuthSession', freeze({ session, envelope })) !== true) fail(503, 'session_store_failed');
    });
    const freshContext = { headers: { cookie: `${SESSION}=${handle}` } }, auth = freeze({ principal: { ...user, emailConfirmed: true, handleHash }, session });
    return sessionResponse(freshContext, auth, [cookie(SESSION, handle, EIGHT_HOURS / 1000), clear(CSRF), clear(FLOW)]);
  }
  return Object.freeze({
    verify: async context => (await authenticate(context))?.principal ?? null,
    verifyMutation: async (context, binding) => mutation(context, binding.handleHash),
    requireMutation: mutation,
    session: context => sessionResponse(context),
    async login(context, value) {
      mutation(context); const input = record(value, ['email', 'password']);
      const tokens = await provider('/token?grant_type=password', { body: { email: email(input.email), password: password(input.password) } });
      const user = await verified(tokens.access_token); return establish(context, tokens, user);
    },
    async signup(context, value) { return this.startFlow(context, value, 'signup'); },
    async recover(context, value) { return this.startFlow(context, value, 'recovery'); },
    async startFlow(context, value, kind) {
      mutation(context); const input = record(value, kind === 'signup' ? ['email', 'password'] : ['email']);
      if (!(kind === 'signup' ? config.signupEnabled : config.recoveryEnabled)) fail(503, 'mail_unavailable');
      const address = email(input.email), verifier = random(32).toString('base64url'), state = random(32).toString('hex');
      const flow = { kind, verifier, state, expiresAt: new Date(Date.parse(at()) + FLOW_AGE).toISOString() };
      const target = `${config.origin}/api/v1/auth/${kind === 'signup' ? 'callback' : 'recovery'}?state=${state}`;
      const response = await provider(`/${kind === 'signup' ? 'signup' : 'recover'}?redirect_to=${encodeURIComponent(target)}`, { body: { email: address, ...(kind === 'signup' ? { password: password(input.password) } : {}), code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 's256' }, neutralExisting: true });
      if (response.access_token || response.refresh_token) fail(503, 'confirmation_not_configured');
      return { body: freeze({ accepted: true, delivery: 'unverified' }), cookies: [cookie(FLOW, Buffer.from(JSON.stringify(seal(flow, 'business-claw.flow.v1'))).toString('base64url'), FLOW_AGE / 1000)] };
    },
    async callback(context, value, kind) {
      const input = record(value, ['code', 'state']), encoded = cookies(context)[FLOW];
      if (!encoded || !hex(input.state) || typeof input.code !== 'string' || !/^[A-Za-z0-9_-]{16,2048}$/.test(input.code)) fail(400, 'callback_invalid');
      let flow;
      try { flow = record(open(JSON.parse(base64(encoded).toString('utf8')), 'business-claw.flow.v1'), ['kind', 'verifier', 'state', 'expiresAt']); }
      catch { fail(400, 'callback_invalid'); }
      if (flow.kind !== kind || !equal(flow.state, input.state) || time(flow.expiresAt) <= at() || Date.parse(flow.expiresAt) > Date.parse(at()) + FLOW_AGE || typeof flow.verifier !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(flow.verifier)) fail(400, 'callback_invalid');
      const tokens = await provider('/token?grant_type=pkce', { body: { auth_code: input.code, code_verifier: flow.verifier } });
      const user = await verified(tokens.access_token), result = await establish(context, tokens, user, kind === 'recovery' ? new Date(Date.parse(at()) + FLOW_AGE).toISOString() : null);
      return { ...result, redirect: kind === 'recovery' ? '/#server-recovery' : '/#server' };
    },
    async password(context, value) {
      mutation(context); const input = record(value, ['password']), auth = await authenticate(context);
      if (!auth || !auth.tokens.recoveryUntil || auth.tokens.recoveryUntil <= at()) fail(403, 'recovery_required');
      await provider('/user', { method: 'PUT', body: { password: password(input.password) }, bearer: auth.tokens.accessToken });
      const tokens = await provider('/token?grant_type=password', { body: { email: auth.principal.email, password: password(input.password) } });
      const user = await verified(tokens.access_token); if (user.userId !== auth.principal.userId) fail(401, 'session_binding'); return establish(context, tokens, user);
    },
    async logout(context, value) {
      mutation(context); record(value, []); const handle = cookies(context)[SESSION]; let accessToken = null;
      if (hex(handle)) await store.authTransaction(sha(handle), async tx => { const row = await call(tx, 'readAuthSession', sha(handle)); if (row !== null) { try { accessToken = secret(row).accessToken; } catch {} if (await call(tx, 'revokeAuthSession', sha(handle), at()) !== true) fail(503, 'session_store_failed'); } });
      let providerSignout = 'unverified';
      if (accessToken) try { await provider('/logout?scope=local', { bearer: accessToken }); providerSignout = 'confirmed'; } catch {}
      const result = await sessionResponse({ headers: {} }, null, [clear(SESSION), clear(FLOW)]);
      return { ...result, body: freeze({ ...result.body, providerSignout }) };
    },
  });
}
