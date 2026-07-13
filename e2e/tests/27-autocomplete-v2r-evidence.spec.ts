import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  calculateV2RQualityMetrics,
  canonicalSha256,
  validateV2RHoldoutV3,
  type V2REvaluationObservation,
  type V2RHoldoutV3,
} from '../../scripts/autocomplete-v2r/index';
import { ensureEditorReady, waitForAppReady } from '../helpers/test-utils';

const HOLDOUT_PATH = process.env.JOTLUCK_AUTOCOMPLETE_V2R_HOLDOUT
  ? resolve(process.env.JOTLUCK_AUTOCOMPLETE_V2R_HOLDOUT)
  : '';
const REPORT_PATH = process.env.JOTLUCK_AUTOCOMPLETE_V2R_REPORT
  ? resolve(process.env.JOTLUCK_AUTOCOMPLETE_V2R_REPORT)
  : '';
const RECEIPT_PATH = process.env.JOTLUCK_AUTOCOMPLETE_V2R_FINAL_RECEIPT
  ? resolve(process.env.JOTLUCK_AUTOCOMPLETE_V2R_FINAL_RECEIPT)
  : '';
const CANDIDATE_ID = process.env.JOTLUCK_AUTOCOMPLETE_V2R_CANDIDATE ?? '';
const CANDIDATE_ASSETS = {
  modelSha256: process.env.JOTLUCK_AUTOCOMPLETE_V2R_MODEL_SHA256 ?? '',
  phraseBankSha256: process.env.JOTLUCK_AUTOCOMPLETE_V2R_PHRASE_BANK_SHA256 ?? '',
  metadataSha256: process.env.JOTLUCK_AUTOCOMPLETE_V2R_METADATA_SHA256 ?? '',
  runtimeSha256: process.env.JOTLUCK_AUTOCOMPLETE_V2R_RUNTIME_SHA256 ?? '',
};
const ENABLED = Boolean(HOLDOUT_PATH && REPORT_PATH && CANDIDATE_ID && existsSync(HOLDOUT_PATH));
const HOLDOUT = ENABLED ? (JSON.parse(readFileSync(HOLDOUT_PATH, 'utf8')) as V2RHoldoutV3) : null;

