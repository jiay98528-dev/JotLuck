import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createDefaultHybridRetrievalBackend,
  DisabledHybridRetrievalBackend,
  HYBRID_MUTATION_BATCH_MAX_INPUT_BYTES,
  HybridRetrievalService,
  LocalHybridRetrievalBackend,
  type HybridRetrievalBackend,
} from '../hybrid-retrieval-backend';
import type {
  HybridRetrievalBudget,
  HybridRetrievalDocumentMutationRequest,
  HybridRetrievalLanguageHint,
  HybridRetrievalRequest,
  HybridRetrievalResponse,
} from '../hybrid-retrieval-types';

const VALID_ZH_CANDIDATE = {
  text: '需要确认。',
  confidence: 0.8,
  support: 3,
  documentSupport: 2,
  providerId: 'hybrid-retrieval-zh',
  sourceLayer: 'notebook',
} as const;

describe('hybrid retrieval backend service', () => {
  it('matches the shared Web/Rust golden fixture for batches, revisions, Unicode and budgets', async () => {
    const fixture = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'src-tauri/fixtures/completion-retrieval-golden.json'),
        'utf8',
      ),
    ) as GoldenFixture;
    expect(fixture.schema).toBe('completion-retrieval-golden-v1');

    for (const scenario of fixture.scenarios) {
      const backend = new LocalHybridRetrievalBackend(scenario.budget);
      let committedRevision = 0;
      for (const batch of scenario.batches) {
        const mutations = batch.mutations.map((mutation) =>
          goldenMutationToRequest(scenario.workspaceScope, mutation),
        );
        const response = await backend.execute({
          operation: 'batch',
          workspaceScope: scenario.workspaceScope,
          mutations,
        });
        expect(response).toMatchObject({ operation: 'batch', ...batch.expected });
        committedRevision = batch.expected.revision;

        for (const query of batch.queries) {
          const queryResponse = await backend.execute({
            operation: 'query',
            workspaceScope: scenario.workspaceScope,
            contextBeforeCursor: query.contextBeforeCursor,
            languageHint: query.languageHint,
            maxCandidates: 8,
          });
          expect(queryResponse).toMatchObject({
            operation: 'query',
            candidates: query.expectedCandidates,
            committedRevision: batch.expected.revision,
          });
        }
      }
      expect({
        ...backend.getIndexDiagnostics(scenario.workspaceScope),
        committedRevision,
      }).toMatchObject(scenario.expectedDiagnostics);
    }
  });

  it('disables Hybrid Retrieval when module Worker construction throws synchronously', () => {
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new DOMException('blocked by CSP', 'SecurityError');
        }
      },
    );
    try {
      expect(createDefaultHybridRetrievalBackend()).toBeInstanceOf(DisabledHybridRetrievalBackend);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('queries the last committed snapshot while mutations commit in order', async () => {
    const service = new HybridRetrievalService({ backend: new LocalHybridRetrievalBackend() });
    service.setWorkspaceScope('workspace-a');
    service.replaceDocument('/a.md', '项目计划需要复核风险。');
    service.replaceDocument('/b.md', '项目计划需要复核风险。');

    expect(await service.query('项目计划', 'zh')).toEqual([]);
    await vi.waitFor(() => expect(service.getHealthDiagnostics().pendingMutations).toBe(0));
    const candidates = await service.query('项目计划', 'zh');
    expect(candidates[0]).toMatchObject({
      text: '需要复核风险。',
      documentSupport: 2,
      sourceLayer: 'notebook',
    });
  });

  it('clears the previous workspace and ignores old-scope results after a switch', async () => {
    const service = new HybridRetrievalService({ backend: new LocalHybridRetrievalBackend() });
    service.setWorkspaceScope('workspace-a');
    service.replaceDocument('/a.md', '项目计划需要复核风险。');
    service.replaceDocument('/b.md', '项目计划需要复核风险。');
    await vi.waitFor(() => expect(service.getHealthDiagnostics().pendingMutations).toBe(0));
    expect(await service.query('项目计划', 'zh')).toHaveLength(1);

    service.setWorkspaceScope('workspace-b');
    expect(await service.query('项目计划', 'zh')).toEqual([]);
    service.replaceDocument('/a.md', '项目计划可以开始执行。');
    service.replaceDocument('/b.md', '项目计划可以开始执行。');
    await vi.waitFor(() => expect(service.getHealthDiagnostics().pendingMutations).toBe(0));
    expect((await service.query('项目计划', 'zh'))[0]?.text).toBe('可以开始执行。');
  });

  it('truncates context, caps results, and returns an empty fallback when aborted', async () => {
    const observed: HybridRetrievalRequest[] = [];
    const backend: HybridRetrievalBackend = {
      async execute(request) {
        observed.push(request);
        if (request.operation === 'query') return emptyQueryResponse();
        return mutationResponse(request.operation, 0);
      },
      dispose() {},
    };
    const service = new HybridRetrievalService({ backend });
    const controller = new AbortController();
    controller.abort('test');

    expect(await service.query('前'.repeat(700), 'zh', 99, controller.signal)).toEqual([]);
    expect(observed).toEqual([]);

    await service.query('前'.repeat(700), 'zh', 99);
    const query = observed.find((request) => request.operation === 'query');
    expect(query?.operation).toBe('query');
    if (query?.operation === 'query') {
      expect(Array.from(query.contextBeforeCursor)).toHaveLength(512);
      expect(query.maxCandidates).toBe(8);
    }
  });

  it('merges validated native health without trusting malformed diagnostics', async () => {
    const backend: HybridRetrievalBackend = {
      kind: 'tauri',
      execute(request): Promise<HybridRetrievalResponse> {
        if (request.operation === 'query') return Promise.resolve(emptyQueryResponse());
        return Promise.resolve(mutationResponse(request.operation, 0));
      },
      readHealthDiagnostics: vi
        .fn()
        .mockResolvedValueOnce({
          committedRevision: 7,
          pendingMutations: 3,
          pendingMutationBatches: 1,
          lastBuildDurationMs: 9,
          totalBuildDurationMs: 27,
          inputBytes: 1024,
          estimatedIndexBytes: 4096,
          longTasksOver50Ms: 0,
        })
        .mockResolvedValueOnce({ committedRevision: -1 }),
      dispose() {},
    };
    const service = new HybridRetrievalService({ backend });

    await expect(service.refreshHealthDiagnostics()).resolves.toMatchObject({
      backendKind: 'tauri',
      committedRevision: 7,
      pendingMutations: 3,
      pendingMutationBatches: 1,
      status: 'warming',
      lastBuildDurationMs: 9,
      totalBuildDurationMs: 27,
      inputBytes: 1024,
      estimatedIndexBytes: 4096,
      longTasksOver50Ms: 0,
    });
    await service.refreshHealthDiagnostics();
    expect(service.getHealthDiagnostics().committedRevision).toBe(7);
  });

  it('rebuilds once after a backend failure, then disables after a second failure', async () => {
    let calls = 0;
    const broken: HybridRetrievalBackend = {
      execute(): Promise<HybridRetrievalResponse> {
        calls++;
        return Promise.reject(new Error('backend unavailable'));
      },
      dispose() {},
    };
    const replacement: HybridRetrievalBackend = {
      execute(request): Promise<HybridRetrievalResponse> {
        if (request.operation === 'query') return Promise.resolve(emptyQueryResponse());
        return Promise.resolve(mutationResponse(request.operation, 1));
      },
      dispose() {},
    };
    const service = new HybridRetrievalService({
      backend: broken,
      backendFactory: () => replacement,
    });
    service.setReplayDocumentsProvider(() => [{ path: '/a.md', content: '项目计划需要复核。' }]);
    expect(await service.query('项目计划', 'zh')).toEqual([]);
    await vi.waitFor(() => expect(service.getHealthDiagnostics().status).toBe('ready'));
    expect(await service.query('项目计划', 'zh')).toEqual([]);
    expect(calls).toBe(1);
    expect(service.getHealthDiagnostics()).toMatchObject({ rebuildCount: 1, status: 'ready' });

    replacement.execute = () => Promise.reject(new Error('second failure'));
    expect(await service.query('再次失败', 'zh')).toEqual([]);
    expect(service.getHealthDiagnostics().status).toBe('disabled');
  });

  it('queues mutations that arrive while the replacement backend is warming', async () => {
    let releaseReplay: (() => void) | undefined;
    const replayGate = new Promise<void>((resolve) => {
      releaseReplay = resolve;
    });
    const appliedPaths: string[] = [];
    const broken: HybridRetrievalBackend = {
      execute: () => Promise.reject(new Error('backend unavailable')),
      dispose() {},
    };
    const replacement: HybridRetrievalBackend = {
      async execute(request) {
        if (request.operation === 'query') return emptyQueryResponse(2, 0);
        if (request.operation === 'replace') appliedPaths.push(request.path);
        if (request.operation === 'batch') {
          appliedPaths.push(
            ...request.mutations
              .filter((mutation) => mutation.operation === 'replace')
              .map((mutation) => (mutation.operation === 'replace' ? mutation.path : '')),
          );
        }
        return mutationResponse(request.operation, appliedPaths.length);
      },
      dispose() {},
    };
    const service = new HybridRetrievalService({
      backend: broken,
      backendFactory: () => replacement,
    });
    service.setReplayDocumentsProvider(async () => {
      await replayGate;
      return [{ path: '/replayed.md', content: 'replayed content' }];
    });

    await service.query('trigger recovery', 'en');
    service.replaceDocument('/late.md', 'late content');
    releaseReplay?.();

    await vi.waitFor(() =>
      expect(service.getHealthDiagnostics()).toMatchObject({
        status: 'ready',
        pendingMutations: 0,
      }),
    );
    expect(appliedPaths).toEqual(['/replayed.md', '/late.md']);
  });

  it('allows one rebuild independently for each workspace scope', async () => {
    const broken: HybridRetrievalBackend = {
      execute: () => Promise.reject(new Error('initial failure')),
      dispose() {},
    };
    const replacements = [createHealthyBackend(), createHealthyBackend()];
    const service = new HybridRetrievalService({
      backend: broken,
      backendFactory: () => replacements.shift()!,
    });
    service.setReplayDocumentsProvider(() => []);

    await service.query('first scope', 'en');
    await vi.waitFor(() => expect(service.getHealthDiagnostics().status).toBe('ready'));
    expect(service.getHealthDiagnostics().rebuildCount).toBe(1);

    service.setWorkspaceScope('workspace-b');
    await vi.waitFor(() => expect(service.getHealthDiagnostics().status).toBe('ready'));
    expect(service.getHealthDiagnostics().rebuildCount).toBe(0);
    const active = (service as unknown as { backend: HybridRetrievalBackend }).backend;
    active.execute = () => Promise.reject(new Error('workspace-b failure'));
    await service.query('second scope', 'en');
    await vi.waitFor(() => expect(service.getHealthDiagnostics().status).toBe('ready'));
    expect(service.getHealthDiagnostics().rebuildCount).toBe(1);
  });

  it('does not disable the service when an older query is superseded', async () => {
    let queryCalls = 0;
    let rejectFirst: ((error: Error) => void) | undefined;
    const backend: HybridRetrievalBackend = {
      execute(request): Promise<HybridRetrievalResponse> {
        if (request.operation !== 'query') {
          return Promise.resolve(mutationResponse(request.operation, 0));
        }
        queryCalls++;
        if (queryCalls === 1) {
          return new Promise((_, reject) => {
            rejectFirst = reject;
          });
        }
        const error = new Error('superseded');
        error.name = 'AbortError';
        rejectFirst?.(error);
        return Promise.resolve(emptyQueryResponse());
      },
      dispose() {},
    };
    const service = new HybridRetrievalService({ backend });
    const first = service.query('旧上下文', 'zh');
    await Promise.resolve();
    const current = service.query('当前上下文', 'zh');

    await expect(first).resolves.toEqual([]);
    await expect(current).resolves.toEqual([]);
    expect(await service.query('后续上下文', 'zh')).toEqual([]);
    expect(queryCalls).toBe(3);
  });

  it('queries the committed snapshot without waiting for a never-ending mutation', async () => {
    const never = new Promise<HybridRetrievalResponse>(() => undefined);
    let disposeCalls = 0;
    const backend: HybridRetrievalBackend = {
      execute: (request) =>
        request.operation === 'query' ? Promise.resolve(emptyQueryResponse(0, 1)) : never,
      dispose: () => {
        disposeCalls++;
        return new Promise<void>(() => undefined);
      },
    };
    const service = new HybridRetrievalService({ backend });
    service.replaceDocument('/blocked.md', '永不完成');
    const pendingQuery = service.query('项目计划', 'zh');
    await Promise.resolve();

    await expect(pendingQuery).resolves.toEqual([]);
    await expect(service.dispose()).resolves.toBeUndefined();
    expect(disposeCalls).toBe(1);
    expect(await service.query('后续请求', 'zh')).toEqual([]);
  });

  it('serves a query within its turn while 5000 mutations are queued', async () => {
    let mutationCalls = 0;
    let queryCalls = 0;
    const backend: HybridRetrievalBackend = {
      execute(request): Promise<HybridRetrievalResponse> {
        if (request.operation === 'query') {
          queryCalls++;
          return Promise.resolve(emptyQueryResponse(0, 5000));
        }
        mutationCalls++;
        return Promise.resolve(mutationResponse(request.operation, mutationCalls));
      },
      dispose() {},
    };
    const service = new HybridRetrievalService({ backend });
    for (let index = 0; index < 5000; index++) {
      service.replaceDocument(`/note-${index}.md`, `项目计划 ${index}`);
    }

    await expect(service.query('项目计划', 'zh')).resolves.toEqual([]);
    expect(queryCalls).toBe(1);
    expect(mutationCalls).toBeLessThan(5000);
    expect(service.getHealthDiagnostics().pendingMutations).toBeGreaterThan(0);
    await service.dispose();
  });

  it('commits at most eight document mutations per revision and tracks pending documents', async () => {
    const batches: HybridRetrievalRequest[] = [];
    let revision = 0;
    const backend: HybridRetrievalBackend = {
      execute(request): Promise<HybridRetrievalResponse> {
        if (request.operation === 'query') {
          return Promise.resolve(emptyQueryResponse(revision));
        }
        batches.push(request);
        revision += 1;
        return Promise.resolve(mutationResponse(request.operation, revision));
      },
      dispose() {},
    };
    const service = new HybridRetrievalService({ backend });
    for (let index = 0; index < 17; index++) {
      service.replaceDocument(`/note-${index}.md`, `content ${index}`);
    }

    expect(service.getHealthDiagnostics().pendingMutations).toBe(17);
    await service.flushMutations();

    expect(
      batches.map((request) => (request.operation === 'batch' ? request.mutations.length : 0)),
    ).toEqual([8, 8, 1]);
    expect(service.getHealthDiagnostics()).toMatchObject({
      committedRevision: 3,
      pendingMutations: 0,
      pendingMutationBatches: 0,
    });
  });

  it('splits mutation batches before their UTF-8 input exceeds two MiB', async () => {
    const observedSizes: number[] = [];
    let revision = 0;
    const backend: HybridRetrievalBackend = {
      execute(request): Promise<HybridRetrievalResponse> {
        if (request.operation === 'query') return Promise.resolve(emptyQueryResponse(revision));
        if (request.operation === 'batch') {
          observedSizes.push(
            request.mutations.reduce(
              (total, mutation) =>
                total +
                (mutation.operation === 'replace'
                  ? new TextEncoder().encode(mutation.path + mutation.content).byteLength
                  : 0),
              0,
            ),
          );
        }
        revision += 1;
        return Promise.resolve(mutationResponse(request.operation, revision));
      },
      dispose() {},
    };
    const service = new HybridRetrievalService({ backend });
    const content = 'x'.repeat(400 * 1024);
    for (let index = 0; index < 8; index++) {
      service.replaceDocument(`/large-${index}.md`, content);
    }

    await service.flushMutations();

    expect(observedSizes.length).toBeGreaterThan(1);
    expect(observedSizes.every((bytes) => bytes <= HYBRID_MUTATION_BATCH_MAX_INPUT_BYTES)).toBe(
      true,
    );
  });

  it('flushes buffered mutations before scope change and dispose', async () => {
    const events: string[] = [];
    let revision = 0;
    const backend: HybridRetrievalBackend = {
      async setWorkspaceScope(scope) {
        events.push(`scope:${scope}`);
      },
      async execute(request): Promise<HybridRetrievalResponse> {
        if (request.operation === 'query') return Promise.resolve(emptyQueryResponse(revision));
        if (request.operation === 'batch') {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        revision += 1;
        events.push(
          request.operation === 'batch'
            ? `batch:${request.workspaceScope}:${request.mutations.length}`
            : request.operation,
        );
        return mutationResponse(request.operation, revision);
      },
      dispose() {
        events.push('dispose');
      },
    };
    const service = new HybridRetrievalService({ backend });
    service.setWorkspaceScope('workspace-a');
    service.replaceDocument('/a.md', 'alpha');
    service.setWorkspaceScope('workspace-b');
    await service.flushMutations();

    expect(events.indexOf('batch:workspace-a:1')).toBeLessThan(events.indexOf('scope:workspace-b'));

    service.replaceDocument('/b.md', 'beta');
    await service.dispose();
    expect(events).toContain('batch:workspace-b:1');
    expect(events.at(-1)).toBe('dispose');
  });

  it('treats a scope switch during rebuild as obsolete instead of a failure', async () => {
    let replayStarted = false;
    const broken: HybridRetrievalBackend = {
      execute: () => Promise.reject(new Error('workspace-a failed')),
      dispose() {},
    };
    const warming = createHealthyBackend();
    const workspaceB = createHealthyBackend();
    const replacements = [warming, workspaceB];
    const service = new HybridRetrievalService({
      backend: broken,
      backendFactory: () => replacements.shift()!,
    });
    service.setReplayDocumentsProvider(
      (_scope, signal) =>
        new Promise((_resolve, reject) => {
          replayStarted = true;
          signal.addEventListener(
            'abort',
            () => {
              const error = new Error('obsolete');
              error.name = 'AbortError';
              reject(error);
            },
            { once: true },
          );
        }),
    );

    await service.query('trigger recovery', 'en');
    await vi.waitFor(() => expect(replayStarted).toBe(true));
    service.setWorkspaceScope('workspace-b');
    await service.flushMutations();

    expect(service.getHealthDiagnostics()).toMatchObject({
      workspaceScope: 'workspace-b',
      status: 'ready',
      rebuildCount: 0,
    });
    await expect(service.query('workspace b', 'en')).resolves.toEqual([]);
    service.setWorkspaceScope('unscoped');
    await service.flushMutations();
    expect(service.getHealthDiagnostics()).toMatchObject({ status: 'ready', rebuildCount: 0 });
  });

  it('disables only the twice-failed scope and leaves another scope usable', async () => {
    const broken: HybridRetrievalBackend = {
      execute: () => Promise.reject(new Error('initial failure')),
      dispose() {},
    };
    const replacement: HybridRetrievalBackend = {
      execute(request): Promise<HybridRetrievalResponse> {
        if (request.workspaceScope === 'workspace-a') {
          return Promise.reject(new Error('workspace-a second failure'));
        }
        if (request.operation === 'query') return Promise.resolve(emptyQueryResponse());
        return Promise.resolve(mutationResponse(request.operation, 1));
      },
      dispose() {},
    };
    const service = new HybridRetrievalService({
      backend: broken,
      backendFactory: () => replacement,
    });
    service.setWorkspaceScope('workspace-a');
    service.setReplayDocumentsProvider(() => []);

    await service.query('first failure', 'en');
    await vi.waitFor(() => expect(service.getHealthDiagnostics().status).toBe('ready'));
    await service.query('second failure', 'en');
    expect(service.getHealthDiagnostics().status).toBe('disabled');

    service.setWorkspaceScope('workspace-b');
    await service.flushMutations();
    expect(service.getHealthDiagnostics()).toMatchObject({ status: 'ready', rebuildCount: 0 });
    await expect(service.query('workspace b', 'en')).resolves.toEqual([]);
  });

  it.each([
    { operation: 'query', candidates: 'not-an-array' },
    { operation: 'query', candidates: Array.from({ length: 9 }, () => VALID_ZH_CANDIDATE) },
    {
      operation: 'query',
      candidates: [{ ...VALID_ZH_CANDIDATE, text: '' }],
    },
    {
      operation: 'query',
      candidates: [{ ...VALID_ZH_CANDIDATE, text: '超'.repeat(25) }],
    },
    {
      operation: 'query',
      candidates: [{ ...VALID_ZH_CANDIDATE, confidence: 1.1 }],
    },
    {
      operation: 'query',
      candidates: [{ ...VALID_ZH_CANDIDATE, support: 0 }],
    },
    {
      operation: 'query',
      candidates: [{ ...VALID_ZH_CANDIDATE, documentSupport: 4 }],
    },
    {
      operation: 'query',
      candidates: [{ ...VALID_ZH_CANDIDATE, providerId: 'untrusted-provider' }],
    },
    {
      operation: 'query',
      candidates: [{ ...VALID_ZH_CANDIDATE, sourceLayer: 'l3' }],
    },
    {
      operation: 'query',
      candidates: [{ ...VALID_ZH_CANDIDATE, text: '中文mixed' }],
    },
    {
      operation: 'query',
      candidates: [
        {
          ...VALID_ZH_CANDIDATE,
          text: 'four english words here',
          providerId: 'hybrid-retrieval-en',
        },
      ],
    },
    { operation: 'query', candidates: [], committedRevision: -1 },
    { operation: 'query', candidates: [], pendingMutations: -1 },
    { operation: 'query', candidates: [], warming: 'yes' },
  ])('fails closed when Worker/Tauri returns malformed query data: %#', async (payload) => {
    let calls = 0;
    const backend: HybridRetrievalBackend = {
      execute: () => {
        calls++;
        return Promise.resolve({
          committedRevision: 0,
          pendingMutations: 0,
          warming: false,
          ...payload,
        } as unknown as HybridRetrievalResponse);
      },
      dispose() {},
    };
    const service = new HybridRetrievalService({ backend });

    expect(await service.query('项目计划', 'zh')).toEqual([]);
    expect(await service.query('项目计划', 'zh')).toEqual([]);
    expect(calls).toBe(1);
  });
});

