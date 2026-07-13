import { canonicalJson, canonicalSha256, sha256, V2S_ENGINE_ID } from './common';

export const V2S_MANIFEST_SCHEMA = 'jotluck.autocomplete.public-model.v6';
export const V2S_CONTAINER_SCHEMA = 'jotluck.autocomplete.public-container.v6';
export const V2S_MAX_MODEL_BYTES = 6 * 1024 * 1024;
const CONTAINER_MAGIC = new TextEncoder().encode('JLV2S6\0\0');

export interface V2SContainerSection {
  id: string;
  bytes: Uint8Array;
}

export interface V2SContainerHeader {
  schema: typeof V2S_CONTAINER_SCHEMA;
  schemaVersion: 6;
  engine: typeof V2S_ENGINE_ID;
  sections: Array<{
    id: string;
    relativeOffset: number;
    bytes: number;
    sha256: string;
  }>;
  payloadBytes: number;
}

export interface V2SPublicModelManifest {
  schema: typeof V2S_MANIFEST_SCHEMA;
  schemaVersion: 6;
  engine: typeof V2S_ENGINE_ID;
  profile: 'candidate' | 'web-local' | 'release';
  candidateId: string;
  architecture: {
    languages: ['zh', 'en'];
    tokenizers: { zh: 'bpe' | 'unigram'; en: 'bpe' | 'unigram' };
    vocabularyLimitPerLanguage: number;
    ngramOrders: [2, 2 | 3 | 4 | 5];
    quantization: 'probability-q16+gate-q16' | 'probability-q16+gate-int8';
    gateKind: 'g0-rules' | 'g1-mlp16-int8';
    assetBudgetBytes: number;
  };
  asset: {
    path: string;
    bytes: number;
    sha256: string;
    containerHeaderSha256: string;
  };
  training: {
    selectionPath: string;
    selectionSha256: string;
    inputTreeSha256: string;
    selectedDocumentCount: number;
    selectedBytes: number;
  };
  evidenceBindings: Record<string, { path: string; sha256: string }>;
  runtimeEligible: boolean;
  qualityGatePassed: boolean;
  releaseEligible: boolean;
  formalResult: false;
  manifestSha256: string;
}

export function packV2SContainer(
  sections: readonly V2SContainerSection[],
  maximumBytes = V2S_MAX_MODEL_BYTES,
): { bytes: Uint8Array; header: V2SContainerHeader; headerSha256: string } {
  if (sections.length === 0) throw new Error('V2S container requires at least one section.');
  const ids = new Set<string>();
  let relativeOffset = 0;
  const headerSections = sections.map((section) => {
    if (!/^[a-z][a-z0-9.-]{0,63}$/u.test(section.id)) {
      throw new Error(`Invalid V2S section id: ${section.id}.`);
    }
    if (ids.has(section.id)) throw new Error(`Duplicate V2S section id: ${section.id}.`);
    ids.add(section.id);
    const descriptor = {
      id: section.id,
      relativeOffset,
      bytes: section.bytes.byteLength,
      sha256: sha256(section.bytes),
    };
    relativeOffset += section.bytes.byteLength;
    return descriptor;
  });
  const header: V2SContainerHeader = {
    schema: V2S_CONTAINER_SCHEMA,
    schemaVersion: 6,
    engine: V2S_ENGINE_ID,
    sections: headerSections,
    payloadBytes: relativeOffset,
  };
  const headerBytes = new TextEncoder().encode(canonicalJson(header));
  const totalBytes = CONTAINER_MAGIC.byteLength + 4 + headerBytes.byteLength + relativeOffset;
  if (totalBytes > maximumBytes) {
    throw new Error(`V2S container is ${totalBytes} bytes and exceeds budget ${maximumBytes}.`);
  }
  const output = new Uint8Array(totalBytes);
  output.set(CONTAINER_MAGIC, 0);
  new DataView(output.buffer).setUint32(CONTAINER_MAGIC.byteLength, headerBytes.byteLength, true);
  const headerOffset = CONTAINER_MAGIC.byteLength + 4;
  output.set(headerBytes, headerOffset);
  let payloadOffset = headerOffset + headerBytes.byteLength;
  for (const section of sections) {
    output.set(section.bytes, payloadOffset);
    payloadOffset += section.bytes.byteLength;
  }
  return { bytes: output, header, headerSha256: sha256(headerBytes) };
}

