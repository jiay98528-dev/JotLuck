import { describe, expect, it } from 'vitest';
import { scanText, type NGramTable } from '@/utils/ngram-engine';
import { scanWordText, wordContext } from '@/utils/word-ngram-engine';
import { DEFAULT_COMPLETION_SETTINGS } from '../../CompletionSettings';
import { buildCompletionContext } from '../context';
import {
  FilePathProvider,
  FormatClosureProvider,
  LexiconProvider,
  LineEchoProvider,
  MarkdownStructureProvider,
  NgramProvider,
  PhraseSlotProvider,
  RecentPhraseProvider,
  SequencePatternProvider,
  ShortChineseProvider,
  ShortEnglishProvider,
  TagProvider,
  WikiLinkProvider,
  type NgramProviderState,
} from '../providers';
import type { PredictorIndexData } from '../types';

function indexData(overrides: Partial<PredictorIndexData> = {}): PredictorIndexData {
  return {
    getAllNoteTitles: () => ['Quick Start'],
    getAllTags: () => ['release'],
    getRecentNoteTitles: () => [],
    matchFilePaths: () => ['./notes/readme.md'],
    ...overrides,
  };
}

function completionContext(doc: string, data: PredictorIndexData | null = null) {
  return buildCompletionContext({
    doc,
    cursorPos: doc.length,
    settings: DEFAULT_COMPLETION_SETTINGS,
    indexData: data,
    n: 4,
  });
}

function state(overrides: Partial<NgramProviderState> = {}): NgramProviderState {
  return {
    n: 4,
    l1: new Map(),
    l2: new Map(),
    l3: new Map(),
    shortL1: new Map(),
    shortL2: new Map(),
    ablationMode: 'full-stack',
    recentPhrases: [],
    lexiconTerms: [],
    qualityGate: (result) => result,
    ...overrides,
  };
}

function ngramTable(context: string, next: string, count = 1): NGramTable {
  return new Map([[context, new Map([[next, count]])]]);
}

