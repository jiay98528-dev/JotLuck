import { invoke } from '@tauri-apps/api/core';
import { isDesktopRuntime } from '@/utils/runtime';
import { HybridRetrievalIndex } from './hybrid-retrieval-core';
import type {
  HybridRetrievalBackendKind,
  HybridRetrievalBudget,
  HybridRetrievalCandidate,
  HybridRetrievalDocumentMutationRequest,
  HybridRetrievalDiagnostics,
  HybridRetrievalHealthDiagnostics,
  HybridRetrievalLanguageHint,
  HybridRetrievalQueryRequest,
  HybridRetrievalRequest,
  HybridRetrievalResponse,
} from './hybrid-retrieval-types';

export interface HybridRetrievalBackend {
  readonly kind?: HybridRetrievalBackendKind;
  execute(request: HybridRetrievalRequest, signal?: AbortSignal): Promise<HybridRetrievalResponse>;
  setWorkspaceScope?(workspaceScope: string): Promise<void>;
  readHealthDiagnostics?(workspaceScope: string): Promise<unknown>;
  dispose(): void | Promise<void>;
}

export interface HybridRetrievalServiceOptions {
  backend?: HybridRetrievalBackend;
  backendFactory?: () => HybridRetrievalBackend;
  replayDocuments?: (
    workspaceScope: string,
    signal: AbortSignal,
  ) =>
    | Iterable<{ path: string; content: string }>
    | Promise<Iterable<{ path: string; content: string }>>;
}

interface WorkerRequestEnvelope {
  requestId: number;
  request: HybridRetrievalRequest;
}

interface WorkerCancelEnvelope {
  requestId: number;
  cancel: true;
}

interface WorkerResponseEnvelope {
  requestId: number;
  response?: HybridRetrievalResponse;
  error?: string;
}

interface PendingWorkerRequest {
  operation: HybridRetrievalRequest['operation'];
  resolve: (response: HybridRetrievalResponse) => void;
  reject: (error: Error) => void;
  removeAbortListener: () => void;
}

export const HYBRID_MUTATION_BATCH_MAX_OPERATIONS = 8;
export const HYBRID_MUTATION_BATCH_MAX_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_MUTATIONS_PER_BATCH = HYBRID_MUTATION_BATCH_MAX_OPERATIONS;
const MAX_MUTATION_BATCH_INPUT_BYTES = HYBRID_MUTATION_BATCH_MAX_INPUT_BYTES;

class BackendUnavailableError extends Error {
  constructor() {
    super('Hybrid retrieval backend is unavailable.');
    this.name = 'BackendUnavailableError';
  }
}

export class LocalHybridRetrievalBackend implements HybridRetrievalBackend {
  readonly kind = 'local-test' as const;
  private readonly index: HybridRetrievalIndex;
  private revision = 0;
  private disposed = false;

  constructor(budget: Partial<HybridRetrievalBudget> = {}) {
    this.index = new HybridRetrievalIndex(budget);
  }

  async execute(
    request: HybridRetrievalRequest,
    signal?: AbortSignal,
  ): Promise<HybridRetrievalResponse> {
    throwIfAborted(signal);
    if (this.disposed) throw new Error('Hybrid retrieval backend is disposed.');
    const raw = this.index.execute(request);
    const response = attachSnapshotMetadata(raw, request, {
      revision: request.operation === 'query' ? this.revision : ++this.revision,
      pendingMutations: 0,
    });
    throwIfAborted(signal);
    return response;
  }

  getIndexDiagnostics(workspaceScope: string): HybridRetrievalDiagnostics {
    return this.index.getDiagnostics(workspaceScope);
  }

  dispose(): void {
    this.disposed = true;
  }
}

export class DisabledHybridRetrievalBackend implements HybridRetrievalBackend {
  readonly kind = 'disabled' as const;

  execute(request: HybridRetrievalRequest): Promise<HybridRetrievalResponse> {
    if (request.operation === 'query') {
      return Promise.resolve({
        operation: 'query',
        candidates: [],
        committedRevision: 0,
        pendingMutations: 0,
        warming: false,
      });
    }
    return Promise.resolve({
      operation: request.operation,
      changed: false,
      documentCount: 0,
      revision: 0,
    });
  }

  dispose(): void {}
}

export class WorkerHybridRetrievalBackend implements HybridRetrievalBackend {
  readonly kind = 'worker' as const;
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingWorkerRequest>();
  private requestSequence = 0;
  private disposed = false;

  constructor(worker?: Worker) {
    this.worker =
      worker ??
      new Worker(new URL('./hybrid-retrieval.worker.ts', import.meta.url), {
        type: 'module',
        name: 'jotluck-completion-v2',
      });
    this.worker.addEventListener('message', this.onMessage);
    this.worker.addEventListener('error', this.onError);
  }

