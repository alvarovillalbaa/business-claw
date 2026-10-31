import { PolicyError, fail, freeze } from './data.mjs';

const UUID = '[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}';
const inputLimit = 65536, outputLimit = 2 * 1024 * 1024;
const routes = [
  [`^/orgs/(${UUID})/intent$`, 'updateIntent', ['orgId']],
  [`^/orgs/(${UUID})/operations/(${UUID})/(request|review|confirm|cancel)$`, null, ['orgId', 'operationId']],
  [`^/orgs/(${UUID})/invites$`, 'createInvite', ['orgId']],
  [`^/invites/(${UUID})/accept$`, 'acceptInvite', ['inviteId']],
  [`^/orgs/(${UUID})/invites/(${UUID})/revoke$`, 'revokeInvite', ['orgId', 'inviteId']],
  [`^/orgs/(${UUID})/members/(${UUID})/role$`, 'changeMemberRole', ['orgId', 'userId']],
  [`^/orgs/(${UUID})/members/(${UUID})/revoke$`, 'revokeMember', ['orgId', 'userId']],
  [`^/orgs/(${UUID})/transfers$`, 'requestOwnerTransfer', ['orgId']],
  [`^/orgs/(${UUID})/transfers/(${UUID})/accept$`, 'acceptOwnerTransfer', ['orgId', 'transferId']],
].map(([pattern, method, fields]) => [new RegExp(pattern), method, fields]);

export function sendHttpResult(response, status, body, cookies = [], redirect = null) {
  const raw = JSON.stringify(body);
  if (Buffer.byteLength(raw, 'utf8') > outputLimit) fail(503, 'response_limit');
  response.statusCode = status;
  for (const [key, value] of Object.entries({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store, max-age=0', 'Pragma': 'no-cache', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' })) response.setHeader(key, value);
  if (cookies.length) response.setHeader('Set-Cookie', cookies);
  if (redirect) response.setHeader('Location', redirect);
  response.end(raw);
}
export function sendHttpError(response, error) {
  const recognized = error instanceof PolicyError && [400, 401, 403, 404, 405, 408, 409, 413, 415, 429, 503].includes(error.status) && /^[a-z][a-z0-9_]{0,63}$/.test(error.code);
  sendHttpResult(response, recognized ? error.status : 503, { error: { code: recognized ? error.code : 'backend_unavailable' } });
}
function contextFor(request) {
  const headers = Object.create(null);
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    if (typeof value === 'string') headers[name.toLowerCase()] = value;
    else if (value !== undefined) fail(400, 'header_invalid');
  }
  const names = ['origin', 'content-type', 'content-length', 'cookie', 'x-bc-csrf'];
  for (const name of names) {
    let count = 0;
    for (let index = 0; index < (request.rawHeaders?.length ?? 0); index += 2) if (request.rawHeaders[index].toLowerCase() === name) count++;
    if (count > 1) fail(400, 'header_invalid');
  }
  return freeze({ headers });
}
async function readBody(request, context) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(context.headers['content-type'] ?? '')) fail(415, 'json_required');
  const declared = context.headers['content-length'];
  if (declared !== undefined && (!/^\d{1,8}$/.test(declared) || Number(declared) > inputLimit)) fail(413, 'request_limit');
  try {
    let raw;
    if (request.body !== undefined) {
      raw = typeof request.body === 'string' || Buffer.isBuffer(request.body) ? request.body : JSON.stringify(request.body);
      if (Buffer.byteLength(raw, 'utf8') > inputLimit) fail(413, 'request_limit');
      if (Buffer.isBuffer(raw)) raw = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    } else {
      const chunks = []; let length = 0, expired = false;
      const timer = setTimeout(() => { expired = true; request.destroy?.(); }, 5000);
      try { for await (const chunk of request) { const value = typeof chunk === 'string' ? Buffer.from(chunk) : chunk; length += value.byteLength; if (length > inputLimit) fail(413, 'request_limit'); chunks.push(value); } }
      finally { clearTimeout(timer); }
      if (expired) fail(408, 'request_timeout');
      raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    }
    const result = JSON.parse(raw);
    if (!result || typeof result !== 'object' || Array.isArray(result)) fail(400, 'record_invalid');
    return result;
  } catch (error) { if (error instanceof PolicyError) throw error; fail(400, 'json_invalid'); }
}

