import { describe, expect, it, vi } from 'vitest';
import {
  PUBLIC_ENGINE_PROTOCOL_VERSION,
  type PublicEngineGenerateRequest,
} from '../public-engine-types';
import { PublicV2sEngine, type PublicV2sWorkerLike } from '../public-v2s-engine';
import type { PublicV2sWorkerRequest } from '../public-v2s-protocol';

const MODEL_SHA = 'a'.repeat(64);
const MODEL_BYTES = 100;

class FakeWorker implements PublicV2sWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly posted: PublicV2sWorkerRequest[] = [];
  terminated = false;

  constructor(private readonly respondToGenerate = true) {}

  postMessage(message: PublicV2sWorkerRequest): void {
    this.posted.push(message);
    if (message.type === 'init') {
      queueMicrotask(() =>
        this.onmessage?.({
          data: {
            type: 'ready',
            requestId: message.requestId,
            protocolVersion: PUBLIC_ENGINE_PROTOCOL_VERSION,
            modelSha256: MODEL_SHA,
            containerHeaderSha256: 'c'.repeat(64),
            metadata: {
              schema: 'jotluck.autocomplete.v2s-runtime-metadata.v1',
              schemaVersion: 6,
              engine: 'public-v2s-mkn-v1',
              candidateId: 'fixture',
              maxOrder: 5,
              providerId: 'public-v2s-mkn-v1',
              source: 'public-v2s',
              sourceLayer: 'l3',
              maxOutputCodePoints: 16,
              byteLength: MODEL_BYTES,
              containerHeaderSha256: 'c'.repeat(64),
              gateFeatureSchema: 'v2s-gate-features-v1',
              gateKind: 'g0-rules',
            },
          },
        } as MessageEvent<unknown>),
      );
      return;
    }
    if (message.type === 'generate' && this.respondToGenerate) {
      queueMicrotask(() =>
        this.onmessage?.({
          data: {
            type: 'generated',
            requestId: message.requestId,
            response: {
              protocolVersion: PUBLIC_ENGINE_PROTOCOL_VERSION,
              engineEpoch: message.request.engineEpoch,
              workspaceScope: message.request.workspaceScope,
              documentVersion: message.request.documentVersion,
              cursorPos: message.request.cursorPos,
              candidates: [
                {
                  candidateId: 'fixture-en',
                  text: ' reviewed',
                  confidence: 0.9,
                  modelScore: 0.88,
                  gateScore: 0.92,
                  language: 'en',
                },
              ],
            },
          },
        } as MessageEvent<unknown>),
      );
    }
  }

  terminate(): void {
    this.terminated = true;
  }
}

function request(): PublicEngineGenerateRequest {
  return {
    engineEpoch: 1,
    workspaceScope: 'workspace-a',
    documentVersion: 'doc-v1',
    cursorPos: 12,
    contextTail: 'Project plan',
    contextTailUtf8Bytes: 12,
    languageHint: 'en',
    blockType: 'paragraph',
    cursorBoundary: 'word',
    maxCandidates: 32,
    deadlineAt: Date.now() + 1_000,
  };
}

describe('Public V2S Worker adapter', () => {
  it('loads one verified binary and returns only raw Worker candidates', async () => {
    const worker = new FakeWorker();
    const engine = new PublicV2sEngine({
      modelUrl: '/public-v2s.bin',
      expectedSha256: MODEL_SHA,
      expectedModelBytes: MODEL_BYTES,
      maxOutputCodePoints: 16,
      workerFactory: () => worker,
    });

    await expect(engine.warmup()).resolves.toBe(true);
    await expect(engine.generate(request())).resolves.toMatchObject({
      protocolVersion: PUBLIC_ENGINE_PROTOCOL_VERSION,
      candidates: [
        {
          candidateId: 'fixture-en',
          text: ' reviewed',
          confidence: 0.9,
          modelScore: 0.88,
          gateScore: 0.92,
          language: 'en',
        },
      ],
    });
    expect(worker.posted.map((message) => message.type)).toEqual(['init', 'generate']);
    expect(engine.diagnostics()).toMatchObject({
      status: 'ready',
      generateRequests: 1,
      generatedCandidates: 1,
      assets: { modelBytes: MODEL_BYTES, modelDataBytes: MODEL_BYTES },
    });
  });

  it('fails closed when Worker construction is unavailable', async () => {
    const engine = new PublicV2sEngine({
      modelUrl: '/public-v2s.bin',
      expectedSha256: MODEL_SHA,
      expectedModelBytes: MODEL_BYTES,
      workerFactory: () => {
        throw new Error('CSP blocked Worker');
      },
    });

    await expect(engine.warmup()).resolves.toBe(false);
    expect(engine.diagnostics()).toMatchObject({
      status: 'disabled',
      lastError: 'CSP blocked Worker',
    });
    await expect(engine.generate(request())).rejects.toThrow('unavailable');
  });

  it('propagates cancellation to the Worker and ignores a late response', async () => {
    const worker = new FakeWorker(false);
    const engine = new PublicV2sEngine({
      modelUrl: '/public-v2s.bin',
      expectedSha256: MODEL_SHA,
      expectedModelBytes: MODEL_BYTES,
      maxOutputCodePoints: 16,
      workerFactory: () => worker,
    });
    await engine.warmup();
    const controller = new AbortController();
    const pending = engine.generate(request(), controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.posted.at(-1)).toMatchObject({ type: 'cancel' });
    expect(engine.diagnostics().cancellations).toBe(1);

    const generated = worker.posted.find((message) => message.type === 'generate');
    if (generated?.type === 'generate') {
      worker.onmessage?.({
        data: {
          type: 'generated',
          requestId: generated.requestId,
          response: {},
        },
      } as MessageEvent<unknown>);
    }
    expect(engine.diagnostics().lateResponses).toBe(1);
  });

  it('rejects a corrupted warmup identity', async () => {
    const worker = new FakeWorker();
    const originalPostMessage = worker.postMessage.bind(worker);
    vi.spyOn(worker, 'postMessage').mockImplementation((message) => {
      if (message.type !== 'init') {
        originalPostMessage(message);
        return;
      }
      queueMicrotask(() =>
        worker.onmessage?.({
          data: {
            type: 'ready',
            requestId: message.requestId,
            protocolVersion: PUBLIC_ENGINE_PROTOCOL_VERSION,
            modelSha256: 'b'.repeat(64),
            containerHeaderSha256: 'c'.repeat(64),
            metadata: {
              schema: 'jotluck.autocomplete.v2s-runtime-metadata.v1',
              schemaVersion: 6,
              engine: 'public-v2s-mkn-v1',
              candidateId: 'fixture',
              maxOrder: 5,
              providerId: 'public-v2s-mkn-v1',
              source: 'public-v2s',
              sourceLayer: 'l3',
              maxOutputCodePoints: 16,
              byteLength: MODEL_BYTES,
              containerHeaderSha256: 'c'.repeat(64),
              gateFeatureSchema: 'v2s-gate-features-v1',
              gateKind: 'g0-rules',
            },
          },
        } as MessageEvent<unknown>),
      );
    });
    const engine = new PublicV2sEngine({
      modelUrl: '/public-v2s.bin',
      expectedSha256: MODEL_SHA,
      expectedModelBytes: MODEL_BYTES,
      maxOutputCodePoints: 16,
      workerFactory: () => worker,
    });

    await expect(engine.warmup()).resolves.toBe(false);
    expect(engine.diagnostics()).toMatchObject({ status: 'disabled', invalidResponses: 1 });
    expect(worker.terminated).toBe(true);
  });
});
