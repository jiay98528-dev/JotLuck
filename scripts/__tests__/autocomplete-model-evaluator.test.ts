import { describe, expect, it } from 'vitest';
import { serializeBaselineTables } from '../../packages/app/src/utils/word-ngram-engine';
import {
  evaluateAutocompleteModel,
  hasModelParseLongTask,
  isMixedCandidate,
  percentile,
} from '../autocomplete-model-evaluator';
import type { FormalHoldout } from '../train-baseline';

describe('autocomplete model evaluator', () => {
  it('measures raw L3, gated L3, and full-stack outcomes independently', async () => {
    const character = new Map([
      ['项目计划', new Map([['继', 4000]])],
      ['目计划继', new Map([['续', 4000]])],
      ['计划继续', new Map([['推', 4000]])],
      ['划继续推', new Map([['进', 4000]])],
    ]);
    const serialized = serializeBaselineTables({ character, word: new Map() });
    const holdout: FormalHoldout = {
      schemaVersion: 2,
      datasetId: 'unit-holdout',
      frozenAt: '2026-07-11T00:00:00.000Z',
      cases: [
        {
          id: 'zh-unit',
          language: 'zh',
          category: 'unit',
          text: '项目计划继续推进。',
          checkpoints: [
            {
              id: 'zh-unit-complete',
              cursorOffset: 4,
              expectedSuffix: '继续推进。',
              expectedBehavior: 'complete',
            },
            {
              id: 'zh-unit-silence',
              cursorOffset: 9,
              expectedSuffix: '',
              expectedBehavior: 'silence',
            },
          ],
        },
      ],
    };

    const result = await evaluateAutocompleteModel({ serialized, countScale: 1000, holdout });

    expect(result.model).toMatchObject({ characterEntries: 4, wordEntries: 0, countScale: 1000 });
    expect(result.model.parse.longTasksOver50Ms).toBe(0);
    expect(result.holdout).toMatchObject({ opportunities: 2, completeOpportunities: 1 });
    expect(result.l3Raw).toMatchObject({ contextHits: 1, top1Hits: 1, top3Hits: 1 });
    expect(result.l3Raw).toMatchObject({
      top1Rate: 1,
      top3Rate: 1,
      top8Hits: 1,
      top8Rate: 1,
      oracleAt8Hits: 1,
      oracleAt8Rate: 1,
    });
    expect(result.l3Only).toMatchObject({ triggers: 1, usable: 1, falseTriggers: 0 });
    expect(result.fullStack).toMatchObject({
      mixedOpportunities: 0,
      fallbackRate: 0,
      timeoutRate: 0,
    });
    expect(result.fullStack.allRequestP90Ms).toBeGreaterThanOrEqual(0);
    expect(result.fullStack.visiblePredictionP90Ms).toBeGreaterThanOrEqual(0);
    expect(result.verdicts.governance).toMatchObject({ status: 'fail' });
    expect(result.fullStack).toMatchObject({ triggers: 1, usable: 1, falseTriggers: 0 });
    expect(result.fullStack.attribution['ngram:l3']).toBe(1);
  });

  it('scans the entire candidate text for language mixing', () => {
    expect(isMixedCandidate('，the result', 'zh')).toBe(true);
    expect(isMixedCandidate('result，结果', 'en')).toBe(true);
    expect(isMixedCandidate('，结果继续', 'zh')).toBe(false);
  });

  it('reports p90 across all requests independently from visible predictions', () => {
    expect(percentile([1, 2, 3, 100], 0.9)).toBe(100);
    expect(percentile([], 0.9)).toBe(0);
  });

  it('fails runtime safety when a parse chunk exceeds 50ms', () => {
    expect(
      hasModelParseLongTask({
        totalMs: 80,
        maxChunkMs: 51,
        chunks: 2,
        lines: 10,
        longTasksOver50Ms: 1,
      }),
    ).toBe(true);
    expect(
      hasModelParseLongTask({
        totalMs: 80,
        maxChunkMs: 40,
        chunks: 2,
        lines: 10,
        longTasksOver50Ms: 0,
      }),
    ).toBe(false);
  });
});
