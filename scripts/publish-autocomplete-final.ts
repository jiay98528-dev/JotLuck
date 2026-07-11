/**
 * Post-final autocomplete publisher.
 *
 * This is the only bridge from ignored validation/final candidates to the
 * checked-in public assets. Every input is re-opened and re-hashed before a
 * single atomic replacement transaction is started.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// Plain ESM keeps the independent RC verifier runnable without a TS loader.
// @ts-expect-error The integrity module intentionally has no declaration output.
import {
  AUTOCOMPLETE_EVIDENCE_SOURCE_FILES,
  verifyEvaluatorSourceTree,
  verifyFrozenV1Snapshot,
} from './autocomplete-evidence-integrity.mjs';
import {
  loadAndValidateWorkspaceFinalV2,
  type WorkspaceFinalAudit,
  validateWorkspaceFinalV2,
} from './workspace-final-holdout';

const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CURVE =
  'scripts/corpus/_web-cache/autocomplete-candidates/learning-curve-v2/learning-curve-report.json';
const DEFAULT_FINAL_EVIDENCE =
  'scripts/corpus/_web-cache/autocomplete-candidates/final-v2-consumption/final-evidence.json';
const DEFAULT_FINAL_RUNTIME =
  'scripts/corpus/_web-cache/autocomplete-candidates/workspace-final-runtime-evidence.json';
const DEFAULT_WEBVIEW_SMOKE =
  'scripts/corpus/_web-cache/autocomplete-candidates/tauri-webview-smoke.json';
const CANDIDATE_ROOT = 'scripts/corpus/_web-cache/autocomplete-candidates/learning-curve-v2';
const RELEASE_EVIDENCE_ROOT = 'scripts/corpus/autocomplete-release-evidence';
const MAX_MODEL_BYTES = 6 * 1024 * 1024;
const LEARNING_CURVE_VERSION = 'autocomplete-learning-curve-v2';
const SYNTHETIC_GENERATOR_VERSION = 'jotluck-synthetic-short-notes-v1';
const SYNTHETIC_GENERATOR_SEED = 'project-owned-seed-2026-07-11';
const FORMAL_VALIDATION_PATH = 'scripts/corpus/formal-holdout.json';
const WORKSPACE_FINAL_PATH = 'scripts/corpus/workspace-conditioned-final-v2.json';
const QUALITY_EVALUATOR_VERSION = 'offline-completion-evaluator-v2';
const RUNTIME_EVALUATOR_VERSION = 'production-router-runtime-v2';
const SYNTHETIC_LEARNING_CURVE_SOURCE_IDS = [
  'synthetic-natural-zh',
  'synthetic-project-zh',
  'synthetic-technical-en',
  'synthetic-technical-zh',
  'synthetic-workflow-en',
] as const;
const FIXED_LEARNING_CURVE_TIERS = [
  ['0.1mib', 104_858],
  ['0.5mib', 524_288],
  ['1mib', 1_048_576],
  ['3mib', 3_145_728],
  ['8mib', 8_388_608],
  ['16mib', 16_777_216],
  ['24mib-cap', 25_165_824],
] as const;

const PROFILE_OUTPUTS = {
  'web-local': {
    model: 'packages/app/public/baseline-ngram.web-local.compact.txt',
    manifest: 'packages/app/public/baseline-ngram.web-local.compact.manifest.json',
    report: 'scripts/corpus/training-report.web-local.json',
  },
  release: {
    model: 'packages/app/public/baseline-ngram.v1.compact.txt',
    manifest: 'packages/app/public/baseline-ngram.v1.compact.manifest.json',
    report: 'scripts/corpus/training-report.json',
  },
} as const;

const CANDIDATE_BINDING_KEYS = [
  'model',
  'trainingInput',
  'validation',
  'evaluatorTree',
  'frozenV1',
  'qualityReport',
  'runtimeReport',
  'comparison',
  'learningCurve',
] as const;

type Profile = keyof typeof PROFILE_OUTPUTS;
type JsonObject = Record<string, unknown>;

interface EvidenceBinding {
  path: string;
  sha256: string;
}

interface CandidateBindings {
  schemaVersion: 2;
  model: EvidenceBinding;
  trainingInput: EvidenceBinding;
  validation: EvidenceBinding;
  evaluatorTree: EvidenceBinding;
  frozenV1: EvidenceBinding;
  qualityReport: EvidenceBinding;
  runtimeReport: EvidenceBinding;
  comparison: EvidenceBinding;
  learningCurve: EvidenceBinding;
  final: null;
}

interface CandidateManifest {
  [key: string]: unknown;
  schemaVersion: 2;
  profile: 'web-local';
  modelFile: string;
  serialization: 'sectioned-jsonl-hex-v4';
  order: 'section-profile-context-hex';
  ngramN: number;
  minNgramN: number;
  wordNgramOrders: number[];
  countScale: number;
  modelBytes: number;
  entryCount: number;
  sha256: string;
  trainingInputHash: string;
  verifiedOnly: true;
  softTargetPassed: boolean;
  hardLimitPassed: boolean;
  runtimeEligible: boolean;
  qualityGatePassed: boolean;
  releaseEligible: boolean;
  holdoutSha256: string;
  evaluatorVersion?: string;
  evaluatorSha256?: string;
  qualityEvidenceSha256?: string;
  learningCurveSha256?: string;
  degradedReason?: string;
  evidenceBindings: CandidateBindings;
}

interface ComparisonMetrics {
  top1Rate: number;
  usableRate: number;
  mixedCandidates: number;
}

interface V1V2Comparison {
  schemaVersion: 1;
  holdoutSha256: string;
  frozenV1TreeSha256: string;
  v1: ComparisonMetrics;
  v2: ComparisonMetrics;
  delta: {
    top1Rate: number;
    usableRate: number;
  };
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

interface LearningCurveTierEvidence {
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

interface LearningCurveReport {
  schemaVersion: 2;
  version: string;
  stage: 'validation';
  generatorVersion: string;
  generatorSeed: string;
  generatedCorpusSha256: string;
  sourceIds: string[];
  validationPath: string;
  validationSha256: string;
  evaluatorVersion: string;
  evaluatorTreeSha256: string;
  frozenV1TreeSha256: string;
  runtimeEvidenceSha256: string | null;
  runtimeEvidenceStatus: 'not-provided' | 'accepted' | 'rejected';
  tiers: LearningCurveTierEvidence[];
  selectedTier: string | null;
  selectionReason: 'minimum-eligible-tier' | 'no-tier-passed-all-gates';
  releaseEligible: false;
  finalHoldoutConsumed: false;
  learningCurveSha256: string;
}

interface FinalRuntimeEvidence {
  schemaVersion: 1;
  classification: 'workspace-final-v2-runtime-evidence';
  stage: 'final';
  productionRouterObserved: true;
  modelSha256: string;
  finalHoldoutSha256: string;
  opportunities: 200;
  requestCount: 200;
  visibleSampleCount: number;
  triggerRate: number;
  usableRate: number;
  falseTriggerRate: number;
  mixedCandidateRate: number;
  allRequestP90Ms: number;
  visiblePredictionP90Ms: number;
  oracleAt8Rate: number;
  top1Rate: number;
  language: {
    zh: LanguageComparison;
    en: LanguageComparison;
  };
}

interface LanguageComparison {
  top1Rate: number;
  usableRate: number;
  v1Top1Rate: number;
  v1UsableRate: number;
}

interface FinalEvidence {
  schemaVersion: 1;
  classification: 'workspace-final-v2-evidence';
  releaseEligible: true;
  finalHoldoutConsumed: true;
  modelSha256: string;
  validationCurveSha256: string;
  finalHoldoutSha256: string;
  finalAudit: WorkspaceFinalAudit;
  runtimeEvidenceSha256: string;
  consumptionReceiptSha256: string;
  runtime: FinalRuntimeEvidence;
  v21Eligible: boolean;
}

interface ConsumptionReceipt {
  schemaVersion: 1;
  classification: 'workspace-final-v2-consumption-receipt';
  finalHoldoutSha256: string;
  modelSha256: string;
  validationCurveSha256: string;
  claimedAt: string;
}

interface WebviewSmokeEvidence {
  classification: 'tauri-webview-offline-smoke';
  status: 'pass';
  modelSha256: string;
  completedAt: string;
}

interface QualityEvidence {
  schemaVersion: 2;
  classification: 'deterministic-model-quality-evidence';
  stage: 'validation';
  modelSha256: string;
  trainingInputHash: string;
  validationSha256: string;
  evaluatorVersion: string;
  evaluatorTreeSha256: string;
  frozenV1TreeSha256: string;
  comparison: V1V2Comparison;
  evaluation: {
    schemaVersion: 2;
    evaluatorVersion: string;
    model: { sha256: string; bytes: number };
    holdout: { sha256: string; opportunities: number };
    l3Raw: { contextHitRate: number; top1Rate: number; oracleAt8Rate: number };
    fullStack: {
      triggerRate: number;
      usableRate: number;
      falseTriggerRate: number;
      mixedCandidates: number;
    };
    verdicts: {
      runtimeSafety: { status: 'pass' | 'fail' };
      modelQuality: { status: 'pass' | 'fail' };
    };
  };
  releaseEligible: false;
}

interface EvaluatorIdentity {
  schemaVersion: 1;
  files: Array<{ path: string; sha256: string }>;
  treeSha256: string;
}

interface FrozenV1Identity {
  treeSha256: string;
}

interface TrainingSelection {
  schemaVersion: 1;
  documents: unknown[];
  fragments: unknown[];
}

export interface PublishAutocompleteFinalOptions {
  rootDir?: string;
  curvePath?: string;
  finalEvidencePath?: string;
  finalRuntimePath?: string;
  webviewSmokePath?: string;
  receiptPath?: string;
}

export interface PublishedAutocompleteProfile {
  profile: Profile;
  modelPath: string;
  manifestPath: string;
  reportPath: string;
  modelSha256: string;
}

export interface PublishAutocompleteFinalResult {
  selectedTier: string;
  modelSha256: string;
  finalHoldoutSha256: string;
  v21Eligible: boolean;
  evidenceDirectory: string;
  profiles: PublishedAutocompleteProfile[];
}

interface LoadedBinding {
  binding: EvidenceBinding;
  absolutePath: string;
  bytes: Buffer;
}

/**
 * Validate all release evidence and atomically publish both public profiles.
 * Validation performs no writes; selectedTier=null therefore always leaves
 * the workspace byte-for-byte unchanged.
 */
