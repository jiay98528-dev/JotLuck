/**
 * Pure N-gram engine used by the offline autocomplete predictor.
 */

export type NGramTable = Map<string, Map<string, number>>;
/** Reserved serialized branch containing probability mass removed by top-k pruning. */
export const NGRAM_OTHER_MASS = '\u0000';

export interface PredictionResult {
  text: string;
  confidence: number;
  /** Count supporting the first emitted code point. */
  support?: number;
  /** Total count observed for the first resolved context. */
  totalSupport?: number;
  from: number;
  source?: 'ngram' | 'structured' | 'recent';
  sourceLayer?: string;
  syntaxType?: string;
  providerId?: string;
  learnable?: boolean;
  informationScore?: number;
  learningBoost?: number;
  learningPenalty?: number;
  /** Opaque token binding accept/reject feedback to the prediction that was shown. */
  feedbackToken?: string;
}

export interface PredictionTrace {
  text: string;
  confidence: number;
  support: number;
  totalSupport: number;
}

export interface ParseDiagnostics {
  totalMs: number;
  maxChunkMs: number;
  chunks: number;
  lines: number;
  longTasksOver50Ms: number;
}

export interface AsyncParseOptions {
  chunkLines?: number;
  diagnostics?: ParseDiagnostics;
  /** Injectable monotonic clock for deterministic tests. */
  now?: () => number;
}

interface RankedNextCodePoint {
  text: string;
  support: number;
  totalSupport: number;
  rawConfidence: number;
  calibratedConfidence: number;
}

const CONFIDENCE_SUPPORT_PRIOR = 2;

