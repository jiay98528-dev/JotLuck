import { compareStrings } from './common';
import type { V2SLanguage } from './selection';

export type V2STokenizerKind = 'bpe' | 'unigram';

export interface V2STokenizerModel {
  schema: 'jotluck.autocomplete.v2s-tokenizer.v1';
  kind: V2STokenizerKind;
  language: V2SLanguage;
  vocabulary: string[];
  merges: Array<[string, string]>;
  scores: number[];
  maxPieceCodePoints: number;
}

export interface TrainTokenizerOptions {
  kind: V2STokenizerKind;
  language: V2SLanguage;
  vocabularyLimit?: number;
  maxPieceCodePoints?: number;
  minimumPairCount?: number;
}

const SPECIAL_TOKENS = ['<unk>', '<bos>', '<eos>', '<abstain>'] as const;
const DEFAULT_VOCABULARY_LIMIT = 4096;

export function trainTokenizer(
  texts: readonly string[],
  options: TrainTokenizerOptions,
): V2STokenizerModel {
  const vocabularyLimit = options.vocabularyLimit ?? DEFAULT_VOCABULARY_LIMIT;
  if (!Number.isSafeInteger(vocabularyLimit) || vocabularyLimit < SPECIAL_TOKENS.length + 8) {
    throw new Error('Tokenizer vocabulary limit is too small.');
  }
  if (vocabularyLimit > DEFAULT_VOCABULARY_LIMIT) {
    throw new Error(`Tokenizer vocabulary limit cannot exceed ${DEFAULT_VOCABULARY_LIMIT}.`);
  }
  const maxPieceCodePoints = options.maxPieceCodePoints ?? 8;
  if (
    !Number.isSafeInteger(maxPieceCodePoints) ||
    maxPieceCodePoints < 1 ||
    maxPieceCodePoints > 16
  ) {
    throw new Error('maxPieceCodePoints must be between 1 and 16.');
  }
  const segments = texts.flatMap((text) => segmentText(text, options.language));
  if (segments.length === 0) throw new Error('Tokenizer training requires non-empty text.');

  return options.kind === 'bpe'
    ? trainBpe(segments, options.language, vocabularyLimit, maxPieceCodePoints, options)
    : trainUnigram(segments, options.language, vocabularyLimit, maxPieceCodePoints);
}

export function encodeWithTokenizer(model: V2STokenizerModel, text: string): number[] {
  const vocabulary = new Map(model.vocabulary.map((piece, index) => [piece, index]));
  const unknown = vocabulary.get('<unk>') ?? 0;
  const segments = segmentText(text, model.language);
  const output: number[] = [];
  for (const segment of segments) {
    const pieces =
      model.kind === 'bpe'
        ? applyBpe(segment, model.merges)
        : tokenizeUnigram(segment, model.vocabulary, model.scores);
    for (const piece of pieces) output.push(vocabulary.get(piece) ?? unknown);
  }
  return output;
}

export function decodeWithTokenizer(model: V2STokenizerModel, tokenIds: readonly number[]): string {
  let output = '';
  for (const tokenId of tokenIds) {
    const piece = model.vocabulary[tokenId];
    if (piece === undefined || SPECIAL_TOKENS.includes(piece as (typeof SPECIAL_TOKENS)[number])) {
      continue;
    }
    output += piece;
  }
  return output.replaceAll('▁', ' ');
}

export function tokenizerToBytes(model: V2STokenizerModel): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(model));
}

