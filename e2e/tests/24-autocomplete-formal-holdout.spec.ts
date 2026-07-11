import { readFileSync } from 'node:fs';
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

const HOLDOUT = JSON.parse(
  readFileSync(new URL('../../scripts/corpus/formal-holdout.json', import.meta.url), 'utf8'),
) as FormalHoldout;

interface WorkspaceConditionedHoldout {
  schemaVersion: 1;
  datasetId: string;
  supportDocuments: Array<{ id: string; path: string; language: 'zh' | 'en'; text: string }>;
  targets: HoldoutCaseWithSupport[];
}

interface HoldoutCaseWithSupport extends HoldoutCase {
  supportDocumentIds: string[];
}

const WORKSPACE_HOLDOUT = JSON.parse(
  readFileSync(
    new URL('../../scripts/corpus/workspace-conditioned-holdout.json', import.meta.url),
    'utf8',
  ),
) as WorkspaceConditionedHoldout;

test.describe('autocomplete formal holdout', { tag: '@autocomplete-rc' }, () => {
  // Silence checkpoints intentionally wait past debounce + the 110ms Web
  // request deadline. The full 200+ checkpoint matrix needs a suite budget
  // larger than the per-request latency budget it is measuring.
  test.setTimeout(360000);

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const legacyLearningKeys = [
        'jotluck:autocomplete:learningSignals:v1',
        'jotluck:autocomplete:providerMetrics:v1',
        'jotluck:autocomplete:providerMetrics:v2',
        'jotluck:ngram:v2',
        'jotluck:ngram:short:v1',
        'jotluck:ngram:meta',
        'jotluck:autocomplete:acceptedLexicon:v1',
      ];
      for (const key of legacyLearningKeys) localStorage.removeItem(key);
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('jotluck:scope:')) localStorage.removeItem(key);
      }
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

  test('measures independent unseen checkpoints and blocks a degraded model', async ({ page }) => {
    expect(HOLDOUT.schemaVersion).toBe(2);
    expect(HOLDOUT.cases.length).toBeGreaterThanOrEqual(50);
    expect(new Set(HOLDOUT.cases.map((item) => item.category)).size).toBeGreaterThanOrEqual(4);

    const expectedOpportunities = HOLDOUT.cases.reduce(
      (sum, item) => sum + item.checkpoints.length,
      0,
    );
    const expectedSilence = HOLDOUT.cases.reduce(
      (sum, item) =>
        sum +
        item.checkpoints.filter((checkpoint) => checkpoint.expectedBehavior === 'silence').length,
      0,
    );
    expect(expectedOpportunities).toBeGreaterThanOrEqual(200);
    expect(expectedSilence / expectedOpportunities).toBeGreaterThanOrEqual(0.2);
    expect(HOLDOUT.cases.every((item) => item.checkpoints.length <= 5)).toBe(true);

    await openStableSourceEditor(page);
    await page.evaluate(() => {
      window.__jotluck_e2e?.editor?.setCompletionAblationMode?.('full-stack');
    });
    const persistedSettings = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('jotluck:autocomplete:settings') ?? '{}'),
    );
    expect(persistedSettings).toMatchObject({ enabled: true, backgroundTraining: false });

    let opportunities = 0;
    let triggers = 0;
    let usable = 0;
    let falseTriggers = 0;
    let unusableTriggers = 0;
    let mixedTriggers = 0;
    let silenceOpportunities = 0;
    let silenceTriggers = 0;
    const languageOpportunities = { zh: 0, en: 0 };
    const latencies: number[] = [];
    const allRequestLatencies: number[] = [];
    const samples: Array<{
      id: string;
      checkpointId: string;
      language: 'zh' | 'en';
      category: string;
      expectedBehavior: 'complete' | 'silence';
      suggestion: string;
      expectedSuffix: string;
      usable: boolean;
    }> = [];

    for (const item of HOLDOUT.cases) {
      for (const checkpoint of item.checkpoints) {
        expect(Number.isSafeInteger(checkpoint.cursorOffset), checkpoint.id).toBe(true);
        expect(checkpoint.cursorOffset, checkpoint.id).toBeGreaterThanOrEqual(0);
        expect(checkpoint.cursorOffset, checkpoint.id).toBeLessThanOrEqual(item.text.length);
        if (checkpoint.expectedBehavior === 'complete') {
          expect(checkpoint.expectedSuffix, checkpoint.id).not.toBe('');
          expect(
            item.text.slice(checkpoint.cursorOffset).startsWith(checkpoint.expectedSuffix),
            checkpoint.id,
          ).toBe(true);
        } else {
          expect(checkpoint.expectedSuffix, checkpoint.id).toBe('');
          silenceOpportunities++;
        }

        // Every opportunity starts from its own immutable prefix. No Tab/Escape
        // feedback is emitted, so one prediction cannot train or reject the next.
        const prefix = item.text.slice(0, checkpoint.cursorOffset);
        await replaceEditorText(page, prefix);
        opportunities++;
        languageOpportunities[item.language]++;

        const startedAt = Date.now();
        const suggestion = await readGhostText(page, 320);
        allRequestLatencies.push(Date.now() - startedAt);
        if (!suggestion) continue;

        triggers++;
        latencies.push(Date.now() - startedAt);
        if (
          (item.language === 'zh' && /[A-Za-z]/u.test(suggestion)) ||
          (item.language === 'en' && /[\u3400-\u9fff]/u.test(suggestion))
        ) {
          mixedTriggers++;
        }

        const isUsable =
          checkpoint.expectedBehavior === 'complete' &&
          checkpoint.expectedSuffix.startsWith(suggestion);
        if (isUsable) usable++;
        else unusableTriggers++;
        if (checkpoint.expectedBehavior === 'silence') {
          silenceTriggers++;
          falseTriggers++;
        }
        samples.push({
          id: item.id,
          checkpointId: checkpoint.id,
          language: item.language,
          category: item.category,
          expectedBehavior: checkpoint.expectedBehavior,
          suggestion,
          expectedSuffix: checkpoint.expectedSuffix,
          usable: isUsable,
        });
      }
    }

    expect(opportunities).toBe(expectedOpportunities);
    expect(opportunities).toBeGreaterThanOrEqual(200);
    expect(languageOpportunities.zh).toBeGreaterThanOrEqual(80);
    expect(languageOpportunities.en).toBeGreaterThanOrEqual(80);
    expect(silenceOpportunities).toBe(expectedSilence);

    const triggerRate = rate(triggers, opportunities);
    const usableRate = rate(usable, opportunities);
    const falseTriggerRate = rate(falseTriggers, silenceOpportunities);
    const mixedCandidateRate = rate(mixedTriggers, opportunities);
    const p90 = percentile(latencies, 0.9);
    // Silence requests include the polling timeout because the browser bridge
    // only exposes visible ghost text. The offline evaluator supplies exact
    // all-request timing for release evidence.
    const allRequestP90Diagnostic = percentile(allRequestLatencies, 0.9);
    const manifest = await page.evaluate(async () => {
      const response = await fetch('/baseline-ngram.web-local.compact.manifest.json');
      return (await response.json()) as {
        releaseEligible?: boolean;
        qualityGatePassed?: boolean;
      };
    });
    const qualityEligible =
      triggerRate >= 0.35 &&
      triggerRate <= 0.42 &&
      usableRate >= 0.35 &&
      usableRate <= 0.4 &&
      falseTriggerRate <= 0.03 &&
      mixedCandidateRate === 0 &&
      p90 <= 140;
    const resultClass = {
      governance: { status: 'pass' },
      runtimeSafety: {
        status:
          mixedCandidateRate === 0 && falseTriggerRate <= 0.03 && p90 <= 140 ? 'pass' : 'fail',
      },
      modelQuality: { status: qualityEligible ? 'pass' : 'fail' },
    };

    console.log(
      JSON.stringify(
        {
          formalHoldout: {
            datasetId: HOLDOUT.datasetId,
            cases: HOLDOUT.cases.length,
            opportunities,
            languageOpportunities,
            silenceOpportunities,
            silenceTriggers,
            triggers,
            usable,
            unusableTriggers,
            falseTriggers,
            mixedTriggers,
            triggerRate,
            usableRate,
            falseTriggerRate,
            mixedCandidateRate,
            p90,
            allRequestP90Diagnostic,
            allRequestTimingSource: 'polling-upper-bound-not-release-evidence',
            qualityEligible,
            resultClass,
            manifest,
            samples,
          },
        },
        null,
        2,
      ),
    );

    expect(mixedTriggers).toBe(0);
    expect(falseTriggerRate).toBeLessThanOrEqual(0.03);
    expect(p90).toBeLessThanOrEqual(140);
    if (!qualityEligible) {
      expect(manifest).toMatchObject({ releaseEligible: false, qualityGatePassed: false });
    }
  });

  test('reports workspace-conditioned quality without treating seeded diagnostics as release evidence', async ({
    page,
  }) => {
    const supportById = new Map(
      WORKSPACE_HOLDOUT.supportDocuments.map((document) => [document.id, document]),
    );
    expect(WORKSPACE_HOLDOUT.targets).toHaveLength(50);
    expect(WORKSPACE_HOLDOUT.targets.flatMap((item) => item.checkpoints)).toHaveLength(200);

    await openStableSourceEditor(page);
    await page.evaluate(
      async (documents) => {
        await window.__jotluck_e2e?.editor?.seedWorkspaceDocuments?.(documents);
        window.__jotluck_e2e?.editor?.setCompletionAblationMode?.('full-stack');
      },
      WORKSPACE_HOLDOUT.supportDocuments.map(({ path, text }) => ({ path, content: text })),
    );

    let opportunities = 0;
    let triggers = 0;
    let usable = 0;
    let falseTriggers = 0;
    let unusableTriggers = 0;
    let silenceOpportunities = 0;
    let mixedCandidates = 0;
    const allRequestLatencies: number[] = [];
    const visibleLatencies: number[] = [];
    for (const target of WORKSPACE_HOLDOUT.targets) {
      expect(new Set(target.supportDocumentIds).size, target.id).toBeGreaterThanOrEqual(2);
      const supports = target.supportDocumentIds.map((id) => supportById.get(id));
      expect(supports.every(Boolean), target.id).toBe(true);
      for (const checkpoint of target.checkpoints) {
        if (checkpoint.expectedBehavior === 'silence') silenceOpportunities++;
        const prefix = target.text.slice(0, checkpoint.cursorOffset);
        await replaceEditorText(page, prefix);
        const startedAt = Date.now();
        const suggestion = await readGhostText(page, 320);
        const latency = Date.now() - startedAt;
        allRequestLatencies.push(latency);
        opportunities++;
        if (!suggestion) continue;
        visibleLatencies.push(latency);
        triggers++;
        if (isMixedCandidate(suggestion, target.language)) mixedCandidates++;
        const accepted =
          checkpoint.expectedBehavior === 'complete' &&
          (target.language === 'en'
            ? checkpoint.expectedSuffix
                .toLocaleLowerCase('en-US')
                .startsWith(suggestion.toLocaleLowerCase('en-US'))
            : checkpoint.expectedSuffix.startsWith(suggestion));
        if (accepted) usable++;
        else unusableTriggers++;
        if (checkpoint.expectedBehavior === 'silence') falseTriggers++;
      }
    }

    const report = {
      classification: 'model-quality',
      releaseEvidence: false,
      datasetId: WORKSPACE_HOLDOUT.datasetId,
      opportunities,
      triggers,
      usable,
      falseTriggers,
      unusableTriggers,
      silenceOpportunities,
      mixedCandidates,
      triggerRate: rate(triggers, opportunities),
      usableRate: rate(usable, opportunities),
      falseTriggerRate: rate(falseTriggers, silenceOpportunities),
      allRequestP90Diagnostic: percentile(allRequestLatencies, 0.9),
      allRequestTimingSource: 'polling-upper-bound-not-release-evidence',
      visiblePredictionP90: percentile(visibleLatencies, 0.9),
    };
    console.log(JSON.stringify({ workspaceConditionedHoldout: report }, null, 2));

    expect(report.opportunities).toBe(200);
    expect(report.mixedCandidates).toBe(0);
    expect(report.visiblePredictionP90).toBeLessThanOrEqual(140);
  });
});

