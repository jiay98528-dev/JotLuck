import { assertInteger, assertPlainObject, assertSha256 } from './common';
import { normalizeRepositoryRelativePath } from './workspace';

export const PUBLIC_MODEL_MANIFEST_SCHEMA_V5 = 'jotluck.autocomplete.public-model.v5';
export const PUBLIC_MODEL_ENGINE_V2R = 'public-phrase-transformer-v1';
export const PUBLIC_MODEL_ASSET_LIMIT_BYTES = 6 * 1024 * 1024;
export const PUBLIC_MODEL_STATIC_DELTA_LIMIT_BYTES = 12 * 1024 * 1024;

export type PublicModelProfileV5 = 'web-local' | 'release';
export type PublicModelAssetRoleV5 = 'model' | 'phrase-bank' | 'tokenizer' | 'metadata' | 'runtime';

export interface PublicModelAssetV5 {
  role: PublicModelAssetRoleV5;
  path: string;
  sha256: string;
  bytes: number;
}

export interface EvidenceBindingV5 {
  path: string;
  sha256: string;
}

export interface PublicModelManifestV5 {
  schema: typeof PUBLIC_MODEL_MANIFEST_SCHEMA_V5;
  schemaVersion: 5;
  engine: typeof PUBLIC_MODEL_ENGINE_V2R;
  profile: PublicModelProfileV5;
  createdAt: string;
  architecture: {
    format: 'onnx';
    quantization: 'int8';
    phraseBankSize: 8192 | 12288 | 16384;
    hiddenSize: 96 | 128;
    layers: 2 | 3;
    attentionHeads: 4;
    maxContextUtf8Bytes: 192;
    contextPatchBytes: 4;
    maxCandidates: 32;
    abstainClass: true;
  };
  assets: PublicModelAssetV5[];
  staticBundleDeltaBytes: number;
  training: {
    selectionManifestPath: string;
    selectionManifestSha256: string;
    inputTreeSha256: string;
    generatorVersion: string;
    seeds: number[];
    trainBytes: number;
    developmentBytes: number;
    internalSelectionBytes: number;
  };
  evidenceBindings: Record<string, EvidenceBindingV5>;
  runtimeEligible: boolean;
  qualityGatePassed: boolean;
  releaseEligible: boolean;
}

const REQUIRED_EVIDENCE = [
  'model',
  'phraseBank',
  'metadata',
  'runtime',
  'selectionManifest',
  'sourceRegistry',
  'corpusGovernance',
  'generatorReport',
  'trainingInput',
  'trainingReport',
  'quantizationReport',
  'operatorConfig',
  'runtimeBuildReport',
  'bundleSizeReport',
  'coldValidationHoldout',
  'workspaceValidationHoldout',
  'coldFinalHoldout',
  'workspaceFinalHoldout',
  'evaluatorSourceTree',
  'qualityReport',
  'runtimeReport',
  'finalConsumptionReceipt',
  'finalOverlapAudit',
  'webviewSmoke',
] as const;

const ARCHITECTURE_MATRIX = new Set(['8192:96:2', '12288:128:2', '16384:128:3']);

export function validatePublicModelManifestV5(value: unknown): PublicModelManifestV5 {
  assertPlainObject(value, 'manifest');
  if (value.schema !== PUBLIC_MODEL_MANIFEST_SCHEMA_V5 || value.schemaVersion !== 5) {
    throw new Error('Public model manifest v5 identity is invalid.');
  }
  if (value.engine !== PUBLIC_MODEL_ENGINE_V2R) throw new Error('Public model engine is invalid.');
  if (value.profile !== 'web-local' && value.profile !== 'release') {
    throw new Error('Public model profile is invalid.');
  }
  if (
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    new Date(value.createdAt).toISOString() !== value.createdAt
  ) {
    throw new Error('createdAt must be a canonical ISO timestamp.');
  }

  validateArchitecture(value.architecture);
  const assetBytes = validateAssets(value.assets);
  assertInteger(value.staticBundleDeltaBytes, 'staticBundleDeltaBytes', {
    min: 1,
    max: PUBLIC_MODEL_STATIC_DELTA_LIMIT_BYTES,
  });
  if ((value.staticBundleDeltaBytes as number) < assetBytes) {
    throw new Error('staticBundleDeltaBytes must include every model and WASM runtime asset.');
  }
  validateTraining(value.training);
  validateEvidenceBindings(value.evidenceBindings);

  for (const flag of ['runtimeEligible', 'qualityGatePassed', 'releaseEligible'] as const) {
    if (typeof value[flag] !== 'boolean') throw new Error(`${flag} must be a boolean.`);
  }
  if (value.qualityGatePassed && !value.runtimeEligible) {
    throw new Error('qualityGatePassed requires runtimeEligible.');
  }
  if (value.releaseEligible && (!value.runtimeEligible || !value.qualityGatePassed)) {
    throw new Error('releaseEligible requires both runtime and quality eligibility.');
  }

  return value as unknown as PublicModelManifestV5;
}

