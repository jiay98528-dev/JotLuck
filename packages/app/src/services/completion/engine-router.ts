import type { CompletionBlockType, CompletionCandidate, CompletionLanguageHint } from './types';

export const COMPLETION_CANDIDATE_BATCH_LIMIT = 8;
export const COMPLETION_RANK_CONTEXT_LIMIT = 256;

export interface CompletionRequestSnapshot {
  requestId: string;
  engineEpoch: number;
  workspaceScope: string;
  documentVersion: string;
  cursorPos: number;
  contextTail: string;
  languageHint: CompletionLanguageHint;
  blockType: CompletionBlockType;
  deadlineAt: number;
}

export interface CompletionCandidateSnapshot {
  candidateId: string;
  text: string;
  from: number;
  providerId: string;
  sourceLayer?: string;
  syntaxType: string;
  confidence: number;
  learnable: boolean;
}

export interface CompletionCandidateBatch {
  request: CompletionRequestSnapshot;
  candidates: CompletionCandidateSnapshot[];
  fallbackCandidateId: string | null;
}

export interface CompletionRankScore {
  candidateId: string;
  score: number;
}

export interface CompletionRankRequest {
  request: CompletionRequestSnapshot;
  candidates: readonly CompletionCandidateSnapshot[];
}

/**
 * Fixed host interface for a future data-only semantic reranker.
 * Implementations may score candidate IDs, but cannot generate or mutate text.
 */
export interface CompletionRanker {
  readonly id: string;
  warmup?(signal: AbortSignal): Promise<void>;
  rank(request: CompletionRankRequest, signal: AbortSignal): Promise<CompletionRankScore[]>;
  dispose?(): void | Promise<void>;
}

export interface CreateCompletionCandidateBatchOptions {
  requestId: string;
  engineEpoch: number;
  workspaceScope: string;
  documentVersion: string;
  cursorPos: number;
  contextBeforeCursor: string;
  languageHint: CompletionLanguageHint;
  blockType: CompletionBlockType;
  deadlineAt: number;
  candidates: readonly CompletionCandidate[];
}

export interface RankedCompletionBatch {
  batch: CompletionCandidateBatch;
  orderedCandidates: CompletionCandidate[];
  usedRankerId: string | null;
  fellBack: boolean;
}

export function createCompletionCandidateBatch(
  options: CreateCompletionCandidateBatchOptions,
): CompletionCandidateBatch {
  const limitedCandidates = options.candidates.slice(0, COMPLETION_CANDIDATE_BATCH_LIMIT);
  const snapshots = limitedCandidates.map((candidate, index) =>
    toCandidateSnapshot(candidate, index),
  );
  return {
    request: {
      requestId: options.requestId,
      engineEpoch: options.engineEpoch,
      workspaceScope: options.workspaceScope,
      documentVersion: options.documentVersion,
      cursorPos: options.cursorPos,
      contextTail: takeLastCodePoints(options.contextBeforeCursor, COMPLETION_RANK_CONTEXT_LIMIT),
      languageHint: options.languageHint,
      blockType: options.blockType,
      deadlineAt: options.deadlineAt,
    },
    candidates: snapshots,
    fallbackCandidateId: snapshots[0]?.candidateId ?? null,
  };
}

/**
 * Owns the optional asynchronous ranker. A new ranker is warmed before an
 * atomic swap; failed warmup leaves the current ranker untouched.
 */
export class CompletionEngineRouter {
  private ranker: CompletionRanker | null = null;
  private epoch = 0;
  private lifecycleGeneration = 0;

  getEpoch(): number {
    return this.epoch;
  }

  getActiveRankerId(): string | null {
    return this.ranker?.id ?? null;
  }

  bumpEpoch(): number {
    this.epoch += 1;
    return this.epoch;
  }

  async installRanker(next: CompletionRanker, signal?: AbortSignal): Promise<boolean> {
    const generation = ++this.lifecycleGeneration;
    const linked = createLinkedAbortController(signal);
    try {
      await next.warmup?.(linked.controller.signal);
      if (linked.controller.signal.aborted || generation !== this.lifecycleGeneration) {
        await safeDispose(next);
        return false;
      }
    } catch {
      await safeDispose(next);
      return false;
    } finally {
      linked.unlink();
    }

    const previous = this.ranker;
    this.ranker = next;
    this.bumpEpoch();
    await safeDispose(previous);
    return true;
  }

  async removeRanker(): Promise<void> {
    this.lifecycleGeneration += 1;
    const previous = this.ranker;
    if (!previous) return;
    this.ranker = null;
    this.bumpEpoch();
    await safeDispose(previous);
  }

