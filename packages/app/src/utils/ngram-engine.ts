/**
 * Pure N-gram engine used by the offline autocomplete predictor.
 */

export type NGramTable = Map<string, Map<string, number>>;

export interface PredictionResult {
  text: string;
  confidence: number;
  from: number;
  source?: 'ngram' | 'structured';
  syntaxType?: string;
}

export interface PredictionTrace {
  text: string;
  confidence: number;
}

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

export function scanDocument(text: string, n: number = 4): NGramTable {
  const table: NGramTable = new Map();
  for (const line of text.split('\n')) {
    mergeInto(table, scanText(line + '\n', n));
  }
  return table;
}

export function extractContext(text: string, cursorPos: number, n: number = 4): string {
  const start = Math.max(0, cursorPos - n);
  return text.slice(start, cursorPos);
}

export function predictNext(
  table: NGramTable,
  ctx: string,
  maxLen: number = 20,
  minConfidence: number = 0.15,
): string {
  return predictNextWithConfidence(table, ctx, maxLen, minConfidence).text;
}

export function predictNextWithConfidence(
  table: NGramTable,
  ctx: string,
  maxLen: number = 20,
  minConfidence: number = 0.15,
): PredictionTrace {
  let result = '';
  let currentCtx = ctx;
  let firstConfidence = 0;
  let confidenceSum = 0;
  let steps = 0;

  for (let i = 0; i < maxLen; i++) {
    const counts = table.get(currentCtx);
    if (!counts || counts.size === 0) break;

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

    const confidence = totalCount > 0 ? bestCount / totalCount : 0;
    if (confidence < minConfidence) break;
    if (steps === 0) firstConfidence = confidence;
    confidenceSum += confidence;
    steps++;

    result += best;
    currentCtx = currentCtx.slice(1) + best;
  }

  const avgConfidence = steps > 0 ? confidenceSum / steps : 0;
  return {
    text: result,
    confidence: result ? Math.min(0.98, firstConfidence * 0.7 + avgConfidence * 0.3) : 0,
  };
}

export function predict(
  table: NGramTable,
  cursorPos: number,
  doc: string,
  n: number = 4,
  maxLen: number = 20,
  minConfidence: number = 0.15,
): PredictionResult | null {
  const ctx = extractContext(doc, cursorPos, n);
  if (ctx.length < n) return null;
  const trace = predictNextWithConfidence(table, ctx, maxLen, minConfidence);
  if (!trace.text) return null;
  return { text: trace.text, confidence: trace.confidence, from: cursorPos, source: 'ngram' };
}

export function learn(table: NGramTable, ctx: string, acceptedText: string, n: number = 4): void {
  const full = ctx + acceptedText;
  for (let i = 0; i < full.length - n && i < ctx.length + acceptedText.length; i++) {
    const c = full.slice(i, i + n);
    const next = full[i + n];
    if (next === undefined) break;
    _increment(table, c, next);
  }
}

export function rejectPrediction(table: NGramTable, ctx: string, rejectedText: string): void {
  const counts = table.get(ctx);
  if (!counts) return;
  const firstChar = rejectedText[0];
  if (!firstChar) return;
  const current = counts.get(firstChar);
  if (current !== undefined) {
    counts.set(firstChar, Math.max(1, Math.floor(current / 2)));
  }
}

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

export function mergeTables(a: NGramTable, b: NGramTable): NGramTable {
  const result: NGramTable = new Map();
  mergeInto(result, a);
  mergeInto(result, b);
  return result;
}

export function pruneTable(
  table: NGramTable,
  minCount: number = 3,
  maxPredsPerContext: number = 3,
): NGramTable {
  const pruned: NGramTable = new Map();
  for (const [ctx, preds] of table) {
    const filtered = new Map([...preds].filter(([, c]) => c >= minCount));
    if (filtered.size === 0) continue;
    const sorted = [...filtered].sort((a, b) => b[1] - a[1]).slice(0, maxPredsPerContext);
    pruned.set(ctx, new Map(sorted));
  }
  return pruned;
}

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

export function deserialize(compact: string): NGramTable {
  const table: NGramTable = new Map();
  const lines = compact.split('\n').filter((l) => l.trim());
  for (const line of lines) {
    const parts = line.split('|');
    if (parts.length < 3 || !parts[0]) continue;
    const ctx = _fromHex(parts[0]);
    const preds = new Map<string, number>();
    for (let i = 1; i < parts.length - 1; i++) {
      const segment = parts[i];
      if (!segment) continue;
      const [ch, cntStr] = segment.split(',');
      if (ch && cntStr) {
        preds.set(ch, parseInt(cntStr, 10) || 1);
      }
    }
    if (preds.size > 0) table.set(ctx, preds);
  }
  return table;
}

export function estimateSize(table: NGramTable): number {
  return serialize(table).length;
}

function _increment(table: NGramTable, ctx: string, next: string): void {
  if (!table.has(ctx)) table.set(ctx, new Map());
  const counts = table.get(ctx)!;
  counts.set(next, (counts.get(next) ?? 0) + 1);
}

function _toHex(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function _fromHex(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return new TextDecoder().decode(bytes);
}
