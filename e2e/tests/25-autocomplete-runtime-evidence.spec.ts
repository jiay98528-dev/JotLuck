import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { ensureEditorReady, waitForAppReady } from '../helpers/test-utils';

interface HoldoutCheckpoint {
  id: string;
  cursorOffset: number;
  expectedSuffix: string;
  expectedBehavior: 'complete' | 'silence';
}

interface HoldoutCase {
  id: string;
  language: 'zh' | 'en';
  category: string;
  text: string;
  checkpoints: HoldoutCheckpoint[];
}

interface FormalHoldout {
  schemaVersion: 2;
  datasetId: string;
  frozenAt: string;
  cases: HoldoutCase[];
}

interface RuntimeTierEvidence {
  modelSha256: string;
  requestCount: number;
  visibleSampleCount: number;
  allRequestP90Ms: number;
  visiblePredictionP90Ms: number;
  fallbackRate: number;
  timeoutRate: number;
  mixedCandidateRate: number;
  parseMaxChunkMs: number;
  parseLongTasksOver50Ms: number;
  productionRouterObserved: boolean;
}

interface RuntimeEvidenceReport {
  schemaVersion: 2;
  classification: 'production-router-runtime-evidence';
  validationSha256: string;
  evaluatorVersion: string;
  tiers: Record<string, RuntimeTierEvidence>;
}

const HOLDOUT_PATH = resolve('scripts/corpus/formal-holdout.json');
const EVIDENCE_PATH = resolve(
  process.env.JOTLUCK_AUTOCOMPLETE_RUNTIME_EVIDENCE ??
    'scripts/corpus/_web-cache/autocomplete-candidates/runtime-evidence.json',
);
const RUNTIME_TIER = process.env.JOTLUCK_AUTOCOMPLETE_RUNTIME_TIER;
if (!RUNTIME_TIER) {
  throw new Error('JOTLUCK_AUTOCOMPLETE_RUNTIME_TIER must identify an installed candidate.');
}
const HOLDOUT = JSON.parse(readFileSync(HOLDOUT_PATH, 'utf8')) as FormalHoldout;
const VALIDATION_SHA256 = sha256(canonicalJson(HOLDOUT));
const EVALUATOR_VERSION = 'production-router-runtime-v2';

