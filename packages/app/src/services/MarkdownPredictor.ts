/**
 * MarkdownPredictor — 文字补全预测服务
 *
 * 统一幽灵文本管道：融合 N-gram 统计 + 结构化知识 + 语法上下文检测
 * 管理 L1(当前文档内存)、L2(localStorage 持久化) 双级缓存
 *
 * @see spec/frontend/autocomplete-spec.md
 */

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

// ---- 类型 ----

export type SyntaxType = 'wiki-link' | 'tag' | 'file-path' | 'markdown-format' | 'general';

export interface SyntaxContext {
  type: SyntaxType;
  prefix: string;
  /** 未闭合的格式标记 (仅 markdown-format 类型) */
  openMarker?: string;
}

/** IndexStore 的最小接口 — MarkdownPredictor 只需要这些数据 */
export interface PredictorIndexData {
  /** 获取所有文档标题列表 */
  getAllNoteTitles(): string[];
  /** 获取所有标签列表 */
  getAllTags(): string[];
  /** 按前缀匹配文件路径 */
  matchFilePaths(prefix: string): string[];
}

// ---- 持久化 ----

const L2_STORAGE_KEY = 'markluck:ngram:v2';
const L2_META_KEY = 'markluck:ngram:meta';

interface L2Meta {
  v: number;
  docs: number;
  totalEntries: number;
  lastSave: number;
}

// ---- 主类 ----

export class MarkdownPredictor {
  /** L1: 当前文档完整统计 (内存, 不裁剪) */
  private l1: NGramTable = new Map();

  /** L2: 全局聚合统计 (来自 localStorage + 基准) */
  private l2: NGramTable = new Map();

  /** L2 元数据 */
  private l2Meta: L2Meta = { v: 2, docs: 0, totalEntries: 0, lastSave: 0 };

  /** 结构化数据源 */
  private indexData: PredictorIndexData | null = null;

  /** 最近访问时间戳 (用于淘汰评分) */
  private accessTimestamps = new Map<string, number>();

  /** 条目来源标记 (b=基准 u=用户) */
  private entryFlags = new Map<string, 'b' | 'u'>();

  /** N-gram 上下文长度 */
  private readonly n: number;

  constructor(n: number = 4) {
    this.n = n;
  }

  // ---- 初始化 ----

  /** 设置结构化数据源 */
  setIndexData(data: PredictorIndexData): void {
    this.indexData = data;
  }

  /** 从 localStorage 恢复 L2，如不存在则从基准文件加载 */
  async initialize(): Promise<void> {
    this.loadFromLocalStorage();
    if (this.l2.size === 0) {
      await this.loadBaseline();
    }
  }

  /** 加载基准 L2 文件 */
  async loadBaseline(): Promise<void> {
    try {
      const resp = await fetch('/baseline-ngram.v1.compact.txt');
      if (!resp.ok) return;
      const text = await resp.text();
      this.l2 = deserialize(text);
      // 标记所有基准条目
      for (const ctx of this.l2.keys()) {
        this.entryFlags.set(ctx, 'b');
      }
      this.l2Meta.docs = 0;
      this.l2Meta.totalEntries = this.l2.size;
      this.saveToLocalStorage();
    } catch {
      // 基准文件不存在——纯冷启动
    }
  }

  // ---- 核心预测 ----

  /**
   * 单一预测入口：融合 N-gram + 结构化知识
   * @returns 预测结果，或 null (不显示 ghost text)
   */
  getGhostText(cursorPos: number, doc: string): PredictionResult | null {
    // 快速短路：禁用区域
    if (this.isDisabledContext(cursorPos, doc)) return null;

    const ctx = this.extractContext(cursorPos, doc);
    // 至少 2 字符才能做任何预测
    if (ctx.length < 2) return null;

    // 检测语法上下文
    const syntaxCtx = this.detectSyntaxContext(cursorPos, doc);

    // 结构化预测 ([[/#/path) — 仅需 2 字符上下文，置信度高
    let structured: PredictionResult | null = null;
    if (syntaxCtx.type !== 'general') {
      structured = this.injectStructuredKnowledge(syntaxCtx);
      if (structured && structured.confidence > 0.8) return structured;
    }

    // N-gram 预测 — 需要足够上下文避免噪声预测
    // 短上下文（2-3字符）的 N-gram 匹配噪声极高（特别是 ** → * 级联），
    // 只对 ≥4 字符的上下文做 N-gram 预测
    if (ctx.length < this.n) return structured;

    let ngram: PredictionResult | null = null;
    const l1r = ngramPredict(this.l1, cursorPos, doc, this.n, 20, 0.15);
    const l2r = ngramPredict(this.l2, cursorPos, doc, this.n, 20, 0.15);

    if (l1r && l2r) {
      ngram = l1r.confidence >= l2r.confidence ? l1r : l2r;
    } else {
      ngram = l1r || l2r;
    }

    // 结构化低/中置信度 + N-gram 存在时，优先 N-gram
    return ngram || structured;
  }

