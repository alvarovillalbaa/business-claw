# Runtime artifact admission

31 October 2026. `runtime/artifact-admission.mjs` owns this dependency-free
metadata and trusted-verifier boundary. It does not install/run an image or
authorize hosting, cost, configuration, chat or provider execution.

## API and authority

Exports: `ArtifactAdmissionError`, `artifactCapabilities`,
`normalizeArtifactPolicy(value)`, `inspectArtifactCandidate(policy,value)`, and
`createArtifactAdmission({verifier,clock}={})`. The latter returns
`{admit(policy,candidate)}`; clock supplies `now(): ISO UTC milliseconds`.
The trusted verifier supplies async `verify(request,{signal})`. No verifier or
reviewed policy is shipped/bound. A browser/imported record cannot select either.
Errors have a fixed `code`, never external error text. Unknown evidence fails closed.

Policy is an exact record `{schemaVersion:'business-claw.artifact-policy.v1',
repository:'ghcr.io/openclaw/openclaw',release,sourceCommit,platform:'linux/amd64',
indexDigest,manifestDigest,configDigest,schemaDigest,protocolDigest,protocolVersion,
requiredCapabilities,publisherIdentity,publisherIssuer,maxProofAgeSeconds}`.
Release is an exact `vYYYY.M.D` tag, sourceCommit lowercase 40 hex, all digests
`sha256:` plus 64 hex. Publisher identity/issuer are explicitly reviewed strings;
there is no invented default acceptable signer. Proof age is 1–86400 seconds.
The supported capability vocabulary is exactly the six inspected config methods:
`config.get`, `config.schema`, `config.schema.lookup`, `config.set`,
`config.apply`, `config.patch`. Required capabilities are nonempty/unique.

Candidate is exactly `{schemaVersion:'business-claw.artifact-candidate.v1',
index,manifest,config,schema,protocol,evidence}`. Each metadata field is canonical
base64url of the original UTF-8 bytes. `evidence` is 1–16 canonical base64url blobs
passed unchanged to the trusted verifier; its presence is not signature proof.
Byte limits: index/manifest 256 KiB each, config 128 KiB, schema 2 MiB, protocol 64 KiB,
each evidence blob 256 KiB, total 5 MiB. JSON depth/node counts are bounded.

The helper recomputes all five metadata digests. The index must contain exactly
one Linux/amd64 image descriptor bound to the supplied manifest bytes/size/type;
the manifest must bind the config bytes/size/type and finite layer descriptors.
Config platform must agree. Labels must identify the exact source/release;
the source URL, when present, must be official. Runtime user must be `node`. No layers are downloaded.
This is metadata linkage, not an assertion that image files were inspected.

`schema` must be JSON object data. `protocol` is our explicit extracted-contract
record `{schemaVersion:'business-claw.gateway-protocol.v1',release,sourceCommit,
protocolVersion,schemaDigest,capabilities}`; it is not claimed to be an upstream
native response. Its exact bytes must be independently qualified against this
artifact/plugin installation. A generated schema snapshot alone does not replace
upstream semantic/plugin validation. Missing/unknown required capabilities reject.

## Trusted proof and result

The verifier receives detached/frozen `{policy,policyHash,artifact,artifactHash,
metadata,evidence}`. Hashes are SHA-256 of canonical JSON; metadata/evidence retain
the exact base64url bytes. It must independently authenticate signature/certificate/
publisher identity, source provenance and digest subjects under the configured
trust policy, and qualify actual artifact schema/protocol/capabilities. It must
not translate unsigned BuildKit predicate presence or GitHub workflow success
into authenticated provenance. No such real verifier is implemented here.

Its exact proof is `{schemaVersion:'business-claw.artifact-proof.v1',policyHash,
artifactHash,publisherIdentity,publisherIssuer,signatureStatus,provenanceStatus,
compatibilityStatus,capabilities,evidenceDigest,verifiedAt,expiresAt}`. Each status
must explicitly be `verified`; `unknown`/`rejected` never admit. Hashes, publisher,
capabilities and bounded current timestamps must match; evidenceDigest is a
`sha256:` digest of the verifier's retained verification receipt. Verifier calls
have a five-second abort deadline; thrown errors and late results cannot admit.

The frozen result is `{schemaVersion:'business-claw.artifact-admission.v1',
admitted,reason,policyHash,artifactHash,artifact,verifiedAt,expiresAt,evidenceDigest,
activationAllowed:false,dispatchAllowed:false,ready:false}`. `artifact` contains
the exact repository/release/source/platform, five digests and protocol version.
Even `admitted:true` is artifact qualification data, not a bearer grant. A trusted
server authorizer must map the exact provider OS/snapshot `imageId` and runtime
installation to these identities before any separate cost/execution authorization.
An operating-system image ID is not an OpenClaw OCI image.

## Current evidence

Fresh official release metadata still identifies
[`v2026.10.9`](https://github.com/openclaw/openclaw/releases/tag/v2026.10.9),
source `8b18b5578f66eab1501cba4cef2310d88bfb9a41`. Its
[protocol owner](https://github.com/openclaw/openclaw/blob/8b18b5578f66eab1501cba4cef2310d88bfb9a41/packages/gateway-protocol/src/version.ts)
declares general protocol 4; lightweight node/probe minimum 3 is not general 4.
The [upstream Docker verifier](https://github.com/openclaw/openclaw/blob/8b18b5578f66eab1501cba4cef2310d88bfb9a41/scripts/verify-docker-attestations.mjs)
checks descriptor/predicate presence, not cryptographic publisher trust.
The [earlier inventory](research/2026-10-31/openclaw-artifact-evidence.json) remains
historical indirect evidence. Fresh anonymous GHCR GET failed local DNS; no
current registry bytes or signer admission is claimed. Actual artifact, sandbox,
backup/restore, transport and serving readiness remain unqualified.