  execute(request: HybridRetrievalRequest, signal?: AbortSignal): Promise<HybridRetrievalResponse> {
    throwIfAborted(signal);
    if (this.disposed) return Promise.reject(new Error('Hybrid retrieval Worker is disposed.'));
    if (request.operation === 'query') this.cancelPendingQueries();
    const requestId = ++this.requestSequence;
    return new Promise<HybridRetrievalResponse>((resolve, reject) => {
      const onAbort = () => {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        this.pending.delete(requestId);
        pending.removeAbortListener();
        if (pending.operation === 'query') this.postCancel(requestId);
        reject(abortError(signal));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(requestId, {
        operation: request.operation,
        resolve,
        reject,
        removeAbortListener: () => signal?.removeEventListener('abort', onAbort),
      });
      const envelope: WorkerRequestEnvelope = { requestId, request };
      try {
        this.worker.postMessage(envelope);
      } catch (error) {
        const pending = this.pending.get(requestId);
        this.pending.delete(requestId);
        pending?.removeAbortListener();
        reject(toError(error, 'Hybrid retrieval Worker postMessage failed.'));
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.removeEventListener('message', this.onMessage);
    this.worker.removeEventListener('error', this.onError);
    this.worker.terminate();
    this.rejectAll(new Error('Hybrid retrieval Worker was disposed.'));
  }

  private readonly onMessage = (event: MessageEvent<WorkerResponseEnvelope>) => {
    const envelope = event.data;
    const pending = this.pending.get(envelope.requestId);
    if (!pending) return;
    this.pending.delete(envelope.requestId);
    pending.removeAbortListener();
    if (envelope.error || !envelope.response) {
      pending.reject(new Error(envelope.error || 'Worker returned an empty response.'));
      return;
    }
    pending.resolve(envelope.response);
  };

  private readonly onError = (event: ErrorEvent) => {
    this.rejectAll(new Error(event.message || 'Hybrid retrieval Worker failed.'));
  };

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.removeAbortListener();
      pending.reject(error);
    }
    this.pending.clear();
  }

  private cancelPendingQueries(): void {
    const error = namedAbortError('Hybrid retrieval query was superseded.');
    for (const [requestId, pending] of this.pending) {
      if (pending.operation !== 'query') continue;
      this.pending.delete(requestId);
      pending.removeAbortListener();
      this.postCancel(requestId);
      pending.reject(error);
    }
  }

  private postCancel(requestId: number): void {
    if (this.disposed) return;
    const envelope: WorkerCancelEnvelope = { requestId, cancel: true };
    try {
      this.worker.postMessage(envelope);
    } catch {
      // Cancellation is best-effort. The pending request is already detached,
      // so a late response cannot affect the current query.
    }
  }
}

export class TauriHybridRetrievalBackend implements HybridRetrievalBackend {
  readonly kind = 'tauri' as const;
  private disposed = false;

  async setWorkspaceScope(workspaceScope: string): Promise<void> {
    if (this.disposed) throw new Error('Hybrid retrieval Tauri backend is disposed.');
    await invoke('completion_v2_set_scope', { request: { workspaceScope } });
  }

  async execute(
    request: HybridRetrievalRequest,
    signal?: AbortSignal,
  ): Promise<HybridRetrievalResponse> {
    throwIfAborted(signal);
    if (this.disposed) throw new Error('Hybrid retrieval Tauri backend is disposed.');

    let response: HybridRetrievalResponse;
    switch (request.operation) {
      case 'replace':
        response = await invoke('completion_v2_replace_document', {
          request: {
            workspaceScope: request.workspaceScope,
            path: request.path,
            content: request.content,
          },
        });
        break;
      case 'remove':
        response = await invoke('completion_v2_remove_document', {
          request: { workspaceScope: request.workspaceScope, path: request.path },
        });
        break;
      case 'rename':
        response = await invoke('completion_v2_rename_document', {
          request: {
            workspaceScope: request.workspaceScope,
            oldPath: request.oldPath,
            newPath: request.newPath,
          },
        });
        break;
      case 'clear':
        response = await invoke('completion_v2_clear', {
          request: { workspaceScope: request.workspaceScope },
        });
        break;
      case 'batch':
        response = await invoke('completion_v2_apply_batch', {
          request: {
            workspaceScope: request.workspaceScope,
            mutations: request.mutations.map(toTauriBatchMutation),
          },
        });
        break;
      case 'query': {
        response = await invoke<HybridRetrievalResponse>('completion_v2_query', {
          request: {
            workspaceScope: request.workspaceScope,
            contextBeforeCursor: request.contextBeforeCursor,
            languageHint: request.languageHint,
            maxCandidates: request.maxCandidates,
          },
        });
        break;
      }
    }
    throwIfAborted(signal);
    return response;
  }

  async readHealthDiagnostics(workspaceScope: string): Promise<unknown> {
    if (this.disposed) throw new Error('Hybrid retrieval Tauri backend is disposed.');
    return invoke('completion_v2_diagnostics', { workspaceScope });
  }

  dispose(): void {
    this.disposed = true;
  }
}

/**
 * Serializes document mutations and gives query calls a consistent index
 * snapshot. Backend failures disable only phrase retrieval; Provider/Resolver
 * completions remain available as the deterministic free fallback.
 */
export class HybridRetrievalService {
  private backend: HybridRetrievalBackend;
  private readonly backendFactory?: () => HybridRetrievalBackend;
  private replayDocuments?: HybridRetrievalServiceOptions['replayDocuments'];
  private readonly lifecycleController = new AbortController();
  private mutationChain: Promise<void> = Promise.resolve();
  private mutationBuffer: Array<{
    request: HybridRetrievalDocumentMutationRequest;
    epoch: number;
  }> = [];
  private mutationFlushScheduled = false;
  private workspaceScope = 'unscoped';
  private epoch = 0;
  private globallyUnavailable = false;
  private readonly disabledScopes = new Set<string>();
  private readonly statusByScope = new Map<
    string,
    Exclude<HybridRetrievalHealthDiagnostics['status'], 'disabled'>
  >();
  private disposed = false;
  private disposing = false;
  private pendingMutations = 0;
  private pendingMutationBatches = 0;
  private pendingScopeChanges = 0;
  private nativePendingMutations = 0;
  private nativePendingMutationBatches = 0;
  private nativeWarming = false;
  private committedRevision = 0;
  private readonly rebuildCountByScope = new Map<string, number>();
  private lastBuildDurationMs = 0;
  private totalBuildDurationMs = 0;
  private inputBytes = 0;
  private estimatedIndexBytes = 0;
  private longTasksOver50Ms = 0;
  private recoveryPromise: Promise<void> | null = null;
  private recovery:
    | {
        scope: string;
        epoch: number;
        controller: AbortController;
      }
    | undefined;
  private readonly indexedBytesByPath = new Map<string, number>();

  constructor(options: HybridRetrievalServiceOptions = {}) {
    this.backendFactory =
      options.backendFactory ?? (options.backend ? undefined : createDefaultHybridRetrievalBackend);
    this.replayDocuments = options.replayDocuments;
    this.backend =
      options.backend ?? this.backendFactory?.() ?? new DisabledHybridRetrievalBackend();
    this.globallyUnavailable = detectBackendKind(this.backend) === 'disabled';
    this.statusByScope.set(this.workspaceScope, 'ready');
    if (this.backend.setWorkspaceScope) this.enqueueScopeChange(this.workspaceScope);
  }

  getEpoch(): number {
    return this.epoch;
  }

  getWorkspaceScope(): string {
    return this.workspaceScope;
  }

  setReplayDocumentsProvider(
    provider: NonNullable<HybridRetrievalServiceOptions['replayDocuments']>,
  ): void {
    if (this.disposed) return;
    this.replayDocuments = provider;
  }

  getHealthDiagnostics(): HybridRetrievalHealthDiagnostics {
    const status = this.getScopeStatus(this.workspaceScope);
    const pendingMutations = Math.max(this.pendingMutations, this.nativePendingMutations);
    const pendingMutationBatches = Math.max(
      this.pendingMutationBatches,
      this.nativePendingMutationBatches,
    );
    return {
      backendKind: detectBackendKind(this.backend),
      workspaceScope: this.workspaceScope,
      status:
        status === 'ready' &&
        (pendingMutations > 0 ||
          this.pendingScopeChanges > 0 ||
          this.nativeWarming ||
          this.recovery?.scope === this.workspaceScope)
          ? 'warming'
          : status,
      committedRevision: this.committedRevision,
      pendingMutations,
      pendingMutationBatches,
      rebuildCount: this.rebuildCountByScope.get(this.workspaceScope) ?? 0,
      lastBuildDurationMs: this.lastBuildDurationMs,
      totalBuildDurationMs: this.totalBuildDurationMs,
      inputBytes: this.inputBytes,
      estimatedIndexBytes: this.estimatedIndexBytes,
      longTasksOver50Ms: this.longTasksOver50Ms,
    };
  }

  async refreshHealthDiagnostics(): Promise<HybridRetrievalHealthDiagnostics> {
    if (!this.backend.readHealthDiagnostics || this.disposed || this.globallyUnavailable) {
      return this.getHealthDiagnostics();
    }
    const scope = this.workspaceScope;
    let diagnostics: unknown;
    try {
      diagnostics = await this.backend.readHealthDiagnostics(scope);
    } catch {
      return this.getHealthDiagnostics();
    }
    const parsed = parseNativeHealthDiagnostics(diagnostics);
    if (scope !== this.workspaceScope || !parsed) return this.getHealthDiagnostics();
    this.committedRevision = parsed.committedRevision;
    this.nativePendingMutations = parsed.pendingMutations;
    this.nativePendingMutationBatches = parsed.pendingMutationBatches;
    this.nativeWarming = parsed.pendingMutations > 0 || parsed.pendingMutationBatches > 0;
    this.lastBuildDurationMs = parsed.lastBuildDurationMs;
    this.totalBuildDurationMs = parsed.totalBuildDurationMs;
    this.inputBytes = parsed.inputBytes;
    this.estimatedIndexBytes = parsed.estimatedIndexBytes;
    this.longTasksOver50Ms = parsed.longTasksOver50Ms;
    return this.getHealthDiagnostics();
  }

  setWorkspaceScope(scope: string): void {
    const normalized = normalizeScope(scope);
    if (normalized === this.workspaceScope) return;
    this.flushMutationBuffer();
    const previous = this.workspaceScope;
    this.cancelObsoleteRecovery(normalized);
    this.workspaceScope = normalized;
    this.epoch += 1;
    this.committedRevision = 0;
    this.nativePendingMutations = 0;
    this.nativePendingMutationBatches = 0;
    this.nativeWarming = false;
    this.indexedBytesByPath.clear();
    this.inputBytes = 0;
    this.estimatedIndexBytes = 0;
    if (!this.statusByScope.has(normalized)) this.statusByScope.set(normalized, 'ready');
    if (this.backend.setWorkspaceScope) {
      this.enqueueScopeChange(normalized, this.epoch);
    } else {
      this.enqueueMutation({ operation: 'clear', workspaceScope: previous });
    }
  }

  replaceDocument(path: string, content: string): void {
    this.enqueueMutation({
      operation: 'replace',
      workspaceScope: this.workspaceScope,
      path,
      content,
    });
  }

  removeDocument(path: string): void {
    this.enqueueMutation({
      operation: 'remove',
      workspaceScope: this.workspaceScope,
      path,
    });
  }

  renameDocument(oldPath: string, newPath: string): void {
    this.enqueueMutation({
      operation: 'rename',
      workspaceScope: this.workspaceScope,
      oldPath,
      newPath,
    });
  }

  clearWorkspace(): void {
    this.epoch += 1;
    this.indexedBytesByPath.clear();
    this.inputBytes = 0;
    this.estimatedIndexBytes = 0;
    this.enqueueMutation({ operation: 'clear', workspaceScope: this.workspaceScope });
  }

  async flushMutations(): Promise<void> {
    this.flushMutationBuffer();
    await this.mutationChain;
  }

  async query(
    contextBeforeCursor: string,
    languageHint: HybridRetrievalLanguageHint,
    maxCandidates = 8,
    signal?: AbortSignal,
  ): Promise<HybridRetrievalCandidate[]> {
    if (
      this.disposed ||
      this.disposing ||
      this.globallyUnavailable ||
      this.disabledScopes.has(this.workspaceScope) ||
      this.getScopeStatus(this.workspaceScope) === 'degraded' ||
      this.recovery?.scope === this.workspaceScope ||
      this.pendingScopeChanges > 0 ||
      signal?.aborted
    ) {
      return [];
    }
    const queryEpoch = this.epoch;
    const scope = this.workspaceScope;
    const linkedSignal = linkAbortSignals(signal, this.lifecycleController.signal);
    try {
      if (
        linkedSignal.signal.aborted ||
        queryEpoch !== this.epoch ||
        scope !== this.workspaceScope ||
        this.globallyUnavailable ||
        this.disabledScopes.has(scope)
      ) {
        return [];
      }
      const request: HybridRetrievalQueryRequest = {
        operation: 'query',
        workspaceScope: scope,
        contextBeforeCursor: takeLastCodePoints(contextBeforeCursor, 512),
        languageHint,
        maxCandidates: Math.max(0, Math.min(8, Math.floor(maxCandidates))),
      };
      const response = await waitForPromise(
        this.backend.execute(request, linkedSignal.signal),
        linkedSignal.signal,
      );
      if (
        response.operation !== 'query' ||
        linkedSignal.signal.aborted ||
        queryEpoch !== this.epoch ||
        scope !== this.workspaceScope
      ) {
        return [];
      }
      const candidates = validateQueryCandidates(response, languageHint);
      if (!candidates) throw new Error('Hybrid retrieval backend returned invalid candidates.');
      this.committedRevision = response.committedRevision!;
      return candidates;
    } catch (error) {
      if (
        !isAbortError(error) &&
        !linkedSignal.signal.aborted &&
        queryEpoch === this.epoch &&
        scope === this.workspaceScope
      ) {
        this.handleBackendFailure(scope, queryEpoch);
      }
      return [];
    } finally {
      linkedSignal.dispose();
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed || this.disposing) return;
    this.disposing = true;
    this.flushMutationBuffer();
    // Scope switches and teardown are durability boundaries. Give real
    // Worker/Tauri commits time to settle, but retain a hard ceiling for a
    // broken backend that never resolves.
    await Promise.race([
      this.mutationChain.catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 250)),
    ]);
    this.disposed = true;
    this.globallyUnavailable = true;
    this.recovery?.controller.abort('Hybrid retrieval service was disposed.');
    this.epoch += 1;
    this.lifecycleController.abort('Hybrid retrieval service was disposed.');
    this.mutationBuffer = [];
    this.mutationChain = Promise.resolve();
    try {
      const disposal = this.backend.dispose();
      await Promise.race([
        Promise.resolve(disposal).catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 250)),
      ]);
    } catch {
      // Disposal of an optional backend is deliberately non-observable.
    }
    this.disposing = false;
  }

  private enqueueMutation(request: HybridRetrievalDocumentMutationRequest): void {
    if (
      this.disposed ||
      this.globallyUnavailable ||
      this.disabledScopes.has(request.workspaceScope)
    ) {
      return;
    }
    this.pendingMutations += 1;
    this.mutationBuffer.push({ request, epoch: this.epoch });
    if (this.mutationBuffer.length >= MAX_MUTATIONS_PER_BATCH) {
      this.flushMutationBuffer();
      return;
    }
    if (this.mutationFlushScheduled) return;
    this.mutationFlushScheduled = true;
    queueMicrotask(() => this.flushMutationBuffer());
  }

  private flushMutationBuffer(): void {
    this.mutationFlushScheduled = false;
    while (this.mutationBuffer.length > 0) {
      const first = this.mutationBuffer[0]!;
      const items: typeof this.mutationBuffer = [];
      let batchBytes = 0;
      for (const item of this.mutationBuffer) {
        if (
          item.request.workspaceScope !== first.request.workspaceScope ||
          item.epoch !== first.epoch ||
          items.length >= MAX_MUTATIONS_PER_BATCH
        ) {
          break;
        }
        const itemBytes = estimateMutationInputBytes(item.request);
        if (items.length > 0 && batchBytes + itemBytes > MAX_MUTATION_BATCH_INPUT_BYTES) break;
        items.push(item);
        batchBytes += itemBytes;
      }
      this.mutationBuffer.splice(0, items.length);
      this.enqueueMutationBatch(
        first.request.workspaceScope,
        first.epoch,
        items.map((item) => item.request),
      );
    }
  }

  private enqueueMutationBatch(
    scope: string,
    batchEpoch: number,
    mutations: HybridRetrievalDocumentMutationRequest[],
  ): void {
    this.pendingMutationBatches += 1;
    this.mutationChain = this.mutationChain
      .then(async () => {
        if (this.recoveryPromise) await this.recoveryPromise;
        if (this.disposed || this.globallyUnavailable || this.disabledScopes.has(scope)) return;
        const startedAt = performanceNow();
        const response = await this.backend.execute({
          operation: 'batch',
          workspaceScope: scope,
          mutations,
        });
        if (response.operation !== 'batch' || !isValidMutationResponse(response)) {
          throw new Error('Hybrid retrieval batch response was malformed.');
        }
        if (scope === this.workspaceScope && batchEpoch === this.epoch) {
          this.committedRevision = response.revision;
          this.recordMutationDiagnostics(mutations, response.changed, performanceNow() - startedAt);
        }
      })
      .catch(() => {
        if (!this.disposed) this.handleBackendFailure(scope, batchEpoch);
      })
      .finally(() => {
        this.pendingMutationBatches = Math.max(0, this.pendingMutationBatches - 1);
        this.pendingMutations = Math.max(0, this.pendingMutations - mutations.length);
      });
  }

  private recordMutationDiagnostics(
    mutations: readonly HybridRetrievalDocumentMutationRequest[],
    changed: boolean,
    durationMs: number,
  ): void {
    const duration = Math.max(0, durationMs);
    this.lastBuildDurationMs = duration;
    this.totalBuildDurationMs += duration;
    if (duration > 50) this.longTasksOver50Ms += 1;
    if (!changed) return;
    for (const request of mutations) {
      switch (request.operation) {
        case 'replace':
          this.indexedBytesByPath.set(
            request.path,
            new TextEncoder().encode(request.content).byteLength,
          );
          break;
        case 'remove':
          this.indexedBytesByPath.delete(request.path);
          break;
        case 'rename': {
          const bytes = this.indexedBytesByPath.get(request.oldPath);
          this.indexedBytesByPath.delete(request.oldPath);
          if (bytes !== undefined) this.indexedBytesByPath.set(request.newPath, bytes);
          break;
        }
        case 'clear':
          this.indexedBytesByPath.clear();
          break;
      }
    }
    this.updateIndexSizeDiagnostics();
  }

  private enqueueScopeChange(scope: string, scopeEpoch = this.epoch): void {
    if (this.disposed || this.globallyUnavailable || !this.backend.setWorkspaceScope) return;
    this.pendingScopeChanges += 1;
    this.mutationChain = this.mutationChain
      .then(async () => {
        if (this.recoveryPromise) await this.recoveryPromise;
        if (this.disposed || this.globallyUnavailable || this.disabledScopes.has(scope)) return;
        await this.backend.setWorkspaceScope?.(scope);
      })
      .catch(() => {
        if (!this.disposed) this.handleBackendFailure(scope, scopeEpoch);
      })
      .finally(() => {
        this.pendingScopeChanges = Math.max(0, this.pendingScopeChanges - 1);
      });
  }

  private handleBackendFailure(scope: string, failureEpoch: number): void {
    if (
      this.disposed ||
      this.globallyUnavailable ||
      scope !== this.workspaceScope ||
      failureEpoch !== this.epoch ||
      this.disabledScopes.has(scope) ||
      this.recoveryPromise
    ) {
      return;
    }
    const rebuildCount = this.rebuildCountByScope.get(scope) ?? 0;
    if (rebuildCount >= 1 || !this.backendFactory || !this.replayDocuments) {
      this.disableScope(scope);
      return;
    }

    this.rebuildCountByScope.set(scope, rebuildCount + 1);
    this.statusByScope.set(scope, 'degraded');
    const failedBackend = this.backend;
    const controller = new AbortController();
    this.recovery = { scope, epoch: failureEpoch, controller };
    const recoveryPromise = this.rebuildBackend(scope, failureEpoch, controller.signal)
      .catch((error: unknown) => {
        if (isAbortError(error) || scope !== this.workspaceScope || failureEpoch !== this.epoch) {
          return;
        }
        if (error instanceof BackendUnavailableError) {
          this.disableGlobally();
          return;
        }
        this.disableScope(scope);
      })
      .finally(() => {
        if (this.recovery?.controller === controller) this.recovery = undefined;
        if (this.recoveryPromise === recoveryPromise) this.recoveryPromise = null;
        if (this.backend !== failedBackend) {
          void Promise.resolve(failedBackend.dispose()).catch(() => undefined);
        }
      });
    this.recoveryPromise = recoveryPromise;
  }

  private async rebuildBackend(
    rebuildScope: string,
    rebuildEpoch: number,
    signal: AbortSignal,
  ): Promise<void> {
    const startedAt = performanceNow();
    const replacement = this.backendFactory!();
    if (detectBackendKind(replacement) === 'disabled') {
      throw new BackendUnavailableError();
    }
    this.statusByScope.set(rebuildScope, 'warming');
    try {
      throwIfAborted(signal);
      await replacement.setWorkspaceScope?.(rebuildScope);
      throwIfAborted(signal);
      const documents = await this.replayDocuments!(rebuildScope, signal);
      throwIfAborted(signal);

      const indexedBytes = new Map<string, number>();
      const mutations: HybridRetrievalDocumentMutationRequest[] = [];
      for (const document of documents) {
        this.assertCurrentRecovery(rebuildScope, rebuildEpoch, signal);
        indexedBytes.set(document.path, new TextEncoder().encode(document.content).byteLength);
        mutations.push({
          operation: 'replace',
          workspaceScope: rebuildScope,
          path: document.path,
          content: document.content,
        });
      }

      let revision = 0;
      for (const batch of partitionMutationRequests(mutations)) {
        this.assertCurrentRecovery(rebuildScope, rebuildEpoch, signal);
        const response = await replacement.execute(
          { operation: 'batch', workspaceScope: rebuildScope, mutations: batch },
          signal,
        );
        if (response.operation !== 'batch' || !isValidMutationResponse(response)) {
          throw new Error('Hybrid retrieval rebuild returned an invalid batch response.');
        }
        revision = response.revision;
      }

      this.assertCurrentRecovery(rebuildScope, rebuildEpoch, signal);
      const duration = Math.max(0, performanceNow() - startedAt);
      this.lastBuildDurationMs = duration;
      this.totalBuildDurationMs += duration;
      if (duration > 50) this.longTasksOver50Ms += 1;
      this.backend = replacement;
      this.committedRevision = revision;
      this.indexedBytesByPath.clear();
      for (const [path, bytes] of indexedBytes) this.indexedBytesByPath.set(path, bytes);
      this.updateIndexSizeDiagnostics();
      this.statusByScope.set(rebuildScope, 'ready');
    } catch (error) {
      void Promise.resolve(replacement.dispose()).catch(() => undefined);
      throw error;
    }
  }

  private assertCurrentRecovery(scope: string, expectedEpoch: number, signal: AbortSignal): void {
    throwIfAborted(signal);
    if (this.disposed || this.workspaceScope !== scope || this.epoch !== expectedEpoch) {
      throw namedAbortError('Hybrid retrieval rebuild became obsolete.');
    }
  }

  private cancelObsoleteRecovery(nextScope: string): void {
    const recovery = this.recovery;
    if (!recovery || recovery.scope === nextScope) return;
    recovery.controller.abort('Hybrid retrieval scope changed.');
    this.statusByScope.set(recovery.scope, 'ready');
    const attempts = this.rebuildCountByScope.get(recovery.scope) ?? 0;
    if (attempts <= 1) this.rebuildCountByScope.delete(recovery.scope);
    else this.rebuildCountByScope.set(recovery.scope, attempts - 1);
    if (!this.backendFactory) return;
    const replacement = this.backendFactory();
    if (detectBackendKind(replacement) === 'disabled') {
      this.disableGlobally();
      return;
    }
    this.backend = replacement;
  }

  private updateIndexSizeDiagnostics(): void {
    this.inputBytes = [...this.indexedBytesByPath.values()].reduce(
      (total, bytes) => total + bytes,
      0,
    );
    // The core does not expose JS heap size. This stable estimate accounts for
    // retained strings plus aggregate-map overhead without pretending that raw
    // input bytes are the index's memory footprint.
    this.estimatedIndexBytes = Math.ceil(
      this.inputBytes * 1.75 + this.indexedBytesByPath.size * 128,
    );
  }

  private getScopeStatus(scope: string): HybridRetrievalHealthDiagnostics['status'] {
    if (this.globallyUnavailable || this.disabledScopes.has(scope)) return 'disabled';
    return this.statusByScope.get(scope) ?? 'ready';
  }

  private disableScope(scope: string): void {
    this.disabledScopes.add(scope);
    if (scope === this.workspaceScope) this.statusByScope.set(scope, 'degraded');
  }

  private disableGlobally(): void {
    if (this.globallyUnavailable) return;
    this.globallyUnavailable = true;
    try {
      void Promise.resolve(this.backend.dispose()).catch(() => undefined);
    } catch {
      // The deterministic providers remain available even if teardown fails.
    }
  }
}