export function publishAutocompleteFinal(
  options: PublishAutocompleteFinalOptions = {},
): PublishAutocompleteFinalResult {
  const rootDir = fs.realpathSync(path.resolve(options.rootDir ?? MODULE_ROOT));
  const curveRelative = options.curvePath ?? DEFAULT_CURVE;
  const curveFile = readWorkspaceJson<LearningCurveReport>(rootDir, curveRelative);
  const curve = curveFile.value;

  // Fail before reading any other evidence or creating any output directory.
  if (curve.selectedTier == null) {
    throw new Error('No validation tier is eligible; public autocomplete assets were not changed.');
  }

  assertLearningCurve(curve);
  const selected = curve.tiers.find((tier) => tier.id === curve.selectedTier);
  if (!selected) throw new Error('Selected tier is absent from the learning curve.');
  assertSelectedTier(curve, selected);

  const candidateDirectory = resolveWorkspaceDirectory(rootDir, selected.candidateDirectory);
  const allowedCandidateRoot = resolveWorkspaceDirectory(rootDir, CANDIDATE_ROOT);
  if (!isWithin(candidateDirectory, allowedCandidateRoot)) {
    throw new Error('Selected candidate directory escapes the approved learning-curve root.');
  }
  const candidateManifestFile = readWorkspaceJson<CandidateManifest>(
    rootDir,
    `${selected.candidateDirectory}/manifest.json`,
  );
  const candidateManifest = candidateManifestFile.value;
  const bindings = loadCandidateBindings(rootDir, candidateManifest);
  const candidateModel = bindings.model.bytes;
  assertCandidateModel(candidateManifest, selected, candidateModel);
  assertCandidateEvidence(rootDir, curve, selected, candidateManifest, bindings, curveFile);

  const { audit: finalAudit } = loadAndValidateWorkspaceFinalV2(rootDir);
  const finalHoldoutFile = readWorkspaceJson<JsonObject>(rootDir, WORKSPACE_FINAL_PATH);
  const reboundFinalAudit = validateWorkspaceFinalV2(
    finalHoldoutFile.value as unknown as Parameters<typeof validateWorkspaceFinalV2>[0],
  );
  if (canonicalJson(reboundFinalAudit) !== canonicalJson(finalAudit)) {
    throw new Error('Workspace final holdout changed while release evidence was being assembled.');
  }
  const finalEvidenceFile = readWorkspaceJson<FinalEvidence>(
    rootDir,
    options.finalEvidencePath ?? DEFAULT_FINAL_EVIDENCE,
  );
  const finalRuntimeFile = readWorkspaceJson<FinalRuntimeEvidence>(
    rootDir,
    options.finalRuntimePath ?? DEFAULT_FINAL_RUNTIME,
  );
  assertFinalEvidence(
    finalEvidenceFile.value,
    finalRuntimeFile,
    selected.modelSha256,
    curve.learningCurveSha256,
    finalAudit,
  );

  const receiptRelative =
    options.receiptPath ??
    path.join(
      path.dirname(options.finalEvidencePath ?? DEFAULT_FINAL_EVIDENCE),
      `${finalAudit.datasetSha256}.json`,
    );
  const receiptFile = readWorkspaceJson<ConsumptionReceipt>(rootDir, receiptRelative);
  assertConsumptionReceipt(
    receiptFile.value,
    receiptFile.bytes,
    selected.modelSha256,
    curve.learningCurveSha256,
    finalAudit.datasetSha256,
    finalEvidenceFile.value.consumptionReceiptSha256,
  );

  const webviewFile = readWorkspaceJson<WebviewSmokeEvidence>(
    rootDir,
    options.webviewSmokePath ?? DEFAULT_WEBVIEW_SMOKE,
  );
  assertWebviewSmoke(webviewFile.value, selected.modelSha256, receiptFile.value.claimedAt);

  const releasePayload = buildReleasePayload({
    rootDir,
    curve,
    selected,
    candidateManifest,
    bindings,
    candidateModel: candidateModel.toString('utf8'),
    finalEvidenceFile,
    finalRuntimeFile,
    receiptFile,
    webviewFile,
    finalHoldoutFile,
  });
  validateOutputTargets(
    rootDir,
    releasePayload.writes.map((item) => item.target),
  );
  atomicReplaceFiles(releasePayload.writes);
  return releasePayload.result;
}

