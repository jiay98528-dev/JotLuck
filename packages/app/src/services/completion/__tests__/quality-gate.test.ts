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
});
