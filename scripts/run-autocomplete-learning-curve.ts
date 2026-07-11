/**
 * Candidate-only, synthetic-only validation learning curve.
 *
 * Outputs are restricted to the ignored autocomplete candidate root. This
 * command never consumes the workspace final holdout and never publishes.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// Plain ESM keeps the RC verifier executable without a TypeScript loader.
// @ts-expect-error The release integrity module intentionally has no declaration output.
import { AUTOCOMPLETE_EVIDENCE_SOURCE_FILES } from './autocomplete-evidence-integrity.mjs';
import {
  AUTOCOMPLETE_MODEL_EVALUATOR_VERSION,
  evaluateAutocompleteModel,
} from './autocomplete-model-evaluator';
import {
  compareV1V2,
  evaluateFrozenV1,
  loadFrozenV1Snapshot,
  type V1V2Comparison,
} from './autocomplete-v1-frozen-adapter';
import {
  buildSyntheticCorpusReport,
  resolveGeneratedCorpusRoot,
  SYNTHETIC_GENERATOR_SEED,
  SYNTHETIC_GENERATOR_VERSION,
  SYNTHETIC_SOURCE_PLANS,
} from './generate-autocomplete-synthetic-corpus';
import {
  atomicReplaceFiles,
  buildVerifiedBaseline,
  hashSourcePath,
  type FormalHoldout,
  type TrainingBuild,
  type TrainingSelectionManifest,
} from './train-baseline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const CORPUS_ROOT = path.join(__dirname, 'corpus');
const VALIDATION_PATH = path.join(CORPUS_ROOT, 'formal-holdout.json');
export const LEARNING_CURVE_VERSION = 'autocomplete-learning-curve-v2';
export const PRODUCTION_ROUTER_RUNTIME_EVALUATOR_VERSION = 'production-router-runtime-v2';
export const LEARNING_CURVE_TIERS = [
  { id: '0.1mib', bytes: 104_858, completePool: false },
  { id: '0.5mib', bytes: 524_288, completePool: false },
  { id: '1mib', bytes: 1_048_576, completePool: false },
  { id: '3mib', bytes: 3_145_728, completePool: false },
  { id: '8mib', bytes: 8_388_608, completePool: false },
  { id: '16mib', bytes: 16_777_216, completePool: false },
  { id: '24mib-cap', bytes: 25_165_824, completePool: true },
] as const;
export const SYNTHETIC_LEARNING_CURVE_SOURCE_IDS = SYNTHETIC_SOURCE_PLANS.map(
  (source) => source.id,
).sort((left, right) => left.localeCompare(right, 'en'));
export const CANDIDATE_OUTPUT_ROOT =
  'scripts/corpus/_web-cache/autocomplete-candidates/learning-curve-v2';

export interface RuntimeTierEvidence {
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

export interface RuntimeEvidenceReport {
  schemaVersion: 2;
  classification: 'production-router-runtime-evidence';
  validationSha256: string;
  evaluatorVersion: string;
  tiers: Record<string, RuntimeTierEvidence>;
}

export interface LearningCurveTierEvidence {
  id: string;
  requestedBytes: number;
  realizedBytes: number;
  selectionManifestHash: string;
  selectionDocumentCount: number;
  selectionFragmentCount: number;
  modelSha256: string;
  modelBytes: number;
  trainingInputHash: string;
  sourceIds: string[];
  safetyGatePassed: boolean;
  hardLimitPassed: boolean;
  softTargetPassed: boolean;
  contextHitRate: number;
  top1Rate: number;
  oracleAt8Rate: number;
  triggerRate: number;
  usableRate: number;
  falseTriggerRate: number;
  mixedCandidateRate: number;
  deterministicRuntimeSafetyPassed: boolean;
  modelQualityPassed: boolean;
  runtimeMeasurementRequired: boolean;
  runtimeEvidencePassed: boolean;
  runtimeRequestCount: number | null;
  runtimeVisibleSampleCount: number | null;
  allRequestP90Ms: number | null;
  visiblePredictionP90Ms: number | null;
  fallbackRate: number | null;
  timeoutRate: number | null;
  parseMaxChunkMs: number | null;
  parseLongTasksOver50Ms: number | null;
  v1Comparison: V1V2Comparison;
  eligible: boolean;
  ineligibilityReasons: string[];
  candidateDirectory: string;
}

export interface LearningCurveReport {
  schemaVersion: 2;
  version: typeof LEARNING_CURVE_VERSION;
  stage: 'validation';
  generatedAt: '2026-07-11T00:00:00.000Z';
  generatorVersion: typeof SYNTHETIC_GENERATOR_VERSION;
  generatorSeed: typeof SYNTHETIC_GENERATOR_SEED;
  sourceIds: string[];
  generatedCorpusSha256: string;
  validationPath: 'scripts/corpus/formal-holdout.json';
  validationSha256: string;
  evaluatorVersion: typeof AUTOCOMPLETE_MODEL_EVALUATOR_VERSION;
  evaluatorTreeSha256: string;
  frozenV1TreeSha256: string;
  runtimeEvidenceSha256: string | null;
  runtimeEvidenceStatus: 'not-provided' | 'accepted' | 'rejected';
  runtimeEvidenceError: string | null;
  tiers: LearningCurveTierEvidence[];
  selectedTier: string | null;
  selectionReason: 'minimum-eligible-tier' | 'no-tier-passed-all-gates';
  releaseEligible: false;
  finalHoldoutConsumed: false;
  learningCurveSha256: string;
}

interface CompletedTier {
  tier: (typeof LEARNING_CURVE_TIERS)[number];
  build: TrainingBuild;
  evaluation: Awaited<ReturnType<typeof evaluateAutocompleteModel>>;
  comparison: V1V2Comparison;
  runtime: RuntimeTierEvidence | null;
  evidence: LearningCurveTierEvidence;
}

export function assertSyntheticOnlySourceSet(sourceIds: readonly string[]): void {
  const actual = [...sourceIds].sort((left, right) => left.localeCompare(right, 'en'));
  if (
    actual.length !== SYNTHETIC_LEARNING_CURVE_SOURCE_IDS.length ||
    actual.some((sourceId, index) => sourceId !== SYNTHETIC_LEARNING_CURVE_SOURCE_IDS[index])
  ) {
    throw new Error(
      `Learning curve must use only the five registered synthetic sources; received ${actual.join(', ')}.`,
    );
  }
}

export function assertNestedSelectionManifests(
  manifests: readonly TrainingSelectionManifest[],
): void {
  if (manifests.length !== LEARNING_CURVE_TIERS.length) {
    throw new Error('Learning curve must contain every fixed byte tier.');
  }
  for (let index = 0; index < manifests.length; index++) {
    const current = manifests[index]!;
    if (current.schemaVersion !== 1 || current.fragments.length === 0) {
      throw new Error(`Learning curve tier ${index} has an invalid selection manifest.`);
    }
    if (index === 0) continue;
    const previous = manifests[index - 1]!;
    if (current.fragments.length <= previous.fragments.length) {
      throw new Error('Each larger learning-curve tier must add at least one training fragment.');
    }
    for (let memberIndex = 0; memberIndex < previous.fragments.length; memberIndex++) {
      const previousMember = previous.fragments[memberIndex]!;
      const currentMember = current.fragments[memberIndex]!;
      if (
        currentMember.idSha256 !== previousMember.idSha256 ||
        currentMember.contentSha256 !== previousMember.contentSha256
      ) {
        throw new Error('Learning-curve fragment members are not a strict nested ordered prefix.');
      }
    }
    const currentDocuments = new Map(
      current.documents.map((item) => [item.id, item.contentSha256] as const),
    );
    for (const member of previous.documents) {
      if (currentDocuments.get(member.id) !== member.contentSha256) {
        throw new Error('Learning-curve document identities are not nested or changed content.');
      }
    }
  }
}

/** Compatibility assertion used by older tests; hashes alone are not release evidence. */
export function assertNestedLearningCurve(
  tiers: readonly Pick<
    LearningCurveTierEvidence,
    'requestedBytes' | 'realizedBytes' | 'selectionManifestHash'
  >[],
): void {
  if (tiers.length !== LEARNING_CURVE_TIERS.length) {
    throw new Error('Learning curve must contain every fixed byte tier.');
  }
  tiers.forEach((tier, index) => {
    const expected = LEARNING_CURVE_TIERS[index]!;
    if (tier.requestedBytes !== expected.bytes || tier.realizedBytes > expected.bytes) {
      throw new Error(`Learning curve tier ${expected.id} has invalid byte accounting.`);
    }
    if (!/^[0-9a-f]{64}$/u.test(tier.selectionManifestHash)) {
      throw new Error(`Learning curve tier ${expected.id} has no selection manifest hash.`);
    }
    if (index > 0 && tier.realizedBytes < tiers[index - 1]!.realizedBytes) {
      throw new Error('Learning curve realized bytes must be monotonic.');
    }
  });
}