function assertLearningCurve(curve: LearningCurveReport): void {
  if (
    curve.schemaVersion !== 2 ||
    curve.version !== LEARNING_CURVE_VERSION ||
    curve.stage !== 'validation' ||
    curve.generatorVersion !== SYNTHETIC_GENERATOR_VERSION ||
    curve.generatorSeed !== SYNTHETIC_GENERATOR_SEED ||
    !isSha256(curve.generatedCorpusSha256) ||
    curve.validationPath !== FORMAL_VALIDATION_PATH ||
    curve.releaseEligible !== false ||
    curve.finalHoldoutConsumed !== false ||
    curve.selectionReason !== 'minimum-eligible-tier' ||
    curve.runtimeEvidenceStatus !== 'accepted' ||
    curve.evaluatorVersion !== QUALITY_EVALUATOR_VERSION ||
    !isSha256(curve.runtimeEvidenceSha256) ||
    !isSha256(curve.validationSha256) ||
    !isSha256(curve.evaluatorTreeSha256) ||
    !isSha256(curve.frozenV1TreeSha256) ||
    !Array.isArray(curve.tiers) ||
    curve.tiers.length !== FIXED_LEARNING_CURVE_TIERS.length ||
    !sameStrings(curve.sourceIds, SYNTHETIC_LEARNING_CURVE_SOURCE_IDS)
  ) {
    throw new Error('Learning curve is not a complete synthetic-only validation report.');
  }
  for (let index = 0; index < FIXED_LEARNING_CURVE_TIERS.length; index++) {
    const [expectedId, expectedBytes] = FIXED_LEARNING_CURVE_TIERS[index]!;
    const tier = curve.tiers[index]!;
    if (
      tier.id !== expectedId ||
      tier.requestedBytes !== expectedBytes ||
      !Number.isSafeInteger(tier.realizedBytes) ||
      tier.realizedBytes <= 0 ||
      tier.realizedBytes > tier.requestedBytes ||
      (index > 0 && tier.realizedBytes < curve.tiers[index - 1]!.realizedBytes)
    ) {
      throw new Error(`Learning curve tier ${expectedId} is not the fixed nested tier.`);
    }
  }
  const { learningCurveSha256: claimed, ...core } = curve;
  if (!isSha256(claimed) || sha256(canonicalJson(core)) !== claimed) {
    throw new Error('Learning curve self-hash is invalid.');
  }
  const firstEligible = [...curve.tiers]
    .sort((left, right) => left.requestedBytes - right.requestedBytes)
    .find((tier) => tier.eligible)?.id;
  if (!firstEligible || firstEligible !== curve.selectedTier) {
    throw new Error('Learning curve did not select the minimum eligible tier.');
  }
}

function assertSelectedTier(curve: LearningCurveReport, tier: LearningCurveTierEvidence): void {
  if (
    !tier.eligible ||
    !tier.safetyGatePassed ||
    !tier.hardLimitPassed ||
    !tier.softTargetPassed ||
    !tier.modelQualityPassed ||
    !tier.deterministicRuntimeSafetyPassed ||
    !tier.runtimeMeasurementRequired ||
    !tier.runtimeEvidencePassed ||
    tier.ineligibilityReasons.length !== 0 ||
    tier.triggerRate < 0.35 ||
    tier.triggerRate > 0.42 ||
    tier.usableRate < 0.35 ||
    tier.falseTriggerRate > 0.03 ||
    tier.mixedCandidateRate !== 0 ||
    tier.allRequestP90Ms == null ||
    tier.allRequestP90Ms > 140 ||
    tier.visiblePredictionP90Ms == null ||
    tier.visiblePredictionP90Ms > 140 ||
    tier.runtimeRequestCount !== 200 ||
    tier.runtimeVisibleSampleCount == null ||
    tier.runtimeVisibleSampleCount <= 0 ||
    tier.runtimeVisibleSampleCount > tier.runtimeRequestCount ||
    tier.fallbackRate == null ||
    tier.fallbackRate < 0 ||
    tier.fallbackRate > 1 ||
    tier.timeoutRate == null ||
    tier.timeoutRate < 0 ||
    tier.timeoutRate > 1 ||
    tier.parseMaxChunkMs == null ||
    tier.parseMaxChunkMs > 50 ||
    tier.parseLongTasksOver50Ms !== 0 ||
    tier.v1Comparison.delta.top1Rate < 0 ||
    tier.v1Comparison.delta.usableRate < 0 ||
    tier.v1Comparison.v2.mixedCandidates > tier.v1Comparison.v1.mixedCandidates ||
    !sameStrings(tier.sourceIds, SYNTHETIC_LEARNING_CURVE_SOURCE_IDS) ||
    tier.modelBytes <= 0 ||
    tier.modelBytes > MAX_MODEL_BYTES ||
    !isSha256(tier.modelSha256) ||
    curve.validationSha256 !== tier.v1Comparison.holdoutSha256
  ) {
    throw new Error(`Selected tier ${tier.id} no longer satisfies every validation gate.`);
  }
}

