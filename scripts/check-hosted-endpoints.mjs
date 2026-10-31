import assert from 'node:assert/strict';

// Read-only, unauthenticated checks of the approved public canonical deployment.
const origin = 'https://business-claw-alvaro.vercel.app';
const paths = ['/', '/api/v1/auth/session', '/api/v1/orgs'];
for (const path of paths) {
  const response = await fetch(origin + path, { redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { Accept: path === '/' ? 'text/html' : 'application/json' } });
  const reader = response.body.getReader(); let length = 0; const chunks = [];
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength; assert(length <= 512 * 1024, 'Response is bounded'); chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  if (path === '/') {
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type') ?? '', /^text\/html\b/);
    assert(body.includes('id="view-server"')); assert(body.includes('id="import-file"'));
  } else {
    assert.equal(response.status, 503); assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/);
    assert.match(response.headers.get('cache-control') ?? '', /private/); assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    assert.deepEqual(JSON.parse(body), { error: { code: 'backend_unconfigured' } });
  }
  console.log(JSON.stringify({ path, status: response.status, bytes: length, checked: path === '/' ? 'public HTML only' : 'unconfigured backend denies access without caching' }));
}
