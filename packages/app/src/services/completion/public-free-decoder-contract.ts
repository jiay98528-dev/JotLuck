export const PUBLIC_FREE_DECODER_ENGINE_ID = 'public-v2-free-decoder-v1';
export const PUBLIC_FREE_DECODER_MANIFEST_SCHEMA = 'jotluck.autocomplete.public-free-decoder.v1';
export const PUBLIC_V25_JOINT_ENGINE_ID = 'public-v2.5-joint-v1';
export const PUBLIC_V25_ONE_UNIT_WRITING_ENGINE_ID = 'public-v2.5-one-unit-writing-v1';
export const PUBLIC_V25_JOINT_MANIFEST_SCHEMA = 'jotluck.autocomplete.public-routed-decoder.v1';
export const PUBLIC_V25_VISIBILITY_CALIBRATION_SCHEMA =
  'jotluck.autocomplete.v2.5-visibility-calibration.v1';
export const PUBLIC_FREE_DECODER_PROTOCOL_VERSION = 1;
export const PUBLIC_FREE_DECODER_STATIC_LIMIT_BYTES = 24 * 1024 * 1024;
export const PUBLIC_FREE_DECODER_PEAK_MEMORY_LIMIT_BYTES = 192 * 1024 * 1024;
export const PUBLIC_FREE_DECODER_TRAINING_POOL_LIMIT_BYTES = 512 * 1024 * 1024;
export const PUBLIC_FREE_DECODER_MAX_CONTEXT_TOKENS = 256;
export const PUBLIC_FREE_DECODER_TOKENIZER_VOCAB_SIZE = 8_000;
export const PUBLIC_V25_ONE_UNIT_TOKENIZER_VOCAB_SIZE = 12_000;
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

export interface PublicV25VisibilityProfile {
  route: 'writing' | 'code';
  language: 'zh' | 'en';
  searchMode: 'fixed-1' | 'fixed-4' | 'adaptive-1-to-4';
  scale: number;
  bias: number;
  threshold: number;
}

export interface PublicV25VisibilityCalibration {
  schema: typeof PUBLIC_V25_VISIBILITY_CALIBRATION_SCHEMA;
  hardwareProfile: string;
  beamThresholds: { floor: number; marginFloor: number };
  profiles: readonly PublicV25VisibilityProfile[];
}

export interface PublicV25OneUnitTriggerPolicy {
  kind: 'g0-strong-terminator-plus-model-score-v1';
  englishStrongTerminators: '.!?';
  chineseStrongTerminators: '。！？：；.!?;:';
  modelScoreFloors: { en: number; zh: number };
}

