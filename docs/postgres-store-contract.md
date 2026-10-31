# Private Postgres store

31 October 2026. [`server/postgres-store.mjs`](../server/postgres-store.mjs)
implements the current [policy ports](server-policy-contract.md), with the
source schema in [`db/schema.sql`](../db/schema.sql). It imports no driver,
reads no environment and makes no connection until a caller invokes a transaction.
`createPostgresStore({pool})` requires an injected Pool-compatible `connect()`;
each acquired client must provide `query(text,values)` and `release(destroy)`.

## Transaction and locking contract

`store.transaction(callback)` exposes exactly the policy's session, organization,
bootstrap, membership, invite, transfer and append-audit methods. One acquired
client owns BEGIN, every query, COMMIT/ROLLBACK and release. Queries use unnamed
parameters; no request value becomes an SQL identifier. Callback methods must be
awaited; retained methods reject use after callback completion. No query, trigger,
callback or failed transaction is automatically replayed. A lost COMMIT response
is uncertain: recover through the policy's stable IDs/current-CAS readback.

Isolation is READ COMMITTED with explicit locks, not a claim of unqualified
serializable isolation. Initial policy session reads use FOR SHARE, blocking
Business Claw revocation updates until that decision completes. Organization
rows use FOR UPDATE; all membership effects require that locked organization.
Complete membership lists are ordered, locked and bounded to 1,000 rows.
Invitation/transfer lookup first discovers its organization without a row lock,
then locks that organization before the mutable record. A policy transaction
cannot cross into another organization. This avoids the inverse invite/org
ordering in the higher-level API. Bootstrap uses a transaction advisory lock
for the principal/create-request key plus a database uniqueness constraint.

Auth refresh uses exclusive session locks; policy's shared session locks avoid
the actor-session/org/issuer-session cycle during Owner transfer. These are
application-controlled locks, not a defense against an administrator or a
compromised private BFF issuing arbitrary SQL. Deadlock/serialization/lock-timeout
errors return a fixed transaction-conflict error, never a silent retry.
Statement/lock/idle-transaction timeouts are 8/3/30 seconds. Role, search path
(`pg_catalog` only), timeouts and UTC time zone are transaction-local.

Organization DTOs retain the exact server row and canonical portable workspace.
Operations live inside that workspace JSONB and commit with its server CAS;
this current profile has no separate operations-table write port. The adapter
reuses the domain normalizer and existing session/membership validators.
Created identities, generation and bootstrap binding cannot change through
organization CAS. Membership/invite/transfer effects and minimal audit share
that transaction; any failing effect/audit rolls everything back. No runtime
allocation, command dispatch, broker admission or credential-consent action is added.

## Private Auth seam

`store.authTransaction(handleHashOrNull,callback)` exposes only
`readAuthSession`, `insertAuthSession`, `writeAuthSession`,
`revokeAuthSession(handleHash,at)` and `listOrganizations(userId,handleHash)`.
A supplied handle is exclusively locked before the callback. Null supports
first login; login may revoke an old handle and insert its replacement atomically.

The exact Auth DTO is `{session,envelope}`. Session has the policy's six fields:
`handleHash,userId,supabaseSessionId,authenticatedAt,expiresAt,revokedAt`.
Envelope is `{version:1,iv,tag,ciphertext}`, canonical unpadded base64url;
decoded IV/tag are 12/16 bytes and ciphertext is 1..65,536 bytes. Encryption,
AAD verification and the separately held `BC_AUTH_TOKEN_KEY_V1` belong to the
Auth owner. No plaintext token/password/key or clear recovery grant is stored.

Refresh writes require a previously read locked row and preserve every session
field, updating only encrypted material plus an adapter-private token revision.
Revocation retains its first timestamp and returns true for an existing row.
Organization listing filters current unrevoked/unexpired BC session, exact user,
active membership and active organization in one query; it returns only
`orgId,name,instanceId,generation,serverRevision,role`. A listing is a query-time
snapshot, not authorization for a later action. This does not verify that an
external Supabase session remains active beyond the Auth owner's documented limits.

## Schema, privileges and connection gate

Apply the SQL atomically once to the authorized empty dedicated project after
disposable-PG verification. It creates private organizations, memberships,
application sessions, encrypted envelopes, invitations, Owner transfers and audit.
Auth users are referenced by UUID; creator/membership references restrict removal
until a separately designed retirement cleanup. Sessions cascade when their Auth
user is removed. Historical audit actor/session IDs remain recorded values.

`bc_pool_login` has LOGIN/NOINHERIT and no password in source. It may SET LOCAL
ROLE to `bc_bff`, a NOLOGIN/non-superuser/non-bypass role. `bc_bff` gets schema
USAGE and SELECT/INSERT/UPDATE on the six mutable tables, SELECT/INSERT only on
audit, and no DELETE/TRUNCATE/schema-CREATE grants. All tables have forced RLS
limited to this private role. PUBLIC/anon/authenticated/service_role receive no
schema/table grant or public RPC. These RLS policies exclude client roles; they
do not independently authenticate tenant identity. Current policy ports have no
trusted tenant-GUC interface; server/policy.mjs owns actual admission and scope.

The production pool remains a separate composition responsibility: exact copied
Supavisor transaction host, port 6543, database postgres, custom username
`bc_pool_login.<project-ref>`, privately supplied password, max one connection,
bounded acquisition and explicit `ssl:{rejectUnauthorized:true}`. Do not derive
the pooler cluster index from Frankfurt/region or use an unverified URL. Keep
SSL URL parameters absent because node-postgres can replace the explicit SSL
object with them. No named prepared statements, pipelining, insecure TLS bypass,
service-role table client or secret key in browser code is needed.

The dedicated project is recorded by root as `hmmfkbxhrfrfubqnizxd` in Clous,
Frankfurt. Exact pooler endpoint, login password and hosted environment binding
were still unavailable to this author; no connection metadata is invented here.
The live schema was not applied and no backend test/driver import ran while
authoring. Root owns disposable Postgres 17 integration proof before live DDL.

Activation update: root subsequently passed all14 disposable-Postgres cases
within the116-case integrated CI scope, then applied this exact schema to the
dedicated project as migration `20261031191243_business_claw_private_control_plane`.
Live catalog/grant checks and security advisors passed. The
[activation receipt](results/2026/10-31/backend-activation.md) owns that later
proof and remaining production connection/Auth/mail gates. Do not replay the
first schema against this existing project.

Primary references: [node-postgres transactions](https://node-postgres.com/features/transactions),
[TLS configuration](https://node-postgres.com/features/ssl),
[pool lifecycle](https://node-postgres.com/apis/pool), and
[Postgres locking](https://www.postgresql.org/docs/current/explicit-locking.html).