export function selectMinimumEligibleTier(
  tiers: readonly Pick<LearningCurveTierEvidence, 'id' | 'eligible' | 'requestedBytes'>[],
): string | null {
  return (
    [...tiers]
      .sort((left, right) => left.requestedBytes - right.requestedBytes)
      .find((tier) => tier.eligible)?.id ?? null
  );
}

export async function runAutocompleteLearningCurve(
  argv: string[] = process.argv.slice(2),
): Promise<LearningCurveReport> {
  const dryRun = argv.includes('--dry-run');
  const runtimeEvidencePath = readArg(argv, '--runtime-evidence');
  for (const item of argv) {
    if (
      item !== '--dry-run' &&
      item !== '--runtime-evidence' &&
      !item.startsWith('--runtime-evidence=') &&
      item !== runtimeEvidencePath
    ) {
      throw new Error(`Unsupported learning-curve option: ${item}`);
    }
  }

  assertSyntheticOnlySourceSet(SYNTHETIC_LEARNING_CURVE_SOURCE_IDS);
  const generatedRoot = resolveGeneratedCorpusRoot(REPOSITORY_ROOT);
  verifyGeneratedCorpus(generatedRoot);
  const validation = readJson<FormalHoldout>(VALIDATION_PATH);
  const validationSha256 = sha256(canonicalJson(validation));
  let runtimeReport: RuntimeEvidenceReport | null = null;
  let runtimeEvidenceSha256: string | null = null;
  let runtimeEvidenceStatus: LearningCurveReport['runtimeEvidenceStatus'] = 'not-provided';
  let runtimeEvidenceError: string | null = null;
  if (runtimeEvidencePath) {
    try {
      runtimeReport = readRuntimeEvidence(
        runtimeEvidencePath,
        validationSha256,
        countHoldoutOpportunities(validation),
      );
      // Bind the normalized report bytes that are copied into every candidate,
      // not the caller's incidental whitespace representation.
      runtimeEvidenceSha256 = sha256(`${JSON.stringify(runtimeReport, null, 2)}\n`);
      runtimeEvidenceStatus = 'accepted';
    } catch (error) {
      runtimeEvidenceStatus = 'rejected';
      runtimeEvidenceError = error instanceof Error ? error.message : String(error);
    }
  }
  const frozenV1 = loadFrozenV1Snapshot(REPOSITORY_ROOT);
  const v1Evaluation = await evaluateFrozenV1(validation, REPOSITORY_ROOT);
  const completed: CompletedTier[] = [];

  for (const tier of LEARNING_CURVE_TIERS) {
    const build = buildVerifiedBaseline({
      profile: 'web-local',
      dryRun: true,
      allowVerifiedDegraded: true,
      sourceIds: SYNTHETIC_LEARNING_CURVE_SOURCE_IDS,
      ...(tier.completePool ? {} : { trainingPoolBytes: tier.bytes }),
    });
    assertSyntheticOnlyBuild(build, generatedRoot);
    if (
      !build.report.governance.safetyGatePassed ||
      !build.report.governance.hardLimitPassed ||
      !build.report.governance.softTargetPassed ||
      (!tier.completePool && build.report.trainingSlice.insufficient) ||
      build.report.trainingSlice.realizedBytes > tier.bytes
    ) {
      throw new Error(
        `Learning curve tier ${tier.id} failed governance: ${build.report.governance.errors.join('; ')}`,
      );
    }
    const evaluation = await evaluateAutocompleteModel({
      serialized: build.serialized,
      countScale: build.manifest.countScale,
      holdout: validation,
    });
    const comparison = compareV1V2(v1Evaluation, evaluation, frozenV1.manifest.treeSha256);
    const runtime = runtimeReport?.tiers[tier.id] ?? null;
    const evidence = buildTierEvidence(tier, build, evaluation, comparison, runtime);
    completed.push({ tier, build, evaluation, comparison, runtime, evidence });
  }

  assertNestedSelectionManifests(completed.map((item) => item.build.selectionManifest));
  assertNestedLearningCurve(completed.map((item) => item.evidence));
  const selectedTier = selectMinimumEligibleTier(completed.map((item) => item.evidence));
  const generatedReport = buildSyntheticCorpusReport();
  const evaluatorTreeSha256 = hashFileTree(AUTOCOMPLETE_EVIDENCE_SOURCE_FILES);
  const reportCore = {
    schemaVersion: 2 as const,
    version: LEARNING_CURVE_VERSION as typeof LEARNING_CURVE_VERSION,
    stage: 'validation' as const,
    generatedAt: '2026-07-11T00:00:00.000Z' as const,
    generatorVersion: SYNTHETIC_GENERATOR_VERSION,
    generatorSeed: SYNTHETIC_GENERATOR_SEED,
    sourceIds: [...SYNTHETIC_LEARNING_CURVE_SOURCE_IDS],
    generatedCorpusSha256: generatedReport.corpusSha256,
    validationPath: 'scripts/corpus/formal-holdout.json' as const,
    validationSha256,
    evaluatorVersion: AUTOCOMPLETE_MODEL_EVALUATOR_VERSION,
    evaluatorTreeSha256,
    frozenV1TreeSha256: frozenV1.manifest.treeSha256,
    runtimeEvidenceSha256,
    runtimeEvidenceStatus,
    runtimeEvidenceError,
    tiers: completed.map((item) => item.evidence),
    selectedTier,
    selectionReason: selectedTier
      ? ('minimum-eligible-tier' as const)
      : ('no-tier-passed-all-gates' as const),
    releaseEligible: false as const,
    finalHoldoutConsumed: false as const,
  };
  const learningCurveSha256 = sha256(canonicalJson(reportCore));
  const report: LearningCurveReport = { ...reportCore, learningCurveSha256 };

  if (!dryRun) writeCandidateEvidence(report, completed, runtimeReport);
  console.log(JSON.stringify(report, null, 2));
  return report;
}