async function openStableSourceEditor(page: Page): Promise<void> {
  await waitForAppReady(page);
  await ensureEditorReady(page);
  await expect
    .poll(() => page.evaluate(() => window.__jotluck_e2e?.listNotePaths?.().length ?? 0), {
      timeout: 10000,
    })
    .toBeGreaterThan(0);
  const path = await page.evaluate(() => window.__jotluck_e2e?.listNotePaths?.()[0] ?? '');
  await page.evaluate((notePath) => window.__jotluck_e2e?.selectNote?.(notePath), path);
  await expect
    .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().activePath ?? ''), {
      timeout: 10000,
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
  await expect(page.locator('.split-left .cm-content')).toBeVisible({ timeout: 10000 });
}

async function replaceEditorText(page: Page, text: string): Promise<void> {
  const editor = page.locator('.split-left .cm-content');
  await editor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  if (text) await page.keyboard.type(text, { delay: 1 });
}

async function readGhostText(page: Page, timeout: number): Promise<string> {
  const ghost = page.locator('.cm-ghost-text');
  await expect(ghost)
    .toBeVisible({ timeout })
    .catch(() => undefined);
  if (!(await ghost.isVisible().catch(() => false))) return '';
  return (await ghost.textContent()) ?? '';
}

function rate(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 1000) / 1000 : 0;
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
}

function isMixedCandidate(text: string, language: 'zh' | 'en'): boolean {
  const hasCjk = /[\u3400-\u9fff]/u.test(text);
  const hasLatin = /[A-Za-z]/u.test(text);
  return (hasCjk && hasLatin) || (language === 'zh' ? hasLatin : hasCjk);
}
