# Approved domain checks — passed

31 October 2026. The owner's “I approve everything” approved the existing
14-case domain scope at immutable source `1b5dcc8b155012b1c9d1abaa327bfe5ecaeac477`.
The original controller and test bytes were kept unchanged; current main was
not substituted. This receipt concerns those 14 cases only.

Executed once using existing Node `v26.8.2` in a small, task-owned detached
worktree. Clean status, exact HEAD and the committed source seal were verified
before the run; the controller checked all 21 sealed source inputs before and
after execution. Its command was:

```sh
node scripts/run-approved-checks.mjs 1b5dcc8b155012b1c9d1abaa327bfe5ecaeac477
```

**Result: 14 tests, 14 passes; zero failures, cancellations, skips or TODOs.**
The exact 14 names, ordered passing case numbers and `1..14` plan passed the
controller's TAP checks. Test child, controller and bounded outer owner exited
zero; no signal, timeout or output cap occurred. The controller's post-source
guard passed. The test child produced 3,622 stdout bytes and zero stderr bytes.

[JSON evidence](domain-checks.json) retains actual bounded controller stdout
(1,663 bytes) and stderr (5,194 bytes), their SHA-256 digests, exact case names,
totals and exits. Controller stderr contains 49 identical nonfatal macOS Git
`confstr(DARWIN_USER_TEMP_DIR)` fallback-to-`/tmp` warnings under the stripped
controller environment; Git/source guards succeeded. No retry hid that output.
Raw child TAP was consumed and validated by the unchanged controller, not retained.

An outer process owner captured output and retained catchable-interruption
cleanup around the original controller's detached test group. No interruption
occurred. After postflight reads completed, a sequential open-file audit reported
no remaining process in the worktree. Clean exact source and seal were rechecked,
then only the owned worktree and its empty temporary parent were removed without
force. Removal and absence checks passed; the main checkout/index/HEAD remained
unchanged at `3b39c2b4cffc3a26787c729c9a675f3c0336289a`.

Only authored in-memory fixtures ran. No installation, build, database, server,
browser, live Auth, Gateway, provider/model or paid operation occurred. These
passes establish the selected domain/data-workflow behavior; browser/device,
real tenant isolation, hosted runtime and full managed-service acceptance remain
outside this evidence.
