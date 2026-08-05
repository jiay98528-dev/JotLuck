export const PUBLIC_FREE_DECODER_ENGINE_ID = 'public-v2-free-decoder-v1';
export const PUBLIC_FREE_DECODER_MANIFEST_SCHEMA = 'jotluck.autocomplete.public-free-decoder.v1';
export const PUBLIC_FREE_DECODER_PROTOCOL_VERSION = 1;
export const PUBLIC_FREE_DECODER_STATIC_LIMIT_BYTES = 24 * 1024 * 1024;
export const PUBLIC_FREE_DECODER_PEAK_MEMORY_LIMIT_BYTES = 192 * 1024 * 1024;
export const PUBLIC_FREE_DECODER_TRAINING_POOL_LIMIT_BYTES = 512 * 1024 * 1024;
export const PUBLIC_FREE_DECODER_MAX_CONTEXT_TOKENS = 256;
export const PUBLIC_FREE_DECODER_TOKENIZER_VOCAB_SIZE = 8_000;
export const PUBLIC_FREE_DECODER_ZH_MAX_CODE_POINTS = 8;
export const PUBLIC_FREE_DECODER_EN_MAX_CODE_POINTS = 12;

export const PUBLIC_FREE_DECODER_MATRIX = Object.freeze([
  Object.freeze({ parameterCount: 16_000_000, quantization: 'q4' as const }),
  Object.freeze({ parameterCount: 24_000_000, quantization: 'q4' as const }),
  Object.freeze({ parameterCount: 32_000_000, quantization: 'q4' as const }),
  Object.freeze({ parameterCount: 16_000_000, quantization: 'q8' as const }),
]);

export interface PublicFreeDecoderAsset {
  file: string;
  sha256: string;
  bytes: number;
}

export interface PublicFreeDecoderManifest {
  schema: typeof PUBLIC_FREE_DECODER_MANIFEST_SCHEMA;
  schemaVersion: 1;
  engine: typeof PUBLIC_FREE_DECODER_ENGINE_ID;
  candidateId: string;
  candidateArtifactSha256: string;
  lifecycle: 'trained' | 'oraclePassed' | 'releaseEligible';
  evaluationOnly: boolean;
  runtimeEligible: true;
  releaseEligible: boolean;
  parameterCount: 16_000_000 | 24_000_000 | 32_000_000;
  quantization: 'q4' | 'q8';
  tokenizer: {
    kind: 'unigram';
    vocabularySize: typeof PUBLIC_FREE_DECODER_TOKENIZER_VOCAB_SIZE;
    byteFallback: true;
    bilingual: true;
  };
  context: {
    maximumTokens: typeof PUBLIC_FREE_DECODER_MAX_CONTEXT_TOKENS;
  };
  output: {
    chineseMaximumCodePoints: typeof PUBLIC_FREE_DECODER_ZH_MAX_CODE_POINTS;
    englishMaximumCodePoints: typeof PUBLIC_FREE_DECODER_EN_MAX_CODE_POINTS;
    preserveCompleteEnglishWord: true;
  };
  training: {
    cleanedPoolBytes: number;
    licenseAuditPassed: true;
  };
  oraclePrecheck: {
    checkpoints: number;
    oracleAt8: number;
    oracleAt32: number;
    chineseOracleAt8: number;
    englishOracleAt8: number;
    passed: boolean;
  };
  assets: {
    model: PublicFreeDecoderAsset;
    tokenizer: PublicFreeDecoderAsset;
  };
  runtimeStaticDeltaBytes: number;
  measuredPeakMemoryBytes: number;
  releaseEvidence?: {
    schema: 'jotluck.autocomplete.public-free-decoder-release.v1';
    coldFinalSha256: string;
    workspaceFinalSha256: string;
    windowsGuiEvidenceSha256: string;
    baselineSha256: string;
  };
}

