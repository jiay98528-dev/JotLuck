import {
  type NGramTable,
  predict as ngramPredict,
  type PredictionResult,
} from '@/utils/ngram-engine';
import type {
  CompletionCandidate,
  CompletionAblationMode,
  CompletionContext,
  CompletionProvider,
  CompletionSourceLayer,
} from './types';

const STRUCTURED_PRIORITY = 100;
const SEQUENCE_PRIORITY = 85;
const LINE_ECHO_PRIORITY = 82;
const LEXICON_PRIORITY = 78;
const PHRASE_SLOT_PRIORITY = 74;
const RECENT_PRIORITY = 72;
const SHORT_ZH_PRIORITY = 70;
const SHORT_EN_PRIORITY = 60;
const NGRAM_PRIORITY = 50;
const FIXED_FALLBACK_PRIORITY = 40;
const LAYER_OVERRIDE_CONFIDENCE_DELTA = 0.12;

const SHORT_ZH_FALLBACKS: Array<[string, string]> = [
  ['这是我', '最喜欢'],
  ['这是', '一个'],
  ['我喜欢', '去'],
  ['最喜欢', '的事情'],
  ['第一条', '：'],
  ['第二条', '：'],
  ['第三条', '：'],
  ['今天记录', '一下'],
  ['今天主要', '完成'],
  ['今天计划', '先'],
  ['明天计划', '继续'],
  ['本周计划', '完成'],
  ['本周复盘', '一下'],
  ['复盘结论', '是'],
  ['任务进度', '正常'],
  ['完成情况', '正常'],
  ['当前进展', '正常'],
  ['当前问题', '是'],
  ['主要问题', '是'],
  ['主要风险', '在于'],
  ['风险处理', '需要'],
  ['后续安排', '是'],
  ['待确认', '事项'],
  ['需要补充', '说明'],
  ['需要跟进', '一下'],
  ['需要优化', '的是'],
  ['需要处理', '的问题'],
  ['需要记录', '一下'],
  ['原因分析', '如下'],
  ['问题原因', '可能'],
  ['解决方案', '是'],
  ['处理结果', '正常'],
  ['验收结果', '通过'],
  ['测试结果', '通过'],
  ['会议记录', '如下'],
  ['会议目标', '是'],
  ['会议纪要', '如下'],
  ['行动项', '是'],
  ['结论如下', '：'],
  ['风险在于', '可能'],
  ['原因是', '当前'],
  ['需要确认', '一下'],
  ['当前状态', '正常'],
  ['下一步', '继续'],
  ['为了', '更好'],
  ['项目', '进度'],
  ['今天', '主要'],
  ['需要', '注意'],
  ['如果', '需要'],
  ['可以', '继续'],
  ['目前', '已经'],
  ['会议结论', '是'],
];

const SHORT_EN_FALLBACKS: Array<[string, string]> = [
  ['this ', 'note covers'],
  ['the ', 'main point'],
  ['when ', 'needed next'],
  ['users ', 'can edit'],
  ['project ', 'status note'],
  ['project status ', 'is ready'],
  ['meeting ', 'notes draft'],
  ['daily ', 'note entry'],
  ['status ', 'update note'],
  ['next ', 'step today'],
  ['the next step ', 'is to check'],
  ['action ', 'items list'],
  ['current ', 'state now'],
  ['risk ', 'needs review'],
  ['the risk ', 'needs review'],
  ['the main risk ', 'is config'],
  ['the goal ', 'is clear'],
  ['the result ', 'is ready'],
  ['the issue ', 'needs review'],
  ['when debugging ', 'the issue'],
  ['we need ', 'to confirm'],
  ['need to ', 'confirm'],
  ['need to confirm ', 'the owner'],
  ['before release, ', 'verify'],
  ['test result ', 'is passing'],
  ['follow up ', 'on owner'],
  ['technical ', 'note draft'],
  ['release ', 'notes draft'],
  ['test ', 'result ok'],
  ['review ', 'notes list'],
  ['markdown', ' syntax'],
  ['document', 'ation'],
];

export type QualityGate = (
  result: PredictionResult,
  cursorPos: number,
  doc: string,
) => PredictionResult | null;

export interface NgramProviderState {
  n: number;
  l1: NGramTable;
  l2: NGramTable;
  l3: NGramTable;
  shortL1: NGramTable;
  shortL2: NGramTable;
  ablationMode: CompletionAblationMode;
  recentPhrases: readonly string[];
  lexiconTerms: readonly string[];
  qualityGate: QualityGate;
}

