import { invoke } from '@tauri-apps/api/core';
import {
  PUBLIC_ENGINE_PROTOCOL_VERSION,
  createEmptyPublicEngineAssetDiagnostics,
  type CompletionPublicEngine,
  type PublicEngineDiagnostics,
  type PublicEngineGenerateRequest,
  type PublicEngineGenerateResponse,
} from './public-engine-types';
import {
  PUBLIC_FREE_DECODER_ENGINE_ID,
  PUBLIC_FREE_DECODER_EN_MAX_CODE_POINTS,
  PUBLIC_FREE_DECODER_PEAK_MEMORY_LIMIT_BYTES,
  PUBLIC_FREE_DECODER_PROTOCOL_VERSION,
  type PublicFreeDecoderManifest,
} from './public-free-decoder-contract';
import { isPublicEngineContextCapsule } from './public-free-context-capsule';

export interface PublicFreeDecoderReadyResponse {
  protocolVersion: number;
  engineId: string;
  candidateId: string;
  workerPid: number;
  manifestBytes: number;
  modelBytes: number;
  tokenizerBytes: number;
  runtimeStaticDeltaBytes: number;
  peakMemoryLimitBytes: number;
}

export interface PublicFreeDecoderGenerateEnvelope {
  requestId: number;
  response: PublicEngineGenerateResponse;
}

export interface PublicFreeDecoderTauriAdapter {
  warmup(request: {
    manifestPath: string;
    expectedCandidateId: string;
    protocolVersion: number;
  }): Promise<PublicFreeDecoderReadyResponse>;
  generate(request: {
    requestId: number;
    request: PublicEngineGenerateRequest;
  }): Promise<PublicFreeDecoderGenerateEnvelope>;
  cancel(requestId: number): Promise<void>;
  dispose(): Promise<void>;
}

export interface PublicFreeDecoderEngineOptions {
  manifest: PublicFreeDecoderManifest;
  manifestPath: string;
  manifestBytes: number;
  profile?: string;
  adapter?: PublicFreeDecoderTauriAdapter;
}

export class PublicFreeDecoderEngine implements CompletionPublicEngine {
  readonly id = PUBLIC_FREE_DECODER_ENGINE_ID;
  readonly protocolVersion = PUBLIC_ENGINE_PROTOCOL_VERSION;
  readonly sourceKind = 'neural' as const;
  readonly maxOutputCodePoints = PUBLIC_FREE_DECODER_EN_MAX_CODE_POINTS;

  private readonly adapter: PublicFreeDecoderTauriAdapter;
  private readonly diagnosticsState: PublicEngineDiagnostics;
  private readonly inferenceSamples: number[] = [];
  private warmupPromise: Promise<boolean> | null = null;
  private requestSequence = 0;
  private activeRequestId: number | null = null;
  private disposed = false;

  constructor(private readonly options: PublicFreeDecoderEngineOptions) {
    this.adapter = options.adapter ?? createTauriAdapter();
    this.diagnosticsState = {
      engineId: this.id,
      backendKind: 'tauri-persistent-decoder-worker',
      status: 'idle',
      epoch: 1,
      profile: options.profile ?? 'evaluation',
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
    this.diagnosticsState.assets.manifestBytes = options.manifestBytes;
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
    if (this.disposed || this.diagnosticsState.status !== 'ready') {
      throw new Error('Public free decoder is unavailable.');
    }
    if (
      signal?.aborted ||
      request.languageHint === 'mixed' ||
      !request.contextCapsule ||
      !isPublicEngineContextCapsule(request.contextCapsule)
    ) {
      throw abortOrContractError(signal, 'Invalid public free decoder request.');
    }
    if (Date.now() > request.deadlineAt) {
      this.diagnosticsState.deadlineExpirations += 1;
      throw new Error('Public free decoder request deadline expired.');
    }

    if (this.activeRequestId !== null) {
      const superseded = this.activeRequestId;
      this.diagnosticsState.cancellations += 1;
      void this.adapter.cancel(superseded).catch(() => {});
    }
    const requestId = ++this.requestSequence;
    this.activeRequestId = requestId;
    this.diagnosticsState.generateRequests += 1;
    const startedAt = performance.now();
    try {
      const envelope = await abortable(
        this.adapter.generate({ requestId, request }),
        signal,
        () => {
          this.diagnosticsState.cancellations += 1;
          void this.adapter.cancel(requestId).catch(() => {});
        },
      );
      if (this.activeRequestId !== requestId) {
        this.diagnosticsState.lateResponses += 1;
        throw new Error('Public free decoder response was superseded.');
      }
      if (
        envelope.requestId !== requestId ||
        envelope.response.protocolVersion !== PUBLIC_ENGINE_PROTOCOL_VERSION
      ) {
        this.diagnosticsState.invalidResponses += 1;
        throw new Error('Invalid public free decoder response envelope.');
      }
      if (Date.now() > request.deadlineAt) {
        this.diagnosticsState.deadlineExpirations += 1;
        throw new Error('Public free decoder response missed its deadline.');
      }
      this.diagnosticsState.generatedCandidates += envelope.response.candidates.length;
      return envelope.response;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        this.diagnosticsState.lastError = error instanceof Error ? error.message : String(error);
      }
      throw error;
    } finally {
      if (this.activeRequestId === requestId) this.activeRequestId = null;
      this.recordInference(Math.max(0, performance.now() - startedAt));
    }
  }