test.describe('autocomplete V2R frozen release evidence', { tag: '@autocomplete-v2r-rc' }, () => {
  test.skip(!ENABLED, 'V2R evidence runs only with an explicitly installed frozen candidate.');
  test.setTimeout(480_000);

  test.beforeAll(() => {
    if (!HOLDOUT) return;
    for (const [name, value] of Object.entries(CANDIDATE_ASSETS)) {
      if (!/^[0-9a-f]{64}$/u.test(value)) {
        throw new Error(`A V2R evidence run requires ${name}.`);
      }
    }
    const finalRun = HOLDOUT.classification.endsWith('-final-v3');
    if (!finalRun) return;
    if (!RECEIPT_PATH) {
      throw new Error('A final V2R evaluation requires an immutable consumption receipt path.');
    }
    mkdirSync(dirname(RECEIPT_PATH), { recursive: true });
    writeFileSync(
      RECEIPT_PATH,
      `${JSON.stringify(
        {
          schema: 'jotluck.autocomplete.v2r-final-run-consumption.v1',
          schemaVersion: 1,
          candidateId: CANDIDATE_ID,
          ...CANDIDATE_ASSETS,
          datasetId: HOLDOUT.datasetId,
          holdoutSha256: canonicalSha256(HOLDOUT),
          status: 'started',
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem(
        'jotluck:autocomplete:settings',
        JSON.stringify({
          enabled: true,
          aggressiveness: 'balanced',
          backgroundTraining: false,
          maxSuggestionLength: 12,
          minConfidence: 0.18,
          showDebugStats: false,
        }),
      );
      localStorage.setItem('jotluck:autocomplete:enabled', 'true');
      const measurement = { longTasksOver50Ms: 0 };
      Object.defineProperty(globalThis, '__jotluck_v2r_measurement', {
        configurable: true,
        value: measurement,
      });
      if ('PerformanceObserver' in globalThis) {
        try {
          const observer = new PerformanceObserver((list) => {
            measurement.longTasksOver50Ms += list
              .getEntries()
              .filter((entry) => entry.duration > 50).length;
          });
          observer.observe({ type: 'longtask', buffered: true });
        } catch {
          // Unsupported long-task observation is handled by the report gate.
          measurement.longTasksOver50Ms = -1;
        }
      } else {
        measurement.longTasksOver50Ms = -1;
      }
    });
  });

  test('measures Oracle@32 and visible Top-1 through the production Router', async ({ page }) => {
    if (!HOLDOUT) throw new Error('Frozen V2R holdout was not loaded.');
    const audit = validateV2RHoldoutV3(HOLDOUT);
    await openStableSourceEditor(page);
    if (HOLDOUT.classification.startsWith('workspace-')) {
      await page.evaluate(
        async (documents) => window.__jotluck_e2e?.editor?.seedWorkspaceDocuments?.(documents),
        HOLDOUT.supportDocuments.map(({ path, text }) => ({ path, content: text })),
      );
    }
    await page.evaluate(() =>
      window.__jotluck_e2e?.editor?.setCompletionAblationMode?.('full-stack'),
    );

    const observations: V2REvaluationObservation[] = [];
    const backendKinds = new Set<string>();
    const backendStatuses = new Set<string>();
    for (const target of HOLDOUT.targets) {
      for (const checkpoint of target.checkpoints) {
        const prefix = target.text.slice(0, checkpoint.cursorOffset);
        const diagnostics = await requestDiagnostics(page, prefix, 110);
        backendKinds.add(diagnostics.publicEngine.health?.backendKind ?? 'missing');
        backendStatuses.add(diagnostics.publicEngine.health?.status ?? 'missing');
        const resolverTop1 = diagnostics.result
          ? {
              text: diagnostics.result.text,
              providerId: diagnostics.result.providerId,
              sourceLayer: diagnostics.result.sourceLayer ?? 'unknown',
            }
          : null;
        let visibleLatencyMs: number | undefined;
        if (resolverTop1) {
          await page.evaluate(
            (content) => window.__jotluck_e2e?.editor?.setContent(content),
            prefix,
          );
          const visible = await expect
            .poll(
              () =>
                page.evaluate(() =>
                  window.__jotluck_e2e?.editor?.getVisiblePredictionDiagnostics?.(),
                ),
              { timeout: 700 },
            )
            .toMatchObject({ cursor: prefix.length, documentLength: prefix.length })
            .then(() =>
              page.evaluate(() =>
                window.__jotluck_e2e?.editor?.getVisiblePredictionDiagnostics?.(),
              ),
            );
          visibleLatencyMs = visible?.elapsedMs;
        }
        observations.push({
          checkpointId: checkpoint.id,
          language: target.language,
          category: target.category,
          checkpoint,
          publicL3Candidates: diagnostics.publicEngine.candidates.map((candidate) => ({
            text: candidate.text,
            providerId: candidate.providerId,
            sourceLayer: candidate.sourceLayer,
            source: candidate.source,
          })),
          resolverTop1,
          allRequestLatencyMs: diagnostics.elapsedMs,
          ...(visibleLatencyMs === undefined ? {} : { visibleLatencyMs }),
          fallback: diagnostics.publicEngine.fellBack,
          timeout: diagnostics.publicEngine.timedOut,
        });
      }
    }
    const metrics = calculateV2RQualityMetrics(observations);
    const mainThreadLongTasksOver50Ms = await page.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            __jotluck_v2r_measurement?: { longTasksOver50Ms: number };
          }
        ).__jotluck_v2r_measurement?.longTasksOver50Ms ?? -1,
    );
    const withoutIdentity = {
      schema: 'jotluck.autocomplete.v2r-quality-evidence.v1',
      schemaVersion: 1,
      evaluatorVersion: 'production-router-v2r-v1',
      candidateId: CANDIDATE_ID,
      ...CANDIDATE_ASSETS,
      datasetId: HOLDOUT.datasetId,
      classification: HOLDOUT.classification,
      holdoutSha256: audit.datasetSha256,
      observations,
      metrics,
      runtime: {
        workerOnly: true,
        backendKinds: [...backendKinds].sort(),
        backendStatuses: [...backendStatuses].sort(),
        mainThreadLongTasksOver50Ms,
      },
    };
    const report = { ...withoutIdentity, reportSha256: canonicalSha256(withoutIdentity) };
    mkdirSync(dirname(REPORT_PATH), { recursive: true });
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });

    if (HOLDOUT.classification.endsWith('-final-v3')) {
      const receipt = JSON.parse(readFileSync(RECEIPT_PATH, 'utf8')) as Record<string, unknown>;
      writeFileSync(
        RECEIPT_PATH,
        `${JSON.stringify(
          {
            ...receipt,
            status: metrics.releaseGate.passed ? 'passed' : 'failed',
            consumedAt: new Date().toISOString(),
            qualityReportFileSha256: sha256File(REPORT_PATH),
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
    }

    expect(metrics.candidateGate, metrics.candidateGate.reasons.join('\n')).toMatchObject({
      passed: true,
    });
    expect(metrics.releaseGate, metrics.releaseGate.reasons.join('\n')).toMatchObject({
      passed: true,
    });
  });
});

async function requestDiagnostics(page: Page, content: string, deadlineMs: number) {
  const diagnostics = await page.evaluate(
    ({ value, deadline }) =>
      window.__jotluck_e2e?.editor?.requestCompletionDiagnostics?.(value, value.length, deadline),
    { value: content, deadline: deadlineMs },
  );
  if (!diagnostics) throw new Error('Production completion diagnostics bridge is unavailable.');
  return diagnostics;
}

async function openStableSourceEditor(page: Page): Promise<void> {
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

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}
