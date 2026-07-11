import {
  deserializeAsync as deserializeCharacterTableAsync,
  deserialize as deserializeCharacterTable,
  serialize as serializeCharacterTable,
  type AsyncParseOptions,
  type NGramTable,
  type ParseDiagnostics,
  type PredictionResult,
} from './ngram-engine';

export type WordNGramTable = Map<string, Map<string, number>>;
/** Reserved branch containing probability mass removed from the published top-k. */
export const WORD_OTHER_MASS = '\u0000';

export interface BaselineTables {
  character: NGramTable;
  word: WordNGramTable;
  countScale?: number;
}

const BASELINE_HEADER = '# jotluck-baseline-v4';
const CHARACTER_SECTION = '[character]';
const WORD_SECTION = '[word]';
const WORD_SEPARATOR = '\u001f';
const ENGLISH_WORD_RE = /[A-Za-z]+(?:['’-][A-Za-z]+)*/gu;
const MAX_WORD_COMPLETION_CANDIDATES = 20;

interface RankedWordPrediction {
  text: string;
  support: number;
  totalSupport: number;
  confidence: number;
}

export function wordContext(tokens: readonly string[]): string {
  return tokens.map(normalizeWord).filter(Boolean).join(WORD_SEPARATOR);
}

export function tokenizeEnglishWords(text: string): string[] {
  return (text.normalize('NFKC').match(ENGLISH_WORD_RE) ?? []).map(normalizeWord).filter(Boolean);
}

export function scanWordText(text: string, orders: readonly number[] = [1, 2]): WordNGramTable {
  const table: WordNGramTable = new Map();
  const validOrders = [...new Set(orders)]
    .filter((order) => Number.isSafeInteger(order) && order >= 1 && order <= 3)
    .sort((a, b) => a - b);
  for (const unit of text.split(/[\r\n.!?;:]+/u)) {
    const tokens = tokenizeEnglishWords(unit);
    for (const order of validOrders) {
      for (let index = order; index < tokens.length; index++) {
        const context = wordContext(tokens.slice(index - order, index));
        const next = tokens[index];
        if (!context || !next) continue;
        const predictions = table.get(context) ?? new Map<string, number>();
        predictions.set(next, (predictions.get(next) ?? 0) + 1);
        table.set(context, predictions);
      }
    }
  }
  return table;
}

export function predictWordCompletion(
  table: WordNGramTable,
  cursorPos: number,
  doc: string,
  maxWords = 3,
  minConfidence = 0.15,
  supportScale = 1,
): PredictionResult | null {
  return (
    predictWordCompletions(table, cursorPos, doc, maxWords, minConfidence, 1, supportScale)[0] ??
    null
  );
}

/**
 * Returns deterministic alternatives for the next English word sequence.
 * Each candidate starts from a different first-word branch and then follows
 * the strongest continuation, mirroring the character model's top-k policy.
 */
export function predictWordCompletions(
  table: WordNGramTable,
  cursorPos: number,
  doc: string,
  maxWords = 3,
  minConfidence = 0.15,
  topK = 3,
  supportScale = 1,
): PredictionResult[] {
  const beforeCursor = doc.slice(0, cursorPos);
  if (!/\s$/u.test(beforeCursor)) return [];
  const tokens = tokenizeEnglishWords(beforeCursor.slice(-320));
  if (tokens.length === 0) return [];

  const resultLimit = normalizeTopK(topK);
  if (resultLimit === 0) return [];
  const wordLimit = normalizeMaxWords(maxWords);
  const confidenceThreshold = normalizeConfidenceThreshold(minConfidence);
  const normalizedScale = normalizeSupportScale(supportScale);
  const initial = resolveWordPredictions(table, tokens);
  if (!initial) return [];
  const branches = rankWordPredictions(initial.predictions, normalizedScale);
  const results: PredictionResult[] = [];

  for (const branch of branches) {
    if (branch.confidence < confidenceThreshold) break;
    const result = extendWordPrediction(
      table,
      tokens,
      initial.context,
      branch,
      wordLimit,
      confidenceThreshold,
      normalizedScale,
      cursorPos,
    );
    if (result) results.push(result);
    if (results.length >= resultLimit) break;
  }

  return results.sort(compareWordCompletions);
}

function extendWordPrediction(
  table: WordNGramTable,
  tokens: readonly string[],
  initialContext: string,
  firstBranch: RankedWordPrediction,
  maxWords: number,
  minConfidence: number,
  supportScale: number,
  cursorPos: number,
): PredictionResult | null {
  const result = [firstBranch.text];
  let confidenceSum = firstBranch.confidence;
  const seen = new Set<string>([initialContext]);

  while (result.length < maxWords) {
    const resolved = resolveWordPredictions(table, [...tokens, ...result]);
    if (!resolved || seen.has(resolved.context)) break;
    seen.add(resolved.context);
    const next = rankWordPredictions(resolved.predictions, supportScale)[0];
    if (!next || next.confidence < minConfidence) break;
    confidenceSum += next.confidence;
    result.push(next.text);
  }

  if (result.length === 0) return null;
  const average = confidenceSum / result.length;
  return {
    text: result.join(' '),
    confidence: Math.min(0.94, firstBranch.confidence * 0.7 + average * 0.3),
    support: firstBranch.support,
    totalSupport: firstBranch.totalSupport,
    from: cursorPos,
    source: 'ngram',
  };
}

function rankWordPredictions(
  predictions: ReadonlyMap<string, number>,
  supportScale: number,
): RankedWordPrediction[] {
  const valid = [...predictions.entries()].filter(
    ([next, count]) =>
      (next === WORD_OTHER_MASS || isNormalizedWord(next)) &&
      Number.isSafeInteger(count) &&
      count > 0,
  );
  const totalSupport = valid.reduce((sum, [, count]) => sum + count, 0);
  if (totalSupport <= 0) return [];
  const evidenceWeight = totalSupport / (totalSupport + 2 * supportScale);

  return valid
    .filter(([next]) => next !== WORD_OTHER_MASS)
    .map(([text, support]) => ({
      text,
      support,
      totalSupport,
      confidence: (support / totalSupport) * evidenceWeight,
    }))
    .sort((a, b) => b.support - a.support || a.text.localeCompare(b.text, 'en'));
}

function compareWordCompletions(a: PredictionResult, b: PredictionResult): number {
  return (
    b.confidence - a.confidence ||
    (b.support ?? 0) - (a.support ?? 0) ||
    a.text.localeCompare(b.text, 'en')
  );
}

function normalizeTopK(topK: number): number {
  if (!Number.isSafeInteger(topK) || topK <= 0) return 0;
  return Math.min(topK, MAX_WORD_COMPLETION_CANDIDATES);
}

function normalizeMaxWords(maxWords: number): number {
  if (!Number.isFinite(maxWords)) return 3;
  return Math.max(1, Math.floor(maxWords));
}

function normalizeConfidenceThreshold(minConfidence: number): number {
  if (!Number.isFinite(minConfidence)) return 0.15;
  return Math.max(0, Math.min(1, minConfidence));
}

function normalizeSupportScale(supportScale: number): number {
  return Number.isFinite(supportScale) && supportScale > 0 ? supportScale : 1;
}

export function serializeWordTable(table: WordNGramTable): string {
  return [...table.entries()]
    .map(([context, predictions]) => ({ contextHex: toHex(context), predictions }))
    .sort((a, b) => a.contextHex.localeCompare(b.contextHex, 'en'))
    .map(({ contextHex, predictions }) => {
      const ordered = [...predictions.entries()]
        .map(([next, count]) => [toHex(next), count] as const)
        .filter(([nextHex, count]) => Boolean(nextHex) && Number.isSafeInteger(count) && count > 0)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'));
      return JSON.stringify([contextHex, ordered]);
    })
    .join('\n');
}

export function deserializeWordTable(compact: string): WordNGramTable {
  const table: WordNGramTable = new Map();
  for (const line of compact.split('\n').filter((item) => item.trim())) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!Array.isArray(parsed) || typeof parsed[0] !== 'string' || !Array.isArray(parsed[1])) {
        continue;
      }
      const context = fromHex(parsed[0]);
      const contextTokens = context.split(WORD_SEPARATOR);
      if (
        contextTokens.length < 1 ||
        contextTokens.length > 3 ||
        contextTokens.some((token) => !isNormalizedWord(token))
      ) {
        continue;
      }
      const predictions = new Map<string, number>();
      for (const item of parsed[1]) {
        if (!Array.isArray(item) || typeof item[0] !== 'string') continue;
        const next = fromHex(item[0]);
        const count = item[1];
        if (
          (next !== WORD_OTHER_MASS && !isNormalizedWord(next)) ||
          !Number.isSafeInteger(count) ||
          count <= 0
        ) {
          continue;
        }
        predictions.set(next, count);
      }
      if (predictions.size > 0) table.set(context, predictions);
    } catch {
      // Corrupt lines are ignored; the manifest-level count/hash validation
      // decides whether the complete public asset is usable.
    }
  }
  return table;
}