export function scanText(text: string, n: number = 4): NGramTable {
  const table: NGramTable = new Map();
  const points = toCodePoints(text);
  for (let i = 0; i < points.length - n; i++) {
    const ctx = points.slice(i, i + n).join('');
    const next = points[i + n];
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
  return takeLastCodePoints(text.slice(0, cursorPos), n);
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
  minContextLength: number = codePointLength(ctx),
  supportScale: number = 1,
): PredictionTrace {
  return (
    predictNextTopKWithConfidence(
      table,
      ctx,
      maxLen,
      minConfidence,
      minContextLength,
      1,
      supportScale,
    )[0] ?? emptyPredictionTrace()
  );
}

/**
 * Produces deterministic alternatives by forcing each eligible first-step
 * branch and greedily extending it with the existing N-gram behavior.
 */
export function predictNextTopKWithConfidence(
  table: NGramTable,
  ctx: string,
  maxLen: number = 20,
  minConfidence: number = 0.15,
  minContextLength: number = codePointLength(ctx),
  topK: number = 3,
  supportScale: number = 1,
): PredictionTrace[] {
  const contextPoints = toCodePoints(ctx);
  return predictContextTopKWithConfidence(
    table,
    contextPoints,
    maxLen,
    minConfidence,
    minContextLength,
    topK,
    contextPoints.length,
    normalizeSupportScale(supportScale),
  );
}

export function predict(
  table: NGramTable,
  cursorPos: number,
  doc: string,
  n: number = 4,
  maxLen: number = 20,
  minConfidence: number = 0.15,
  minContextLength: number = n,
  supportScale: number = 1,
): PredictionResult | null {
  return (
    predictMany(
      table,
      cursorPos,
      doc,
      n,
      maxLen,
      minConfidence,
      minContextLength,
      1,
      supportScale,
    )[0] ?? null
  );
}

/**
 * Cursor-aware deterministic top-k prediction. The default minimum context
 * remains `n`, preserving the fixed-order behavior of `predict()`. Callers may
 * explicitly lower it to query variable-order entries stored in the same table.
 */
export function predictMany(
  table: NGramTable,
  cursorPos: number,
  doc: string,
  n: number = 4,
  maxLen: number = 20,
  minConfidence: number = 0.15,
  minContextLength: number = n,
  topK: number = 3,
  supportScale: number = 1,
): PredictionResult[] {
  const minimum = normalizeMinimumContextLength(minContextLength, n);
  const baseContext = extractContext(doc, cursorPos, n);
  if (codePointLength(baseContext) < minimum) return [];
  const extendedContext = n === 2 ? extractContext(doc, cursorPos, 3) : baseContext;
  const ctx =
    codePointLength(extendedContext) === 3 && table.has(extendedContext)
      ? extendedContext
      : baseContext;
  return predictContextTopKWithConfidence(
    table,
    toCodePoints(ctx),
    maxLen,
    minConfidence,
    minimum,
    topK,
    Math.max(n, codePointLength(ctx)),
    normalizeSupportScale(supportScale),
  ).map((trace) => ({
    text: trace.text,
    confidence: trace.confidence,
    support: trace.support,
    totalSupport: trace.totalSupport,
    from: cursorPos,
    source: 'ngram',
  }));
}

export function learn(table: NGramTable, ctx: string, acceptedText: string, n: number = 4): void {
  const contextPoints = toCodePoints(ctx).slice(-n);
  if (contextPoints.length < n) return;
  const full = [...contextPoints, ...toCodePoints(acceptedText)];
  for (let i = 0; i < full.length - n; i++) {
    const c = full.slice(i, i + n).join('');
    const next = full[i + n];
    if (next === undefined) break;
    _increment(table, c, next);
  }
}

export function rejectPrediction(table: NGramTable, ctx: string, rejectedText: string): void {
  const counts = table.get(ctx);
  if (!counts) return;
  const firstChar = toCodePoints(rejectedText)[0];
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
  const contexts = [...table.entries()].sort((a, b) =>
    _toHex(a[0]).localeCompare(_toHex(b[0]), 'en'),
  );
  for (const [ctx, preds] of contexts) {
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

export async function deserializeAsync(
  compact: string,
  options: number | AsyncParseOptions = 2000,
): Promise<NGramTable> {
  const table: NGramTable = new Map();
  const normalizedOptions: AsyncParseOptions =
    typeof options === 'number' ? { chunkLines: options } : options;
  const chunkLines = normalizedOptions.chunkLines ?? 2000;
  const chunkSize = Number.isSafeInteger(chunkLines) ? Math.max(1, chunkLines) : 2000;
  const now = normalizedOptions.now ?? monotonicNow;
  const startedAt = now();
  let cursor = 0;
  while (cursor < compact.length) {
    const chunkStartedAt = now();
    let linesInChunk = 0;
    while (cursor < compact.length && linesInChunk < chunkSize) {
      const newline = compact.indexOf('\n', cursor);
      const end = newline < 0 ? compact.length : newline;
      const line = compact.slice(cursor, end);
      cursor = newline < 0 ? compact.length : newline + 1;
      linesInChunk++;
      if (!line.trim()) continue;
      const parsed = line.trimStart().startsWith('[')
        ? deserializeV3Line(line)
        : deserializeLegacyLine(line);
      if (parsed) table.set(parsed.ctx, parsed.preds);
    }
    recordParseChunk(normalizedOptions.diagnostics, now() - chunkStartedAt, linesInChunk);
    if (cursor < compact.length) await yieldToMainThread();
  }
  if (normalizedOptions.diagnostics) {
    normalizedOptions.diagnostics.totalMs += Math.max(0, now() - startedAt);
  }
  return table;
}

export function createParseDiagnostics(): ParseDiagnostics {
  return { totalMs: 0, maxChunkMs: 0, chunks: 0, lines: 0, longTasksOver50Ms: 0 };
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
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return '';
  }
}

function deserializeV3Line(line: string): { ctx: string; preds: Map<string, number> } | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!Array.isArray(parsed) || typeof parsed[0] !== 'string' || !Array.isArray(parsed[1])) {
      return null;
    }
    if (!isValidHex(parsed[0])) return null;
    const ctx = _fromHex(parsed[0]);
    if (!ctx) return null;
    const preds = new Map<string, number>();
    for (const item of parsed[1]) {
      if (!Array.isArray(item) || typeof item[0] !== 'string') continue;
      if (!isValidHex(item[0])) continue;
      const count = normalizeCount(item[1]);
      if (count === null) continue;
      const ch = _fromHex(item[0]);
      if (codePointLength(ch) === 1) preds.set(ch, count);
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
  if (!ctx) return null;
  const preds = new Map<string, number>();
  for (let i = 1; i < parts.length - 1; i++) {
    const segment = parts[i];
    if (!segment) continue;
    const [ch, cntStr] = segment.split(',');
    const count = normalizeCount(cntStr);
    if (ch && codePointLength(ch) === 1 && count !== null) preds.set(ch, count);
  }
  return preds.size > 0 ? { ctx, preds } : null;
}

function normalizeCount(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 && value <= 1_000_000_000 ? value : null;
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/u.test(value)) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count <= 1_000_000_000 ? count : null;
}