function trainBpe(
  sourceSegments: string[][],
  language: V2SLanguage,
  vocabularyLimit: number,
  maxPieceCodePoints: number,
  options: TrainTokenizerOptions,
): V2STokenizerModel {
  const retainedBase = selectRetainedBase(sourceSegments, vocabularyLimit);
  const aggregated = new Map<string, { tokens: string[]; weight: number }>();
  for (const segment of sourceSegments) {
    const normalized = segment.map((unit) => (retainedBase.has(unit) ? unit : '<unk>'));
    const key = normalized.join('\u0000');
    const current = aggregated.get(key);
    if (current) current.weight += 1;
    else aggregated.set(key, { tokens: normalized, weight: 1 });
  }
  const sequences: IndexedBpeSequence[] = [...aggregated.values()].map((sequence) => ({
    ...sequence,
    pairOccurrences: new Map(),
  }));
  const vocabulary = new Set(retainedBase);
  const merges: Array<[string, string]> = [];
  const minimumPairCount = options.minimumPairCount ?? 2;
  const pairStates = new Map<string, BpePairState>();
  const pairHeap = new BpePairMaxHeap();

  for (let sequenceId = 0; sequenceId < sequences.length; sequenceId += 1) {
    const sequence = sequences[sequenceId]!;
    sequence.pairOccurrences = countMergeablePairs(sequence.tokens, maxPieceCodePoints);
    for (const occurrence of sequence.pairOccurrences.values()) {
      const state = getOrCreatePairState(pairStates, occurrence);
      state.count += occurrence.count * sequence.weight;
      state.sequenceIds.add(sequenceId);
    }
  }
  for (const state of pairStates.values()) pairHeap.push(snapshotPairState(state));

  while (vocabulary.size + SPECIAL_TOKENS.length < vocabularyLimit) {
    const selected = popCurrentPair(pairHeap, pairStates);
    if (!selected || selected.count < minimumPairCount) break;
    const merged = selected.left + selected.right;
    merges.push([selected.left, selected.right]);
    vocabulary.add(merged);

    const affectedSequenceIds = [...selected.sequenceIds];
    const dirtyPairKeys = new Set<string>();
    for (const sequenceId of affectedSequenceIds) {
      const sequence = sequences[sequenceId]!;
      const previousOccurrences = sequence.pairOccurrences;
      const nextTokens = mergeSequence(sequence.tokens, selected.left, selected.right, merged);
      const nextOccurrences = countMergeablePairs(nextTokens, maxPieceCodePoints);

      for (const [key, previous] of previousOccurrences) {
        const nextCount = nextOccurrences.get(key)?.count ?? 0;
        if (nextCount === previous.count) continue;
        const state = pairStates.get(key)!;
        state.count += (nextCount - previous.count) * sequence.weight;
        if (nextCount === 0) state.sequenceIds.delete(sequenceId);
        dirtyPairKeys.add(key);
      }
      for (const [key, next] of nextOccurrences) {
        if (previousOccurrences.has(key)) continue;
        const state = getOrCreatePairState(pairStates, next);
        state.count += next.count * sequence.weight;
        state.sequenceIds.add(sequenceId);
        dirtyPairKeys.add(key);
      }
      sequence.tokens = nextTokens;
      sequence.pairOccurrences = nextOccurrences;
    }

    for (const key of dirtyPairKeys) {
      const state = pairStates.get(key)!;
      state.revision += 1;
      if (state.count > 0) pairHeap.push(snapshotPairState(state));
    }
  }

  const pieces = [...vocabulary].sort(compareStrings);
  return {
    schema: 'jotluck.autocomplete.v2s-tokenizer.v1',
    kind: 'bpe',
    language,
    vocabulary: [...SPECIAL_TOKENS, ...pieces],
    merges,
    scores: [...SPECIAL_TOKENS.map(() => 0), ...pieces.map(() => 0)],
    maxPieceCodePoints,
  };
}

interface BpePairOccurrence {
  key: string;
  left: string;
  right: string;
  count: number;
}

interface IndexedBpeSequence {
  tokens: string[];
  weight: number;
  pairOccurrences: Map<string, BpePairOccurrence>;
}

interface BpePairState extends BpePairOccurrence {
  sequenceIds: Set<number>;
  revision: number;
}

interface BpePairHeapEntry {
  key: string;
  left: string;
  right: string;
  count: number;
  revision: number;
}

class BpePairMaxHeap {
  private readonly entries: BpePairHeapEntry[] = [];

  push(entry: BpePairHeapEntry): void {
    let index = this.entries.length;
    this.entries.push(entry);
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!pairEntryOutranks(entry, this.entries[parent]!)) break;
      this.entries[index] = this.entries[parent]!;
      index = parent;
    }
    this.entries[index] = entry;
  }

  pop(): BpePairHeapEntry | undefined {
    const first = this.entries[0];
    const last = this.entries.pop();
    if (!first || !last || this.entries.length === 0) return first;
    let index = 0;
    this.entries[0] = last;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.entries.length) break;
      let winner = left;
      if (
        right < this.entries.length &&
        pairEntryOutranks(this.entries[right]!, this.entries[left]!)
      ) {
        winner = right;
      }
      if (!pairEntryOutranks(this.entries[winner]!, this.entries[index]!)) break;
      [this.entries[index], this.entries[winner]] = [this.entries[winner]!, this.entries[index]!];
      index = winner;
    }
    return first;
  }
}

