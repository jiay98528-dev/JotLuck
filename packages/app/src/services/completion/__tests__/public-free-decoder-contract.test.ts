import { describe, expect, it } from 'vitest';
import {
  PUBLIC_FREE_DECODER_ENGINE_ID,
  parsePublicFreeDecoderManifest,
} from '../public-free-decoder-contract';
import {
  decoderManifest,
  v25JointManifest,
  v25OneUnitWritingManifest,
} from './decoder-manifest.fixture';

describe('public free decoder manifest', () => {
  it('accepts only the frozen matrix and passing Oracle contract', () => {
    expect(parsePublicFreeDecoderManifest(decoderManifest(), 2_048)).toMatchObject({
      engine: PUBLIC_FREE_DECODER_ENGINE_ID,
      parameterCount: 16_000_000,
      quantization: 'q4',
    });
  });

  it('fails before runtime when Oracle or static budgets are missed', () => {
    const weak = decoderManifest();
    weak.oraclePrecheck.oracleAt8 = 0.449;
    expect(() => parsePublicFreeDecoderManifest(weak, 2_048)).toThrow('contract');

    const oversized = decoderManifest();
    oversized.assets.model.bytes = 23 * 1024 * 1024;
    expect(() => parsePublicFreeDecoderManifest(oversized, 2_048)).toThrow('24 MiB');
  });

  it('loads a trained evaluation candidate without fabricating Oracle evidence', () => {
    const trained = decoderManifest();
    trained.lifecycle = 'trained';
    trained.oraclePrecheck = {
      checkpoints: 0,
      oracleAt8: 0,
      oracleAt32: 0,
      chineseOracleAt8: 0,
      englishOracleAt8: 0,
      passed: false,
    };
    expect(parsePublicFreeDecoderManifest(trained, 2_048).lifecycle).toBe('trained');
  });

  it('loads a V2.5 joint Dense model from its real runtime contract', () => {
    const trained = v25JointManifest();

    const parsed = parsePublicFreeDecoderManifest(trained, 2_048);
    expect(parsed.evaluationOnly).toBe(true);
    expect(parsed.releaseEligible).toBe(false);

    trained.releaseEligible = true;
    expect(parsePublicFreeDecoderManifest(trained, 2_048).releaseEligible).toBe(true);
  });

  it('does not turn V2.5 diagnostic names or digest metadata into runtime gates', () => {
    const trained = v25JointManifest();
    trained.candidateId = '';
    trained.candidateArtifactSha256 = 'advisory-only';
    trained.assets.model.sha256 = '';
    trained.assets.tokenizer.sha256 = 'not-a-digest';
    trained.visibilityCalibration!.schema = 'renamed-diagnostic-schema' as never;
    trained.visibilityCalibration!.hardwareProfile = '';
    trained.visibilityCalibration!.beamThresholds = {
      floor: 0.287,
      marginFloor: 0.173,
    };
    trained.schema = 'renamed-diagnostic-schema' as never;
    trained.schemaVersion = 999 as never;
    trained.training.datasetRecipe = 'renamed-recipe' as never;
    trained.training.cleanedPoolBytes = Number.MAX_SAFE_INTEGER;
    trained.runtimeStaticDeltaBytes = Number.MAX_SAFE_INTEGER;
    trained.measuredPeakMemoryBytes = Number.MAX_SAFE_INTEGER;

    expect(parsePublicFreeDecoderManifest(trained, 2_048)).toMatchObject({
      engine: 'public-v2.5-joint-v1',
      route: 'joint',
    });
  });

  it('rejects a V2.5 joint runtime without complete visibility calibration', () => {
    const trained = v25JointManifest();
    trained.visibilityCalibration!.profiles = trained.visibilityCalibration!.profiles.slice(1);
    expect(() => parsePublicFreeDecoderManifest(trained, 2_048)).toThrow('contract');
  });

  it('accepts only the 12K writing-only one-unit diagnostic contract', () => {
    const manifest = v25OneUnitWritingManifest();
    expect(parsePublicFreeDecoderManifest(manifest, 2_048)).toMatchObject({
      engine: 'public-v2.5-one-unit-writing-v1',
      route: 'writing',
      completionUnit: 'one-lexical-unit',
    });

    manifest.tokenizer.vocabularySize = 8_000;
    expect(() => parsePublicFreeDecoderManifest(manifest, 2_048)).toThrow('contract');
  });

  it('rejects the stopped V2R/V2S identities and cache-era shapes', () => {
    for (const engine of ['public-v2s-mkn-v1', 'public-phrase-transformer-v1']) {
      expect(() => parsePublicFreeDecoderManifest({ ...decoderManifest(), engine }, 2_048)).toThrow(
        'contract',
      );
    }
  });

  it('accepts a release lifecycle only with dual-final and GUI hash bindings', () => {
    const release = decoderManifest();
    release.lifecycle = 'releaseEligible';
    release.evaluationOnly = false;
    release.releaseEligible = true;
    release.releaseEvidence = {
      schema: 'jotluck.autocomplete.public-free-decoder-release.v1',
      coldFinalSha256: 'c'.repeat(64),
      workspaceFinalSha256: 'd'.repeat(64),
      windowsGuiEvidenceSha256: 'e'.repeat(64),
      baselineSha256: 'f'.repeat(64),
    };
    expect(parsePublicFreeDecoderManifest(release, 2_048).releaseEligible).toBe(true);

    delete release.releaseEvidence;
    expect(() => parsePublicFreeDecoderManifest(release, 2_048)).toThrow('contract');
  });
});
