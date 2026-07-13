import { describe, expect, it, vi } from 'vitest';
import {
  CompletionEngineRouter,
  createCompletionCandidateBatch,
  type CompletionRanker,
} from '../engine-router';
import type { CompletionCandidate } from '../types';
import {
  PUBLIC_ENGINE_MAX_OUTPUT_CODE_POINTS,
  PUBLIC_ENGINE_PROTOCOL_VERSION,
  PUBLIC_ENGINE_PROVIDER_PRIORITY,
  createEmptyPublicEngineAssetDiagnostics,
  type CompletionPublicEngine,
  type PublicEngineGenerateRequest,
  type PublicEngineRawCandidate,
  type PublicEngineDiagnostics,
} from '../public-engine-types';

const TEST_PUBLIC_ENGINE_ID = 'test-public-engine';

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

function publicEngineDiagnostics(epoch = 1): PublicEngineDiagnostics {
  return {
    engineId: TEST_PUBLIC_ENGINE_ID,
    backendKind: 'worker',
    status: 'ready',
    epoch,
    profile: 'web-local',
    lastError: null,
    warmupDurationMs: 1,
    lastInferenceDurationMs: 0,
    visibleInferenceP90Ms: 0,
    generateRequests: 0,
    generatedCandidates: 0,
    cancellations: 0,
    deadlineExpirations: 0,
    lateResponses: 0,
    invalidResponses: 0,
    workerErrors: 0,
    assets: createEmptyPublicEngineAssetDiagnostics(),
  };
}

function publicEngine(
  generate: CompletionPublicEngine['generate'],
  overrides: Partial<CompletionPublicEngine> = {},
): CompletionPublicEngine {
  const engine: CompletionPublicEngine = {
    id: TEST_PUBLIC_ENGINE_ID,
    protocolVersion: PUBLIC_ENGINE_PROTOCOL_VERSION,
    sourceKind: 'ngram',
    maxOutputCodePoints: PUBLIC_ENGINE_MAX_OUTPUT_CODE_POINTS,
    warmup: async () => true,
    generate,
    diagnostics: () => publicEngineDiagnostics(),
    dispose: () => undefined,
  };
  return Object.assign(engine, overrides);
}

