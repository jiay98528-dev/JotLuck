import {
  PUBLIC_FREE_DECODER_ENGINE_ID,
  PUBLIC_FREE_DECODER_MANIFEST_SCHEMA,
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
