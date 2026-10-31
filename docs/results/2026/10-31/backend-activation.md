# Backend activation progress

31 October 2026. The owner clarified the capacity approval as “Means 'Keep going'.
Do all the work.” This authorizes the named free-capacity change and necessary
backend implementation/checks. Paid plans and customer runtime spend remain
outside this work.

## Free project provisioned

Immediately before pausing Dearweek `faftywddybmgamvseibe`, actual counts again
reported zero Auth users, zero Storage objects and zero rows across all twelve
application tables. Clous remained Free, with both active slots occupied. The
fresh provisioning quote was $0/month. No personal records or object contents
were exported.

The pause was accepted once, reconciled through PAUSING, then read back as
INACTIVE. The first create request returned an explicit cost-confirmation-ID
requirement without creating a project. Under the existing $0 approval, the
required confirmation was obtained and one project created:

- Project: **Business Claw**, `hmmfkbxhrfrfubqnizxd`.
- Organization: **Clous**, `jnmtatndgpzawemtiukl`, Free.
- Region: **eu-central-1 / Frankfurt**.
- Status: **ACTIVE_HEALTHY**, independently read back.
- API URL: `https://hmmfkbxhrfrfubqnizxd.supabase.co`.
- Database release: `17.11.0.011` (Postgres 17).

The final listing reports Still ACTIVE_HEALTHY, Dearweek INACTIVE and Business
Claw ACTIVE_HEALTHY. Kickoff stays on Still's existing shared service. Dearweek's
cloud features are unavailable while paused, as approved. No project/data was
deleted; rollback capacity remains subject to the original
[free-capacity packet](../../../proposals/free-capacity.md).

## Configuration boundaries

Provisioning is not a working application backend. Vercel's scoped environment
metadata request returned 403 forbidden. A separate authorized create request
for two new non-secret production values also returned 403, explicitly requiring
production environment permissions. No environment value was created. Its
mapped CLI is not installed, so no alternate credentials or permission bypass
was attempted. The Supabase CLI
2.117.0 can run with documented per-command telemetry/update-notifier opt-outs,
but its normal project listing reports no authenticated CLI account. No tokens
were searched or extracted.

The exact shared-pooler cluster hostname and Auth URL/SMTP configuration remain
unverified. A pooler hostname cannot be derived from the region. No guessed DSN,
disabled TLS check, public service-role key or fake Auth account is substituted.
Server/UI source must fail closed until actual bindings are configured.