function buildTierEvidence(
  tier: (typeof LEARNING_CURVE_TIERS)[number],
  build: TrainingBuild,
  evaluation: Awaited<ReturnType<typeof evaluateAutocompleteModel>>,
  comparison: V1V2Comparison,
  runtime: RuntimeTierEvidence | null,
): LearningCurveTierEvidence {
  const mixedCandidateRate =
    evaluation.fullStack.triggers > 0
      ? evaluation.fullStack.mixedCandidates / evaluation.fullStack.triggers
      : 0;
  const runtimeEvidencePassed = Boolean(
    runtime &&
    validateRuntimeTierEvidence(runtime, build.report.modelSha256) === null &&
    runtime.allRequestP90Ms <= 140 &&
    runtime.visiblePredictionP90Ms <= 140 &&
    runtime.mixedCandidateRate === 0 &&
    runtime.parseMaxChunkMs <= 50 &&
    runtime.parseLongTasksOver50Ms === 0,
  );
  const deterministicReasons: string[] = [];
  if (!build.report.governance.safetyGatePassed) deterministicReasons.push('training-governance');
  if (!build.report.governance.hardLimitPassed) deterministicReasons.push('model-hard-limit');
  if (!build.report.governance.softTargetPassed) deterministicReasons.push('model-soft-target');
  if (evaluation.verdicts.modelQuality.status !== 'pass') {
    deterministicReasons.push('absolute-quality-gates');
  }
  if (evaluation.verdicts.runtimeSafety.status !== 'pass') {
    deterministicReasons.push('deterministic-runtime-safety');
  }
  if (comparison.delta.top1Rate < 0) deterministicReasons.push('top1-below-v1');
  if (comparison.delta.usableRate < 0) deterministicReasons.push('usable-below-v1');
  if (comparison.v2.mixedCandidates > comparison.v1.mixedCandidates) {
    deterministicReasons.push('mixed-safety-regression');
  }
  const runtimeMeasurementRequired = deterministicReasons.length === 0;
  const reasons = [...deterministicReasons];
  if (!runtimeEvidencePassed) reasons.push('production-router-runtime-evidence');
  return {
    id: tier.id,
    requestedBytes: tier.bytes,
    realizedBytes: build.report.trainingSlice.realizedBytes,
    selectionManifestHash: build.report.trainingSlice.selectionManifestHash,
    selectionDocumentCount: build.selectionManifest.documents.length,
    selectionFragmentCount: build.selectionManifest.fragments.length,
    modelSha256: build.report.modelSha256,
    modelBytes: build.report.modelBytes,
    trainingInputHash: build.report.inputManifestHash,
    sourceIds: build.report.sourceInputs.map((source) => source.id).sort(),
    safetyGatePassed: build.report.governance.safetyGatePassed,
    hardLimitPassed: build.report.governance.hardLimitPassed,
    softTargetPassed: build.report.governance.softTargetPassed,
    contextHitRate: evaluation.l3Raw.contextHitRate,
    top1Rate: evaluation.l3Raw.top1Rate,
    oracleAt8Rate: evaluation.l3Raw.oracleAt8Rate,
    triggerRate: evaluation.fullStack.triggerRate,
    usableRate: evaluation.fullStack.usableRate,
    falseTriggerRate: evaluation.fullStack.falseTriggerRate,
    mixedCandidateRate,
    deterministicRuntimeSafetyPassed: evaluation.verdicts.runtimeSafety.status === 'pass',
    modelQualityPassed: evaluation.verdicts.modelQuality.status === 'pass',
    runtimeMeasurementRequired,
    runtimeEvidencePassed,
    runtimeRequestCount: runtime?.requestCount ?? null,
    runtimeVisibleSampleCount: runtime?.visibleSampleCount ?? null,
    allRequestP90Ms: runtime?.allRequestP90Ms ?? null,
    visiblePredictionP90Ms: runtime?.visiblePredictionP90Ms ?? null,
    fallbackRate: runtime?.fallbackRate ?? null,
    timeoutRate: runtime?.timeoutRate ?? null,
    parseMaxChunkMs: runtime?.parseMaxChunkMs ?? null,
    parseLongTasksOver50Ms: runtime?.parseLongTasksOver50Ms ?? null,
    v1Comparison: comparison,
    eligible: reasons.length === 0,
    ineligibilityReasons: reasons,
    candidateDirectory: `${CANDIDATE_OUTPUT_ROOT}/${tier.id}`,
  };
}

