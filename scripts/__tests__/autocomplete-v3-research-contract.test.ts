import { describe, expect, it } from 'vitest';
import {
  V3_RESEARCH_MATRIX,
  assessV3PaidValue,
  type V3ResearchReport,
} from '../autocomplete-v3-research/contract';

function report(): V3ResearchReport {
  return {
    schema: 'jotluck.autocomplete.v3-paid-value-research.v1',
    engine: 'public-v3-paid-research-v1',
    candidateId: '48m-q4-c1',
    parameterCount: 48_000_000,
    quantization: 'q4',
    contextProfile: 'c1',
    contextTokens: 256,
    baseline: {
      engine: 'public-v2-free-decoder-v1',
      candidateId: '16m-q4-a',
      modelSha256: 'a'.repeat(64),
      coldFinalSha256: 'b'.repeat(64),
      workspaceFinalSha256: 'c'.repeat(64),
      coldPassed: true,
      workspacePassed: true,
    },
    cold: { v2UsableRate: 0.35, v3UsableRate: 0.44 },
    workspace: { v2UsableRate: 0.36, v3UsableRate: 0.45 },
    falseTriggerRate: 0.03,
    mixedVisibleCount: 0,
    structuredRegressionCount: 0,
    strongLocalRegressionCount: 0,
    visibleP90Ms: 130,
    incrementalMemoryBytes: 240 * 1024 * 1024,
    modelAndHostBytes: 90 * 1024 * 1024,
    dogfood: {
      tasks: 60,
      v2RetainedCharactersPerOpportunity: 10,
      v3RetainedCharactersPerOpportunity: 12,
      v2PostAcceptUndoRate: 0.08,
      v3PostAcceptUndoRate: 0.08,
    },
    researchOnly: true,
    productizationImplemented: false,
  };
}

describe('V3 paid-value research gates', () => {
  it('freezes exactly 18 bounded experiment cells', () => {
    expect(V3_RESEARCH_MATRIX).toHaveLength(18);
    expect(new Set(V3_RESEARCH_MATRIX.map((item) => item.id)).size).toBe(18);
  });

  it('only recommends a separate productization plan after every value gate passes', () => {
    expect(assessV3PaidValue(report())).toEqual({
      candidateId: '48m-q4-c1',
      passed: true,
      failures: [],
      nextStep: 'separate-productization-plan',
    });
  });

  it('stops on weak value lift or undo regression', () => {
    const weak = report();
    weak.cold.v3UsableRate = 0.42;
    weak.dogfood.v3PostAcceptUndoRate = 0.09;
    expect(assessV3PaidValue(weak)).toMatchObject({
      passed: false,
      nextStep: 'stop',
      failures: expect.arrayContaining(['cold-value-lift', 'dogfood-undo-regression']),
    });
  });
});