export function serializeBaselineTables(tables: BaselineTables): string {
  return [
    BASELINE_HEADER,
    CHARACTER_SECTION,
    serializeCharacterTable(tables.character),
    WORD_SECTION,
    serializeWordTable(tables.word),
  ].join('\n');
}

export function deserializeBaselineTables(compact: string): BaselineTables | null {
  if (!compact.startsWith(`${BASELINE_HEADER}\n`)) {
    const character = deserializeCharacterTable(compact);
    return character.size > 0 ? { character, word: new Map(), countScale: 1 } : null;
  }
  const characterStart = compact.indexOf(`${CHARACTER_SECTION}\n`);
  const wordStart = compact.indexOf(`\n${WORD_SECTION}\n`);
  if (characterStart < 0 || wordStart < characterStart) return null;
  const characterText = compact.slice(characterStart + CHARACTER_SECTION.length + 1, wordStart);
  const wordText = compact.slice(wordStart + WORD_SECTION.length + 2);
  const character = deserializeCharacterTable(characterText);
  const word = deserializeWordTable(wordText);
  return character.size > 0 ? { character, word, countScale: 1 } : null;
}

export async function deserializeBaselineTablesAsync(
  compact: string,
  options: number | AsyncParseOptions = 2000,
): Promise<BaselineTables | null> {
  const normalizedOptions: AsyncParseOptions =
    typeof options === 'number' ? { chunkLines: options } : options;
  const now = normalizedOptions.now ?? monotonicNow;
  const startedAt = now();
  const previousTotal = normalizedOptions.diagnostics?.totalMs ?? 0;
  if (!compact.startsWith(`${BASELINE_HEADER}\n`)) {
    const character = await deserializeCharacterTableAsync(compact, normalizedOptions);
    finalizeParseTotal(normalizedOptions.diagnostics, previousTotal, now() - startedAt);
    return character.size > 0 ? { character, word: new Map(), countScale: 1 } : null;
  }
  const headerStartedAt = now();
  const characterStart = compact.indexOf(`${CHARACTER_SECTION}\n`);
  const wordStart = compact.indexOf(`\n${WORD_SECTION}\n`);
  if (characterStart < 0 || wordStart < characterStart) return null;
  const characterText = compact.slice(characterStart + CHARACTER_SECTION.length + 1, wordStart);
  const wordText = compact.slice(wordStart + WORD_SECTION.length + 2);
  recordParseChunk(normalizedOptions.diagnostics, now() - headerStartedAt, 0);
  const character = await deserializeCharacterTableAsync(characterText, normalizedOptions);
  const word = await deserializeWordTableAsync(wordText, normalizedOptions);
  finalizeParseTotal(normalizedOptions.diagnostics, previousTotal, now() - startedAt);
  return character.size > 0 ? { character, word, countScale: 1 } : null;
}

