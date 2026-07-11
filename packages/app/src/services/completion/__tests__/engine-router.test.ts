import { describe, expect, it, vi } from 'vitest';
import {
  CompletionEngineRouter,
  createCompletionCandidateBatch,
  type CompletionRanker,
} from '../engine-router';
import type { CompletionCandidate } from '../types';

function candidate(text: string, source: CompletionCandidate['source'] = 'ngram') {
  return {
    text,
    confidence: 0.7,
    from: 4,
    providerId: text,
    source,
    sourceLayer: source === 'structured' ? ('provider' as const) : ('notebook' as const),
    syntaxType: 'general',
    learnable: source !== 'structured',
    priority: source === 'structured' ? 100 : 50,
  } satisfies CompletionCandidate;
}

function batchFor(
  router: CompletionEngineRouter,
  candidates: CompletionCandidate[],
  deadlineAt = performance.now() + 100,
) {
  return createCompletionCandidateBatch({
    requestId: 'request-1',
    engineEpoch: router.getEpoch(),
    workspaceScope: 'workspace-a',
    documentVersion: 'doc-v1',
    cursorPos: 4,
    contextBeforeCursor: `${'前'.repeat(300)}上下文`,
    languageHint: 'zh',
    blockType: 'paragraph',
    deadlineAt,
    candidates,
  });
}

describe('completion engine router', () => {
  it('limits and projects a candidate batch without exposing the full document', () => {
    const router = new CompletionEngineRouter();
    const candidates = Array.from({ length: 10 }, (_, index) => candidate(`候选${index}`));
    const batch = batchFor(router, candidates);

    expect(batch.candidates).toHaveLength(8);
    expect(Array.from(batch.request.contextTail)).toHaveLength(256);
    expect(batch.candidates[0]?.candidateId).toMatch(/^0:/u);
    expect(batch.fallbackCandidateId).toBe(batch.candidates[0]?.candidateId);
  });

  it('accepts only scores for existing candidate IDs and preserves candidate payloads', async () => {
    const router = new CompletionEngineRouter();
    const candidates = [candidate('第一'), candidate('第二'), candidate('第三')];
    const ranker: CompletionRanker = {
      id: 'test-ranker',
      rank: vi.fn(async ({ candidates: snapshots }) => [
        { candidateId: snapshots[1]!.candidateId, score: 0.9 },
        { candidateId: 'unknown', score: 100 },
        { candidateId: snapshots[0]!.candidateId, score: 0.1 },
      ]),
    };
    await router.installRanker(ranker);
    const batch = batchFor(router, candidates);
    const result = await router.rank(batch, candidates);

    expect(result.orderedCandidates.map((item) => item.text)).toEqual(['第二', '第一', '第三']);
    expect(result.orderedCandidates[0]).toBe(candidates[1]);
    expect(result.usedRankerId).toBe('test-ranker');
  });

  it('bypasses a ranker whenever a deterministic structured candidate is present', async () => {
    const router = new CompletionEngineRouter();
    const rank = vi.fn(async () => []);
    await router.installRanker({ id: 'test-ranker', rank });
    const candidates = [candidate(']]', 'structured'), candidate('普通')];
    const result = await router.rank(batchFor(router, candidates), candidates);

    expect(rank).not.toHaveBeenCalled();
    expect(result.orderedCandidates).toEqual(candidates);
  });

  it('falls back on deadline and aborts a late ranker', async () => {
    vi.useFakeTimers();
    try {
      const router = new CompletionEngineRouter();
      const observed: { signal?: AbortSignal } = {};
      await router.installRanker({
        id: 'late-ranker',
        rank: (_request, signal) => {
          observed.signal = signal;
          return new Promise(() => undefined);
        },
      });
      const candidates = [candidate('第一'), candidate('第二')];
      const pending = router.rank(batchFor(router, candidates, performance.now() + 20), candidates);
      await vi.advanceTimersByTimeAsync(25);
      const result = await pending;

      expect(result.fellBack).toBe(true);
      expect(result.orderedCandidates).toEqual(candidates);
      expect(observed.signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a result that returns after the deadline even when timers could not preempt it', async () => {
    let now = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      const router = new CompletionEngineRouter();
      await router.installRanker({
        id: 'blocking-ranker',
        rank: async ({ candidates: snapshots }) => {
          now = 6;
          return [{ candidateId: snapshots[1]!.candidateId, score: 1 }];
        },
      });
      const candidates = [candidate('第一'), candidate('第二')];
      const result = await router.rank(batchFor(router, candidates, 5), candidates);

      expect(result.fellBack).toBe(true);
      expect(result.orderedCandidates).toEqual(candidates);
      expect(result.usedRankerId).toBeNull();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('warms a replacement before atomically swapping and keeps the old ranker on failure', async () => {
    const router = new CompletionEngineRouter();
    const oldDispose = vi.fn();
    await router.installRanker({ id: 'old', rank: async () => [], dispose: oldDispose });
    const epoch = router.getEpoch();
    const brokenDispose = vi.fn();
    const installed = await router.installRanker({
      id: 'broken',
      warmup: async () => {
        throw new Error('bad model');
      },
      rank: async () => [],
      dispose: brokenDispose,
    });

    expect(installed).toBe(false);
    expect(router.getActiveRankerId()).toBe('old');
    expect(router.getEpoch()).toBe(epoch);
    expect(oldDispose).not.toHaveBeenCalled();
    expect(brokenDispose).toHaveBeenCalledOnce();
  });

  it('does not let a slower concurrent install overwrite the latest ranker', async () => {
    const router = new CompletionEngineRouter();
    let finishSlow: (() => void) | null = null;
    const slowDispose = vi.fn();
    const slowInstall = router.installRanker({
      id: 'slow',
      warmup: () =>
        new Promise<void>((resolve) => {
          finishSlow = resolve;
        }),
      rank: async () => [],
      dispose: slowDispose,
    });
    await vi.waitFor(() => expect(finishSlow).not.toBeNull());

    await expect(router.installRanker({ id: 'latest', rank: async () => [] })).resolves.toBe(true);
    const finish = finishSlow as (() => void) | null;
    finish?.();

    await expect(slowInstall).resolves.toBe(false);
    expect(router.getActiveRankerId()).toBe('latest');
    expect(slowDispose).toHaveBeenCalledOnce();
  });

  it('does not revive a warming ranker after removeRanker', async () => {
    const router = new CompletionEngineRouter();
    let finishWarmup: (() => void) | null = null;
    const dispose = vi.fn();
    const installing = router.installRanker({
      id: 'warming',
      warmup: () =>
        new Promise<void>((resolve) => {
          finishWarmup = resolve;
        }),
      rank: async () => [],
      dispose,
    });
    await vi.waitFor(() => expect(finishWarmup).not.toBeNull());

    await router.removeRanker();
    const finish = finishWarmup as (() => void) | null;
    finish?.();

    await expect(installing).resolves.toBe(false);
    expect(router.getActiveRankerId()).toBeNull();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
