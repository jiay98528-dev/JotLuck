import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { evaluateFrozenV1Workspace } from '../../scripts/autocomplete-v1-frozen-adapter';
import {
  loadAndValidateWorkspaceFinalV2,
  type WorkspaceFinalHoldout,
} from '../../scripts/workspace-final-holdout';
import { ensureEditorReady, waitForAppReady } from '../helpers/test-utils';

const REPOSITORY_ROOT = resolve('.');
const EVIDENCE_PATH = resolve(
  process.env.JOTLUCK_AUTOCOMPLETE_FINAL_RUNTIME_EVIDENCE ??
    'scripts/corpus/_web-cache/autocomplete-candidates/workspace-final-runtime-evidence.json',
);
const RUNTIME_TIER = process.env.JOTLUCK_AUTOCOMPLETE_RUNTIME_TIER;
if (!RUNTIME_TIER) {
  throw new Error('JOTLUCK_AUTOCOMPLETE_RUNTIME_TIER must identify the selected candidate.');
}
const EXPECTED_MODEL_SHA = process.env.JOTLUCK_AUTOCOMPLETE_EXPECTED_MODEL_SHA;
if (!/^[a-f0-9]{64}$/u.test(EXPECTED_MODEL_SHA ?? '')) {
  throw new Error('JOTLUCK_AUTOCOMPLETE_EXPECTED_MODEL_SHA must bind the selected candidate.');
}

interface LanguageMetrics {
  opportunities: number;
  completeOpportunities: number;
  top1Hits: number;
  usable: number;
  top1Rate: number;
  usableRate: number;
  v1Top1Rate: number;
  v1UsableRate: number;
}

interface TriggeredPrefix {
  content: string;
  cursorOffset: number;
  supports: Array<{ path: string; content: string }>;
}

