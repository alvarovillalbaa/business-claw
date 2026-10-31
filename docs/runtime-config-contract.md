# Runtime configuration observations and receipts

31 October 2026. Original, pure source milestone; no transport or live adapter is connected.

[`runtime/config-observation.mjs`](../runtime/config-observation.mjs) interprets a small redacted adapter DTO using the [immutable upstream research](research/2026-10-31/openclaw-runtime-contract.md). It makes no requests, reads no files, starts no process and imports no SDK or product module. The source does not authenticate a sender or prove an observation happened. All outputs retain `ready: false` and `readiness: "unproven"`; they never update the portable workspace or authorize execution.

## Exact data boundary

All record fields listed below are required, including explicit nulls. Unknown, inherited, symbol, hidden and accessor properties are rejected without reading getters. Records may have the ordinary or null prototype. Strings reject control characters and malformed UTF-16. IDs are Business Claw-owned lowercase UUID-shaped identifiers, not inferred upstream identities; `releaseCommit` is a lowercase 40-hex immutable source identity. `generation` is an integer in 1..1,000,000. Times are real canonical UTC ISO strings with milliseconds. Errors contain fixed codes, not supplied values.

| Export / input | Fields and meaning |
| --- | --- |
| `normalizeRuntimeBinding(value)` | `{orgId, instanceId, generation, installationId, releaseCommit}`. Organization and instance IDs must differ. A release hash alone does not establish installation or qualified image identity. |
| `normalizeConfigObservation(value)` | `{binding, observedAt, valid, rawToken, sourceToken, appliedToken}`. `rawToken` maps to `config.get.hash`, `sourceToken` to `configRevisionHash`, and `appliedToken` to `appliedConfigHash`. Tokens are opaque string/null values; no digest prefix/length/alphabet or cross-domain equality is assumed. A valid snapshot must have a source token; an invalid snapshot must have null `sourceToken`. |
| `normalizeConfigReceipt(value)` | `{binding, operationId, receivedAt, method, outcome, rawToken, noop, restartRequired, changedPaths}`. `method` is `set`, `apply` or `patch`. `outcome` is `success`, `committed-unapplied`, `rejected` or `publication-failed`; this is an adapter classification, not an upstream union. |
| `reconcileConfigReceipt(receipt, observation)` | Takes the exact input DTOs above, requires every binding field to match and an observation at/after receipt time. Returns raw revision relation, receipt interpretation, current observation interpretation and attributable write application separately. It does not accept the normalizers' enriched outputs as input. |

Limits are explicit adapter limits, not claimed upstream maxima: token/path strings 1,024 UTF-16 units, at most 256 unique changed paths, normalized output at most 32 KiB UTF-8. The path array must be dense, have the ordinary array prototype, and contain only enumerable own data elements with no extra properties. Oversized data is rejected, never silently truncated. Null means missing/unavailable; empty or whitespace-only strings do not substitute for null. Outputs are deeply frozen detached records; inputs are never mutated or frozen.

## Interpretation and recovery

- An observation's `application` is `unavailable` if either source/applied token is null; otherwise equal source/applied tokens mean `applied` and a mismatch means `unapplied`. The raw CAS token never participates in that comparison. This is interpretation of supplied data, not runtime/provider readiness evidence.
- A non-noop successful write and an explicit `committed-unapplied` receipt establish reported persistence, even if its token is unavailable. Rejected writes and publication/rollback failures establish no persistence in this DTO. They do not claim the file is unchanged or recovery succeeded.
- A successful `set` reports `persistence-only`. A successful non-noop `apply`/`patch` reports `restart-required` if that flag is true, `reported-applied` if false, and `unproven` if unavailable. The flag maps from the inspected response's `sentinel.payload.stats.requiresRestart`; absence stays null. Restart scheduling/sentinel presence alone cannot establish a new serving process.
- `committed-unapplied` maps from a committed persistence receipt in an upstream application error, not every `UNAVAILABLE` or generic network error. Its `rawToken` may be null. A publication/rollback error with no such receipt is classified separately as `publication-failed`; the DTO does not invent a persisted token.
- Only successful patches carry a changed-path array. `noop:true` requires an empty array, null raw token and null restart flag, matching the inspected no-op response. An empty changed-path array without `noop:true` is allowed: explicitly persisting a value equal to an effective default can change authored source while effective paths remain empty. Do not infer no-op from array length.
- A no-op never establishes a new persistence/application attempt or that earlier activation was repaired. A rejected/failed/no-op receipt cannot use a later snapshot to claim the operation applied.
- Reconciliation attributes `writeApplication` only when a confirmed receipt's raw token matches the observation's raw token on the exact target. Missing tokens yield `rawRevision:"unavailable"`; unequal tokens yield `"changed"` and do not identify the later writer or prove semantic change. Even when source/applied tokens match, a changed/unavailable raw revision leaves this write's application unavailable. The independent `observedApplication` remains visible.
- A matching later read can observe application after a persistence-only or committed-unapplied receipt, but the earlier receipt interpretation remains intact. New transport/session/secret/model/provider/Notion/backup/isolation evidence and serving-artifact identity remain outside this contract.

This slice has no raw-config/credential field, endpoint, scheduler, retry loop, command dispatch, Auth/policy grant, schema-validation claim, deployment or provider call. The expected target must eventually come from a separately approved authenticated server registry. A caller can author a syntactically valid DTO; target equality and timestamps do not authenticate it, prevent replay or prove current wall-clock freshness.

## Verification status

`tests/runtime-config.test.mjs` contains **18 authored Node-native fixture checks**, all **UNRUN** pending their own explicit approval. Source syntax, static import references, literal test-name count and whitespace can be inspected without importing or executing the module. Existing domain/browser approvals and upstream test files do not imply execution approval for this new scope.