function isValidHex(hex: string): boolean {
  return hex.length > 0 && hex.length % 2 === 0 && /^[0-9a-f]+$/i.test(hex);
}

function toCodePoints(text: string): string[] {
  return Array.from(text);
}

function codePointLength(text: string): number {
  return toCodePoints(text).length;
}

function takeLastCodePoints(text: string, count: number): string {
  return toCodePoints(text).slice(-Math.max(0, count)).join('');
}

function predictContextTopKWithConfidence(
  table: NGramTable,
  contextPoints: readonly string[],
  maxLen: number,
  minConfidence: number,
  minContextLength: number,
  topK: number,
  maxContextLength: number,
  supportScale: number,
): PredictionTrace[] {
  const resultLimit = normalizeTopK(topK);
  const lengthLimit = Number.isFinite(maxLen) ? Math.max(0, Math.floor(maxLen)) : 0;
  if (resultLimit === 0 || lengthLimit === 0) return [];

  const initial = resolveCounts(table, contextPoints, minContextLength);
  if (!initial) return [];
  const branches = rankNextCodePoints(initial.counts, supportScale);
  const results: PredictionTrace[] = [];

  for (const branch of branches) {
    // Keep the historical threshold semantics for compatibility. The exposed
    // confidence is calibrated separately so low-support branches no longer
    // masquerade as certain predictions.
    if (branch.rawConfidence < minConfidence) break;
    if (branch.text === '\n' || branch.text === '\r') continue;
    const trace = extendPredictionBranch(
      table,
      contextPoints,
      initial.context,
      branch,
      lengthLimit,
      minConfidence,
      minContextLength,
      maxContextLength,
      supportScale,
    );
    if (trace.text) results.push(trace);
    if (results.length >= resultLimit) break;
  }

  return results.sort(comparePredictionTraces);
}

function extendPredictionBranch(
  table: NGramTable,
  initialContextPoints: readonly string[],
  initialContext: string,
  firstBranch: RankedNextCodePoint,
  maxLen: number,
  minConfidence: number,
  minContextLength: number,
  maxContextLength: number,
  supportScale: number,
): PredictionTrace {
  let result = '';
  let currentContextPoints = [...initialContextPoints];
  let firstConfidence = 0;
  let confidenceSum = 0;
  let steps = 0;
  const seenContexts = new Set<string>([initialContext]);

  const append = (branch: RankedNextCodePoint): boolean => {
    if (branch.text === '\n' || branch.text === '\r') return false;
    if (steps === 0) firstConfidence = branch.calibratedConfidence;
    confidenceSum += branch.calibratedConfidence;
    steps++;
    result += branch.text;
    currentContextPoints = appendContextCodePoint(
      currentContextPoints,
      branch.text,
      maxContextLength,
    );
    return true;
  };

  if (!append(firstBranch)) return emptyPredictionTrace();

  while (steps < maxLen && !/[。！？!?；;]$/u.test(result)) {
    const resolved = resolveCounts(table, currentContextPoints, minContextLength);
    if (!resolved || seenContexts.has(resolved.context)) break;
    seenContexts.add(resolved.context);
    const next = rankNextCodePoints(resolved.counts, supportScale)[0];
    if (!next || next.rawConfidence < minConfidence || !append(next)) break;
  }

  const avgConfidence = steps > 0 ? confidenceSum / steps : 0;
  return {
    text: result,
    confidence: result ? Math.min(0.98, firstConfidence * 0.7 + avgConfidence * 0.3) : 0,
    support: firstBranch.support,
    totalSupport: firstBranch.totalSupport,
  };
}