function loadCandidateBindings(
  rootDir: string,
  manifest: CandidateManifest,
): Record<(typeof CANDIDATE_BINDING_KEYS)[number], LoadedBinding> {
  const raw = manifest.evidenceBindings;
  if (!raw || raw.schemaVersion !== 2 || raw.final !== null) {
    throw new Error('Candidate manifest evidence bindings are incomplete or already finalized.');
  }
  const result = {} as Record<(typeof CANDIDATE_BINDING_KEYS)[number], LoadedBinding>;
  for (const key of CANDIDATE_BINDING_KEYS) {
    const binding = raw[key];
    if (!binding || typeof binding.path !== 'string' || !isSha256(binding.sha256)) {
      throw new Error(`Candidate evidence binding is invalid: ${key}.`);
    }
    const absolutePath = resolveWorkspaceFile(rootDir, binding.path);
    const bytes = fs.readFileSync(absolutePath);
    if (sha256(bytes) !== binding.sha256) {
      throw new Error(`Candidate evidence SHA mismatch: ${key}.`);
    }
    result[key] = { binding, absolutePath, bytes };
  }
  return result;
}

function assertCandidateModel(
  manifest: CandidateManifest,
  tier: LearningCurveTierEvidence,
  model: Buffer,
): void {
  const entryCount = assertSectionedModel(model.toString('utf8'));
  if (
    manifest.schemaVersion !== 2 ||
    manifest.profile !== 'web-local' ||
    manifest.serialization !== 'sectioned-jsonl-hex-v4' ||
    manifest.order !== 'section-profile-context-hex' ||
    manifest.ngramN !== 4 ||
    manifest.minNgramN !== 2 ||
    manifest.countScale !== 1000 ||
    manifest.wordNgramOrders.join(',') !== '1,2' ||
    manifest.verifiedOnly !== true ||
    manifest.softTargetPassed !== true ||
    manifest.hardLimitPassed !== true ||
    manifest.runtimeEligible !== false ||
    manifest.qualityGatePassed !== false ||
    manifest.releaseEligible !== false ||
    manifest.modelBytes !== model.byteLength ||
    manifest.entryCount !== entryCount ||
    !Number.isSafeInteger(manifest.entryCount) ||
    manifest.entryCount <= 0 ||
    manifest.sha256 !== sha256(model) ||
    manifest.sha256 !== tier.modelSha256 ||
    manifest.modelBytes !== tier.modelBytes ||
    manifest.trainingInputHash !== tier.trainingInputHash ||
    model.byteLength > MAX_MODEL_BYTES
  ) {
    throw new Error('Selected candidate model or manifest integrity check failed.');
  }
}

function assertSectionedModel(serialized: string): number {
  const lines = serialized.split(/\r?\n/u).filter((line) => line.trim());
  if (lines[0] !== '# jotluck-baseline-v4' || lines[1] !== '[character]') {
    throw new Error('Selected candidate is not a complete sectioned v4 model.');
  }
  const wordSection = lines.indexOf('[word]');
  if (wordSection < 2 || lines.lastIndexOf('[word]') !== wordSection) {
    throw new Error('Selected candidate has an invalid word-model section.');
  }
  const entries = [
    ...lines.slice(2, wordSection).map((line) => ({ line, kind: 'character' as const })),
    ...lines.slice(wordSection + 1).map((line) => ({ line, kind: 'word' as const })),
  ];
  for (const entry of entries) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(entry.line);
    } catch {
      throw new Error(`Selected candidate contains invalid ${entry.kind} JSONL.`);
    }
    if (!Array.isArray(parsed) || parsed.length !== (entry.kind === 'character' ? 3 : 2)) {
      throw new Error(`Selected candidate contains an invalid ${entry.kind} entry.`);
    }
    const [contextHex, predictions, flags] = parsed;
    if (
      typeof contextHex !== 'string' ||
      !isEvenHex(contextHex) ||
      !Array.isArray(predictions) ||
      predictions.length === 0 ||
      (entry.kind === 'character' && flags !== 'b' && flags !== 'u') ||
      predictions.some(
        (prediction) =>
          !Array.isArray(prediction) ||
          prediction.length !== 2 ||
          !isEvenHex(prediction[0]) ||
          !Number.isSafeInteger(prediction[1]) ||
          Number(prediction[1]) <= 0,
      )
    ) {
      throw new Error(`Selected candidate contains invalid ${entry.kind} predictions.`);
    }
  }
  return entries.length;
}

function isEvenHex(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length % 2 === 0 &&
    /^[a-f0-9]+$/u.test(value)
  );
}

