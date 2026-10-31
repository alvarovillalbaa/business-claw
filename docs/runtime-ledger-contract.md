# Durable runtime operation journal

Last updated: 2026-10-31

`server/runtime-ledger.mjs` implements the compute adapter's three journal
ports over one injected PostgreSQL pool. It imports no driver, reads no
environment and has no provider transport. The shared descriptor and receipt
normalizers belong to `runtime/compute-provider.mjs`.

`reserve(descriptor)` commits a first-ever reservation and its immutable event
before returning `acquired:true`. A competing or repeated identical request
returns `acquired:false` and the existing receipt; operation/request/binding/
fence/hash substitution is rejected. Request IDs are unique across operation
IDs too. A newer worker fence cannot silently re-arm an uncertain create.

`read(operationId)` returns a normalized current receipt or null.
`commit({expectedRevision,receipt})` locks the current row, checks the exact
revision/fence/identity, and atomically updates it with an appended immutable
event. Established server and action IDs cannot be erased or replaced. Receipt
times cannot move backward. Stale CAS returns false; no call is automatically
retried. Transaction-local role/search path/UTC and bounded lock/query timeouts
are used. Every transaction has one acquired client and releases it on failure.

A lost reservation/COMMIT acknowledgment remains uncertain. The reservation
may already exist, so the next execution must reconcile by GET, never dispatch
another allocation. A recorded reservation can also precede a process crash
before HTTP dispatch; this conservative case needs explicit recovery rather
than guessing that a provider resource cannot exist.

The additive `db/runtime-ledger.sql` owns current receipts and append-only
receipt revisions. Both private tables have forced RLS. A separate
`bc_runtime_login`/`bc_runtime_worker` pair has no password in source and no
grants on customer Auth tokens, memberships or ordinary workspace writes.
The BFF/browser roles receive no journal access. These RLS policies identify
the trusted worker role, not individual tenants. The trusted admission service
must establish current customer/platform authority, exact resource manifest,
qualified runtime artifact and paid quote/approval before any provider call.

No authorizer, worker identity, role password, provider account/token, paid
manifest or automatic queue binding is supplied here. A browser-local or server
confirmation record alone cannot dispatch. The existing API keeps runtime/chat
unavailable. Real provider acceptance, backup/restore, private ingress and
running Gateway readiness remain separate requirements.

The [check receipt](results/2026/10-31/compute-artifact-journal-checks.md) records
the focused authored/disposable checks. The separate
[database activation receipt](results/2026/10-31/runtime-journal-activation.md)
records the applied additive SQL and actual role/RLS readback. Neither binds a
live worker or provider.