test.describe('autocomplete production runtime evidence', { tag: '@autocomplete-rc' }, () => {
  test.setTimeout(360_000);

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
    });
  });

  test('measures the production Router/Hybrid/deadline path and writes bound evidence', async ({
    page,
  }) => {
    await openStableSourceEditor(page);
    await page.evaluate(() =>
      window.__jotluck_e2e?.editor?.setCompletionAblationMode?.('full-stack'),
    );

    const calibration = await requestDiagnostics(page, 'Project plan ', 0);
    expect(calibration.hybrid.attempted).toBe(true);
    expect(calibration.hybrid.timedOut).toBe(true);
    expect(calibration.hybrid.fellBack).toBe(true);

    const allRequestLatencies: number[] = [];
    const triggeredPrefixes: string[] = [];
    let requests = 0;
    let fallbacks = 0;
    let timeouts = 0;
    let mixedCandidateRequests = 0;
    let warmingRequests = 0;
    let modelSha256: string | null = null;
    let parseMaxChunkMs = 0;
    let parseLongTasksOver50Ms = 0;
    const backendKinds: Record<string, number> = {};

    for (const item of HOLDOUT.cases) {
      for (const checkpoint of item.checkpoints) {
        const prefix = item.text.slice(0, checkpoint.cursorOffset);
        const diagnostics = await requestDiagnostics(page, prefix, 110);
        requests++;
        allRequestLatencies.push(diagnostics.elapsedMs);
        if (diagnostics.hybrid.fellBack || diagnostics.ranker.fellBack) fallbacks++;
        if (diagnostics.hybrid.timedOut) timeouts++;
        if (diagnostics.hybrid.health.status === 'warming') warmingRequests++;
        const backendKind = diagnostics.hybrid.health.backendKind;
        backendKinds[backendKind] = (backendKinds[backendKind] ?? 0) + 1;
        if (
          diagnostics.rankedCandidates.some((candidate) =>
            isMixedCandidate(candidate.text, item.language),
          )
        ) {
          mixedCandidateRequests++;
        }
        if (diagnostics.result) triggeredPrefixes.push(prefix);
        if (diagnostics.baselineModel) {
          modelSha256 ??= diagnostics.baselineModel.modelSha256;
          expect(diagnostics.baselineModel.modelSha256).toBe(modelSha256);
        }
        parseMaxChunkMs = Math.max(parseMaxChunkMs, diagnostics.baselineParse.maxChunkMs);
        parseLongTasksOver50Ms = Math.max(
          parseLongTasksOver50Ms,
          diagnostics.baselineParse.longTasksOver50Ms,
        );
      }
    }

    expect(modelSha256).not.toBeNull();
    if (!modelSha256) throw new Error('The exact runtime candidate model was not loaded.');

    const visiblePredictionLatencies: number[] = [];
    for (const prefix of triggeredPrefixes) {
      await page.evaluate((content) => window.__jotluck_e2e?.editor?.setContent(content), prefix);
      const visible = await expect
        .poll(
          () =>
            page.evaluate(() => window.__jotluck_e2e?.editor?.getVisiblePredictionDiagnostics?.()),
          { timeout: 700 },
        )
        .toMatchObject({ cursor: prefix.length, documentLength: prefix.length })
        .then(() =>
          page.evaluate(() => window.__jotluck_e2e?.editor?.getVisiblePredictionDiagnostics?.()),
        )
        .catch(() => null);
      if (visible) visiblePredictionLatencies.push(visible.elapsedMs);
    }

    expect(visiblePredictionLatencies.length).toBeGreaterThan(0);
    const evidence: RuntimeTierEvidence = {
      modelSha256,
      requestCount: requests,
      visibleSampleCount: visiblePredictionLatencies.length,
      allRequestP90Ms: percentile(allRequestLatencies, 0.9),
      visiblePredictionP90Ms: percentile(visiblePredictionLatencies, 0.9),
      fallbackRate: rate(fallbacks, requests),
      timeoutRate: rate(timeouts, requests),
      mixedCandidateRate: rate(mixedCandidateRequests, requests),
      parseMaxChunkMs,
      parseLongTasksOver50Ms,
      productionRouterObserved: true,
    };
    expect(requests).toBeGreaterThanOrEqual(200);
    expect(evidence.mixedCandidateRate).toBe(0);
    expect(evidence.allRequestP90Ms).toBeLessThanOrEqual(140);
    expect(evidence.visiblePredictionP90Ms).toBeLessThanOrEqual(140);

    const existing = readExistingEvidence();
    const report: RuntimeEvidenceReport = {
      schemaVersion: 2,
      classification: 'production-router-runtime-evidence',
      validationSha256: VALIDATION_SHA256,
      evaluatorVersion: EVALUATOR_VERSION,
      tiers: { ...(existing?.tiers ?? {}), [RUNTIME_TIER]: evidence },
    };
    mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
    writeFileSync(EVIDENCE_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(
      JSON.stringify(
        {
          runtimeEvidence: {
            tier: RUNTIME_TIER,
            requests,
            visibleSamples: visiblePredictionLatencies.length,
            warmingRequests,
            backendKinds,
            ...evidence,
          },
        },
        null,
        2,
      ),
    );
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

function readExistingEvidence(): RuntimeEvidenceReport | null {
  if (!existsSync(EVIDENCE_PATH)) return null;
  try {
    const value = JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8')) as RuntimeEvidenceReport;
    return value.schemaVersion === 2 &&
      value.classification === 'production-router-runtime-evidence' &&
      value.validationSha256 === VALIDATION_SHA256 &&
      value.evaluatorVersion === EVALUATOR_VERSION
      ? value
      : null;
  } catch {
    return null;
  }
}

async function openStableSourceEditor(page: Page): Promise<void> {
  await waitForAppReady(page);
  await ensureEditorReady(page);
  await expect
    .poll(() => page.evaluate(() => window.__jotluck_e2e?.listNotePaths?.().length ?? 0), {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);
  const path = await page.evaluate(() => window.__jotluck_e2e?.listNotePaths?.()[0] ?? '');
  await page.evaluate((notePath) => window.__jotluck_e2e?.selectNote?.(notePath), path);
  await expect
    .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().activePath ?? ''), {
      timeout: 10_000,
    })
    .toBe(path);
  if (
    !(await page
      .locator('.split-left .cm-content')
      .isVisible()
      .catch(() => false))
  ) {
    await page.locator('.shell-action--view-toggle').click();
  }
  await expect(page.locator('.split-left .cm-content')).toBeVisible({ timeout: 10_000 });
}

function isMixedCandidate(text: string, language: 'zh' | 'en'): boolean {
  const hasCjk = /[\u3400-\u9fff]/u.test(text);
  const hasLatin = /[A-Za-z]/u.test(text);
  return (hasCjk && hasLatin) || (language === 'zh' ? hasLatin : hasCjk);
}

function rate(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 1_000_000) / 1_000_000 : 0;
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return Math.round((sorted[index] ?? 0) * 1_000) / 1_000;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