  diagnostics(): PublicEngineDiagnostics {
    return { ...this.diagnosticsState, assets: { ...this.diagnosticsState.assets } };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.diagnosticsState.status = 'disposed';
    this.diagnosticsState.epoch += 1;
    if (this.activeRequestId !== null) {
      await this.adapter.cancel(this.activeRequestId).catch(() => {});
      this.activeRequestId = null;
    }
    await this.adapter.dispose().catch(() => {});
  }

  private async performWarmup(signal?: AbortSignal): Promise<boolean> {
    const startedAt = performance.now();
    this.diagnosticsState.status = 'warming';
    try {
      const ready = await abortable(
        this.adapter.warmup({
          manifestPath: this.options.manifestPath,
          expectedCandidateId: this.options.manifest.candidateId,
          protocolVersion: PUBLIC_FREE_DECODER_PROTOCOL_VERSION,
        }),
        signal,
      );
      if (
        ready.protocolVersion !== PUBLIC_FREE_DECODER_PROTOCOL_VERSION ||
        ready.engineId !== PUBLIC_FREE_DECODER_ENGINE_ID ||
        ready.candidateId !== this.options.manifest.candidateId ||
        ready.manifestBytes !== this.options.manifestBytes ||
        ready.modelBytes !== this.options.manifest.assets.model.bytes ||
        ready.tokenizerBytes !== this.options.manifest.assets.tokenizer.bytes ||
        ready.runtimeStaticDeltaBytes !== this.options.manifest.runtimeStaticDeltaBytes ||
        ready.peakMemoryLimitBytes !== PUBLIC_FREE_DECODER_PEAK_MEMORY_LIMIT_BYTES
      ) {
        this.diagnosticsState.invalidResponses += 1;
        throw new Error('Public free decoder warmup identity mismatch.');
      }
      this.diagnosticsState.assets.modelBytes = ready.modelBytes;
      this.diagnosticsState.assets.modelDataBytes = ready.modelBytes;
      this.diagnosticsState.assets.auxiliaryBytes = ready.tokenizerBytes;
      this.diagnosticsState.assets.runtimeBytes = ready.runtimeStaticDeltaBytes;
      this.diagnosticsState.assets.staticDeltaBytes =
        ready.manifestBytes +
        ready.modelBytes +
        ready.tokenizerBytes +
        ready.runtimeStaticDeltaBytes;
      this.diagnosticsState.status = 'ready';
      this.diagnosticsState.lastError = null;
      return true;
    } catch (error) {
      this.diagnosticsState.status = 'disabled';
      this.diagnosticsState.lastError = error instanceof Error ? error.message : String(error);
      this.diagnosticsState.workerErrors += 1;
      return false;
    } finally {
      this.diagnosticsState.warmupDurationMs = Math.max(0, performance.now() - startedAt);
    }
  }

  private recordInference(duration: number): void {
    this.diagnosticsState.lastInferenceDurationMs = duration;
    this.inferenceSamples.push(duration);
    if (this.inferenceSamples.length > 128) this.inferenceSamples.shift();
    const sorted = [...this.inferenceSamples].sort((left, right) => left - right);
    this.diagnosticsState.visibleInferenceP90Ms =
      sorted[Math.max(0, Math.ceil(sorted.length * 0.9) - 1)] ?? 0;
  }
}

function createTauriAdapter(): PublicFreeDecoderTauriAdapter {
  return {
    warmup: (request) => invoke('completion_decoder_warmup', { request }),
    generate: (request) => invoke('completion_decoder_generate', { request }),
    cancel: (requestId) => invoke('completion_decoder_cancel', { request: { requestId } }),
    dispose: () => invoke('completion_decoder_dispose'),
  };
}

function abortable<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  onAbort: () => void = () => {},
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      onAbort();
      reject(abortError());
    };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

function abortOrContractError(signal: AbortSignal | undefined, message: string): Error {
  return signal?.aborted ? abortError() : new Error(message);
}

function abortError(): DOMException {
  return new DOMException('The public free decoder request was aborted.', 'AbortError');
}