const PHRASE_SLOT_FALLBACKS: Array<[RegExp, string, number]> = [
  [/我认为$/u, '，', 0.74],
  [/我觉得$/u, '，', 0.72],
  [/我总觉得$/u, '这件事', 0.7],
  [/其实$/u, '，', 0.68],
  [/其实我想$/u, '说的是', 0.7],
  [/原因是$/u, '因为', 0.74],
  [/问题在于$/u, '边界', 0.7],
  [/关键在于$/u, '能否', 0.68],
  [/也就是说$/u, '，', 0.72],
  [/换句话说$/u, '，', 0.74],
  [/从这个角度看$/u, '，', 0.72],
  [/需要注意$/u, '的是', 0.72],
  [/接下来$/u, '需要', 0.72],
  [/最后$/u, '，', 0.68],
  [/因此$/u, '，', 0.72],
  [/所以$/u, '，', 0.68],
  [/不过$/u, '，', 0.66],
  [/但是$/u, '，', 0.66],
  [/同时$/u, '，', 0.66],
  [/另外$/u, '，', 0.66],
  [/这说明$/u, '，', 0.66],
  [/这种情况$/u, '需要', 0.66],
  [/这件事$/u, '需要', 0.66],
  [/当前$/u, '需要', 0.64],
  [/今天$/u, '主要', 0.64],
  [/最近$/u, '一直', 0.64],
  [/结论是$/u, '需要', 0.7],
  [/风险在于$/u, '可能', 0.7],
  [/下一步$/u, '继续', 0.7],
  [/第一条$/u, '：', 0.76],
  [/第二条$/u, '：', 0.76],
  [/第三条$/u, '：', 0.76],
  [/今天主要$/u, '记录', 0.68],
  [/当前需要$/u, '确认', 0.68],
  [/读书笔记$/u, '应该', 0.66],
  [/项目复盘$/u, '需要', 0.66],
  [/版本收口$/u, '和验收', 0.68],
  [/几个容易混淆$/u, '的概念', 0.68],
  [/本地笔记工具$/u, '最重要', 0.68],
  [/本周先完成$/u, '自动化', 0.68],
];

export class FormatClosureProvider implements CompletionProvider {
  readonly id = 'format-closure';
  readonly priority = STRUCTURED_PRIORITY;

  canProvide(context: CompletionContext): boolean {
    return context.syntax.type === 'markdown-format';
  }

  provide(context: CompletionContext): CompletionCandidate | null {
    const marker = context.syntax.openMarker;
    if (!marker) return null;
    const prefix = context.syntax.prefix.trim();
    const placeholders: Record<string, string> = {
      '**': '粗体**',
      '*': '斜体*',
      '`': 'code`',
      __: '强调__',
    };
    return structuredCandidate({
      providerId: this.id,
      text: prefix.length > 0 ? marker : (placeholders[marker] ?? marker),
      confidence: prefix.length > 0 ? 0.92 : 0.85,
      syntaxType: 'markdown-format',
      priority: this.priority,
    });
  }
}

export class MarkdownStructureProvider implements CompletionProvider {
  readonly id = 'markdown-structure';
  readonly priority = STRUCTURED_PRIORITY;

  canProvide(context: CompletionContext): boolean {
    return context.syntax.type === 'markdown-structure';
  }

  provide(context: CompletionContext): CompletionCandidate | null {
    const prefix = context.syntax.prefix;
    const text =
      prefix.startsWith('-') || prefix.startsWith('*') || prefix.startsWith('+')
        ? '[ ] '
        : prefix.startsWith('#')
          ? '标题'
          : '引用';
    return structuredCandidate({
      providerId: this.id,
      text,
      confidence: 0.82,
      syntaxType: 'markdown-structure',
      priority: this.priority,
    });
  }
}

export class WikiLinkProvider implements CompletionProvider {
  readonly id = 'wiki-link';
  readonly priority = STRUCTURED_PRIORITY;

  canProvide(context: CompletionContext): boolean {
    return context.syntax.type === 'wiki-link' && !!context.indexData;
  }

  provide(context: CompletionContext): CompletionCandidate | null {
    const prefix = context.syntax.prefix;
    const q = prefix.toLowerCase();
    const matches = context
      .indexData!.getAllNoteTitles()
      .filter((title) => title.toLowerCase().startsWith(q))
      .sort((a, b) => a.length - b.length);
    const best = matches[0];
    if (!best) return null;
    return structuredCandidate({
      providerId: this.id,
      text: best.slice(prefix.length) + ']]',
      confidence: matches.length === 1 ? 0.95 : 0.75,
      syntaxType: 'wiki-link',
      priority: this.priority,
    });
  }
}

export class TagProvider implements CompletionProvider {
  readonly id = 'tag';
  readonly priority = STRUCTURED_PRIORITY;

  canProvide(context: CompletionContext): boolean {
    return context.syntax.type === 'tag' && !!context.indexData;
  }