export function createHttpHandler({ auth, policy }) {
  if (!auth || !policy) fail(503, 'backend_unconfigured');
  return async function handler(request, response) {
    try {
      const context = contextFor(request), method = request.method;
      if (typeof request.url !== 'string' || request.url.length > 4096 || !request.url.startsWith('/') || request.url.startsWith('//')) fail(400, 'route_invalid');
      const url = new URL(request.url, 'https://request.invalid');
      let pathname = url.pathname;
      // Vercel may expose the explicit rewrite destination instead of the original path.
      if (url.searchParams.has('bc_route')) {
        const path = url.searchParams.get('bc_route');
        if (url.searchParams.getAll('bc_route').length !== 1 || !/^[a-z0-9/-]{1,256}$/.test(path)) fail(400, 'route_invalid');
        const canonical = `/api/v1/${path}`;
        if (pathname !== '/api/v1' && pathname !== canonical) fail(400, 'route_invalid');
        pathname = canonical; url.searchParams.delete('bc_route');
      }
      if (!pathname.startsWith('/api/v1/') || pathname.includes('%')) fail(404, 'not_found');
      const path = pathname.slice('/api/v1'.length);
      const callback = path === '/auth/callback' || path === '/auth/recovery';
      if (callback && method === 'GET') {
        if (url.searchParams.size !== 2 || url.searchParams.getAll('code').length !== 1 || url.searchParams.getAll('state').length !== 1) fail(400, 'callback_invalid');
        const result = await auth.callback(context, { code: url.searchParams.get('code'), state: url.searchParams.get('state') }, path === '/auth/recovery' ? 'recovery' : 'signup');
        return sendHttpResult(response, 303, { redirected: true }, result.cookies, result.redirect);
      }
      if (url.searchParams.size !== 0) fail(400, 'query_invalid');
      if (method === 'GET' && path === '/auth/session') {
        const result = await auth.session(context); return sendHttpResult(response, 200, result.body, result.cookies);
      }
      if (method === 'GET' && path === '/orgs') {
        const result = await auth.session(context); if (!result.body.authenticated) fail(401, 'unauthenticated');
        return sendHttpResult(response, 200, { organizations: result.body.organizations }, result.cookies);
      }
      const workspace = path.match(new RegExp(`^/orgs/(${UUID})/workspace$`));
      if (method === 'GET' && workspace) return sendHttpResult(response, 200, await policy.readWorkspace(context, { orgId: workspace[1] }));
      if (method !== 'POST') fail(method === 'GET' ? 404 : 405, method === 'GET' ? 'not_found' : 'method_not_allowed');
      auth.requireMutation(context);
      const body = await readBody(request, context);
      if (['/auth/login', '/auth/signup', '/auth/recover', '/auth/password', '/auth/logout'].includes(path)) {
        const result = await auth[path.slice('/auth/'.length)](context, body);
        return sendHttpResult(response, 200, result.body, result.cookies);
      }
      if (path === '/orgs') return sendHttpResult(response, 200, await policy.bootstrap(context, body));
      for (const [pattern, selected, fields] of routes) {
        const match = path.match(pattern); if (!match) continue;
        for (let index = 0; index < fields.length; index++) if (body[fields[index]] !== match[index + 1]) fail(400, 'path_binding');
        const name = selected ?? `${match[3]}Operation`;
        return sendHttpResult(response, 200, await policy[name](context, body));
      }
      if (new RegExp(`^/orgs/(${UUID})/(chat|admissions)$`).test(path)) {
        const orgId = path.split('/')[2]; await policy.readWorkspace(context, { orgId }); fail(503, 'runtime_unbound');
      }
      fail(404, 'not_found');
    } catch (error) { sendHttpError(response, error); }
  };
}