function countMergeablePairs(
  tokens: readonly string[],
  maxPieceCodePoints: number,
): Map<string, BpePairOccurrence> {
  const occurrences = new Map<string, BpePairOccurrence>();
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const left = tokens[index]!;
    const right = tokens[index + 1]!;
    if (!canMerge(left, right, maxPieceCodePoints)) continue;
    const key = `${left}\u0000${right}`;
    const current = occurrences.get(key);
    if (current) current.count += 1;
    else occurrences.set(key, { key, left, right, count: 1 });
  }
  return occurrences;
}

function getOrCreatePairState(
  states: Map<string, BpePairState>,
  occurrence: BpePairOccurrence,
): BpePairState {
  const current = states.get(occurrence.key);
  if (current) return current;
  const created: BpePairState = {
    key: occurrence.key,
    left: occurrence.left,
    right: occurrence.right,
    count: 0,
    sequenceIds: new Set(),
    revision: 0,
  };
  states.set(occurrence.key, created);
  return created;
}

function snapshotPairState(state: BpePairState): BpePairHeapEntry {
  return {
    key: state.key,
    left: state.left,
    right: state.right,
    count: state.count,
    revision: state.revision,
  };
}

function popCurrentPair(
  heap: BpePairMaxHeap,
  states: ReadonlyMap<string, BpePairState>,
): BpePairState | undefined {
  while (true) {
    const entry = heap.pop();
    if (!entry) return undefined;
    const state = states.get(entry.key);
    if (state && state.revision === entry.revision && state.count === entry.count) return state;
  }
}

function pairEntryOutranks(left: BpePairHeapEntry, right: BpePairHeapEntry): boolean {
  return (
    left.count > right.count ||
    (left.count === right.count && compareStrings(left.left, right.left) < 0) ||
    (left.count === right.count &&
      left.left === right.left &&
      compareStrings(left.right, right.right) < 0) ||
    (left.count === right.count &&
      left.left === right.left &&
      left.right === right.right &&
      left.revision > right.revision)
  );
}

