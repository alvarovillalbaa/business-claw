# Identity and data activation proposal

Last updated: 2026-10-31

**INACTIVE review packet.** This proposes Supabase Auth + Postgres and a Vercel BFF for [the managed product](../spec.md). The [next source milestone](activation-plan.md) is inactive access-policy code using Node built-ins, the existing domain and injected ports: no dependency/lockfile, CI, migration, deployed API or live Auth change. The complete policy/SQL/broker design below needs later exact activation approval. Nothing is applied here. The [architecture](managed-service-architecture.md) still owns runtime isolation. The sealed 21 source inputs and pending 14-domain/four-browser scopes are unchanged; neither authorizes new checks or activation.

## Binding and activation prerequisites

Propose a dedicated Business Claw Supabase project in **Clous**. Current read-only metadata confirms its Free plan, two active and three inactive projects, no Business Claw database; the [two-active-project quota](https://supabase.com/docs/guides/platform/billing-faq) is used. No free slot is verified, and the owner previously declined a paid plan. Owner, region and project reference remain unset. Do not reuse, pause, restore or upgrade another app to make room. Resolve capacity explicitly before live provisioning; no $0 or availability claim is made.

Propose `https://claw.alvarovillalba.com` for dashboard + HTTPS `/api/v1` Vercel BFF; `https://api.claw.alvarovillalba.com` serves only the separate long-lived broker. Read-only domain metadata confirms Vercel nameservers and no existing `claw`/`api.claw` records; the reported dashboard CNAME candidate is `ead5c549fd497786.vercel-dns-016.com`. No DNS/certificate/Auth URL change occurred. Register only dashboard `/auth/callback` and `/auth/recovery`; no wildcard preview redirects. Region, retention and actual credentials remain activation gates. Future dependency candidates from the owner's registry read are `@supabase/supabase-js@2.118.0` (Node ≥22), `pg@8.23.1` (Node ≥16), broker `ws@8.22.0`; these are outside the next source-only approval. No install/lockfile change occurred; do not use deprecated framework adapters or guess SDK signatures.

Initial Auth choice: confirmed-email/password accounts; no anonymous sign-in, social linking or automatic organization membership. Passwords go only through TLS Auth endpoints, never portable records/logs. Custom SMTP provider and sender ownership are unknown. Proposed sender `auth@notify.claw.alvarovillalba.com` requires separate provider consent, SPF/DKIM/DMARC and delivery configuration. Confirmation, recovery and application-invitation delivery must reach actual approved recipients before customer signup opens. A contact email, configured-looking form or Auth HTTP success is not delivery proof. Supabase documents that its default sender refuses non-team recipients. [SMTP](https://supabase.com/docs/guides/auth/auth-smtp)

## Principal, session and scope policy proposed for approval

The BFF owns a random 256-bit opaque `__Host-bc_session` cookie: HttpOnly, Secure, SameSite=Lax, path `/`, eight-hour application expiry. The browser calls only the BFF, not Supabase data/Auth SDKs; this is a custom BFF session, not Supabase's browser/SSR cookie adapter. Store only the handle's SHA-256 hash and server-encrypted Auth tokens in private Postgres. Rotate the handle after authentication/recovery; reject mismatched Origin and require a session-bound CSRF token on every mutation. Auth/private responses use `Cache-Control: private, no-store`; no CDN session-response cache. [Server-side limits](https://supabase.com/docs/guides/auth/server-side/advanced-guide)

Every admitted request resolves the opaque handle, checks Business Claw expiry/revocation, calls `getUser(accessToken)` online and matches its authenticated subject to the session row. This is an identity check, not a claimed proof that `session_id` remains active. The official SSR guide warns **“an unexpired token stays valid even when the session behind it was revoked.”** The dedicated session guide describes an `auth.sessions` row check for stronger guarantees; no such Auth-schema grant/function is proposed here. External provider revocation retains its actual JWT-expiry/refresh limit until a concrete stronger mechanism is reviewed and qualified. Membership/role come from fresh DB rows, never request authority, `user_metadata` or cached JWT teams. [getUser](https://supabase.com/docs/reference/javascript/auth-getuser), [JWT freshness](https://supabase.com/docs/guides/database/postgres/row-level-security)

| Principal | Read status/non-secret ledger | Chat | Request/review/confirm lifecycle | Membership, credentials and retirement |
| --- | --- | --- | --- | --- |
| Signed out/unconfirmed/Business Claw session or membership revoked | None | None | None | None |
| Owner | Own organization | Admitted org-shared sessions | All five kinds | Invite/revoke/transfer; credential consent; exact-resource delete |
| Administrator | Own organization | Admitted org-shared sessions | Configure/pause/resume only | Settings/connector consent; no membership/owner grant or delete |
| Member | Own organization | Admitted org-shared sessions | None | None |
| Viewer | Own organization | Read permitted shared sessions only | None | None |
| Worker/support | No customer-session authority | None by default | No authority from this packet | Separate reviewed workload/support identity required |

Scopes are explicit BFF capabilities (`org:read`, `chat:read/write`, `intent:write`, `operation:request/review/confirm/cancel`, `membership:write`, `credential:consent`, `instance:retire`), not OpenClaw operator grants. Owner/Admin may review and confirm their own permitted request through distinct preview/decision/confirmation steps; this is explicitly **one-person confirmation**, not separation-of-duties proof. Provision/delete require Owner plus fresh authentication within five minutes and an exact org/instance/generation/revision/hash display. Actual execution remains blocked on the runtime/resource approval and server adapter. No imported local review or confirmation can authorize it.

Bootstrap: a confirmed principal may create an organization; one transaction creates its server-generated org/instance IDs, first Owner membership and audit row. Bind a caller's stable create-request UUID/hash to that principal; exact retry recovers the original, conflicting reuse returns 409. Recovery never restores revoked membership; current admission still governs access to the result. Owner invitations carry a server-generated single-use 256-bit token (hash only in DB), verified recipient email, intended role and seven-day expiry. Invites cannot grant Owner; recipient must authenticate with the matching confirmed email before atomic acceptance. Recheck that the issuing Owner is still active, the org is active and the invite is unused/unrevoked/unexpired. An accepted-token replay returns its recorded acknowledgment and never restores a later-revoked membership; re-admission needs a new valid invitation. Never change an existing active role through invite acceptance. Owner transfer requires the existing Owner's fresh authentication, recipient acceptance and a locked membership check. Never revoke/demote the last active Owner; no support/bootstrap bypass endpoint exists.

Business Claw revocation updates its membership/session row under lock and denies the next admitted request; logout revokes its handle and explicitly signs out the current Supabase session. It does not instantly invalidate every copied JWT. Broker leases recheck **Business Claw-owned** session/member revocation every 15 seconds; stream closure within that budget is an unproven target, not a Supabase revocation guarantee. External Auth revocation remains bounded by the qualified provider/JWT behavior, not this lease promise. No revocation retracts material already read. [Sessions](https://supabase.com/docs/guides/auth/sessions)

The host-only cookie is never sent to the broker. A live-enabled BFF may issue a 60-second, one-use opaque admission ticket bound to origin, principal/session, org, instance, generation and chat scope; retain only its hash. Send it in the first WebSocket message, never a URL/query token. The separately authenticated broker asks the BFF to atomically consume it and recheck live membership/target before admission or lease renewal. Issuance stays disabled while runtime binding is absent; portable v1 confirmation records confer no admission or dispatch authority.

## Proposed private schema and grants — do not execute

Use an unexposed `bc_private` schema and a dedicated server connection role; no business Data API schema, RPC or browser table grant. Browser code may know a publishable key/project URL, but receives no DB password, secret/service-role key, runtime token or opaque secret reference. New Supabase secret keys bypass RLS and are server-only; this packet does not give one to the browser or use it as tenancy enforcement. [Keys](https://supabase.com/docs/guides/getting-started/api-keys)

The following is the proposed first schema. `body` fields are BFF-constructed canonical records, never raw-import writes; portable imports stay local. Runtime `secret_ref` values remain pointers to a separately approved provider secret store. Auth token envelopes are BFF-owned AES-256-GCM ciphertext, 12-byte nonce/16-byte tag, associated with user/session/handle/key-version. `BC_AUTH_TOKEN_KEY_V1` is a separate 32-byte Vercel server secret; never Postgres, browser, broker or Gateway data. Serialize refresh under the session-row lock and use isolated server Auth clients, not shared current-user state. No plaintext credential/transcript column is proposed.

Propose server login `bc_pool_login`, NOINHERIT/non-owner/non-bypass, permitted to `SET LOCAL ROLE bc_bff` only inside a transaction. Its generated password goes only to Vercel's server `DATABASE_URL`; activation must bind the actual copied Supavisor transaction endpoint, username `bc_pool_login.<project-ref>`, port 6543, verified TLS certificate/hostname, one pooled connection per warm function and no named prepared statements/pipelining. Host/region cannot be guessed. This is an inactive identity specification, not an existing usable credential. No worker, support, Auth client or `authenticator` receives the role/key. [Connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [roles](https://supabase.com/docs/guides/database/postgres/roles)

```sql
-- INACTIVE PROPOSAL ONLY. No migration file or database execution is authorized.
create role bc_bff nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
create role bc_pool_login login noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
grant bc_bff to bc_pool_login; -- No password set: credential binding is a later gate.
create schema bc_private;
revoke all on schema bc_private from public, anon, authenticated, service_role;
grant usage on schema bc_private to bc_bff;
create table bc_private.organizations (
 id uuid primary key, name text not null, created_by uuid not null references auth.users(id),
 create_request_id uuid not null, request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
 revision bigint not null default 0 check(revision>=0), state text not null check(state in ('active','deleting','deleted')),
 created_at timestamptz not null, updated_at timestamptz not null, unique(created_by,create_request_id));
create table bc_private.memberships (
 org_id uuid references bc_private.organizations(id), user_id uuid references auth.users(id),
 role text not null check(role in ('owner','administrator','member','viewer')), revoked_at timestamptz,
 primary key(org_id,user_id));
create table bc_private.instances (
 org_id uuid references bc_private.organizations(id), id uuid not null, generation bigint not null check(generation>0),
 desired_revision bigint not null check(desired_revision>=0), desired_setup jsonb not null check(jsonb_typeof(desired_setup)='object'), is_current boolean not null,
 primary key(org_id,id,generation));
create unique index bc_one_current_instance on bc_private.instances(org_id) where is_current;
create table bc_private.operations (
 org_id uuid not null, id uuid not null, instance_id uuid not null, generation bigint not null,
 requester_id uuid not null references auth.users(id), request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
 kind text not null check(kind in ('provision','configure','pause','resume','delete')), body jsonb not null,
 check((jsonb_typeof(body)='object' and body->>'id'=id::text and body->>'orgId'=org_id::text and body->>'instanceId'=instance_id::text and body->>'generation'=generation::text and body->>'actorId'=requester_id::text and body->>'kind'=kind) is true),
 primary key(org_id,id), foreign key(org_id,instance_id,generation) references bc_private.instances(org_id,id,generation));
create table bc_private.invites (
 org_id uuid references bc_private.organizations(id), id uuid not null, email text not null,
 role text not null check(role in ('administrator','member','viewer')), token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
 invited_by uuid not null references auth.users(id), expires_at timestamptz not null,
 revoked_at timestamptz, accepted_by uuid references auth.users(id), primary key(org_id,id));
create table bc_private.sessions (
 handle_hash text primary key check(handle_hash ~ '^[0-9a-f]{64}$'), user_id uuid not null references auth.users(id),
 supabase_session_id uuid not null, authenticated_at timestamptz not null,
 expires_at timestamptz not null, revoked_at timestamptz, unique(handle_hash,user_id));
create table bc_private.auth_token_envelopes (
 session_handle text primary key, user_id uuid not null, key_version text not null,
 nonce bytea not null check(octet_length(nonce)=12), tag bytea not null check(octet_length(tag)=16), ciphertext bytea not null,
 foreign key(session_handle,user_id) references bc_private.sessions(handle_hash,user_id));
create table bc_private.credential_refs (
 org_id uuid not null, id uuid not null, instance_id uuid not null, generation bigint not null,
 kind text not null check(kind in ('provider','notion','gateway')), secret_ref text not null,
 primary key(org_id,id), foreign key(org_id,instance_id,generation) references bc_private.instances(org_id,id,generation));
create table bc_private.admissions (
 token_hash text primary key check(token_hash ~ '^[0-9a-f]{64}$'), org_id uuid not null, instance_id uuid not null,
 generation bigint not null, user_id uuid not null references auth.users(id), session_handle text not null,
 scope text not null check(scope in ('chat:read','chat:write')), origin text not null, expires_at timestamptz not null, consumed_at timestamptz,
 foreign key(org_id,instance_id,generation) references bc_private.instances(org_id,id,generation), foreign key(session_handle,user_id) references bc_private.sessions(handle_hash,user_id));
create table bc_private.audit (
 org_id uuid not null references bc_private.organizations(id), id uuid not null, actor_id uuid not null,
 session_id uuid not null, action text not null, at timestamptz not null, metadata jsonb not null, primary key(org_id,id));
revoke all on all tables in schema bc_private from public, anon, authenticated, service_role;
alter default privileges in schema bc_private revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema bc_private revoke execute on functions from public, anon, authenticated, service_role;
grant select,insert,update on bc_private.organizations,bc_private.memberships,bc_private.instances,
 bc_private.operations,bc_private.invites,bc_private.sessions,bc_private.auth_token_envelopes,bc_private.credential_refs,bc_private.admissions to bc_bff;
grant select,insert on bc_private.audit to bc_bff;
do $$ declare t text; begin
 foreach t in array array['organizations','memberships','instances','operations','invites','sessions','auth_token_envelopes','credential_refs','admissions','audit'] loop
  execute format('alter table bc_private.%I enable row level security',t);
  execute format('alter table bc_private.%I force row level security',t);
 end loop;
 foreach t in array array['instances','operations'] loop
  execute format('create policy scope_read on bc_private.%I for select to bc_bff using (org_id::text=current_setting(''bc.org_id'',true))',t);
 end loop;
 foreach t in array array['instances','credential_refs'] loop
  execute format('create policy scope_write on bc_private.%I for all to bc_bff using (org_id::text=current_setting(''bc.org_id'',true) and current_setting(''bc.role'',true) in (''owner'',''administrator'')) with check (org_id::text=current_setting(''bc.org_id'',true) and current_setting(''bc.role'',true) in (''owner'',''administrator''))',t);
 end loop;
end $$;
create policy org_scope on bc_private.organizations to bc_bff using(id::text=current_setting('bc.org_id',true)) with check(id::text=current_setting('bc.org_id',true) and current_setting('bc.role',true) in ('owner','administrator'));
create policy bootstrap_lookup on bc_private.organizations for select to bc_bff using(created_by::text=current_setting('bc.actor_id',true) and create_request_id::text=current_setting('bc.create_request_id',true));
create policy member_lookup on bc_private.memberships for select to bc_bff using(true);
create policy member_write on bc_private.memberships for all to bc_bff using(org_id::text=current_setting('bc.org_id',true) and current_setting('bc.role',true)='owner') with check(org_id::text=current_setting('bc.org_id',true) and current_setting('bc.role',true)='owner');
create policy member_invite_insert on bc_private.memberships for insert to bc_bff with check(org_id::text=current_setting('bc.org_id',true) and user_id::text=current_setting('bc.actor_id',true) and role=current_setting('bc.invite_role',true) and role in ('administrator','member','viewer') and revoked_at is null);
create policy member_reinvite on bc_private.memberships for update to bc_bff using(org_id::text=current_setting('bc.org_id',true) and user_id::text=current_setting('bc.actor_id',true) and revoked_at is not null) with check(org_id::text=current_setting('bc.org_id',true) and user_id::text=current_setting('bc.actor_id',true) and role=current_setting('bc.invite_role',true) and role in ('administrator','member','viewer') and revoked_at is null);
create policy invite_owner on bc_private.invites to bc_bff using(org_id::text=current_setting('bc.org_id',true) and current_setting('bc.role',true)='owner') with check(org_id::text=current_setting('bc.org_id',true) and current_setting('bc.role',true)='owner');
create policy invite_recipient_read on bc_private.invites for select to bc_bff using(token_hash=current_setting('bc.invite_hash',true) and email=current_setting('bc.email',true) and (accepted_by::text=current_setting('bc.actor_id',true) or (revoked_at is null and accepted_by is null and expires_at>now())));
create policy invite_accept on bc_private.invites for update to bc_bff using(token_hash=current_setting('bc.invite_hash',true) and email=current_setting('bc.email',true) and revoked_at is null and accepted_by is null and expires_at>now()) with check(org_id::text=current_setting('bc.org_id',true) and token_hash=current_setting('bc.invite_hash',true) and email=current_setting('bc.email',true) and role=current_setting('bc.invite_role',true) and accepted_by::text=current_setting('bc.actor_id',true));
create policy operation_write on bc_private.operations for all to bc_bff using(org_id::text=current_setting('bc.org_id',true) and (current_setting('bc.role',true)='owner' or (current_setting('bc.role',true)='administrator' and kind in ('configure','pause','resume')))) with check(org_id::text=current_setting('bc.org_id',true) and (current_setting('bc.role',true)='owner' or (current_setting('bc.role',true)='administrator' and kind in ('configure','pause','resume'))));
create policy session_scope on bc_private.sessions to bc_bff using(handle_hash=current_setting('bc.handle_hash',true)) with check(handle_hash=current_setting('bc.handle_hash',true) and user_id::text=current_setting('bc.actor_id',true));
create policy envelope_scope on bc_private.auth_token_envelopes to bc_bff using(session_handle=current_setting('bc.handle_hash',true)) with check(session_handle=current_setting('bc.handle_hash',true) and user_id::text=current_setting('bc.actor_id',true));
create policy admission_read on bc_private.admissions for select to bc_bff using(token_hash=current_setting('bc.ticket_hash',true));
create policy admission_write on bc_private.admissions for all to bc_bff using(token_hash=current_setting('bc.ticket_hash',true)) with check(org_id::text=current_setting('bc.org_id',true) and user_id::text=current_setting('bc.actor_id',true) and session_handle=current_setting('bc.handle_hash',true));
create policy audit_read on bc_private.audit for select to bc_bff using(org_id::text=current_setting('bc.org_id',true) and current_setting('bc.role',true) in ('owner','administrator'));
create policy audit_append on bc_private.audit for insert to bc_bff with check(org_id::text=current_setting('bc.org_id',true) and actor_id::text=current_setting('bc.actor_id',true));
```

The BFF is the trusted boundary: transaction-local scope values come only from its verified subject and freshly read membership, never client/JWT role fields; set them with parameterized `set_config(..., true)`. The membership lookup is deliberately global to this private server role so it can resolve identity; it is not a customer-readable table. RLS scopes a correctly admitted transaction and does **not** defend against a compromised BFF credential that can choose those settings. Lock org/membership/invite rows before writes, check role/kind/last-Owner/target rules, and commit revision CAS, domain changes and minimal audit together. Bootstrap alone sets Owner for a newly generated org; recipient acceptance binds token/email, checks the issuer, then sets only the invite's exact org/role. `authenticated_at` comes from an actual successful Auth login/re-authentication, never cookie access or token refresh. No `SECURITY DEFINER` function, public RPC, view or direct client write is proposed. Secret-ref API responses are redacted, regardless of SQL visibility.

Grants and RLS are separate controls. The [current Data API breaking change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically) removes automatic exposure; do not assume either old defaults or automatic grants. Verify the actual project's exposed schemas/default privileges before activation. Do not disable the Data API on a shared project or alter unrelated grants. [API security](https://supabase.com/docs/guides/api/securing-your-api)

## Endpoint binding and proof before activation

`POST /api/v1/auth/{signup,login,logout,recover}` and callback/recovery routes manage only verified principal/session. `POST /orgs`, `/orgs/:org/invites`, `/invites/:id/accept`, and `/orgs/:org/members/:user` enforce bootstrap/Owner rules: a **requested** allowed role change is input, never proof that the caller holds that role. `GET /orgs/:org/workspace` is redacted. Intent and `/orgs/:org/operations/:id/{request,review,confirm,cancel}` take exact typed fields, expected revision/generation and server-bound hashes; foreign ownership gives 404, stale/conflicting replay 409. Broker admission issuance/consumption stays disabled until workload binding is separately approved. No endpoint trusts caller-asserted actor/authority, arbitrary runtime URL/provider resource ID/secret reference, or imported “confirmed/ready” flag. Chat/connector/dispatch remain absent until their adapter scopes exist.

Propose a separately approved disposable two-org acceptance scope: two Owners plus Admin/Member/Viewer and a revoked principal; real confirmed-email, recovery and invitation delivery; exact bootstrap/invite replay and last-Owner checks; cross-org ID/body/operation/session substitution denials; direct anon/authenticated Data API denial; stale roles/JWTs and logout denial; CSRF/origin and cache isolation; atomic concurrent revision/replay behavior; secret/log/export redaction; interrupted invite and membership-revocation recovery. Use authored non-secret records, no runtime/model/MCP calls. Stream revocation and real workload isolation are later runtime acceptance, not covered by these DB/Auth cases. Freeze case names, project/cleanup target, source hashes and cost before asking to run them.

Official evidence inspected 2026-10-31: Supabase changelog, Auth sessions/SSR/getUser, SMTP, API keys/security and RLS guides linked above. Markdown changelog fetch was unsupported, so its official HTML index and relevant breaking-change page were read. No account, SQL, policy, DNS, delivery, dependency or test action occurred; no Auth/session/isolation/readiness guarantee is established by this document.
