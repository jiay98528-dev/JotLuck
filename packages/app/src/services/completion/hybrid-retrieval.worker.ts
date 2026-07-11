import { HybridRetrievalIndex } from './hybrid-retrieval-core';
import type { HybridRetrievalRequest, HybridRetrievalResponse } from './hybrid-retrieval-types';

interface WorkerExecuteEnvelope {
  requestId: number;
  request: HybridRetrievalRequest;
}

interface WorkerCancelEnvelope {
  requestId: number;
  cancel: true;
}

type WorkerRequestEnvelope = WorkerExecuteEnvelope | WorkerCancelEnvelope;

interface WorkerResponseEnvelope {
  requestId: number;
  response?: HybridRetrievalResponse;
  error?: string;
}

const index = new HybridRetrievalIndex();
const queue: WorkerExecuteEnvelope[] = [];
const revisions = new Map<string, number>();
let drainTimer: ReturnType<typeof setTimeout> | null = null;
const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequestEnvelope>) => void) | null;
  postMessage(message: WorkerResponseEnvelope): void;
};

workerScope.onmessage = (event) => {
  const envelope = event.data;
  if ('cancel' in envelope) {
    cancelQueuedRequest(envelope.requestId);
    return;
  }

  if (envelope.request.operation === 'query') {
    for (let index = queue.length - 1; index >= 0; index--) {
      const queued = queue[index];
      if (queued?.request.operation !== 'query') continue;
      queue.splice(index, 1);
      workerScope.postMessage({
        requestId: queued.requestId,
        error: 'Hybrid retrieval query was superseded.',
      });
    }
  }
  queue.push(envelope);
  scheduleDrain();
};

function cancelQueuedRequest(requestId: number): void {
  const index = queue.findIndex((envelope) => envelope.requestId === requestId);
  if (index >= 0) queue.splice(index, 1);
}

function scheduleDrain(): void {
  if (drainTimer !== null) return;
  drainTimer = setTimeout(drainOne, 0);
}

function drainOne(): void {
  drainTimer = null;
  const queryIndex = queue.findIndex(({ request }) => request.operation === 'query');
  const envelope = queryIndex >= 0 ? queue.splice(queryIndex, 1)[0] : queue.shift();
  if (!envelope) return;
  const { requestId, request } = envelope;
  try {
    const raw = index.execute(request);
    const currentRevision = revisions.get(request.workspaceScope) ?? 0;
    if (request.operation === 'query' && raw.operation === 'query') {
      const pendingMutations = queue
        .filter(
          ({ request: queued }) =>
            queued.operation !== 'query' && queued.workspaceScope === request.workspaceScope,
        )
        .reduce((total, { request: queued }) => total + mutationDocumentCount(queued), 0);
      workerScope.postMessage({
        requestId,
        response: {
          ...raw,
          committedRevision: currentRevision,
          pendingMutations,
          warming: pendingMutations > 0,
        },
      });
    } else if (request.operation !== 'query' && raw.operation !== 'query') {
      const revision = currentRevision + 1;
      revisions.set(request.workspaceScope, revision);
      workerScope.postMessage({ requestId, response: { ...raw, revision } });
    }
  } catch (error) {
    workerScope.postMessage({
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  if (queue.length > 0) scheduleDrain();
}

function mutationDocumentCount(request: HybridRetrievalRequest): number {
  if (request.operation === 'query') return 0;
  return request.operation === 'batch' ? request.mutations.length : 1;
}