test.describe(
  'autocomplete workspace final-v2 production runtime',
  {
    tag: '@autocomplete-rc',
  },
  () => {
    test.setTimeout(480_000);

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

    test('measures the frozen workspace final exactly once through the production router', async ({
      page,
    }) => {
      if (existsSync(EVIDENCE_PATH)) {
        throw new Error('Workspace final-v2 runtime evidence already exists and cannot be rerun.');
      }

      const { holdout, audit } = loadAndValidateWorkspaceFinalV2(REPOSITORY_ROOT);
      const frozenV1 = await evaluateFrozenV1Workspace(holdout, REPOSITORY_ROOT);
      await openStableSourceEditor(page);
      const supportById = new Map(
        holdout.supportDocuments.map((support) => [support.id, support] as const),
      );

      const checkpointFacts = new Map(
        holdout.targets.flatMap((target) =>
          target.checkpoints.map((checkpoint) => [checkpoint.id, { target, checkpoint }] as const),
        ),
      );
      const language = {
        zh: createLanguageMetrics(),
        en: createLanguageMetrics(),
      };
      const allRequestLatencies: number[] = [];
      const triggeredPrefixes: TriggeredPrefix[] = [];
      const attribution: Record<string, number> = {};
      const resolverRejectionReasons: Record<string, number> = {};
      const backendKinds: Record<string, number> = {};
      let requests = 0;
      let completeOpportunities = 0;
      let silenceOpportunities = 0;
      let triggers = 0;
      let usable = 0;
      let top1Hits = 0;
      let oracleAt8Hits = 0;
      let falseTriggers = 0;
      let mixedCandidateRequests = 0;
      let fallbacks = 0;
      let timeouts = 0;
      let warmingRequests = 0;
      let parseMaxChunkMs = 0;
      let parseLongTasksOver50Ms = 0;
      let modelSha256: string | null = null;
      let calibration: Awaited<ReturnType<typeof requestDiagnostics>> | null = null;

      for (const target of holdout.targets) {
        const targetSupports = target.supportDocumentIds.map((supportId) => {
          const support = supportById.get(supportId);
          if (!support) throw new Error(`Missing workspace support document: ${supportId}.`);
          return { path: support.path, content: support.text };
        });
        await page.evaluate(async (documents) => {
          await window.__jotluck_e2e?.editor?.seedWorkspaceDocuments?.(documents);
          window.__jotluck_e2e?.editor?.setCompletionAblationMode?.('full-stack');
        }, targetSupports);
        if (!calibration) {
          calibration = await requestDiagnostics(page, 'Project plan ', 0);
          expect(calibration.hybrid).toMatchObject({
            attempted: true,
            timedOut: true,
            fellBack: true,
          });
        }
        for (const checkpoint of target.checkpoints) {
          const prefix = target.text.slice(0, checkpoint.cursorOffset);
          const diagnostics = await requestDiagnostics(page, prefix, 110);
          const languageMetrics = language[target.language];
          requests++;
          languageMetrics.opportunities++;
          allRequestLatencies.push(diagnostics.elapsedMs);
          if (diagnostics.hybrid.fellBack || diagnostics.ranker.fellBack) fallbacks++;
          if (diagnostics.hybrid.timedOut) timeouts++;
          if (diagnostics.hybrid.health.status === 'warming') warmingRequests++;
          const backendKind = diagnostics.hybrid.health.backendKind;
          backendKinds[backendKind] = (backendKinds[backendKind] ?? 0) + 1;

          if (diagnostics.baselineModel) {
            modelSha256 ??= diagnostics.baselineModel.modelSha256;
            expect(diagnostics.baselineModel.modelSha256).toBe(modelSha256);
          }
          parseMaxChunkMs = Math.max(parseMaxChunkMs, diagnostics.baselineParse.maxChunkMs);
          parseLongTasksOver50Ms = Math.max(
            parseLongTasksOver50Ms,
            diagnostics.baselineParse.longTasksOver50Ms,
          );
          for (const [reason, count] of Object.entries(
            diagnostics.resolverTrace.rejectionReasons,
          )) {
            resolverRejectionReasons[reason] =
              (resolverRejectionReasons[reason] ?? 0) + (count ?? 0);
          }

          const candidates = diagnostics.rankedCandidates.slice(0, 8);
          if (candidates.some((candidate) => isMixedCandidate(candidate.text, target.language))) {
            mixedCandidateRequests++;
          }
          const suggestion = diagnostics.result?.text ?? '';
          if (suggestion) {
            triggers++;
            triggeredPrefixes.push({
              content: prefix,
              cursorOffset: prefix.length,
              supports: targetSupports,
            });
            const winner = diagnostics.result!;
            const key = `${winner.providerId}:${winner.sourceLayer ?? 'unknown'}`;
            attribution[key] = (attribution[key] ?? 0) + 1;
          }

          if (checkpoint.expectedBehavior === 'silence') {
            silenceOpportunities++;
            if (suggestion) falseTriggers++;
            continue;
          }
          completeOpportunities++;
          languageMetrics.completeOpportunities++;
          const top1Usable = isUsable(suggestion, checkpoint.expectedSuffix, target.language);
          if (top1Usable) {
            top1Hits++;
            usable++;
            languageMetrics.top1Hits++;
            languageMetrics.usable++;
          }
          if (
            candidates.some((candidate) =>
              isUsable(candidate.text, checkpoint.expectedSuffix, target.language),
            )
          ) {
            oracleAt8Hits++;
          }
        }
      }

      expect(modelSha256).not.toBeNull();
      if (!modelSha256) throw new Error('The exact selected candidate model was not loaded.');
      expect(modelSha256).toBe(EXPECTED_MODEL_SHA);
      applyFrozenV1LanguageMetrics(language, frozenV1, checkpointFacts);

      const visiblePredictionLatencies: number[] = [];
      for (const prefix of triggeredPrefixes) {
        await page.evaluate(
          async (documents) => window.__jotluck_e2e?.editor?.seedWorkspaceDocuments?.(documents),
          prefix.supports,
        );
        await page.evaluate(() => window.__jotluck_e2e?.editor?.setContent(''));
        await expect
          .poll(
            () =>
              page.evaluate(() =>
                window.__jotluck_e2e?.editor?.getVisiblePredictionDiagnostics?.(),
              ),
            { timeout: 500 },
          )
          .toBeNull();
        await page.evaluate(
          (content) => window.__jotluck_e2e?.editor?.setContent(content),
          prefix.content,
        );
        const visible = await expect
          .poll(
            () =>
              page.evaluate(() =>
                window.__jotluck_e2e?.editor?.getVisiblePredictionDiagnostics?.(),
              ),
            { timeout: 700 },
          )
          .toMatchObject({
            cursor: prefix.cursorOffset,
            documentLength: prefix.content.length,
          })
          .then(() =>
            page.evaluate(() => window.__jotluck_e2e?.editor?.getVisiblePredictionDiagnostics?.()),
          )
          .catch(() => null);
        if (visible) visiblePredictionLatencies.push(visible.elapsedMs);
      }

      expect(requests).toBe(200);
      expect(completeOpportunities).toBe(150);
      expect(silenceOpportunities).toBe(50);
      expect(visiblePredictionLatencies.length).toBeGreaterThan(0);
      if (!calibration) throw new Error('Hybrid deadline calibration did not run.');
      finalizeLanguageMetrics(language.zh);
      finalizeLanguageMetrics(language.en);

      const evidence = {
        schemaVersion: 1,
        classification: 'workspace-final-v2-runtime-evidence',
        stage: 'final',
        productionRouterObserved: true,
        runtimeTier: RUNTIME_TIER,
        modelSha256,
        finalHoldoutSha256: audit.datasetSha256,
        opportunities: requests,
        requestCount: requests,
        visibleSampleCount: visiblePredictionLatencies.length,
        supportDocumentCount: holdout.supportDocuments.length,
        triggerRate: rate(triggers, requests),
        usableRate: rate(usable, requests),
        falseTriggerRate: rate(falseTriggers, silenceOpportunities),
        mixedCandidateRate: rate(mixedCandidateRequests, requests),
        allRequestP90Ms: percentile(allRequestLatencies, 0.9),
        visiblePredictionP90Ms: percentile(visiblePredictionLatencies, 0.9),
        fallbackRate: rate(fallbacks, requests),
        timeoutRate: rate(timeouts, requests),
        warmingRate: rate(warmingRequests, requests),
        parseMaxChunkMs,
        parseLongTasksOver50Ms,
        oracleAt8Rate: rate(oracleAt8Hits, completeOpportunities),
        top1Rate: rate(top1Hits, completeOpportunities),
        v1: {
          modelSha256: frozenV1.model.sha256,
          top1Rate: (language.zh.v1Top1Rate + language.en.v1Top1Rate) / 2,
          usableRate: (language.zh.v1UsableRate + language.en.v1UsableRate) / 2,
          oracleAt8Rate: frozenV1.l3Raw.oracleAt8Rate,
        },
        language,
        attribution,
        resolverRejectionReasons,
        backendKinds,
        calibration: {
          hybridAttempted: calibration.hybrid.attempted,
          timedOut: calibration.hybrid.timedOut,
          fellBack: calibration.hybrid.fellBack,
        },
      };

      expect(evidence.mixedCandidateRate).toBe(0);
      mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
      writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
      console.log(JSON.stringify({ workspaceFinalRuntimeEvidence: evidence }, null, 2));
    });
  },
);