  provide(context: CompletionContext): CompletionCandidate | null {
    const prefix = context.syntax.prefix;
    const q = prefix.toLowerCase();
    const matches = context
      .indexData!.getAllTags()
      .filter((tag) => tag.toLowerCase().startsWith(q));
    const best = matches[0];
    if (!best) return null;
    return structuredCandidate({
      providerId: this.id,
      text: best.slice(prefix.length) + ' ',
      confidence: prefix.length > 0 ? 0.9 : 0.7,
      syntaxType: 'tag',
      priority: this.priority,
    });
  }
}

export class FilePathProvider implements CompletionProvider {
  readonly id = 'file-path';
  readonly priority = STRUCTURED_PRIORITY;

  canProvide(context: CompletionContext): boolean {
    return context.syntax.type === 'file-path' && !!context.indexData;
  }

  provide(context: CompletionContext): CompletionCandidate | null {
    const prefix = context.syntax.prefix;
    const q = prefix.toLowerCase();
    const paths = context
      .indexData!.matchFilePaths(prefix)
      .filter((path) => path.toLowerCase().startsWith(q))
      .sort((a, b) => a.length - b.length);
    const best = paths[0];
    if (!best) return null;
    return structuredCandidate({
      providerId: this.id,
      text: best.slice(prefix.length) + ')',
      confidence: paths.length === 1 ? 0.9 : 0.65,
      syntaxType: 'file-path',
      priority: this.priority,
    });
  }
}

export class SequencePatternProvider implements CompletionProvider {
  readonly id = 'sequence-pattern';
  readonly priority = SEQUENCE_PRIORITY;

  canProvide(context: CompletionContext): boolean {
    return context.syntax.type === 'general' && context.atEndOfLine;
  }

  provide(context: CompletionContext): CompletionCandidate | null {
    const previousLines = getImmediatePreviousLines(context);
    const text = inferNextSequenceText(previousLines);
    if (!text) return null;
    const currentPrefix = context.line?.beforeCursor ?? '';
    if (currentPrefix && !text.startsWith(currentPrefix)) return null;
    const inlineText = currentPrefix ? text.slice(currentPrefix.length) : text;
    if (!inlineText.trim()) return null;

    return {
      text: inlineText,
      confidence: 0.86,
      from: context.cursorPos,
      providerId: this.id,
      source: 'structured',
      sourceLayer: 'provider',
      syntaxType: 'sequence-pattern',
      learnable: false,
      priority: this.priority,
    };
  }
}

export class LineEchoProvider implements CompletionProvider {
  readonly id = 'line-echo';
  readonly priority = LINE_ECHO_PRIORITY;

  canProvide(context: CompletionContext): boolean {
    return (
      context.syntax.type === 'general' &&
      !context.emptyLine &&
      context.atEndOfLine &&
      context.languageHint !== 'mixed'
    );
  }

  provide(context: CompletionContext): CompletionCandidate | null {
    const currentPrefix = context.line?.beforeCursor ?? '';
    if (currentPrefix.trim().length < 2) return null;
    if (isMarkdownBlockBoundary(currentPrefix)) return null;

    const previousLines = getImmediatePreviousLines(context, 2);
    if (previousLines.length < 2) return null;
    if (previousLines.some((line) => isMarkdownBlockBoundary(line))) return null;

    const [first, second] = previousLines;
    if (!first || !second) return null;
    if (!first.startsWith(currentPrefix) || !second.startsWith(currentPrefix)) return null;

    const firstSuffix = first.slice(currentPrefix.length);
    const secondSuffix = second.slice(currentPrefix.length);
    if (!firstSuffix.trim() || firstSuffix !== secondSuffix) return null;
    if (!passesEchoLanguage(currentPrefix, firstSuffix, context)) return null;

    return {
      text: firstSuffix,
      confidence: 0.9,
      from: context.cursorPos,
      providerId: this.id,
      source: 'ngram',
      sourceLayer: 'provider',
      syntaxType: 'line-echo',
      learnable: true,
      priority: this.priority,
    };
  }
}

export class LexiconProvider implements CompletionProvider {
  readonly id = 'lexicon';
  readonly priority = LEXICON_PRIORITY;

  constructor(private readonly getState: () => NgramProviderState) {}

  canProvide(context: CompletionContext): boolean {
    return (
      context.syntax.type === 'general' &&
      !context.emptyLine &&
      context.atEndOfLine &&
      context.languageHint !== 'mixed' &&
      isWritingBlock(context)
    );
  }

  provide(context: CompletionContext): CompletionCandidate | null {
    return this.provideMany(context)[0] ?? null;
  }

