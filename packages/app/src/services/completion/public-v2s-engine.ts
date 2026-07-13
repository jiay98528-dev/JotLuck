import {
  PUBLIC_ENGINE_MAX_OUTPUT_CODE_POINTS,
  PUBLIC_ENGINE_PROTOCOL_VERSION,
  createEmptyPublicEngineAssetDiagnostics,
  type CompletionPublicEngine,
  type PublicEngineDiagnostics,
  type PublicEngineGenerateRequest,
  type PublicEngineGenerateResponse,
} from './public-engine-types';
import { PUBLIC_V2S_ENGINE_ID, PUBLIC_V2S_MODEL_MAX_BYTES } from './public-v2s-binary';
import type { PublicV2sWorkerRequest, PublicV2sWorkerResponse } from './public-v2s-protocol';

export interface PublicV2sWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: PublicV2sWorkerRequest): void;
  terminate(): void;
}

export interface PublicV2sEngineOptions {
  modelUrl: string;
  expectedSha256: string;
  expectedModelBytes: number;
  expectedContainerHeaderSha256?: string;
  manifestBytes?: number;
  profile?: string;
  maxOutputCodePoints?: number;
  workerFactory?: () => PublicV2sWorkerLike;
}

interface PendingRequest {
  resolve: (response: PublicV2sWorkerResponse) => void;
  reject: (error: Error) => void;
  unlinkAbort: () => void;
}

export class PublicV2sEngine implements CompletionPublicEngine {
  readonly id = PUBLIC_V2S_ENGINE_ID;
  readonly protocolVersion = PUBLIC_ENGINE_PROTOCOL_VERSION;
  readonly sourceKind = 'ngram' as const;
  readonly maxOutputCodePoints: number;

  private readonly options: PublicV2sEngineOptions;
  private readonly workerFactory: () => PublicV2sWorkerLike;
  private readonly diagnosticsState: PublicEngineDiagnostics;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly inferenceSamples: number[] = [];
  private worker: PublicV2sWorkerLike | null = null;
  private warmupPromise: Promise<boolean> | null = null;
  private requestSequence = 0;
  private disposed = false;

