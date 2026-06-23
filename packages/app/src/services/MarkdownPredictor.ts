import {
  type NGramTable,
  type PredictionResult,
  scanDocument,
  predict as ngramPredict,
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

export type SyntaxType =
  | 'wiki-link'
  | 'tag'
  | 'file-path'
  | 'markdown-format'
  | 'markdown-structure'
  | 'general';

export interface SyntaxContext {
  type: SyntaxType;
  prefix: string;
  openMarker?: string;
}

export interface PredictorIndexData {
  getAllNoteTitles(): string[];
  getAllTags(): string[];
  matchFilePaths(prefix: string): string[];
}

const L2_STORAGE_KEY = 'markluck:ngram:v2';
const L2_META_KEY = 'markluck:ngram:meta';
const SHORT_L2_STORAGE_KEY = 'markluck:ngram:short:v1';

interface L2Meta {
  v: number;
  docs: number;
  totalEntries: number;
  lastSave: number;
}

const SHORT_ZH_FALLBACKS: Array<[string, string]> = [
  ['这是', '一个'],
  ['为了', '更好'],
  ['用户', '可以'],
  ['项目', '进度'],
  ['今天', '的'],
  ['需要', '注意'],
  ['我们', '可以'],
  ['如果', '需要'],
  ['可以', '继续'],
  ['目前', '已经'],
];

export class MarkdownPredictor {
  private l1: NGramTable = new Map();
  private l2: NGramTable = new Map();
  private l3: NGramTable = new Map();
  private shortL1: NGramTable = new Map();
  private shortL2: NGramTable = new Map();
  private l2Meta: L2Meta = { v: 2, docs: 0, totalEntries: 0, lastSave: 0 };
  private indexData: PredictorIndexData | null = null;
  private accessTimestamps = new Map<string, number>();
  private entryFlags = new Map<string, 'b' | 'u'>();
  private initialized: Promise<void> | null = null;
  private settings: CompletionSettings = { ...DEFAULT_COMPLETION_SETTINGS };

  constructor(private readonly n: number = 4) {}

  setIndexData(data: PredictorIndexData): void {
    this.indexData = data;
  }

  configure(settings: Partial<CompletionSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  getSettings(): CompletionSettings {
    return { ...this.settings };
  }

  async initialize(): Promise<void> {
    this.initialized ??= this.initializeOnce();
    return this.initialized;
  }

  async loadBaseline(): Promise<void> {
    try {
      const resp = await fetch('/baseline-ngram.v1.compact.txt');
      if (!resp.ok) return;
      this.l3 = deserialize(await resp.text());
      for (const ctx of this.l3.keys()) this.entryFlags.set(ctx, 'b');
    } catch {
      this.l3 = new Map();
    }
  }

  getGhostText(cursorPos: number, doc: string): PredictionResult | null {
    if (!this.settings.enabled) return null;
    if (this.isInFencedCode(cursorPos, doc) || this.isInFrontmatter(cursorPos, doc)) return null;

    const line = this.getLineAt(cursorPos, doc);
    const emptyLine = line ? line.text.trim() === '' : doc.length === 0;
    const syntaxCtx = this.detectSyntaxContext(cursorPos, doc);

    const structured = this.injectStructuredKnowledge(syntaxCtx);
    if (structured && structured.confidence >= 0.8) return structured;

    if (emptyLine) return structured;
    if (this.extractContext(cursorPos, doc).length < 2) return structured;

    const shortZh = this.predictShortChinese(cursorPos, doc);
    if (shortZh) return shortZh;

    const maxLen = this.settings.maxSuggestionLength;
    const minConfidence = this.settings.minConfidence;
    const candidates = [
      ngramPredict(this.l1, cursorPos, doc, this.n, maxLen, minConfidence),
      ngramPredict(this.l2, cursorPos, doc, this.n, maxLen, minConfidence),
      ngramPredict(this.l3, cursorPos, doc, this.n, maxLen, minConfidence),
    ]
      .filter((r): r is PredictionResult => !!r)
      .map((r) => this.applyQualityGate(r, cursorPos, doc))
      .filter((r): r is PredictionResult => !!r);

    candidates.sort((a, b) => b.confidence - a.confidence);
    return candidates[0] ?? structured;
  }

  acceptCompletion(ctx: string, acceptedText: string): void {
    const now = Date.now();
    this.accessTimestamps.set(ctx, now);
    this.entryFlags.set(ctx, 'u');
    ngramLearn(this.l1, ctx, acceptedText, this.n);
    ngramLearn(this.l2, ctx, acceptedText, this.n);
    if (ctx.length >= 2) ngramLearn(this.shortL2, ctx.slice(-2), acceptedText.slice(0, 6), 2);
    this.saveToLocalStorage();
  }

  rejectCompletion(ctx: string, rejectedText: string): void {
    rejectPrediction(this.l1, ctx, rejectedText);
    rejectPrediction(this.l2, ctx, rejectedText);
    if (ctx.length >= 2) rejectPrediction(this.shortL2, ctx.slice(-2), rejectedText);
  }

  scanOpenedDocument(text: string): void {
    this.l1 = scanDocument(text, this.n);
    this.shortL1 = this.scanShortDocument(text);
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

  detectSyntaxContext(cursorPos: number, doc: string): SyntaxContext {
    const line = this.getLineAt(cursorPos, doc);
    if (!line) return { type: 'general', prefix: '' };
    const colInLine = cursorPos - line.from;
    const beforeCursor = line.text.slice(0, colInLine);
    const trimmed = beforeCursor.trimStart();

    if (/^[-*+]\s?$/.test(trimmed)) return { type: 'markdown-structure', prefix: trimmed };
    if (/^#{1,6}\s?$/.test(trimmed)) return { type: 'markdown-structure', prefix: trimmed };
    if (/^>\s?$/.test(trimmed)) return { type: 'markdown-structure', prefix: trimmed };

    const wikiMatch = beforeCursor.match(/\[\[([^\]]*)$/);
    if (wikiMatch) return { type: 'wiki-link', prefix: wikiMatch[1] || '' };

    const tagMatch = beforeCursor.match(/(?:^|\s)#(\S*)$/);
    if (tagMatch && !/^#{1,6}\s/.test(line.text.trimStart())) {
      return { type: 'tag', prefix: tagMatch[1] || '' };
    }

    const pathMatch = beforeCursor.match(/(?:!\[.*?\]|\[.*?\])\(([^)]*)$/);
    if (pathMatch) return { type: 'file-path', prefix: pathMatch[1] || '' };

    const openMarker = this.detectOpenFormat(line.text, colInLine);
    if (openMarker) {
      const markerStart = beforeCursor.lastIndexOf(openMarker);
      const prefix = markerStart >= 0 ? beforeCursor.slice(markerStart + openMarker.length) : '';
      return { type: 'markdown-format', prefix, openMarker };
    }

    return { type: 'general', prefix: '' };
  }

  isDisabledContext(cursorPos: number, doc: string): boolean {
    if (this.isInFencedCode(cursorPos, doc) || this.isInFrontmatter(cursorPos, doc)) return true;
    const line = this.getLineAt(cursorPos, doc);
    return !!line && line.text.trim() === '';
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

  private injectStructuredKnowledge(ctx: SyntaxContext): PredictionResult | null {
    if (ctx.type === 'markdown-format') return this.predictFormatClosure(ctx);
    if (ctx.type === 'markdown-structure') return this.predictMarkdownStructure(ctx);
    if (!this.indexData) return null;
    if (ctx.type === 'wiki-link') return this.predictWikiLink(ctx.prefix);
    if (ctx.type === 'tag') return this.predictTag(ctx.prefix);
    if (ctx.type === 'file-path') return this.predictFilePath(ctx.prefix);
    return null;
  }

  private predictWikiLink(prefix: string): PredictionResult | null {
    const titles = this.indexData!.getAllNoteTitles();
    const q = prefix.toLowerCase();
    const matches = titles
      .filter((t) => t.toLowerCase().startsWith(q))
      .sort((a, b) => a.length - b.length);
    if (!matches[0]) return null;
    const best = matches[0];
    return {
      text: best.slice(prefix.length) + ']]',
      confidence: matches.length === 1 ? 0.95 : 0.75,
      from: 0,
      source: 'structured',
      syntaxType: 'wiki-link',
    };
  }

  private predictTag(prefix: string): PredictionResult | null {
    const q = prefix.toLowerCase();
    const matches = this.indexData!.getAllTags().filter((t) => t.toLowerCase().startsWith(q));
    if (!matches[0]) return null;
    return {
      text: matches[0].slice(prefix.length) + ' ',
      confidence: prefix.length > 0 ? 0.9 : 0.7,
      from: 0,
      source: 'structured',
      syntaxType: 'tag',
    };
  }

  private predictFilePath(prefix: string): PredictionResult | null {
    const paths = this.indexData!.matchFilePaths(prefix);
    if (!paths[0]) return null;
    return {
      text: paths[0].slice(prefix.length) + ')',
      confidence: paths.length === 1 ? 0.9 : 0.65,
      from: 0,
      source: 'structured',
      syntaxType: 'file-path',
    };
  }

  private predictMarkdownStructure(ctx: SyntaxContext): PredictionResult | null {
    const prefix = ctx.prefix;
    const text =
      prefix.startsWith('-') || prefix.startsWith('*') || prefix.startsWith('+')
        ? '[ ] '
        : prefix.startsWith('#')
          ? '标题'
          : '引用';
    return {
      text,
      confidence: 0.82,
      from: 0,
      source: 'structured',
      syntaxType: 'markdown-structure',
    };
  }

  private predictFormatClosure(ctx: SyntaxContext): PredictionResult | null {
    const marker = ctx.openMarker;
    if (!marker) return null;
    const prefix = ctx.prefix.trim();
    const hasPrefix = prefix.length > 0;
    const placeholders: Record<string, string> = {
      '**': '粗体**',
      '*': '斜体*',
      '`': 'code`',
      __: '强调__',
    };
    return {
      text: hasPrefix ? marker : (placeholders[marker] ?? marker),
      confidence: hasPrefix ? 0.92 : 0.85,
      from: 0,
      source: 'structured',
      syntaxType: 'markdown-format',
    };
  }

  private predictShortChinese(cursorPos: number, doc: string): PredictionResult | null {
    const ctx2 = doc.slice(Math.max(0, cursorPos - 2), cursorPos);
    const ctx3 = doc.slice(Math.max(0, cursorPos - 3), cursorPos);
    if (!/[\u3400-\u9fff]/.test(ctx2 + ctx3)) return null;

    const candidates = [
      ngramPredict(this.shortL1, cursorPos, doc, 2, 6, 0.55),
      ngramPredict(this.shortL2, cursorPos, doc, 2, 6, 0.55),
    ]
      .filter((r): r is PredictionResult => !!r)
      .map((r) => ({ ...r, confidence: Math.min(0.76, r.confidence), syntaxType: 'short-zh' }))
      .map((r) => this.applyQualityGate(r, cursorPos, doc))
      .filter((r): r is PredictionResult => !!r);

    const fixed = SHORT_ZH_FALLBACKS.find(([prefix]) => ctx2 === prefix || ctx3.endsWith(prefix));
    if (fixed) {
      candidates.push({
        text: fixed[1],
        confidence: 0.62,
        from: cursorPos,
        source: 'ngram',
        syntaxType: 'short-zh',
      });
    }

    candidates.sort((a, b) => b.confidence - a.confidence);
    return candidates[0] ?? null;
  }

  private applyQualityGate(
    result: PredictionResult,
    cursorPos: number,
    doc: string,
  ): PredictionResult | null {
    const text = result.text.slice(0, this.settings.maxSuggestionLength);
    if (!text.trim()) return null;
    if (text.includes('\r')) return null;
    if (/(.)\1{4,}/u.test(text)) return null;
    if (/^[*_#`~]{3,}/.test(text)) return null;
    if (/^\s{2,}/.test(text)) return null;

    const ctx = doc.slice(Math.max(0, cursorPos - 12), cursorPos);
    const first = text.trimStart()[0] ?? '';
    const ctxHasCjk = /[\u3400-\u9fff]/.test(ctx);
    const ctxHasAsciiWord = /[A-Za-z]{3,}/.test(ctx);
    if (ctxHasCjk && /[A-Za-z]/.test(first)) return null;
    if (ctxHasAsciiWord && /[\u3400-\u9fff]/.test(first)) return null;
    if (/[。！？!?；;：:]$/.test(ctx.trim())) return null;

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
      this.l2Meta.lastSave = Date.now();
      this.l2Meta.totalEntries = this.l2.size + this.shortL2.size;
      localStorage.setItem(L2_META_KEY, JSON.stringify(this.l2Meta));
    } catch {
      this.forceEliminate();
      try {
        localStorage.setItem(L2_STORAGE_KEY, serialize(this.l2));
        localStorage.setItem(SHORT_L2_STORAGE_KEY, serialize(this.shortL2));
        localStorage.setItem(L2_META_KEY, JSON.stringify(this.l2Meta));
      } catch {
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
      if (meta) this.l2Meta = JSON.parse(meta) as L2Meta;
      for (const ctx of this.l2.keys()) this.entryFlags.set(ctx, 'u');
    } catch {
      this.l2 = new Map();
      this.shortL2 = new Map();
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
    return doc.slice(Math.max(0, cursorPos - this.n), cursorPos);
  }

  private getLineAt(pos: number, doc: string): { text: string; from: number; to: number } | null {
    let lineStart = 0;
    for (let i = 0; i < doc.length; i++) {
      if (doc[i] === '\n') {
        if (pos >= lineStart && pos <= i + 1)
          return { text: doc.slice(lineStart, i), from: lineStart, to: i };
        lineStart = i + 1;
      }
    }
    if (pos >= lineStart) return { text: doc.slice(lineStart), from: lineStart, to: doc.length };
    return null;
  }

  private isInFencedCode(cursorPos: number, doc: string): boolean {
    let inFence = false;
    let pos = 0;
    for (const line of doc.split('\n')) {
      const lineEnd = pos + line.length;
      if (line.startsWith('```')) {
        if (cursorPos >= pos && cursorPos <= lineEnd) return true;
        inFence = !inFence;
      } else if (inFence && cursorPos >= pos && cursorPos <= lineEnd) {
        return true;
      }
      pos = lineEnd + 1;
    }
    return false;
  }

  private isInFrontmatter(cursorPos: number, doc: string): boolean {
    const lines = doc.split('\n');
    if (lines[0]?.trim() !== '---') return false;
    let fmEnd = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i]?.trim() === '---') {
        fmEnd = i;
        break;
      }
    }
    if (fmEnd === -1) return false;
    let pos = 0;
    for (let i = 0; i <= fmEnd; i++) {
      const ln = lines[i] ?? '';
      const lineEnd = pos + ln.length;
      if (cursorPos >= pos && cursorPos <= lineEnd) return true;
      pos = lineEnd + 1;
    }
    return false;
  }

  private detectOpenFormat(lineText: string, colInLine: number): string | null {
    const before = lineText.slice(0, colInLine);
    const countMarker = (marker: string): boolean => {
      let count = 0;
      let idx = 0;
      while ((idx = before.indexOf(marker, idx)) !== -1) {
        count++;
        idx += marker.length;
      }
      return count % 2 === 1;
    };

    if (countMarker('**')) return '**';
    if (countMarker('__')) return '__';
    const singleStars = before.match(/(?<!\*)\*(?!\*)/g);
    if (singleStars && singleStars.length % 2 === 1) return '*';
    if (countMarker('`')) return '`';
    return null;
  }
}