  provideMany(context: CompletionContext): CompletionCandidate[] {
    const state = this.getState();
    const terms = uniqueTerms([
      ...state.lexiconTerms,
      ...(context.indexData?.getAllNoteTitles() ?? []),
      ...(context.indexData?.getRecentNoteTitles?.() ?? []),
      ...(context.indexData?.getAllTags() ?? []),
      ...context.recentTokens,
    ]).filter((term) => passesLexiconLanguage(term, context));
    if (terms.length === 0) return [];

    const prefix = getLexiconPrefix(context);
    const candidates: CompletionCandidate[] = [];
    for (const term of terms) {
      if (prefix && term.startsWith(prefix) && term.length > prefix.length) {
        candidates.push(
          lexiconCandidate(term.slice(prefix.length, prefix.length + 8), context, 0.73),
        );
      } else if (!prefix && /(?:关于|这个|本次|当前|整个)$/u.test(context.sentencePrefix)) {
        candidates.push(lexiconCandidate(term.slice(0, 8), context, 0.58));
      }
    }

    return candidates
      .filter((candidate) => candidate.text.trim().length >= 2)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
  }
}

export class PhraseSlotProvider implements CompletionProvider {
  readonly id = 'phrase-slot';
  readonly priority = PHRASE_SLOT_PRIORITY;

  canProvide(context: CompletionContext): boolean {
    return (
      context.syntax.type === 'general' &&
      context.languageHint === 'zh' &&
      !context.emptyLine &&
      context.atEndOfLine &&
      isWritingBlock(context)
    );
  }

  provide(context: CompletionContext): CompletionCandidate | null {
    return this.provideMany(context)[0] ?? null;
  }

  provideMany(context: CompletionContext): CompletionCandidate[] {
    const beforeCursor = context.sentencePrefix || context.line?.beforeCursor || '';
    const candidates = PHRASE_SLOT_FALLBACKS.filter(([pattern]) => pattern.test(beforeCursor)).map(
      ([, text, confidence]) => ({
        text,
        confidence,
        from: context.cursorPos,
        providerId: this.id,
        source: 'ngram' as const,
        sourceLayer: 'provider' as const,
        syntaxType: 'phrase-slot',
        learnable: true,
        priority: this.priority,
      }),
    );
    return candidates.slice(0, 5);
  }
}

export class RecentPhraseProvider implements CompletionProvider {
  readonly id = 'recent-phrase';
  readonly priority = RECENT_PRIORITY;

  constructor(private readonly getState: () => NgramProviderState) {}

  canProvide(context: CompletionContext): boolean {
    return context.syntax.type === 'general' && !context.emptyLine && context.atEndOfLine;
  }

  provide(context: CompletionContext): CompletionCandidate | null {
    const state = this.getState();
    const tail = context.doc.slice(Math.max(0, context.cursorPos - 16), context.cursorPos);
    if (tail.length < 2) return null;
    const phrase = state.recentPhrases.find(
      (item) => item.startsWith(tail) && item.length > tail.length,
    );
    if (!phrase) return null;
    return {
      text: phrase.slice(tail.length),
      confidence: 0.78,
      from: context.cursorPos,
      providerId: this.id,
      source: 'recent',
      sourceLayer: 'provider',
      syntaxType: 'recent-phrase',
      learnable: true,
      priority: this.priority,
    };
  }
}

export class ShortChineseProvider implements CompletionProvider {
  readonly id = 'short-chinese';
  readonly priority = SHORT_ZH_PRIORITY;

  constructor(private readonly getState: () => NgramProviderState) {}

  canProvide(context: CompletionContext): boolean {
    return context.syntax.type === 'general' && !context.emptyLine && context.atEndOfLine;
  }

  provide(context: CompletionContext): CompletionCandidate | null {
    const state = this.getState();
    const beforeCursor = context.doc.slice(Math.max(0, context.cursorPos - 8), context.cursorPos);
    const ctx2 = context.doc.slice(Math.max(0, context.cursorPos - 2), context.cursorPos);
    const ctx3 = context.doc.slice(Math.max(0, context.cursorPos - 3), context.cursorPos);
    if (!/[\u3400-\u9fff]/.test(ctx2 + ctx3)) return null;

    const candidates = [
      {
        layer: 'short-l1' as const,
        result: ngramPredict(state.shortL1, context.cursorPos, context.doc, 2, 6, 0.55),
      },
      {
        layer: 'short-l2' as const,
        result: ngramPredict(state.shortL2, context.cursorPos, context.doc, 2, 6, 0.55),
      },
    ]
      .filter((item) => isLayerEnabled(item.layer, state.ablationMode))
      .filter((item): item is { layer: 'short-l1' | 'short-l2'; result: PredictionResult } =>
        Boolean(item.result),
      )
      .map(({ layer, result }) => ({
        layer,
        result: {
          ...result,
          confidence: Math.min(0.76, result.confidence),
          syntaxType: 'short-zh',
        },
      }))
      .map(({ layer, result }) => ({
        layer,
        result: state.qualityGate(result, context.cursorPos, context.doc),
      }))
      .filter((item): item is { layer: 'short-l1' | 'short-l2'; result: PredictionResult } =>
        Boolean(item.result),
      )
      .map(({ layer, result }) => this.toCandidate(result, context, layer));

    const fixed =
      state.ablationMode === 'full-stack' || state.ablationMode === 'provider-only'
        ? findLongestSuffixFallback(SHORT_ZH_FALLBACKS, beforeCursor)
        : undefined;
    if (fixed) {
      candidates.push({
        text: fixed[1],
        confidence: 0.62,
        from: context.cursorPos,
        providerId: 'short-chinese-fallback',
        source: 'ngram',
        sourceLayer: 'fallback',
        syntaxType: 'short-zh',
        learnable: true,
        priority: FIXED_FALLBACK_PRIORITY,
      });
    }

    candidates.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return compareLayeredCandidates(a, b, ['short-l1', 'short-l2', 'fallback']);
    });
    return candidates[0] ?? null;
  }

  private toCandidate(
    result: PredictionResult,
    context: CompletionContext,
    sourceLayer: 'short-l1' | 'short-l2',
  ): CompletionCandidate {
    return {
      text: result.text,
      confidence: result.confidence,
      from: result.from || context.cursorPos,
      providerId: this.id,
      source: 'ngram',
      sourceLayer,
      syntaxType: 'short-zh',
      learnable: true,
      priority: this.priority,
    };
  }
}

