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
cases are prepared for a disposable PG17 service; their outcome remains pending
until that exact source runs in CI.

Current primary guidance inspected: [connection modes and copied pooler host](https://supabase.com/docs/guides/database/connecting-to-postgres),
[project pausing](https://supabase.com/docs/guides/platform/free-project-pausing),
[node-postgres transactions](https://node-postgres.com/features/transactions),
[TLS configuration](https://node-postgres.com/features/ssl). The changelog Markdown
fetch was unsupported; its official HTML index was inspected instead. These
sources explain platform behavior, while resource status above comes from the
connected account readbacks.