function validateArchitecture(value: unknown): void {
  assertPlainObject(value, 'architecture');
  if (value.format !== 'onnx' || value.quantization !== 'int8') {
    throw new Error('Only an INT8 ONNX public engine is accepted.');
  }
  assertInteger(value.phraseBankSize, 'architecture.phraseBankSize', { min: 1 });
  assertInteger(value.hiddenSize, 'architecture.hiddenSize', { min: 1 });
  assertInteger(value.layers, 'architecture.layers', { min: 1 });
  if (!ARCHITECTURE_MATRIX.has(`${value.phraseBankSize}:${value.hiddenSize}:${value.layers}`)) {
    throw new Error('Architecture is outside the frozen V2R training matrix.');
  }
  if (
    value.attentionHeads !== 4 ||
    value.maxContextUtf8Bytes !== 192 ||
    value.contextPatchBytes !== 4 ||
    value.maxCandidates !== 32 ||
    value.abstainClass !== true
  ) {
    throw new Error('Architecture runtime contract is invalid.');
  }
}

function validateAssets(value: unknown): number {
  if (!Array.isArray(value) || value.length < 3) throw new Error('Manifest assets are incomplete.');
  const roles = new Set<string>();
  let modelDataBytes = 0;
  let totalBytes = 0;
  for (const [index, asset] of value.entries()) {
    assertPlainObject(asset, `assets[${index}]`);
    if (
      !['model', 'phrase-bank', 'tokenizer', 'metadata', 'runtime'].includes(String(asset.role))
    ) {
      throw new Error(`assets[${index}].role is invalid.`);
    }
    if (roles.has(String(asset.role)))
      throw new Error(`Duplicate asset role: ${String(asset.role)}.`);
    roles.add(String(asset.role));
    const normalized = normalizeRepositoryRelativePath(String(asset.path), `assets[${index}].path`);
    if (!normalized.startsWith('packages/app/public/')) {
      throw new Error(`assets[${index}].path must stay inside packages/app/public/.`);
    }
    if (asset.role === 'model' && !normalized.endsWith('.onnx')) {
      throw new Error('The public model asset must use ONNX serialization.');
    }
    if (asset.role === 'runtime' && !normalized.endsWith('.wasm')) {
      throw new Error('The public runtime asset must be a WASM binary.');
    }
    assertSha256(asset.sha256, `assets[${index}].sha256`);
    assertInteger(asset.bytes, `assets[${index}].bytes`, { min: 1 });
    totalBytes += asset.bytes as number;
    if (asset.role !== 'runtime') modelDataBytes += asset.bytes as number;
  }
  if (
    !roles.has('model') ||
    !roles.has('phrase-bank') ||
    !roles.has('metadata') ||
    !roles.has('runtime')
  ) {
    throw new Error('Model, phrase-bank, metadata, and WASM runtime assets are required.');
  }
  if (modelDataBytes > PUBLIC_MODEL_ASSET_LIMIT_BYTES) {
    throw new Error(`Public model assets exceed ${PUBLIC_MODEL_ASSET_LIMIT_BYTES} bytes.`);
  }
  if (totalBytes > PUBLIC_MODEL_STATIC_DELTA_LIMIT_BYTES) {
    throw new Error(
      `Public model static delta exceeds ${PUBLIC_MODEL_STATIC_DELTA_LIMIT_BYTES} bytes.`,
    );
  }
  return totalBytes;
}

function validateTraining(value: unknown): void {
  assertPlainObject(value, 'training');
  const selectionPath = normalizeRepositoryRelativePath(
    String(value.selectionManifestPath),
    'training.selectionManifestPath',
  );
  if (!selectionPath.startsWith('scripts/corpus/autocomplete-v2r-release/')) {
    throw new Error('training.selectionManifestPath must identify committed release evidence.');
  }
  assertSha256(value.selectionManifestSha256, 'training.selectionManifestSha256');
  assertSha256(value.inputTreeSha256, 'training.inputTreeSha256');
  if (typeof value.generatorVersion !== 'string' || value.generatorVersion.length < 3) {
    throw new Error('training.generatorVersion is invalid.');
  }
  if (!Array.isArray(value.seeds) || value.seeds.length === 0) {
    throw new Error('training.seeds must not be empty.');
  }
  for (const [index, seed] of value.seeds.entries()) {
    assertInteger(seed, `training.seeds[${index}]`, { min: 0 });
  }
  assertInteger(value.trainBytes, 'training.trainBytes', { min: 1, max: 24 * 1024 * 1024 });
  assertInteger(value.developmentBytes, 'training.developmentBytes', {
    min: 1,
    max: 3 * 1024 * 1024,
  });
  assertInteger(value.internalSelectionBytes, 'training.internalSelectionBytes', {
    min: 1,
    max: 3 * 1024 * 1024,
  });
  const total =
    (value.trainBytes as number) +
    (value.developmentBytes as number) +
    (value.internalSelectionBytes as number);
  if (total > 30 * 1024 * 1024) throw new Error('Training selection exceeds 30MiB.');
}

function validateEvidenceBindings(value: unknown): void {
  assertPlainObject(value, 'evidenceBindings');
  for (const name of REQUIRED_EVIDENCE) {
    const binding = value[name];
    assertPlainObject(binding, `evidenceBindings.${name}`);
    normalizeRepositoryRelativePath(String(binding.path), `evidenceBindings.${name}.path`);
    assertSha256(binding.sha256, `evidenceBindings.${name}.sha256`);
  }
}