  constructor(options: PublicV2sEngineOptions) {
    this.options = options;
    this.maxOutputCodePoints = options.maxOutputCodePoints ?? PUBLIC_ENGINE_MAX_OUTPUT_CODE_POINTS;
    this.workerFactory = options.workerFactory ?? createDefaultWorker;
    this.diagnosticsState = {
      engineId: this.id,
      backendKind: 'worker-mkn-trie',
      status: 'idle',
      epoch: 1,
      profile: options.profile ?? null,
      lastError: null,
      warmupDurationMs: 0,
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
    this.diagnosticsState.assets.manifestBytes = options.manifestBytes ?? 0;
  }

  warmup(signal?: AbortSignal): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.diagnosticsState.status === 'ready') return Promise.resolve(true);
    this.warmupPromise ??= this.performWarmup(signal);
    return this.warmupPromise;
  }

  async generate(
    request: PublicEngineGenerateRequest,
    signal?: AbortSignal,
  ): Promise<PublicEngineGenerateResponse> {
    if (this.disposed || this.diagnosticsState.status !== 'ready' || !this.worker) {
      throw new Error('Public V2S engine is unavailable.');
    }
    if (signal?.aborted) {
      this.diagnosticsState.cancellations += 1;
      throw abortError();
    }
    if (Date.now() > request.deadlineAt) {
      this.diagnosticsState.deadlineExpirations += 1;
      throw new Error('Public V2S request deadline expired.');
    }

    this.diagnosticsState.generateRequests += 1;
    const startedAt = performance.now();
    const response = await this.send(
      { type: 'generate', requestId: ++this.requestSequence, request },
      signal,
    );
    const duration = Math.max(0, performance.now() - startedAt);
    this.recordInference(duration);
    if (Date.now() > request.deadlineAt) {
      this.diagnosticsState.deadlineExpirations += 1;
      throw new Error('Public V2S response missed the request deadline.');
    }
    if (response.type !== 'generated' || !isRecord(response.response)) {
      this.diagnosticsState.invalidResponses += 1;
      throw new Error('Invalid Public V2S Worker response.');
    }
    const generated = response.response as unknown as PublicEngineGenerateResponse;
    if (Array.isArray(generated.candidates)) {
      this.diagnosticsState.generatedCandidates += generated.candidates.length;
    }
    return generated;
  }

  diagnostics(): PublicEngineDiagnostics {
    return {
      ...this.diagnosticsState,
      assets: { ...this.diagnosticsState.assets },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.diagnosticsState.status = 'disposed';
    this.diagnosticsState.epoch += 1;
    for (const [requestId, pending] of this.pending) {
      this.worker?.postMessage({ type: 'cancel', requestId });
      pending.unlinkAbort();
      pending.reject(new Error('Public V2S engine was disposed.'));
    }
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
  }

  private async performWarmup(signal?: AbortSignal): Promise<boolean> {
    const startedAt = performance.now();
    this.diagnosticsState.status = 'warming';
    try {
      if (
        !/^[a-f0-9]{64}$/u.test(this.options.expectedSha256) ||
        !Number.isInteger(this.options.expectedModelBytes) ||
        this.options.expectedModelBytes < 1 ||
        this.options.expectedModelBytes > PUBLIC_V2S_MODEL_MAX_BYTES ||
        !Number.isInteger(this.maxOutputCodePoints) ||
        this.maxOutputCodePoints < 1 ||
        this.maxOutputCodePoints > PUBLIC_ENGINE_MAX_OUTPUT_CODE_POINTS
      ) {
        throw new Error('Invalid Public V2S engine configuration.');
      }
      this.worker = this.workerFactory();
      this.worker.onmessage = (event) => this.handleWorkerMessage(event.data);
      this.worker.onerror = (event) => this.handleWorkerError(event.message);
      const response = await this.send(
        {
          type: 'init',
          requestId: ++this.requestSequence,
          protocolVersion: this.protocolVersion,
          modelUrl: this.options.modelUrl,
          expectedSha256: this.options.expectedSha256,
          expectedModelBytes: this.options.expectedModelBytes,
          expectedContainerHeaderSha256: this.options.expectedContainerHeaderSha256,
          maxModelBytes: PUBLIC_V2S_MODEL_MAX_BYTES,
          maxOutputCodePoints: this.maxOutputCodePoints,
        },
        signal,
      );
      if (
        response.type !== 'ready' ||
        response.protocolVersion !== this.protocolVersion ||
        response.modelSha256 !== this.options.expectedSha256 ||
        (this.options.expectedContainerHeaderSha256 !== undefined &&
          response.containerHeaderSha256 !== this.options.expectedContainerHeaderSha256) ||
        response.metadata.byteLength !== this.options.expectedModelBytes ||
        response.metadata.maxOutputCodePoints > this.maxOutputCodePoints
      ) {
        this.diagnosticsState.invalidResponses += 1;
        throw new Error('Invalid Public V2S warmup response.');
      }
      this.diagnosticsState.assets.modelBytes = response.metadata.byteLength;
      this.diagnosticsState.assets.modelDataBytes = response.metadata.byteLength;
      this.diagnosticsState.status = 'ready';
      this.diagnosticsState.lastError = null;
      return true;
    } catch (error) {
      this.diagnosticsState.lastError = error instanceof Error ? error.message : String(error);
      this.diagnosticsState.status = 'disabled';
      this.worker?.terminate();
      this.worker = null;
      return false;
    } finally {
      this.diagnosticsState.warmupDurationMs = Math.max(0, performance.now() - startedAt);
    }
  }

  private send(
    message: Exclude<PublicV2sWorkerRequest, { type: 'cancel' }>,
    signal?: AbortSignal,
  ): Promise<PublicV2sWorkerResponse> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('Public V2S Worker is unavailable.'));
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const onAbort = () => {
        this.pending.delete(message.requestId);
        worker.postMessage({ type: 'cancel', requestId: message.requestId });
        this.diagnosticsState.cancellations += 1;
        reject(abortError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(message.requestId, {
        resolve,
        reject,
        unlinkAbort: () => signal?.removeEventListener('abort', onAbort),
      });
      try {
        worker.postMessage(message);
      } catch (error) {
        this.pending.delete(message.requestId);
        signal?.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private handleWorkerMessage(value: unknown): void {
    if (!isRecord(value) || typeof value.requestId !== 'number') {
      this.diagnosticsState.invalidResponses += 1;
      return;
    }
    const pending = this.pending.get(value.requestId);
    if (!pending) {
      this.diagnosticsState.lateResponses += 1;
      return;
    }
    this.pending.delete(value.requestId);
    pending.unlinkAbort();
    if (value.type === 'error') {
      pending.reject(new Error(typeof value.error === 'string' ? value.error : 'Worker error'));
      return;
    }
    if (value.type !== 'ready' && value.type !== 'generated') {
      this.diagnosticsState.invalidResponses += 1;
      pending.reject(new Error('Invalid Public V2S Worker envelope.'));
      return;
    }
    pending.resolve(value as unknown as PublicV2sWorkerResponse);
  }

  private handleWorkerError(message: string): void {
    this.diagnosticsState.workerErrors += 1;
    this.diagnosticsState.epoch += 1;
    this.diagnosticsState.lastError = message || 'Public V2S Worker failed.';
    this.diagnosticsState.status = 'disabled';
    for (const pending of this.pending.values()) {
      pending.unlinkAbort();
      pending.reject(new Error(this.diagnosticsState.lastError));
    }
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
  }

  private recordInference(duration: number): void {
    this.diagnosticsState.lastInferenceDurationMs = duration;
    this.inferenceSamples.push(duration);
    if (this.inferenceSamples.length > 128) this.inferenceSamples.shift();
    const sorted = [...this.inferenceSamples].sort((left, right) => left - right);
    const index = Math.max(0, Math.ceil(sorted.length * 0.9) - 1);
    this.diagnosticsState.visibleInferenceP90Ms = sorted[index] ?? 0;
  }
}

function createDefaultWorker(): PublicV2sWorkerLike {
  if (typeof Worker === 'undefined') throw new Error('Worker is unavailable.');
  return new Worker(new URL('./public-v2s.worker.ts', import.meta.url), {
    type: 'module',
    name: 'jotluck-public-v2s',
  }) as unknown as PublicV2sWorkerLike;
}

function abortError(): Error {
  return new DOMException('The Public V2S request was aborted.', 'AbortError');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