export function createDefaultHybridRetrievalBackend(): HybridRetrievalBackend {
  if (isDesktopRuntime()) return new TauriHybridRetrievalBackend();
  if (typeof Worker === 'function') {
    try {
      return new WorkerHybridRetrievalBackend();
    } catch {
      // CSP, SecurityError, or a missing module Worker disables only Hybrid
      // Retrieval. Synchronous main-thread indexing is intentionally forbidden.
    }
  }
  return new DisabledHybridRetrievalBackend();
}

function partitionMutationRequests(
  mutations: readonly HybridRetrievalDocumentMutationRequest[],
): HybridRetrievalDocumentMutationRequest[][] {
  const batches: HybridRetrievalDocumentMutationRequest[][] = [];
  let current: HybridRetrievalDocumentMutationRequest[] = [];
  let currentBytes = 0;
  for (const mutation of mutations) {
    const mutationBytes = estimateMutationInputBytes(mutation);
    if (
      current.length > 0 &&
      (current.length >= MAX_MUTATIONS_PER_BATCH ||
        currentBytes + mutationBytes > MAX_MUTATION_BATCH_INPUT_BYTES)
    ) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(mutation);
    currentBytes += mutationBytes;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function toTauriBatchMutation(request: HybridRetrievalDocumentMutationRequest): object {
  switch (request.operation) {
    case 'replace':
      return {
        operation: 'replace',
        path: request.path,
        content: request.content,
      };
    case 'remove':
      return { operation: 'remove', path: request.path };
    case 'rename':
      return {
        operation: 'rename',
        oldPath: request.oldPath,
        newPath: request.newPath,
      };
    case 'clear':
      return { operation: 'clear' };
  }
}

function estimateMutationInputBytes(request: HybridRetrievalDocumentMutationRequest): number {
  const encoder = new TextEncoder();
  switch (request.operation) {
    case 'replace':
      return encoder.encode(request.path).byteLength + encoder.encode(request.content).byteLength;
    case 'remove':
      return encoder.encode(request.path).byteLength;
    case 'rename':
      return (
        encoder.encode(request.oldPath).byteLength + encoder.encode(request.newPath).byteLength
      );
    case 'clear':
      return 0;
  }
}

type NativeHealthSnapshot = Pick<
  HybridRetrievalHealthDiagnostics,
  | 'committedRevision'
  | 'pendingMutations'
  | 'pendingMutationBatches'
  | 'lastBuildDurationMs'
  | 'totalBuildDurationMs'
  | 'inputBytes'
  | 'estimatedIndexBytes'
  | 'longTasksOver50Ms'
>;

function parseNativeHealthDiagnostics(value: unknown): NativeHealthSnapshot | null {
  if (!isRecord(value)) return null;
  const keys = [
    'committedRevision',
    'pendingMutations',
    'pendingMutationBatches',
    'lastBuildDurationMs',
    'totalBuildDurationMs',
    'inputBytes',
    'estimatedIndexBytes',
    'longTasksOver50Ms',
  ] as const;
  for (const key of keys) {
    if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0) return null;
  }
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as NativeHealthSnapshot;
}

function normalizeScope(scope: string): string {
  return scope.trim() || 'unscoped';
}

function takeLastCodePoints(text: string, count: number): string {
  return Array.from(text).slice(-count).join('');
}

function validateQueryCandidates(
  response: unknown,
  languageHint: HybridRetrievalLanguageHint,
): HybridRetrievalCandidate[] | null {
  if (
    !isRecord(response) ||
    response.operation !== 'query' ||
    !Array.isArray(response.candidates) ||
    !Number.isSafeInteger(response.committedRevision) ||
    (response.committedRevision as number) < 0 ||
    !Number.isSafeInteger(response.pendingMutations) ||
    (response.pendingMutations as number) < 0 ||
    typeof response.warming !== 'boolean'
  ) {
    return null;
  }
  if (response.candidates.length > 8) return null;

  const candidates: HybridRetrievalCandidate[] = [];
  for (const value of response.candidates) {
    if (!isRecord(value)) return null;
    const { text, confidence, support, documentSupport, providerId, sourceLayer } = value;
    if (typeof text !== 'string' || text.trim().length === 0 || /[\r\n]/u.test(text)) return null;
    const length = Array.from(text).length;
    if (length < 1 || length > 24) return null;
    if (!isFiniteNumberInRange(confidence, 0, 1)) return null;
    if (!Number.isSafeInteger(support) || (support as number) < 1) return null;
    if (
      !Number.isSafeInteger(documentSupport) ||
      (documentSupport as number) < 2 ||
      (documentSupport as number) > (support as number)
    ) {
      return null;
    }
    if (providerId !== 'hybrid-retrieval-zh' && providerId !== 'hybrid-retrieval-en') return null;
    if (sourceLayer !== 'notebook') return null;

    const hasHan = /\p{Script=Han}/u.test(text);
    const hasLatin = /[A-Za-z]/u.test(text);
    if (hasHan && hasLatin) return null;
    if (providerId === 'hybrid-retrieval-zh' && hasLatin) return null;
    if (providerId === 'hybrid-retrieval-en') {
      if (hasHan) return null;
      const words = text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/gu) ?? [];
      if (words.length < 1 || words.length > 3) return null;
    }
    if (languageHint === 'zh' && providerId !== 'hybrid-retrieval-zh') return null;
    if (languageHint === 'en' && providerId !== 'hybrid-retrieval-en') return null;
    if (languageHint === 'mixed') return null;

    candidates.push({
      text,
      confidence: confidence as number,
      support: support as number,
      documentSupport: documentSupport as number,
      providerId,
      sourceLayer,
    });
  }
  return candidates;
}

