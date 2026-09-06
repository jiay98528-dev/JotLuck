import { describe, expect, it } from 'vitest';
import { evaluatePredictionQualityGate } from '../quality-gate';

describe('evaluatePredictionQualityGate', () => {
  it('returns the same accepted text used by the runtime facade', () => {
    const evaluation = evaluatePredictionQualityGate(
      { text: ' needs review soon', confidence: 0.7, from: 12, syntaxType: 'word-en' },
      12,
      'The project ',
      12,
    );

    expect(evaluation).toMatchObject({ reason: null, result: { text: ' needs' } });
  });

  it('exposes stable rejection reasons for offline evaluation', () => {
    expect(
      evaluatePredictionQualityGate(
        { text: '中文', confidence: 0.8, from: 12 },
        12,
        'English note',
        12,
      ),
    ).toMatchObject({ result: null, reason: 'language-mismatch' });
    expect(
      evaluatePredictionQualityGate({ text: '继续', confidence: 0.8, from: 5 }, 5, '完成。', 12),
    ).toMatchObject({ result: null, reason: 'sentence-already-ended' });
  });

  it('applies the frozen V2.5 one-unit trigger only to V2.5 Writing', () => {
    const v25Writing = {
      text: ' next',
      confidence: 0.8,
      rawScore: 0.1,
      from: 5,
      v25Validation: {
        validatorId: 'jotluck-v2.5-route-validator-v5' as const,
        validatorVersion: 5 as const,
        route: 'writing' as const,
        language: 'en',
        visibilityThreshold: 0.07,
      },
    };

    expect(evaluatePredictionQualityGate(v25Writing, 5, 'Done.', 12)).toMatchObject({
      result: null,
      reason: 'sentence-already-ended',
    });
    expect(
      evaluatePredictionQualityGate({ ...v25Writing, rawScore: 0.07 }, 12, 'The project ', 12),
    ).toMatchObject({ result: null, reason: 'low-v25-model-score' });
    expect(
      evaluatePredictionQualityGate(
        {
          ...v25Writing,
          text: '继续',
          rawScore: 0.09,
          v25Validation: { ...v25Writing.v25Validation, language: 'zh' },
        },
        3,
        '所以，',
        12,
      ),
    ).toMatchObject({ reason: null, result: { text: '继续' } });

    expect(
      evaluatePredictionQualityGate({ text: ' next', confidence: 0.8, from: 5 }, 5, 'Done.', 12),
    ).toMatchObject({ reason: null });
  });
});
