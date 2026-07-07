import {
  type NGramTable,
  type PredictionResult,
  scanDocument,
  learn as ngramLearn,
  rejectPrediction,
  mergeInto,
  pruneTable,
  serialize,
  deserialize,
  estimateSize,
} from '@/utils/ngram-engine';
import type { CompletionSettings } from './CompletionSettings';
import { DEFAULT_COMPLETION_SETTINGS } from './CompletionSettings';
import {
  buildCompletionContext,
  detectOpenFormat,
  detectSyntaxContext,
  extractContext,
  getLineAt,
  isDisabledContext,
  isInFencedCode,
  isInFrontmatter,
} from './completion/context';
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
} from './completion/providers';
import {
  clearCompletionMetrics,
  recordProviderAccepted,
  recordProviderRejected,
  recordProviderShown,
} from './completion/metrics';
import { resolveCompletion } from './completion/resolver';
import type {
  CompletionAblationMode,
  CompletionCandidate,
  CompletionContext,
  CompletionProvider,
  CompletionSourceLayer,
  PredictorIndexData,
  SyntaxContext,
  SyntaxType,
} from './completion/types';

export type { PredictorIndexData, SyntaxContext, SyntaxType };

const L2_STORAGE_KEY = 'markluck:ngram:v2';
const L2_META_KEY = 'markluck:ngram:meta';
const SHORT_L2_STORAGE_KEY = 'markluck:ngram:short:v1';
export const ACCEPTED_LEXICON_STORAGE_KEY = 'markluck:autocomplete:acceptedLexicon:v1';

interface L2Meta {
  v?: number;
  schemaVersion: number;
  docs: number;
  totalEntries: number;
  lastSave: number;
  lastError?: string;
  migratedFrom?: number;
}

interface CompletionFeedbackOptions {
  learn?: boolean;
}

function normalizeL2Meta(meta: Partial<L2Meta>): L2Meta {
  const legacyVersion = meta.v;
  return {
    schemaVersion: 3,
    docs: Number.isFinite(meta.docs) ? Number(meta.docs) : 0,
    totalEntries: Number.isFinite(meta.totalEntries) ? Number(meta.totalEntries) : 0,
    lastSave: Number.isFinite(meta.lastSave) ? Number(meta.lastSave) : 0,
    migratedFrom: legacyVersion && legacyVersion < 3 ? legacyVersion : meta.migratedFrom,
    lastError: typeof meta.lastError === 'string' ? meta.lastError : undefined,
  };
}

export class MarkdownPredictor {
  private l1: NGramTable = new Map();
  private l2: NGramTable = new Map();
  private l3: NGramTable = new Map();
  private shortL1: NGramTable = new Map();
  private shortL2: NGramTable = new Map();
  private l2Meta: L2Meta = { schemaVersion: 3, docs: 0, totalEntries: 0, lastSave: 0 };
  private indexData: PredictorIndexData | null = null;
  private accessTimestamps = new Map<string, number>();
  private entryFlags = new Map<string, 'b' | 'u'>();
  private initialized: Promise<void> | null = null;
  private settings: CompletionSettings = { ...DEFAULT_COMPLETION_SETTINGS };
  private recentPhrases: string[] = [];
  private documentLexicon: string[] = [];
  private acceptedLexicon: string[] = [];
  private rejectionCounts = new Map<string, number>();
  private acceptedBoosts = new Map<string, number>();
  private ablationMode: CompletionAblationMode = 'full-stack';
  private lastPredictionProviderId: string | null = null;
  private lastPredictionSourceLayer: CompletionSourceLayer | undefined;
  private lastPredictionFeedbackKey: string | null = null;
  private lastPredictionRejectionKey: string | null = null;

  constructor(private readonly n: number = 4) {}

  setIndexData(data: PredictorIndexData): void {
    this.indexData = data;
  }

