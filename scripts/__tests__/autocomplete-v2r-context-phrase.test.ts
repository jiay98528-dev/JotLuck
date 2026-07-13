import { describe, expect, it } from 'vitest';
import {
  encodeUtf8ContextWindow,
  PUBLIC_CONTEXT_UTF8_BYTES,
} from '../autocomplete-v2r/context-window';
import {
  classifyEnglishCursorBoundary,
  countHanCharacters,
  extractPhraseAtCursor,
  extractPhraseVariantsAtCursor,
  isMeaningfulPhrase,
  isMixedLanguageCandidate,
  isTrainablePublicPhrase,
} from '../autocomplete-v2r/phrase-extraction';
import {
  collectPhraseCheckpoints,
  selectAbstainCheckpoint,
  selectPhraseBank,
  selectTrainingTarget,
} from '../autocomplete-v2r/training-data';
import { calculateV2RPhraseBankRepresentation } from '../autocomplete-v2r/phrase-bank-representation';
import type { V2RHoldoutV3 } from '../autocomplete-v2r/holdout-v3';

describe('V2R UTF-8 context and phrase boundary', () => {
  it('keeps the last 192 UTF-8 bytes without splitting emoji', () => {
    const document = `${'a'.repeat(190)}😀`;
    const result = encodeUtf8ContextWindow(document, document.length);

    expect(result.byteLength).toBe(PUBLIC_CONTEXT_UTF8_BYTES);
    expect(result.text).toBe(`${'a'.repeat(188)}😀`);
    expect(result.startUtf16Offset).toBe(2);
    expect(result.truncated).toBe(true);
    expect(new TextDecoder('utf-8', { fatal: true }).decode(result.bytes)).toBe(result.text);
  });

  it('rejects a CodeMirror UTF-16 cursor that splits a surrogate pair', () => {
    expect(() => encodeUtf8ContextWindow('a😀b', 2)).toThrow(/surrogate pair/u);
  });

  it('extracts an English continuation after a completed word with leading punctuation intact', () => {
    const document = 'We reviewed the plan. Next steps remain clear';
    const cursor = document.indexOf('.');

    expect(classifyEnglishCursorBoundary(document, cursor)).toBe('after-word');
    expect(extractPhraseAtCursor(document, cursor, 'en')).toBe('. Next steps');
    expect(extractPhraseVariantsAtCursor(document, cursor, 'en')).toEqual([
      '. Next steps',
      '. Next steps remain',
      '. Next steps remain clear',
    ]);
  });

  it('does not treat an in-word suffix as a complete phrase', () => {
    const document = 'The maintenance note is ready';
    const cursor = document.indexOf('maintenance') + 5;

    expect(classifyEnglishCursorBoundary(document, cursor)).toBe('inside-word');
    expect(extractPhraseAtCursor(document, cursor, 'en')).toBeNull();
  });

  it('extracts 3-12 Chinese Han characters and rejects mixed output', () => {
    const phrase = extractPhraseAtCursor('结果需要继续检查并记录所有差异以后复核。', 2, 'zh');

    expect(phrase).not.toBeNull();
    expect(countHanCharacters(phrase!)).toBeGreaterThanOrEqual(3);
    expect(countHanCharacters(phrase!)).toBeLessThanOrEqual(12);
    expect(isMeaningfulPhrase('继续检查', 'zh')).toBe(true);
    expect(isMeaningfulPhrase('继续', 'zh')).toBe(false);
    expect(isMixedLanguageCandidate('继续 check', 'zh')).toBe(true);
    expect(isMixedLanguageCandidate(' next 检查', 'en')).toBe(true);
  });

  it('collects trainable checkpoints at complete English words and Chinese code points', () => {
    expect(collectPhraseCheckpoints('The review remains ready for release.', 'en')).toContainEqual({
      cursor: 3,
      text: ' review',
    });
    expect(
      collectPhraseCheckpoints('记录需要继续检查并保存结果。', 'zh').some(
        (checkpoint) => checkpoint.cursor < 2,
      ),
    ).toBe(false);
    expect(
      collectPhraseCheckpoints('记录需要继续检查并保存结果。', 'zh').some((checkpoint) =>
        checkpoint.text.startsWith('需要'),
      ),
    ).toBe(true);
    expect(isTrainablePublicPhrase(' points', 'en')).toBe(true);
    expect(isTrainablePublicPhrase(' next review', 'en')).toBe(true);
    expect(isTrainablePublicPhrase('的推测。', 'zh')).toBe(false);
    expect(isTrainablePublicPhrase('继续记录差异', 'zh')).toBe(true);
  });

  it('builds a balanced, deterministic, nested phrase-bank prefix', () => {
    const counts = new Map<string, { language: 'zh' | 'en'; count: number }>();
    for (let index = 0; index < 6144; index++) {
      counts.set(`继续完成第${index}项`, { language: 'zh', count: 10_000 - index });
      counts.set(` complete review item ${index}`, { language: 'en', count: 10_000 - index });
    }
    const small = selectPhraseBank(counts, 8192);
    const medium = selectPhraseBank(counts, 12288);

    expect(small).toHaveLength(8192);
    expect(small.filter((entry) => entry.language === 'zh')).toHaveLength(4096);
    expect(small.filter((entry) => entry.language === 'en')).toHaveLength(4096);
    expect(medium.slice(0, small.length).map((entry) => entry.text)).toEqual(
      small.map((entry) => entry.text),
    );
  });

  it('keeps every legal phrase label while choosing the most supported primary target', () => {
    const checkpoints = [
      { cursor: 8, text: ' review' },
      { cursor: 8, text: ' review notes' },
      { cursor: 8, text: ' review notes tomorrow' },
    ];
    const phraseIndex = new Map([
      [
        ' review',
        {
          index: 7,
          id: 'en.00007',
          text: ' review',
          language: 'en' as const,
          trainingOccurrences: 30,
        },
      ],
      [
        ' review notes',
        {
          index: 3,
          id: 'en.00003',
          text: ' review notes',
          language: 'en' as const,
          trainingOccurrences: 90,
        },
      ],
      [
        ' review notes tomorrow',
        {
          index: 9,
          id: 'en.00009',
          text: ' review notes tomorrow',
          language: 'en' as const,
          trainingOccurrences: 20,
        },
      ],
    ]);

    expect(selectTrainingTarget(checkpoints, phraseIndex)).toMatchObject({
      checkpoint: { text: ' review notes' },
      entry: { index: 3 },
      acceptableLabels: [3, 7, 9],
    });
  });

  it('does not train public completions for a document-start context suppressed at runtime', () => {
    const checkpoints = collectPhraseCheckpoints('继续记录差异。', 'zh');
    expect(checkpoints.length).toBeGreaterThan(0);
    expect(checkpoints.every((checkpoint) => checkpoint.cursor >= 2)).toBe(true);
  });

  it('treats bank misses as coverage gaps and uses a genuine document-end silence sample', () => {
    const text = 'A complete synthetic note.';

    expect(selectAbstainCheckpoint(text)).toEqual({
      cursor: text.length,
      reason: 'document-end',
    });
  });

  it('stops before training when the fixed phrase library cannot represent references', () => {
    const holdout: V2RHoldoutV3 = {
      schema: 'jotluck.autocomplete.multi-reference-holdout.v3',
      schemaVersion: 3,
      datasetId: 'representation-unit',
      frozenAt: '2026-07-12T00:00:00.000Z',
      classification: 'cold-validation-v3',
      releaseEvidence: true,
      description: 'Pure representation upper-bound fixture.',
      supportDocuments: [],
      targets: [
        {
          id: 'en-target',
          path: 'targets/en.md',
          language: 'en',
          category: 'meeting-note',
          text: 'Review remains useful.',
          checkpoints: [
            {
              id: 'en-complete',
              cursorOffset: 0,
              expectedBehavior: 'complete',
              acceptableSuffixes: [
                ' review remains useful',
                ' review stays useful',
                ' review is useful',
              ],
            },
            {
              id: 'en-silence',
              cursorOffset: 22,
              expectedBehavior: 'silence',
              acceptableSuffixes: [],
            },
          ],
        },
        {
          id: 'zh-target',
          path: 'targets/zh.md',
          language: 'zh',
          category: 'meeting-note',
          text: '继续记录差异。',
          checkpoints: [
            {
              id: 'zh-complete',
              cursorOffset: 0,
              expectedBehavior: 'complete',
              acceptableSuffixes: ['继续记录差异', '继续检查差异', '继续比较差异'],
            },
            {
              id: 'zh-silence',
              cursorOffset: 7,
              expectedBehavior: 'silence',
              acceptableSuffixes: [],
            },
          ],
        },
      ],
    };
    const bank = [
      {
        index: 0,
        id: 'en.0',
        text: ' review',
        language: 'en' as const,
        trainingOccurrences: 2,
      },
      {
        index: 1,
        id: 'zh.1',
        text: '继续记录',
        language: 'zh' as const,
        trainingOccurrences: 2,
      },
    ];

    expect(
      calculateV2RPhraseBankRepresentation(holdout, bank, {
        minimumAbsoluteRate: 0.5,
        minimumLanguageAbsoluteRate: 0.5,
      }),
    ).toMatchObject({
      overall: { representable: 2, absoluteRate: 0.5 },
      byLanguage: { zh: { absoluteRate: 0.5 }, en: { absoluteRate: 0.5 } },
      passed: true,
      missedCheckpointIds: [],
    });

    const failed = calculateV2RPhraseBankRepresentation(holdout, [bank[0]!], {
      minimumAbsoluteRate: 0.5,
      minimumLanguageAbsoluteRate: 0.5,
    });
    expect(failed.passed).toBe(false);
    expect(failed.missedCheckpointIds).toEqual(['zh-complete']);
  });
});