function assertCandidateEvidence(
  rootDir: string,
  curve: LearningCurveReport,
  tier: LearningCurveTierEvidence,
  manifest: CandidateManifest,
  bindings: Record<(typeof CANDIDATE_BINDING_KEYS)[number], LoadedBinding>,
  curveFile: { absolutePath: string; bytes: Buffer; value: LearningCurveReport },
): void {
  if (
    bindings.model.absolutePath !==
      resolveWorkspaceFile(rootDir, `${tier.candidateDirectory}/model.compact.txt`) ||
    bindings.learningCurve.absolutePath !== curveFile.absolutePath ||
    bindings.learningCurve.binding.sha256 !== sha256(curveFile.bytes) ||
    curve.runtimeEvidenceSha256 !== bindings.runtimeReport.binding.sha256 ||
    bindings.validation.binding.path !== curve.validationPath
  ) {
    throw new Error('Candidate model or learning-curve binding points at a different artifact.');
  }
  const selection = parseJson<TrainingSelection>(bindings.trainingInput.bytes, 'trainingInput');
  const validation = parseJson<JsonObject>(bindings.validation.bytes, 'validation');
  const evaluator = parseJson<EvaluatorIdentity>(bindings.evaluatorTree.bytes, 'evaluatorTree');
  const frozenV1 = parseJson<FrozenV1Identity>(bindings.frozenV1.bytes, 'frozenV1');
  const quality = parseJson<QualityEvidence>(bindings.qualityReport.bytes, 'qualityReport');
  const runtime = parseJson<RuntimeEvidenceReport>(bindings.runtimeReport.bytes, 'runtimeReport');
  const comparison = parseJson<V1V2Comparison>(bindings.comparison.bytes, 'comparison');
  const validationSha256 = sha256(canonicalJson(validation));
  const runtimeTier = runtime.tiers?.[tier.id];
  const evaluatorIdentity = verifyEvaluatorSourceTree(
    rootDir,
    evaluator,
    AUTOCOMPLETE_EVIDENCE_SOURCE_FILES,
  );
  const frozenIdentity = verifyFrozenV1Snapshot(rootDir, bindings.frozenV1.binding.path, frozenV1);

  assertFormalValidationHoldout(validation);
  if (
    selection.schemaVersion !== 1 ||
    !Array.isArray(selection.documents) ||
    !Array.isArray(selection.fragments) ||
    selection.documents.length !== tier.selectionDocumentCount ||
    selection.fragments.length !== tier.selectionFragmentCount ||
    sha256(canonicalJson(selection)) !== tier.selectionManifestHash
  ) {
    throw new Error('Selected training input manifest is invalid or model-mismatched.');
  }
  if (
    validationSha256 !== curve.validationSha256 ||
    manifest.holdoutSha256 !== curve.validationSha256 ||
    evaluatorIdentity.treeSha256 !== curve.evaluatorTreeSha256 ||
    frozenIdentity.treeSha256 !== curve.frozenV1TreeSha256 ||
    manifest.evaluatorSha256 !== evaluatorIdentity.treeSha256 ||
    manifest.evaluatorVersion !== curve.evaluatorVersion ||
    manifest.learningCurveSha256 !== curve.learningCurveSha256
  ) {
    throw new Error('Candidate validation/evaluator identities are inconsistent.');
  }
  if (
    quality.schemaVersion !== 2 ||
    quality.classification !== 'deterministic-model-quality-evidence' ||
    quality.stage !== 'validation' ||
    quality.releaseEligible !== false ||
    quality.modelSha256 !== tier.modelSha256 ||
    quality.trainingInputHash !== tier.trainingInputHash ||
    quality.validationSha256 !== curve.validationSha256 ||
    quality.evaluatorVersion !== curve.evaluatorVersion ||
    quality.evaluatorTreeSha256 !== evaluatorIdentity.treeSha256 ||
    quality.frozenV1TreeSha256 !== frozenIdentity.treeSha256 ||
    canonicalJson(quality.comparison) !== canonicalJson(comparison) ||
    canonicalJson(comparison) !== canonicalJson(tier.v1Comparison) ||
    manifest.qualityEvidenceSha256 !== bindings.qualityReport.binding.sha256
  ) {
    throw new Error('Candidate quality evidence is incomplete or inconsistent.');
  }
  const evaluation = quality.evaluation;
  if (
    evaluation?.schemaVersion !== 2 ||
    evaluation.evaluatorVersion !== QUALITY_EVALUATOR_VERSION ||
    evaluation.model?.sha256 !== tier.modelSha256 ||
    evaluation.model?.bytes !== tier.modelBytes ||
    evaluation.holdout?.sha256 !== curve.validationSha256 ||
    evaluation.holdout?.opportunities !== countFormalValidationOpportunities(validation) ||
    evaluation.l3Raw?.contextHitRate !== tier.contextHitRate ||
    evaluation.l3Raw?.top1Rate !== tier.top1Rate ||
    evaluation.l3Raw?.oracleAt8Rate !== tier.oracleAt8Rate ||
    evaluation.fullStack?.triggerRate !== tier.triggerRate ||
    evaluation.fullStack?.usableRate !== tier.usableRate ||
    evaluation.fullStack?.falseTriggerRate !== tier.falseTriggerRate ||
    evaluation.fullStack?.mixedCandidates !== comparison.v2.mixedCandidates ||
    evaluation.verdicts?.runtimeSafety?.status !== 'pass' ||
    evaluation.verdicts?.modelQuality?.status !== 'pass'
  ) {
    throw new Error('Candidate evaluator output does not reproduce the selected tier.');
  }
  assertValidationRuntime(runtime, runtimeTier, curve, tier);
}

function assertValidationRuntime(
  report: RuntimeEvidenceReport,
  runtime: RuntimeTierEvidence | undefined,
  curve: LearningCurveReport,
  tier: LearningCurveTierEvidence,
): asserts runtime is RuntimeTierEvidence {
  if (
    report.schemaVersion !== 2 ||
    report.classification !== 'production-router-runtime-evidence' ||
    report.validationSha256 !== curve.validationSha256 ||
    report.evaluatorVersion !== RUNTIME_EVALUATOR_VERSION ||
    !runtime ||
    runtime.modelSha256 !== tier.modelSha256 ||
    runtime.productionRouterObserved !== true ||
    !Number.isSafeInteger(runtime.requestCount) ||
    runtime.requestCount !== 200 ||
    !Number.isSafeInteger(runtime.visibleSampleCount) ||
    runtime.visibleSampleCount <= 0 ||
    runtime.visibleSampleCount > runtime.requestCount ||
    runtime.requestCount !== tier.runtimeRequestCount ||
    runtime.visibleSampleCount !== tier.runtimeVisibleSampleCount ||
    runtime.allRequestP90Ms !== tier.allRequestP90Ms ||
    runtime.visiblePredictionP90Ms !== tier.visiblePredictionP90Ms ||
    runtime.fallbackRate !== tier.fallbackRate ||
    runtime.timeoutRate !== tier.timeoutRate ||
    runtime.mixedCandidateRate !== 0 ||
    runtime.parseMaxChunkMs > 50 ||
    runtime.parseLongTasksOver50Ms !== 0 ||
    runtime.allRequestP90Ms > 140 ||
    runtime.visiblePredictionP90Ms > 140
  ) {
    throw new Error('Selected production-router runtime evidence is missing or failed.');
  }
  if (
    ![runtime.fallbackRate, runtime.timeoutRate].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    )
  ) {
    throw new Error('Selected production-router runtime rates are invalid.');
  }
}

function assertFormalValidationHoldout(validation: JsonObject): void {
  const cases = validation.cases;
  if (
    validation.schemaVersion !== 2 ||
    typeof validation.datasetId !== 'string' ||
    !Array.isArray(cases)
  ) {
    throw new Error('Formal validation holdout identity is invalid.');
  }
  let opportunities = 0;
  let silence = 0;
  const language: Record<'zh' | 'en', number> = { zh: 0, en: 0 };
  for (const rawCase of cases) {
    if (!rawCase || typeof rawCase !== 'object') {
      throw new Error('Formal validation holdout contains an invalid case.');
    }
    const item = rawCase as JsonObject;
    const checkpoints = item.checkpoints;
    if ((item.language !== 'zh' && item.language !== 'en') || !Array.isArray(checkpoints)) {
      throw new Error('Formal validation holdout language/checkpoints are invalid.');
    }
    for (const rawCheckpoint of checkpoints) {
      if (!rawCheckpoint || typeof rawCheckpoint !== 'object') {
        throw new Error('Formal validation holdout contains an invalid checkpoint.');
      }
      const checkpoint = rawCheckpoint as JsonObject;
      if (checkpoint.expectedBehavior !== 'complete' && checkpoint.expectedBehavior !== 'silence') {
        throw new Error('Formal validation holdout checkpoint behavior is invalid.');
      }
      opportunities++;
      language[item.language]++;
      if (checkpoint.expectedBehavior === 'silence') silence++;
    }
  }
  if (
    opportunities !== 200 ||
    language.zh < 80 ||
    language.en < 80 ||
    silence / opportunities < 0.2
  ) {
    throw new Error('Formal validation holdout does not meet the frozen release composition.');
  }
}