function resolveWordPredictions(
  table: WordNGramTable,
  tokens: readonly string[],
): { context: string; predictions: Map<string, number> } | null {
  for (let order = Math.min(3, tokens.length); order >= 1; order--) {
    const context = wordContext(tokens.slice(-order));
    const predictions = table.get(context);
    if (predictions?.size) return { context, predictions };
  }
  return null;
}

async function deserializeWordTableAsync(
  compact: string,
  options: AsyncParseOptions,
): Promise<WordNGramTable> {
  const table: WordNGramTable = new Map();
  const chunkLines = options.chunkLines ?? 2000;
  const chunkSize = Number.isSafeInteger(chunkLines) ? Math.max(1, chunkLines) : 2000;
  const now = options.now ?? monotonicNow;
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
      const parsed = deserializeWordTable(line);
      for (const [context, predictions] of parsed) table.set(context, predictions);
    }
    recordParseChunk(options.diagnostics, now() - chunkStartedAt, linesInChunk);
    if (cursor < compact.length) await yieldToMainThread();
  }
  if (options.diagnostics) {
    options.diagnostics.totalMs += Math.max(0, now() - startedAt);
  }
  return table;
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

function finalizeParseTotal(
  diagnostics: ParseDiagnostics | undefined,
  previousTotal: number,
  durationMs: number,
): void {
  if (diagnostics) diagnostics.totalMs = previousTotal + Math.max(0, durationMs);
}

function monotonicNow(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function normalizeWord(word: string): string {
  return word.normalize('NFKC').replace(/’/gu, "'").toLocaleLowerCase('en-US');
}

function isNormalizedWord(word: string): boolean {
  return /^[a-z]+(?:['-][a-z]+)*$/u.test(word) && normalizeWord(word) === word;
}

function toHex(value: string): string {
  return [...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): string {
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/iu.test(hex)) return '';
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < hex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return '';
  }
}
