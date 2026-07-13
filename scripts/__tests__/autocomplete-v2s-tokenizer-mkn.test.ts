import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { trainG0Gate, trainG1Gate, type GateSample } from '../autocomplete-v2s/gate';
import {
  encodeMknModel,
  pruneMknToNestedBudgets,
  trainModifiedKneserNey,
  type MknModel,
} from '../autocomplete-v2s/mkn';
import {
  decodeWithTokenizer,
  encodeWithTokenizer,
  trainTokenizer,
} from '../autocomplete-v2s/tokenizer';

describe('V2S tokenizers, MKN and gates', () => {
  it.each(['bpe', 'unigram'] as const)(
    'trains deterministic boundary-aware %s tokenizers per language',
    (kind) => {
      const english = [
        'Meeting notes are ready.',
        'Meeting owners are ready.',
        'Notes remain local.',
      ];
      const chinese = ['会议记录已经整理。', '会议负责人已经确认。', '笔记保持离线。'];
      const enA = trainTokenizer(english, { kind, language: 'en', vocabularyLimit: 48 });
      const enB = trainTokenizer(english, { kind, language: 'en', vocabularyLimit: 48 });
      const zh = trainTokenizer(chinese, { kind, language: 'zh', vocabularyLimit: 48 });
      expect(enA).toEqual(enB);
      expect(enA.vocabulary.length).toBeLessThanOrEqual(48);
      expect(zh.vocabulary.length).toBeLessThanOrEqual(48);
      expect(decodeWithTokenizer(enA, encodeWithTokenizer(enA, english[0]!))).toBe(english[0]);
      expect(decodeWithTokenizer(zh, encodeWithTokenizer(zh, chinese[0]!))).toBe(chinese[0]);
      expect(enA.vocabulary.some((piece) => piece.startsWith('▁'))).toBe(true);
    },
  );

  it('keeps exact BPE count tie-breaking independent of document order', () => {
    const texts = [' abab', ' abab', ' acac', ' acac'];
    const forward = trainTokenizer(texts, {
      kind: 'bpe',
      language: 'en',
      vocabularyLimit: 24,
    });
    const reverse = trainTokenizer([...texts].reverse(), {
      kind: 'bpe',
      language: 'en',
      vocabularyLimit: 24,
    });

    expect(forward).toEqual(reverse);
    expect(forward.merges).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'ab'],
      ['c', 'ac'],
      ['▁a', 'bab'],
      ['▁a', 'cac'],
    ]);
  });

  it('trains a 4096-limit BPE tokenizer over at least 1 MiB without a full-rescan stall', () => {
    const encoder = new TextEncoder();
    const texts: string[] = [];
    let inputBytes = 0;
    for (let index = 0; inputBytes < 1024 * 1024; index += 1) {
      const identifier = (index % 12_000).toString(36).padStart(6, '0');
      const text = ` Code ${identifier} task ${identifier} keeps note ${identifier} review ${identifier}.`;
      texts.push(text);
      inputBytes += encoder.encode(text).byteLength;
    }

    const startedAt = performance.now();
    const model = trainTokenizer(texts, {
      kind: 'bpe',
      language: 'en',
      vocabularyLimit: 4096,
    });
    const elapsedMs = performance.now() - startedAt;

    expect(inputBytes).toBeGreaterThanOrEqual(1024 * 1024);
    expect(model.vocabulary).toHaveLength(4096);
    expect(model.merges.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(10_000);
  });

  it.each(['bpe', 'unigram'] as const)(
    'keeps Python and TypeScript %s tokenization byte-for-byte aligned',
    (kind) => {
      const texts = ['Project plan\r\nreview owner_2 — ✅', '项目计划\r\n复核负责人_2 — ✅'];
      for (const [index, text] of texts.entries()) {
        const language = index === 0 ? 'en' : 'zh';
        const model = trainTokenizer(texts, {
          kind,
          language,
          vocabularyLimit: 96,
        });
        const subprocess = spawnSync(
          'python',
          [path.resolve(import.meta.dirname, '../autocomplete-v2s/tokenizer_reference.py')],
          {
            input: JSON.stringify({ model, text }),
            encoding: 'utf8',
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
          },
        );
        expect(subprocess.status, subprocess.stderr).toBe(0);
        expect(JSON.parse(subprocess.stdout)).toEqual({
          tokenIds: encodeWithTokenizer(model, text),
        });
      }
    },
  );

  it('trains 2-5 order MKN with integer quantization and nested exact budgets', () => {
    const model = trainModifiedKneserNey({
      sequences: [
        [1, 4, 5, 6, 2],
        [1, 4, 5, 7, 2],
        [1, 4, 5, 6, 2],
      ],
      vocabularySize: 8,
      maxOrder: 5,
    });
    expect(model.maxOrder).toBe(5);
    expect(model.predictions.every((entry) => Number.isInteger(entry.probabilityQ16))).toBe(true);
    const fullBytes = encodeMknModel(model).byteLength;
    const variants = pruneMknToNestedBudgets(model, [160, fullBytes]);
    expect(variants[0]!.encoded.byteLength).toBeLessThanOrEqual(160);
    expect(variants[1]!.encoded.byteLength).toBeLessThanOrEqual(fullBytes);
    const retainedOrders = new Set(variants[0]!.model.predictions.map((entry) => entry.order));
    expect(retainedOrders).toContain(2);
    expect(retainedOrders.size).toBeGreaterThanOrEqual(2);
    for (const backoff of variants[0]!.model.backoffs) {
      const localMass = variants[0]!.model.predictions
        .filter(
          (entry) =>
            entry.order === backoff.order && entry.context.join(',') === backoff.context.join(','),
        )
        .reduce((sum, entry) => sum + entry.probabilityQ16, 0);
      expect(localMass + backoff.weightQ16).toBe(65_535);
    }
    const smallKeys = new Set(
      variants[0]!.model.predictions.map(
        (entry) => `${entry.order}:${entry.context}:${entry.token}`,
      ),
    );
    const largeKeys = new Set(
      variants[1]!.model.predictions.map(
        (entry) => `${entry.order}:${entry.context}:${entry.token}`,
      ),
    );
    expect([...smallKeys].every((key) => largeKeys.has(key))).toBe(true);
  });

  it('prunes 5000 records in one linear budget scan within the 200ms target', () => {
    const predictions = Array.from({ length: 5000 }, (_, index) => ({
      order: 2,
      context: [index],
      token: index + 1,
      count: 1 + (index % 5),
      probabilityQ16: 1024 + (index % 1024),
    }));
    const model: MknModel = {
      schema: 'jotluck.autocomplete.v2s-mkn.v1',
      vocabularySize: 5001,
      maxOrder: 2,
      discounts: { '2': { d1: 0.75, d2: 1, d3Plus: 1.25 } },
      unigramQ16: new Array(5001).fill(1),
      predictions,
      backoffs: predictions.map((entry) => ({
        order: 2,
        context: entry.context,
        weightQ16: 512,
      })),
    };
    const startedAt = performance.now();
    const variants = pruneMknToNestedBudgets(model, [60_000, 120_000]);
    const elapsedMs = performance.now() - startedAt;
    expect(elapsedMs).toBeLessThanOrEqual(200);
    expect(variants[0]!.encoded.byteLength).toBeLessThanOrEqual(60_000);
    expect(variants[1]!.encoded.byteLength).toBeLessThanOrEqual(120_000);
    expect(variants[1]!.model.predictions.length).toBeGreaterThanOrEqual(
      variants[0]!.model.predictions.length,
    );
  });

  it('provides G0 and 16-hidden INT8 G1 formats without treating bank misses as silence', () => {
    const samples: GateSample[] = [
      {
        features: [1, 0.8, 1, 0.5, 0.6, 1, 0, 0, 1, 0],
        label: 'show',
        group: 'fit-show-zh',
        language: 'zh',
        expectedBehavior: 'complete',
        calibrationRole: 'fit',
      },
      {
        features: [0.1, 0, 0.4, 0.1, 0.2, 0, 1, 0, 0, 1],
        label: 'silence',
        group: 'fit-silence-en',
        language: 'en',
        expectedBehavior: 'silence',
        calibrationRole: 'fit',
      },
      {
        features: [0, 0, 0, 0, 0, 0, 0, 1, 1, 0],
        label: 'bank-miss',
        group: 'calibration-bank-miss-zh',
        language: 'zh',
        expectedBehavior: 'complete',
        calibrationRole: 'calibration',
      },
    ];
    const g0 = trainG0Gate(samples, { epochs: 3 });
    const g0Repeat = trainG0Gate(samples, { epochs: 3 });
    const g1 = trainG1Gate(samples, { epochs: 3, seed: 7 });
    expect(g0.trainingExamples).toBe(2);
    expect(g0.excludedBankMisses).toBe(1);
    expect(g0.kind).toBe('g0-rules');
    expect(g0.featureSchema).toBe('v2s-gate-features-v1');
    expect(g0).toEqual(g0Repeat);
    expect(g0.weightScale).toBeGreaterThan(0);
    expect(g0.calibration).toMatchObject({
      status: 'calibration-failed',
      metrics: { examples: 1 },
    });
    const g0Score = (features: readonly number[]) => {
      const linear = features.reduce(
        (sum, feature, index) => sum + feature * g0.ruleWeightsQ16[index]! * g0.weightScale,
        g0.biasQ16 * g0.biasScale,
      );
      return 1 / (1 + Math.exp(-linear));
    };
    expect(g0Score(samples[0]!.features)).toBeGreaterThan(g0Score(samples[1]!.features));
    expect(g1.kind).toBe('g1-mlp16-int8');
    expect(g1.hiddenSize).toBe(16);
    expect(g1.inputWeightsQ8).toHaveLength(16 * 10);
    expect(g1.showThresholdQ16).toBeGreaterThanOrEqual(0);
    expect(g1.inputWeightsQ8.every((value) => value >= -128 && value <= 127)).toBe(true);
  });

  it('calibrates quantized G0/G1 on disjoint groups and counts bank misses in thresholds', () => {
    const high = [1, 0.9, 1, 0.8, 0.5, 1, 0, 0, 1, 0];
    const low = [0.05, 0.01, 0.2, 0.2, 0.2, 0, 1, 0, 0, 1];
    const samples: GateSample[] = [
      gateSample('fit-zh-show', 'zh', 'show', 'fit', high),
      gateSample('fit-en-show', 'en', 'show', 'fit', high),
      gateSample('fit-zh-silence', 'zh', 'silence', 'fit', low),
      gateSample('fit-en-silence', 'en', 'silence', 'fit', low),
    ];
    for (const language of ['zh', 'en'] as const) {
      const showCount = language === 'zh' ? 4 : 3;
      const bankMissCount = language === 'zh' ? 1 : 2;
      for (let index = 0; index < showCount; index += 1) {
        samples.push(
          gateSample(`cal-${language}-show-${index}`, language, 'show', 'calibration', high),
        );
      }
      for (let index = 0; index < bankMissCount; index += 1) {
        samples.push(
          gateSample(`cal-${language}-bank-${index}`, language, 'bank-miss', 'calibration', low),
        );
      }
      for (let index = 0; index < 5; index += 1) {
        samples.push(
          gateSample(`cal-${language}-silence-${index}`, language, 'silence', 'calibration', low),
        );
      }
    }

    const g0 = trainG0Gate(samples, { epochs: 40 });
    const g1 = trainG1Gate(samples, { epochs: 40, seed: 7 });
    for (const gate of [g0, g1]) {
      expect(gate.trainingExamples).toBe(4);
      expect(gate.excludedBankMisses).toBe(3);
      expect(gate.calibration).toMatchObject({
        status: 'passed',
        failureReasons: [],
        metrics: {
          examples: 20,
          triggers: 7,
          usable: 7,
          silenceFalseTriggers: 0,
          byLanguage: {
            zh: { examples: 10, usable: 4, absoluteUsableRate: 0.4 },
            en: { examples: 10, usable: 3, absoluteUsableRate: 0.3 },
          },
        },
      });
    }
  });

  it('rejects a document group that crosses fit and calibration roles', () => {
    expect(() =>
      trainG0Gate([
        gateSample('shared-group', 'zh', 'show', 'fit', [1, 1, 1, 1, 1, 1, 0, 0, 1, 0]),
        gateSample(
          'shared-group',
          'zh',
          'bank-miss',
          'calibration',
          [0, 0, 0, 0, 0, 0, 1, 0, 1, 0],
        ),
      ]),
    ).toThrow(/crosses calibration roles/u);
  });
});

function gateSample(
  group: string,
  language: GateSample['language'],
  label: GateSample['label'],
  calibrationRole: GateSample['calibrationRole'],
  features: number[],
): GateSample {
  return {
    features: [...features],
    label,
    group,
    language,
    expectedBehavior: label === 'silence' ? 'silence' : 'complete',
    calibrationRole,
  };
}
