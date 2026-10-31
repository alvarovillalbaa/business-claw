# Auth and HTTP focused checks

31 October 2026. The owner's “Keep going. Do all the work” and root's explicit
bounded execution instruction authorized these native Node fake-port cases.
The [HTTP contract](../../../backend-http-contract.md) owns routes and limits;
the [machine receipt](auth-http-checks.json) retains the 26 names, both actual
outcomes and selected source-byte fingerprints.

The first run passed **25/26**, exit 1. A missing verified provider `session_id`
was denied, but the shared UUID validator classified it as 400 input instead
of 401 identity failure. The product source now normalizes malformed verified
provider DTO/claims to `provider_identity_invalid`; the assertion was preserved.
No failed outcome was hidden or changed into a pass.

The justified second run passed **26/26**, TAP `1..26`, child exit 0, zero
failures/cancellations/skips/TODOs. Existing Node **26.8.2** executed only
`tests/auth-http.test.mjs` with one test worker and explicit TAP. Stdout was
5,648 bytes, SHA-256
`f14c66b0188c1dc920909110a3966e5d0c5d01fbb9ade5bd9340a34ddf0b669d`;
stderr was empty. The raw TAP was observed in bounded tool output rather than
retained as another artifact. The first run's stdout was 4,097 bytes/stderr 0.

Both runs used a task-owned detached process group, 30-second deadline,
three-second TERM/KILL escalation, 256 KiB/64 KiB stdout/stderr caps and only
`TZ=UTC` in the child environment. Neither reached a deadline, signal or output
cap. Nine selected module/test inputs were byte-identical before/after each
run. Child processes completed; no file fixture or temporary worktree existed.

These checks cover online-verification-shaped identity binding, opaque cookies,
CSRF, encrypted private tokens, refresh/absolute expiry, recovery, finite errors,
mail gates, path/CAS DTO routing, both Vercel rewrite shapes and disabled runtime.
Provider responses and serialized session storage were authored injected ports.
No real Auth/SQL/email/browser/provider/model call, dependency installation or
live environment binding occurred. Actual PostgreSQL locking, hosted routing,
delivery, revocation limits and full-service acceptance remain separate proof.
