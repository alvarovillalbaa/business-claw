import { createHash } from 'node:crypto';

export class ArtifactAdmissionError extends Error {
  constructor(code) { super(`business_claw_artifact_${code}`); this.name = 'ArtifactAdmissionError'; this.code = code; }
}
const fail = code => { throw new ArtifactAdmissionError(code); };
export const artifactCapabilities = Object.freeze(['config.get', 'config.schema', 'config.schema.lookup', 'config.set', 'config.apply', 'config.patch']);
const INDEX = ['application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json'];
const MANIFEST = ['application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'];
const CONFIG = ['application/vnd.oci.image.config.v1+json', 'application/vnd.docker.container.image.v1+json'];
const limits = Object.freeze({ index: 262144, manifest: 262144, config: 131072, schema: 2097152, protocol: 65536, evidence: 262144 });
const policyFields = ['schemaVersion', 'repository', 'release', 'sourceCommit', 'platform', 'indexDigest', 'manifestDigest', 'configDigest', 'schemaDigest', 'protocolDigest', 'protocolVersion', 'requiredCapabilities', 'publisherIdentity', 'publisherIssuer', 'maxProofAgeSeconds'];
const artifactFields = ['repository', 'release', 'sourceCommit', 'platform', 'indexDigest', 'manifestDigest', 'configDigest', 'schemaDigest', 'protocolDigest', 'protocolVersion'];
function record(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('record_invalid');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length) fail('field_invalid');
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (typeof key !== 'string' || !fields.includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('field_invalid'); }
  for (const key of fields) if (!Object.hasOwn(value, key)) fail('field_invalid');
  return value;
}
function string(value, maximum = 512) {
  if (typeof value !== 'string' || !value.length || value.length > maximum || /[^\x20-\x7e]/.test(value) || value.trim() !== value) fail('text_invalid'); return value;
}
function digest(value) { if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) fail('digest_invalid'); return value; }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function list(value, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) fail('list_invalid');
  const result = [];
  for (let index = 0; index < value.length; index++) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail('list_invalid'); result.push(descriptor.value); }
  return result;
}
function capabilities(value) {
  const items = list(value, artifactCapabilities.length);
  if (!items.length || new Set(items).size !== items.length || items.some(item => !artifactCapabilities.includes(item))) fail('capability_unknown'); return items.toSorted();
}
function freeze(value) { if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; }
function canonical(value) { return JSON.stringify(value, Object.keys(value).toSorted()); }
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) fail('time_invalid');
  const parsed = Date.parse(value); if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) fail('time_invalid'); return value;
}
function integer(value, maximum) { if (!Number.isSafeInteger(value) || value < 1 || value > maximum) fail('integer_invalid'); return value; }
function decode(value, maximum) {
  if (typeof value !== 'string' || value.length > Math.ceil(maximum / 3) * 4 || !/^[A-Za-z0-9_-]+$/.test(value)) fail('bytes_invalid');
  const bytes = Buffer.from(value, 'base64url');
  if (!bytes.length || bytes.length > maximum || bytes.toString('base64url') !== value) fail('bytes_invalid'); return bytes;
}
function json(bytes) {
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('json_invalid'); }
  const pending = [[value, 0]]; let nodes = 0;
  while (pending.length) {
    const [item, depth] = pending.pop(); if (++nodes > 100000 || depth > 64) fail('json_limit');
    if (item && typeof item === 'object') for (const child of Object.values(item)) pending.push([child, depth + 1]);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('json_invalid'); return value;
}
function descriptor(value, mediaTypes) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !mediaTypes.includes(value.mediaType)) fail('descriptor_invalid');
  digest(value.digest); integer(value.size, 32 * 1024 * 1024 * 1024); return value;
}
export function normalizeArtifactPolicy(value) {
  const input = record(value, policyFields);
  if (input.schemaVersion !== 'business-claw.artifact-policy.v1' || input.repository !== 'ghcr.io/openclaw/openclaw' || input.platform !== 'linux/amd64' || typeof input.release !== 'string' || !/^v20\d\d\.(?:[1-9]|1[0-2])\.(?:[1-9]|[12]\d|3[01])$/.test(input.release) || typeof input.sourceCommit !== 'string' || !/^[a-f0-9]{40}$/.test(input.sourceCommit)) fail('identity_invalid');
  const result = { schemaVersion: input.schemaVersion };
  for (const field of artifactFields) result[field] = field.endsWith('Digest') ? digest(input[field]) : input[field];
  result.protocolVersion = integer(input.protocolVersion, 1000000);
  result.requiredCapabilities = capabilities(input.requiredCapabilities);
  result.publisherIdentity = string(input.publisherIdentity);
  result.publisherIssuer = string(input.publisherIssuer);
  result.maxProofAgeSeconds = integer(input.maxProofAgeSeconds, 86400);
  return freeze(result);
}

