/**
 * Pure N-gram engine used by the offline autocomplete predictor.
 */

export type NGramTable = Map<string, Map<string, number>>;

export interface PredictionResult {
  text: string;
  confidence: number;
  from: number;
  source?: 'ngram' | 'structured' | 'recent' | 'llm';
  sourceLayer?: string;
  syntaxType?: string;
  providerId?: string;
  learnable?: boolean;
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
    const predParts = [...preds].sort((a, b) => b[1] - a[1]).map(([ch, cnt]) => [_toHex(ch), cnt]);
    const flags = [...preds].some(([, c]) => c > 100) ? 'u' : 'b';
    lines.push(JSON.stringify([_toHex(ctx), predParts, flags]));
  }
  return lines.join('\n');
}

export function deserialize(compact: string): NGramTable {
  const table: NGramTable = new Map();
  const lines = compact.split('\n').filter((l) => l.trim());
  for (const line of lines) {
    const parsed = line.trimStart().startsWith('[')
      ? deserializeV3Line(line)
      : deserializeLegacyLine(line);
    if (parsed) table.set(parsed.ctx, parsed.preds);
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
  if (!isValidHex(hex)) return '';
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return new TextDecoder().decode(bytes);
}

function deserializeV3Line(line: string): { ctx: string; preds: Map<string, number> } | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!Array.isArray(parsed) || typeof parsed[0] !== 'string' || !Array.isArray(parsed[1])) {
      return null;
    }
    if (!isValidHex(parsed[0])) return null;
    const ctx = _fromHex(parsed[0]);
    const preds = new Map<string, number>();
    for (const item of parsed[1]) {
      if (!Array.isArray(item) || typeof item[0] !== 'string') continue;
      if (!isValidHex(item[0])) continue;
      const count = normalizeCount(item[1]);
      if (count === null) continue;
      const ch = _fromHex(item[0]);
      if (ch) preds.set(ch, count);
    }
    return preds.size > 0 ? { ctx, preds } : null;
  } catch {
    return null;
  }
}

function deserializeLegacyLine(line: string): { ctx: string; preds: Map<string, number> } | null {
  const parts = line.split('|');
  if (parts.length < 3 || !parts[0] || !isValidHex(parts[0])) return null;
  const ctx = _fromHex(parts[0]);
  const preds = new Map<string, number>();
  for (let i = 1; i < parts.length - 1; i++) {
    const segment = parts[i];
    if (!segment) continue;
    const [ch, cntStr] = segment.split(',');
    const count = normalizeCount(cntStr);
    if (ch && count !== null) preds.set(ch, count);
  }
  return preds.size > 0 ? { ctx, preds } : null;
}

function normalizeCount(value: unknown): number | null {
  const count = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(count) || count <= 0 || count > 1_000_000_000) return null;
  return Math.floor(count);
}

function isValidHex(hex: string): boolean {
  return hex.length > 0 && hex.length % 2 === 0 && /^[0-9a-f]+$/i.test(hex);
}
