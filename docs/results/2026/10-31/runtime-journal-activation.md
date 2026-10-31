# Runtime journal database activation

Last updated: 2026-10-31

The tested additive journal was applied once to dedicated free Business Claw
`hmmfkbxhrfrfubqnizxd` in Clous / Frankfurt. The project remains ACTIVE_HEALTHY.
Migration **`20261031201223_business_claw_runtime_operation_journal`** matches
[db/runtime-ledger.sql](../../../../db/runtime-ledger.sql), SHA-256
`252b6633913533f43f0c69348d0f99f9e9a9ccfdc5cbbd4186ac81797e8fbf90`, from source
`81f16570e6cd6c9abe3c04e11fb4a1e138bba75b`.

Only after [run41237699243](https://github.com/alvarovillalbaa/business-claw/actions/runs/41237699243)
passed all51 new checks, a fresh live preflight found no runtime tables/roles,
Auth users, organizations, sessions or audit rows. The migration created two
private tables with forced RLS and the separate worker/login roles. No password
was assigned and no worker was bound. No customer or paid resource was created.

Actual catalog readback confirms operation SELECT/INSERT/UPDATE and event
SELECT/INSERT for the worker, with event mutation and operation DELETE denied.
The worker cannot access Auth envelopes, sessions or ordinary organization
records. The BFF, pool login, anon, authenticated and service_role identities
have no journal table access. The runtime login is NOINHERIT and needs explicit
SET ROLE; neither role is superuser, BYPASSRLS, CREATEDB or CREATEROLE. These
policies identify a trusted platform worker, not a tenant authorization service.

Auth users, organizations, sessions, audit, runtime operations and events all
remain zero. The security advisor returned an empty lint list. The
[JSON receipt](runtime-journal-activation.json) retains the actual preflight,
migration history, grants, policies, role metadata and row counts. These checks
read catalog metadata/counts, not customer content.

This is DDL/catalog proof. Production environment writes are still forbidden
by the connected Vercel permissions; its actual pooler hostname is unverified.
No authorizer, provider token, paid allocation, worker queue, Gateway readiness
or actual two-customer acceptance is implied. The BFF keeps runtime unavailable.
The [configuration handoff](../../../backend-configuration.md) remains open.
