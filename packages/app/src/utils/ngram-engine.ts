/**
 * ngram-engine — 纯算法 N-gram 统计预测引擎
 *
 * 零外部依赖，纯 TypeScript。所有方法是纯函数或操作 Map 数据结构。
 * MarkdownPredictor 服务层封装持久化、淘汰和多源融合逻辑。
 *
 * @see spec/frontend/autocomplete-spec.md
 */

// ---- 类型 ----

/** N-gram 统计表：上下文(4字符) → 下一字符 → 频次 */
export type NGramTable = Map<string, Map<string, number>>;

/** 预测结果 */
export interface PredictionResult {
  /** 预测文本 (1-20 字符) */
  text: string;
  /** 置信度 0-1 */
  confidence: number;
  /** 预测起点在文档中的位置 */
  from: number;
  /** 预测来源。结构化补全不应被当作 N-gram 样本回写。 */
  source?: 'ngram' | 'structured';
  /** 结构化补全的语法类别。 */
  syntaxType?: string;
}

// ---- 扫描 ----

/**
 * 扫描文本，构建 N-gram 统计表。
 * @param text 输入文本
 * @param n 上下文长度 (默认 4)
 * @returns N-gram 统计表 (ctx → nextChar → count)
 */
export function scanText(text: string, n: number = 4): NGramTable {
  const table: NGramTable = new Map();
  for (let i = 0; i < text.length - n; i++) {
    const ctx = text.slice(i, i + n);
    const next = text[i + n];
    if (next === undefined) break;
    _increment(table, ctx, next);
  }
  return table;
}

/**
 * 扫描文档中的所有行，分行独立处理。
 * 用于 Markdown 文档分行扫描，避免跨行生成无意义的 N-gram。
 */
export function scanDocument(text: string, n: number = 4): NGramTable {
  const table: NGramTable = new Map();
  const lines = text.split('\n');
  for (const line of lines) {
    const sub = scanText(line + '\n', n); // tail \n 保证行末上下文
    mergeInto(table, sub);
  }
  return table;
}

// ---- 预测 ----

/** 提取光标前 n 个字符作为预测上下文 */
export function extractContext(text: string, cursorPos: number, n: number = 4): string {
  const start = Math.max(0, cursorPos - n);
  return text.slice(start, cursorPos);
}

/**
 * 递归预测下一个字符序列。
 * @param table N-gram 统计表
 * @param ctx 起始上下文 (光标前的 n 个字符)
 * @param maxLen 最大预测长度 (默认 20)
 * @param minConfidence 最低置信度阈值 (0-1, 默认 0.15)
 * @returns 预测的字符序列
 */
export function predictNext(
  table: NGramTable,
  ctx: string,
  maxLen: number = 20,
  minConfidence: number = 0.15,
): string {
  let result = '';
  let currentCtx = ctx;

  for (let i = 0; i < maxLen; i++) {
    const counts = table.get(currentCtx);
    if (!counts || counts.size === 0) break;

    // 取最高频次的下一个字符
    let best = '';
    let bestCount = 0;
    let totalCount = 0;
    for (const [ch, c] of counts) {
      totalCount += c;
      if (c > bestCount) {
        best = ch;
        bestCount = c;
      }
    }

    // 置信度检查
    const confidence = totalCount > 0 ? bestCount / totalCount : 0;
    if (confidence < minConfidence) break;

    result += best;
    // 滑动上下文窗口
    currentCtx = currentCtx.slice(1) + best;
  }

  return result;
}

/**
 * 预测并返回带置信度的完整结果。
 */
export function predict(
  table: NGramTable,
  cursorPos: number,
  doc: string,
  n: number = 4,
  maxLen: number = 20,
  minConfidence: number = 0.15,
): PredictionResult | null {
  const ctx = extractContext(doc, cursorPos, n);
  if (ctx.length < n) return null; // 上下文不足

  const text = predictNext(table, ctx, maxLen, minConfidence);
  if (!text) return null;

  // 计算整体置信度：受限于表的大小
  const actualLen = text.length;
  const confidence = Math.min(0.9, actualLen / maxLen + 0.1);

  return { text, confidence, from: cursorPos, source: 'ngram' };
}

// ---- 学习 ----

/**
 * 接受补全时，将实际接受的文本记录到统计表中。
 * @param table 统计表 (原地修改)
 * @param ctx 预测时的上下文
 * @param acceptedText 用户接受的实际文本
 * @param n 上下文窗口大小
 */