  configure(settings: Partial<CompletionSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  setAblationMode(mode: CompletionAblationMode): void {
    this.ablationMode = mode;
  }

  getSettings(): CompletionSettings {
    return { ...this.settings };
  }

  async initialize(): Promise<void> {
    this.initialized ??= this.initializeOnce();
    return this.initialized;
  }

  async loadBaseline(): Promise<void> {
    this.l3 = new Map();
    for (const url of getBaselineUrls()) {
      try {
        const resp = await fetch(url);
        if (!resp.ok) continue;
        this.l3 = deserialize(await resp.text());
        for (const ctx of this.l3.keys()) this.entryFlags.set(ctx, 'b');
        return;
      } catch {
        // Try the next baseline URL. The editor remains usable without L3 data.
      }
    }
  }

  getGhostText(cursorPos: number, doc: string): PredictionResult | null {
    if (!this.settings.enabled) return null;
    const start = performance.now();
    const context = buildCompletionContext({
      doc,
      cursorPos,
      settings: this.settings,
      indexData: this.indexData,
      n: this.n,
    });
    if (context.disabled) return null;
    if (
      !context.emptyLine &&
      this.extractContext(cursorPos, doc).length < 2 &&
      context.syntax.type === 'general'
    ) {
      return null;
    }

    const { candidate } = resolveCompletion(context, this.createProviders(), {
      getRejectionCount: (item, itemContext) =>
        this.rejectionCounts.get(this.getRejectionKey(item, itemContext)) ?? 0,
      getBoost: (item, itemContext) =>
        Math.min(
          0.12,
          (this.acceptedBoosts.get(this.getFeedbackKey(item, itemContext)) ?? 0) * 0.04,
        ),
    });
    this.lastPredictionProviderId = candidate?.providerId ?? null;
    this.lastPredictionSourceLayer = candidate?.sourceLayer;
    this.lastPredictionFeedbackKey = candidate ? this.getFeedbackKey(candidate, context) : null;
    this.lastPredictionRejectionKey = candidate ? this.getRejectionKey(candidate, context) : null;
    if (!candidate) return null;

    const result = this.toPredictionResult(candidate);
    recordProviderShown(candidate, performance.now() - start);
    return result;
  }

  acceptCompletion(
    ctx: string,
    acceptedText: string,
    options: CompletionFeedbackOptions = {},
  ): void {
    const shouldLearn = options.learn ?? true;
    if (shouldLearn) {
      const now = Date.now();
      this.accessTimestamps.set(ctx, now);
      this.entryFlags.set(ctx, 'u');
      ngramLearn(this.l1, ctx, acceptedText, this.n);
      ngramLearn(this.l2, ctx, acceptedText, this.n);
      if (ctx.length >= 2) ngramLearn(this.shortL2, ctx.slice(-2), acceptedText.slice(0, 6), 2);
      this.rememberRecentPhrase(ctx + acceptedText);
      this.rememberAcceptedLexicon(acceptedText);
      this.saveToLocalStorage();
    }
    if (this.lastPredictionRejectionKey) {
      this.rejectionCounts.delete(this.lastPredictionRejectionKey);
    }
    if (this.lastPredictionFeedbackKey) {
      this.acceptedBoosts.set(
        this.lastPredictionFeedbackKey,
        (this.acceptedBoosts.get(this.lastPredictionFeedbackKey) ?? 0) + 1,
      );
    }
    recordProviderAccepted(
      this.lastPredictionProviderId,
      this.lastPredictionSourceLayer,
      acceptedText.length,
    );
  }

  rejectCompletion(
    ctx: string,
    rejectedText: string,
    options: CompletionFeedbackOptions = {},
  ): void {
    if (options.learn ?? true) {
      rejectPrediction(this.l1, ctx, rejectedText);
      rejectPrediction(this.l2, ctx, rejectedText);
      if (ctx.length >= 2) rejectPrediction(this.shortL2, ctx.slice(-2), rejectedText);
    }
    if (this.lastPredictionRejectionKey) {
      this.rejectionCounts.set(
        this.lastPredictionRejectionKey,
        (this.rejectionCounts.get(this.lastPredictionRejectionKey) ?? 0) + 1,
      );
    }
    recordProviderRejected(this.lastPredictionProviderId, this.lastPredictionSourceLayer);
  }

  scanOpenedDocument(text: string): void {
    this.l1 = scanDocument(text, this.n);
    this.shortL1 = this.scanShortDocument(text);
    this.documentLexicon = extractLexiconTerms(text);
  }

  ingestDocument(_path: string, text: string, persist = true): void {
    mergeInto(this.l2, pruneTable(scanDocument(text, this.n), 1, 4));
    mergeInto(this.shortL2, pruneTable(this.scanShortDocument(text), 1, 4));
    this.l2Meta.docs++;
    this.l2Meta.totalEntries = this.l2.size + this.shortL2.size;
    this.maybeEliminate();
    if (persist) this.saveToLocalStorage();
  }

  closeDocument(): void {
    mergeInto(this.l2, pruneTable(this.l1, 3, 3));
    mergeInto(this.shortL2, pruneTable(this.shortL1, 2, 3));
    this.l1.clear();
    this.shortL1.clear();
    this.l2Meta.docs++;
    this.l2Meta.totalEntries = this.l2.size + this.shortL2.size;
    this.maybeEliminate();
    this.saveToLocalStorage();
  }

  clearLearningData(): void {
    this.l2 = new Map();
    this.shortL2 = new Map();
    this.recentPhrases = [];
    this.acceptedLexicon = [];
    this.rejectionCounts.clear();
    this.acceptedBoosts.clear();
    this.accessTimestamps.clear();
    this.entryFlags.clear();
    this.lastPredictionProviderId = null;
    this.lastPredictionSourceLayer = undefined;
    this.lastPredictionFeedbackKey = null;
    this.lastPredictionRejectionKey = null;
    this.l2Meta = { schemaVersion: 3, docs: 0, totalEntries: 0, lastSave: Date.now() };

    localStorage.removeItem(L2_STORAGE_KEY);
    localStorage.removeItem(SHORT_L2_STORAGE_KEY);
    localStorage.removeItem(L2_META_KEY);
    localStorage.removeItem(ACCEPTED_LEXICON_STORAGE_KEY);
    clearCompletionMetrics();
  }

  detectSyntaxContext(cursorPos: number, doc: string): SyntaxContext {
    return detectSyntaxContext(cursorPos, doc);
  }

  isDisabledContext(cursorPos: number, doc: string): boolean {
    return isDisabledContext(cursorPos, doc);
  }

  ingestExcerpts(excerpts: string[]): void {
    for (const text of excerpts) {
      if (text.length < 2) continue;
      mergeInto(this.l2, scanDocument(text, this.n));
      mergeInto(this.shortL2, this.scanShortDocument(text));
    }
    this.l2Meta.totalEntries = this.l2.size + this.shortL2.size;
    this.saveToLocalStorage();
  }

  private async initializeOnce(): Promise<void> {
    this.loadFromLocalStorage();
    await this.loadBaseline();
  }

  private createProviders(): CompletionProvider[] {
    return [
      new FormatClosureProvider(),
      new MarkdownStructureProvider(),
      new WikiLinkProvider(),
      new TagProvider(),
      new FilePathProvider(),
      ...(this.ablationMode === 'full-stack' || this.ablationMode === 'provider-only'
        ? [
            new SequencePatternProvider(),
            new LineEchoProvider(),
            new LexiconProvider(() => this.getNgramProviderState()),
            new PhraseSlotProvider(),
            new RecentPhraseProvider(() => this.getNgramProviderState()),
          ]
        : []),
      ...(this.ablationMode === 'provider-only'
        ? [new ShortEnglishProvider()]
        : [
            new ShortChineseProvider(() => this.getNgramProviderState()),
            ...(this.ablationMode === 'full-stack' ? [new ShortEnglishProvider()] : []),
            new NgramProvider(() => this.getNgramProviderState()),
          ]),
    ];
  }

  private getNgramProviderState(): NgramProviderState {
    return {
      n: this.n,
      l1: this.l1,
      l2: this.l2,
      l3: this.l3,
      shortL1: this.shortL1,
      shortL2: this.shortL2,
      ablationMode: this.ablationMode,
      recentPhrases: this.recentPhrases,
      lexiconTerms: [...this.documentLexicon, ...this.acceptedLexicon],
      qualityGate: (result, cursorPos, doc) => this.applyQualityGate(result, cursorPos, doc),
    };
  }

  private toPredictionResult(candidate: CompletionCandidate): PredictionResult {
    return {
      text: candidate.text,
      confidence: candidate.confidence,
      from: candidate.from,
      source: candidate.source === 'recent' ? 'ngram' : candidate.source,
      sourceLayer: candidate.sourceLayer,
      syntaxType: candidate.syntaxType,
      providerId: candidate.providerId,
      learnable: candidate.learnable,
    };
  }

  private rememberRecentPhrase(text: string): void {
    const phrase = text.trim();
    if (phrase.length < 4) return;
    this.recentPhrases = [phrase, ...this.recentPhrases.filter((item) => item !== phrase)].slice(
      0,
      50,
    );
  }

  private rememberAcceptedLexicon(text: string): void {
    const terms = extractLexiconTerms(text);
    if (terms.length === 0) return;
    this.acceptedLexicon = [
      ...terms,
      ...this.acceptedLexicon.filter((item) => !terms.includes(item)),
    ].slice(0, 80);
  }

  private getFeedbackKey(candidate: CompletionCandidate, context: CompletionContext): string {
    const prefix = (context.sentencePrefix || context.line?.beforeCursor || '').slice(-12);
    const paragraphKey = hashFeedbackParagraph(context.paragraphBeforeCursor);
    return `${candidate.providerId}|${candidate.syntaxType}|${context.blockType}|${paragraphKey}|${prefix}`;
  }

  private getRejectionKey(candidate: CompletionCandidate, context: CompletionContext): string {
    return `${candidate.providerId}|${candidate.syntaxType}|${context.blockType}|${context.paragraphStart}`;
  }

  private applyQualityGate(
    result: PredictionResult,
    cursorPos: number,
    doc: string,
  ): PredictionResult | null {
    const text = result.text.slice(0, this.settings.maxSuggestionLength);
    if (!text.trim()) return null;
    if (text.includes('\r') || text.includes('\n')) return null;
    if (/(.)\1{4,}/u.test(text)) return null;
    if (/^[*_#`~]{3,}/.test(text)) return null;
    if (/^\s{2,}/.test(text)) return null;

    const ctx = doc.slice(Math.max(0, cursorPos - 12), cursorPos);
    const first = text.trimStart()[0] ?? '';
    const ctxHasCjk = /[\u3400-\u9fff]/.test(ctx);
    const ctxHasAsciiWord = /[A-Za-z]{3,}/.test(ctx);
    if (ctxHasCjk && /[A-Za-z]/.test(first)) return null;
    if (ctxHasAsciiWord && /[\u3400-\u9fff]/.test(first)) return null;
    if (/[。！？!?；;：:]$/u.test(ctx.trim())) return null;

    return { ...result, text };
  }

  private scanShortDocument(text: string): NGramTable {
    const table: NGramTable = new Map();
    mergeInto(table, scanDocument(text, 2));
    mergeInto(table, scanDocument(text, 3));
    return table;
  }

  private saveToLocalStorage(): void {
    try {
      localStorage.setItem(L2_STORAGE_KEY, serialize(this.l2));
      localStorage.setItem(SHORT_L2_STORAGE_KEY, serialize(this.shortL2));
      localStorage.setItem(ACCEPTED_LEXICON_STORAGE_KEY, JSON.stringify(this.acceptedLexicon));
      this.l2Meta.lastSave = Date.now();
      this.l2Meta.totalEntries = this.l2.size + this.shortL2.size;
      this.l2Meta.schemaVersion = 3;
      this.l2Meta.lastError = undefined;
      localStorage.setItem(L2_META_KEY, JSON.stringify(this.l2Meta));
    } catch {
      this.forceEliminate();
      try {
        localStorage.setItem(L2_STORAGE_KEY, serialize(this.l2));
        localStorage.setItem(SHORT_L2_STORAGE_KEY, serialize(this.shortL2));
        localStorage.setItem(ACCEPTED_LEXICON_STORAGE_KEY, JSON.stringify(this.acceptedLexicon));
        this.l2Meta.schemaVersion = 3;
        this.l2Meta.totalEntries = this.l2.size + this.shortL2.size;
        this.l2Meta.lastSave = Date.now();
        this.l2Meta.lastError = undefined;
        localStorage.setItem(L2_META_KEY, JSON.stringify(this.l2Meta));
      } catch {
        this.l2Meta.lastError = 'storage-write-failed';
        // Storage is best-effort.
      }
    }
  }

  private loadFromLocalStorage(): void {
    try {
      const compact = localStorage.getItem(L2_STORAGE_KEY);
      if (compact) this.l2 = deserialize(compact);
      const shortCompact = localStorage.getItem(SHORT_L2_STORAGE_KEY);
      if (shortCompact) this.shortL2 = deserialize(shortCompact);
      const meta = localStorage.getItem(L2_META_KEY);
      if (meta) this.l2Meta = normalizeL2Meta(JSON.parse(meta) as Partial<L2Meta>);
      const acceptedLexicon = localStorage.getItem(ACCEPTED_LEXICON_STORAGE_KEY);
      if (acceptedLexicon) {
        const parsed = JSON.parse(acceptedLexicon) as unknown;
        this.acceptedLexicon = Array.isArray(parsed)
          ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 80)
          : [];
      }
      this.l2Meta.totalEntries = this.l2.size + this.shortL2.size;
      for (const ctx of this.l2.keys()) this.entryFlags.set(ctx, 'u');
    } catch {
      this.l2 = new Map();
      this.shortL2 = new Map();
      this.l2Meta = {
        schemaVersion: 3,
        docs: 0,
        totalEntries: 0,
        lastSave: 0,
        lastError: 'storage-read-failed',
      };
    }
  }

  private maybeEliminate(): void {
    if (estimateSize(this.l2) + estimateSize(this.shortL2) > 4.5 * 1024 * 1024) {
      this.forceEliminate(3.5 * 1024 * 1024);
    }
  }

  private forceEliminate(targetSize?: number): void {
    const target = targetSize ?? 3.5 * 1024 * 1024;
    const maxRemove = Math.floor(this.l2.size * 0.2);
    const scored: Array<{ ctx: string; score: number }> = [];
    const now = Date.now();

    for (const [ctx, preds] of this.l2) {
      const totalFreq = [...preds.values()].reduce((a, b) => a + b, 0);
      const lastAccess = this.accessTimestamps.get(ctx) ?? 0;
      const daysSinceAccess = Math.max(0, (now - lastAccess) / 86400000);
      const recencyDecay = 1 / (1 + daysSinceAccess / 30);
      const flag = this.entryFlags.get(ctx) ?? 'u';
      scored.push({ ctx, score: totalFreq * recencyDecay * (flag === 'b' ? 0.5 : 1) });
    }

    scored.sort((a, b) => a.score - b.score);
    let removed = 0;
    for (const { ctx } of scored) {
      if (estimateSize(this.l2) + estimateSize(this.shortL2) < target || removed >= maxRemove)
        break;
      this.l2.delete(ctx);
      this.shortL2.delete(ctx);
      this.accessTimestamps.delete(ctx);
      this.entryFlags.delete(ctx);
      removed++;
    }
  }

  private extractContext(cursorPos: number, doc: string): string {
    return extractContext(cursorPos, doc, this.n);
  }

  getLineAt(pos: number, doc: string): { text: string; from: number; to: number } | null {
    return getLineAt(pos, doc);
  }

  isInFencedCode(cursorPos: number, doc: string): boolean {
    return isInFencedCode(cursorPos, doc);
  }

  isInFrontmatter(cursorPos: number, doc: string): boolean {
    return isInFrontmatter(cursorPos, doc);
  }

  detectOpenFormat(lineText: string, colInLine: number): string | null {
    return detectOpenFormat(lineText, colInLine);
  }
}

function getBaselineUrls(): string[] {
  const configured = import.meta.env.DEV ? import.meta.env.VITE_AUTOCOMPLETE_BASELINE_URL : '';
  const urls = [
    configured,
    '/baseline-ngram.web-local.compact.txt',
    '/baseline-ngram.v1.compact.txt',
  ].filter(Boolean);
  return [...new Set(urls)];
}

function extractLexiconTerms(text: string): string[] {
  const counts = new Map<string, number>();
  const clean = text.replace(/```[\s\S]*?```/g, ' ').replace(/\[[^\]]+\]\([^)]+\)/g, ' ');

  for (const match of clean.matchAll(/[\u3400-\u9fff]{2,12}/gu)) {
    const segment = match[0];
    for (let size = 2; size <= Math.min(8, segment.length); size++) {
      for (let index = 0; index <= segment.length - size; index++) {
        const term = segment.slice(index, index + size);
        if (isLowValueLexiconTerm(term)) continue;
        counts.set(term, (counts.get(term) ?? 0) + 1);
      }
    }
  }

  for (const match of clean.matchAll(/[A-Za-z][A-Za-z0-9_-]{2,24}/g)) {
    const term = match[0];
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }

  return [...counts]
    .filter(([term, count]) => count >= 2 || term.length >= 4)
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .map(([term]) => term)
    .slice(0, 120);
}

function isLowValueLexiconTerm(term: string): boolean {
  return /^[的是了在和与及或而但并就都很更再也还又把被对为以中上下一个可以需要应该因为所以这里那里这种这个]+$/u.test(
    term,
  );
}

function hashFeedbackParagraph(text: string): string {
  let hash = 0;
  const sample = text.slice(-160);
  for (let index = 0; index < sample.length; index++) {
    hash = (hash * 31 + sample.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}
