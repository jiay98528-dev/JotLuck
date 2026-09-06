import { describe, expect, it, vi } from 'vitest';
import {
  PUBLIC_ENGINE_PROTOCOL_VERSION,
  type PublicEngineGenerateRequest,
} from '../public-engine-types';
import {
  decoderManifest,
  v25JointManifest,
  v25OneUnitWritingManifest,
} from './decoder-manifest.fixture';
import {
  PublicFreeDecoderEngine,
  type PublicFreeDecoderTauriAdapter,
} from '../public-free-decoder-engine';

function request(): PublicEngineGenerateRequest {
  return {
    engineEpoch: 1,
    workspaceScope: 'workspace-a',
    documentVersion: 'revision:3',
    cursorPos: 8,
    contextTail: '今天先完成',
    contextTailUtf8Bytes: new TextEncoder().encode('今天先完成').byteLength,
    contextCapsule: {
      schemaVersion: 1,
      maxTokens: 256,
      languageHint: 'zh',
      headingTrail: ['计划'],
      currentParagraph: '今天先完成',
      previousParagraphTail: '',
      retrievalSnippet: '',
    },
    languageHint: 'zh',
    blockType: 'paragraph',
    cursorBoundary: 'other',
    maxCandidates: 8,
    deadlineAt: Date.now() + 1_000,
  };
}

function adapter(): PublicFreeDecoderTauriAdapter {
  return {
    warmup: vi.fn(async () => ({
      protocolVersion: 1,
      engineId: 'public-v2-free-decoder-v1',
      candidateId: '16m-q4-seed-1',
      workerPid: 42,
      manifestBytes: 2_048,
      modelBytes: 8 * 1024 * 1024,
      tokenizerBytes: 512 * 1024,
      runtimeStaticDeltaBytes: 2 * 1024 * 1024,
      peakMemoryLimitBytes: 192 * 1024 * 1024,
    })),
    generate: vi.fn<PublicFreeDecoderTauriAdapter['generate']>(
      async ({ requestId, request: input }) => ({
        requestId,
        response: {
          protocolVersion: PUBLIC_ENGINE_PROTOCOL_VERSION,
          engineEpoch: input.engineEpoch,
          workspaceScope: input.workspaceScope,
          documentVersion: input.documentVersion,
          cursorPos: input.cursorPos,
          candidates: [
            {
              candidateId: 'decoder-1',
              text: '运行时',
              confidence: 0.8,
              modelScore: 0.8,
              gateScore: 0.8,
              language: 'zh' as const,
            },
          ],
        },
      }),
    ),
    cancel: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  };
}

describe('PublicFreeDecoderEngine', () => {
  it('uses fixed-1 and the frozen G0 floor for one-unit Writing', async () => {
    const manifest = v25OneUnitWritingManifest();
    const tauri = adapter();
    tauri.warmup = vi.fn(async () => ({
      protocolVersion: 1,
      engineId: manifest.engine,
      candidateId: manifest.candidateId,
      workerPid: 42,
      manifestBytes: 2_048,
      modelBytes: manifest.assets.model.bytes,
      tokenizerBytes: manifest.assets.tokenizer.bytes,
      runtimeStaticDeltaBytes: 0,
      peakMemoryLimitBytes: 192 * 1024 * 1024,
    }));
    const engine = new PublicFreeDecoderEngine({
      manifest,
      manifestPath: 'candidate/one-unit.manifest.json',
      manifestBytes: 2_048,
      adapter: tauri,
    });

    await expect(engine.warmup()).resolves.toBe(true);
    await engine.generate(request());
    expect(tauri.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ searchMode: 'fixed-1' }),
      }),
    );
    expect(
      engine.visibilityThreshold({ route: 'writing', language: 'en', modelScore: 0.5 }),
    ).toBeCloseTo(0.0745673611471674);
  });

  it('uses manifest-bound V2.5 calibration and the joint engine identity', async () => {
    const manifest = v25JointManifest();
    const tauri = adapter();
    tauri.warmup = vi.fn(async () => ({
      protocolVersion: 1,
      engineId: manifest.engine,
      candidateId: manifest.candidateId,
      workerPid: 42,
      manifestBytes: 2_048,
      modelBytes: manifest.assets.model.bytes,
      tokenizerBytes: manifest.assets.tokenizer.bytes,
      runtimeStaticDeltaBytes: manifest.runtimeStaticDeltaBytes,
      peakMemoryLimitBytes: 192 * 1024 * 1024,
    }));
    const engine = new PublicFreeDecoderEngine({
      manifest,
      manifestPath: 'candidate/v25.manifest.json',
      manifestBytes: 2_048,
      adapter: tauri,
    });

    await expect(engine.warmup()).resolves.toBe(true);
    await engine.generate(request());
    expect(engine.id).toBe('public-v2.5-joint-v1');
    expect(tauri.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ searchMode: 'fixed-4' }),
      }),
    );
    expect(
      engine.calibrateVisibility({
        route: 'writing',
        language: 'zh',
        modelScore: 0.8,
        searchMode: 'fixed-4',
      }),
    ).toBeCloseTo(0.8);
    expect(
      engine.visibilityThreshold({
        route: 'writing',
        language: 'zh',
        modelScore: 0.8,
        searchMode: 'fixed-4',
      }),
    ).toBe(0.5);
    expect(
      engine.visibilityThreshold({
        route: 'code',
        language: 'en',
        modelScore: 0.8,
        searchMode: 'fixed-4',
      }),
    ).toBe(0.5);
  });

  it('warms a hash-bound Tauri worker and returns untrusted raw candidates', async () => {
    const tauri = adapter();
    const engine = new PublicFreeDecoderEngine({
      manifest: decoderManifest(),
      manifestPath: 'candidate/manifest.json',
      manifestBytes: 2_048,
      adapter: tauri,
    });
    await expect(engine.warmup()).resolves.toBe(true);
    await expect(engine.generate(request())).resolves.toMatchObject({
      candidates: [{ text: '运行时' }],
    });
    expect(engine.diagnostics()).toMatchObject({
      status: 'ready',
      generatedCandidates: 1,
      assets: { staticDeltaBytes: 10 * 1024 * 1024 + 512 * 1024 + 2_048 },
    });
  });

  it('propagates AbortSignal cancellation to the persistent worker', async () => {
    const tauri = adapter();
    tauri.generate = vi.fn<PublicFreeDecoderTauriAdapter['generate']>(() => new Promise(() => {}));
    const engine = new PublicFreeDecoderEngine({
      manifest: decoderManifest(),
      manifestPath: 'candidate/manifest.json',
      manifestBytes: 2_048,
      adapter: tauri,
    });
    await engine.warmup();
    const controller = new AbortController();
    const pending = engine.generate(request(), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(tauri.cancel).toHaveBeenCalledWith(1);
  });

  it('rejects mixed or missing capsules before IPC', async () => {
    const tauri = adapter();
    const engine = new PublicFreeDecoderEngine({
      manifest: decoderManifest(),
      manifestPath: 'candidate/manifest.json',
      manifestBytes: 2_048,
      adapter: tauri,
    });
    await engine.warmup();
    const invalid = { ...request(), languageHint: 'mixed' as const };
    await expect(engine.generate(invalid)).rejects.toThrow('Invalid');
    expect(tauri.generate).not.toHaveBeenCalled();
  });
});
