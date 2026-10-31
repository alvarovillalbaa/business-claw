import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ArtifactAdmissionError, artifactCapabilities, normalizeArtifactPolicy, inspectArtifactCandidate, createArtifactAdmission } from '../../runtime/artifact-admission.mjs';

const source = '8b18b5578f66eab1501cba4cef2310d88bfb9a41';
const now = '2026-10-31T12:00:00.000Z', clock = { now: () => now };
const indexType = 'application/vnd.oci.image.index.v1+json', manifestType = 'application/vnd.oci.image.manifest.v1+json';
const sha = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const raw = value => Buffer.from(JSON.stringify(value));
const encoded = value => raw(value).toString('base64url');
const denied = code => error => error instanceof ArtifactAdmissionError && error.code === code;
function bundle({ changeIndex, changeManifest, changeConfig, changeProtocol, schema = { type: 'object', additionalProperties: false } } = {}) {
  const config = { os: 'linux', architecture: 'amd64', config: { User: 'node', Labels: { 'org.opencontainers.image.revision': source, 'org.opencontainers.image.version': '2026.10.9', 'org.opencontainers.image.source': 'https://github.com/openclaw/openclaw' } }, rootfs: { type: 'layers', diff_ids: [`sha256:${'1'.repeat(64)}`] } };
  changeConfig?.(config);
  const manifest = { schemaVersion: 2, mediaType: manifestType, config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: sha(raw(config)), size: raw(config).length }, layers: [{ mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip', digest: `sha256:${'2'.repeat(64)}`, size: 128 }] };
  changeManifest?.(manifest);
  const index = { schemaVersion: 2, mediaType: indexType, manifests: [{ mediaType: manifestType, digest: sha(raw(manifest)), size: raw(manifest).length, platform: { os: 'linux', architecture: 'amd64' } }] };
  changeIndex?.(index);
  const protocol = { schemaVersion: 'business-claw.gateway-protocol.v1', release: 'v2026.10.9', sourceCommit: source, protocolVersion: 4, schemaDigest: sha(raw(schema)), capabilities: [...artifactCapabilities] };
  changeProtocol?.(protocol);
  const values = { index, manifest, config, schema, protocol };
  const candidate = { schemaVersion: 'business-claw.artifact-candidate.v1', ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, encoded(value)])), evidence: [encoded({ fixture: 'authored unsigned bytes; no production signature' })] };
  const policy = { schemaVersion: 'business-claw.artifact-policy.v1', repository: 'ghcr.io/openclaw/openclaw', release: 'v2026.10.9', sourceCommit: source, platform: 'linux/amd64',
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [`${key}Digest`, sha(raw(value))])), protocolVersion: 4,
    requiredCapabilities: ['config.get', 'config.schema'], publisherIdentity: 'authored-test-publisher', publisherIssuer: 'authored-test-issuer', maxProofAgeSeconds: 300 };
  return { policy, candidate };
}
function proof(request, patch = {}) {
  return { schemaVersion: 'business-claw.artifact-proof.v1', policyHash: request.policyHash, artifactHash: request.artifactHash,
    publisherIdentity: request.policy.publisherIdentity, publisherIssuer: request.policy.publisherIssuer,
    signatureStatus: 'verified', provenanceStatus: 'verified', compatibilityStatus: 'verified', capabilities: [...artifactCapabilities],
    evidenceDigest: sha(Buffer.from('authored verification receipt, not real provenance')),
    verifiedAt: now, expiresAt: '2026-10-31T12:05:00.000Z', ...patch };
}
const admission = verify => createArtifactAdmission({ clock, verifier: { verify } });