export function unpackV2SContainer(
  bytes: Uint8Array,
  maximumBytes = V2S_MAX_MODEL_BYTES,
): { header: V2SContainerHeader; sections: Map<string, Uint8Array>; headerSha256: string } {
  if (bytes.byteLength > maximumBytes) throw new Error('V2S container exceeds its byte limit.');
  if (bytes.byteLength < CONTAINER_MAGIC.byteLength + 4)
    throw new Error('V2S container is truncated.');
  for (let index = 0; index < CONTAINER_MAGIC.length; index += 1) {
    if (bytes[index] !== CONTAINER_MAGIC[index]) throw new Error('V2S container magic is invalid.');
  }
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    CONTAINER_MAGIC.byteLength,
    true,
  );
  const headerOffset = CONTAINER_MAGIC.byteLength + 4;
  const payloadOffset = headerOffset + headerLength;
  if (headerLength < 2 || payloadOffset > bytes.byteLength)
    throw new Error('V2S header is truncated.');
  const headerBytes = bytes.slice(headerOffset, payloadOffset);
  const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(headerBytes));
  const header = validateContainerHeader(parsed);
  if (payloadOffset + header.payloadBytes !== bytes.byteLength) {
    throw new Error('V2S payload byte count does not match the container length.');
  }
  const sections = new Map<string, Uint8Array>();
  let expectedOffset = 0;
  for (const section of header.sections) {
    if (section.relativeOffset !== expectedOffset) {
      throw new Error('V2S sections are not contiguous and ordered.');
    }
    const start = payloadOffset + section.relativeOffset;
    const end = start + section.bytes;
    if (end > bytes.byteLength) throw new Error(`V2S section ${section.id} is truncated.`);
    const sectionBytes = bytes.slice(start, end);
    if (sha256(sectionBytes) !== section.sha256) {
      throw new Error(`V2S section ${section.id} failed SHA-256 verification.`);
    }
    if (sections.has(section.id)) throw new Error(`Duplicate V2S section ${section.id}.`);
    sections.set(section.id, sectionBytes);
    expectedOffset += section.bytes;
  }
  return { header, sections, headerSha256: sha256(headerBytes) };
}

export function finalizeV2SManifest(
  manifest: Omit<V2SPublicModelManifest, 'manifestSha256'>,
): V2SPublicModelManifest {
  validateManifestShape(manifest);
  return { ...manifest, manifestSha256: canonicalSha256(manifest) };
}

export function verifyV2SManifest(manifest: V2SPublicModelManifest): void {
  validateManifestShape(manifest);
  const { manifestSha256, ...unsigned } = manifest;
  if (canonicalSha256(unsigned) !== manifestSha256) {
    throw new Error('V2S manifest SHA-256 is invalid.');
  }
}

function validateContainerHeader(value: unknown): V2SContainerHeader {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('V2S container header must be an object.');
  }
  const header = value as Partial<V2SContainerHeader>;
  if (
    header.schema !== V2S_CONTAINER_SCHEMA ||
    header.schemaVersion !== 6 ||
    header.engine !== V2S_ENGINE_ID ||
    !Array.isArray(header.sections) ||
    !Number.isSafeInteger(header.payloadBytes) ||
    (header.payloadBytes ?? -1) < 0
  ) {
    throw new Error('V2S container header schema is invalid.');
  }
  for (const section of header.sections) {
    if (
      typeof section.id !== 'string' ||
      !Number.isSafeInteger(section.relativeOffset) ||
      section.relativeOffset < 0 ||
      !Number.isSafeInteger(section.bytes) ||
      section.bytes < 0 ||
      !/^[0-9a-f]{64}$/u.test(section.sha256)
    ) {
      throw new Error('V2S container section descriptor is invalid.');
    }
  }
  return header as V2SContainerHeader;
}

function validateManifestShape(
  manifest: Omit<V2SPublicModelManifest, 'manifestSha256'> | V2SPublicModelManifest,
): void {
  if (
    manifest.schema !== V2S_MANIFEST_SCHEMA ||
    manifest.schemaVersion !== 6 ||
    manifest.engine !== V2S_ENGINE_ID ||
    manifest.formalResult !== false
  ) {
    throw new Error('V2S manifest schema or candidate status is invalid.');
  }
  if (
    !Number.isSafeInteger(manifest.asset.bytes) ||
    manifest.asset.bytes < 1 ||
    manifest.asset.bytes > V2S_MAX_MODEL_BYTES ||
    manifest.asset.bytes > manifest.architecture.assetBudgetBytes
  ) {
    throw new Error('V2S asset bytes violate the manifest budget.');
  }
  const { architecture } = manifest;
  if (
    !Array.isArray(architecture.ngramOrders) ||
    architecture.ngramOrders.length !== 2 ||
    architecture.ngramOrders[0] !== 2 ||
    !Number.isSafeInteger(architecture.ngramOrders[1]) ||
    architecture.ngramOrders[1] < 2 ||
    architecture.ngramOrders[1] > 5 ||
    (architecture.gateKind !== 'g0-rules' && architecture.gateKind !== 'g1-mlp16-int8') ||
    architecture.quantization !==
      (architecture.gateKind === 'g0-rules'
        ? 'probability-q16+gate-q16'
        : 'probability-q16+gate-int8')
  ) {
    throw new Error('V2S architecture order, gate and quantization are inconsistent.');
  }
  if (
    manifest.releaseEligible &&
    (!manifest.runtimeEligible || !manifest.qualityGatePassed || manifest.profile === 'candidate')
  ) {
    throw new Error('V2S release eligibility is inconsistent.');
  }
  if (manifest.profile === 'candidate') {
    if (manifest.runtimeEligible || manifest.qualityGatePassed || manifest.releaseEligible) {
      throw new Error('V2S training candidates must remain fail-closed.');
    }
  }
}
