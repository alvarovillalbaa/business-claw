# Runtime candidate and receipt contract preparation

31 October 2026. Local work, not GitHub publication or a live Gateway release.
Existing tracked source remains pinned at
`1b5dcc8b155012b1c9d1abaa327bfe5ecaeac477`; its 21 sealed inputs are unchanged.
Pending preview-check and backend-policy approvals remain separate and open.

## Artifact evidence that changes the next binding

The candidate release `v2026.10.9` resolves to
`8b18b5578f66eab1501cba4cef2310d88bfb9a41`, rather than mutable `main` or the
architecture's older inspected commit. The annotated tag is verified by GitHub;
the release object itself reports `immutable:false`. See the
[runtime contract research](../../../research/2026-10-31/openclaw-runtime-contract.md)
and [provenance review](../../../research/2026-10-31/openclaw-artifact-provenance.md).

Root read existing upstream [Docker preparation run 40863629117](https://github.com/openclaw/openclaw/actions/runs/40863629117)
and [publication job 123562749746](https://github.com/openclaw/openclaw/actions/runs/40896462808/job/123562749746),
including source/tooling checkouts, successful jobs and producer binding. No job
was dispatched, rerun or changed. Build/source tooling is `8b18b557…`; actual
publisher tooling is `ee860ffb…`. The publisher consumes producer attempt1 and
prepared manifest SHA256
`6ad45ed08cdc3654b8a54da4683e97118b1ffe5b9e0d2efe4b3c8040c951bae5`.

The [small evidence inventory](../../../research/2026-10-31/openclaw-artifact-evidence.json)
keeps the prepared amd64 index, image manifest, config and attestation digests
separate from the publisher-reported combined default/slim and browser indexes.
The default/slim combined receipt is
`sha256:1a2a3ce113e435039dbeac5ae261759bb4759908563d91c81059e896b38c5d98`.
Masked repository names in logs are interpreted using the actual immutable
publisher source's ordering, registry and empty-suffix mapping. This is upstream
publication evidence, not a fresh GHCR byte/tag read or cryptographic signer proof.

Direct release-asset reading failed local DNS. The connected GitHub file fetch
does not support that release download path; web access returned a cache miss.
The tiny1799-byte prepared-manifest artifact download returned a host file
reference, but no ZIP/manifest contents were read or independently hashed.
No image/layer archive, build environment or large checkout was downloaded;
raw upstream logs stay out of the repository.

## Required implementation consequences

- The exact release uses Node24.22.1/Bookworm, rather than current mutable docs'
  Trixie description. Source pins are not final-image inspection.
- Entrypoint startup runs repair against retained state; a replacement image
  requires pre-activation backup and restore qualification.
- Upstream Compose publishes listeners and does not supply runtime CPU/RAM caps;
  it cannot be installed unchanged under the private-ingress design.
- Gateway containerization does not supply the required agent sandbox/backend.
  The default release does not qualify host-socket, egress or workspace isolation.
- Config raw CAS, resolved revision and applied revision tokens have different
  meanings. A write acknowledgment, restart receipt or no-op does not establish
  application or assistant readiness. The new pure observation source preserves
  these distinctions without authorizing or sending any operation.

These findings refine the real deployment path; they do not activate Auth,
SQL, DNS, a dependency, a sandbox, a cloud resource, a connector or model call.
Registry closure, trusted signer admission, schema/plugin preflight, actual
serving identity, backup/restore and two-org isolation remain unverified.

## Original pure data source

Added [runtime/config-observation.mjs](../../../../runtime/config-observation.mjs)
with the [exact DTO contract](../../../runtime-config-contract.md). It has no
imports or side effects. Strict bounded records bind organization, instance,
generation, installation and release; revision-token domains remain separate.
Reconciliation retains the original receipt outcome and distinguishes present
application from application attributable to the acknowledged write. No-op,
missing/mismatched tokens, foreign bindings and older observations cannot be
promoted to successful write application. All results keep readiness unproven.

The [18 new authored cases](../../../../tests/runtime-config.test.mjs) are
**UNRUN**, and their execution approval has not been requested. They are outside
the existing pending14-domain/four-browser question. No existing execution
approval is extended to them. Fixtures are authored in memory only.

| Frozen new source | SHA-256 |
| --- | --- |
| `runtime/config-observation.mjs` | `af12dbd3b785803fdf009f0d19496589d1e042009ddece7ab34c2210c21bf432` |
| `tests/runtime-config.test.mjs` | `6ca615affb30a2981118ca8e97ef74e6d8dac8b83c9a4344afcb236f70875c01` |
| `docs/runtime-config-contract.md` | `2e84abeca69cbff969ff52aaf45beb486d78c4849cdacafff48386900e276d23` |
| `docs/research/2026-10-31/openclaw-artifact-evidence.json` | `2b4229e85cd179fdd84bf6960aee819df9527fec2b7edc6bd0726e8a5b59b00e` |

Root and an independent agent reviewed the module without execution; no concrete
defect was found. Existing Node `--check` passed both new JS files. Static reads
resolved all five named imports and counted18 unique flat literal cases with no
test selectors. JSON, UTF-8, whitespace and local references passed; all21 sealed
input hashes and the three previously frozen proposal hashes remain unchanged.
`git diff --check` passed and tracked/index diffs are empty at exact local HEAD1b.
No product import, authored test, browser, build, database, live runtime or model
execution occurred. The seven new files in this slice remain untracked and
unpublished, alongside the four earlier local activation documents.

This source interprets data; it does not authenticate its origin, validate a full
Gateway wire/config payload, provide wall-clock freshness, bind a live transport,
or complete the managed service. The active portfolio objective is unfinished.