function emptyQueryResponse(revision = 0, pendingMutations = 0): HybridRetrievalResponse {
  return {
    operation: 'query',
    candidates: [],
    committedRevision: revision,
    pendingMutations,
    warming: pendingMutations > 0,
  };
}

function createHealthyBackend(): HybridRetrievalBackend {
  let revision = 0;
  return {
    execute(request): Promise<HybridRetrievalResponse> {
      if (request.operation === 'query') {
        return Promise.resolve(emptyQueryResponse(revision));
      }
      revision += 1;
      return Promise.resolve(mutationResponse(request.operation, revision));
    },
    dispose() {},
  };
}

function mutationResponse(
  operation: Exclude<HybridRetrievalRequest['operation'], 'query'>,
  revision: number,
): HybridRetrievalResponse {
  return { operation, changed: true, documentCount: 0, revision };
}

interface GoldenMutation {
  operation: 'replace' | 'remove' | 'rename' | 'clear';
  path?: string;
  content?: string;
  oldPath?: string;
  newPath?: string;
}

interface GoldenFixture {
  schema: string;
  scenarios: Array<{
    workspaceScope: string;
    budget?: Partial<HybridRetrievalBudget>;
    expectedDiagnostics: {
      documentCount: number;
      inputBytes: number;
      documentEntries: number;
      budgetRejections: number;
      committedRevision: number;
    };
    batches: Array<{
      mutations: GoldenMutation[];
      expected: { changed: boolean; documentCount: number; revision: number };
      queries: Array<{
        contextBeforeCursor: string;
        languageHint: HybridRetrievalLanguageHint;
        expectedCandidates: unknown[];
      }>;
    }>;
  }>;
}

function goldenMutationToRequest(
  workspaceScope: string,
  mutation: GoldenMutation,
): HybridRetrievalDocumentMutationRequest {
  switch (mutation.operation) {
    case 'replace':
      return {
        operation: 'replace',
        workspaceScope,
        path: mutation.path ?? '',
        content: mutation.content ?? '',
      };
    case 'remove':
      return { operation: 'remove', workspaceScope, path: mutation.path ?? '' };
    case 'rename':
      return {
        operation: 'rename',
        workspaceScope,
        oldPath: mutation.oldPath ?? '',
        newPath: mutation.newPath ?? '',
      };
    case 'clear':
      return { operation: 'clear', workspaceScope };
  }
}