export class ShortEnglishProvider implements CompletionProvider {
  readonly id = 'short-english';
  readonly priority = SHORT_EN_PRIORITY;

  canProvide(context: CompletionContext): boolean {
    return (
      context.syntax.type === 'general' &&
      context.languageHint === 'en' &&
      !context.emptyLine &&
      context.atEndOfLine
    );
  }

  provide(context: CompletionContext): CompletionCandidate | null {
    const beforeCursor = context.doc.slice(Math.max(0, context.cursorPos - 16), context.cursorPos);
    const lower = beforeCursor.toLowerCase();
    const fixed = findLongestSuffixFallback(SHORT_EN_FALLBACKS, lower);
    if (!fixed) return null;
    return {
      text: fixed[1],
      confidence: 0.64,
      from: context.cursorPos,
      providerId: this.id,
      source: 'ngram',
      sourceLayer: 'fallback',
      syntaxType: 'short-en',
      learnable: true,
      priority: this.priority,
    };
  }
}

export class NgramProvider implements CompletionProvider {
  readonly id = 'ngram';
  readonly priority = NGRAM_PRIORITY;

  constructor(private readonly getState: () => NgramProviderState) {}

  canProvide(context: CompletionContext): boolean {
    return context.syntax.type === 'general' && !context.emptyLine && context.atEndOfLine;
  }

  provide(context: CompletionContext): CompletionCandidate | null {
    const state = this.getState();
    if (
      context.doc.slice(Math.max(0, context.cursorPos - state.n), context.cursorPos).length <
      state.n
    )
      return null;

    const candidates = [
      {
        layer: 'l1' as const,
        result: ngramPredict(
          state.l1,
          context.cursorPos,
          context.doc,
          state.n,
          context.settings.maxSuggestionLength,
          context.settings.minConfidence,
        ),
      },
      {
        layer: 'l2' as const,
        result: ngramPredict(
          state.l2,
          context.cursorPos,
          context.doc,
          state.n,
          context.settings.maxSuggestionLength,
          context.settings.minConfidence,
        ),
      },
      {
        layer: 'l3' as const,
        result: ngramPredict(
          state.l3,
          context.cursorPos,
          context.doc,
          state.n,
          context.settings.maxSuggestionLength,
          context.settings.minConfidence,
        ),
      },
    ]
      .filter((item) => isLayerEnabled(item.layer, state.ablationMode))
      .filter((item): item is { layer: 'l1' | 'l2' | 'l3'; result: PredictionResult } =>
        Boolean(item.result),
      )
      .map(({ layer, result }) => ({
        layer,
        result: state.qualityGate(result, context.cursorPos, context.doc),
      }))
      .filter((item): item is { layer: 'l1' | 'l2' | 'l3'; result: PredictionResult } =>
        Boolean(item.result),
      )
      .map(({ layer, result }) => ({
        text: result.text,
        confidence: result.confidence,
        from: result.from || context.cursorPos,
        providerId: this.id,
        source: 'ngram' as const,
        sourceLayer: layer,
        syntaxType: 'general',
        learnable: true,
        priority: this.priority,
      }));

    candidates.sort((a, b) => compareLayeredCandidates(a, b, ['l1', 'l2', 'l3']));
    return candidates[0] ?? null;
  }
}