export interface PublicFreeDecoderManifest {
  schema: typeof PUBLIC_FREE_DECODER_MANIFEST_SCHEMA | typeof PUBLIC_V25_JOINT_MANIFEST_SCHEMA;
  schemaVersion: 1;
  engine:
    | typeof PUBLIC_FREE_DECODER_ENGINE_ID
    | typeof PUBLIC_V25_JOINT_ENGINE_ID
    | typeof PUBLIC_V25_ONE_UNIT_WRITING_ENGINE_ID;
  route?: 'joint' | 'writing';
  candidateId: string;
  candidateArtifactSha256: string;
  lifecycle: 'trained' | 'oraclePassed' | 'releaseEligible' | 'integrationRelease';
  evaluationOnly: boolean;
  runtimeEligible: boolean;
  releaseEligible: boolean;
  distributionPolicy?: 'local-research-only';
  matrixId?: '32m-q4';
  parameterCount: 16_000_000 | 24_000_000 | 32_000_000;
  quantization: 'q4' | 'q8';
  tokenizer: {
    kind: 'unigram';
    vocabularySize:
      | typeof PUBLIC_FREE_DECODER_TOKENIZER_VOCAB_SIZE
      | typeof PUBLIC_V25_ONE_UNIT_TOKENIZER_VOCAB_SIZE;
    byteFallback: true;
    bilingual: true;
  };
  context: {
    maximumTokens: typeof PUBLIC_FREE_DECODER_MAX_CONTEXT_TOKENS;
  };
  output: {
    chineseMaximumCodePoints: 4 | 8 | 32;
    englishMaximumCodePoints: 12 | 24 | 32;
    preserveCompleteEnglishWord: boolean;
  };
  training: {
    cleanedPoolBytes: number;
    licenseAuditPassed: boolean;
    datasetRecipe?: 'v25-contract-first-short-ghost-v1' | 'v25-one-unit-writing-eos-v2';
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
  visibilityCalibration?: PublicV25VisibilityCalibration;
  completionUnit?: 'one-lexical-unit';
  triggerPolicy?: PublicV25OneUnitTriggerPolicy;
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
  const legacyContract =
    manifest.schema === PUBLIC_FREE_DECODER_MANIFEST_SCHEMA &&
    manifest.engine === PUBLIC_FREE_DECODER_ENGINE_ID &&
    manifest.route === undefined;
  const v25JointContract =
    manifest.engine === PUBLIC_V25_JOINT_ENGINE_ID &&
    manifest.route === 'joint' &&
    manifest.matrixId === '32m-q4' &&
    manifest.parameterCount === 32_000_000 &&
    manifest.quantization === 'q4';
  const v25OneUnitWritingContract =
    manifest.engine === PUBLIC_V25_ONE_UNIT_WRITING_ENGINE_ID &&
    manifest.route === 'writing' &&
    manifest.matrixId === '32m-q4' &&
    manifest.parameterCount === 32_000_000 &&
    manifest.quantization === 'q4';
  const candidateLabelValid = v25JointContract
    ? typeof manifest.candidateId === 'string'
    : isCandidateId(manifest.candidateId);
  const candidateArtifactValid = v25JointContract
    ? typeof manifest.candidateArtifactSha256 === 'string'
    : isSha256(manifest.candidateArtifactSha256);
  const outputValid =
    !!output &&
    ((legacyContract &&
      output.chineseMaximumCodePoints === PUBLIC_FREE_DECODER_ZH_MAX_CODE_POINTS &&
      output.englishMaximumCodePoints === PUBLIC_FREE_DECODER_EN_MAX_CODE_POINTS &&
      output.preserveCompleteEnglishWord === true) ||
      (v25JointContract &&
        output.chineseMaximumCodePoints === 32 &&
        output.englishMaximumCodePoints === 32 &&
        output.preserveCompleteEnglishWord === false) ||
      (v25OneUnitWritingContract &&
        output.chineseMaximumCodePoints === 4 &&
        output.englishMaximumCodePoints === 24 &&
        output.preserveCompleteEnglishWord === true));
  const tokenizerVocabularyValid =
    tokenizer?.vocabularySize ===
    (v25OneUnitWritingContract
      ? PUBLIC_V25_ONE_UNIT_TOKENIZER_VOCAB_SIZE
      : PUBLIC_FREE_DECODER_TOKENIZER_VOCAB_SIZE);
  if (
    (!legacyContract && !v25JointContract && !v25OneUnitWritingContract) ||
    (!v25JointContract && manifest.schemaVersion !== 1) ||
    !candidateLabelValid ||
    !candidateArtifactValid ||
    (!v25JointContract && manifest.runtimeEligible !== true) ||
    (!v25JointContract && !hasValidLifecycle(manifest)) ||
    !isMatrixEntry(manifest.parameterCount, manifest.quantization) ||
    !tokenizer ||
    tokenizer.kind !== 'unigram' ||
    !tokenizerVocabularyValid ||
    tokenizer.byteFallback !== true ||
    tokenizer.bilingual !== true ||
    !context ||
    context.maximumTokens !== PUBLIC_FREE_DECODER_MAX_CONTEXT_TOKENS ||
    !outputValid ||
    (!v25JointContract && !training) ||
    (!v25JointContract && !isSafeByteCount(training?.cleanedPoolBytes)) ||
    (!v25JointContract &&
      (training?.cleanedPoolBytes as number) > PUBLIC_FREE_DECODER_TRAINING_POOL_LIMIT_BYTES) ||
    (!v25JointContract && !hasValidTrainingPolicy(manifest, training!)) ||
    !assets ||
    !isAsset(assets.model, !v25JointContract) ||
    !isAsset(assets.tokenizer, !v25JointContract) ||
    (!v25JointContract && !isSafeByteCount(manifest.runtimeStaticDeltaBytes)) ||
    (!v25JointContract && !isSafeByteCount(manifest.measuredPeakMemoryBytes)) ||
    (v25JointContract &&
      !isVisibilityCalibration(manifest.visibilityCalibration, ['writing', 'code'])) ||
    (v25OneUnitWritingContract &&
      (!isVisibilityCalibration(manifest.visibilityCalibration, ['writing']) ||
        manifest.completionUnit !== 'one-lexical-unit' ||
        !isOneUnitTriggerPolicy(manifest.triggerPolicy)))
  ) {
    throw new Error('Public free decoder manifest contract is invalid.');
  }
  if (!v25JointContract) {
    const staticBytes =
      manifestBytes +
      assets.model.bytes +
      assets.tokenizer.bytes +
      (manifest.runtimeStaticDeltaBytes as number);
    if (staticBytes > PUBLIC_FREE_DECODER_STATIC_LIMIT_BYTES) {
      throw new Error('Public free decoder exceeds the 24 MiB static budget.');
    }
    if (
      (manifest.measuredPeakMemoryBytes as number) > PUBLIC_FREE_DECODER_PEAK_MEMORY_LIMIT_BYTES
    ) {
      throw new Error('Public free decoder exceeds the 192 MiB peak-memory budget.');
    }
  }
  return manifest as unknown as PublicFreeDecoderManifest;
}

function isVisibilityCalibration(
  value: unknown,
  requiredRoutes: readonly ('writing' | 'code')[],
): value is PublicV25VisibilityCalibration {
  if (!isRecord(value)) return false;
  const beamFloor = isRecord(value.beamThresholds) ? value.beamThresholds.floor : null;
  const marginFloor = isRecord(value.beamThresholds) ? value.beamThresholds.marginFloor : null;
  if (
    typeof beamFloor !== 'number' ||
    !Number.isFinite(beamFloor) ||
    beamFloor < 0 ||
    beamFloor > 1 ||
    typeof marginFloor !== 'number' ||
    !Number.isFinite(marginFloor) ||
    marginFloor < 0 ||
    marginFloor > 1 ||
    !Array.isArray(value.profiles)
  ) {
    return false;
  }
  const keys = new Set<string>();
  for (const profile of value.profiles) {
    if (!isRecord(profile)) return false;
    const validRoute = profile.route === 'writing' || profile.route === 'code';
    const validLanguage = profile.language === 'zh' || profile.language === 'en';
    const validMode =
      profile.searchMode === 'fixed-1' ||
      profile.searchMode === 'fixed-4' ||
      profile.searchMode === 'adaptive-1-to-4';
    if (
      !validRoute ||
      !validLanguage ||
      !validMode ||
      typeof profile.scale !== 'number' ||
      !Number.isFinite(profile.scale) ||
      profile.scale <= 0 ||
      typeof profile.bias !== 'number' ||
      !Number.isFinite(profile.bias) ||
      typeof profile.threshold !== 'number' ||
      !Number.isFinite(profile.threshold) ||
      profile.threshold < 0 ||
      profile.threshold > 1 ||
      (profile.route === 'code' && profile.language !== 'en')
    ) {
      return false;
    }
    const key = `${profile.route}:${profile.language}:${profile.searchMode}`;
    if (keys.has(key)) return false;
    keys.add(key);
  }
  const required = [
    ...(requiredRoutes.includes('writing')
      ? [
          'writing:zh:fixed-1',
          'writing:zh:fixed-4',
          'writing:zh:adaptive-1-to-4',
          'writing:en:fixed-1',
          'writing:en:fixed-4',
          'writing:en:adaptive-1-to-4',
        ]
      : []),
    ...(requiredRoutes.includes('code')
      ? ['code:en:fixed-1', 'code:en:fixed-4', 'code:en:adaptive-1-to-4']
      : []),
  ];
  return keys.size === required.length && required.every((key) => keys.has(key));
}

function isOneUnitTriggerPolicy(value: unknown): value is PublicV25OneUnitTriggerPolicy {
  if (!isRecord(value) || !isRecord(value.modelScoreFloors)) return false;
  return (
    value.kind === 'g0-strong-terminator-plus-model-score-v1' &&
    value.englishStrongTerminators === '.!?' &&
    value.chineseStrongTerminators === '。！？：；.!?;:' &&
    isRate(value.modelScoreFloors.en) &&
    isRate(value.modelScoreFloors.zh)
  );
}

function hasValidTrainingPolicy(
  manifest: Record<string, unknown>,
  training: Record<string, unknown>,
): boolean {
  if (training.licenseAuditPassed === true) {
    return manifest.distributionPolicy === undefined && training.datasetRecipe === undefined;
  }
  const v25JointRuntime =
    manifest.distributionPolicy === 'local-research-only' &&
    manifest.matrixId === '32m-q4' &&
    manifest.parameterCount === 32_000_000 &&
    manifest.quantization === 'q4' &&
    training.datasetRecipe === 'v25-contract-first-short-ghost-v1' &&
    manifest.engine === PUBLIC_V25_JOINT_ENGINE_ID &&
    manifest.route === 'joint';
  if (v25JointRuntime) return true;
  const v25OneUnitWritingRuntime =
    manifest.distributionPolicy === 'local-research-only' &&
    manifest.matrixId === '32m-q4' &&
    manifest.parameterCount === 32_000_000 &&
    manifest.quantization === 'q4' &&
    training.datasetRecipe === 'v25-one-unit-writing-eos-v2' &&
    manifest.engine === PUBLIC_V25_ONE_UNIT_WRITING_ENGINE_ID &&
    manifest.route === 'writing';
  if (v25OneUnitWritingRuntime) {
    const evaluationOnlyRelease =
      training.licenseAuditPassed === false &&
      manifest.lifecycle === 'trained' &&
      manifest.evaluationOnly === true &&
      manifest.runtimeEligible === true &&
      manifest.releaseEligible === false &&
      manifest.releaseEvidence === undefined;
    const canonicalRelease =
      manifest.lifecycle === 'releaseEligible' &&
      manifest.evaluationOnly === false &&
      manifest.runtimeEligible === true &&
      manifest.releaseEligible === true &&
      typeof manifest.releaseEvidence === 'object' &&
      manifest.releaseEvidence !== null;
    // Integration release: shipped by an explicit integration decision instead
    // of the publisher pipeline. No release evidence exists and none may be
    // fabricated; the license audit remains unpassed and is reported as such.
    const integrationRelease =
      manifest.lifecycle === 'integrationRelease' &&
      manifest.evaluationOnly === false &&
      manifest.runtimeEligible === true &&
      manifest.releaseEligible === true &&
      manifest.releaseEvidence === undefined;
    return evaluationOnlyRelease || canonicalRelease || integrationRelease;
  }
  return (
    training.licenseAuditPassed === false &&
    manifest.distributionPolicy === 'local-research-only' &&
    manifest.matrixId === '32m-q4' &&
    manifest.parameterCount === 32_000_000 &&
    manifest.quantization === 'q4' &&
    manifest.lifecycle === 'trained' &&
    manifest.evaluationOnly === true &&
    manifest.runtimeEligible === true &&
    manifest.releaseEligible === false &&
    manifest.releaseEvidence === undefined &&
    training.datasetRecipe === 'v25-contract-first-short-ghost-v1' &&
    manifest.engine === PUBLIC_V25_JOINT_ENGINE_ID &&
    manifest.route === 'joint'
  );
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
  if (manifest.lifecycle === 'integrationRelease') {
    return (
      manifest.evaluationOnly === false &&
      manifest.runtimeEligible === true &&
      manifest.releaseEligible === true &&
      manifest.releaseEvidence === undefined
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

function isAsset(value: unknown, requireDigest = true): value is PublicFreeDecoderAsset {
  if (!isRecord(value)) return false;
  return (
    typeof value.file === 'string' &&
    /^[a-z0-9][a-z0-9._-]{0,127}$/u.test(value.file) &&
    !value.file.includes('..') &&
    typeof value.sha256 === 'string' &&
    (!requireDigest || /^[a-f0-9]{64}$/u.test(value.sha256)) &&
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
