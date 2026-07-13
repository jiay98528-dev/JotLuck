import { describe, expect, it, vi } from 'vitest';
import { PUBLIC_ENGINE_PROTOCOL_VERSION } from '../public-engine-types';
import type { PublicV2sWorkerLike } from '../public-v2s-engine';
import {
  PUBLIC_V2S_CANONICAL_MANIFEST_URL,
  createCanonicalPublicV2sEngine,
} from '../public-v2s-factory';
import type { PublicV2sWorkerRequest } from '../public-v2s-protocol';
import type { PublicV2sByteCache } from '../public-v2s-cache';

const SHA = 'a'.repeat(64);
const HEADER_SHA = 'b'.repeat(64);
const MODEL_BYTES = 100;

class ReadyWorker implements PublicV2sWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly posted: PublicV2sWorkerRequest[] = [];

  postMessage(message: PublicV2sWorkerRequest): void {
    this.posted.push(message);
    if (message.type !== 'init') return;
    queueMicrotask(() =>
      this.onmessage?.({
        data: {
          type: 'ready',
          requestId: message.requestId,
          protocolVersion: PUBLIC_ENGINE_PROTOCOL_VERSION,
          modelSha256: SHA,
          containerHeaderSha256: HEADER_SHA,
          metadata: {
            schema: 'jotluck.autocomplete.v2s-runtime-metadata.v1',
            schemaVersion: 6,
            engine: 'public-v2s-mkn-v1',
            candidateId: 'release-v2s',
            maxOrder: 5,
            providerId: 'public-v2s-mkn-v1',
            source: 'public-v2s',
            sourceLayer: 'l3',
            maxOutputCodePoints: 48,
            byteLength: MODEL_BYTES,
            containerHeaderSha256: HEADER_SHA,
            gateFeatureSchema: 'v2s-gate-features-v1',
            gateKind: 'g0-rules',
          },
        },
      } as MessageEvent<unknown>),
    );
  }

  terminate(): void {}
}

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'jotluck.autocomplete.public-model.v6',
    schemaVersion: 6,
    engine: 'public-v2s-mkn-v1',
    releaseId: 'c'.repeat(64),
    publishedAt: '2026-07-13T00:00:00.000Z',
    runtimeEligible: true,
    qualityGatePassed: true,
    releaseEligible: true,
    asset: {
      file: `public-v2s-mkn-v1.${SHA}.bin`,
      sha256: SHA,
      bytes: MODEL_BYTES,
      containerHeaderSha256: HEADER_SHA,
    },
    ...overrides,
  };
}

function response(value: unknown): Response {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return {
    ok: true,
    headers: new Headers({ 'content-length': String(bytes.byteLength) }),
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  } as Response;
}

describe('canonical Public V2S engine factory', () => {
  it('loads only the fixed eligible v6 manifest and derives the content-addressed asset URL', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      response(manifest()),
    );
    const worker = new ReadyWorker();
    const engine = await createCanonicalPublicV2sEngine({
      fetcher: fetcher as unknown as typeof fetch,
      workerFactory: () => worker,
    });

    expect(fetcher).toHaveBeenCalledWith(
      PUBLIC_V2S_CANONICAL_MANIFEST_URL,
      expect.objectContaining({ cache: 'no-cache', credentials: 'same-origin' }),
    );
    expect(engine).not.toBeNull();
    await expect(engine!.warmup()).resolves.toBe(true);
    expect(worker.posted[0]).toMatchObject({
      type: 'init',
      modelUrl: `/autocomplete/public-v2s-mkn-v1.${SHA}.bin`,
      expectedSha256: SHA,
      expectedModelBytes: MODEL_BYTES,
      expectedContainerHeaderSha256: HEADER_SHA,
    });
    expect(engine!.diagnostics()).toMatchObject({ status: 'ready', profile: 'release' });
  });

  it.each([
    ['ineligible quality flag', { qualityGatePassed: false }],
    [
      'non-content-addressed asset',
      { asset: { file: 'public-v2s.bin', sha256: SHA, bytes: MODEL_BYTES } },
    ],
    ['legacy schema', { schemaVersion: 5 }],
  ])('fails closed on %s without probing any legacy path', async (_name, overrides) => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      response(manifest(overrides)),
    );
    await expect(
      createCanonicalPublicV2sEngine({ fetcher: fetcher as unknown as typeof fetch }),
    ).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe(PUBLIC_V2S_CANONICAL_MANIFEST_URL);
  });

  it('uses only a previously validated cached v6 manifest when offline', async () => {
    const entries = new Map<string, Uint8Array>();
    const byteCache: PublicV2sByteCache = {
      read: async (url) => entries.get(url)?.slice() ?? null,
      write: async (url, bytes) => {
        entries.set(url, bytes.slice());
      },
    };
    const online = vi.fn(async () => response(manifest()));
    await expect(
      createCanonicalPublicV2sEngine({
        fetcher: online as unknown as typeof fetch,
        byteCache,
        workerFactory: () => new ReadyWorker(),
      }),
    ).resolves.not.toBeNull();
    expect(entries.has(PUBLIC_V2S_CANONICAL_MANIFEST_URL)).toBe(true);

    const offline = vi.fn(async () => {
      throw new TypeError('offline');
    });
    await expect(
      createCanonicalPublicV2sEngine({
        fetcher: offline as unknown as typeof fetch,
        byteCache,
        workerFactory: () => new ReadyWorker(),
      }),
    ).resolves.not.toBeNull();
    expect(offline).toHaveBeenCalledOnce();
  });
});
