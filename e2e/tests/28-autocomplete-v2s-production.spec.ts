import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { ensureEditorReady, waitForAppReady } from '../helpers/test-utils';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const manifestPath = path.join(
  repositoryRoot,
  'packages/app/public/autocomplete/autocomplete-public.manifest.json',
);
const installed = existsSync(manifestPath) ? loadInstalledRelease() : null;

test.describe('Public V2S production route', { tag: '@autocomplete-rc' }, () => {
  test.skip(!installed, 'Canonical Public V2S is intentionally fail-closed in this checkout.');

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem('jotluck:autocomplete:enabled', 'true');
      localStorage.setItem(
        'jotluck:autocomplete:settings',
        JSON.stringify({
          enabled: true,
          aggressiveness: 'balanced',
          backgroundTraining: false,
          maxSuggestionLength: 48,
          minConfidence: 0.18,
          showDebugStats: false,
        }),
      );
    });
  });

  test('loads the content-addressed asset in a Worker and stamps every candidate', async ({
    page,
  }) => {
    if (!installed) throw new Error('Public V2S release fixture is missing.');
    await openStableEditor(page);
    const prefix = installed.targetText.slice(0, installed.cursorOffset);
    const diagnostics = await expect
      .poll(() => requestDiagnostics(page, prefix), { timeout: 30_000 })
      .toMatchObject({
        publicEngine: {
          attempted: true,
          usedEngineId: 'public-v2s-mkn-v1',
          health: { backendKind: 'worker-mkn-trie', status: 'ready' },
        },
      })
      .then(() => requestDiagnostics(page, prefix));

    expect(diagnostics.publicEngine.candidates.length).toBeLessThanOrEqual(32);
    for (const candidate of diagnostics.publicEngine.candidates) {
      expect(candidate).toMatchObject({
        from: prefix.length,
        source: 'ngram',
        sourceLayer: 'l3',
        providerId: 'public-v2s-mkn-v1',
      });
      expect(candidate.text).not.toMatch(/[\r\n]/u);
    }
  });
});

async function requestDiagnostics(page: Page, content: string) {
  const value = await page.evaluate(
    (text) =>
      window.__jotluck_e2e?.editor?.requestCompletionDiagnostics?.(text, text.length, 1_000),
    content,
  );
  if (!value) throw new Error('Production completion diagnostics bridge is unavailable.');
  return value;
}

async function openStableEditor(page: Page): Promise<void> {
  await waitForAppReady(page);
  await ensureEditorReady(page);
  await expect
    .poll(() => page.evaluate(() => window.__jotluck_e2e?.listNotePaths?.().length ?? 0), {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);
  const notePath = await page.evaluate(() => window.__jotluck_e2e?.listNotePaths?.()[0] ?? '');
  await page.evaluate((value) => window.__jotluck_e2e?.selectNote?.(value), notePath);
  await expect(page.locator('.split-left .cm-content')).toBeVisible({ timeout: 10_000 });
}

function loadInstalledRelease(): { targetText: string; cursorOffset: number } {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    engine: string;
    releaseEligible: boolean;
    asset: { file: string; sha256: string; bytes: number };
    evidenceBindings: { coldValidation: { path: string; sha256: string } };
  };
  if (manifest.engine !== 'public-v2s-mkn-v1' || manifest.releaseEligible !== true) {
    throw new Error('RC production test requires an eligible canonical Public V2S manifest.');
  }
  const assetPath = path.join(
    repositoryRoot,
    'packages/app/public/autocomplete',
    manifest.asset.file,
  );
  const asset = readFileSync(assetPath);
  if (
    asset.byteLength !== manifest.asset.bytes ||
    createHash('sha256').update(asset).digest('hex') !== manifest.asset.sha256
  ) {
    throw new Error('RC production test found a detached content-addressed V2S asset.');
  }
  const evidencePath = path.join(repositoryRoot, manifest.evidenceBindings.coldValidation.path);
  const evidenceBytes = readFileSync(evidencePath);
  if (
    createHash('sha256').update(evidenceBytes).digest('hex') !==
    manifest.evidenceBindings.coldValidation.sha256
  ) {
    throw new Error('RC production test found detached cold-validation evidence.');
  }
  const evidence = JSON.parse(evidenceBytes.toString('utf8')) as {
    holdoutPath: string;
    observations: Array<{ checkpointId: string; combinedTop1: unknown }>;
  };
  const holdout = JSON.parse(
    readFileSync(path.join(repositoryRoot, evidence.holdoutPath), 'utf8'),
  ) as {
    targets: Array<{
      text: string;
      checkpoints: Array<{ id: string; cursorOffset: number; expectedBehavior: string }>;
    }>;
  };
  const visibleIds = new Set(
    evidence.observations
      .filter((item) => item.combinedTop1 !== null)
      .map((item) => item.checkpointId),
  );
  for (const target of holdout.targets) {
    const checkpoint = target.checkpoints.find(
      (item) => item.expectedBehavior === 'complete' && visibleIds.has(item.id),
    );
    if (checkpoint) return { targetText: target.text, cursorOffset: checkpoint.cursorOffset };
  }
  throw new Error('RC cold validation has no visible complete checkpoint for production smoke.');
}