  async rank(
    batch: CompletionCandidateBatch,
    originalCandidates: readonly CompletionCandidate[],
    signal?: AbortSignal,
  ): Promise<RankedCompletionBatch> {
    const fallback = originalCandidates.slice(0, batch.candidates.length);
    const ranker = this.ranker;
    if (!ranker || batch.candidates.length < 2 || hasStructuredCandidate(fallback)) {
      return { batch, orderedCandidates: fallback, usedRankerId: null, fellBack: false };
    }
    if (batch.request.engineEpoch !== this.epoch || signal?.aborted) {
      return { batch, orderedCandidates: fallback, usedRankerId: null, fellBack: true };
    }

    const timeoutMs = Math.max(0, batch.request.deadlineAt - performance.now());
    if (timeoutMs <= 0) {
      return { batch, orderedCandidates: fallback, usedRankerId: null, fellBack: true };
    }

    const linked = createLinkedAbortController(signal);
    const controller = linked.controller;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      const timeoutResult = Symbol('completion-ranker-timeout');
      const scores = await Promise.race([
        ranker.rank({ request: batch.request, candidates: batch.candidates }, controller.signal),
        new Promise<typeof timeoutResult>((resolve) => {
          timeout = setTimeout(() => {
            controller.abort('deadline');
            resolve(timeoutResult);
          }, timeoutMs);
        }),
      ]);
      if (
        scores === timeoutResult ||
        controller.signal.aborted ||
        batch.request.engineEpoch !== this.epoch ||
        performance.now() > batch.request.deadlineAt
      ) {
        return { batch, orderedCandidates: fallback, usedRankerId: null, fellBack: true };
      }

      const orderedCandidates = applyValidatedScores(batch, fallback, scores);
      return {
        batch,
        orderedCandidates,
        usedRankerId: ranker.id,
        fellBack: false,
      };
    } catch {
      return { batch, orderedCandidates: fallback, usedRankerId: null, fellBack: true };
    } finally {
      if (timeout) clearTimeout(timeout);
      linked.unlink();
    }
  }

  async dispose(): Promise<void> {
    this.lifecycleGeneration += 1;
    const current = this.ranker;
    this.ranker = null;
    this.bumpEpoch();
    await safeDispose(current);
  }
}

function toCandidateSnapshot(
  candidate: CompletionCandidate,
  index: number,
): CompletionCandidateSnapshot {
  return {
    candidateId: `${index}:${stableCandidateKey(candidate)}`,
    text: candidate.text,
    from: candidate.from,
    providerId: candidate.providerId,
    sourceLayer: candidate.sourceLayer,
    syntaxType: candidate.syntaxType,
    confidence: candidate.confidence,
    learnable: candidate.learnable,
  };
}

function stableCandidateKey(candidate: CompletionCandidate): string {
  const raw = [
    candidate.text.normalize('NFKC'),
    candidate.from,
    candidate.providerId,
    candidate.sourceLayer ?? '',
    candidate.syntaxType,
  ].join('\u001f');
  let hash = 2166136261;
  for (const point of raw) {
    hash ^= point.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function applyValidatedScores(
  batch: CompletionCandidateBatch,
  candidates: readonly CompletionCandidate[],
  scores: readonly CompletionRankScore[],
): CompletionCandidate[] {
  const knownIds = new Set(batch.candidates.map((candidate) => candidate.candidateId));
  const scoreById = new Map<string, number>();
  for (const item of scores) {
    if (!knownIds.has(item.candidateId) || !Number.isFinite(item.score)) continue;
    if (scoreById.has(item.candidateId)) continue;
    scoreById.set(item.candidateId, item.score);
  }
  if (scoreById.size === 0) return [...candidates];

  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      score: scoreById.get(batch.candidates[index]?.candidateId ?? '') ?? Number.NEGATIVE_INFINITY,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.candidate);
}

function hasStructuredCandidate(candidates: readonly CompletionCandidate[]): boolean {
  return candidates.some((candidate) => candidate.source === 'structured');
}

function createLinkedAbortController(signal?: AbortSignal): {
  controller: AbortController;
  unlink: () => void;
} {
  const controller = new AbortController();
  if (!signal) return { controller, unlink: () => undefined };
  if (signal.aborted) {
    controller.abort(signal.reason);
    return { controller, unlink: () => undefined };
  }
  const onAbort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', onAbort, { once: true });
  return {
    controller,
    unlink: () => signal.removeEventListener('abort', onAbort),
  };
}

async function safeDispose(ranker: CompletionRanker | null): Promise<void> {
  try {
    await ranker?.dispose?.();
  } catch {
    // Disposal failure must never disable the free completion engine.
  }
}

function takeLastCodePoints(text: string, count: number): string {
  return Array.from(text).slice(-count).join('');
}
