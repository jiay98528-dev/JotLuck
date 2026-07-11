import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerHybridRetrievalBackend } from '../hybrid-retrieval-backend';
import type {
  HybridRetrievalQueryRequest,
  HybridRetrievalRequest,
  HybridRetrievalResponse,
} from '../hybrid-retrieval-types';

interface PostedRequestEnvelope {
  requestId: number;
  request: HybridRetrievalRequest;
}

interface PostedCancelEnvelope {
  requestId: number;
  cancel: true;
}

type PostedEnvelope = PostedRequestEnvelope | PostedCancelEnvelope;

class FakeWorker extends EventTarget {
  readonly posted: PostedEnvelope[] = [];
  terminated = false;
  throwOnPostMessage = false;

  postMessage(message: PostedEnvelope): void {
    if (this.throwOnPostMessage) throw new Error('structured clone failed');
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(requestId: number, response: HybridRetrievalResponse): void {
    this.dispatchEvent(
      new MessageEvent('message', {
        data: { requestId, response },
      }),
    );
  }
}

function createBackend(): {
  worker: FakeWorker;
  backend: WorkerHybridRetrievalBackend;
} {
  const worker = new FakeWorker();
  return {
    worker,
    backend: new WorkerHybridRetrievalBackend(worker as unknown as Worker),
  };
}

function queryRequest(contextBeforeCursor: string): HybridRetrievalQueryRequest {
  return {
    operation: 'query',
    workspaceScope: 'workspace-a',
    contextBeforeCursor,
    languageHint: 'zh',
    maxCandidates: 8,
  };
}

function queryResponse(text: string): HybridRetrievalResponse {
  return {
    operation: 'query',
    candidates: [
      {
        text,
        confidence: 0.8,
        support: 3,
        documentSupport: 2,
        providerId: 'hybrid-retrieval-zh',
        sourceLayer: 'notebook',
      },
    ],
    committedRevision: 0,
    pendingMutations: 0,
    warming: false,
  };
}

function replaceRequest(path: string): HybridRetrievalRequest {
  return {
    operation: 'replace',
    workspaceScope: 'workspace-a',
    path,
    content: '项目计划需要确认。',
  };
}

function replaceResponse(documentCount: number): HybridRetrievalResponse {
  return { operation: 'replace', changed: true, documentCount, revision: documentCount };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('WorkerHybridRetrievalBackend', () => {
  it('posts a request envelope and resolves the correlated response', async () => {
    const { worker, backend } = createBackend();
    const request = queryRequest('项目计划');

    const pending = backend.execute(request);

    expect(worker.posted).toEqual([{ requestId: 1, request }]);
    const response = queryResponse('需要确认。');
    worker.respond(1, response);
    await expect(pending).resolves.toEqual(response);
    backend.dispose();
  });

  it('keeps concurrent mutations correlated when responses arrive out of order', async () => {
    const { worker, backend } = createBackend();
    const first = backend.execute(replaceRequest('/a.md'));
    const second = backend.execute(replaceRequest('/b.md'));

    expect(worker.posted.map(({ requestId }) => requestId)).toEqual([1, 2]);
    worker.respond(2, replaceResponse(2));
    worker.respond(1, replaceResponse(1));

    await expect(second).resolves.toEqual(replaceResponse(2));
    await expect(first).resolves.toEqual(replaceResponse(1));
    backend.dispose();
  });

  it('cancels the previous query when a newer query is posted', async () => {
    const { worker, backend } = createBackend();
    const first = backend.execute(queryRequest('旧上下文'));
    const firstAssertion = expect(first).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Hybrid retrieval query was superseded.',
    });

    const current = backend.execute(queryRequest('当前上下文'));

    expect(worker.posted).toEqual([
      { requestId: 1, request: queryRequest('旧上下文') },
      { requestId: 1, cancel: true },
      { requestId: 2, request: queryRequest('当前上下文') },
    ]);
    await firstAssertion;
    worker.respond(2, queryResponse('当前结果。'));
    await expect(current).resolves.toEqual(queryResponse('当前结果。'));
    backend.dispose();
  });

  it('collapses continuous query supersession without delaying the latest request', async () => {
    const { worker, backend } = createBackend();
    const first = backend.execute(queryRequest('第一版'));
    const firstAssertion = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const second = backend.execute(queryRequest('第二版'));
    const secondAssertion = expect(second).rejects.toMatchObject({ name: 'AbortError' });
    const current = backend.execute(queryRequest('最终版'));

    await Promise.all([firstAssertion, secondAssertion]);
    expect(worker.posted.map((envelope) => envelope.requestId)).toEqual([1, 1, 2, 2, 3]);
    expect(worker.posted.filter((envelope) => 'cancel' in envelope)).toEqual([
      { requestId: 1, cancel: true },
      { requestId: 2, cancel: true },
    ]);

    worker.respond(3, queryResponse('最终结果。'));
    await expect(current).resolves.toEqual(queryResponse('最终结果。'));
    backend.dispose();
  });

  it('rejects an aborted request and ignores its late response', async () => {
    const { worker, backend } = createBackend();
    const controller = new AbortController();
    const aborted = backend.execute(queryRequest('旧上下文'), controller.signal);
    const abortedAssertion = expect(aborted).rejects.toMatchObject({
      name: 'AbortError',
      message: 'superseded',
    });

    controller.abort('superseded');
    await abortedAssertion;
    expect(worker.posted.at(-1)).toEqual({ requestId: 1, cancel: true });
    worker.respond(1, queryResponse('迟到结果。'));

    const current = backend.execute(queryRequest('当前上下文'));
    expect(worker.posted.at(-1)?.requestId).toBe(2);
    worker.respond(2, queryResponse('当前结果。'));
    await expect(current).resolves.toMatchObject({
      operation: 'query',
      candidates: [{ text: '当前结果。' }],
    });
    backend.dispose();
  });

  it('cleans pending state and abort listeners when postMessage throws synchronously', async () => {
    const { worker, backend } = createBackend();
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    worker.throwOnPostMessage = true;

    await expect(backend.execute(queryRequest('无法发送'), controller.signal)).rejects.toThrow(
      'structured clone failed',
    );
    expect(removeListener).toHaveBeenCalled();

    worker.throwOnPostMessage = false;
    const current = backend.execute(queryRequest('恢复请求'));
    expect(worker.posted.at(-1)).toMatchObject({ requestId: 2 });
    worker.respond(2, queryResponse('恢复结果。'));
    await expect(current).resolves.toEqual(queryResponse('恢复结果。'));
    backend.dispose();
  });

  it('terminates the Worker, rejects pending calls, and rejects future calls on dispose', async () => {
    const { worker, backend } = createBackend();
    const first = backend.execute(replaceRequest('/a.md'));
    const second = backend.execute(replaceRequest('/b.md'));
    const firstAssertion = expect(first).rejects.toThrow('Hybrid retrieval Worker was disposed.');
    const secondAssertion = expect(second).rejects.toThrow('Hybrid retrieval Worker was disposed.');

    backend.dispose();

    expect(worker.terminated).toBe(true);
    await firstAssertion;
    await secondAssertion;
    await expect(backend.execute(queryRequest('后续请求'))).rejects.toThrow(
      'Hybrid retrieval Worker is disposed.',
    );

    // The listener has been removed, so an old response cannot settle another request.
    expect(() => worker.respond(1, queryResponse('迟到结果。'))).not.toThrow();
  });

  it('worker queue prioritizes the latest query over pending mutations', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const responses: Array<{
      requestId: number;
      response?: HybridRetrievalResponse;
      error?: string;
    }> = [];
    const scope = {
      onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
      postMessage(message: (typeof responses)[number]) {
        responses.push(message);
      },
    };
    vi.stubGlobal('self', scope);
    await import('../hybrid-retrieval.worker');

    const send = (data: unknown) => scope.onmessage?.(new MessageEvent('message', { data }));
    send({ requestId: 1, request: replaceRequest('/a.md') });
    send({ requestId: 2, request: replaceRequest('/b.md') });
    send({ requestId: 3, request: queryRequest('旧上下文') });
    send({ requestId: 4, request: queryRequest('项目计划') });
    await vi.runAllTimersAsync();

    expect(responses.find(({ requestId }) => requestId === 3)?.error).toContain('superseded');
    expect(
      responses
        .filter(({ response }) => response?.operation === 'replace')
        .map(({ requestId }) => requestId),
    ).toEqual([1, 2]);
    expect(responses.find(({ requestId }) => requestId === 4)?.response).toMatchObject({
      operation: 'query',
      candidates: [],
      committedRevision: 0,
      pendingMutations: 2,
      warming: true,
    });
    expect(
      responses
        .filter(({ response }) => response?.operation === 'replace')
        .map(({ response }) => response?.operation === 'replace' && response.revision),
    ).toEqual([1, 2]);
  });