export function learn(table: NGramTable, ctx: string, acceptedText: string, n: number = 4): void {
  const full = ctx + acceptedText;
  for (let i = 0; i < full.length - n && i < ctx.length + acceptedText.length; i++) {
    const c = full.slice(i, i + n);
    const next = full[i + n];
    if (next === undefined) break;
    _increment(table, c, next);
  }
}

/**
 * Escape 拒绝时，降低该上下文中被拒绝预测的权重。
 */
export function rejectPrediction(table: NGramTable, ctx: string, rejectedText: string): void {
  const counts = table.get(ctx);
  if (!counts) return;
  const firstChar = rejectedText[0];
  if (!firstChar) return;
  const current = counts.get(firstChar);
  if (current !== undefined) {
    // 减半权重，但不删除（保留最低频次）
    counts.set(firstChar, Math.max(1, Math.floor(current / 2)));
  }
}

// ---- 合并 ----

/** 将源表合并到目标表 (原地修改目标) */
export function mergeInto(target: NGramTable, source: NGramTable): void {
  for (const [ctx, preds] of source) {
    if (!target.has(ctx)) {
      target.set(ctx, new Map(preds));
      continue;
    }
    const tPreds = target.get(ctx)!;
    for (const [ch, cnt] of preds) {
      tPreds.set(ch, (tPreds.get(ch) ?? 0) + cnt);
    }
  }
}

/** 创建两个表的新合并副本 */
export function mergeTables(a: NGramTable, b: NGramTable): NGramTable {
  const result = new Map(a);
  mergeInto(result, b);
  return result;
}

// ---- 裁剪 ----

/**
 * 裁剪 N-gram 表：过滤低频 + 每个上下文仅保留 Top-N
 */
export function pruneTable(
  table: NGramTable,
  minCount: number = 3,
  maxPredsPerContext: number = 3,
): NGramTable {
  const pruned: NGramTable = new Map();
  for (const [ctx, preds] of table) {
    // 过滤低频
    const filtered = new Map([...preds].filter(([, c]) => c >= minCount));
    if (filtered.size === 0) continue;
    // 保留 Top-N
    const sorted = [...filtered].sort((a, b) => b[1] - a[1]).slice(0, maxPredsPerContext);
    pruned.set(ctx, new Map(sorted));
  }
  return pruned;
}

// ---- 序列化 ----

/** 序列化为紧凑文本格式 (用于 localStorage 持久化) */
export function serialize(table: NGramTable): string {
  const lines: string[] = [];
  for (const [ctx, preds] of table) {
    const ctxHex = _toHex(ctx);
    const predParts = [...preds]
      .sort((a, b) => b[1] - a[1])
      .map(([ch, cnt]) => `${ch},${cnt}`)
      .join('|');
    const flags = [...preds].some(([, c]) => c > 100) ? 'u' : 'b';
    lines.push(`${ctxHex}|${predParts}|${flags}`);
  }
  return lines.join('\n');
}

/** 从紧凑文本格式反序列化 */
export function deserialize(compact: string): NGramTable {
  const table: NGramTable = new Map();
  const lines = compact.split('\n').filter((l) => l.trim());
  for (const line of lines) {
    const parts = line.split('|');
    if (parts.length < 3 || !parts[0]) continue;
    const ctx = _fromHex(parts[0]);
    const preds = new Map<string, number>();
    // 最后一段是 flag，中间段是 pred,cnt
    for (let i = 1; i < parts.length - 1; i++) {
      const segment = parts[i];
      if (!segment) continue;
      const [ch, cntStr] = segment.split(',');
      if (ch && cntStr) {
        preds.set(ch, parseInt(cntStr, 10) || 1);
      }
    }
    if (preds.size > 0) {
      table.set(ctx, preds);
    }
  }
  return table;
}

/** 估算序列化后大小 (字节) */
export function estimateSize(table: NGramTable): number {
  return serialize(table).length;
}

// ---- 内部辅助 ----

function _increment(table: NGramTable, ctx: string, next: string): void {
  if (!table.has(ctx)) table.set(ctx, new Map());
  const counts = table.get(ctx)!;
  counts.set(next, (counts.get(next) ?? 0) + 1);
}

function _toHex(s: string): string {
  // UTF-8 byte encoding → hex (与训练工具 train-baseline.ts 一致)
  const encoder = new TextEncoder();
  const bytes = encoder.encode(s);
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}

function _fromHex(hex: string): string {
  // hex → UTF-8 bytes → string
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return new TextDecoder().decode(bytes);
}