export function inspectArtifactCandidate(value, candidate) {
  const policy = normalizeArtifactPolicy(value), input = record(candidate, ['schemaVersion', 'index', 'manifest', 'config', 'schema', 'protocol', 'evidence']);
  if (input.schemaVersion !== 'business-claw.artifact-candidate.v1') fail('candidate_invalid');
  const metadata = {}, parsed = {}; let total = 0;
  for (const field of ['index', 'manifest', 'config', 'schema', 'protocol']) {
    const bytes = decode(input[field], limits[field]); total += bytes.length;
    if (`sha256:${hash(bytes)}` !== policy[`${field}Digest`]) fail('byte_digest_mismatch');
    metadata[field] = input[field]; parsed[field] = json(bytes);
  }
  const evidence = list(input.evidence, 16); if (!evidence.length) fail('evidence_missing');
  const evidenceDigests = new Set();
  for (const item of evidence) { const bytes = decode(item, limits.evidence); total += bytes.length; const fingerprint = hash(bytes); if (evidenceDigests.has(fingerprint)) fail('evidence_duplicate'); evidenceDigests.add(fingerprint); }
  if (total > 5 * 1024 * 1024) fail('bytes_limit');
  const { index, manifest, config, protocol } = parsed;
  if (index.schemaVersion !== 2 || !INDEX.includes(index.mediaType) || manifest.schemaVersion !== 2 || !MANIFEST.includes(manifest.mediaType)) fail('media_type_invalid');
  const indexes = list(index.manifests, 128).map(item => descriptor(item, MANIFEST));
  if (new Set(indexes.map(item => item.digest)).size !== indexes.length) fail('descriptor_duplicate');
  const matches = indexes.filter(item => item.platform?.os === 'linux' && item.platform?.architecture === 'amd64' && !Object.hasOwn(item.platform, 'variant'));
  if (matches.length !== 1) fail('platform_ambiguous');
  const selected = matches[0];
  if (selected.digest !== policy.manifestDigest || selected.mediaType !== manifest.mediaType || selected.size !== decode(input.manifest, limits.manifest).length) fail('manifest_binding');
  const configuration = descriptor(manifest.config, CONFIG);
  if (configuration.digest !== policy.configDigest || configuration.size !== decode(input.config, limits.config).length) fail('config_binding');
  const layers = list(manifest.layers, 256);
  if (!layers.length) fail('layers_invalid');
  for (const layer of layers) descriptor(layer, ['application/vnd.oci.image.layer.v1.tar', 'application/vnd.oci.image.layer.v1.tar+gzip', 'application/vnd.oci.image.layer.v1.tar+zstd', 'application/vnd.docker.image.rootfs.diff.tar.gzip']);
  if (config.os !== 'linux' || config.architecture !== 'amd64' || config.config?.User !== 'node' || config.rootfs?.type !== 'layers' || list(config.rootfs?.diff_ids, 256).length !== layers.length) fail('runtime_config_invalid');
  for (const diff of config.rootfs.diff_ids) digest(diff);
  const labels = config.config.Labels;
  if (!labels || labels['org.opencontainers.image.revision'] !== policy.sourceCommit || labels['org.opencontainers.image.version'] !== policy.release.slice(1) || (Object.hasOwn(labels, 'org.opencontainers.image.source') && labels['org.opencontainers.image.source'] !== 'https://github.com/openclaw/openclaw')) fail('release_binding');
  record(protocol, ['schemaVersion', 'release', 'sourceCommit', 'protocolVersion', 'schemaDigest', 'capabilities']);
  if (protocol.schemaVersion !== 'business-claw.gateway-protocol.v1' || protocol.release !== policy.release || protocol.sourceCommit !== policy.sourceCommit || protocol.protocolVersion !== policy.protocolVersion || protocol.schemaDigest !== policy.schemaDigest) fail('protocol_binding');
  const supplied = capabilities(protocol.capabilities);
  if (policy.requiredCapabilities.some(item => !supplied.includes(item))) fail('capability_missing');
  const artifact = Object.fromEntries(artifactFields.map(field => [field, policy[field]]));
  const policyHash = hash(canonical(policy)), artifactHash = hash(canonical(artifact));
  return freeze({ policy, policyHash, artifact, artifactHash, metadata, evidence: [...evidence] });
}