function isLayerEnabled(sourceLayer: CompletionSourceLayer, mode: CompletionAblationMode): boolean {
  if (mode === 'full-stack') return true;
  if (mode === 'provider-only') return sourceLayer === 'provider' || sourceLayer === 'fallback';
  if (mode === 'l1-only') return sourceLayer === 'l1' || sourceLayer === 'short-l1';
  if (mode === 'l2-only') return sourceLayer === 'l2' || sourceLayer === 'short-l2';
  if (mode === 'l3-only') return sourceLayer === 'l3' || sourceLayer === 'short-l3';
  return true;
}

export class LLMProvider implements CompletionProvider {
  readonly id = 'llm';
  readonly priority = 10;

  canProvide(): boolean {
    return false;
  }

  provide(): CompletionCandidate | null {
    return null;
  }
}

function findLongestSuffixFallback(
  fallbacks: readonly [string, string][],
  beforeCursor: string,
): [string, string] | undefined {
  return [...fallbacks]
    .sort((a, b) => b[0].length - a[0].length)
    .find(([prefix]) => beforeCursor.endsWith(prefix));
}

type SequenceTokenKind = 'zh' | 'arabic';

interface SequencePatternToken {
  kind: SequenceTokenKind;
  value: number;
  unit: string;
  numeralStart: number;
  numeralEnd: number;
}

interface SequencePatternLine {
  segment: string;
  template: string;
  tokens: SequencePatternToken[];
}

const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
const CHINESE_NUMERALS = '零〇一二两三四五六七八九十百千万0-9';
const CHINESE_SEQUENCE_UNITS = '部分|阶段|条|天|项|步|点|个|章|节|段|周|月|年';
const CHINESE_SEQUENCE_TOKEN_SOURCE = `第([${CHINESE_NUMERALS}]+)(${CHINESE_SEQUENCE_UNITS})`;
const CHINESE_SEQUENCE_RE = new RegExp(CHINESE_SEQUENCE_TOKEN_SOURCE, 'gu');
const CHINESE_SEQUENCE_PREFIX_RE = new RegExp(
  `^\\s*${CHINESE_SEQUENCE_TOKEN_SOURCE}(?:\\s*[、,，;；]\\s*${CHINESE_SEQUENCE_TOKEN_SOURCE})*\\s*`,
  'u',
);
const CHINESE_SEQUENCE_SERIES_RE = new RegExp(
  `^\\s*${CHINESE_SEQUENCE_TOKEN_SOURCE}(?:\\s*[、,，;；]\\s*${CHINESE_SEQUENCE_TOKEN_SOURCE})*\\s*[;；。.]?\\s*$`,
  'u',
);
const ORDERED_LIST_PREFIX_RE = /^\s*(\d+)([.)、．])\s*/u;

function getImmediatePreviousLines(context: CompletionContext, maxLines = 4): string[] {
  const beforeCursor = context.doc.slice(0, context.cursorPos);
  const lines = beforeCursor.split('\n').map((line) => line.replace(/\r$/, ''));
  lines.pop();

  const previous: string[] = [];
  for (let i = lines.length - 1; i >= 0 && previous.length < maxLines; i--) {
    const line = lines[i] ?? '';
    if (!line.trim()) break;
    previous.push(line);
  }
  return previous.reverse();
}

function isMarkdownBlockBoundary(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    /^#{1,6}\s/u.test(trimmed) ||
    /^[-*+]\s/u.test(trimmed) ||
    /^\d+[.)、]\s/u.test(trimmed) ||
    /^>\s/u.test(trimmed)
  );
}

function passesEchoLanguage(
  currentPrefix: string,
  suffix: string,
  context: CompletionContext,
): boolean {
  const hasCjk = /[\u3400-\u9fff]/u.test(suffix);
  const hasLatin = /[A-Za-z]/.test(suffix);
  if (context.languageHint === 'en') return !hasCjk;
  if (context.languageHint === 'zh') return !/^[A-Za-z]/.test(suffix.trim());
  if (context.languageHint === 'unknown') {
    const prefixHasCjk = /[\u3400-\u9fff]/u.test(currentPrefix);
    const prefixHasLatin = /[A-Za-z]/.test(currentPrefix);
    if (prefixHasCjk && hasLatin && !hasCjk) return false;
    if (prefixHasLatin && hasCjk && !hasLatin) return false;
  }
  return true;
}

function inferNextSequenceText(lines: readonly string[]): string | null {
  const suffix: SequencePatternLine[] = [];

  for (let i = lines.length - 1; i >= 0; i--) {
    const pattern = parseSequencePatternLine(lines[i] ?? '');
    if (!pattern) break;
    if (suffix.length > 0 && !hasSameSequenceShape(pattern, suffix[suffix.length - 1]!)) break;
    suffix.push(pattern);
  }

  const series = suffix.reverse();
  if (series.length < 2) return null;
  if (!isStrictSequence(series)) return null;

  const last = series[series.length - 1]!;
  return renderSequencePattern(last, last.tokens[0]!.value + 1);
}