function rankNextCodePoints(
  counts: ReadonlyMap<string, number>,
  supportScale: number,
): RankedNextCodePoint[] {
  const validCounts = [...counts].filter(
    (entry): entry is [string, number] =>
      codePointLength(entry[0]) === 1 && Number.isFinite(entry[1]) && entry[1] > 0,
  );
  const totalSupport = validCounts.reduce((sum, [, support]) => sum + support, 0);
  if (totalSupport <= 0) return [];
  const entries = validCounts.filter(([text]) => text !== NGRAM_OTHER_MASS);

  return entries
    .map(([text, support]) => ({
      text,
      support,
      totalSupport,
      rawConfidence: support / totalSupport,
      calibratedConfidence: calibrateConfidence(support, totalSupport, supportScale),
    }))
    .sort((a, b) => b.support - a.support || compareCodePointSequences(a.text, b.text));
}

function calibrateConfidence(support: number, totalSupport: number, supportScale: number): number {
  if (support <= 0 || totalSupport <= 0) return 0;
  const rawConfidence = support / totalSupport;
  const evidenceWeight = totalSupport / (totalSupport + CONFIDENCE_SUPPORT_PRIOR * supportScale);
  return Math.max(0, Math.min(0.99, rawConfidence * evidenceWeight));
}

function appendContextCodePoint(
  contextPoints: readonly string[],
  next: string,
  maxContextLength: number,
): string[] {
  const limit = Math.max(1, Math.floor(maxContextLength));
  return [...contextPoints, next].slice(-limit);
}

function comparePredictionTraces(a: PredictionTrace, b: PredictionTrace): number {
  return (
    b.confidence - a.confidence ||
    b.support - a.support ||
    b.totalSupport - a.totalSupport ||
    compareCodePointSequences(a.text, b.text)
  );
}

function compareCodePointSequences(a: string, b: string): number {
  const left = toCodePoints(a);
  const right = toCodePoints(b);
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index++) {
    const delta = (left[index]?.codePointAt(0) ?? 0) - (right[index]?.codePointAt(0) ?? 0);
    if (delta !== 0) return delta;
  }
  return left.length - right.length;
}

function normalizeTopK(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizeMinimumContextLength(value: number, n: number): number {
  const maximum = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
  if (!Number.isFinite(value)) return maximum;
  return Math.max(1, Math.min(maximum, Math.floor(value)));
}

function normalizeSupportScale(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function emptyPredictionTrace(): PredictionTrace {
  return { text: '', confidence: 0, support: 0, totalSupport: 0 };
}

function resolveCounts(
  table: NGramTable,
  contextPoints: readonly string[],
  minContextLength: number,
): { context: string; counts: Map<string, number> } | null {
  const minimum = Math.max(1, Math.min(minContextLength, contextPoints.length));
  for (let length = contextPoints.length; length >= minimum; length--) {
    const context = contextPoints.slice(-length).join('');
    const counts = table.get(context);
    if (counts?.size) return { context, counts };
  }
  return null;
}

async function yieldToMainThread(): Promise<void> {
  const scheduler = (
    globalThis as typeof globalThis & {
      scheduler?: { yield?: () => Promise<void> };
    }
  ).scheduler;
  if (scheduler?.yield) {
    await scheduler.yield();
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function recordParseChunk(
  diagnostics: ParseDiagnostics | undefined,
  durationMs: number,
  lineCount: number,
): void {
  if (!diagnostics) return;
  const duration = Math.max(0, durationMs);
  diagnostics.chunks++;
  diagnostics.lines += lineCount;
  diagnostics.maxChunkMs = Math.max(diagnostics.maxChunkMs, duration);
  if (duration > 50) diagnostics.longTasksOver50Ms++;
}

function monotonicNow(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}