Storage Guard reports 25.4 GiB free, below the 34 GiB preflight requirement.
There is no local installation, build environment or database. The exact
`pg@8.23.1` pin was verified against npm; temporary public GitHub CI is capped at
20 minutes and uses authored/disposable checks without production secrets.
The first CI source, `565ef55f454f578c972242806746e9ee5c89a815`, generated and
installed the pinned lock without lifecycle scripts. Its
[run](https://github.com/alvarovillalbaa/business-claw/actions/runs/41231547823)
passed all64 existing domain/runtime/policy cases with zero failures, skips,
cancellations or TODOs; the seven-module static check also passed. The generated
5,692-byte lock contains14 packages and was recovered byte-exactly from the
bounded public job output, SHA-256
`116c9767da06a8307f2b414f38bccdaad9a78ae4a234e211e69a6aa88115114b`.
No local dependency environment was created. New Auth/HTTP/store acceptance
outcomes remain separate from those existing regressions.

The new [Auth/HTTP checks](auth-http-checks.md) passed26/26 after correcting a
malformed-provider error normalization defect; the first25/26 result is retained.
The [client checks](server-client-checks.md) passed12/12 with fake fetch only.
Neither scope used a live identity, mail, database or browser. The14 real-store
cases subsequently passed in the integrated run below.

Current primary guidance inspected: [connection modes and copied pooler host](https://supabase.com/docs/guides/database/connecting-to-postgres),
[project pausing](https://supabase.com/docs/guides/platform/free-project-pausing),
[node-postgres transactions](https://node-postgres.com/features/transactions),
[TLS configuration](https://node-postgres.com/features/ssl). The changelog Markdown
fetch was unsupported; its official HTML index was inspected instead. These
sources explain platform behavior, while resource status above comes from the
connected account readbacks.

## Integrated source and live schema verified

Source **`260541c40a445ba714dcf67b6e6d546cabeb1407`**, tree
`481c6b286ee8b45c3ff14b63027aef17e6835343`, implements the private Postgres
store, native Auth/HTTP API, and separate server dashboard. The
[integrated run](https://github.com/alvarovillalbaa/business-claw/actions/runs/41233004544)
passed **116/116 cases**:64 existing,26 Auth/HTTP,12 client and14 actual
PostgreSQL transaction cases. Failures, cancellations, skips, TODOs and suites
were all zero. The disposable service used ordinary PG17 with an Auth-shaped
UUID fixture table and fake identity evidence, not real Supabase accounts.
Its container cleanup step succeeded. These cases prove their declared
transaction/rollback/CAS/access scope, not public Auth or two actual customers.

The12-module static validator also passed, with20 relative imports,4 builtins,
one pinned dependency import and130 HTML IDs. It imports no product code and
runs no product test. Exact Vercel production
`dpl_F4jXDXwqAJswQVXhFJaYJ5JemERP` was read back READY at260541c, with the
canonical alias; the build installed the lock without lifecycle scripts.

Only after that success, a fresh live preflight again found no Auth users,
Storage objects, Business Claw schema or Business Claw roles. The tested schema
SHA-256 `93a38cf7dce3fa30ed0d6f89cebdf3e4cee0fd76eee3e168a63d3c562f26d0a3`
was applied once to `hmmfkbxhrfrfubqnizxd` as migration
**`20261031191243_business_claw_private_control_plane`**. Live readback confirms:

- All seven private tables have enabled and forced RLS.
- `bc_bff` and `bc_pool_login` are neither superuser nor RLS-bypass roles and
  do not inherit privileges. The login was created without a password binding.
- anon/authenticated/service_role have no private-schema, organization-table
  or encrypted-envelope access; BFF audit UPDATE/DELETE is denied.
- Auth users, organizations, application sessions and audit rows remain zero.
- Supabase's security advisor returns an empty lint list.

These private-role policies do not independently authenticate tenants; the
server policy owns current identity/membership admission. No production
fixture, fake Auth account or customer record was inserted.

## Deployed HTTP behavior and remaining limits

Local Node fetches failed to reach the deployment. Vercel's connected fetch
could not find/access it and public web fetch was unavailable. The supported
fallback was a second bounded public CI job with no credentials or dependency
installation. Its [three read-only requests](https://github.com/alvarovillalbaa/business-claw/actions/runs/41233380669)
at source `c93f1125bd6aba6dbd6a9c89b71083dc4d817423` passed:

- `/`:200 HTML,20,391 bytes, with server and local-import markup.
- `/api/v1/auth/session`:503,41 bytes, exact `backend_unconfigured` JSON.
- `/api/v1/orgs`:503,41 bytes, the same fixed JSON.

Both API responses require private/no-store caching. This is anonymous HTTP
serving/fail-closed evidence, not browser interaction or live authentication.
Only temporary CI/probe files changed after260541c; all product modules remain
byte-identical. The temporary workflows and one-off HTTP probe are removed
after their successful runs; their exact code remains in Git history.

Vercel production environment access, the copied pooler endpoint/role secret,
Auth callback configuration and real SMTP delivery remain unresolved. The
owner was asked for the non-secret pooler hostname and a connection access
update while these checks continued. No environment value or credential was
created to work around the403. See [the concrete configuration handoff](../../../backend-configuration.md).
Actual login/logout/recovery, two real organization flows and the new dashboard's
desktop/mobile browser behavior remain unverified. The previous browser scope
is still one partial/three unrun because of its plugin-worker version failure.
Gateway/chat/Notion/memory/self-building runtime activation and the complete
managed service/portfolio objective remain unfinished.
