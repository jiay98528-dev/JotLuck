import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import {
  AUTOCOMPLETE_MODEL_EVALUATOR_VERSION,
  createEvaluationVerdicts,
  isMixedCandidate,
  percentile,
  type AutocompleteModelEvaluation,
  type EvaluationLayerSummary,
} from './autocomplete-model-evaluator';
import type { FormalHoldout } from './train-baseline';
import { validateWorkspaceFinalV2, type WorkspaceFinalHoldout } from './workspace-final-holdout';

const require = createRequire(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT_RELATIVE_ROOT = 'scripts/frozen-v1-fb46b1e';

export const V1_FROZEN_IDENTITY = Object.freeze({
  adapterId: 'v1-frozen-fb46b1e',
  commit: 'fb46b1e',
  snapshotManifest: `${SNAPSHOT_RELATIVE_ROOT}/snapshot-manifest.json`,
  modelPath: `${SNAPSHOT_RELATIVE_ROOT}/model.compact.txt.gz`,
  modelSha256: '1ab73f76357dc1e383990103aead0908213c042443cd541b906f3814d53882f5',
  modelBytes: 5_978_321,
  countScale: 1,
  productionEligible: false,
  behaviorContract: 'markdown-predictor-provider-resolver@fb46b1e',
} as const);

interface SnapshotManifest {
  schemaVersion: 1;
  snapshotId: string;
  commit: string;
  productionEligible: false;
  runnerId: string;
  model: {
    path: string;
    compression: string;
    compressedBytes: number;
    compressedSha256: string;
    uncompressedBytes: number;
    uncompressedSha256: string;
  };
  sourceFiles: Array<{
    upstreamPath: string;
    snapshotPath: string;
    upstreamSha256: string;
    snapshotSha256: string;
    observationPatched: boolean;
  }>;
  observationPatchSha256: string;
  runnerSha256: string;
  tsconfigSha256: string;
  treeSha256: string;
}

interface FrozenRunnerCandidate {
  text: string;
  confidence: number;
  from: number;
  providerId: string;
  sourceLayer?: string;
  syntaxType: string;
}

interface FrozenRunnerCheckpoint {
  checkpointId: string;
  behavior: 'complete' | 'silence';
  expectedSuffix: string;
  language: 'zh' | 'en';
  l3LatencyMs: number;
  fullLatencyMs: number;
  l3Suggestion: string;
  l3ContextHit: boolean;
  l3Ranked: FrozenRunnerCandidate[];
  fullSuggestion: string;
  fullProvider: string;
  fullLayer: string;
  rankedCandidates: FrozenRunnerCandidate[];
}

interface FrozenRunnerOutput {
  schemaVersion: 1;
  runnerId: string;
  modelSha256: string;
  modelBytes: number;
  holdoutId: string;
  checkpoints: FrozenRunnerCheckpoint[];
}

interface FrozenRunnerHoldout extends Omit<FormalHoldout, 'cases'> {
  cases: Array<
    FormalHoldout['cases'][number] & {
      supportDocuments?: Array<{ id: string; path: string; text: string }>;
    }
  >;
}

export interface FrozenV1Snapshot {
  identity: typeof V1_FROZEN_IDENTITY;
  manifest: SnapshotManifest;
  serialized: string;
}

export interface V1V2Comparison {
  schemaVersion: 1;
  holdoutSha256: string;
  frozenV1TreeSha256: string;
  v1: ComparisonMetrics;
  v2: ComparisonMetrics;
  delta: {
    contextHitRate: number;
    top1Rate: number;
    oracleAt8Rate: number;
    usableRate: number;
    falseTriggerRate: number;
  };
}

export interface ComparisonMetrics {
  contextHitRate: number;
  top1Rate: number;
  oracleAt8Rate: number;
  usableRate: number;
  falseTriggerRate: number;
  mixedCandidates: number;
  allRequestP90Ms: number;
  visiblePredictionP90Ms: number;
  fallbackRate: number;
  timeoutRate: number;
  attribution: Record<string, number>;
}

export function loadFrozenV1Snapshot(repoRoot = REPOSITORY_ROOT): FrozenV1Snapshot {
  const snapshotRoot = path.resolve(repoRoot, SNAPSHOT_RELATIVE_ROOT);
  const manifestPath = path.join(snapshotRoot, 'snapshot-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as SnapshotManifest;
  assertSnapshotManifest(manifest, snapshotRoot);
  const compressed = fs.readFileSync(path.join(snapshotRoot, manifest.model.path));
  const serialized = gunzipSync(compressed).toString('utf8');
  assertFrozenV1Model(serialized);
  return { identity: V1_FROZEN_IDENTITY, manifest, serialized };
}

/** @deprecated Use loadFrozenV1Snapshot; kept for test consumers. */
export function loadFrozenV1Model(repoRoot = REPOSITORY_ROOT): FrozenV1Snapshot {
  return loadFrozenV1Snapshot(repoRoot);
}

export function assertFrozenV1Model(serialized: string): void {
  const bytes = Buffer.byteLength(serialized, 'utf8');
  const digest = sha256(serialized);
  if (bytes !== V1_FROZEN_IDENTITY.modelBytes || digest !== V1_FROZEN_IDENTITY.modelSha256) {
    throw new Error(
      `Frozen V1 model identity mismatch: bytes=${bytes}, sha256=${digest}. ` +
        'The comparison baseline must remain the exact fb46b1e model.',
    );
  }
}

export function assertFrozenV1ProductionIsolation(repoRoot = REPOSITORY_ROOT): void {
  const productionRoots = [
    path.resolve(repoRoot, 'packages/app/src'),
    path.resolve(repoRoot, 'packages/app/vite.config.ts'),
    path.resolve(repoRoot, 'packages/app/dist'),
  ];
  const forbidden =
    /frozen-v1-fb46b1e|v1-frozen-fb46b1e|autocomplete-v1-frozen-adapter|__JOTLUCK_FROZEN_V1_OBSERVER__|1ab73f76357dc1e383990103aead0908213c042443cd541b906f3814d53882f5/u;
  for (const root of productionRoots) {
    if (!fs.existsSync(root)) continue;
    const files = fs.statSync(root).isDirectory() ? listProductionFiles(root) : [root];
    for (const file of files) {
      if (forbidden.test(path.basename(file))) {
        throw new Error(`Production bundle contains an evaluation-only V1 asset: ${file}.`);
      }
      const text = fs.readFileSync(file, 'utf8');
      if (forbidden.test(text)) {
        throw new Error(
          `Production source or bundle contains the evaluation-only V1 snapshot: ${file}.`,
        );
      }
    }
  }
}

export async function evaluateFrozenV1(
  holdout: FormalHoldout,
  repoRoot = REPOSITORY_ROOT,
): Promise<AutocompleteModelEvaluation> {
  return evaluateFrozenV1Runner(holdout, holdout, repoRoot);
}

export async function evaluateFrozenV1Workspace(
  holdout: WorkspaceFinalHoldout,
  repoRoot = REPOSITORY_ROOT,
): Promise<AutocompleteModelEvaluation> {
  validateWorkspaceFinalV2(holdout);
  const supportById = new Map(holdout.supportDocuments.map((support) => [support.id, support]));
  const metricHoldout: FormalHoldout = {
    schemaVersion: 2,
    datasetId: holdout.datasetId,
    frozenAt: holdout.frozenAt,
    description: holdout.description,
    cases: holdout.targets.map((target) => ({
      id: target.id,
      language: target.language,
      category: target.category,
      text: target.text,
      checkpoints: target.checkpoints,
    })),
  };
  const runnerHoldout: FrozenRunnerHoldout = {
    ...metricHoldout,
    cases: holdout.targets.map((target) => ({
      id: target.id,
      language: target.language,
      category: target.category,
      text: target.text,
      checkpoints: target.checkpoints,
      supportDocuments: target.supportDocumentIds.map((supportId) => {
        const support = supportById.get(supportId);
        if (!support) throw new Error(`Frozen V1 workspace support is missing: ${supportId}.`);
        return { id: support.id, path: support.path, text: support.text };
      }),
    })),
  };
  return evaluateFrozenV1Runner(runnerHoldout, metricHoldout, repoRoot);
}

async function evaluateFrozenV1Runner(
  runnerHoldout: FrozenRunnerHoldout,
  metricHoldout: FormalHoldout,
  repoRoot: string,
): Promise<AutocompleteModelEvaluation> {
  const snapshot = loadFrozenV1Snapshot(repoRoot);
  assertFrozenV1ProductionIsolation(repoRoot);
  const snapshotRoot = path.resolve(repoRoot, SNAPSHOT_RELATIVE_ROOT);
  const tsxCli = require.resolve('tsx/cli');
  const result = spawnSync(
    process.execPath,
    [
      tsxCli,
      '--tsconfig',
      path.join(snapshotRoot, 'tsconfig.json'),
      path.join(snapshotRoot, 'runner.ts'),
    ],
    {
      cwd: path.resolve(repoRoot),
      encoding: 'utf8',
      input: JSON.stringify({ schemaVersion: 1, holdout: runnerHoldout }),
      maxBuffer: 32 * 1024 * 1024,
      timeout: 120_000,
      env: { ...process.env, NODE_ENV: 'test' },
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Frozen V1 runner failed (${result.status ?? 'signal'}): ${result.stderr || result.stdout}`,
    );
  }
  const output = JSON.parse(result.stdout) as FrozenRunnerOutput;
  if (
    output.schemaVersion !== 1 ||
    output.runnerId !== snapshot.manifest.runnerId ||
    output.modelSha256 !== V1_FROZEN_IDENTITY.modelSha256 ||
    output.modelBytes !== V1_FROZEN_IDENTITY.modelBytes ||
    output.holdoutId !== metricHoldout.datasetId
  ) {
    throw new Error('Frozen V1 runner returned a corrupted or mismatched response.');
  }
  return runnerOutputToEvaluation(output, metricHoldout);
}

export function compareV1V2(
  v1: AutocompleteModelEvaluation,
  v2: AutocompleteModelEvaluation,
  frozenV1TreeSha256 = loadFrozenV1Snapshot().manifest.treeSha256,
): V1V2Comparison {
  if (v1.holdout.sha256 !== v2.holdout.sha256) {
    throw new Error('V1/V2 comparison requires the exact same frozen holdout SHA-256.');
  }
  const v1Metrics = comparisonMetrics(v1);
  const v2Metrics = comparisonMetrics(v2);
  return {
    schemaVersion: 1,
    holdoutSha256: v1.holdout.sha256,
    frozenV1TreeSha256,
    v1: v1Metrics,
    v2: v2Metrics,
    delta: {
      contextHitRate: v2Metrics.contextHitRate - v1Metrics.contextHitRate,
      top1Rate: v2Metrics.top1Rate - v1Metrics.top1Rate,
      oracleAt8Rate: v2Metrics.oracleAt8Rate - v1Metrics.oracleAt8Rate,
      usableRate: v2Metrics.usableRate - v1Metrics.usableRate,
      falseTriggerRate: v2Metrics.falseTriggerRate - v1Metrics.falseTriggerRate,
    },
  };
}

function runnerOutputToEvaluation(
  output: FrozenRunnerOutput,
  holdout: FormalHoldout,
): AutocompleteModelEvaluation {
  const opportunities = output.checkpoints.length;
  const completeOpportunities = output.checkpoints.filter(
    (item) => item.behavior === 'complete',
  ).length;
  const silenceOpportunities = opportunities - completeOpportunities;
  const contextHits = output.checkpoints.filter((item) => item.l3ContextHit).length;
  const top1Hits = output.checkpoints.filter(
    (item) =>
      item.behavior === 'complete' &&
      isUsable(item.l3Suggestion, item.expectedSuffix, item.language),
  ).length;
  const top3Hits = output.checkpoints.filter(
    (item) =>
      item.behavior === 'complete' &&
      item.l3Ranked
        .slice(0, 3)
        .some((candidate) => isUsable(candidate.text, item.expectedSuffix, item.language)),
  ).length;
  const oracleAt8Hits = output.checkpoints.filter(
    (item) =>
      item.behavior === 'complete' &&
      item.l3Ranked
        .slice(0, 8)
        .some((candidate) => isUsable(candidate.text, item.expectedSuffix, item.language)),
  ).length;
  const l3Only = summarizeRunnerLayer(output.checkpoints, 'l3');
  const fullStack = summarizeRunnerLayer(output.checkpoints, 'full');
  const parse = {
    totalMs: 0,
    maxChunkMs: 0,
    chunks: 0,
    lines: 0,
    longTasksOver50Ms: 0,
  };
  return {
    schemaVersion: 2,
    evaluatorVersion: AUTOCOMPLETE_MODEL_EVALUATOR_VERSION,
    model: {
      sha256: output.modelSha256,
      bytes: output.modelBytes,
      characterEntries: 0,
      wordEntries: 0,
      countScale: 1,
      parse,
    },
    holdout: {
      datasetId: holdout.datasetId,
      sha256: sha256(canonicalJson(holdout)),
      documents: holdout.cases.length,
      opportunities,
      completeOpportunities,
      silenceOpportunities,
    },
    l3Raw: {
      contextHits,
      contextHitRate: rate(contextHits, opportunities),
      top1Hits,
      top1Rate: rate(top1Hits, completeOpportunities),
      top3Hits,
      top3Rate: rate(top3Hits, completeOpportunities),
      top8Hits: oracleAt8Hits,
      top8Rate: rate(oracleAt8Hits, completeOpportunities),
      oracleAt8Hits,
      oracleAt8Rate: rate(oracleAt8Hits, completeOpportunities),
    },
    l3Only,
    fullStack,
    verdicts: createEvaluationVerdicts(
      holdout,
      fullStack,
      parse,
      opportunities,
      completeOpportunities,
      silenceOpportunities,
    ),
    samples: output.checkpoints.map((item) => ({
      checkpointId: item.checkpointId,
      behavior: item.behavior,
      contextHit: item.l3ContextHit,
      rawTopK: item.l3Ranked.map((candidate) => candidate.text),
      l3Suggestion: item.l3Suggestion,
      fullStackSuggestion: item.fullSuggestion,
      ...(item.fullProvider ? { fullStackProvider: item.fullProvider } : {}),
      ...(item.fullLayer ? { fullStackLayer: item.fullLayer } : {}),
    })),
  };
}

function summarizeRunnerLayer(
  checkpoints: FrozenRunnerCheckpoint[],
  layer: 'l3' | 'full',
): EvaluationLayerSummary {
  const allLatencies = checkpoints.map((item) =>
    layer === 'l3' ? item.l3LatencyMs : item.fullLatencyMs,
  );
  const suggestions = checkpoints.map((item) =>
    layer === 'l3' ? item.l3Suggestion : item.fullSuggestion,
  );
  const triggers = suggestions.filter(Boolean).length;
  const usable = checkpoints.filter((item, index) => {
    const suggestion = suggestions[index] ?? '';
    return item.behavior === 'complete' && isUsable(suggestion, item.expectedSuffix, item.language);
  }).length;
  const silence = checkpoints.filter((item) => item.behavior === 'silence');
  const falseTriggers = silence.filter((item) => {
    const index = checkpoints.indexOf(item);
    return Boolean(suggestions[index]);
  }).length;
  const ranked = checkpoints.map((item) =>
    layer === 'l3' ? item.l3Ranked : item.rankedCandidates,
  );
  const mixedCandidates = ranked.reduce(
    (sum, candidates, index) =>
      sum +
      candidates
        .slice(0, 8)
        .filter((candidate) => isMixedCandidate(candidate.text, checkpoints[index]!.language))
        .length,
    0,
  );
  const visibleLatencies = allLatencies.filter((_, index) => Boolean(suggestions[index]));
  const attribution: Record<string, number> = {};
  let fallbackTriggers = 0;
  if (layer === 'full') {
    for (const item of checkpoints) {
      if (!item.fullSuggestion) continue;
      const key = `${item.fullProvider || 'unknown'}:${item.fullLayer || 'unknown'}`;
      attribution[key] = (attribution[key] ?? 0) + 1;
      if (item.fullLayer === 'fallback') fallbackTriggers++;
    }
  }
  const rawCandidates = ranked.reduce((sum, candidates) => sum + candidates.length, 0);
  return {
    triggers,
    triggerRate: rate(triggers, checkpoints.length),
    usable,
    usableRate: rate(usable, checkpoints.length),
    falseTriggers,
    falseTriggerRate: rate(falseTriggers, silence.length),
    unusableTriggers: triggers - usable,
    mixedCandidates,
    mixedOpportunities: ranked.filter((candidates, index) =>
      candidates.some((candidate) =>
        isMixedCandidate(candidate.text, checkpoints[index]!.language),
      ),
    ).length,
    p90Ms: percentile(visibleLatencies, 0.9),
    allRequestP90Ms: percentile(allLatencies, 0.9),
    visiblePredictionP90Ms: percentile(visibleLatencies, 0.9),
    fallbackRate: rate(fallbackTriggers, checkpoints.length),
    timeoutRate: 0,
    qualityGate: { evaluated: 0, rejected: 0, rejectionRate: 0, reasons: {} },
    resolver: {
      rawCandidates,
      normalizedCandidates: rawCandidates,
      deduplicatedCandidates: rawCandidates,
      rejected: 0,
      rejectionRate: 0,
      reasons: {},
    },
    attribution,
  };
}

function comparisonMetrics(result: AutocompleteModelEvaluation): ComparisonMetrics {
  return {
    contextHitRate: result.l3Raw.contextHitRate,
    top1Rate: result.l3Raw.top1Rate,
    oracleAt8Rate: result.l3Raw.oracleAt8Rate,
    usableRate: result.fullStack.usableRate,
    falseTriggerRate: result.fullStack.falseTriggerRate,
    mixedCandidates: result.fullStack.mixedCandidates,
    allRequestP90Ms: result.fullStack.allRequestP90Ms,
    visiblePredictionP90Ms: result.fullStack.visiblePredictionP90Ms,
    fallbackRate: result.fullStack.fallbackRate,
    timeoutRate: result.fullStack.timeoutRate,
    attribution: result.fullStack.attribution,
  };
}

function assertSnapshotManifest(manifest: SnapshotManifest, snapshotRoot: string): void {
  if (
    manifest.schemaVersion !== 1 ||
    manifest.snapshotId !== V1_FROZEN_IDENTITY.adapterId ||
    manifest.commit !== V1_FROZEN_IDENTITY.commit ||
    manifest.productionEligible !== false ||
    !Array.isArray(manifest.sourceFiles)
  ) {
    throw new Error('Frozen V1 snapshot manifest has an invalid identity.');
  }
  const modelPath = resolveWithin(snapshotRoot, manifest.model.path);
  const compressed = fs.readFileSync(modelPath);
  if (
    compressed.byteLength !== manifest.model.compressedBytes ||
    sha256(compressed) !== manifest.model.compressedSha256
  ) {
    throw new Error('Frozen V1 compressed model does not match its manifest.');
  }
  for (const file of manifest.sourceFiles) {
    const snapshotPath = resolveWithin(snapshotRoot, file.snapshotPath);
    if (sha256(fs.readFileSync(snapshotPath)) !== file.snapshotSha256) {
      throw new Error(`Frozen V1 source does not match its manifest: ${file.snapshotPath}.`);
    }
    if (!file.observationPatched && file.upstreamSha256 !== file.snapshotSha256) {
      throw new Error(`Frozen V1 source unexpectedly differs from fb46b1e: ${file.snapshotPath}.`);
    }
  }
  const runnerSha256 = sha256(fs.readFileSync(path.join(snapshotRoot, 'runner.ts')));
  const tsconfigSha256 = sha256(fs.readFileSync(path.join(snapshotRoot, 'tsconfig.json')));
  if (
    runnerSha256 !== manifest.runnerSha256 ||
    tsconfigSha256 !== manifest.tsconfigSha256 ||
    manifest.model.uncompressedSha256 !== V1_FROZEN_IDENTITY.modelSha256 ||
    manifest.model.uncompressedBytes !== V1_FROZEN_IDENTITY.modelBytes
  ) {
    throw new Error('Frozen V1 runner or model identity does not match its manifest.');
  }
  const { treeSha256, ...core } = manifest;
  if (sha256(canonicalJson(core)) !== treeSha256) {
    throw new Error('Frozen V1 aggregate tree SHA-256 is invalid.');
  }
}

function resolveWithin(root: string, relativePath: string): string {
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Frozen V1 path escapes the snapshot root: ${relativePath}.`);
  }
  return resolved;
}

function listProductionFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listProductionFiles(fullPath));
    else if (/\.(?:ts|tsx|vue|js|mjs|cjs|json|html|css|map|txt|gz)$/iu.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function isUsable(suggestion: string, expectedSuffix: string, language: 'zh' | 'en'): boolean {
  if (!suggestion) return false;
  return language === 'en'
    ? expectedSuffix.toLocaleLowerCase('en-US').startsWith(suggestion.toLocaleLowerCase('en-US'))
    : expectedSuffix.startsWith(suggestion);
}

function rate(value: number, total: number): number {
  return total > 0 ? value / total : 0;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.argv.includes('--check-production-isolation')) {
    loadFrozenV1Snapshot();
    assertFrozenV1ProductionIsolation();
    console.log('Frozen V1 snapshot integrity and production bundle isolation verified.');
  } else {
    console.error(
      'Usage: tsx scripts/autocomplete-v1-frozen-adapter.ts --check-production-isolation',
    );
    process.exitCode = 2;
  }
}