function parseSequencePatternLine(line: string): SequencePatternLine | null {
  const segment = extractSequenceSegment(line);
  if (!segment) return null;

  const tokens = extractSequenceTokens(segment);
  if (tokens.length === 0) return null;
  if (!tokens.every((token) => token.value === tokens[0]!.value)) return null;

  return {
    segment,
    template: createSequenceTemplate(segment, tokens),
    tokens,
  };
}

function extractSequenceSegment(line: string): string | null {
  const text = line.trimEnd();
  if (!text.trim()) return null;

  const colonMatch = /[：:]/u.exec(text);
  if (colonMatch) {
    const segment = text.slice(0, colonMatch.index + colonMatch[0].length);
    return hasSequenceToken(segment) ? segment : null;
  }

  const orderedMatch = ORDERED_LIST_PREFIX_RE.exec(text);
  if (orderedMatch) return orderedMatch[0];

  if (CHINESE_SEQUENCE_SERIES_RE.test(text)) return text;

  const prefixMatch = CHINESE_SEQUENCE_PREFIX_RE.exec(text);
  if (!prefixMatch) return null;

  const prefix = prefixMatch[0];
  if (prefix.length === text.length || /[\s、,，;；.．:：]$/u.test(prefix)) return prefix;
  return null;
}

function hasSequenceToken(text: string): boolean {
  CHINESE_SEQUENCE_RE.lastIndex = 0;
  return CHINESE_SEQUENCE_RE.test(text) || ORDERED_LIST_PREFIX_RE.test(text);
}

function extractSequenceTokens(segment: string): SequencePatternToken[] {
  const chineseTokens = extractChineseSequenceTokens(segment);
  if (chineseTokens.length > 0) return chineseTokens;

  const orderedMatch = ORDERED_LIST_PREFIX_RE.exec(segment);
  if (!orderedMatch || orderedMatch.index !== 0) return [];
  const numeral = orderedMatch[1];
  const unit = orderedMatch[2];
  if (!numeral || !unit) return [];
  const value = Number(numeral);
  if (!Number.isSafeInteger(value) || value < 1) return [];
  return [
    {
      kind: 'arabic',
      value,
      unit,
      numeralStart: orderedMatch.index,
      numeralEnd: orderedMatch.index + numeral.length,
    },
  ];
}

function extractChineseSequenceTokens(segment: string): SequencePatternToken[] {
  const tokens: SequencePatternToken[] = [];
  CHINESE_SEQUENCE_RE.lastIndex = 0;

  for (const match of segment.matchAll(CHINESE_SEQUENCE_RE)) {
    const index = match.index ?? 0;
    const numeral = match[1] ?? '';
    const unit = match[2] ?? '';
    const value = parseChineseNumber(numeral);
    if (!value || value < 1) return [];
    tokens.push({
      kind: 'zh',
      value,
      unit,
      numeralStart: index + 1,
      numeralEnd: index + 1 + numeral.length,
    });
  }

  return tokens;
}

function createSequenceTemplate(segment: string, tokens: readonly SequencePatternToken[]): string {
  let template = segment;
  for (const token of [...tokens].sort((a, b) => b.numeralStart - a.numeralStart)) {
    template = `${template.slice(0, token.numeralStart)}#${template.slice(token.numeralEnd)}`;
  }
  return template;
}

function hasSameSequenceShape(a: SequencePatternLine, b: SequencePatternLine): boolean {
  return (
    a.template === b.template &&
    a.tokens.length === b.tokens.length &&
    a.tokens.every(
      (token, index) =>
        token.kind === b.tokens[index]?.kind && token.unit === b.tokens[index]?.unit,
    )
  );
}

function isStrictSequence(series: readonly SequencePatternLine[]): boolean {
  for (let lineIndex = 1; lineIndex < series.length; lineIndex++) {
    const previous = series[lineIndex - 1]!;
    const current = series[lineIndex]!;
    if (!hasSameSequenceShape(previous, current)) return false;
    for (let tokenIndex = 0; tokenIndex < current.tokens.length; tokenIndex++) {
      if (current.tokens[tokenIndex]!.value !== previous.tokens[tokenIndex]!.value + 1) {
        return false;
      }
    }
  }
  return true;
}

function renderSequencePattern(pattern: SequencePatternLine, nextValue: number): string {
  let text = pattern.segment;
  for (const token of [...pattern.tokens].sort((a, b) => b.numeralStart - a.numeralStart)) {
    const nextNumeral = token.kind === 'zh' ? formatChineseNumber(nextValue) : String(nextValue);
    text = `${text.slice(0, token.numeralStart)}${nextNumeral}${text.slice(token.numeralEnd)}`;
  }
  return text;
}