test('policy normalization is detached strict and immutable', () => {
  const { policy } = bundle(), normalized = normalizeArtifactPolicy(policy); policy.requiredCapabilities.push('config.patch');
  assert.deepEqual(normalized.requiredCapabilities, ['config.get', 'config.schema']); assert.ok(Object.isFrozen(normalized)); assert.ok(Object.isFrozen(normalized.requiredCapabilities));
  assert.throws(() => normalizeArtifactPolicy({ ...policy, platform: 'linux/arm64' }), denied('identity_invalid'));
  assert.throws(() => normalizeArtifactPolicy({ ...policy, sourceCommit: 'main' }), denied('identity_invalid'));
  assert.throws(() => normalizeArtifactPolicy({ ...policy, release: 'latest' }), denied('identity_invalid'));
});
test('policy requires known unique nonempty capabilities and exact digest algorithms', () => {
  const { policy } = bundle();
  for (const requiredCapabilities of [[], ['shell.exec'], ['config.get', 'config.get']]) assert.throws(() => normalizeArtifactPolicy({ ...policy, requiredCapabilities }), denied('capability_unknown'));
  assert.throws(() => normalizeArtifactPolicy({ ...policy, indexDigest: `sha512:${'a'.repeat(64)}` }), denied('digest_invalid'));
});
test('inspection verifies linked metadata and produces stable policy and artifact hashes', () => {
  const { policy, candidate } = bundle(), inspected = inspectArtifactCandidate(policy, candidate);
  assert.equal(inspected.artifact.platform, 'linux/amd64'); assert.equal(inspected.artifact.protocolVersion, 4);
  assert.equal(inspected.artifactHash, inspectArtifactCandidate({ ...policy, requiredCapabilities: [...policy.requiredCapabilities].reverse() }, candidate).artifactHash);
  assert.equal(inspected.policyHash, inspectArtifactCandidate({ ...policy, requiredCapabilities: [...policy.requiredCapabilities].reverse() }, candidate).policyHash);
  assert.ok(Object.isFrozen(inspected.metadata)); assert.ok(Object.isFrozen(inspected.evidence));
});
test('an unbound verifier cannot admit valid-looking metadata', async () => {
  const { policy, candidate } = bundle(), result = await createArtifactAdmission({ clock }).admit(policy, candidate);
  assert.equal(result.admitted, false); assert.equal(result.reason, 'verifier_unbound'); assert.equal(result.evidenceDigest, null);
});
test('fully bound trusted test proof qualifies only the artifact and never enables execution', async () => {
  const { policy, candidate } = bundle(), result = await admission(request => proof(request)).admit(policy, candidate);
  assert.equal(result.admitted, true); assert.equal(result.reason, 'verified'); assert.equal(result.artifact.sourceCommit, source);
  assert.equal(result.activationAllowed, false); assert.equal(result.dispatchAllowed, false); assert.equal(result.ready, false); assert.ok(Object.isFrozen(result.artifact));
});
test('signed-source and unsigned-predicate claims do not replace publisher verification', async () => {
  const { policy, candidate } = bundle();
  for (const patch of [{ signatureStatus: 'unknown' }, { provenanceStatus: 'unknown' }, { signatureStatus: 'rejected' }, { signatureStatus: 'present' }]) {
    const result = await admission(request => proof(request, patch)).admit(policy, candidate); assert.equal(result.admitted, false); assert.equal(result.reason, 'publisher_unverified');
  }
  const result = await admission(request => ({ ...proof(request), sourceSigned: true })).admit(policy, candidate); assert.equal(result.admitted, false);
});
test('proof cannot be swapped between subjects policies or publisher identities', async () => {
  const { policy, candidate } = bundle();
  for (const patch of [{ artifactHash: 'f'.repeat(64) }, { policyHash: 'e'.repeat(64) }, { publisherIdentity: 'other-test-publisher' }, { publisherIssuer: 'other-test-issuer' }]) {
    const result = await admission(request => proof(request, patch)).admit(policy, candidate); assert.equal(result.admitted, false); assert.equal(result.reason, 'proof_mismatch');
  }
});
test('missing unknown and unverified capability evidence fails closed', async () => {
  const { policy, candidate } = bundle();
  for (const patch of [{ compatibilityStatus: 'unknown' }, { capabilities: ['config.get'] }, { capabilities: ['config.get', 'config.schema', 'shell.exec'] }]) {
    const result = await admission(request => proof(request, patch)).admit(policy, candidate); assert.equal(result.admitted, false);
  }
});
test('expired future stale and overlong verification receipts are refused', async () => {
  const { policy, candidate } = bundle();
  for (const patch of [{ expiresAt: now }, { verifiedAt: '2026-10-31T12:00:01.000Z' }, { verifiedAt: '2026-10-31T11:54:59.000Z' }, { expiresAt: '2026-10-31T12:05:01.000Z' }]) {
    const result = await admission(request => proof(request, patch)).admit(policy, candidate); assert.equal(result.admitted, false); assert.equal(result.reason, 'verification_expired');
  }
});
test('verifier failures are finite and do not copy external error details', async () => {
  const { policy, candidate } = bundle(), result = await admission(() => { throw new Error('AUTHORED_PRIVATE_ERROR_DO_NOT_COPY'); }).admit(policy, candidate);
  assert.equal(result.reason, 'verifier_failed'); assert.equal(JSON.stringify(result).includes('DO_NOT_COPY'), false); assert.equal(result.admitted, false);
});
test('changed metadata bytes cannot borrow an approved digest', () => {
  const { policy, candidate } = bundle(); candidate.index = Buffer.from(`${Buffer.from(candidate.index, 'base64url').toString()} `).toString('base64url');
  assert.throws(() => inspectArtifactCandidate(policy, candidate), denied('byte_digest_mismatch'));
});
test('duplicate and ambiguous platform descriptors are refused independently of hashes', () => {
  const duplicate = bundle({ changeIndex: value => value.manifests.push(structuredClone(value.manifests[0])) });
  assert.throws(() => inspectArtifactCandidate(duplicate.policy, duplicate.candidate), denied('descriptor_duplicate'));
  const ambiguous = bundle({ changeIndex: value => value.manifests.push({ ...value.manifests[0], digest: `sha256:${'a'.repeat(64)}` }) });
  assert.throws(() => inspectArtifactCandidate(ambiguous.policy, ambiguous.candidate), denied('platform_ambiguous'));
});
test('manifest descriptor sizes digests and media types must bind the supplied config', () => {
  for (const changeManifest of [value => value.config.size++, value => { value.config.digest = `sha256:${'f'.repeat(64)}`; }]) {
    const { policy, candidate } = bundle({ changeManifest }); assert.throws(() => inspectArtifactCandidate(policy, candidate), denied('config_binding'));
  }
  const wrongType = bundle({ changeManifest: value => { value.config.mediaType = 'application/octet-stream'; } });
  assert.throws(() => inspectArtifactCandidate(wrongType.policy, wrongType.candidate), denied('descriptor_invalid'));
});
test('root user source drift and platform drift do not satisfy runtime metadata checks', () => {
  for (const changeConfig of [value => { value.config.User = 'root'; }, value => { value.architecture = 'arm64'; }]) {
    const { policy, candidate } = bundle({ changeConfig }); assert.throws(() => inspectArtifactCandidate(policy, candidate), denied('runtime_config_invalid'));
  }
  for (const changeConfig of [value => { value.config.Labels['org.opencontainers.image.revision'] = 'a'.repeat(40); }, value => { value.config.Labels['org.opencontainers.image.version'] = '2026.10.8'; }]) {
    const { policy, candidate } = bundle({ changeConfig }); assert.throws(() => inspectArtifactCandidate(policy, candidate), denied('release_binding'));
  }
});
test('schema protocol version and required methods must match the exact reviewed contract', () => {
  for (const changeProtocol of [value => { value.protocolVersion = 3; }, value => { value.schemaDigest = `sha256:${'f'.repeat(64)}`; }]) {
    const { policy, candidate } = bundle({ changeProtocol }); assert.throws(() => inspectArtifactCandidate(policy, candidate), denied('protocol_binding'));
  }
  const missing = bundle({ changeProtocol: value => { value.capabilities = ['config.get']; } });
  assert.throws(() => inspectArtifactCandidate(missing.policy, missing.candidate), denied('capability_missing'));
});
test('invalid UTF8 malformed JSON nesting and oversized metadata are bounded before verification', () => {
  for (const bytes of [Buffer.from([255]), Buffer.from('{bad')]) {
    const { policy, candidate } = bundle(); candidate.index = bytes.toString('base64url'); policy.indexDigest = sha(bytes); assert.throws(() => inspectArtifactCandidate(policy, candidate), denied('json_invalid'));
  }
  let schema = {}; for (let index = 0; index < 66; index++) schema = { child: schema };
  const nested = bundle({ schema }); assert.throws(() => inspectArtifactCandidate(nested.policy, nested.candidate), denied('json_limit'));
  const large = bundle(); large.candidate.index = 'A'.repeat(349529); assert.throws(() => inspectArtifactCandidate(large.policy, large.candidate), denied('bytes_invalid'));
});
test('evidence must be nonempty unique canonical bytes within the combined budget', () => {
  const base = bundle();
  for (const [evidence, code] of [[[], 'evidence_missing'], [[base.candidate.evidence[0], base.candidate.evidence[0]], 'evidence_duplicate'], [['invalid='], 'bytes_invalid']]) assert.throws(() => inspectArtifactCandidate(base.policy, { ...base.candidate, evidence }), denied(code));
  const large = bundle({ schema: { description: 'a'.repeat(1500000) } }); large.candidate.evidence = Array.from({ length: 16 }, (_, index) => Buffer.alloc(262144, index).toString('base64url'));
  assert.throws(() => inspectArtifactCandidate(large.policy, large.candidate), denied('bytes_limit'));
});
test('accessors hidden symbols custom prototypes and sparse authority arrays are refused', () => {
  const { policy, candidate } = bundle(); let invoked = false;
  const accessor = { ...policy }; Object.defineProperty(accessor, 'sourceCommit', { enumerable: true, get() { invoked = true; return source; } });
  assert.throws(() => normalizeArtifactPolicy(accessor), denied('field_invalid')); assert.equal(invoked, false);
  const hidden = { ...policy }; Object.defineProperty(hidden, 'private', { value: true }); assert.throws(() => normalizeArtifactPolicy(hidden), denied('field_invalid'));
  assert.throws(() => normalizeArtifactPolicy({ ...policy, [Symbol('authority')]: true }), denied('field_invalid'));
  assert.throws(() => normalizeArtifactPolicy(Object.assign(Object.create({ administrator: true }), policy)), denied('record_invalid'));
  const sparse = ['config.get', , 'config.schema']; assert.throws(() => normalizeArtifactPolicy({ ...policy, requiredCapabilities: sparse }), denied('list_invalid'));
  assert.throws(() => inspectArtifactCandidate(policy, { ...candidate, admitted: true }), denied('field_invalid'));
});
test('candidate mutation during verification cannot change the detached admitted identity', async () => {
  const { policy, candidate } = bundle(); let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const pending = admission(request => { entered(request); return new Promise(resolve => { release = () => resolve(proof(request)); }); }).admit(policy, candidate);
  const captured = await started; policy.release = 'v2026.10.8'; candidate.index = 'tampered'; candidate.evidence[0] = 'tampered';
  assert.ok(Object.isFrozen(captured.policy)); assert.ok(Object.isFrozen(captured.evidence)); release();
  const result = await pending; assert.equal(result.admitted, true); assert.equal(result.artifact.release, 'v2026.10.9');
});
test('proof time may advance during verification but a backwards trusted clock cannot admit', async () => {
  const { policy, candidate } = bundle(); let count = 0;
  const moving = createArtifactAdmission({ clock: { now: () => count++ ? '2026-10-31T12:00:01.000Z' : now }, verifier: { verify: request => proof(request, { verifiedAt: '2026-10-31T12:00:00.500Z' }) } });
  assert.equal((await moving.admit(policy, candidate)).admitted, true); count = 0;
  const backwards = createArtifactAdmission({ clock: { now: () => count++ ? '2026-10-31T11:59:59.000Z' : now }, verifier: { verify: request => proof(request) } });
  const result = await backwards.admit(policy, candidate); assert.equal(result.admitted, false); assert.equal(result.reason, 'verification_expired');
});
test('a verifier resolving from its deadline abort cannot race into admission', async () => {
  const { policy, candidate } = bundle(); let aborted = false;
  const gate = admission((request, { signal }) => new Promise(resolve => signal.addEventListener('abort', () => { aborted = true; resolve(proof(request)); }, { once: true })));
  const result = await gate.admit(policy, candidate); assert.equal(result.admitted, false); assert.equal(result.reason, 'verification_timeout'); assert.equal(aborted, true);
});
