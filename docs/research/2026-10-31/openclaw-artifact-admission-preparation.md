# Artifact admission preparation

31 October 2026. This is new evidence/status; the earlier sealed artifact
inventory and publication receipts are not rewritten or promoted to trust.

Fresh official GitHub API and release-page reads still identify
[`v2026.10.9`](https://github.com/openclaw/openclaw/releases/tag/v2026.10.9),
published 29 October 15:54:35Z, source 8b18b5578f66eab1501cba4cef2310d88bfb9a41,
draft/prerelease false and release-object immutable false. Exact release-source
[protocol version](https://github.com/openclaw/openclaw/blob/8b18b5578f66eab1501cba4cef2310d88bfb9a41/packages/gateway-protocol/src/version.ts)
is 4 for general clients, with 3 only as node/probe minimum; returned blob
`ce4b146c50b11aea62917e936c659efd8406d0cf`. The separately inspected Docker
[attestation helper](https://github.com/openclaw/openclaw/blob/8b18b5578f66eab1501cba4cef2310d88bfb9a41/scripts/verify-docker-attestations.mjs)
still checks descriptor/predicate presence, not signature or authenticated publisher.

One anonymous HTTPS manifest GET for GHCR tag 2026.10.9 failed local DNS
(`curl` exit 6) before any registry response. No layer, token, image or account
credential was retrieved. A wrong guessed protocol source path returned 404;
the actual directory listing led to the immutable version owner above.

The [inactive public probe](openclaw-registry-probe.mjs.example) is prepared for
root's bounded temporary CI: `node --input-type=module < PATH`. It uses only
native Node, fixed official public-pull scope, HTTPS/redirect allowlists,
ten-second fetch deadlines, 20 requests and 8 MiB total metadata caps. It fetches
only index/image/config/attached-attestation metadata, not filesystem or predicate
layers; it never prints the anonymous bearer or reads environment credentials.
Its compact JSON recomputes digests and reports attestation presence with
signature/provenance/schema/runtime/admission explicitly false. No probe CI was
activated by this task; a successful probe would still not establish signer trust.

The [admission contract](../../artifact-admission-contract.md) requires a separately
trusted verification port and reviewed exact digest/schema/protocol policy.
No production verifier, acceptable publisher identity or capability proof is
invented. Compute's provider OS-image ID is a different identity and cannot
inherit OCI approval. All runtime/activation/customer readiness remains disabled.

## Focused authored verification

Independent static review found no remaining contract mismatch before execution.
Under the owner's authorized focused checks, existing Node26.8.2 ran only
`tests/unit/artifact-admission.test.mjs` with explicit TAP and concurrency1.
**21/21 passed on the first run**, plan `1..21`, child exit0, zero failures,
skips/cancellations/TODOs. This includes the intentional five-second timeout race;
the whole child stayed inside its 30-second deadline and three-second TERM/KILL
grace. Child environment was only `TZ=UTC`; output caps were 256KiB/64KiB.
No deadline/signal/output-cap stop occurred. Stdout was4,760 bytes, stderr0;
stdout SHA-256 `f81fbede7223d0999a3b38837b746ab9d97fce764cbdc092d59b0245b7cc0662`.
Raw TAP was observed in bounded tool output, not retained as a raw artifact.

Selected input byte hashes matched before/after:

- Module: `3d8a523af08a896e91a724b617a54e841acb50dccfbe41886fcdfe3734ca41b7`.
- Case file: `b18de02ee6d268f4a9bb20dc52381e40bf1e455d28b4523c6d336470402521e2`.

All positive proofs used explicitly authored trusted test ports. No public probe,
actual signer, artifact, network, provider, install, runtime, database or paid
resource was exercised by those cases. These are boundary checks, not OCI or
serving qualification. No temporary file fixture or process remains.
