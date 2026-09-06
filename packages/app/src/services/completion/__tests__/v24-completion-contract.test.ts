import { describe, expect, it } from 'vitest';
import {
  createV24CacheIdentityKey,
  parseWritingMtpManifest,
  searchAdaptiveBeamThresholds,
  shouldEscalateAdaptiveBeam,
} from '../v24-completion-contract';

describe('V2.4 completion contracts', () => {
  it('binds cache identity to every isolation dimension without using note text', () => {
    const key = createV24CacheIdentityKey({
      candidateId: 'candidate-a',
      modelSha256: 'a'.repeat(64),
      tokenizerSha256: 'b'.repeat(64),
      contextProtocol: 'writing-capsule-v2',
      route: 'writing',
      language: 'en',
      workspaceScope: 'workspace-a',
      editorSessionId: 'editor-a',
      documentSessionId: 'document-a',
    });

    expect(key).toContain('candidate-a');
    expect(key).toContain('document-a');
    expect(key).not.toContain('plain note');
    expect(key).not.toContain('\\n');
  });

  it('escalates on low probability or a narrow top-two margin', () => {
    const thresholds = { floor: 0.3, marginFloor: 0.2 } as const;
    expect(shouldEscalateAdaptiveBeam(0.29, 0.1, thresholds)).toBe(true);
    expect(shouldEscalateAdaptiveBeam(0.8, 0.7, thresholds)).toBe(true);
    expect(shouldEscalateAdaptiveBeam(0.8, 0.5, thresholds)).toBe(false);
  });

  it('selects a threshold only when the calibration constraints are feasible', () => {
    const observations = Array.from({ length: 20 }, (_, index) => ({
      top1Probability: index < 4 ? 0.25 : 0.8,
      top2Probability: index < 4 ? 0.24 : 0.1,
      fixedBeam1Usable: index >= 4,
      fixedBeam4Usable: true,
      p90Ms: index < 4 ? 90 : 50,
    }));
    expect(searchAdaptiveBeamThresholds(observations)).toEqual(
      expect.objectContaining({ floor: expect.any(Number), marginFloor: expect.any(Number) }),
    );
  });

  it('rejects an MTP manifest outside the fixed format and parameter budgets', () => {
    const value = {
      schema: 'jotluck.autocomplete.public-v2.4-writing-mtp.v1',
      format: 'JLFDQ05',
      engine: 'public-v2.4-writing-mtp-v1',
      candidateId: 'writing-mtp-2',
      candidateArtifactSha256: 'c'.repeat(64),
      route: 'writing',
      blockSize: 2,
      modelSha256: 'a'.repeat(64),
      tokenizerSha256: 'b'.repeat(64),
      parameterCount: 32_000_000,
      additionalParameterCount: 600_000,
      staticAssetBytes: 20 * 1024 * 1024,
      adaptiveThresholds: { floor: 0.3, marginFloor: 0.2 },
      evaluationOnly: true,
    };
    expect(parseWritingMtpManifest(value).format).toBe('JLFDQ05');
    expect(() => parseWritingMtpManifest({ ...value, additionalParameterCount: 600_001 })).toThrow(
      /budget/u,
    );
  });
});
