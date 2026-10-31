import { randomBytes, randomUUID } from 'node:crypto';
import { createAuth, readAuthConfiguration } from '../server/auth.mjs';
import { createHttpHandler, sendHttpError } from '../server/http.mjs';
import { createServerPolicy } from '../server/policy.mjs';
import { fail } from '../server/data.mjs';

export function readDatabaseConfiguration(env = process.env) {
  try {
    const url = new URL(env.DATABASE_URL), provider = new URL(env.SUPABASE_URL);
    const project = provider.hostname.split('.')[0];
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) || url.port !== '6543' || url.pathname !== '/postgres' || url.search || url.hash || decodeURIComponent(url.username) !== `bc_pool_login.${project}` || !url.password || !/^[a-z]{20}$/.test(project)) fail(503, 'database_unconfigured');
    return Object.freeze({ connectionString: env.DATABASE_URL, ssl: Object.freeze({ rejectUnauthorized: true }), max: 1, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, query_timeout: 10000, allowExitOnIdle: true });
  } catch { fail(503, 'database_unconfigured'); }
}

let runtime;
async function application() {
  if (!runtime) runtime = (async () => {
    const config = readAuthConfiguration(), database = readDatabaseConfiguration();
    const [{ Pool }, { createPostgresStore }] = await Promise.all([import('pg'), import('../server/postgres-store.mjs')]);
    const pool = new Pool(database);
    // The handler owns this one warm-process pool; idle clients do not hold the process open.
    pool.on('error', () => {});
    const store = createPostgresStore({ pool }), auth = createAuth({ store, config });
    const policy = createServerPolicy({ identity: auth, store, clock: { now: () => new Date().toISOString() }, random: { uuid: randomUUID, bytes: randomBytes } });
    return createHttpHandler({ auth, policy });
  })().catch(error => { runtime = undefined; throw error; });
  return runtime;
}

export default async function handler(request, response) {
  try { return await (await application())(request, response); }
  catch (error) { sendHttpError(response, error); }
}
