import type { CompletionBlockType, CompletionCandidate, CompletionLanguageHint } from './types';
import type {
  CompletionPublicEngine,
  PublicCompletionCandidate,
  PublicEngineDiagnostics,
  PublicEngineGenerateRequest,
} from './public-engine-types';
import {
  PUBLIC_ENGINE_CONTEXT_MAX_UTF8_BYTES,
  PUBLIC_ENGINE_MAX_CANDIDATES,
  PUBLIC_ENGINE_MAX_OUTPUT_CODE_POINTS,
  PUBLIC_ENGINE_PROTOCOL_VERSION,
  PUBLIC_ENGINE_PROVIDER_PRIORITY,
} from './public-engine-types';

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

export interface GeneratedPublicCompletion {
  candidates: PublicCompletionCandidate[];
  usedEngineId: string | null;
  fellBack: boolean;
  timedOut: boolean;
}

export type PublicCompletionGenerateOptions = Omit<
  PublicEngineGenerateRequest,
  'engineEpoch' | 'contextTailUtf8Bytes'
>;

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
  private publicEngine: CompletionPublicEngine | null = null;
  private epoch = 0;
  private rankerLifecycleGeneration = 0;
  private publicEngineLifecycleGeneration = 0;
  private disposed = false;

  getEpoch(): number {
    return this.epoch;
  }

  getActiveRankerId(): string | null {
    return this.ranker?.id ?? null;
  }

  getActivePublicEngineId(): string | null {
    return this.publicEngine?.id ?? null;
  }

  getPublicEngineDiagnostics(): PublicEngineDiagnostics | null {
    return this.publicEngine?.diagnostics() ?? null;
  }

  bumpEpoch(): number {
    this.epoch += 1;
    return this.epoch;
  }

  async installRanker(next: CompletionRanker, signal?: AbortSignal): Promise<boolean> {
    if (this.disposed) {
      await safeDispose(next);
      return false;
    }
    const generation = ++this.rankerLifecycleGeneration;
    const linked = createLinkedAbortController(signal);
    try {
      await next.warmup?.(linked.controller.signal);
      if (linked.controller.signal.aborted || generation !== this.rankerLifecycleGeneration) {
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
    this.rankerLifecycleGeneration += 1;
    const previous = this.ranker;
    if (!previous) return;
    this.ranker = null;
    this.bumpEpoch();
    await safeDispose(previous);
  }

  async installPublicEngine(next: CompletionPublicEngine, signal?: AbortSignal): Promise<boolean> {
    if (this.disposed) {
      await safeDisposePublicEngine(next);
      return false;
    }
    const generation = ++this.publicEngineLifecycleGeneration;
    if (!isSupportedPublicEngine(next)) {
      await safeDisposePublicEngine(next);
      return false;
    }
    const linked = createLinkedAbortController(signal);
    try {
      const ready = await next.warmup(linked.controller.signal);
      if (
        !ready ||
        linked.controller.signal.aborted ||
        generation !== this.publicEngineLifecycleGeneration
      ) {
        await safeDisposePublicEngine(next);
        return false;
      }
    } catch {
      await safeDisposePublicEngine(next);
      return false;
    } finally {
      linked.unlink();
    }

    const previous = this.publicEngine;
    this.publicEngine = next;
    this.bumpEpoch();
    await safeDisposePublicEngine(previous);
    return true;
  }

  async removePublicEngine(): Promise<void> {
    this.publicEngineLifecycleGeneration += 1;
    const previous = this.publicEngine;
    if (!previous) return;
    this.publicEngine = null;
    this.bumpEpoch();
    await safeDisposePublicEngine(previous);
  }

  async generatePublic(
    request: PublicCompletionGenerateOptions,
    requestRouterEpoch: number,
    monotonicDeadlineAt: number,
    signal?: AbortSignal,
  ): Promise<GeneratedPublicCompletion> {
    const engine = this.publicEngine;
    if (!engine || signal?.aborted || requestRouterEpoch !== this.epoch) {
      return { candidates: [], usedEngineId: null, fellBack: true, timedOut: false };
    }

    const timeoutMs = Math.max(0, monotonicDeadlineAt - performance.now());
    if (timeoutMs <= 0) {
      return { candidates: [], usedEngineId: null, fellBack: true, timedOut: true };
    }

    const linked = createLinkedAbortController(signal);
    const controller = linked.controller;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      const timeoutResult = Symbol('completion-public-engine-timeout');
      const engineEpoch = engine.diagnostics().epoch;
      const contextTail = takeLastUtf8Bytes(
        request.contextTail,
        PUBLIC_ENGINE_CONTEXT_MAX_UTF8_BYTES,
      );
      const requestedCandidates = Number.isFinite(request.maxCandidates)
        ? Math.trunc(request.maxCandidates)
        : 0;
      const boundedRequest: PublicEngineGenerateRequest = {
        ...request,
        engineEpoch,
        contextTail,
        contextTailUtf8Bytes: utf8ByteLength(contextTail),
        maxCandidates: Math.min(PUBLIC_ENGINE_MAX_CANDIDATES, Math.max(0, requestedCandidates)),
      };
      const response = await Promise.race([
        engine.generate(boundedRequest, controller.signal),
        new Promise<typeof timeoutResult>((resolve) => {
          timeout = setTimeout(() => {
            controller.abort('deadline');
            resolve(timeoutResult);
          }, timeoutMs);
        }),
      ]);
      if (
        response === timeoutResult ||
        controller.signal.aborted ||
        engine !== this.publicEngine ||
        requestRouterEpoch !== this.epoch ||
        performance.now() > monotonicDeadlineAt
      ) {
        return {
          candidates: [],
          usedEngineId: null,
          fellBack: true,
          timedOut: response === timeoutResult || performance.now() > monotonicDeadlineAt,
        };
      }
      const candidates = validateAndStampPublicResponse(engine, boundedRequest, response);
      if (!candidates) {
        return { candidates: [], usedEngineId: null, fellBack: true, timedOut: false };
      }
      return {
        candidates,
        usedEngineId: engine.id,
        fellBack: false,
        timedOut: false,
      };
    } catch {
      return { candidates: [], usedEngineId: null, fellBack: true, timedOut: false };
    } finally {
      if (timeout) clearTimeout(timeout);
      linked.unlink();
    }
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
    if (this.disposed) return;
    this.disposed = true;
    this.rankerLifecycleGeneration += 1;
    this.publicEngineLifecycleGeneration += 1;
    const current = this.ranker;
    const currentPublicEngine = this.publicEngine;
    this.ranker = null;
    this.publicEngine = null;
    this.bumpEpoch();
    await Promise.all([safeDispose(current), safeDisposePublicEngine(currentPublicEngine)]);
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

function isSupportedPublicEngine(engine: CompletionPublicEngine): boolean {
  return (
    engine.protocolVersion === PUBLIC_ENGINE_PROTOCOL_VERSION &&
    (engine.sourceKind === 'ngram' || engine.sourceKind === 'neural') &&
    Number.isInteger(engine.maxOutputCodePoints) &&
    engine.maxOutputCodePoints > 0 &&
    engine.maxOutputCodePoints <= PUBLIC_ENGINE_MAX_OUTPUT_CODE_POINTS &&
    engine.id.trim().length > 0
  );
}

function validateAndStampPublicResponse(
  engine: CompletionPublicEngine,
  request: PublicEngineGenerateRequest,
  value: unknown,
): PublicCompletionCandidate[] | null {
  if (!isRecord(value)) return null;
  if (
    value.protocolVersion !== engine.protocolVersion ||
    value.engineEpoch !== request.engineEpoch ||
    value.workspaceScope !== request.workspaceScope ||
    value.documentVersion !== request.documentVersion ||
    value.cursorPos !== request.cursorPos ||
    !Array.isArray(value.candidates) ||
    value.candidates.length > request.maxCandidates ||
    value.candidates.length > PUBLIC_ENGINE_MAX_CANDIDATES
  ) {
    return null;
  }

  const candidateIds = new Set<string>();
  const candidates: PublicCompletionCandidate[] = [];
  for (const raw of value.candidates) {
    if (!isRecord(raw)) return null;
    const { candidateId, text, confidence, modelScore, gateScore, language } = raw;
    if (
      typeof candidateId !== 'string' ||
      candidateId.length === 0 ||
      candidateId.length > 128 ||
      candidateIds.has(candidateId) ||
      typeof text !== 'string' ||
      text.length === 0 ||
      /[\r\n\0]/u.test(text) ||
      codePointLength(text) > engine.maxOutputCodePoints ||
      typeof confidence !== 'number' ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 1 ||
      typeof modelScore !== 'number' ||
      !Number.isFinite(modelScore) ||
      modelScore < 0 ||
      modelScore > 1 ||
      typeof gateScore !== 'number' ||
      !Number.isFinite(gateScore) ||
      gateScore < 0 ||
      gateScore > 1 ||
      (language !== 'zh' && language !== 'en') ||
      !candidateMatchesLanguage(text, language, request.languageHint, request.cursorBoundary)
    ) {
      return null;
    }
    candidateIds.add(candidateId);
    candidates.push({
      candidateId,
      text,
      confidence,
      modelScore,
      gateScore,
      from: request.cursorPos,
      providerId: engine.id,
      source: engine.sourceKind,
      sourceLayer: 'l3',
      syntaxType: 'general',
      learnable: true,
      priority: PUBLIC_ENGINE_PROVIDER_PRIORITY,
      language,
    });
  }
  return candidates;
}

function candidateMatchesLanguage(
  text: string,
  language: 'zh' | 'en',
  languageHint: CompletionLanguageHint,
  cursorBoundary: PublicEngineGenerateRequest['cursorBoundary'],
): boolean {
  const containsCjk =
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text);
  const containsLatin = /\p{Script=Latin}/u.test(text);
  if (containsCjk && containsLatin) return false;
  if (
    language === 'zh' &&
    (!containsCjk || containsLatin || (text.match(/\p{Script=Han}/gu)?.length ?? 0) < 3)
  ) {
    return false;
  }
  if (language === 'en') {
    if (!containsLatin || containsCjk || (text.match(/[A-Za-z]/gu)?.length ?? 0) < 5) return false;
    const completeWord =
      cursorBoundary === 'word'
        ? /[\s\p{P}\p{S}][A-Za-z][A-Za-z'-]*(?=$|[\s\p{P}\p{S}])/u
        : /(?:^|[\s\p{P}\p{S}])[A-Za-z][A-Za-z'-]*(?=$|[\s\p{P}\p{S}])/u;
    if (!completeWord.test(text)) return false;
  }
  return languageHint !== 'zh' && languageHint !== 'en' ? true : language === languageHint;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function codePointLength(text: string): number {
  return Array.from(text).length;
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function takeLastUtf8Bytes(text: string, maxBytes: number): string {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0 || text.length === 0) return '';
  const byteLimit = Math.trunc(maxBytes);
  const encoder = new TextEncoder();
  let start = text.length;
  let bytes = 0;
  while (start > 0) {
    let previous = start - 1;
    const lastUnit = text.charCodeAt(previous);
    if (lastUnit >= 0xdc00 && lastUnit <= 0xdfff && previous > 0) {
      const firstUnit = text.charCodeAt(previous - 1);
      if (firstUnit >= 0xd800 && firstUnit <= 0xdbff) previous -= 1;
    }
    const pointBytes = encoder.encode(text.slice(previous, start)).byteLength;
    if (bytes + pointBytes > byteLimit) break;
    bytes += pointBytes;
    start = previous;
  }
  return text.slice(start);
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

async function safeDisposePublicEngine(engine: CompletionPublicEngine | null): Promise<void> {
  try {
    await engine?.dispose();
  } catch {
    // Disposal failure must never disable the remaining completion layers.
  }
}

function takeLastCodePoints(text: string, count: number): string {
  return Array.from(text).slice(-count).join('');
}
