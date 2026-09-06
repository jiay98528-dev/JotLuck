import {
  PUBLIC_FREE_DECODER_ENGINE_ID,
  PUBLIC_FREE_DECODER_MANIFEST_SCHEMA,
  PUBLIC_V25_JOINT_ENGINE_ID,
  PUBLIC_V25_JOINT_MANIFEST_SCHEMA,
  PUBLIC_V25_ONE_UNIT_WRITING_ENGINE_ID,
  PUBLIC_V25_VISIBILITY_CALIBRATION_SCHEMA,
  type PublicFreeDecoderManifest,
} from '../public-free-decoder-contract';

export function decoderManifest(): PublicFreeDecoderManifest {
  return {
    schema: PUBLIC_FREE_DECODER_MANIFEST_SCHEMA,
    schemaVersion: 1,
    engine: PUBLIC_FREE_DECODER_ENGINE_ID,
    candidateId: '16m-q4-seed-1',
    candidateArtifactSha256: 'c'.repeat(64),
    lifecycle: 'oraclePassed',
    evaluationOnly: true,
    runtimeEligible: true,
    releaseEligible: false,
    parameterCount: 16_000_000,
    quantization: 'q4',
    tokenizer: { kind: 'unigram', vocabularySize: 8_000, byteFallback: true, bilingual: true },
    context: { maximumTokens: 256 },
    output: {
      chineseMaximumCodePoints: 8,
      englishMaximumCodePoints: 12,
      preserveCompleteEnglishWord: true,
    },
    training: { cleanedPoolBytes: 128 * 1024 * 1024, licenseAuditPassed: true },
    oraclePrecheck: {
      checkpoints: 200,
      oracleAt8: 0.45,
      oracleAt32: 0.55,
      chineseOracleAt8: 0.4,
      englishOracleAt8: 0.4,
      passed: true,
    },
    assets: {
      model: { file: 'model.q4.bin', sha256: 'a'.repeat(64), bytes: 8 * 1024 * 1024 },
      tokenizer: { file: 'tokenizer.runtime.json', sha256: 'b'.repeat(64), bytes: 512 * 1024 },
    },
    runtimeStaticDeltaBytes: 2 * 1024 * 1024,
    measuredPeakMemoryBytes: 128 * 1024 * 1024,
  };
}

export function v25JointManifest(): PublicFreeDecoderManifest {
  return {
    ...decoderManifest(),
    schema: PUBLIC_V25_JOINT_MANIFEST_SCHEMA,
    engine: PUBLIC_V25_JOINT_ENGINE_ID,
    route: 'joint',
    candidateId: 'v25-dense-local-evaluation',
    lifecycle: 'trained',
    parameterCount: 32_000_000,
    matrixId: '32m-q4',
    distributionPolicy: 'local-research-only',
    output: {
      chineseMaximumCodePoints: 32,
      englishMaximumCodePoints: 32,
      preserveCompleteEnglishWord: false,
    },
    training: {
      cleanedPoolBytes: 0,
      licenseAuditPassed: false,
      datasetRecipe: 'v25-contract-first-short-ghost-v1',
    },
    oraclePrecheck: {
      checkpoints: 0,
      oracleAt8: 0,
      oracleAt32: 0,
      chineseOracleAt8: 0,
      englishOracleAt8: 0,
      passed: false,
    },
    visibilityCalibration: {
      schema: PUBLIC_V25_VISIBILITY_CALIBRATION_SCHEMA,
      hardwareProfile: 'test-hardware',
      beamThresholds: { floor: 0.3, marginFloor: 0.2 },
      profiles: [
        ...(['zh', 'en'] as const).flatMap((language) =>
          (['fixed-1', 'fixed-4', 'adaptive-1-to-4'] as const).map((searchMode) => ({
            route: 'writing' as const,
            language,
            searchMode,
            scale: 1,
            bias: 0,
            threshold: 0.5,
          })),
        ),
        ...(['fixed-1', 'fixed-4', 'adaptive-1-to-4'] as const).map((searchMode) => ({
          route: 'code' as const,
          language: 'en' as const,
          searchMode,
          scale: 1,
          bias: 0,
          threshold: 0.5,
        })),
      ],
    },
  };
}

export function v25OneUnitWritingManifest(): PublicFreeDecoderManifest {
  return {
    ...decoderManifest(),
    schema: PUBLIC_V25_JOINT_MANIFEST_SCHEMA,
    engine: PUBLIC_V25_ONE_UNIT_WRITING_ENGINE_ID,
    route: 'writing',
    candidateId: 'v25-one-unit-writing-q4-test',
    lifecycle: 'trained',
    parameterCount: 32_000_000,
    matrixId: '32m-q4',
    distributionPolicy: 'local-research-only',
    tokenizer: {
      kind: 'unigram',
      vocabularySize: 12_000,
      byteFallback: true,
      bilingual: true,
    },
    output: {
      chineseMaximumCodePoints: 4,
      englishMaximumCodePoints: 24,
      preserveCompleteEnglishWord: true,
    },
    training: {
      cleanedPoolBytes: 0,
      licenseAuditPassed: false,
      datasetRecipe: 'v25-one-unit-writing-eos-v2',
    },
    oraclePrecheck: {
      checkpoints: 0,
      oracleAt8: 0,
      oracleAt32: 0,
      chineseOracleAt8: 0,
      englishOracleAt8: 0,
      passed: false,
    },
    assets: {
      model: { file: 'model.q4.decoder.bin', sha256: 'a'.repeat(64), bytes: 18 * 1024 * 1024 },
      tokenizer: { file: 'tokenizer.runtime.json', sha256: 'b'.repeat(64), bytes: 512 * 1024 },
    },
    runtimeStaticDeltaBytes: 0,
    measuredPeakMemoryBytes: 0,
    completionUnit: 'one-lexical-unit',
    triggerPolicy: {
      kind: 'g0-strong-terminator-plus-model-score-v1',
      englishStrongTerminators: '.!?',
      chineseStrongTerminators: '。！？：；.!?;:',
      modelScoreFloors: { en: 0.0745673611471674, zh: 0.0842532026246352 },
    },
    visibilityCalibration: {
      schema: PUBLIC_V25_VISIBILITY_CALIBRATION_SCHEMA,
      hardwareProfile: 'diagnostic-g0-rule-r25',
      beamThresholds: { floor: 0, marginFloor: 0 },
      profiles: (['zh', 'en'] as const).flatMap((language) =>
        (['fixed-1', 'fixed-4', 'adaptive-1-to-4'] as const).map((searchMode) => ({
          route: 'writing' as const,
          language,
          searchMode,
          scale: 1,
          bias: 0,
          threshold: language === 'en' ? 0.0745673611471674 : 0.0842532026246352,
        })),
      ),
    },
  };
}