function countFormalValidationOpportunities(validation: JsonObject): number {
  const cases = validation.cases;
  if (!Array.isArray(cases)) return -1;
  return cases.reduce((total, item) => {
    if (!item || typeof item !== 'object') return total;
    const checkpoints = (item as JsonObject).checkpoints;
    return total + (Array.isArray(checkpoints) ? checkpoints.length : 0);
  }, 0);
}

function assertFinalEvidence(
  evidence: FinalEvidence,
  runtimeFile: { bytes: Buffer; value: FinalRuntimeEvidence },
  modelSha256: string,
  curveSha256: string,
  audit: WorkspaceFinalAudit,
): void {
  const runtime = runtimeFile.value;
  if (
    evidence.schemaVersion !== 1 ||
    evidence.classification !== 'workspace-final-v2-evidence' ||
    evidence.releaseEligible !== true ||
    evidence.finalHoldoutConsumed !== true ||
    evidence.modelSha256 !== modelSha256 ||
    evidence.validationCurveSha256 !== curveSha256 ||
    evidence.finalHoldoutSha256 !== audit.datasetSha256 ||
    canonicalJson(evidence.finalAudit) !== canonicalJson(audit) ||
    evidence.runtimeEvidenceSha256 !== sha256(runtimeFile.bytes)
  ) {
    throw new Error('Workspace final evidence is invalid or not bound to this candidate.');
  }
  if (canonicalJson(evidence.runtime) !== canonicalJson(runtime)) {
    throw new Error('Workspace final embedded runtime evidence does not match its bound file.');
  }
  assertFinalRuntime(runtime, modelSha256, audit.datasetSha256);
  const expectedV21 =
    runtime.oracleAt8Rate - runtime.top1Rate >= 0.08 &&
    (['zh', 'en'] as const).every((language) => {
      const item = runtime.language[language];
      return item.top1Rate + 0.02 >= item.v1Top1Rate && item.usableRate + 0.02 >= item.v1UsableRate;
    });
  if (evidence.v21Eligible !== expectedV21) {
    throw new Error('Workspace final V2.1 decision does not match the frozen metrics.');
  }
}

function assertFinalRuntime(
  runtime: FinalRuntimeEvidence,
  modelSha256: string,
  finalHoldoutSha256: string,
): void {
  const rates = [
    runtime.triggerRate,
    runtime.usableRate,
    runtime.falseTriggerRate,
    runtime.mixedCandidateRate,
    runtime.oracleAt8Rate,
    runtime.top1Rate,
  ];
  if (
    runtime.schemaVersion !== 1 ||
    runtime.classification !== 'workspace-final-v2-runtime-evidence' ||
    runtime.stage !== 'final' ||
    runtime.productionRouterObserved !== true ||
    runtime.modelSha256 !== modelSha256 ||
    runtime.finalHoldoutSha256 !== finalHoldoutSha256 ||
    runtime.opportunities !== 200 ||
    runtime.requestCount !== 200 ||
    !Number.isSafeInteger(runtime.visibleSampleCount) ||
    runtime.visibleSampleCount <= 0 ||
    runtime.visibleSampleCount > runtime.requestCount ||
    !rates.every((value) => Number.isFinite(value) && value >= 0 && value <= 1) ||
    runtime.triggerRate < 0.35 ||
    runtime.triggerRate > 0.42 ||
    runtime.usableRate < 0.35 ||
    runtime.falseTriggerRate > 0.03 ||
    runtime.mixedCandidateRate !== 0 ||
    runtime.allRequestP90Ms > 140 ||
    runtime.visiblePredictionP90Ms > 140
  ) {
    throw new Error('Workspace final runtime evidence failed release gates.');
  }
  for (const language of ['zh', 'en'] as const) {
    const item = runtime.language?.[language];
    if (
      !item ||
      ![item.top1Rate, item.usableRate, item.v1Top1Rate, item.v1UsableRate].every(
        (value) => Number.isFinite(value) && value >= 0 && value <= 1,
      ) ||
      item.top1Rate + 0.02 < item.v1Top1Rate ||
      item.usableRate + 0.02 < item.v1UsableRate
    ) {
      throw new Error(`Workspace final ${language} evidence regressed beyond 2pp from V1.`);
    }
  }
}

function assertConsumptionReceipt(
  receipt: ConsumptionReceipt,
  receiptBytes: Buffer,
  modelSha256: string,
  curveSha256: string,
  finalHoldoutSha256: string,
  expectedReceiptSha256: string,
): void {
  if (
    receipt.schemaVersion !== 1 ||
    receipt.classification !== 'workspace-final-v2-consumption-receipt' ||
    receipt.modelSha256 !== modelSha256 ||
    receipt.validationCurveSha256 !== curveSha256 ||
    !isSha256(expectedReceiptSha256) ||
    sha256(receiptBytes) !== expectedReceiptSha256 ||
    receipt.finalHoldoutSha256 !== finalHoldoutSha256 ||
    !Number.isFinite(Date.parse(receipt.claimedAt))
  ) {
    throw new Error('Workspace final consumption receipt is invalid or model-mismatched.');
  }
}

function assertWebviewSmoke(
  evidence: WebviewSmokeEvidence,
  modelSha256: string,
  consumedAt: string,
): void {
  if (
    evidence.classification !== 'tauri-webview-offline-smoke' ||
    evidence.status !== 'pass' ||
    evidence.modelSha256 !== modelSha256 ||
    !Number.isFinite(Date.parse(evidence.completedAt)) ||
    Date.parse(evidence.completedAt) < Date.parse(consumedAt)
  ) {
    throw new Error('A model-bound real Tauri WebView offline smoke is required.');
  }
}