describe('completion providers', () => {
  it('returns null for a bare format marker and only closes markers with content', () => {
    const provider = new FormatClosureProvider();
    expect(provider.provide(completionContext('**'))).toBeNull();

    const context = completionContext('**粗体');
    expect(provider.provide(context)).toMatchObject({
      text: '**',
      from: context.cursorPos,
      learnable: false,
      source: 'structured',
    });
  });

  it('anchors every explicit structured completion at the cursor', () => {
    const cases = [
      [new MarkdownStructureProvider(), completionContext('1.'), ' '],
      [new WikiLinkProvider(), completionContext('[[Qu', indexData()), 'ick Start]]'],
      [new TagProvider(), completionContext('note #rel', indexData()), 'ease '],
      [new FilePathProvider(), completionContext('[read](', indexData()), './notes/readme.md)'],
    ] as const;

    for (const [provider, context, text] of cases) {
      expect(provider.provide(context)).toMatchObject({ text, from: context.cursorPos });
    }
  });

  it('blocks ordinary providers in heading and table blocks', () => {
    const providers = [
      new SequencePatternProvider(),
      new LineEchoProvider(),
      new LexiconProvider(() => state()),
      new PhraseSlotProvider(),
      new RecentPhraseProvider(() => state()),
      new ShortChineseProvider(() => state()),
      new ShortEnglishProvider(),
      new NgramProvider(() => state()),
    ];

    for (const doc of ['# heading text', '| column | value |']) {
      const context = completionContext(doc);
      expect(['heading', 'table']).toContain(context.blockType);
      for (const provider of providers) expect(provider.canProvide(context)).toBe(false);
    }
  });

  it('matches a recent phrase from a suffix instead of requiring the whole document tail', () => {
    const provider = new RecentPhraseProvider(() => state({ recentPhrases: ['项目复盘需要确认'] }));
    const context = completionContext('今天记录：项目复盘');

    expect(provider.provide(context)).toMatchObject({
      text: '需要确认',
      source: 'recent',
      sourceLayer: 'l2',
      providerId: 'recent-phrase',
    });
  });

  it('emits independent Personal L2, notebook, and L3 candidates for the resolver', () => {
    const provider = new NgramProvider(() =>
      state({
        l1: ngramTable('abcd', 'w'),
        personalL2: ngramTable('abcd', 'x'),
        notebook: ngramTable('abcd', 'y'),
        l3: ngramTable('abcd', 'z'),
      }),
    );
    const context = completionContext('abcd');

    expect(provider.provideMany(context)).toEqual([
      expect.objectContaining({ text: 'w', sourceLayer: 'l1' }),
      expect.objectContaining({ text: 'x', sourceLayer: 'l2' }),
      expect.objectContaining({ text: 'y', sourceLayer: 'notebook' }),
      expect.objectContaining({ text: 'z', sourceLayer: 'l3' }),
    ]);
    expect(provider.provide(context)).toMatchObject({ text: 'w', sourceLayer: 'l1' });
  });

  it('exposes multiple branches from the same layer instead of hiding runner-up text', () => {
    const provider = new NgramProvider(() =>
      state({
        l1: new Map([
          [
            'abcd',
            new Map([
              ['x', 6],
              ['y', 4],
            ]),
          ],
        ]),
      }),
    );

    expect(provider.provideMany(completionContext('abcd'))).toEqual([
      expect.objectContaining({ text: 'x', sourceLayer: 'l1' }),
      expect.objectContaining({ text: 'y', sourceLayer: 'l1' }),
    ]);
  });

  it('uses high-support short L3 contexts for Chinese without changing private layers', () => {
    const provider = new NgramProvider(() =>
      state({
        l3: new Map([
          ['测试', new Map([['完', 8]])],
          ['试完', new Map([['成', 8]])],
        ]),
      }),
    );

    expect(provider.provideMany(completionContext('这是测试'))).toContainEqual(
      expect.objectContaining({ text: '完成', sourceLayer: 'l3' }),
    );
  });

  it('uses the English word model at a word boundary', () => {
    const provider = new NgramProvider(() =>
      state({
        wordL3: scanWordText('Compare the result before release.'),
      }),
    );

    expect(provider.provideMany(completionContext('Compare the '))).toContainEqual(
      expect.objectContaining({
        text: 'result before release',
        sourceLayer: 'l3',
        syntaxType: 'word-en',
      }),
    );
  });

  it('submits at most three English word candidates to the resolver', () => {
    const provider = new NgramProvider(() =>
      state({
        wordL3: new Map([
          [
            wordContext(['compare', 'the']),
            new Map([
              ['result', 10],
              ['owner', 9],
              ['status', 8],
              ['scope', 7],
            ]),
          ],
        ]),
      }),
    );

    const candidates = provider.provideMany(completionContext('Compare the '));
    expect(candidates.map(({ text }) => text)).toEqual(['result', 'owner', 'status']);
    expect(candidates).toHaveLength(3);
    expect(candidates.every(({ syntaxType }) => syntaxType === 'word-en')).toBe(true);
  });

  it('never falls back to character continuation at an English word boundary', () => {
    const provider = new NgramProvider(() =>
      state({
        l3: scanText('Compare the noisy character continuation', 4),
        wordL3: new Map(),
      }),
    );

    expect(provider.provideMany(completionContext('Compare the '))).toEqual([]);
  });

  it('uses character continuation only as a word-internal spelling fallback', () => {
    const provider = new NgramProvider(() =>
      state({ l3: scanText('documentation next sentence', 4) }),
    );

    expect(provider.provideMany(completionContext('docum'))).toEqual([
      expect.objectContaining({
        text: 'entation',
        sourceLayer: 'l3',
        syntaxType: 'general',
      }),
    ]);
  });

  it('keeps the legacy L2 aliases and includes notebook candidates in L2 ablation', () => {
    const provider = new NgramProvider(() =>
      state({
        l2: ngramTable('abcd', 'p'),
        notebook: ngramTable('abcd', 'n'),
        l3: ngramTable('abcd', 'b'),
        ablationMode: 'l2-only',
      }),
    );

    expect(provider.provideMany(completionContext('abcd'))).toEqual([
      expect.objectContaining({ text: 'p', sourceLayer: 'l2' }),
      expect.objectContaining({ text: 'n', sourceLayer: 'notebook' }),
    ]);
  });

  it('emits independent short Personal L2 and notebook candidates', () => {
    const provider = new ShortChineseProvider(() =>
      state({
        shortL1: ngramTable('测试', '甲'),
        shortPersonalL2: ngramTable('测试', '乙'),
        shortNotebook: ngramTable('测试', '丙'),
      }),
    );

    expect(provider.provideMany(completionContext('中文测试'))).toEqual([
      expect.objectContaining({ text: '甲', sourceLayer: 'short-l1' }),
      expect.objectContaining({ text: '乙', sourceLayer: 'short-l2' }),
      expect.objectContaining({ text: '丙', sourceLayer: 'short-notebook' }),
    ]);
  });

  it.each(['回到家以后', '下次复习时'])(
    'adds a comma after a complete temporal lead-in: %s',
    (doc) => {
      const provider = new PhraseSlotProvider();
      expect(provider.provide(completionContext(doc))).toMatchObject({
        text: '，',
        providerId: 'phrase-slot',
        sourceLayer: 'provider',
      });
    },
  );

  it('caps lexicon terms after prefix filtering and matches English case-insensitively', () => {
    const unrelatedTerms = Array.from({ length: 90 }, (_, index) => `UnrelatedTerm${index}`);
    const provider = new LexiconProvider(() =>
      state({ lexiconTerms: [...unrelatedTerms, 'ReleasePipeline'] }),
    );

    expect(provider.provide(completionContext('release'))).toMatchObject({ text: 'Pipeline' });
  });

  it('supports Chinese sequence values through 9999 and stops before 10000', () => {
    const provider = new SequencePatternProvider();
    const next = completionContext('第九千九百九十七条：\n第九千九百九十八条：\n');
    expect(provider.provide(next)?.text).toBe('第九千九百九十九条：');

    const overflow = completionContext('第九千九百九十八条：\n第九千九百九十九条：\n');
    expect(provider.provide(overflow)).toBeNull();

    const arabic = completionContext('第9997条：\n第9998条：\n');
    expect(provider.provide(arabic)?.text).toBe('第9999条：');
  });
});
