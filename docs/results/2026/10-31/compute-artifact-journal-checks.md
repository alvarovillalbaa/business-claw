# Compute, artifact and durable-journal checks

31 October 2026. **51/51 passed** in [CI run 41237699243](https://github.com/alvarovillalbaa/business-claw/actions/runs/41237699243), attempt 1, at immutable [source 81f1657](https://github.com/alvarovillalbaa/business-claw/commit/81f16570e6cd6c9abe3c04e11fb4a1e138bba75b) / tree `b9939ef94381b534a3784bc0afca71f31b79cbcf`.
Both `runtime` and `registry-metadata` jobs completed successfully. This receipt was independently checked against downloaded job logs and exact source case names; [machine receipt](compute-artifact-journal-checks.json) retains all identities, source/log hashes and the registry JSON.

| Scope | Cases | Evidence |
| --- | ---: | --- |
| Real PostgreSQL journal | 14 | Atomic reserve/CAS/history, contention, rollback, lost real COMMIT acknowledgements, grants and restarted recovery. |
| Injected compute transport | 16 | Exact ownership, no duplicate create, asynchronous observations, timeout/abort race, power/delete and redacted failures. |
| Injected artifact verifier | 21 | Metadata linkage, subject/policy/time/capability fences and finite verifier failure; synthetic proof never enables execution. |

The runtime job used Node **v26.13.0**, Ubuntu 24.04.5 and a fresh **PostgreSQL 17.11** service. TAP reports 51 tests, zero suites, 51 pass, zero fail/cancel/skip/todo, duration **5,784.988764 ms**. Every one of the 51 unique subtest names and numbered `ok` lines matches the immutable test sources. Static validation reported **15 modules, 23 relative imports, 6 builtin imports, 1 dependency import and 130 unique HTML IDs**. Container stop/removal, network removal and orphan-process cleanup completed successfully.

The PostgreSQL cases use actual transactions and worker-role connections. A real trigger rejects event insertion and proves rollback of both reservation/current receipt and history. Another wrapper executes real COMMIT and then loses its acknowledgement: subsequent clients recover the committed reservation/revision without another event or allocation. The restart case combines the real journal with a fake cloud response loss and records one POST only. Forced-RLS/least-grant cases deny BFF/browser access, event mutation and worker access to Auth envelopes, sessions or ordinary organization writes. These are disposable-fixture results, not live tenant-isolation proof.

The [registry job](https://github.com/alvarovillalbaa/business-claw/actions/runs/41237699243/job/124644842834) made **7 anonymous pull-only requests**, reading **39,452 bytes** at `2026-10-31T20:11:16.118Z`. It linked tag `2026.10.9` / source `8b18b5578f66eab1501cba4cef2310d88bfb9a41` to this Linux/amd64 metadata:

| Metadata | SHA-256 digest | Bytes |
| --- | --- | ---: |
| Index | `1a2a3ce113e435039dbeac5ae261759bb4759908563d91c81059e896b38c5d98` | 1,611 |
| Manifest | `deab8686a863c1d2255a43bb4677f4907b9af45aff340c062834d16756fd4ff8` | 8,067 |
| Config | `45c1d4b884bb02fc6592faeff85a267e3585b7ce455110f6982d8ee14c00c352` | 28,592 |

Platform, OCI source/version labels and non-root `node` matched. An attestation descriptor exposed SLSA provenance/SPDX predicate types; their presence is **not authenticated publisher provenance**. Registry output keeps `signatureVerified`, `publisherProvenanceVerified`, `schemaProtocolQualified`, `layersDownloaded`, `runtimeExecuted` and `artifactAdmitted` **false**. Exact registry JSON and its line hash are retained in the machine receipt; no bearer token or image layers are retained.

The separate [journal activation receipt](runtime-journal-activation.md) records root's subsequent live migration/catalog checks on the dedicated free project, migration `20261031201223_business_claw_runtime_operation_journal`; its [JSON](runtime-journal-activation.json) owns those details. Catalog acceptance is separate from these disposable CI cases and does not bind a worker or application database connection.

An independent Vercel metadata read confirms deployment `dpl_2WsdvhS7oTyR2UXgUXKoPM6paFi8` is **READY**, target **production**, at this exact source SHA with the canonical [business-claw-alvaro.vercel.app](https://business-claw-alvaro.vercel.app) alias. This is source deployment metadata; no HTTP/browser or actual runtime acceptance was performed by this check.

No production database, customer record, live compute-provider mutation, paid resource, model, Notion or running Gateway was exercised by these CI jobs. This receipt does not apply SQL, bind an authorizer/worker credential, approve spending or establish hosting, private ingress, config application, backup/restore, sandbox, real organization isolation or full managed-service completion.
