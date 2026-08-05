import { describe, expect, it, vi } from 'vitest';
import { decoderManifest } from './decoder-manifest.fixture';
import {
  createCanonicalPublicFreeDecoderEngine,
  createPublicFreeDecoderEvaluationEngine,
  isPublicFreeDecoderEvaluationEnvironment,
} from '../public-free-decoder-factory';
import type { PublicFreeDecoderTauriAdapter } from '../public-free-decoder-engine';

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const unusedAdapter: PublicFreeDecoderTauriAdapter = {
  warmup: vi.fn(async () => {
    throw new Error('warmup is not expected');
  }),
  generate: vi.fn(async () => {
    throw new Error('generate is not expected');
  }),
  cancel: vi.fn(async () => {}),
  dispose: vi.fn(async () => {}),
};

describe('public free decoder evaluation factory', () => {
  it('requires desktop plus an explicit dev/E2E flag and rejects production mode', () => {
    const flagged = { VITE_AUTOCOMPLETE_PUBLIC_FREE_DECODER: '1' };
    expect(
      isPublicFreeDecoderEvaluationEnvironment({ ...flagged, MODE: 'development' }, true),
    ).toBe(true);
    expect(isPublicFreeDecoderEvaluationEnvironment({ ...flagged, MODE: 'e2e' }, true)).toBe(true);
    expect(isPublicFreeDecoderEvaluationEnvironment({ ...flagged, MODE: 'production' }, true)).toBe(
      false,
    );
    expect(isPublicFreeDecoderEvaluationEnvironment({ MODE: 'development' }, true)).toBe(false);
    expect(
      isPublicFreeDecoderEvaluationEnvironment({ ...flagged, MODE: 'development' }, false),
    ).toBe(false);
  });

  it('constructs only the new engine identity from a passing candidate manifest', async () => {
    const engine = await createPublicFreeDecoderEvaluationEngine({
      manifestUrl: '/candidate/manifest.json',
      manifestPath: 'D:/candidate/manifest.json',
      fetcher: vi.fn(async () => response(decoderManifest())) as unknown as typeof fetch,
      adapter: unusedAdapter,
    });

    expect(engine?.id).toBe('public-v2-free-decoder-v1');
  });

  it('fails closed before worker construction for an ineligible manifest', async () => {
    const manifest = decoderManifest();
    manifest.oraclePrecheck.englishOracleAt8 = 0.39;
    await expect(
      createPublicFreeDecoderEvaluationEngine({
        manifestUrl: '/candidate/manifest.json',
        manifestPath: 'D:/candidate/manifest.json',
        fetcher: vi.fn(async () => response(manifest)) as unknown as typeof fetch,
        adapter: unusedAdapter,
      }),
    ).resolves.toBeNull();
  });

  it('keeps release construction separate from the dev/E2E constructor', async () => {
    const manifest = decoderManifest();
    manifest.lifecycle = 'releaseEligible';
    manifest.evaluationOnly = false;
    manifest.releaseEligible = true;
    manifest.releaseEvidence = {
      schema: 'jotluck.autocomplete.public-free-decoder-release.v1',
      coldFinalSha256: 'c'.repeat(64),
      workspaceFinalSha256: 'd'.repeat(64),
      windowsGuiEvidenceSha256: 'e'.repeat(64),
      baselineSha256: 'f'.repeat(64),
    };
    const fetcher = vi.fn(async () => response(manifest)) as unknown as typeof fetch;
    await expect(
      createPublicFreeDecoderEvaluationEngine({
        manifestUrl: '/candidate/manifest.json',
        manifestPath: 'D:/candidate/manifest.json',
        fetcher,
        adapter: unusedAdapter,
      }),
    ).resolves.toBeNull();
    await expect(
      createCanonicalPublicFreeDecoderEngine({ fetcher, adapter: unusedAdapter }),
    ).resolves.toMatchObject({ id: 'public-v2-free-decoder-v1' });
  });
});