  it('publishes a multi-document batch under one revision without partial query visibility', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const responses: Array<{
      requestId: number;
      response?: HybridRetrievalResponse;
      error?: string;
    }> = [];
    const scope = {
      onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
      postMessage(message: (typeof responses)[number]) {
        responses.push(message);
      },
    };
    vi.stubGlobal('self', scope);
    await import('../hybrid-retrieval.worker');
    const send = (data: unknown) => scope.onmessage?.(new MessageEvent('message', { data }));
    const mutations = ['/a.md', '/b.md'].map((path) => ({
      operation: 'replace' as const,
      workspaceScope: 'workspace-a',
      path,
      content: 'Project plan needs careful review.',
    }));
    const englishQuery: HybridRetrievalQueryRequest = {
      operation: 'query',
      workspaceScope: 'workspace-a',
      contextBeforeCursor: 'Project plan',
      languageHint: 'en',
      maxCandidates: 8,
    };

    send({
      requestId: 1,
      request: { operation: 'batch', workspaceScope: 'workspace-a', mutations },
    });
    send({ requestId: 2, request: englishQuery });
    await vi.runAllTimersAsync();

    expect(responses.find(({ requestId }) => requestId === 2)?.response).toMatchObject({
      operation: 'query',
      candidates: [],
      committedRevision: 0,
      pendingMutations: 2,
      warming: true,
    });
    expect(responses.find(({ requestId }) => requestId === 1)?.response).toMatchObject({
      operation: 'batch',
      revision: 1,
      documentCount: 2,
    });

    send({ requestId: 3, request: englishQuery });
    await vi.runAllTimersAsync();
    expect(responses.find(({ requestId }) => requestId === 3)?.response).toMatchObject({
      operation: 'query',
      committedRevision: 1,
      pendingMutations: 0,
      candidates: [expect.objectContaining({ providerId: 'hybrid-retrieval-en' })],
    });
  });
});
