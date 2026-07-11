import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertFrozenV1Model,
  assertFrozenV1ProductionIsolation,
  compareV1V2,
  evaluateFrozenV1,
  evaluateFrozenV1Workspace,
  loadFrozenV1Model,
  V1_FROZEN_IDENTITY,
} from '../autocomplete-v1-frozen-adapter';
import type { AutocompleteModelEvaluation } from '../autocomplete-model-evaluator';
import type { WorkspaceFinalHoldout } from '../workspace-final-holdout';

const testRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '.v1-production-isolation-test',
);

afterEach(() => rmSync(testRoot, { recursive: true, force: true }));

describe('V1 frozen evaluation adapter', () => {
  it('pins the golden commit and model SHA without entering the production bundle', () => {
    const model = loadFrozenV1Model();
    expect(model.identity).toEqual(V1_FROZEN_IDENTITY);
    expect(model.identity).toMatchObject({
      commit: 'fb46b1e',
      modelSha256: '1ab73f76357dc1e383990103aead0908213c042443cd541b906f3814d53882f5',
      productionEligible: false,
    });
    expect(model.manifest.treeSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(() => assertFrozenV1ProductionIsolation()).not.toThrow();
  });

  it('runs the old engine in an isolated process and preserves fb46b1e Top-1 goldens', async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const holdout = JSON.parse(
      readFileSync(path.join(root, 'scripts/corpus/formal-holdout.json'), 'utf8'),
    );
    const result = await evaluateFrozenV1(holdout, root);
    expect(result.samples).toHaveLength(200);
    expect(
      result.samples.find((sample) => sample.checkpointId === 'zh-reading-05-b'),
    ).toMatchObject({
      fullStackSuggestion: '下无缝切换文件访',
      fullStackProvider: 'ngram',
      fullStackLayer: 'l3',
    });
    expect(result.samples.find((sample) => sample.checkpointId === 'en-field-01-s')).toMatchObject({
      fullStackSuggestion: ' Unified',
      fullStackProvider: 'ngram',
    });
  });

  it('evaluates workspace supports in isolated per-target V1 state', async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const holdout = JSON.parse(
      readFileSync(path.join(root, 'scripts/corpus/workspace-conditioned-final-v2.json'), 'utf8'),
    ) as WorkspaceFinalHoldout;
    const result = await evaluateFrozenV1Workspace(holdout, root);
    expect(result.holdout).toMatchObject({ datasetId: holdout.datasetId, opportunities: 200 });
    expect(result.samples).toHaveLength(200);
    expect(result.model.sha256).toBe(V1_FROZEN_IDENTITY.modelSha256);
  });

  it('fails closed when model bytes do not match the frozen golden', () => {
    expect(() => assertFrozenV1Model('not-the-frozen-model')).toThrow(/identity mismatch/u);
  });

  it('scans built Vite chunks and rejects a bundled frozen evaluator', () => {
    const dist = path.join(testRoot, 'packages/app/dist/assets');
    mkdirSync(dist, { recursive: true });
    writeFileSync(path.join(dist, 'app.js'), 'const production = true;\n', 'utf8');
    expect(() => assertFrozenV1ProductionIsolation(testRoot)).not.toThrow();
    writeFileSync(path.join(dist, 'app.js'), 'const id = "v1-frozen-fb46b1e";\n', 'utf8');
    expect(() => assertFrozenV1ProductionIsolation(testRoot)).toThrow(/production.*bundle/iu);
  });

  it('refuses comparisons across different holdouts', () => {
    const base = evaluation('a', 0.1);
    expect(() => compareV1V2(base, evaluation('b', 0.2))).toThrow(/exact same frozen holdout/u);
  });

  it('reports same-holdout V2 deltas', () => {
    const comparison = compareV1V2(evaluation('same', 0.1), evaluation('same', 0.35));
    expect(comparison.delta).toMatchObject({ usableRate: 0.24999999999999997 });
  });
});

function evaluation(holdoutSha256: string, usableRate: number): AutocompleteModelEvaluation {
  return {
    schemaVersion: 2,
    evaluatorVersion: 'offline-completion-evaluator-v2',
    model: {
      sha256: 'model',
      bytes: 1,
      characterEntries: 1,
      wordEntries: 0,
      countScale: 1,
      parse: {
        totalMs: 0,
        maxChunkMs: 0,
        chunks: 1,
        lines: 1,
        longTasksOver50Ms: 0,
      },
    },
    holdout: {
      datasetId: 'unit',
      sha256: holdoutSha256,
      documents: 50,
      opportunities: 200,
      completeOpportunities: 150,
      silenceOpportunities: 50,
    },
    l3Raw: {
      contextHits: 1,
      contextHitRate: 0.1,
      top1Hits: 1,
      top1Rate: 0.1,
      top3Hits: 1,
      top3Rate: 0.1,
      top8Hits: 1,
      top8Rate: 0.2,
      oracleAt8Hits: 1,
      oracleAt8Rate: 0.2,
    },
    l3Only: layer(usableRate),
    fullStack: layer(usableRate),
    verdicts: {
      governance: { status: 'pass', reasons: [] },
      runtimeSafety: { status: 'pass', reasons: [] },
      modelQuality: { status: 'pass', reasons: [] },
    },
    samples: [],
  };
}

function layer(usableRate: number): AutocompleteModelEvaluation['fullStack'] {
  return {
    triggers: 1,
    triggerRate: 0.36,
    usable: 1,
    usableRate,
    falseTriggers: 0,
    falseTriggerRate: 0.01,
    unusableTriggers: 0,
    mixedCandidates: 0,
    mixedOpportunities: 0,
    p90Ms: 1,
    allRequestP90Ms: 1,
    visiblePredictionP90Ms: 1,
    fallbackRate: 0,
    timeoutRate: 0,
    qualityGate: { evaluated: 0, rejected: 0, rejectionRate: 0, reasons: {} },
    resolver: {
      rawCandidates: 0,
      normalizedCandidates: 0,
      deduplicatedCandidates: 0,
      rejected: 0,
      rejectionRate: 0,
      reasons: {},
    },
    attribution: {},
  };
}