function publicResponse(
  request: PublicEngineGenerateRequest,
  candidates: readonly PublicEngineRawCandidate[],
) {
  return {
    protocolVersion: PUBLIC_ENGINE_PROTOCOL_VERSION,
    engineEpoch: request.engineEpoch,
    workspaceScope: request.workspaceScope,
    documentVersion: request.documentVersion,
    cursorPos: request.cursorPos,
    candidates,
  };
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

  it('warms and invokes the public generator without allowing it to escape the router epoch', async () => {
    const router = new CompletionEngineRouter();
    const generate = vi.fn<CompletionPublicEngine['generate']>(async (request) =>
      publicResponse(request, [
        {
          candidateId: 'candidate-en-1',
          text: ' after the review',
          confidence: 0.94,
          modelScore: 0.92,
          gateScore: 0.96,
          language: 'en',
        },
      ]),
    );
    await expect(router.installPublicEngine(publicEngine(generate))).resolves.toBe(true);
    const routerEpoch = router.getEpoch();
    const result = await router.generatePublic(
      {
        workspaceScope: 'workspace-a',
        documentVersion: 'doc-v1',
        cursorPos: 12,
        contextTail: 'Project plan',
        languageHint: 'en',
        blockType: 'paragraph',
        cursorBoundary: 'word',
        maxCandidates: 32,
        deadlineAt: Date.now() + 100,
      },
      routerEpoch,
      performance.now() + 100,
    );

    expect(result.usedEngineId).toBe(TEST_PUBLIC_ENGINE_ID);
    expect(result.candidates[0]).toMatchObject({
      text: ' after the review',
      from: 12,
      providerId: TEST_PUBLIC_ENGINE_ID,
      source: 'ngram',
      sourceLayer: 'l3',
      priority: PUBLIC_ENGINE_PROVIDER_PRIORITY,
      modelScore: 0.92,
      gateScore: 0.96,
    });

    router.bumpEpoch();
    const obsolete = await router.generatePublic(
      {
        workspaceScope: 'workspace-a',
        documentVersion: 'doc-v1',
        cursorPos: 12,
        contextTail: 'Project plan',
        languageHint: 'en',
        blockType: 'paragraph',
        cursorBoundary: 'word',
        maxCandidates: 32,
        deadlineAt: Date.now() + 100,
      },
      routerEpoch,
      performance.now() + 100,
    );
    expect(obsolete).toMatchObject({ candidates: [], fellBack: true, timedOut: false });
    expect(generate).toHaveBeenCalledOnce();
  });

  it('trims the public context to 256 UTF-8 bytes without splitting an emoji code point', async () => {
    const router = new CompletionEngineRouter();
    let observedRequest: PublicEngineGenerateRequest | null = null;
    await router.installPublicEngine(
      publicEngine(async (request) => {
        observedRequest = request;
        return publicResponse(request, []);
      }),
    );

    await router.generatePublic(
      {
        workspaceScope: 'workspace-a',
        documentVersion: 'doc-v1',
        cursorPos: 500,
        contextTail: `${'a'.repeat(300)}😀中文尾`,
        languageHint: 'zh',
        blockType: 'paragraph',
        cursorBoundary: 'word',
        maxCandidates: 32,
        deadlineAt: Date.now() + 100,
      },
      router.getEpoch(),
      performance.now() + 100,
    );

    const captured = observedRequest as PublicEngineGenerateRequest | null;
    expect(captured).not.toBeNull();
    expect(new TextEncoder().encode(captured?.contextTail ?? '').byteLength).toBeLessThanOrEqual(
      256,
    );
    expect(captured?.contextTailUtf8Bytes).toBe(
      new TextEncoder().encode(captured?.contextTail ?? '').byteLength,
    );
    expect(captured?.contextTail).toMatch(/😀中文尾$/u);
    expect(captured?.contextTail).not.toContain('\ufffd');
  });

  it.each([
    {
      name: 'duplicate candidate IDs',
      candidates: [
        {
          candidateId: 'same',
          text: ' reviewed',
          confidence: 0.9,
          modelScore: 0.88,
          gateScore: 0.92,
          language: 'en' as const,
        },
        {
          candidateId: 'same',
          text: ' approved',
          confidence: 0.8,
          modelScore: 0.78,
          gateScore: 0.82,
          language: 'en' as const,
        },
      ],
    },
    {
      name: 'mixed-language candidate text',
      candidates: [
        {
          candidateId: 'mixed',
          text: ' reviewed中文',
          confidence: 0.9,
          modelScore: 0.88,
          gateScore: 0.92,
          language: 'en' as const,
        },
      ],
    },
    {
      name: 'non-finite confidence',
      candidates: [
        {
          candidateId: 'nan',
          text: ' reviewed',
          confidence: Number.NaN,
          modelScore: 0.88,
          gateScore: 0.92,
          language: 'en' as const,
        },
      ],
    },
    {
      name: 'multi-line candidate text',
      candidates: [
        {
          candidateId: 'line',
          text: ' reviewed\nnext',
          confidence: 0.9,
          modelScore: 0.88,
          gateScore: 0.92,
          language: 'en' as const,
        },
      ],
    },
    {
      name: 'non-finite model score',
      candidates: [
        {
          candidateId: 'nan-model',
          text: ' reviewed',
          confidence: 0.9,
          modelScore: Number.NaN,
          gateScore: 0.92,
          language: 'en' as const,
        },
      ],
    },
    {
      name: 'out-of-range gate score',
      candidates: [
        {
          candidateId: 'bad-gate',
          text: ' reviewed',
          confidence: 0.9,
          modelScore: 0.88,
          gateScore: 1.01,
          language: 'en' as const,
        },
      ],
    },
    {
      name: 'partial word injected at a word cursor boundary',
      candidates: [
        {
          candidateId: 'partial-word',
          text: 'reviewed',
          confidence: 0.9,
          modelScore: 0.88,
          gateScore: 0.92,
          language: 'en' as const,
        },
      ],
    },
  ])('fails closed on $name', async ({ candidates }) => {
    const router = new CompletionEngineRouter();
    await router.installPublicEngine(
      publicEngine(async (request) => publicResponse(request, candidates)),
    );
    const result = await router.generatePublic(
      {
        workspaceScope: 'workspace-a',
        documentVersion: 'doc-v1',
        cursorPos: 12,
        contextTail: 'Project plan',
        languageHint: 'en',
        blockType: 'paragraph',
        cursorBoundary: 'word',
        maxCandidates: 32,
        deadlineAt: Date.now() + 100,
      },
      router.getEpoch(),
      performance.now() + 100,
    );

    expect(result).toMatchObject({ candidates: [], usedEngineId: null, fellBack: true });
  });

  it('fails closed when a Worker response echoes an obsolete engine epoch', async () => {
    const router = new CompletionEngineRouter();
    await router.installPublicEngine(
      publicEngine(async (request) => ({
        ...publicResponse(request, [
          {
            candidateId: 'candidate',
            text: ' reviewed',
            confidence: 0.9,
            modelScore: 0.88,
            gateScore: 0.92,
            language: 'en',
          },
        ]),
        engineEpoch: request.engineEpoch + 1,
      })),
    );
    const result = await router.generatePublic(
      {
        workspaceScope: 'workspace-a',
        documentVersion: 'doc-v1',
        cursorPos: 12,
        contextTail: 'Project plan',
        languageHint: 'en',
        blockType: 'paragraph',
        cursorBoundary: 'word',
        maxCandidates: 32,
        deadlineAt: Date.now() + 100,
      },
      router.getEpoch(),
      performance.now() + 100,
    );

    expect(result).toMatchObject({ candidates: [], usedEngineId: null, fellBack: true });
  });

  it('ignores privileged fields spoofed by an untrusted raw candidate', async () => {
    const router = new CompletionEngineRouter();
    await router.installPublicEngine(
      publicEngine(async (request) =>
        publicResponse(request, [
          {
            candidateId: 'spoofed',
            text: ' reviewed',
            confidence: 0.9,
            modelScore: 0.88,
            gateScore: 0.92,
            language: 'en',
            from: 0,
            providerId: 'attacker',
            source: 'neural',
            sourceLayer: 'provider',
            priority: 999,
          } as PublicEngineRawCandidate & Record<string, unknown>,
        ]),
      ),
    );
    const result = await router.generatePublic(
      {
        workspaceScope: 'workspace-a',
        documentVersion: 'doc-v1',
        cursorPos: 12,
        contextTail: 'Project plan',
        languageHint: 'en',
        blockType: 'paragraph',
        cursorBoundary: 'word',
        maxCandidates: 32,
        deadlineAt: Date.now() + 100,
      },
      router.getEpoch(),
      performance.now() + 100,
    );

    expect(result.candidates[0]).toMatchObject({
      from: 12,
      providerId: TEST_PUBLIC_ENGINE_ID,
      source: 'ngram',
      sourceLayer: 'l3',
      priority: PUBLIC_ENGINE_PROVIDER_PRIORITY,
    });
  });

  it('rejects an incompatible public protocol before warmup', async () => {
    const router = new CompletionEngineRouter();
    const warmup = vi.fn(async () => true);
    const dispose = vi.fn();
    const engine = publicEngine(async (request) => publicResponse(request, []), {
      protocolVersion: PUBLIC_ENGINE_PROTOCOL_VERSION + 1,
      warmup,
      dispose,
    });

    await expect(router.installPublicEngine(engine)).resolves.toBe(false);
    expect(warmup).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
    expect(router.getActivePublicEngineId()).toBeNull();
  });

  it('disposes a public engine that arrives after the router lifecycle ended', async () => {
    const router = new CompletionEngineRouter();
    const warmup = vi.fn(async () => true);
    const dispose = vi.fn();
    const lateEngine = publicEngine(async (request) => publicResponse(request, []), {
      warmup,
      dispose,
    });

    await router.dispose();
    await expect(router.installPublicEngine(lateEngine)).resolves.toBe(false);
    expect(warmup).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
    expect(router.getActivePublicEngineId()).toBeNull();
  });

  it('aborts a public generator at the shared prediction deadline', async () => {
    vi.useFakeTimers();
    try {
      const router = new CompletionEngineRouter();
      let observedSignal: AbortSignal | null | undefined = null;
      await router.installPublicEngine(
        publicEngine((_request, signal) => {
          observedSignal = signal;
          return new Promise(() => undefined);
        }),
      );
      const pending = router.generatePublic(
        {
          workspaceScope: 'workspace-a',
          documentVersion: 'doc-v1',
          cursorPos: 4,
          contextTail: '计划完成',
          languageHint: 'zh',
          blockType: 'paragraph',
          cursorBoundary: 'word',
          maxCandidates: 32,
          deadlineAt: Date.now() + 20,
        },
        router.getEpoch(),
        performance.now() + 20,
      );
      await vi.advanceTimersByTimeAsync(25);

      await expect(pending).resolves.toMatchObject({
        candidates: [],
        fellBack: true,
        timedOut: true,
      });
      expect((observedSignal as AbortSignal | null | undefined)?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