export function createArtifactAdmission({ verifier = null, clock = { now: () => new Date().toISOString() } } = {}) {
  if (!clock || typeof clock.now !== 'function' || (verifier !== null && typeof verifier?.verify !== 'function')) fail('ports_invalid');
  return Object.freeze({ async admit(value, candidate) {
    const request = inspectArtifactCandidate(value, candidate), now = timestamp(clock.now());
    function result(admitted, reason, proof = null) { return freeze({ schemaVersion: 'business-claw.artifact-admission.v1', admitted, reason,
      policyHash: request.policyHash, artifactHash: request.artifactHash, artifact: request.artifact,
      verifiedAt: proof?.verifiedAt ?? null, expiresAt: proof?.expiresAt ?? null, evidenceDigest: proof?.evidenceDigest ?? null,
      activationAllowed: false, dispatchAllowed: false, ready: false }); }
    if (verifier === null) return result(false, 'verifier_unbound');
    const controller = new AbortController(); let timer, proof, timedOut = false;
    try {
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(new ArtifactAdmissionError('verification_timeout')); controller.abort(); }, 5000); });
      proof = await Promise.race([Promise.resolve().then(() => verifier.verify(request, { signal: controller.signal })), timeout]);
    } catch (error) { return result(false, error instanceof ArtifactAdmissionError && error.code === 'verification_timeout' ? 'verification_timeout' : 'verifier_failed'); }
    finally { clearTimeout(timer); controller.abort(); }
    if (timedOut) return result(false, 'verification_timeout');
    try {
      record(proof, ['schemaVersion', 'policyHash', 'artifactHash', 'publisherIdentity', 'publisherIssuer', 'signatureStatus', 'provenanceStatus', 'compatibilityStatus', 'capabilities', 'evidenceDigest', 'verifiedAt', 'expiresAt']);
      if (proof.schemaVersion !== 'business-claw.artifact-proof.v1' || proof.policyHash !== request.policyHash || proof.artifactHash !== request.artifactHash || proof.publisherIdentity !== request.policy.publisherIdentity || proof.publisherIssuer !== request.policy.publisherIssuer) return result(false, 'proof_mismatch');
      if (proof.signatureStatus !== 'verified' || proof.provenanceStatus !== 'verified') return result(false, 'publisher_unverified');
      if (proof.compatibilityStatus !== 'verified' || request.policy.requiredCapabilities.some(item => !capabilities(proof.capabilities).includes(item))) return result(false, 'capability_unverified');
      digest(proof.evidenceDigest); timestamp(proof.verifiedAt); timestamp(proof.expiresAt);
      const ended = timestamp(clock.now());
      if (ended < now || proof.verifiedAt > ended || proof.expiresAt <= ended || proof.expiresAt <= proof.verifiedAt || Date.parse(ended) - Date.parse(proof.verifiedAt) > request.policy.maxProofAgeSeconds * 1000 || Date.parse(proof.expiresAt) - Date.parse(proof.verifiedAt) > request.policy.maxProofAgeSeconds * 1000) return result(false, 'verification_expired');
      return result(true, 'verified', { verifiedAt: proof.verifiedAt, expiresAt: proof.expiresAt, evidenceDigest: proof.evidenceDigest });
    } catch { return result(false, 'proof_invalid'); }
  } });
}
