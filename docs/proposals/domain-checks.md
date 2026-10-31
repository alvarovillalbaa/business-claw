# Focused domain checks

31 October 2026. **Authored and UNRUN.** Supplied AGENTS.md section 7 requires
explicit approval for this new project's domain checks. Clero's separate
72-case approval does not authorize this execution.

The exact collection is `tests/domain.test.mjs`: **14 unique native Node cases**
covering strict schema/JSON boundaries, immutable records, organization/instance
ownership, revisions/generations, reviewed proposals and terminal retries,
stale intent invalidation, credential-shaped text, unverified observations and
bounded history. Only authored in-memory data is used; no filesystem fixtures,
server, browser, live account, database, credentials or provider/model call.

Proposed execution uses the existing local Node installation, with no install,
CI or build. After source publication and explicit approval:

```sh
node scripts/run-approved-checks.mjs <exact-approved-source-commit>
```

The controller invokes only:

```sh
node --test --test-concurrency=1 --test-reporter=tap --test-timeout=10000 tests/domain.test.mjs
```

It checks every tracked non-results path/mode/blob and working byte against
the exact source and [seal](../results/2026/10-31/source.json), before and after
execution. A parent watchdog bounds the entire detached process group to
30 seconds, with TERM then KILL after a three-second grace; stdout is capped at
256 KiB and stderr at 64 KiB. The test child receives only `TZ=UTC`, without
inherited provider credentials or Node options. No temporary files are created.
Success requires actual exit zero, all14 exact names/plan/totals and no failure,
cancellation, skip or TODO. Source/failure guards remain mandatory.

These are domain/data-workflow checks. They cannot prove browser/device storage,
authentication, real organization isolation, live Gateway/schema/provider/MCP
behavior, hosting, readiness or complete managed-service delivery. Browser and
live-service acceptance remain outside this proposal.