function trainUnigram(
  segments: string[][],
  language: V2SLanguage,
  vocabularyLimit: number,
  maxPieceCodePoints: number,
): V2STokenizerModel {
  const counts = new Map<string, number>();
  const base = selectRetainedBase(segments, vocabularyLimit);
  for (const units of segments) {
    for (let start = 0; start < units.length; start += 1) {
      let piece = '';
      for (let end = start; end < units.length && end < start + maxPieceCodePoints; end += 1) {
        const unit = units[end]!;
        if (!base.has(unit)) break;
        piece += unit;
        if (start > 0 && piece.startsWith('▁')) break;
        counts.set(piece, (counts.get(piece) ?? 0) + 1);
      }
    }
  }
  const candidates = [...counts.entries()]
    .map(([piece, count]) => ({
      piece,
      score: Math.round((Math.log1p(count) + codePointLength(piece) * 0.125) * 1_000_000),
      count,
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.count - left.count ||
        compareStrings(left.piece, right.piece),
    );
  const selected = new Set(base);
  for (const candidate of candidates) {
    if (selected.size + SPECIAL_TOKENS.length >= vocabularyLimit) break;
    selected.add(candidate.piece);
  }
  const pieces = [...selected].sort(compareStrings);
  const scoreByPiece = new Map(candidates.map(({ piece, score }) => [piece, score]));
  return {
    schema: 'jotluck.autocomplete.v2s-tokenizer.v1',
    kind: 'unigram',
    language,
    vocabulary: [...SPECIAL_TOKENS, ...pieces],
    merges: [],
    scores: [
      ...SPECIAL_TOKENS.map(() => 0),
      ...pieces.map((piece) => scoreByPiece.get(piece) ?? 1),
    ],
    maxPieceCodePoints,
  };
}

function tokenizeUnigram(segment: string[], vocabulary: string[], scores: number[]): string[] {
  const text = segment.join('');
  const points = [...text];
  const entries = new Map<string, number>();
  for (let index = SPECIAL_TOKENS.length; index < vocabulary.length; index += 1) {
    entries.set(vocabulary[index]!, scores[index] ?? 0);
  }
  const best: Array<{ score: number; pieces: string[] } | undefined> = new Array(points.length + 1);
  best[0] = { score: 0, pieces: [] };
  for (let end = 1; end <= points.length; end += 1) {
    let winner: { score: number; pieces: string[] } | undefined;
    for (let start = 0; start < end; start += 1) {
      const previous = best[start];
      if (!previous) continue;
      const piece = points.slice(start, end).join('');
      const pieceScore = entries.get(piece);
      if (pieceScore === undefined) continue;
      const candidate = { score: previous.score + pieceScore, pieces: [...previous.pieces, piece] };
      if (!winner || compareTokenizations(candidate, winner) < 0) winner = candidate;
    }
    best[end] = winner;
  }
  return best[points.length]?.pieces ?? segment;
}

function compareTokenizations(
  left: { score: number; pieces: string[] },
  right: { score: number; pieces: string[] },
): number {
  if (left.score !== right.score) return right.score - left.score;
  if (left.pieces.length !== right.pieces.length) return left.pieces.length - right.pieces.length;
  const leftLengths = left.pieces.map(codePointLength);
  const rightLengths = right.pieces.map(codePointLength);
  for (let index = 0; index < leftLengths.length; index += 1) {
    if (leftLengths[index] !== rightLengths[index]) {
      return rightLengths[index]! - leftLengths[index]!;
    }
  }
  return compareStrings(left.pieces.join('\u0000'), right.pieces.join('\u0000'));
}

function segmentText(text: string, language: V2SLanguage): string[][] {
  const normalized = text.normalize('NFKC').replace(/\r\n?/gu, '\n');
  const pieces = normalized.match(/\n|[\t ]+|[\p{L}\p{M}\p{N}_'-]+|[^\s]/gu) ?? [];
  const segments: string[][] = [];
  let pendingSpace = false;
  for (const piece of pieces) {
    if (piece === '\n') {
      segments.push(['\n']);
      pendingSpace = false;
      continue;
    }
    if (/^[\t ]+$/u.test(piece)) {
      pendingSpace = true;
      continue;
    }
    const prefix = pendingSpace ? '▁' : '';
    const codePoints = [...piece];
    if (language === 'zh' && codePoints.every((point) => /\p{Script=Han}/u.test(point))) {
      segments.push(codePoints.map((point, index) => (index === 0 ? prefix + point : point)));
    } else {
      segments.push(codePoints.map((point, index) => (index === 0 ? prefix + point : point)));
    }
    pendingSpace = false;
  }
  return segments;
}

function applyBpe(segment: string[], merges: Array<[string, string]>): string[] {
  let output = [...segment];
  for (const [left, right] of merges) {
    output = mergeSequence(output, left, right, left + right);
  }
  return output;
}

function mergeSequence(sequence: string[], left: string, right: string, merged: string): string[] {
  const output: string[] = [];
  for (let index = 0; index < sequence.length; index += 1) {
    if (sequence[index] === left && sequence[index + 1] === right) {
      output.push(merged);
      index += 1;
    } else {
      output.push(sequence[index]!);
    }
  }
  return output;
}

function canMerge(left: string, right: string, maximum: number): boolean {
  return (
    right !== '\n' &&
    left !== '\n' &&
    right !== '<unk>' &&
    left !== '<unk>' &&
    !right.startsWith('▁') &&
    codePointLength(left + right) <= maximum
  );
}

function selectRetainedBase(segments: readonly string[][], vocabularyLimit: number): Set<string> {
  const counts = new Map<string, number>();
  for (const segment of segments) {
    for (const unit of segment) counts.set(unit, (counts.get(unit) ?? 0) + 1);
  }
  return new Set(
    [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || compareStrings(left[0], right[0]))
      .slice(0, vocabularyLimit - SPECIAL_TOKENS.length)
      .map(([unit]) => unit),
  );
}

function codePointLength(value: string): number {
  return [...value.replace(/^▁/u, '')].length;
}