function buildReleasePayload(input: {
  rootDir: string;
  curve: LearningCurveReport;
  selected: LearningCurveTierEvidence;
  candidateManifest: CandidateManifest;
  bindings: Record<(typeof CANDIDATE_BINDING_KEYS)[number], LoadedBinding>;
  candidateModel: string;
  finalEvidenceFile: { bytes: Buffer; value: FinalEvidence };
  finalRuntimeFile: { bytes: Buffer; value: FinalRuntimeEvidence };
  receiptFile: { bytes: Buffer; value: ConsumptionReceipt };
  webviewFile: { bytes: Buffer; value: WebviewSmokeEvidence };
  finalHoldoutFile: { bytes: Buffer; value: JsonObject };
}): {
  writes: Array<{ target: string; content: string }>;
  result: PublishAutocompleteFinalResult;
} {
  const {
    rootDir,
    curve,
    selected,
    candidateManifest,
    bindings,
    candidateModel,
    finalEvidenceFile,
    finalRuntimeFile,
    receiptFile,
    webviewFile,
    finalHoldoutFile,
  } = input;
  const evidenceRelativeRoot = `${RELEASE_EVIDENCE_ROOT}/${selected.modelSha256}`;
  const evidenceFiles = {
    trainingInput: `${evidenceRelativeRoot}/selection-manifest.json`,
    validation: `${evidenceRelativeRoot}/formal-holdout.json`,
    final: `${evidenceRelativeRoot}/workspace-final-holdout.json`,
    finalReport: `${evidenceRelativeRoot}/final-evidence.json`,
    evaluatorTree: `${evidenceRelativeRoot}/evaluator-identity.json`,
    qualityReport: `${evidenceRelativeRoot}/quality-evidence.json`,
    runtimeReport: `${evidenceRelativeRoot}/runtime-evidence.json`,
    comparison: `${evidenceRelativeRoot}/v1-v2-comparison.json`,
    learningCurve: `${evidenceRelativeRoot}/learning-curve-report.json`,
    finalRuntimeReport: `${evidenceRelativeRoot}/workspace-final-runtime-evidence.json`,
    finalConsumptionReceipt: `${evidenceRelativeRoot}/final-consumption-receipt.json`,
    webviewSmoke: `${evidenceRelativeRoot}/tauri-webview-smoke.json`,
  } as const;
  const evidenceContents: Record<keyof typeof evidenceFiles, string> = {
    trainingInput: asUtf8(bindings.trainingInput.bytes),
    validation: asUtf8(bindings.validation.bytes),
    final: asUtf8(finalHoldoutFile.bytes),
    finalReport: jsonText({ ...finalEvidenceFile.value, runtime: finalRuntimeFile.value }),
    evaluatorTree: asUtf8(bindings.evaluatorTree.bytes),
    qualityReport: asUtf8(bindings.qualityReport.bytes),
    // Keep the tiered production-router report intact. The selected tier was
    // validated above and RC re-opens the same tier through curve.selectedTier.
    runtimeReport: asUtf8(bindings.runtimeReport.bytes),
    comparison: asUtf8(bindings.comparison.bytes),
    learningCurve: asUtf8(bindings.learningCurve.bytes),
    finalRuntimeReport: asUtf8(finalRuntimeFile.bytes),
    finalConsumptionReceipt: asUtf8(receiptFile.bytes),
    webviewSmoke: asUtf8(webviewFile.bytes),
  };
  const staticBinding = (relativePath: string, content: string): EvidenceBinding => ({
    path: relativePath,
    sha256: sha256(content),
  });
  const sharedBindings = {
    schemaVersion: 2,
    trainingInput: staticBinding(evidenceFiles.trainingInput, evidenceContents.trainingInput),
    validation: staticBinding(evidenceFiles.validation, evidenceContents.validation),
    final: staticBinding(evidenceFiles.final, evidenceContents.final),
    finalReport: staticBinding(evidenceFiles.finalReport, evidenceContents.finalReport),
    evaluatorTree: staticBinding(evidenceFiles.evaluatorTree, evidenceContents.evaluatorTree),
    frozenV1: bindings.frozenV1.binding,
    qualityReport: staticBinding(evidenceFiles.qualityReport, evidenceContents.qualityReport),
    runtimeReport: staticBinding(evidenceFiles.runtimeReport, evidenceContents.runtimeReport),
    comparison: staticBinding(evidenceFiles.comparison, evidenceContents.comparison),
    learningCurve: staticBinding(evidenceFiles.learningCurve, evidenceContents.learningCurve),
    webviewSmoke: staticBinding(evidenceFiles.webviewSmoke, evidenceContents.webviewSmoke),
    finalRuntimeReport: staticBinding(
      evidenceFiles.finalRuntimeReport,
      evidenceContents.finalRuntimeReport,
    ),
    finalConsumptionReceipt: staticBinding(
      evidenceFiles.finalConsumptionReceipt,
      evidenceContents.finalConsumptionReceipt,
    ),
  };
  const writes = (Object.keys(evidenceFiles) as Array<keyof typeof evidenceFiles>).map((key) => ({
    target: resolveOutputFile(rootDir, evidenceFiles[key]),
    content: evidenceContents[key],
  }));
  const profiles: PublishedAutocompleteProfile[] = [];

  for (const profile of ['web-local', 'release'] as const) {
    const output = PROFILE_OUTPUTS[profile];
    const modelBinding = staticBinding(output.model, candidateModel);
    const {
      degradedReason: _degradedReason,
      evidenceBindings: _candidateBindings,
      ...base
    } = candidateManifest;
    const manifest = {
      ...base,
      profile,
      modelFile: path.posix.basename(output.model),
      runtimeEligible: true,
      qualityGatePassed: true,
      releaseEligible: true,
      degradedReason: undefined,
      evidenceBindings: { ...sharedBindings, model: modelBinding },
    };
    const report = {
      schemaVersion: 2,
      classification: 'autocomplete-public-profile-report',
      generatedAt: receiptFile.value.claimedAt,
      profile,
      outputFile: output.model,
      manifestFile: output.manifest,
      verifiedOnly: true,
      runtimeEligible: true,
      qualityGatePassed: true,
      releaseEligible: true,
      selectedTier: selected.id,
      modelSha256: selected.modelSha256,
      modelBytes: selected.modelBytes,
      trainingInputHash: selected.trainingInputHash,
      validationSha256: curve.validationSha256,
      finalHoldoutSha256: finalEvidenceFile.value.finalHoldoutSha256,
      learningCurveSha256: curve.learningCurveSha256,
      v21Eligible: finalEvidenceFile.value.v21Eligible,
      evidenceBindings: manifest.evidenceBindings,
    };
    const manifestText = jsonText(manifest);
    const reportText = jsonText(report);
    assertGeneratedProfile(manifest, report, candidateModel, output.model);
    writes.push(
      { target: resolveOutputFile(rootDir, output.model), content: candidateModel },
      { target: resolveOutputFile(rootDir, output.manifest), content: manifestText },
      { target: resolveOutputFile(rootDir, output.report), content: reportText },
    );
    profiles.push({
      profile,
      modelPath: output.model,
      manifestPath: output.manifest,
      reportPath: output.report,
      modelSha256: selected.modelSha256,
    });
  }

  return {
    writes,
    result: {
      selectedTier: selected.id,
      modelSha256: selected.modelSha256,
      finalHoldoutSha256: finalEvidenceFile.value.finalHoldoutSha256,
      v21Eligible: finalEvidenceFile.value.v21Eligible,
      evidenceDirectory: evidenceRelativeRoot,
      profiles,
    },
  };
}