function isValidMutationResponse(
  response: HybridRetrievalResponse,
): response is HybridRetrievalResponse & { revision: number } {
  return (
    response.operation !== 'query' &&
    typeof response.changed === 'boolean' &&
    Number.isSafeInteger(response.documentCount) &&
    response.documentCount >= 0 &&
    Number.isSafeInteger(response.revision) &&
    (response.revision as number) >= 0
  );
}

function attachSnapshotMetadata(
  response: HybridRetrievalResponse,
  request: HybridRetrievalRequest,
  metadata: { revision: number; pendingMutations: number },
): HybridRetrievalResponse {
  if (request.operation === 'query' && response.operation === 'query') {
    return {
      ...response,
      committedRevision: metadata.revision,
      pendingMutations: metadata.pendingMutations,
      warming: metadata.pendingMutations > 0,
    };
  }
  if (request.operation !== 'query' && response.operation !== 'query') {
    return { ...response, revision: metadata.revision };
  }
  return response;
}

function performanceNow(): number {
  return typeof performance === 'object' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function detectBackendKind(backend: HybridRetrievalBackend): HybridRetrievalBackendKind {
  return backend.kind ?? 'local-test';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

function abortError(signal?: AbortSignal): Error {
  return namedAbortError(
    typeof signal?.reason === 'string' ? signal.reason : 'Completion retrieval was aborted.',
  );
}

function namedAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function toError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error;
  return new Error(error === undefined ? fallback : String(error));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function linkAbortSignals(
  external: AbortSignal | undefined,
  lifecycle: AbortSignal,
): { signal: AbortSignal; dispose: () => void } {
  if (!external) return { signal: lifecycle, dispose: () => undefined };

  const controller = new AbortController();
  const abortFrom = (source: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(source.reason);
  };
  const onExternalAbort = () => abortFrom(external);
  const onLifecycleAbort = () => abortFrom(lifecycle);
  external.addEventListener('abort', onExternalAbort, { once: true });
  lifecycle.addEventListener('abort', onLifecycleAbort, { once: true });
  if (external.aborted) abortFrom(external);
  else if (lifecycle.aborted) abortFrom(lifecycle);

  return {
    signal: controller.signal,
    dispose: () => {
      external.removeEventListener('abort', onExternalAbort);
      lifecycle.removeEventListener('abort', onLifecycleAbort);
    },
  };
}

function waitForPromise<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