  // ---- 学习 ----

  /** Tab 接受补全时调用 */
  acceptCompletion(ctx: string, acceptedText: string): void {
    const now = Date.now();
    this.accessTimestamps.set(ctx, now);
    this.entryFlags.set(ctx, 'u');
    ngramLearn(this.l1, ctx, acceptedText, this.n);
    ngramLearn(this.l2, ctx, acceptedText, this.n);
  }

  /** Escape 拒绝补全时调用 */
  rejectCompletion(ctx: string, rejectedText: string): void {
    rejectPrediction(this.l1, ctx, rejectedText);
  }

  /** 文档打开时全量扫描构建 L1 */
  scanOpenedDocument(text: string): void {
    this.l1 = scanDocument(text, this.n);
  }

  /** 文档关闭时将 L1 合并到 L2 并持久化 */
  closeDocument(): void {
    mergeInto(this.l2, pruneTable(this.l1, 3, 3));
    this.l1.clear();
    this.l2Meta.docs++;
    this.l2Meta.totalEntries = this.l2.size;
    this.maybeEliminate();
    this.saveToLocalStorage();
  }

  // ---- 语法上下文检测 ----

  detectSyntaxContext(cursorPos: number, doc: string): SyntaxContext {
    const line = this.getLineAt(cursorPos, doc);
    if (!line) return { type: 'general', prefix: '' };
    const beforeCursor = line.text.slice(0, cursorPos - line.from);

    // Wiki-link: 光标在 [[...]] 之间
    const wikiMatch = beforeCursor.match(/\[\[([^\]]*)$/);
    if (wikiMatch) return { type: 'wiki-link', prefix: wikiMatch[1] || '' };

    // 标签: 空格后或行首的 # (排除标题 #)
    const tagMatch = beforeCursor.match(/(?:^|\s)#(\S*)$/);
    if (tagMatch && !/^#{1,6}\s/.test(line.text.trimStart())) {
      return { type: 'tag', prefix: tagMatch[1] || '' };
    }

    // 文件路径: [text](... 或 ![...](... 内
    const pathMatch = beforeCursor.match(/(?:!\[.*?\]|\[.*?\])\(([^)]*)$/);
    if (pathMatch) return { type: 'file-path', prefix: pathMatch[1] || '' };

    // Markdown 格式闭合: 检测未闭合的 ** * ` __
    const colInLine = cursorPos - line.from;
    const openMarker = this.detectOpenFormat(line.text, colInLine);
    if (openMarker) {
      const beforeCursor = line.text.slice(0, colInLine);
      const markerStart = beforeCursor.lastIndexOf(openMarker);
      const prefix = markerStart >= 0 ? beforeCursor.slice(markerStart + openMarker.length) : '';
      return { type: 'markdown-format', prefix, openMarker };
    }

    return { type: 'general', prefix: '' };
  }

  isDisabledContext(cursorPos: number, doc: string): boolean {
    // 代码块内
    if (this.isInFencedCode(cursorPos, doc)) return true;
    // frontmatter 内
    if (this.isInFrontmatter(cursorPos, doc)) return true;
    // 空行
    const line = this.getLineAt(cursorPos, doc);
    if (line && line.text.trim() === '') return true;
    return false;
  }

  // ---- 结构化知识注入 ----

  private injectStructuredKnowledge(ctx: SyntaxContext): PredictionResult | null {
    // markdown-format closure doesn't need indexData — it's pure format matching
    if (ctx.type === 'markdown-format') {
      return this.predictFormatClosure(ctx);
    }

    if (!this.indexData) return null;

    switch (ctx.type) {
      case 'wiki-link':
        return this.predictWikiLink(ctx.prefix);
      case 'tag':
        return this.predictTag(ctx.prefix);
      case 'file-path':
        return this.predictFilePath(ctx.prefix);
    }
    return null;
  }

  private predictWikiLink(prefix: string): PredictionResult | null {
    const titles = this.indexData!.getAllNoteTitles();
    if (titles.length === 0) return null;

    const q = prefix.toLowerCase();
    const matches = titles
      .filter((t) => t.toLowerCase().startsWith(q))
      .sort((a, b) => a.length - b.length); // 最短的优先

    if (matches.length === 0 || !matches[0]) return null;
    const best = matches[0];
    const remaining = best.slice(prefix.length);
    const full = remaining + ']]';

    return {
      text: full,
      confidence: matches.length === 1 ? 0.95 : 0.75,
      from: 0,
      source: 'structured',
      syntaxType: 'wiki-link',
    };
  }

  private predictTag(prefix: string): PredictionResult | null {
    const tags = this.indexData!.getAllTags();
    if (tags.length === 0) return null;

    const q = prefix.toLowerCase();
    const matches = tags
      .filter((t) => t.toLowerCase().startsWith(q))
      .sort((a, b) => tags.filter((t2) => t2 === b).length - tags.filter((t2) => t2 === a).length);

    if (matches.length === 0 || !matches[0]) return null;
    const best = matches[0];
    const remaining = best.slice(prefix.length);

    return {
      text: remaining + ' ',
      confidence: prefix.length > 0 ? 0.9 : 0.7,
      from: 0,
      source: 'structured',
      syntaxType: 'tag',
    };
  }

  private predictFilePath(prefix: string): PredictionResult | null {
    const paths = this.indexData!.matchFilePaths(prefix);
    if (paths.length === 0 || !paths[0]) return null;

    const best = paths[0];
    const remaining = best.slice(prefix.length);

    return {
      text: remaining + ')',
      confidence: paths.length === 1 ? 0.9 : 0.65,
      from: 0,
      source: 'structured',
      syntaxType: 'file-path',
    };
  }

  private predictFormatClosure(ctx: SyntaxContext): PredictionResult | null {
    const marker = ctx.openMarker;
    if (!marker) return null;

    const prefix = ctx.prefix.trim();
    const hasPrefix = prefix.length > 0;

    switch (marker) {
      case '**':
        // acceptGhost() inserts at cursor — returning prefix+marker
        // duplicates user text (e.g. **粗体粗体**). Return only the
        // closing marker when prefix exists.
        return {
          text: hasPrefix ? '**' : '粗体**',
          confidence: hasPrefix ? 0.92 : 0.85,
          from: 0,
          source: 'structured',
          syntaxType: 'markdown-format',
        };
      case '*':
        return {
          text: hasPrefix ? '*' : '斜体*',
          confidence: hasPrefix ? 0.88 : 0.8,
          from: 0,
          source: 'structured',
          syntaxType: 'markdown-format',
        };
      case '`':
        return {
          text: hasPrefix ? '`' : 'code`',
          confidence: hasPrefix ? 0.92 : 0.85,
          from: 0,
          source: 'structured',
          syntaxType: 'markdown-format',
        };
      case '__':
        return {
          text: hasPrefix ? '__' : '强调__',
          confidence: hasPrefix ? 0.88 : 0.8,
          from: 0,
          source: 'structured',
          syntaxType: 'markdown-format',
        };
      default:
        return null;
    }
  }

  // ---- 在线学习 API ----

  /** 从 IndexStore 提取 excerpt 作为 L2 种子数据 */
  ingestExcerpts(excerpts: string[]): void {
    for (const text of excerpts) {
      if (text.length < 10) continue;
      const table = scanDocument(text, this.n);
      mergeInto(this.l2, table);
    }
    this.l2Meta.totalEntries = this.l2.size;
  }

  // ---- 持久化 ----

  private saveToLocalStorage(): void {
    try {
      const compact = serialize(this.l2);
      localStorage.setItem(L2_STORAGE_KEY, compact);
      this.l2Meta.lastSave = Date.now();
      this.l2Meta.totalEntries = this.l2.size;
      localStorage.setItem(L2_META_KEY, JSON.stringify(this.l2Meta));
    } catch {
      // localStorage 满 — 触发淘汰后重试
      this.forceEliminate();
      try {
        localStorage.setItem(L2_STORAGE_KEY, serialize(this.l2));
        localStorage.setItem(L2_META_KEY, JSON.stringify(this.l2Meta));
      } catch {
        // 仍然失败 — 放弃本次保存
      }
    }
  }

  private loadFromLocalStorage(): void {
    try {
      const compact = localStorage.getItem(L2_STORAGE_KEY);
      if (compact) {
        this.l2 = deserialize(compact);
      }
      const meta = localStorage.getItem(L2_META_KEY);
      if (meta) {
        this.l2Meta = JSON.parse(meta);
      }
      // 还原 flags
      for (const [ctx] of this.l2) {
        // 存量数据默认标记为用户数据 (无 flag 信息时)
        this.entryFlags.set(ctx, 'u');
      }
    } catch {
      this.l2 = new Map();
    }
  }

  // ---- 末位淘汰 ----

  /** 检查是否需要淘汰，4.5MB 触发 */
  private maybeEliminate(): void {
    const size = estimateSize(this.l2);
    if (size > 4.5 * 1024 * 1024) {
      this.forceEliminate(3.5 * 1024 * 1024);
    }
  }

  /** 强制执行淘汰到目标大小 */
  private forceEliminate(targetSize?: number): void {
    const target = targetSize ?? 3.5 * 1024 * 1024;
    const maxRemove = Math.floor(this.l2.size * 0.2); // 最多淘汰 20%

    const scored: Array<{ ctx: string; score: number }> = [];
    const now = Date.now();

    for (const [ctx, preds] of this.l2) {
      const totalFreq = [...preds.values()].reduce((a, b) => a + b, 0);
      const lastAccess = this.accessTimestamps.get(ctx) ?? 0;
      const daysSinceAccess = Math.max(0, (now - lastAccess) / 86400000);
      const recencyDecay = 1 / (1 + daysSinceAccess / 30);
      const flag = this.entryFlags.get(ctx) ?? 'u';
      const sourceWeight = flag === 'b' ? 0.5 : 1.0;

      scored.push({ ctx, score: totalFreq * recencyDecay * sourceWeight });
    }

    scored.sort((a, b) => a.score - b.score); // 升序：末位最低分

    let removed = 0;
    for (const { ctx } of scored) {
      if (estimateSize(this.l2) < target || removed >= maxRemove) break;
      this.l2.delete(ctx);
      this.accessTimestamps.delete(ctx);
      this.entryFlags.delete(ctx);
      removed++;
    }
  }

  // ---- 内部辅助 ----

  private extractContext(cursorPos: number, doc: string): string {
    const start = Math.max(0, cursorPos - this.n);
    return doc.slice(start, cursorPos);
  }

  private getLineAt(pos: number, doc: string): { text: string; from: number; to: number } | null {
    let lineStart = 0;
    for (let i = 0; i < doc.length; i++) {
      if (doc[i] === '\n') {
        if (pos >= lineStart && pos <= i + 1) {
          return { text: doc.slice(lineStart, i), from: lineStart, to: i };
        }
        lineStart = i + 1;
      }
    }
    if (pos >= lineStart) {
      return { text: doc.slice(lineStart), from: lineStart, to: doc.length };
    }
    return null;
  }

  private isInFencedCode(cursorPos: number, doc: string): boolean {
    let inFence = false;
    let pos = 0;
    for (const line of doc.split('\n')) {
      const lineEnd = pos + line.length;
      if (line.startsWith('```')) {
        if (cursorPos >= pos && cursorPos <= lineEnd) return true; // fence line itself
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
    if (lines.length === 0 || !lines[0] || lines[0].trim() !== '---') return false;
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

    // 计算各标记的奇偶出现次数—奇数=未闭合
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
    // 排除 ** 中的单 *
    const singleStars = before.match(/(?<!\*)\*(?!\*)/g);
    if (singleStars && singleStars.length % 2 === 1) return '*';
    if (countMarker('`')) return '`';

    return null;
  }
}
