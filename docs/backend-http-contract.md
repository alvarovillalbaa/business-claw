# Hosted dashboard HTTP boundary

31 October 2026. This source implements the BFF boundary; resource/configuration
binding and actual acceptance remain separate. Runtime, chat, connectors and
provider dispatch remain unavailable. Browser-local imported workspaces are not
uploaded or treated as server organizations.

## Browser contract

All JSON routes are same-origin under `/api/v1`. Requests use
`credentials: 'same-origin'`; mutations use `Content-Type: application/json`,
the exact configured Origin, and `X-BC-CSRF` from `GET /auth/session`.
Responses are private/no-store. Error bodies are exactly
`{error:{code:'fixed_code'}}`, with no provider/SQL error or secret included.
Missing production bindings fail with 503, never fake success.

`GET /auth/session` returns `{authenticated,user,csrfToken,organizations,execution}`.
`user` is null or `{id,email}`. Each organization is `{id,name,role,serverRevision}`.
`execution` always has `adapter:'unbound',dispatchAllowed:false,
chatAdmissionAllowed:false,readiness:'unproven',ready:false`.
The CSRF token is browser-memory-only; obtain a new session response after any
successful authentication, logout or expired-session response.

| Route | Exact JSON body / result |
| --- | --- |
| POST `/auth/login` | `{email,password}`; returns the session response and rotates the opaque handle. |
| POST `/auth/signup` | `{email,password}`; returns `{accepted:true,delivery:'unverified'}` only when explicitly enabled. |
| POST `/auth/recover` | `{email}`; same neutral accepted response only when explicitly enabled. |
| GET `/auth/callback?code=…&state=…` | Exchanges a same-browser PKCE flow and redirects to `/#server`. |
| GET `/auth/recovery?code=…&state=…` | Exchanges a recovery PKCE flow and redirects to `/#server-recovery`. |
| POST `/auth/password` | `{password}`; requires the matching authenticated recovery flow, changes the provider password and rotates the application handle. |
| POST `/auth/logout` | `{}`; revokes the application handle and returns a signed-out session plus `providerSignout:'confirmed'\|'unverified'`. |
| GET `/orgs` | `{organizations:[…]}` with current active memberships only. |
| POST `/orgs` | `{requestId,name}`; existing policy bootstrap result. |
| GET `/orgs/:orgId/workspace` | Existing policy public workspace result. |
| POST `/orgs/:orgId/intent` | Existing policy `updateIntent` exact body, including matching `orgId`. |
| POST `/orgs/:orgId/operations/:operationId/:action` | `action` is request/review/confirm/cancel; existing policy exact body including matching path IDs. |
| POST `/orgs/:orgId/invites` | Existing `createInvite` exact body. Private invitation delivery remains unbound. |
| POST `/invites/:inviteId/accept` | Existing `acceptInvite` exact body with matching `inviteId`. |
| POST `/orgs/:orgId/invites/:inviteId/revoke` | Existing `revokeInvite` exact body. |
| POST `/orgs/:orgId/members/:userId/role` | Existing `changeMemberRole` exact body. |
| POST `/orgs/:orgId/members/:userId/revoke` | Existing `revokeMember` exact body. |
| POST `/orgs/:orgId/transfers` | Existing `requestOwnerTransfer` exact body. |
| POST `/orgs/:orgId/transfers/:transferId/accept` | Existing `acceptOwnerTransfer` exact body. |

The [policy contract](server-policy-contract.md) owns exact DTO fields, current
role checks, expected server revision/generation, plan hashes, freshness and
replay behavior. No HTTP request can assert actor, role, provider target or
readiness. The invitation token is returned only in its existing private delivery
envelope, never workspace/export/audit. All response bodies must be kept out of
access logs; the BFF does not log request/response bodies or credentials.

## Authentication and activation limits

The BFF owns a 256-bit opaque `__Host-bc_session` cookie (Secure, HttpOnly,
SameSite=Lax, Path=/), absolute eight-hour expiry, separate CSRF and encrypted
private token rows. It calls Supabase Auth online for the user and validates
the verified token's subject, issuer, audience, expiry, non-anonymous identity
and `session_id`; user metadata supplies no authority. Refresh stays under the
session-row lock and never advances the original successful-login time.

Signup/recovery use S256 PKCE, short-lived encrypted HttpOnly flow cookies and
an exact same-origin state-bound callback. Provider tokens never enter browser
JavaScript/localStorage or URLs. Email-confirmed users are required; ordinary
authentication grants no organization membership. Public signup/recovery stay
disabled unless explicit configuration and actual mail/redirect acceptance
qualify them. Default Supabase SMTP is not claimed to deliver public mail.

Online user verification is not proof of immediate external provider-session
revocation; the [identity proposal](proposals/identity-data-activation.md)
documents the JWT-expiry/refresh limit. Business Claw session revocation is
checked on each admitted request. Real database rollback/locking, mail, two-org
acceptance and deployed serving remain unverified until explicitly exercised.

Primary sources inspected: [Auth REST OpenAPI](https://github.com/supabase/auth/blob/master/openapi.yaml),
[password/PKCE flows](https://supabase.com/docs/guides/auth/passwords),
[SSR limits](https://supabase.com/docs/guides/auth/server-side/advanced-guide),
[sessions](https://supabase.com/docs/guides/auth/sessions),
[JWT fields](https://supabase.com/docs/guides/auth/jwt-fields).
## Server bindings and limits

Required environment variables are `BC_APP_ORIGIN` (one HTTPS origin),
`SUPABASE_URL` (the dedicated project's HTTPS origin),
`SUPABASE_PUBLISHABLE_KEY` (publishable key only), `BC_AUTH_TOKEN_KEY_V1`
(canonical base64 containing exactly 32 random bytes), and `DATABASE_URL`.
The database URL must be copied from the actual transaction-pooler metadata:
port 6543, database `postgres`, exact `bc_pool_login.<project-ref>` username,
and a Supabase pooler hostname. URL query options are rejected; TLS explicitly
requires certificate verification. The warm process has at most one connection.
No hostname, credential, SDK fallback or direct-database bypass is invented.

`BC_AUTH_SIGNUP_ENABLED` and `BC_AUTH_RECOVERY_ENABLED` are disabled unless
their value is literally `true`; qualify mail and exact redirect configuration
before enabling either. PKCE redirect configuration must preserve the generated
state query on the two production callback paths, never authorize arbitrary
preview origins. A flow cookie expires after ten minutes. Signup rejects an
unexpected direct-token response, keeping confirmed-email signup mandatory.

Provider fetches have an eight-second deadline, 64 KiB JSON response limit and
no redirects/retries. HTTP JSON input is capped at 64 KiB and response output
at 2 MiB; oversized output fails rather than truncating records. Both Vercel
rewrite URL shapes are supported only when the single `bc_route` agrees with
the canonical original path. Duplicate or mismatched routing inputs are rejected.

## Focused verification

`tests/auth-http.test.mjs` contains 26 authored native Node cases with injected
provider/storage ports. The first run found a denied provider DTO returning
the wrong 400 classification; the source now consistently returns 401 for
malformed verified identity evidence. The justified rerun passed 26/26, with
zero skipped/cancelled/TODO cases and unchanged selected-source byte guards.
No real provider, SQL, account, mail, browser, installation or model call ran.
Fake transaction serialization is not evidence of actual PostgreSQL locking.