function parseChineseNumber(value: string): number | null {
  if (/^\d+$/u.test(value)) return Number(value);
  if (value === '十') return 10;

  const tenIndex = value.indexOf('十');
  if (tenIndex >= 0) {
    const tensText = value.slice(0, tenIndex);
    const onesText = value.slice(tenIndex + 1);
    const tens = tensText ? CHINESE_DIGITS[tensText] : 1;
    const ones = onesText ? CHINESE_DIGITS[onesText] : 0;
    if (tens === undefined || ones === undefined) return null;
    return tens * 10 + ones;
  }

  return CHINESE_DIGITS[value] ?? null;
}

function formatChineseNumber(value: number): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (value > 0 && value < 10) return digits[value]!;
  if (value === 10) return '十';
  if (value > 10 && value < 20) return `十${digits[value - 10]}`;
  if (value > 10 && value < 100) {
    const tens = Math.floor(value / 10);
    const ones = value % 10;
    return `${digits[tens]}十${ones === 0 ? '' : digits[ones]}`;
  }
  return String(value);
}

function isWritingBlock(context: CompletionContext): boolean {
  return (
    context.blockType === 'paragraph' ||
    context.blockType === 'list' ||
    context.blockType === 'quote'
  );
}

function uniqueTerms(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const item of items) {
    const normalized = normalizeLexiconTerm(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    terms.push(normalized);
  }
  return terms.slice(0, 80);
}

function normalizeLexiconTerm(item: string): string {
  const text = item.replace(/[[\]#`*_>~|]/g, '').trim();
  if (!text) return '';
  if (/[\u3400-\u9fff]/u.test(text)) {
    const match = text.match(/[\u3400-\u9fff]{2,12}/u);
    const term = match?.[0] ?? '';
    return isLowValueLexiconTerm(term) ? '' : term;
  }
  return text.match(/[A-Za-z][A-Za-z0-9_-]{2,24}/)?.[0] ?? '';
}

function isLowValueLexiconTerm(term: string): boolean {
  return /^[的是了在和与及或而但并就都很更再也还又把被对为以中上下一个可以需要应该因为所以这里那里这种这个]+$/u.test(
    term,
  );
}

function passesLexiconLanguage(term: string, context: CompletionContext): boolean {
  const hasCjk = /[\u3400-\u9fff]/u.test(term);
  const hasLatin = /[A-Za-z]/.test(term);
  if (context.languageHint === 'zh') return hasCjk && !hasLatin;
  if (context.languageHint === 'en') return hasLatin && !hasCjk;
  return true;
}

function compareLayeredCandidates(
  a: CompletionCandidate,
  b: CompletionCandidate,
  preferredLayers: readonly CompletionSourceLayer[],
): number {
  const confidenceDelta = b.confidence - a.confidence;
  if (Math.abs(confidenceDelta) >= LAYER_OVERRIDE_CONFIDENCE_DELTA) return confidenceDelta;

  const aRank = getLayerRank(a.sourceLayer, preferredLayers);
  const bRank = getLayerRank(b.sourceLayer, preferredLayers);
  if (aRank !== bRank) return aRank - bRank;
  return confidenceDelta;
}

function getLayerRank(
  sourceLayer: CompletionSourceLayer | undefined,
  preferredLayers: readonly CompletionSourceLayer[],
): number {
  const index = sourceLayer ? preferredLayers.indexOf(sourceLayer) : -1;
  return index >= 0 ? index : preferredLayers.length;
}

function getLexiconPrefix(context: CompletionContext): string {
  const beforeCursor = context.sentencePrefix || context.line?.beforeCursor || '';
  if (context.languageHint === 'zh') {
    return beforeCursor.match(/[\u3400-\u9fff]{1,8}$/u)?.[0] ?? '';
  }
  if (context.languageHint === 'en') {
    return beforeCursor.match(/[A-Za-z][A-Za-z0-9_-]{1,24}$/)?.[0] ?? '';
  }
  return '';
}

function lexiconCandidate(
  text: string,
  context: CompletionContext,
  confidence: number,
): CompletionCandidate {
  return {
    text,
    confidence,
    from: context.cursorPos,
    providerId: 'lexicon',
    source: 'recent',
    sourceLayer: 'provider',
    syntaxType: 'lexicon',
    learnable: true,
    priority: LEXICON_PRIORITY,
  };
}

function structuredCandidate(args: {
  providerId: string;
  text: string;
  confidence: number;
  syntaxType: string;
  priority: number;
}): CompletionCandidate {
  return {
    text: args.text,
    confidence: args.confidence,
    from: 0,
    providerId: args.providerId,
    source: 'structured',
    sourceLayer: 'provider',
    syntaxType: args.syntaxType,
    learnable: false,
    priority: args.priority,
  };
}
