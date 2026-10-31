# Production backend configuration

The API source fails closed until every required binding below exists. Values
belong only in Business Claw's production Vercel project, never frontend code,
Git, a browser export, Preview or CI. The dedicated Supabase project is
`hmmfkbxhrfrfubqnizxd` in Clous / Frankfurt. Still/Kickoff are separate.

| Variable | Required value / owner |
| --- | --- |
| `BC_APP_ORIGIN` | `https://business-claw-alvaro.vercel.app` |
| `SUPABASE_URL` | `https://hmmfkbxhrfrfubqnizxd.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | This project's enabled modern publishable key, already available through the connector. No service-role key. |
| `BC_AUTH_TOKEN_KEY_V1` | A new random 32-byte key encoded as canonical base64; store as a production Secret. Generate only when it can be saved securely. |
| `DATABASE_URL` | Copied transaction-pooler endpoint, port 6543 / database `postgres`, custom username `bc_pool_login.hmmfkbxhrfrfubqnizxd`, and a separately bound role password; store as a production Secret. No URL query options. |
| `BC_AUTH_SIGNUP_ENABLED` | Leave absent/false until confirmed-email signup and its exact callback are qualified. |
| `BC_AUTH_RECOVERY_ENABLED` | Leave absent/false until recovery delivery and its exact callback are qualified. |

The [schema source](../db/schema.sql) creates the private login without a
password. Neither an administrator password nor a guessed pooler hostname is
substituted. Copy the actual transaction-pooler host from this project's Connect
dialog; its cluster index cannot be inferred from Frankfurt. The API uses one
pooled connection per warm process, no named prepared statements, and verified
TLS with `rejectUnauthorized:true`. It rejects URL SSL overrides.

The connected Vercel API currently returns 403 for environment metadata and for
creating new production values. Its scoped CLI fallback is not installed.
No environment value was created; retrying unchanged or extracting another
tool's credentials would not resolve that provider permission boundary.

Auth must retain confirmed-email/password accounts with anonymous access off.
Authorized callbacks are the exact same-origin paths
`/api/v1/auth/callback` and `/api/v1/auth/recovery`, including their state query
handling; no wildcard Preview redirect is proposed. Configure a legitimate SMTP
provider/sender and verify actual signup/recovery delivery before enabling the
flags. Supabase's default mail sender is not public-delivery proof. Invitation
delivery is a separate unbound adapter.

After configuration changes, publish a new exact deployment and qualify actual
login/session/logout, CSRF/cache behavior, two-organization access, concurrent
revision/replay behavior and mail flows. Disposable Postgres and fake Auth tests
cannot replace those live checks. Runtime/chat/MCP remain unavailable until
their separate infrastructure and consent bindings exist.