function assertGeneratedProfile(
  manifest: JsonObject,
  report: JsonObject,
  model: string,
  expectedModelPath: string,
): void {
  const modelSha256 = sha256(model);
  const evidence = manifest.evidenceBindings as JsonObject;
  const modelBinding = evidence.model as EvidenceBinding;
  if (
    manifest.runtimeEligible !== true ||
    manifest.qualityGatePassed !== true ||
    manifest.releaseEligible !== true ||
    manifest.sha256 !== modelSha256 ||
    manifest.modelBytes !== Buffer.byteLength(model, 'utf8') ||
    modelBinding.path !== expectedModelPath ||
    modelBinding.sha256 !== modelSha256 ||
    report.modelSha256 !== modelSha256 ||
    report.releaseEligible !== true
  ) {
    throw new Error('Generated public profile failed its pre-commit integrity check.');
  }
}

function validateOutputTargets(rootDir: string, targets: readonly string[]): void {
  const unique = new Set(targets);
  if (unique.size !== targets.length)
    throw new Error('Publisher generated duplicate output targets.');
  for (const target of targets) {
    const relative = path.relative(rootDir, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Publisher output escapes the workspace: ${target}.`);
    }
  }
}

function atomicReplaceFiles(files: Array<{ target: string; content: string }>): void {
  const token = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const staged: Array<{
    target: string;
    temporary: string;
    backup: string;
    hadTarget: boolean;
  }> = [];
  try {
    for (const { target, content } of files) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temporary = `${target}.tmp-${token}`;
      const backup = `${target}.bak-${token}`;
      staged.push({ target, temporary, backup, hadTarget: fs.existsSync(target) });
      fs.writeFileSync(temporary, content, 'utf8');
      const descriptor = fs.openSync(temporary, 'r+');
      try {
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
    }
  } catch (error) {
    for (const item of staged) {
      if (fs.existsSync(item.temporary)) fs.unlinkSync(item.temporary);
    }
    throw error;
  }
  try {
    for (const item of staged) {
      if (item.hadTarget) fs.renameSync(item.target, item.backup);
      fs.renameSync(item.temporary, item.target);
    }
  } catch (error) {
    for (const item of [...staged].reverse()) {
      if (fs.existsSync(item.target) && (fs.existsSync(item.backup) || !item.hadTarget)) {
        fs.unlinkSync(item.target);
      }
      if (fs.existsSync(item.backup)) fs.renameSync(item.backup, item.target);
      if (fs.existsSync(item.temporary)) fs.unlinkSync(item.temporary);
    }
    throw error;
  }
  for (const item of staged) {
    try {
      if (fs.existsSync(item.backup)) fs.unlinkSync(item.backup);
    } catch (error) {
      console.warn(
        `Could not remove completed autocomplete backup ${item.backup}: ${String(error)}`,
      );
    }
  }
}

function readWorkspaceJson<T>(
  rootDir: string,
  relativePath: string,
): { absolutePath: string; bytes: Buffer; value: T } {
  const absolutePath = resolveWorkspaceFile(rootDir, relativePath);
  const bytes = fs.readFileSync(absolutePath);
  return { absolutePath, bytes, value: parseJson<T>(bytes, relativePath) };
}

function resolveWorkspaceFile(rootDir: string, relativePath: string): string {
  if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) {
    throw new Error(`Evidence path must be workspace-relative: ${String(relativePath)}.`);
  }
  const resolved = path.resolve(rootDir, relativePath);
  const lexical = path.relative(rootDir, resolved);
  if (lexical.startsWith('..') || path.isAbsolute(lexical)) {
    throw new Error(`Evidence path escapes the workspace: ${relativePath}.`);
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`Evidence file does not exist: ${relativePath}.`);
  }
  const real = fs.realpathSync(resolved);
  if (!isWithin(real, rootDir)) {
    throw new Error(`Evidence symlink escapes the workspace: ${relativePath}.`);
  }
  return real;
}

function resolveWorkspaceDirectory(rootDir: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Directory path must be workspace-relative: ${relativePath}.`);
  }
  const resolved = path.resolve(rootDir, relativePath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Evidence directory does not exist: ${relativePath}.`);
  }
  const real = fs.realpathSync(resolved);
  if (!isWithin(real, rootDir))
    throw new Error(`Directory escapes the workspace: ${relativePath}.`);
  return real;
}

function resolveOutputFile(rootDir: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Output path must be workspace-relative: ${relativePath}.`);
  }
  const resolved = path.resolve(rootDir, relativePath);
  const lexical = path.relative(rootDir, resolved);
  if (lexical.startsWith('..') || path.isAbsolute(lexical)) {
    throw new Error(`Output path escapes the workspace: ${relativePath}.`);
  }
  const ancestor = resolveExistingParent(resolved);
  if (!isWithin(fs.realpathSync(ancestor), rootDir)) {
    throw new Error(`Output parent symlink escapes the workspace: ${relativePath}.`);
  }
  if (fs.existsSync(resolved) && !isWithin(fs.realpathSync(resolved), rootDir)) {
    throw new Error(`Output symlink escapes the workspace: ${relativePath}.`);
  }
  return resolved;
}

function resolveExistingParent(value: string): string {
  let current = value;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`Cannot resolve an existing parent for ${value}.`);
    current = parent;
  }
  return fs.statSync(current).isDirectory() ? current : path.dirname(current);
}

function parseJson<T>(bytes: Buffer, label: string): T {
  try {
    return JSON.parse(bytes.toString('utf8')) as T;
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${String(error)}.`);
  }
}

function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function asUtf8(value: Buffer): string {
  const text = value.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(value)) throw new Error('Evidence is not valid UTF-8.');
  return text;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    [...left]
      .sort((a, b) => a.localeCompare(b, 'en'))
      .every((item, index) => item === [...right].sort((a, b) => a.localeCompare(b, 'en'))[index])
  );
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function readArg(argv: string[], name: string): string | undefined {
  const inline = argv.find((item) => item.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const result = publishAutocompleteFinal({
      rootDir: readArg(process.argv.slice(2), '--root'),
      curvePath: readArg(process.argv.slice(2), '--curve'),
      finalEvidencePath: readArg(process.argv.slice(2), '--final-evidence'),
      finalRuntimePath: readArg(process.argv.slice(2), '--final-runtime'),
      webviewSmokePath: readArg(process.argv.slice(2), '--webview-smoke'),
      receiptPath: readArg(process.argv.slice(2), '--receipt'),
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
