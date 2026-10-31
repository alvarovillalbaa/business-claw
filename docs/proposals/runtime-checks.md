# Focused runtime configuration data checks

31 October 2026. **18 authored cases, all UNRUN.** Supplied AGENTS.md section 7
requires explicit approval for this new test scope. The existing 14 domain
cases and four browser scenarios remain a separate proposal at their original
source; approving or running those checks does not approve these 18 cases.

The exact collection is [`tests/runtime-config.test.mjs`](../../tests/runtime-config.test.mjs).
It uses authored in-memory fixtures and the pure
[`runtime/config-observation.mjs`](../../runtime/config-observation.mjs) contract:

- Raw CAS versus source/applied token domains; absent-file raw null, missing
  versus unequal application tokens and snapshot validity.
- Exact organization, instance, generation, installation and release bindings;
  observation ordering and loss of operation attribution after a raw revision change.
- Set persistence-only, apply/patch hot/restart/unknown receipts, committed-unapplied
  recovery observation, no-op non-recovery and non-noop empty changed paths.
- Rejection/publication failure and unsupported lost-acknowledgment outcomes;
  hostile own/inherited/accessor/protected properties, sparse or decorated arrays,
  malformed identities/times/text, explicit bounds and detached immutable output.

After publication and explicit approval of its exact immutable source commit,
the proposed execution uses the existing local Node installation:

```sh
node scripts/run-runtime-checks.mjs <exact-approved-source-commit>
```

The dedicated controller invokes only:

```sh
node --test --test-concurrency=1 --test-reporter=tap --test-timeout=10000 tests/runtime-config.test.mjs
```

The new [runtime source seal](../results/2026/10-31/runtime-source.json) will be
authored after all inputs freeze and published with them. It retains the original
`business-claw.source.v1` shape: repository, all tracked non-results
`files[{path,mode,gitSha}]`, matching complete `selectedByteHashes[{path,bytes,sha256}]`
and only this test file's 18 exact unique names under `testFiles`.
The controller verifies its seal bytes against the approved commit, then the
approved HEAD tree, index path/mode/blob set and every regular file's actual
mode and bytes before and after execution. A missing seal, source change,
symlink, unmerged index or unexpected input prevents success. Results documents
are outside the sealed source path set; the seal itself must still match the commit.

The whole detached test process group has a 30-second deadline; timeout or an
output/stream error sends TERM, then KILL after a three-second grace. Child stdout
is capped at 256 KiB and stderr at 64 KiB. Its entire environment is `TZ=UTC`:
no inherited credentials, Node options or coverage settings. No temporary files,
filesystem fixtures, installation, dependencies, CI, server, browser, network,
account, Auth/DB/SQL, Gateway, provider/model call or paid service is involved.
The controller writes no files; it records bounded TAP names/totals/failure details
and actual process exit/signal/timeout/output counts to its console.
Parent SIGINT/TERM/HUP interruption follows that same termination/grace path,
waits for the child to close, records failure and retains the final source guard.

Success requires actual exit zero, the exact 18 expected names and passing case
numbers, one `1..18` plan, 18 tests/18 passes and zero suites/failures/cancellations/
skips/TODOs, plus both source guards. Source syntax/static checks alone do not
execute this controller or establish that the tests pass.

These are data-interpretation checks only. They cannot establish authenticated
target selection, fresh real observations, a wire adapter/schema validation,
provider readiness, organization isolation, hosting, browser behavior or full
managed-service delivery. This proposal does not alter the old controller/seal,
activate any adapter or confer live execution authority.
