const prefix = '/api/v1';
const maximumBytes = 512 * 1024;
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;

export class ServerRequestError extends Error {
  constructor(code, status = 0, uncertain = false) {
    super(`business_claw_http_${code}`);
    this.name = 'ServerRequestError'; this.code = code; this.status = status; this.uncertain = uncertain;
  }
}
function segment(value) {
  if (typeof value !== 'string' || !uuid.test(value)) throw new ServerRequestError('invalid_target');
  return value;
}
async function jsonBody(response) {
  const declared = response.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > maximumBytes) throw new ServerRequestError('invalid_response');
  if (!response.body) throw new ServerRequestError('invalid_response');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > maximumBytes) { await reader.cancel(); throw new ServerRequestError('invalid_response'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let result;
  try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new ServerRequestError('invalid_response'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new ServerRequestError('invalid_response');
  return result;
}

// Only same-origin BFF requests. CSRF lives in this closure; credentials never enter browser storage.
export function createServerClient({ fetchImpl = (url, options) => fetch(url, options), timeoutMs = 15_000 } = {}) {
  if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new ServerRequestError('invalid_client');
  let csrfToken = null, authEpoch = 0;
  function acceptSession(value, epoch, mutation = false) {
    if (typeof value.authenticated !== 'boolean' || typeof value.csrfToken !== 'string' || !value.csrfToken.trim() || value.csrfToken.length > 512 || /[\u0000-\u001f\u007f]/u.test(value.csrfToken)
      || !Array.isArray(value.organizations) || (value.authenticated ? !value.user || typeof value.user.id !== 'string' || typeof value.user.email !== 'string' : value.user !== null)) {
      if (epoch === authEpoch) csrfToken = null;
      throw new ServerRequestError('invalid_response', 0, mutation);
    }
    if (epoch === authEpoch) csrfToken = value.csrfToken;
    return value;
  }
  async function request(path, method, body, { signal } = {}, epoch = authEpoch) {
    if (signal?.aborted) throw new ServerRequestError('request_aborted');
    if (method === 'POST' && !csrfToken) throw new ServerRequestError('session_required');
    const controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    let dispatched = false;
    try {
      const headers = { Accept: 'application/json' };
      if (method === 'POST') { headers['Content-Type'] = 'application/json'; headers['X-BC-CSRF'] = csrfToken; }
      let encoded;
      try { if (method === 'POST') encoded = JSON.stringify(body); } catch { throw new ServerRequestError('invalid_request'); }
      dispatched = true;
      const response = await fetchImpl(prefix + path, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers, signal: controller.signal, ...(method === 'POST' ? { body: encoded } : {}) });
      const value = await jsonBody(response);
      if (!response.ok) {
        const code = typeof value.error?.code === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(value.error.code) ? value.error.code : 'request_failed';
        if (epoch === authEpoch && (response.status === 401 || /csrf|request_integrity/.test(code))) csrfToken = null;
        throw new ServerRequestError(code, response.status, method === 'POST' && response.status >= 500);
      }
      return value;
    } catch (cause) {
      if (cause instanceof ServerRequestError) {
        if (!cause.status && method === 'POST' && dispatched) cause.uncertain = true;
        throw cause;
      }
      throw new ServerRequestError(controller.signal.aborted ? signal?.aborted ? 'request_aborted' : 'request_timeout' : 'network_unavailable', 0, method === 'POST' && dispatched);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort(); }
  }
  async function authenticate(action, body, options) {
    const epoch = ++authEpoch;
    return acceptSession(await request(`/auth/${action}`, 'POST', body, options, epoch), epoch, true);
  }
  return Object.freeze({
    async session(options) { const epoch = authEpoch; return acceptSession(await request('/auth/session', 'GET', null, options, epoch), epoch); },
    login: (body, options) => authenticate('login', body, options),
    signup: (body, options) => request('/auth/signup', 'POST', body, options),
    recover: (body, options) => request('/auth/recover', 'POST', body, options),
    password: (body, options) => authenticate('password', body, options),
    logout: (options) => authenticate('logout', {}, options),
    organizations: options => request('/orgs', 'GET', null, options),
    bootstrap: (body, options) => request('/orgs', 'POST', body, options),
    workspace: (orgId, options) => request(`/orgs/${segment(orgId)}/workspace`, 'GET', null, options),
    intent: (orgId, body, options) => request(`/orgs/${segment(orgId)}/intent`, 'POST', body, options),
    operation(orgId, operationId, action, body, options) {
      if (!['request', 'review', 'confirm', 'cancel'].includes(action)) throw new ServerRequestError('invalid_action');
      return request(`/orgs/${segment(orgId)}/operations/${segment(operationId)}/${action}`, 'POST', body, options);
    },
  });
}