function verifyGeneratedCorpus(generatedRoot: string): void {
  const expected = buildSyntheticCorpusReport();
  const metadataPath = path.join(generatedRoot, '_metadata.json');
  if (!fs.existsSync(metadataPath)) {
    throw new Error(
      'Approved synthetic corpus is missing. Run generate-autocomplete-synthetic-corpus first.',
    );
  }
  const metadata = readJson<Record<string, unknown>>(metadataPath);
  if (
    metadata.generatorVersion !== expected.generatorVersion ||
    metadata.seed !== expected.seed ||
    metadata.totalCanonicalBytes !== expected.totalCanonicalBytes ||
    metadata.totalLogicalDocuments !== expected.totalLogicalDocuments
  ) {
    throw new Error('Generated synthetic corpus metadata does not match the registered generator.');
  }
  for (const source of expected.sources) {
    const sourceRoot = path.join(generatedRoot, source.relativeDirectory);
    if (!fs.existsSync(sourceRoot) || hashSourcePath(sourceRoot) !== source.contentSha256) {
      throw new Error(`Generated synthetic source hash mismatch: ${source.id}.`);
    }
  }
}

function assertSyntheticOnlyBuild(build: TrainingBuild, generatedRoot: string): void {
  assertSyntheticOnlySourceSet(build.report.sourceInputs.map((source) => source.id));
  const realGeneratedRoot = fs.realpathSync(generatedRoot);
  for (const source of build.report.sourceInputs) {
    const sourcePath = fs.realpathSync(path.resolve(CORPUS_ROOT, source.path));
    const relative = path.relative(realGeneratedRoot, sourcePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Learning curve source escapes the generated synthetic root: ${source.id}.`);
    }
    if (source.cleanerVersion !== SYNTHETIC_GENERATOR_VERSION) {
      throw new Error(`Learning curve source has a different generator version: ${source.id}.`);
    }
  }
}

function writeCandidateEvidence(
  report: LearningCurveReport,
  completed: CompletedTier[],
  runtimeReport: RuntimeEvidenceReport | null,
): void {
  const candidateRoot = path.resolve(REPOSITORY_ROOT, CANDIDATE_OUTPUT_ROOT);
  const allowedRoot = path.resolve(
    REPOSITORY_ROOT,
    'scripts/corpus/_web-cache/autocomplete-candidates',
  );
  if (!isWithin(candidateRoot, allowedRoot)) {
    throw new Error('Learning-curve candidates must stay inside the ignored candidate root.');
  }
  const reportText = `${JSON.stringify(report, null, 2)}\n`;
  const reportFileSha256 = sha256(reportText);
  const evaluatorIdentity = {
    schemaVersion: 1,
    files: AUTOCOMPLETE_EVIDENCE_SOURCE_FILES.map((file) => ({
      path: file,
      sha256: sha256(fs.readFileSync(path.resolve(REPOSITORY_ROOT, file))),
    })),
    treeSha256: report.evaluatorTreeSha256,
  };
  const evaluatorIdentityText = `${JSON.stringify(evaluatorIdentity, null, 2)}\n`;
  const writes: Array<{ target: string; content: string }> = [];
  for (const item of completed) {
    const tierRoot = path.join(candidateRoot, item.tier.id);
    const selectionText = `${JSON.stringify(item.build.selectionManifest, null, 2)}\n`;
    const comparisonText = `${JSON.stringify(item.comparison, null, 2)}\n`;
    const qualityEvidence = {
      schemaVersion: 2,
      classification: 'deterministic-model-quality-evidence',
      stage: 'validation',
      profile: 'web-local',
      modelSha256: item.build.report.modelSha256,
      trainingInputHash: item.build.report.inputManifestHash,
      validationSha256: report.validationSha256,
      evaluatorVersion: report.evaluatorVersion,
      evaluatorTreeSha256: report.evaluatorTreeSha256,
      frozenV1TreeSha256: report.frozenV1TreeSha256,
      comparison: item.comparison,
      evaluation: item.evaluation,
      releaseEligible: false,
    };
    const qualityText = `${JSON.stringify(qualityEvidence, null, 2)}\n`;
    // Bind the complete report rather than an untyped tier fragment so the RC
    // verifier can re-check validation identity, evaluator identity and the
    // selected tier in one place.
    const runtimeText = `${JSON.stringify(runtimeReport, null, 2)}\n`;
    const binding = (relativePath: string, content: string) => ({
      path: `${CANDIDATE_OUTPUT_ROOT}/${item.tier.id}/${relativePath}`,
      sha256: sha256(content),
    });
    const evidenceBindings = {
      schemaVersion: 2,
      model: binding('model.compact.txt', item.build.serialized),
      trainingInput: binding('selection-manifest.json', selectionText),
      validation: {
        path: report.validationPath,
        sha256: sha256(fs.readFileSync(VALIDATION_PATH)),
      },
      evaluatorTree: {
        path: `${CANDIDATE_OUTPUT_ROOT}/evaluator-identity.json`,
        sha256: sha256(evaluatorIdentityText),
      },
      frozenV1: {
        path: V1_MANIFEST_PATH,
        sha256: sha256(fs.readFileSync(path.resolve(REPOSITORY_ROOT, V1_MANIFEST_PATH))),
      },
      qualityReport: binding('quality-evidence.json', qualityText),
      runtimeReport: binding('runtime-evidence.json', runtimeText),
      comparison: binding('v1-v2-comparison.json', comparisonText),
      learningCurve: {
        path: `${CANDIDATE_OUTPUT_ROOT}/learning-curve-report.json`,
        sha256: reportFileSha256,
      },
      final: null,
    };
    const manifest = {
      ...item.build.manifest,
      runtimeEligible: false,
      qualityGatePassed: false,
      releaseEligible: false,
      degradedReason: 'candidate-validation-only',
      holdoutSha256: report.validationSha256,
      evaluatorVersion: report.evaluatorVersion,
      evaluatorSha256: report.evaluatorTreeSha256,
      qualityEvidenceSha256: sha256(qualityText),
      learningCurveSha256: report.learningCurveSha256,
      evidenceBindings,
    };
    writes.push(
      { target: path.join(tierRoot, 'model.compact.txt'), content: item.build.serialized },
      { target: path.join(tierRoot, 'selection-manifest.json'), content: selectionText },
      { target: path.join(tierRoot, 'quality-evidence.json'), content: qualityText },
      { target: path.join(tierRoot, 'runtime-evidence.json'), content: runtimeText },
      { target: path.join(tierRoot, 'v1-v2-comparison.json'), content: comparisonText },
      {
        target: path.join(tierRoot, 'manifest.json'),
        content: `${JSON.stringify(manifest, null, 2)}\n`,
      },
    );
  }
  writes.push(
    { target: path.join(candidateRoot, 'learning-curve-report.json'), content: reportText },
    { target: path.join(candidateRoot, 'evaluator-identity.json'), content: evaluatorIdentityText },
    {
      target: path.join(candidateRoot, 'runtime-evidence-source.json'),
      content: `${JSON.stringify(runtimeReport, null, 2)}\n`,
    },
  );
  atomicReplaceFiles(writes);
}

const V1_MANIFEST_PATH = 'scripts/frozen-v1-fb46b1e/snapshot-manifest.json';

function readRuntimeEvidence(
  value: string,
  validationSha256: string,
  expectedRequestCount: number,
): RuntimeEvidenceReport {
  const resolved = resolveWorkspaceEvidence(value);
  const report = readJson<RuntimeEvidenceReport>(resolved);
  const identityError = validateRuntimeEvidenceReportIdentity(report, validationSha256);
  if (identityError) throw new Error(identityError);
  for (const [tierId, evidence] of Object.entries(report.tiers)) {
    const error = validateRuntimeTierEvidence(evidence, undefined, expectedRequestCount);
    if (error) throw new Error(`Runtime evidence tier ${tierId} is invalid: ${error}`);
  }
  return report;
}

export function validateRuntimeEvidenceReportIdentity(
  report: RuntimeEvidenceReport,
  validationSha256: string,
): string | null {
  if (
    report?.schemaVersion !== 2 ||
    report.classification !== 'production-router-runtime-evidence' ||
    report.validationSha256 !== validationSha256 ||
    report.evaluatorVersion !== PRODUCTION_ROUTER_RUNTIME_EVALUATOR_VERSION ||
    !report.tiers ||
    typeof report.tiers !== 'object'
  ) {
    return (
      'Runtime evidence must be bound to the validation holdout and exact ' +
      `${PRODUCTION_ROUTER_RUNTIME_EVALUATOR_VERSION} evaluator.`
    );
  }
  return null;
}

export function validateRuntimeTierEvidence(
  evidence: RuntimeTierEvidence,
  expectedModelSha256?: string,
  expectedRequestCount?: number,
): string | null {
  if (!evidence || typeof evidence !== 'object') return 'missing tier evidence';
  if (!/^[a-f0-9]{64}$/u.test(evidence.modelSha256)) return 'invalid model SHA';
  if (expectedModelSha256 && evidence.modelSha256 !== expectedModelSha256) {
    return 'model SHA mismatch';
  }
  if (!Number.isSafeInteger(evidence.requestCount) || evidence.requestCount <= 0) {
    return 'requestCount must be a positive integer';
  }
  if (expectedRequestCount !== undefined && evidence.requestCount !== expectedRequestCount) {
    return `requestCount must equal validation opportunities (${expectedRequestCount})`;
  }
  if (
    !Number.isSafeInteger(evidence.visibleSampleCount) ||
    evidence.visibleSampleCount <= 0 ||
    evidence.visibleSampleCount > evidence.requestCount
  ) {
    return 'visibleSampleCount must be between 1 and requestCount';
  }
  const timings = [
    evidence.allRequestP90Ms,
    evidence.visiblePredictionP90Ms,
    evidence.parseMaxChunkMs,
  ];
  if (!timings.every((value) => Number.isFinite(value) && value >= 0)) {
    return 'runtime timings must be finite non-negative numbers';
  }
  const rates = [evidence.fallbackRate, evidence.timeoutRate, evidence.mixedCandidateRate];
  if (!rates.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
    return 'runtime rates must be finite values between 0 and 1';
  }
  if (
    !Number.isSafeInteger(evidence.parseLongTasksOver50Ms) ||
    evidence.parseLongTasksOver50Ms < 0
  ) {
    return 'parseLongTasksOver50Ms must be a non-negative integer';
  }
  if (evidence.productionRouterObserved !== true) return 'production Router was not observed';
  return null;
}

function countHoldoutOpportunities(holdout: FormalHoldout): number {
  return holdout.cases.reduce((total, item) => total + item.checkpoints.length, 0);
}

function resolveWorkspaceEvidence(value: string): string {
  const resolved = path.resolve(REPOSITORY_ROOT, value);
  if (!isWithin(resolved, REPOSITORY_ROOT) || !fs.existsSync(resolved)) {
    throw new Error('Runtime evidence must be an existing workspace file.');
  }
  return resolved;
}

function hashFileTree(files: readonly string[]): string {
  return sha256(
    canonicalJson(
      files.map((file) => ({
        path: file,
        sha256: sha256(fs.readFileSync(path.resolve(REPOSITORY_ROOT, file))),
      })),
    ),
  );
}

function readArg(argv: string[], name: string): string | undefined {
  const inline = argv.find((item) => item.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
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

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runAutocompleteLearningCurve().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