function applyFrozenV1LanguageMetrics(
  language: Record<'zh' | 'en', LanguageMetrics>,
  evaluation: Awaited<ReturnType<typeof evaluateFrozenV1Workspace>>,
  checkpointFacts: Map<
    string,
    {
      target: WorkspaceFinalHoldout['targets'][number];
      checkpoint: WorkspaceFinalHoldout['targets'][number]['checkpoints'][number];
    }
  >,
): void {
  const v1Hits = { zh: 0, en: 0 };
  for (const sample of evaluation.samples) {
    const facts = checkpointFacts.get(sample.checkpointId);
    if (!facts || facts.checkpoint.expectedBehavior !== 'complete') continue;
    if (
      isUsable(sample.fullStackSuggestion, facts.checkpoint.expectedSuffix, facts.target.language)
    ) {
      v1Hits[facts.target.language]++;
    }
  }
  for (const hint of ['zh', 'en'] as const) {
    language[hint].v1Top1Rate = rate(v1Hits[hint], language[hint].completeOpportunities);
    language[hint].v1UsableRate = rate(v1Hits[hint], language[hint].opportunities);
  }
}

function createLanguageMetrics(): LanguageMetrics {
  return {
    opportunities: 0,
    completeOpportunities: 0,
    top1Hits: 0,
    usable: 0,
    top1Rate: 0,
    usableRate: 0,
    v1Top1Rate: 0,
    v1UsableRate: 0,
  };
}

function finalizeLanguageMetrics(metrics: LanguageMetrics): void {
  metrics.top1Rate = rate(metrics.top1Hits, metrics.completeOpportunities);
  metrics.usableRate = rate(metrics.usable, metrics.opportunities);
}

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

function isUsable(suggestion: string, expectedSuffix: string, language: 'zh' | 'en'): boolean {
  if (!suggestion) return false;
  return language === 'en'
    ? expectedSuffix.toLocaleLowerCase('en-US').startsWith(suggestion.toLocaleLowerCase('en-US'))
    : expectedSuffix.startsWith(suggestion);
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
