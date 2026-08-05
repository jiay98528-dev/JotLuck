import { describe, expect, it } from 'vitest';
import {
  PUBLIC_FREE_DECODER_ENGINE_ID,
  parsePublicFreeDecoderManifest,
} from '../public-free-decoder-contract';
import { decoderManifest } from './decoder-manifest.fixture';

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
