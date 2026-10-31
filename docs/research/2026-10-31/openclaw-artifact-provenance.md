# OpenClaw 2026.10.9 OCI provenance requirements

31 October 2026. Source inspection only; no image pull/layers, registry request,
signature verification, installation, build, runtime or test execution by this task.
The parent task collects registry/CI evidence separately. This note does not
qualify an image for activation or change the [inactive hosting packet](../../proposals/runtime-activation.md).

## Source identity and evidence boundary

The official [release record](https://github.com/openclaw/openclaw/releases/tag/v2026.10.9)
identifies release SHA **`8b18b5578f66eab1501cba4cef2310d88bfb9a41`**, published
29 October 2026 at 15:54:35Z, draft/prerelease false. Its API `immutable` field
is false. A signed Git tag or GitHub-verified commit does not authenticate an OCI
manifest, its platform image or its attached provenance. Release-source links use
that full commit; the actual publisher tooling is separately pinned below. Neither
mutable `main` nor current rendered documentation supplies artifact identity.

The release body points to [publication run 40896462808](https://github.com/openclaw/openclaw/actions/runs/40896462808).
The actual run/attempt, producer tooling SHA, prepared manifest and published
digests still need to be linked by the separate artifact evidence owner. Reading
workflow source establishes intended checks, not that a particular run passed them.

## Publishing contract found in the release source

| Source evidence | Bounded finding |
| --- | --- |
| [Publication caller, lines 2226–2258](https://github.com/openclaw/openclaw/blob/8b18b5578f66eab1501cba4cef2310d88bfb9a41/.github/workflows/openclaw-release-publish.yml#L2226) | `publish_docker`, “Publish Docker images”, invokes the reusable Docker Release workflow with release tag/SHA and exact prepared producer run/attempt/artifact/manifest-hash tuple. |
| [Preparation workflow, lines 114–207](https://github.com/openclaw/openclaw/blob/8b18b5578f66eab1501cba4cef2310d88bfb9a41/.github/workflows/docker-release-prepare.yml#L114) | Native `linux/amd64` and `linux/arm64` builds; default and optional browser variants; `sbom: true`, `provenance: mode=max`, OCI output without registry push. Source checkout is `inputs.release_sha`; trusted tooling is separately checked out at `github.workflow_sha`. |
| [Labels/build arguments, lines 196–244](https://github.com/openclaw/openclaw/blob/8b18b5578f66eab1501cba4cef2310d88bfb9a41/.github/workflows/docker-release-prepare.yml#L196) | Revision/version/creation labels bind the intended source/version/time. Release arguments select `diagnostics-otel,codex`; browser variant additionally enables browser installation. These are claims to compare with actual image evidence, not authenticated proof by themselves. |
| [OCI validation, lines 157–245](https://github.com/openclaw/openclaw/blob/8b18b5578f66eab1501cba4cef2310d88bfb9a41/scripts/docker-release-artifacts.mjs#L157) | Preparation hashes the complete local OCI closure, checks descriptor sizes and platform, then requires source/version/time labels to match. It seals source and separate tooling/producer identities. |
| [Publication workflow, lines 374–439](https://github.com/openclaw/openclaw/blob/8b18b5578f66eab1501cba4cef2310d88bfb9a41/.github/workflows/docker-release.yml#L374) | Revalidates producer/payload identities, copies exact OCI bytes and verifies remote digest/descriptor preservation before alias promotion. Registry mutation is an upstream action, not an action taken here. |
| [Tag construction, lines 133–153 and 867–925](https://github.com/openclaw/openclaw/blob/8b18b5578f66eab1501cba4cef2310d88bfb9a41/scripts/docker-release-artifacts.mjs#L867) | The `v` is removed. Default target is **`ghcr.io/openclaw/openclaw:2026.10.9`**; architecture tags append `-amd64`/`-arm64`. `-slim` aliases the same default image/index in this implementation; `-browser` is separate. Optional rebuild suffix is `-rYYYYMMDD`. |

The source policy promotes stable `latest/main` aliases; those are unsuitable
activation pins. A version tag's documented immutability still needs a recorded
observed OCI index digest and selected Linux/amd64 manifest digest.

The parent task's inspected upstream publisher receipt identifies tooling SHA
`ee860ffb31039c05bacacd3387c05649c0ea7033`, distinct from release/build source.
This task independently read that tooling's [actual tag/order mapping](https://github.com/openclaw/openclaw/blob/ee860ffb31039c05bacacd3387c05649c0ea7033/scripts/docker-release-artifacts.mjs#L891):
default precedes browser; default and slim share the combined digest; GHCR precedes
Docker Hub ([registry arguments](https://github.com/openclaw/openclaw/blob/ee860ffb31039c05bacacd3387c05649c0ea7033/scripts/docker-release-artifacts.mjs#L1018)).
That permits the separate CI receipt to identify its default/browser outputs,
given its observed version/suffix. It remains an upstream publication receipt,
not this task's registry read or signer verification. No job logs were duplicated here.

## Attestation is present in the design; signer trust remains a separate proof

The [attestation verifier](https://github.com/openclaw/openclaw/blob/8b18b5578f66eab1501cba4cef2310d88bfb9a41/scripts/verify-docker-attestations.mjs)
requires each platform descriptor to have a Docker attestation descriptor whose
`vnd.docker.reference.digest` points to that image, and layers advertising both
`https://spdx.dev/Document` and `https://slsa.dev/provenance/v1` predicates.
It checks structural/predicate presence; it does not verify a cryptographic
signer, certificate identity, transparency-log inclusion or provenance contents.

No generic stable-image cosign/signing step was found in the inspected Docker
prepare/publish workflows and their direct verifier. The publisher's optional
`gh attestation verify` path validates a separate focused-beta evidence file;
it is not evidence that the stable OCI image was signed. This bounded inspection
does not establish that no signatures exist elsewhere.

Before activation, bind actual bytes to the intended source and authenticated
publisher: index/platform/config digests, attestation descriptor/predicate blob
digests and subject, claimed revision/materials/build parameters, producer
run/attempt/workflow SHA and prepared-manifest hash. Verify any available upstream
signature/attestation trust against an explicitly reviewed identity policy. If no
authenticated OCI signature exists, record that gap and require an explicit
artifact-admission decision; do not relabel unsigned BuildKit metadata as verified
publisher provenance. Upstream CI reports and labels alone cannot close that gap.

## Exact runtime and persistence expectations

| Pinned source | Expectation to compare with the eventual artifact/host |
| --- | --- |
| [Dockerfile, lines 10–28 and 231–249](https://github.com/openclaw/openclaw/blob/8b18b5578f66eab1501cba4cef2310d88bfb9a41/Dockerfile#L10) | Runtime base is `node:24.22.1-bookworm-slim`, **Debian Bookworm**, with base digest `sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205`. This differs from current live docs describing Trixie. Base/source pins alone do not freeze output: this Dockerfile also runs distro updates and `npm@latest` during image construction. |
| [Runtime user/launch, lines 418–466](https://github.com/openclaw/openclaw/blob/8b18b5578f66eab1501cba4cef2310d88bfb9a41/Dockerfile#L418) | `WORKDIR /app`, `USER node` (source documents UID 1000), production environment; `tini -s -- node /app/docker-entrypoint.mjs`, then default `node openclaw.mjs gateway`. Mounted directories need the actual runtime UID/GID and restrictive permissions. |
| [Entrypoint](https://github.com/openclaw/openclaw/blob/8b18b5578f66eab1501cba4cef2310d88bfb9a41/docker-entrypoint.mjs#L95) | Foreground Gateway activation runs `doctor --fix --non-interactive` before exec. Starting/recreating the image can repair retained state; it is not a read-only probe. Require pre-activation backup, compatible restore evidence and a fenced rollback generation. Do not use reset to avoid activation checks. |
| [Compose persistence](https://github.com/openclaw/openclaw/blob/8b18b5578f66eab1501cba4cef2310d88bfb9a41/docker-compose.yml#L15) | State/config `/home/node/.openclaw`, workspace `/home/node/.openclaw/workspace`, plus auth-profile secret mount `/home/node/.config/openclaw`. Preserve all required org-owned state/secret paths; qualify actual mounts on the proposed isolated filesystem. No shared customer home or host-path override. |
| [Compose exposure](https://github.com/openclaw/openclaw/blob/8b18b5578f66eab1501cba4cef2310d88bfb9a41/docker-compose.yml#L69) | Default uses `--bind lan` and publishes 18789, 18790 and 3978 without a host-IP constraint. It must not be installed unchanged under the private-ingress design. An approved overlay must restrict listeners/publishing and omit unused channels. |
| [Health probe](https://github.com/openclaw/openclaw/blob/8b18b5578f66eab1501cba4cef2310d88bfb9a41/src/docker-healthcheck.ts) | Default script reads active/configured port and checks loopback `/healthz`: liveness only. Dockerfile interval 3m/timeout 10s/start 15s/retries 3; Compose overrides 30s/5s/20s/5. Neither proves Auth, private ingress, applied configuration, model/connector health or product readiness. |
| [Build settings](https://github.com/openclaw/openclaw/blob/8b18b5578f66eab1501cba4cef2310d88bfb9a41/Dockerfile#L13), [package contract](https://github.com/openclaw/openclaw/blob/8b18b5578f66eab1501cba4cef2310d88bfb9a41/package.json) | Node engine is `>=24.22.1 <25 || >=26.12.1`. The 8192 MB heap option is a build argument, not runtime RAM sizing or a container cap. Compose declares no CPU/RAM limits. The prebuilt-image canary still needs explicitly approved resource limits and measured acceptance. |

## Sandbox prerequisite is not supplied by the Gateway tag alone

The pinned [mode/backend contract](https://github.com/openclaw/openclaw/blob/8b18b5578f66eab1501cba4cef2310d88bfb9a41/docs/gateway/sandboxing/modes-scope-and-backend.md)
defaults sandboxing to `off`; `non-main` excludes the main session. A required
creator-role sandbox is a separate policy. Business Claw's policy must fail closed
for every admitted untrusted tool session; default containerization is insufficient.

The default Gateway release build does not set `OPENCLAW_INSTALL_DOCKER_CLI`.
Docker sandbox setup needs an appropriate CLI/backend and separately provisioned
sandbox image. The [setup script](https://github.com/openclaw/openclaw/blob/8b18b5578f66eab1501cba4cef2310d88bfb9a41/scripts/sandbox-setup.sh)
builds local `openclaw-sandbox:bookworm-slim`; this is not a demonstrated published
OCI sandbox artifact. Its [Dockerfile](https://github.com/openclaw/openclaw/blob/8b18b5578f66eab1501cba4cef2310d88bfb9a41/scripts/docker/sandbox/Dockerfile)
pins Debian base `sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251`,
adds shell/Python/ripgrep utilities and runs as `sandbox`; it does not include Node.

[Sandbox image guidance](https://github.com/openclaw/openclaw/blob/8b18b5578f66eab1501cba4cef2310d88bfb9a41/docs/gateway/sandboxing/images-and-setup.md)
specifies default no-network/read-only-root/non-root behavior and fail-fast when
the required image is missing. Docker Compose's commented socket example is not
authority to expose the host daemon to customer tools. Backend/socket ownership,
workspace mounts, image digest, resource/egress restrictions and cross-org denial
need their own qualified design and execution. Keep tool execution, browser,
embeddings and heavy builds disabled until that boundary exists.

## Result and remaining evidence

Source establishes a plausible official dual-platform OCI publication path with
attached SBOM/provenance and exact-byte checks. It does **not** yet establish the
observed registry bytes, a trusted OCI signer, sandbox readiness or serving behavior.
The next artifact packet must supply those exact identities and qualification
limits before any install or activation approval. No dependency, cloud, Auth,
schema, CI or frozen application input was changed in this research task.
