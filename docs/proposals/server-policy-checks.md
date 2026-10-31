# Focused server policy checks

31 October 2026. The owner's “I approve everything” covers the focused local
verification necessary for the same approved backend-policy source. No new
permission cycle is requested for these authored, fake-port checks. This packet
does not authorize external bindings, paid resources or live acceptance.

The controller selects **only** `tests/server-policy.test.mjs`. Its exact literal
case names/count will be sealed once the authored file and source freeze; no case
is executed by preparing this packet. The source seal must contain one test file,
1–128 unique nonempty single-line names, each at most 512 UTF-16 units/1,024 UTF-8
bytes. These are controller bounds, not an invented final case count.

## Scope

Authored in-memory fake identity, transaction, clock and randomness ports cover:

- Owner/Administrator/Member/Viewer admission and capabilities, current sessions
  and memberships, foreign target denial and missing-port fail-closed behavior.
- Bootstrap and exact replay; recipient-bound invitations, issuer rechecks,
  acceptance/revocation, owner transfer and last-Owner protection.
- Lifecycle request/review/confirmation/cancellation, current actor/target binding,
  fresh-auth policy, stale/conflicting revisions and safe idempotent replay.
- Transaction compare-and-swap, immutable audit/domain changes and rollback/failure
  behavior without granting dispatch or chat authority.

No Supabase account/API, database, SQL, real Auth session, email, broker, Gateway,
network, provider/model call, installation, CI, server, browser or paid action is
part of this scope. Fixtures contain no real credentials or customer data.

## Exact execution and source identity

After the source and seal are committed at their final immutable identity, use
the existing local Node installation:

```sh
node scripts/run-policy-checks.mjs <exact-sealed-source-commit>
```

The sole child command is:

```sh
node --test --test-concurrency=1 --test-reporter=tap --test-timeout=10000 tests/server-policy.test.mjs
```

The [new policy seal](../results/2026/10-31/server-policy-source.json), authored by
the owning source task after freeze, retains `business-claw.source.v1` and
repository `alvarovillalbaa/business-claw`. It contains every tracked non-results
`files[{path,mode,gitSha}]`, the same complete path set under
`selectedByteHashes[{path,bytes,sha256}]`, and only the selected policy file's
literal case names under `testFiles`. Existing domain/runtime seals are separate.

Before and after execution, the controller requires exact approved-argument HEAD,
seal bytes identical to that commit, matching tree/index path/mode/blob sets, and
each regular source file's actual mode/content plus SHA-256/byte length. Symlinks,
unmerged index entries, missing/changed/extra sealed inputs or malformed case
inventories prevent success. Results are excluded from the source path set;
the policy seal itself must still match its committed bytes.

The detached child process group has a 30-second deadline, TERM then KILL after
three seconds, and caps of 256 KiB stdout/64 KiB stderr. Its environment contains
only `TZ=UTC`, with no inherited credentials, Node options or coverage settings.
SIGINT/TERM/HUP mark interruption as failure, use the same termination/grace path,
await child close and retain the final source guard. The controller removes only
its own signal handlers and writes no files.

Success requires actual exit zero; every exact sealed case and passing index
1..N; exactly one `1..N` plan; N tests/N passes and zero suites, failures,
cancellations, skips or TODOs; and both source guards. Bounded console records
retain actual exits/signals, interruption/deadline/output counts and failure
details. No silent retry or broader suite is selected.

## Proof limits

This verifies the approved policy's behavior against authored fake ports.
It does not prove Supabase token invalidation, DB/RLS transactions, actual email,
tenant isolation, live infrastructure, serving readiness or complete managed
service delivery. Source authoring and syntax checks do not execute tests.
Live identity/data/runtime bindings and their acceptance remain separately gated.