export function parsePublicFreeDecoderManifest(
  value: unknown,
  manifestBytes: number,
): PublicFreeDecoderManifest {
  if (!isRecord(value)) throw new Error('Public free decoder manifest must be an object.');
  const manifest = value;
  const tokenizer = isRecord(manifest.tokenizer) ? manifest.tokenizer : null;
  const context = isRecord(manifest.context) ? manifest.context : null;
  const output = isRecord(manifest.output) ? manifest.output : null;
  const training = isRecord(manifest.training) ? manifest.training : null;
  const assets = isRecord(manifest.assets) ? manifest.assets : null;
  if (
    manifest.schema !== PUBLIC_FREE_DECODER_MANIFEST_SCHEMA ||
    manifest.schemaVersion !== 1 ||
    manifest.engine !== PUBLIC_FREE_DECODER_ENGINE_ID ||
    !isCandidateId(manifest.candidateId) ||
    !isSha256(manifest.candidateArtifactSha256) ||
    manifest.runtimeEligible !== true ||
    !hasValidLifecycle(manifest) ||
    !isMatrixEntry(manifest.parameterCount, manifest.quantization) ||
    !tokenizer ||
    tokenizer.kind !== 'unigram' ||
    tokenizer.vocabularySize !== PUBLIC_FREE_DECODER_TOKENIZER_VOCAB_SIZE ||
    tokenizer.byteFallback !== true ||
    tokenizer.bilingual !== true ||
    !context ||
    context.maximumTokens !== PUBLIC_FREE_DECODER_MAX_CONTEXT_TOKENS ||
    !output ||
    output.chineseMaximumCodePoints !== PUBLIC_FREE_DECODER_ZH_MAX_CODE_POINTS ||
    output.englishMaximumCodePoints !== PUBLIC_FREE_DECODER_EN_MAX_CODE_POINTS ||
    output.preserveCompleteEnglishWord !== true ||
    !training ||
    !isSafeByteCount(training.cleanedPoolBytes) ||
    training.cleanedPoolBytes > PUBLIC_FREE_DECODER_TRAINING_POOL_LIMIT_BYTES ||
    training.licenseAuditPassed !== true ||
    !assets ||
    !isAsset(assets.model) ||
    !isAsset(assets.tokenizer) ||
    !isSafeByteCount(manifest.runtimeStaticDeltaBytes) ||
    !isSafeByteCount(manifest.measuredPeakMemoryBytes)
  ) {
    throw new Error('Public free decoder manifest contract is invalid.');
  }
  const staticBytes =
    manifestBytes + assets.model.bytes + assets.tokenizer.bytes + manifest.runtimeStaticDeltaBytes;
  if (staticBytes > PUBLIC_FREE_DECODER_STATIC_LIMIT_BYTES) {
    throw new Error('Public free decoder exceeds the 24 MiB static budget.');
  }
  if (manifest.measuredPeakMemoryBytes > PUBLIC_FREE_DECODER_PEAK_MEMORY_LIMIT_BYTES) {
    throw new Error('Public free decoder exceeds the 192 MiB peak-memory budget.');
  }
  return manifest as unknown as PublicFreeDecoderManifest;
}

function hasValidLifecycle(manifest: Record<string, unknown>): boolean {
  if (manifest.lifecycle === 'trained') {
    return (
      manifest.evaluationOnly === true &&
      manifest.runtimeEligible === true &&
      manifest.releaseEligible === false &&
      manifest.releaseEvidence === undefined &&
      hasUnclaimedOraclePrecheck(manifest.oraclePrecheck)
    );
  }
  if (manifest.lifecycle === 'oraclePassed') {
    return (
      manifest.evaluationOnly === true &&
      manifest.runtimeEligible === true &&
      manifest.releaseEligible === false &&
      manifest.releaseEvidence === undefined &&
      hasPassingOraclePrecheck(manifest.oraclePrecheck)
    );
  }
  if (
    manifest.lifecycle !== 'releaseEligible' ||
    manifest.evaluationOnly !== false ||
    manifest.runtimeEligible !== true ||
    manifest.releaseEligible !== true ||
    !hasPassingOraclePrecheck(manifest.oraclePrecheck)
  ) {
    return false;
  }
  if (!isRecord(manifest.releaseEvidence)) return false;
  return (
    manifest.releaseEvidence.schema === 'jotluck.autocomplete.public-free-decoder-release.v1' &&
    isSha256(manifest.releaseEvidence.coldFinalSha256) &&
    isSha256(manifest.releaseEvidence.workspaceFinalSha256) &&
    isSha256(manifest.releaseEvidence.windowsGuiEvidenceSha256) &&
    isSha256(manifest.releaseEvidence.baselineSha256)
  );
}

function hasUnclaimedOraclePrecheck(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    value.checkpoints === 0 &&
    value.oracleAt8 === 0 &&
    value.oracleAt32 === 0 &&
    value.chineseOracleAt8 === 0 &&
    value.englishOracleAt8 === 0 &&
    value.passed === false
  );
}

function hasPassingOraclePrecheck(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    Number.isSafeInteger(value.checkpoints) &&
    (value.checkpoints as number) > 0 &&
    isRate(value.oracleAt8) &&
    value.oracleAt8 >= 0.45 &&
    isRate(value.oracleAt32) &&
    value.oracleAt32 >= 0.55 &&
    isRate(value.chineseOracleAt8) &&
    value.chineseOracleAt8 >= 0.4 &&
    isRate(value.englishOracleAt8) &&
    value.englishOracleAt8 >= 0.4 &&
    value.passed === true
  );
}

function isMatrixEntry(parameterCount: unknown, quantization: unknown): boolean {
  return PUBLIC_FREE_DECODER_MATRIX.some(
    (entry) => entry.parameterCount === parameterCount && entry.quantization === quantization,
  );
}

function isAsset(value: unknown): value is PublicFreeDecoderAsset {
  if (!isRecord(value)) return false;
  return (
    typeof value.file === 'string' &&
    /^[a-z0-9][a-z0-9._-]{0,127}$/u.test(value.file) &&
    !value.file.includes('..') &&
    typeof value.sha256 === 'string' &&
    /^[a-f0-9]{64}$/u.test(value.sha256) &&
    isSafeByteCount(value.bytes) &&
    value.bytes > 0
  );
}

function isCandidateId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,95}$/u.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function isSafeByteCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
