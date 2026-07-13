/**
 * Verified-only deterministic baseline trainer.
 *
 * Safety gates are never bypassed. `--allow-verified-degraded` is valid only
 * with `--candidate-dir`, which writes an isolated non-release artifact and
 * never replaces the official baseline.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import {
  findForbiddenCorpusText,
  nearDuplicateCorpusKey,
  normalizeCorpusFragment,
} from './web-corpus-utils';
import {
  deserializeWordTable,
  serializeBaselineTables,
  serializeWordTable,
  tokenizeEnglishWords,
  wordContext,
  type WordNGramTable,
  WORD_OTHER_MASS,
} from '../packages/app/src/utils/word-ngram-engine';
import { NGRAM_OTHER_MASS } from '../packages/app/src/utils/ngram-engine';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type TrainProfile = 'web-local';
export type SourceKind = 'curated' | 'web';
export type NGramTable = Map<string, Map<string, number>>;

export interface SourceConfig {
  id: string;
  path: string;
  weightMilli: number;
  category: string;
  language: 'zh' | 'en' | 'mixed' | 'unknown';
  kind: SourceKind;
  minDocumentFrequency: number;
  description: string;
  domain?: string;
  documentFormat?: 'plain' | 'jsonl';
}

interface ProfileConfig {
  outputFile: string;
  manifestFile: string;
  reportFile: string;
}

interface CorpusConfig {
  version: number;
  ngramN: number;
  ngramOrders: number[];
  wordNgramOrders: number[];
  maxPredsPerContext: number;
  hardMaxBytes: number;
  modelTargetBytes: number;
  maxCleanPoolBytes: number;
  learningCurveBytes: number[];
  exactDuplicateRateLimit: number;
  nearDuplicateRateLimit: number;
  categoryDominanceLimit: number;
  webDomainDominanceLimit: number;
  provenanceFile: string;
  holdoutFile: string;
  qualityGate: HoldoutQualityGateConfig;
  manifestGeneratedAt?: string;
  excludedTrainingFiles: string[];
  profiles: Record<TrainProfile, ProfileConfig>;
  sources: SourceConfig[];
}

interface ProvenanceSource {
  id: string;
  path: string;
  kind: SourceKind;
  owner: string;
  licenseId: string;
  licenseEvidence: string;
  acquiredAt: string;
  cleanerVersion: string;
  approval: 'approved' | 'unverified' | 'rejected';
  contentSha256: string;
}

interface ProvenanceManifest {
  schemaVersion: number;
  sources: ProvenanceSource[];
}

export interface FormalHoldoutCheckpoint {
  id: string;
  cursorOffset: number;
  expectedSuffix: string;
  expectedBehavior: 'complete' | 'silence';
}

export interface FormalHoldoutCase {
  id: string;
  language: 'zh' | 'en';
  category: string;
  text: string;
  checkpoints: FormalHoldoutCheckpoint[];
}

export interface FormalHoldout {
  schemaVersion: 2;
  datasetId: string;
  frozenAt: string;
  description?: string;
  cases: FormalHoldoutCase[];
}

interface SourceDocument {
  id: string;
  relativePath: string;
  absolutePath: string;
  source: SourceConfig;
  sha256: string;
  text: string;
}

interface FragmentContribution {
  sourceId: string;
  kind: SourceKind;
  language: SourceConfig['language'];
  weightMilli: number;
  minDocumentFrequency: number;
  category: string;
  domain?: string;
}

interface CanonicalFragment {
  text: string;
  exactKey: string;
  nearKey: string;
  contributions: Map<string, FragmentContribution>;
}

export interface TransitionStats {
  count: number;
  documentsBySource: Map<string, Set<string>>;
  minDocumentFrequencyBySource: Map<string, number>;
  /** Fixed-point weight for one independent document in each source. */
  weightMilliBySource?: Map<string, number>;
}

export type TrainingTable = Map<string, Map<string, TransitionStats>>;

interface HoldoutQualityGateConfig {
  minOpportunities: number;
  minTriggerRate: number;
  maxTriggerRate: number;
  minUsableRate: number;
  maxFalseTriggerRate: number;
  maxMixedCandidateRate: number;
  maxP90Ms: number;
}

interface HoldoutQualityEvidence {
  schemaVersion: 1;
  profile: TrainProfile;
  modelSha256: string;
  trainingInputHash: string;
  holdoutSha256: string;
  evaluatorVersion: string;
  learningCurveSha256: string;
  opportunities: number;
  triggerRate: number;
  usableRate: number;
  falseTriggerRate: number;
  mixedCandidateRate: number;
  p90Ms: number;
}

interface HoldoutQualitySummary {
  provided: boolean;
  passed: boolean;
  evidenceFile?: string;
  holdoutSha256: string;
  evaluatorVersion?: string;
  qualityEvidenceSha256?: string;
  learningCurveSha256?: string;
  opportunities?: number;
  triggerRate?: number;
  usableRate?: number;
  falseTriggerRate?: number;
  mixedCandidateRate?: number;
  p90Ms?: number;
  errors: string[];
}

export interface ModelBudgetSummary {
  configuredBytes: number;
  candidateEntries: number;
  retainedEntries: number;
  evictedEntries: number;
  candidatePredictions: number;
  retainedPredictions: number;
  evictedPredictions: number;
  candidateBytes: number;
  retainedBytes: number;
  evictedBytes: number;
  meanRetainedEntropyPpm: number;
  meanEvictedEntropyPpm: number;
}

export interface TrainingSliceSummary {
  samplerVersion: 'nested-category-round-robin-v1';
  requestedBytes: number | null;
  availableBytes: number;
  realizedBytes: number;
  shortfallBytes: number;
  availableFragments: number;
  selectedFragments: number;
  availableDocuments: number;
  selectedDocuments: number;
  selectionManifestHash: string;
  insufficient: boolean;
}

export interface TrainingSelectionManifest {
  schemaVersion: 1;
  samplerVersion: TrainingSliceSummary['samplerVersion'];
  documents: Array<{ id: string; contentSha256: string }>;
  fragments: Array<{
    idSha256: string;
    contentSha256: string;
    category: string;
    bytes: number;
    documents: string[];
  }>;
}

export interface DistilledModel {
  model: NGramTable;
  budget: ModelBudgetSummary;
}

export interface BaselineManifest {
  schemaVersion: 2;
  profile: TrainProfile;
  modelFile: string;
  serialization: 'sectioned-jsonl-hex-v4';
  order: 'section-profile-context-hex';
  ngramN: number;
  minNgramN: number;
  wordNgramOrders: number[];
  countScale: number;
  modelBytes: number;
  entryCount: number;
  characterEntryCount: number;
  wordEntryCount: number;
  sha256: string;
  trainingInputHash: string;
  verifiedOnly: true;
  runtimeEligible: boolean;
  qualityGatePassed: boolean;
  releaseEligible: boolean;
  softTargetPassed: boolean;
  hardLimitPassed: boolean;
  generatedAt: string;
  sourceCount: number;
  holdoutSha256: string;
  evaluatorVersion?: string;
  evaluatorSha256?: string;
  qualityEvidenceSha256?: string;
  learningCurveSha256?: string;
  evidenceBindings?: {
    holdoutSha256: string;
    evaluatorVersion: string;
    evaluatorSha256: string;
    qualityEvidenceSha256: string;
    learningCurveSha256: string;
  };
  degradedReason?: string;
}

export interface TrainReport {
  generatedAt: string;
  profile: TrainProfile;
  verifiedOnly: true;
  outputFile: string;
  manifestFile: string;
  sourceCount: number;
  documentCount: number;
  rawFragmentCount: number;
  canonicalFragmentCount: number;
  exactDuplicatesMerged: number;
  nearDuplicatesRemoved: number;
  rawExactDuplicates: number;
  rawNearDuplicates: number;
  languageRejectedFragments: number;
  rawExactDuplicateRate: number;
  rawNearDuplicateRate: number;
  residualExactDuplicateRate: number;
  residualNearDuplicateRate: number;
  cleanPoolBytes: number;
  availableCleanPoolBytes: number;
  trainingSlice: TrainingSliceSummary;
  trainingHoldoutOverlap: number;
  modelBytes: number;
  totalEntries: number;
  totalPredictions: number;
  characterEntries: number;
  wordEntries: number;
  entriesByCharacterOrder: Record<string, number>;
  modelBudget: ModelBudgetSummary;
  categoryDistribution: Record<string, { weightedBytes: number; ratio: string }>;
  webDomainDistribution: Record<string, { weightedBytes: number; ratio: string }>;
  governance: {
    safetyGatePassed: boolean;
    hardLimitPassed: boolean;
    softTargetPassed: boolean;
    qualityGatePassed: boolean;
    releaseEligible: boolean;
    degradedAllowed: boolean;
    errors: string[];
    warnings: string[];
  };
  inputManifestHash: string;
  modelSha256: string;
  sourceInputs: Array<{
    id: string;
    path: string;
    kind: SourceKind;
    category: string;
    licenseId: string;
    acquiredAt: string;
    cleanerVersion: string;
    contentSha256: string;
    files: number;
    logicalDocuments: number;
  }>;
  holdoutQuality: HoldoutQualitySummary;
  fullModelFindings: string[];
}

export interface CliOptions {
  profile: TrainProfile;
  dryRun: boolean;
  allowVerifiedDegraded: boolean;
  qualityReportPath?: string;
  candidateDir?: string;
  trainingPoolBytes?: number;
  /** Explicit allow-list used by auditable candidate pipelines. Not exposed by the publisher CLI. */
  sourceIds?: readonly string[];
  /** Vitest-only deterministic cap; never exposed by the CLI or publisher. */
  testDocumentLimit?: number;
}

export interface TrainingBuild {
  report: TrainReport;
  manifest: BaselineManifest;
  serialized: string;
  selectionManifest: TrainingSelectionManifest;
}

const CORPUS_DIR = path.join(__dirname, 'corpus');
const REPOSITORY_ROOT = path.resolve(CORPUS_DIR, '..', '..');
const CONFIG_PATH = path.join(CORPUS_DIR, 'corpus.config.json');
export const WEB_LOCAL_MAX_BYTES = 6 * 1024 * 1024;
export const WEB_LOCAL_SOFT_TARGET_BYTES = Math.floor(5.7 * 1024 * 1024);
export const WEB_LOCAL_SOFT_TARGET_MAX_BYTES = WEB_LOCAL_MAX_BYTES;
/** @deprecated The verified trainer uses document-frequency gates. */
export const WEB_LOCAL_MIN_COUNT = 3;
const DEFAULT_GENERATED_AT = '2026-07-10T00:00:00.000Z';
const MIN_VALID_ENTRIES = 100;
const MODEL_COUNT_SCALE = 1000;
const HEX_RE = /^[0-9a-f]+$/i;

export function runTraining(
  argv: string[] = process.argv.slice(2),
  testOverrides: Pick<CliOptions, 'testDocumentLimit'> = {},
): TrainReport {
  const options = { ...parseCli(argv), ...testOverrides };
  if (!options.candidateDir && !options.dryRun && process.env.VITEST !== 'true') {
    throw new Error(
      'The v4 public trainer is archived; use --candidate-dir for diagnostics or the Public V2S pipeline for publication.',
    );
  }
  const build = buildVerifiedBaseline(options);

  if (
    !build.report.governance.safetyGatePassed ||
    !build.report.governance.hardLimitPassed ||
    !build.report.governance.softTargetPassed
  ) {
    throw new Error(`Training safety gates failed:\n${build.report.governance.errors.join('\n')}`);
  }

  if (options.candidateDir) {
    if (!options.allowVerifiedDegraded) {
      throw new Error('--candidate-dir requires --allow-verified-degraded.');
    }
    if (!options.dryRun) publishCandidateBuild(build, options.profile, options.candidateDir);
  } else if (!build.report.governance.releaseEligible && !options.dryRun) {
    throw new Error(
      `Release eligibility gates failed; official assets were not replaced:\n` +
        build.report.governance.errors.join('\n'),
    );
  } else if (!options.dryRun) {
    publishBuild(build, options.profile);
  }

  printSummary(build.report, options);
  return build.report;
}

export function buildVerifiedBaseline(options: CliOptions): TrainingBuild {
  if (options.testDocumentLimit !== undefined && process.env.NODE_ENV !== 'test') {
    throw new Error('testDocumentLimit is available only under NODE_ENV=test.');
  }
  const config = readJson<CorpusConfig>(CONFIG_PATH);
  validateConfig(config);
  const profileConfig = config.profiles[options.profile];
  const provenancePath = path.join(CORPUS_DIR, config.provenanceFile);
  const holdoutPath = path.join(CORPUS_DIR, config.holdoutFile);
  const provenance = readJson<ProvenanceManifest>(provenancePath);
  const holdout = readJson<FormalHoldout>(holdoutPath);
  validateHoldout(holdout);

  const errors: string[] = [];
  const warnings: string[] = [];
  const loaded = loadVerifiedDocuments(config, provenance, errors, options.sourceIds);
  const documents = options.testDocumentLimit
    ? selectBalancedTestDocuments(loaded.documents, options.testDocumentLimit)
    : loaded.documents;
  const { sourceInputs } = loaded;
  if (documents.length === 0) errors.push('No approved training documents were found.');

  const fragmentBuild = buildCanonicalFragments(documents, config, errors, warnings);
  const trainingSelection = selectTrainingFragments(
    fragmentBuild.fragments,
    options.trainingPoolBytes,
    documents,
  );
  const trainingFragments = trainingSelection.fragments;
  if (trainingSelection.summary.insufficient) {
    errors.push(
      `Requested training slice is ${trainingSelection.summary.requestedBytes} bytes, but only ` +
        `${trainingSelection.summary.availableBytes} approved canonical bytes are available.`,
    );
  }
  const rawExactDuplicateRate = rate(
    fragmentBuild.rawExactDuplicates,
    fragmentBuild.rawFragmentCount,
  );
  const rawNearDuplicateRate = rate(
    fragmentBuild.rawNearDuplicates,
    fragmentBuild.rawFragmentCount,
  );
  const duplicateAudit = auditResidualDuplicates(trainingFragments);
  if (rawExactDuplicateRate > config.exactDuplicateRateLimit) {
    errors.push(
      `Raw exact duplicate rate ${(rawExactDuplicateRate * 100).toFixed(2)}% exceeds ` +
        `${config.exactDuplicateRateLimit * 100}%.`,
    );
  }
  if (duplicateAudit.exactRate > config.exactDuplicateRateLimit) {
    errors.push(
      `Residual exact duplicate rate ${(duplicateAudit.exactRate * 100).toFixed(2)}% exceeds ` +
        `${config.exactDuplicateRateLimit * 100}%.`,
    );
  }
  if (duplicateAudit.nearRate > config.nearDuplicateRateLimit) {
    errors.push(
      `Residual near-duplicate rate ${(duplicateAudit.nearRate * 100).toFixed(2)}% exceeds ` +
        `${config.nearDuplicateRateLimit * 100}%.`,
    );
  }
  const overlaps = findTrainingHoldoutOverlap(fragmentBuild.fragments, holdout);
  if (overlaps.length > 0) {
    errors.push(
      `Training/holdout overlap detected (${overlaps.length}): ${overlaps.slice(0, 5).join(', ')}`,
    );
  }

  const categoryDistribution = buildContributionDistribution(
    trainingFragments,
    (item) => item.category,
  );
  const webDomainDistribution = buildContributionDistribution(trainingFragments, (item) =>
    item.kind === 'web' ? (item.domain ?? 'missing-domain') : null,
  );
  validateDistribution(categoryDistribution, config.categoryDominanceLimit, 'category', errors);
  validateDistribution(webDomainDistribution, config.webDomainDominanceLimit, 'web domain', errors);

  const characterTrainingTable = scanFragments(
    trainingFragments,
    config.ngramOrders,
    config.ngramN,
  );
  const wordTrainingTable = scanWordFragments(trainingFragments, config.wordNgramOrders);
  const distilled = distillBaselineTables(
    characterTrainingTable,
    wordTrainingTable,
    config.maxPredsPerContext,
    config.modelTargetBytes,
  );
  const model = distilled.character;
  const wordModel = distilled.word;
  const serialized = serializeBaselineTables({ character: model, word: wordModel });
  const modelBytes = Buffer.byteLength(serialized, 'utf8');
  if (modelBytes !== distilled.budget.retainedBytes) {
    errors.push(
      `Budget accounting mismatch (${distilled.budget.retainedBytes} expected, ${modelBytes} serialized).`,
    );
  }
  if (distilled.budget.evictedEntries > 0) {
    warnings.push(
      `Global model budget evicted ${distilled.budget.evictedEntries} entries ` +
        `(${distilled.budget.evictedBytes} serialized bytes).`,
    );
  }
  const hardLimitPassed = modelBytes <= config.hardMaxBytes;
  const softTargetPassed = modelBytes <= config.modelTargetBytes;
  if (!hardLimitPassed) {
    errors.push(`Model is ${modelBytes} bytes; hard cap is ${config.hardMaxBytes}.`);
  }
  if (!softTargetPassed) {
    errors.push(`Model is ${modelBytes} bytes; target budget is ${config.modelTargetBytes}.`);
  }
  if (model.size + wordModel.size < MIN_VALID_ENTRIES) {
    errors.push(
      `Model has ${model.size + wordModel.size} entries; minimum is ${MIN_VALID_ENTRIES}.`,
    );
  }

  const fullModelFindings = auditSectionedModel(
    serialized,
    model,
    wordModel,
    Math.min(...config.ngramOrders),
    config.ngramN,
  );
  if (fullModelFindings.length > 0) {
    errors.push(`Full-model audit failed: ${fullModelFindings.slice(0, 5).join('; ')}`);
  }

  const inputManifest = buildInputManifest(
    options.profile,
    config,
    provenance,
    holdout,
    sourceInputs,
    trainingSelection.summary,
  );
  const inputManifestHash = sha256(canonicalJson(inputManifest));
  const modelSha256 = sha256(serialized);
  const safetyGatePassed = errors.length === 0;
  const holdoutQuality = evaluateHoldoutQualityEvidence(
    options.qualityReportPath,
    options.profile,
    modelSha256,
    inputManifestHash,
    holdout,
    config.qualityGate,
  );
  errors.push(...holdoutQuality.errors);

  const releaseEligible =
    safetyGatePassed && hardLimitPassed && softTargetPassed && holdoutQuality.passed;
  const generatedAt = config.manifestGeneratedAt ?? DEFAULT_GENERATED_AT;
  const predictionCount = [...model.values(), ...wordModel.values()].reduce(
    (sum, preds) => sum + [...preds.keys()].filter((next) => next !== '\u0000').length,
    0,
  );
  const entriesByCharacterOrder = countEntriesByCodePointLength(model);
  const degradedReason = releaseEligible
    ? undefined
    : !safetyGatePassed
      ? 'training-governance-gate-not-passed'
      : !holdoutQuality.passed
        ? 'holdout-quality-gate-not-passed'
        : 'model-target-budget-not-met';
  const manifest: BaselineManifest = {
    schemaVersion: 2,
    profile: options.profile,
    modelFile: path.basename(profileConfig.outputFile),
    serialization: 'sectioned-jsonl-hex-v4',
    order: 'section-profile-context-hex',
    ngramN: config.ngramN,
    minNgramN: Math.min(...config.ngramOrders),
    wordNgramOrders: [...config.wordNgramOrders],
    countScale: MODEL_COUNT_SCALE,
    modelBytes,
    entryCount: model.size + wordModel.size,
    characterEntryCount: model.size,
    wordEntryCount: wordModel.size,
    sha256: modelSha256,
    trainingInputHash: inputManifestHash,
    verifiedOnly: true,
    runtimeEligible: safetyGatePassed && hardLimitPassed && softTargetPassed,
    qualityGatePassed: holdoutQuality.passed,
    releaseEligible,
    softTargetPassed,
    hardLimitPassed,
    generatedAt,
    sourceCount: sourceInputs.length,
    holdoutSha256: holdoutQuality.holdoutSha256,
    ...(holdoutQuality.evaluatorVersion
      ? { evaluatorVersion: holdoutQuality.evaluatorVersion }
      : {}),
    ...(holdoutQuality.qualityEvidenceSha256
      ? { qualityEvidenceSha256: holdoutQuality.qualityEvidenceSha256 }
      : {}),
    ...(holdoutQuality.learningCurveSha256
      ? { learningCurveSha256: holdoutQuality.learningCurveSha256 }
      : {}),
    ...(degradedReason ? { degradedReason } : {}),
  };

  const report: TrainReport = {
    generatedAt,
    profile: options.profile,
    verifiedOnly: true,
    outputFile: profileConfig.outputFile,
    manifestFile: profileConfig.manifestFile,
    sourceCount: sourceInputs.length,
    documentCount: documents.length,
    rawFragmentCount: fragmentBuild.rawFragmentCount,
    canonicalFragmentCount: trainingFragments.length,
    exactDuplicatesMerged: fragmentBuild.exactDuplicatesMerged,
    nearDuplicatesRemoved: fragmentBuild.nearDuplicatesRemoved,
    rawExactDuplicates: fragmentBuild.rawExactDuplicates,
    rawNearDuplicates: fragmentBuild.rawNearDuplicates,
    languageRejectedFragments: fragmentBuild.languageRejectedFragments,
    rawExactDuplicateRate,
    rawNearDuplicateRate,
    residualExactDuplicateRate: duplicateAudit.exactRate,
    residualNearDuplicateRate: duplicateAudit.nearRate,
    cleanPoolBytes: trainingSelection.summary.realizedBytes,
    availableCleanPoolBytes: fragmentBuild.cleanPoolBytes,
    trainingSlice: trainingSelection.summary,
    trainingHoldoutOverlap: overlaps.length,
    modelBytes,
    totalEntries: model.size + wordModel.size,
    totalPredictions: predictionCount,
    characterEntries: model.size,
    wordEntries: wordModel.size,
    entriesByCharacterOrder,
    modelBudget: distilled.budget,
    categoryDistribution: toReportDistribution(categoryDistribution),
    webDomainDistribution: toReportDistribution(webDomainDistribution),
    governance: {
      safetyGatePassed,
      hardLimitPassed,
      softTargetPassed,
      qualityGatePassed: holdoutQuality.passed,
      releaseEligible,
      degradedAllowed: options.allowVerifiedDegraded && safetyGatePassed && hardLimitPassed,
      errors,
      warnings,
    },
    inputManifestHash,
    modelSha256,
    sourceInputs,
    holdoutQuality,
    fullModelFindings,
  };
  return { report, manifest, serialized, selectionManifest: trainingSelection.manifest };
}

function selectBalancedTestDocuments(
  documents: readonly SourceDocument[],
  limit: number,
): SourceDocument[] {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error('testDocumentLimit must be a positive safe integer.');
  }
  const buckets = new Map<string, SourceDocument[]>();
  for (const document of documents) {
    const bucket = buckets.get(document.source.category) ?? [];
    bucket.push(document);
    buckets.set(document.source.category, bucket);
  }
  const categories = [...buckets.keys()].sort((left, right) => left.localeCompare(right, 'en'));
  const offsets = new Map(categories.map((category) => [category, 0]));
  const selected: SourceDocument[] = [];
  while (selected.length < Math.min(limit, documents.length)) {
    let progressed = false;
    for (const category of categories) {
      const bucket = buckets.get(category)!;
      const offset = offsets.get(category) ?? 0;
      const document = bucket[offset];
      if (!document) continue;
      selected.push(document);
      offsets.set(category, offset + 1);
      progressed = true;
      if (selected.length >= limit) break;
    }
    if (!progressed) break;
  }
  return selected;
}

function loadVerifiedDocuments(
  config: CorpusConfig,
  provenance: ProvenanceManifest,
  errors: string[],
  sourceIds?: readonly string[],
): {
  documents: SourceDocument[];
  sourceInputs: TrainReport['sourceInputs'];
} {
  if (provenance.schemaVersion !== 1) errors.push('Unsupported provenance schema.');
  const provenanceById = new Map(provenance.sources.map((source) => [source.id, source]));
  const documents: SourceDocument[] = [];
  const sourceInputs: TrainReport['sourceInputs'] = [];
  const seenDocumentPaths = new Set<string>();
  const requestedSourceIds = normalizeSourceSet(sourceIds, config.sources);
  const selectedSources = [...config.sources]
    .filter((source) => !requestedSourceIds || requestedSourceIds.has(source.id))
    .sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const selectedSourcePaths = selectedSources.map((source) => normalizeRelativePath(source.path));
  const excludedTrainingFiles = new Set(
    config.excludedTrainingFiles
      .map((item) => normalizeRelativePath(item))
      .filter((item) =>
        selectedSourcePaths.some(
          (sourcePath) =>
            item === sourcePath || item.startsWith(`${sourcePath.replace(/\/$/u, '')}/`),
        ),
      ),
  );
  const exclusionsSeen = new Set<string>();

  for (const source of selectedSources) {
    validateSourceConfig(source, errors);
    const normalizedPath = normalizeRelativePath(source.path);
    if (isForbiddenSourcePath(normalizedPath)) {
      errors.push(`${source.id}: forbidden source path ${source.path}`);
      continue;
    }
    const provenanceSource = provenanceById.get(source.id);
    if (!provenanceSource) {
      errors.push(`${source.id}: missing provenance entry.`);
      continue;
    }
    if (
      provenanceSource.approval !== 'approved' ||
      !provenanceSource.licenseId ||
      provenanceSource.licenseId.toLowerCase() === 'unknown' ||
      !provenanceSource.licenseEvidence ||
      !isIsoTimestamp(provenanceSource.acquiredAt) ||
      !/^[a-z0-9][a-z0-9._-]{2,63}$/iu.test(provenanceSource.cleanerVersion)
    ) {
      errors.push(`${source.id}: license provenance is not approved.`);
      continue;
    }
    if (
      normalizeRelativePath(provenanceSource.path) !== normalizedPath ||
      provenanceSource.kind !== source.kind
    ) {
      errors.push(`${source.id}: config/provenance identity mismatch.`);
      continue;
    }
    const licenseEvidence = path.resolve(CORPUS_DIR, provenanceSource.licenseEvidence);
    if (!fs.existsSync(licenseEvidence)) {
      errors.push(`${source.id}: license evidence does not exist.`);
      continue;
    }
    if (!isWithin(fs.realpathSync(licenseEvidence), fs.realpathSync(REPOSITORY_ROOT))) {
      errors.push(`${source.id}: license evidence escapes the repository workspace.`);
      continue;
    }
    const absoluteSourcePath = resolveCorpusSource(normalizedPath, source.kind, errors, source.id);
    if (!absoluteSourcePath) continue;
    const discoveredFiles = listTrainingFiles(absoluteSourcePath);
    const files = discoveredFiles.filter((file) => {
      const relativePath = normalizeRelativePath(path.relative(CORPUS_DIR, file));
      if (!excludedTrainingFiles.has(relativePath)) return true;
      exclusionsSeen.add(relativePath);
      return false;
    });
    if (files.length === 0) {
      errors.push(`${source.id}: approved input contains no .md/.txt/.jsonl files.`);
      continue;
    }
    const actualSourceHash = hashSourceFiles(absoluteSourcePath, files);
    if (!isSha256(provenanceSource.contentSha256)) {
      errors.push(`${source.id}: provenance contentSha256 is missing or invalid.`);
      continue;
    }
    if (actualSourceHash !== provenanceSource.contentSha256.toLowerCase()) {
      errors.push(
        `${source.id}: source hash mismatch (expected ${provenanceSource.contentSha256}, actual ${actualSourceHash}).`,
      );
      continue;
    }

    let logicalDocuments = 0;
    const packedDocumentIds = new Set<string>();
    for (const absolutePath of files) {
      const relativePath = normalizeRelativePath(path.relative(CORPUS_DIR, absolutePath));
      if (seenDocumentPaths.has(relativePath)) {
        errors.push(`${source.id}: overlapping source path reuses ${relativePath}.`);
        continue;
      }
      seenDocumentPaths.add(relativePath);
      const fileBuffer = fs.readFileSync(absolutePath);
      const fileText = fileBuffer.toString('utf8');
      if (source.documentFormat === 'jsonl') {
        const packed = parsePackedSourceDocuments(
          source,
          absolutePath,
          relativePath,
          fileText,
          packedDocumentIds,
          errors,
        );
        documents.push(...packed);
        logicalDocuments += packed.length;
      } else {
        if (/\.jsonl$/iu.test(absolutePath)) {
          errors.push(`${source.id}: JSONL input requires documentFormat=jsonl.`);
          continue;
        }
        documents.push({
          id: `${source.id}:${relativePath}`,
          relativePath,
          absolutePath,
          source,
          sha256: sha256(fileBuffer),
          text: fileText,
        });
        logicalDocuments++;
      }
    }
    sourceInputs.push({
      id: source.id,
      path: normalizedPath,
      kind: source.kind,
      category: source.category,
      licenseId: provenanceSource.licenseId,
      acquiredAt: provenanceSource.acquiredAt,
      cleanerVersion: provenanceSource.cleanerVersion,
      contentSha256: actualSourceHash,
      files: files.length,
      logicalDocuments,
    });
  }
  for (const excludedPath of excludedTrainingFiles) {
    if (!exclusionsSeen.has(excludedPath)) {
      errors.push(`Excluded training file was not found in an approved source: ${excludedPath}.`);
    }
  }
  return { documents, sourceInputs };
}

function normalizeSourceSet(
  sourceIds: readonly string[] | undefined,
  configuredSources: readonly SourceConfig[],
): Set<string> | null {
  if (sourceIds === undefined) return null;
  if (sourceIds.length === 0) throw new Error('sourceIds must contain at least one source.');
  const normalized = new Set<string>();
  for (const sourceId of sourceIds) {
    if (!/^[a-z0-9][a-z0-9._-]{2,95}$/iu.test(sourceId) || normalized.has(sourceId)) {
      throw new Error(`sourceIds contains an invalid or duplicate source: ${sourceId}.`);
    }
    normalized.add(sourceId);
  }
  const configured = new Set(configuredSources.map((source) => source.id));
  const unknown = [...normalized].filter((sourceId) => !configured.has(sourceId));
  if (unknown.length > 0) {
    throw new Error(`sourceIds contains unconfigured sources: ${unknown.join(', ')}.`);
  }
  return normalized;
}

interface PackedSourceRecord {
  documentId: string;
  text: string;
  family: string;
}

function parsePackedSourceDocuments(
  source: SourceConfig,
  absolutePath: string,
  relativePath: string,
  fileText: string,
  documentIds: Set<string>,
  errors: string[],
): SourceDocument[] {
  if (!/\.jsonl$/iu.test(absolutePath)) {
    errors.push(`${source.id}: documentFormat=jsonl only accepts .jsonl packs.`);
    return [];
  }
  const documents: SourceDocument[] = [];
  const lines = fileText.replace(/^\uFEFF/u, '').split(/\r?\n/u);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim();
    if (!line) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line) as unknown;
    } catch {
      errors.push(`${relativePath}:${index + 1}: invalid JSONL record.`);
      continue;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`${relativePath}:${index + 1}: packed record must be an object.`);
      continue;
    }
    const record = raw as Partial<PackedSourceRecord>;
    if (
      typeof record.documentId !== 'string' ||
      !/^[a-z0-9][a-z0-9._-]{5,95}$/iu.test(record.documentId) ||
      typeof record.text !== 'string' ||
      !record.text.trim() ||
      /[\r\n]/u.test(record.text) ||
      typeof record.family !== 'string' ||
      !record.family.trim()
    ) {
      errors.push(`${relativePath}:${index + 1}: packed record schema is invalid.`);
      continue;
    }
    if (documentIds.has(record.documentId)) {
      errors.push(`${source.id}: duplicate packed documentId ${record.documentId}.`);
      continue;
    }
    documentIds.add(record.documentId);
    documents.push({
      id: `${source.id}:${record.documentId}`,
      relativePath: `${relativePath}#${record.documentId}`,
      absolutePath,
      source,
      sha256: sha256(record.text),
      text: record.text,
    });
  }
  if (documents.length === 0) {
    errors.push(`${source.id}: JSONL pack ${relativePath} contains no valid documents.`);
  }
  return documents;
}

function buildCanonicalFragments(
  documents: SourceDocument[],
  config: CorpusConfig,
  errors: string[],
  warnings: string[],
): {
  fragments: CanonicalFragment[];
  rawFragmentCount: number;
  exactDuplicatesMerged: number;
  nearDuplicatesRemoved: number;
  rawExactDuplicates: number;
  rawNearDuplicates: number;
  languageRejectedFragments: number;
  cleanPoolBytes: number;
} {
  const exactFragments = new Map<string, CanonicalFragment>();
  const nearFragments = new Set<string>();
  const rawExactKeys = new Set<string>();
  const rawNearKeys = new Set<string>();
  let rawFragmentCount = 0;
  let exactDuplicatesMerged = 0;
  let nearDuplicatesRemoved = 0;
  let rawExactDuplicates = 0;
  let rawNearDuplicates = 0;
  let languageRejectedFragments = 0;
  let cleanPoolBytes = 0;
  const languageMismatchSamples: string[] = [];

  for (const document of documents.sort((a, b) => a.id.localeCompare(b.id, 'en'))) {
    for (const fragmentText of splitTrainingUnits(document.text, config.ngramN)) {
      rawFragmentCount++;
      const rawExactKey = normalizeCorpusFragment(fragmentText);
      const rawNearKey = nearDuplicateCorpusKey(fragmentText);
      let isRawExactDuplicate = false;
      if (rawExactKey) {
        if (rawExactKeys.has(rawExactKey)) {
          rawExactDuplicates++;
          isRawExactDuplicate = true;
        } else rawExactKeys.add(rawExactKey);
      }
      if (rawNearKey.length >= 12) {
        if (rawNearKeys.has(rawNearKey) && !isRawExactDuplicate) rawNearDuplicates++;
        else rawNearKeys.add(rawNearKey);
      }
      const detectedLanguage = detectTrainingLanguage(fragmentText);
      if (
        detectedLanguage === 'mixed' ||
        (detectedLanguage !== 'unknown' && detectedLanguage !== document.source.language)
      ) {
        languageRejectedFragments++;
        if (languageMismatchSamples.length < 10) {
          languageMismatchSamples.push(
            `${document.relativePath} (${detectedLanguage} != ${document.source.language})`,
          );
        }
        continue;
      }
      const findings = findForbiddenCorpusText(fragmentText);
      if (findings.length > 0) {
        errors.push(
          `${document.relativePath}: forbidden ${findings[0]!.type} text (${findings[0]!.rule}).`,
        );
        continue;
      }
      const exactKey = normalizeCorpusFragment(fragmentText);
      const nearKey = nearDuplicateCorpusKey(fragmentText);
      if (!exactKey) continue;
      const contribution = {
        sourceId: document.source.id,
        kind: document.source.kind,
        language: document.source.language,
        weightMilli: document.source.weightMilli,
        minDocumentFrequency: document.source.minDocumentFrequency,
        category: document.source.category,
        domain: document.source.domain,
      };
      const existing = exactFragments.get(exactKey);
      if (existing) {
        exactDuplicatesMerged++;
        existing.contributions.set(document.id, contribution);
        continue;
      }
      if (nearKey.length >= 12 && nearFragments.has(nearKey)) {
        nearDuplicatesRemoved++;
        continue;
      }
      cleanPoolBytes += Buffer.byteLength(fragmentText, 'utf8');
      const fragment: CanonicalFragment = {
        text: fragmentText,
        exactKey,
        nearKey,
        contributions: new Map([[document.id, contribution]]),
      };
      exactFragments.set(exactKey, fragment);
      if (nearKey.length >= 12) nearFragments.add(nearKey);
    }
  }
  if (cleanPoolBytes > config.maxCleanPoolBytes) {
    errors.push(`Clean pool is ${cleanPoolBytes} bytes; cap is ${config.maxCleanPoolBytes}.`);
  }
  if (languageRejectedFragments > 0) {
    warnings.push(
      `Rejected ${languageRejectedFragments} language-mismatched fragments: ` +
        languageMismatchSamples.join(', '),
    );
  }
  return {
    fragments: [...exactFragments.values()].sort((a, b) =>
      a.exactKey.localeCompare(b.exactKey, 'en'),
    ),
    rawFragmentCount,
    exactDuplicatesMerged,
    nearDuplicatesRemoved,
    rawExactDuplicates,
    rawNearDuplicates,
    languageRejectedFragments,
    cleanPoolBytes,
  };
}

const TRAINING_SLICE_SAMPLER_VERSION = 'nested-category-round-robin-v1' as const;

export interface NestedTrainingSampleItem {
  id: string;
  category: string;
  bytes: number;
}

/**
 * Produces one deterministic global order. Every configured byte tier takes a
 * prefix of this same order, so a smaller tier can never contain data missing
 * from a larger tier.
 */
export function orderNestedTrainingSample<T extends NestedTrainingSampleItem>(
  items: readonly T[],
): T[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    if (!item.id || !item.category || !Number.isSafeInteger(item.bytes) || item.bytes <= 0) {
      throw new Error('Nested training sample items require an id, category, and positive bytes.');
    }
    const bucket = buckets.get(item.category) ?? [];
    bucket.push(item);
    buckets.set(item.category, bucket);
  }
  const categories = [...buckets.keys()].sort((a, b) => a.localeCompare(b, 'en'));
  for (const category of categories) {
    buckets.get(category)!.sort((a, b) => {
      const left = sha256(`${TRAINING_SLICE_SAMPLER_VERSION}\0${category}\0${a.id}`);
      const right = sha256(`${TRAINING_SLICE_SAMPLER_VERSION}\0${category}\0${b.id}`);
      return left.localeCompare(right, 'en') || a.id.localeCompare(b.id, 'en');
    });
  }
  const offsets = new Map(categories.map((category) => [category, 0]));
  const ordered: T[] = [];
  let remaining = items.length;
  while (remaining > 0) {
    for (const category of categories) {
      const bucket = buckets.get(category)!;
      const offset = offsets.get(category)!;
      const item = bucket[offset];
      if (!item) continue;
      ordered.push(item);
      offsets.set(category, offset + 1);
      remaining--;
    }
  }
  return ordered;
}

export function selectNestedTrainingSample<T extends NestedTrainingSampleItem>(
  items: readonly T[],
  requestedBytes?: number,
): { selected: T[]; availableBytes: number; realizedBytes: number; insufficient: boolean } {
  if (
    requestedBytes !== undefined &&
    (!Number.isSafeInteger(requestedBytes) || requestedBytes <= 0)
  ) {
    throw new Error('trainingPoolBytes must be a positive safe integer.');
  }
  const ordered = orderNestedTrainingSample(items);
  const availableBytes = ordered.reduce((sum, item) => sum + item.bytes, 0);
  if (requestedBytes === undefined) {
    return {
      selected: ordered,
      availableBytes,
      realizedBytes: availableBytes,
      insufficient: false,
    };
  }
  const selected: T[] = [];
  let realizedBytes = 0;
  for (const item of ordered) {
    if (realizedBytes + item.bytes > requestedBytes) break;
    selected.push(item);
    realizedBytes += item.bytes;
  }
  return {
    selected,
    availableBytes,
    realizedBytes,
    insufficient: availableBytes < requestedBytes,
  };
}

function selectTrainingFragments(
  fragments: CanonicalFragment[],
  requestedBytes?: number,
  documents: readonly SourceDocument[] = [],
): {
  fragments: CanonicalFragment[];
  summary: TrainingSliceSummary;
  manifest: TrainingSelectionManifest;
} {
  const sampleItems = fragments.map((fragment) => ({
    id: fragment.exactKey,
    category: primaryFragmentCategory(fragment),
    bytes: Buffer.byteLength(fragment.text, 'utf8'),
    fragment,
  }));
  const selection = selectNestedTrainingSample(sampleItems, requestedBytes);
  const selectedFragments = selection.selected.map((item) => item.fragment);
  const availableDocuments = countFragmentDocuments(fragments);
  const selectedDocuments = countFragmentDocuments(selectedFragments);
  const documentIdentity = new Map(
    documents.map((document) => [document.id, document.sha256] as const),
  );
  const selectedDocumentIds = new Set<string>();
  const fragmentMembers = selection.selected.map(({ id, category, bytes, fragment }) => {
    const contributionDocuments = [...fragment.contributions.keys()].sort((a, b) =>
      a.localeCompare(b, 'en'),
    );
    for (const documentId of contributionDocuments) selectedDocumentIds.add(documentId);
    return {
      idSha256: sha256(id),
      contentSha256: sha256(fragment.text),
      category,
      bytes,
      documents: contributionDocuments,
    };
  });
  const manifest: TrainingSelectionManifest = {
    schemaVersion: 1,
    samplerVersion: TRAINING_SLICE_SAMPLER_VERSION,
    documents: [...selectedDocumentIds]
      .sort((a, b) => a.localeCompare(b, 'en'))
      .map((id) => {
        const contentSha256 = documentIdentity.get(id);
        if (!contentSha256) throw new Error(`Selected training document has no identity: ${id}.`);
        return { id, contentSha256 };
      }),
    fragments: fragmentMembers,
  };
  return {
    fragments: selectedFragments,
    summary: {
      samplerVersion: TRAINING_SLICE_SAMPLER_VERSION,
      requestedBytes: requestedBytes ?? null,
      availableBytes: selection.availableBytes,
      realizedBytes: selection.realizedBytes,
      shortfallBytes:
        requestedBytes === undefined ? 0 : Math.max(0, requestedBytes - selection.realizedBytes),
      availableFragments: fragments.length,
      selectedFragments: selectedFragments.length,
      availableDocuments,
      selectedDocuments,
      selectionManifestHash: sha256(canonicalJson(manifest)),
      insufficient: selection.insufficient,
    },
    manifest,
  };
}

function primaryFragmentCategory(fragment: CanonicalFragment): string {
  return (
    [...new Set([...fragment.contributions.values()].map((item) => item.category))].sort((a, b) =>
      a.localeCompare(b, 'en'),
    )[0] ?? 'uncategorized'
  );
}

function countFragmentDocuments(fragments: readonly CanonicalFragment[]): number {
  const documents = new Set<string>();
  for (const fragment of fragments) {
    for (const documentId of fragment.contributions.keys()) documents.add(documentId);
  }
  return documents.size;
}

function scanFragments(
  fragments: CanonicalFragment[],
  orders: readonly number[],
  maxOrder: number,
): TrainingTable {
  const table: TrainingTable = new Map();
  for (const fragment of fragments) {
    const points = Array.from(fragment.text);
    for (const order of orders) {
      const supportAdjustment = maxOrder - order;
      for (let index = 0; index < points.length - order; index++) {
        const context = points.slice(index, index + order).join('');
        const next = points[index + order];
        if (!next) continue;
        addFragmentTransition(table, context, next, fragment.contributions, supportAdjustment);
      }
    }
  }
  return table;
}

function scanWordFragments(
  fragments: CanonicalFragment[],
  orders: readonly number[],
): TrainingTable {
  const table: TrainingTable = new Map();
  const maxOrder = Math.max(...orders);
  for (const fragment of fragments) {
    const englishContributions = new Map(
      [...fragment.contributions].filter(([, contribution]) => contribution.language === 'en'),
    );
    if (englishContributions.size === 0) continue;
    const tokens = tokenizeEnglishWords(fragment.text);
    for (const order of orders) {
      const supportAdjustment = maxOrder - order;
      for (let index = order; index < tokens.length; index++) {
        const context = wordContext(tokens.slice(index - order, index));
        const next = tokens[index];
        if (!context || !next) continue;
        addFragmentTransition(table, context, next, englishContributions, supportAdjustment);
      }
    }
  }
  return table;
}

function addFragmentTransition(
  table: TrainingTable,
  context: string,
  next: string,
  contributions: ReadonlyMap<string, FragmentContribution>,
  supportAdjustment: number,
): void {
  const predictions = table.get(context) ?? new Map<string, TransitionStats>();
  const stats = predictions.get(next) ?? {
    count: 0,
    documentsBySource: new Map<string, Set<string>>(),
    minDocumentFrequencyBySource: new Map<string, number>(),
    weightMilliBySource: new Map<string, number>(),
  };
  for (const [documentId, contribution] of contributions) {
    const nextCount = stats.count + contribution.weightMilli;
    if (!Number.isSafeInteger(nextCount)) {
      throw new Error(`Transition count exceeds the safe integer range for ${context}.`);
    }
    stats.count = nextCount;
    const documents = stats.documentsBySource.get(contribution.sourceId) ?? new Set<string>();
    documents.add(documentId);
    stats.documentsBySource.set(contribution.sourceId, documents);
    const minimum = contribution.minDocumentFrequency + supportAdjustment;
    const configuredMinimum = stats.minDocumentFrequencyBySource.get(contribution.sourceId);
    if (configuredMinimum !== undefined && configuredMinimum !== minimum) {
      throw new Error(
        `Conflicting minDocumentFrequency values for source ${contribution.sourceId}.`,
      );
    }
    stats.minDocumentFrequencyBySource.set(contribution.sourceId, minimum);
    const configuredWeight = stats.weightMilliBySource?.get(contribution.sourceId);
    if (configuredWeight !== undefined && configuredWeight !== contribution.weightMilli) {
      throw new Error(`Conflicting weightMilli values for source ${contribution.sourceId}.`);
    }
    stats.weightMilliBySource?.set(contribution.sourceId, contribution.weightMilli);
  }
  predictions.set(next, stats);
  table.set(context, predictions);
}

function auditResidualDuplicates(fragments: CanonicalFragment[]): {
  exactRate: number;
  nearRate: number;
} {
  if (fragments.length === 0) return { exactRate: 0, nearRate: 0 };
  const exact = new Set<string>();
  const near = new Set<string>();
  let exactDuplicates = 0;
  let nearDuplicates = 0;
  for (const fragment of fragments) {
    if (exact.has(fragment.exactKey)) exactDuplicates++;
    else exact.add(fragment.exactKey);
    if (fragment.nearKey.length < 12) continue;
    if (near.has(fragment.nearKey)) nearDuplicates++;
    else near.add(fragment.nearKey);
  }
  return {
    exactRate: exactDuplicates / fragments.length,
    nearRate: nearDuplicates / fragments.length,
  };
}

interface CandidateModelEntry {
  kind?: 'character' | 'word';
  semanticOrder?: number;
  context: string;
  contextHex: string;
  predictions: Map<string, number>;
  lineBytes: number;
  sourceSupport: number;
  documentSupport: number;
  topCount: number;
  totalCount: number;
  dominancePpm: number;
  entropyPpm: number;
  utilityPerBytePpm: number;
}

interface DistilledBaselineTables {
  character: NGramTable;
  word: WordNGramTable;
  budget: ModelBudgetSummary;
}

export function distillTrainingTable(
  table: TrainingTable,
  maxPredictions: number,
  byteBudget: number,
): DistilledModel {
  if (!Number.isSafeInteger(maxPredictions) || maxPredictions <= 0) {
    throw new Error('maxPredictions must be a positive safe integer.');
  }
  if (!Number.isSafeInteger(byteBudget) || byteBudget <= 0) {
    throw new Error('Model byte budget must be a positive safe integer.');
  }

  const candidates: CandidateModelEntry[] = [];
  for (const [context, predictions] of table) {
    for (const [next, stats] of predictions) {
      if (!Number.isSafeInteger(stats.count) || stats.count <= 0) {
        throw new Error(`Transition ${context} -> ${next} has an invalid fixed-point count.`);
      }
    }
    const eligible = [...predictions.entries()]
      .filter(([, stats]) => meetsConfiguredDocumentFrequency(stats))
      .map(([next, stats]) => ({ next, stats, effectiveCount: effectiveTransitionCount(stats) }))
      .sort(
        (a, b) =>
          b.effectiveCount - a.effectiveCount || toHex(a.next).localeCompare(toHex(b.next), 'en'),
      );
    const kept = eligible.slice(0, maxPredictions);
    if (kept.length === 0) continue;

    const retainedPredictions = new Map(
      kept.map(({ next, effectiveCount }) => [next, effectiveCount]),
    );
    const sourceIds = new Set<string>();
    const documentIds = new Set<string>();
    let totalCount = 0;
    for (const { stats, effectiveCount } of eligible) {
      totalCount += effectiveCount;
      for (const [sourceId, documents] of stats.documentsBySource) {
        sourceIds.add(sourceId);
        for (const documentId of documents) documentIds.add(documentId);
      }
    }
    const retainedCount = kept.reduce((sum, item) => sum + item.effectiveCount, 0);
    if (totalCount > retainedCount) {
      retainedPredictions.set(NGRAM_OTHER_MASS, totalCount - retainedCount);
    }
    if (!Number.isSafeInteger(totalCount) || totalCount <= 0) {
      throw new Error(`Invalid aggregate transition count for ${context}.`);
    }
    const topCount = kept[0]!.effectiveCount;
    const lineBytes = Buffer.byteLength(serializeEntry(context, retainedPredictions), 'utf8');
    const entropyPpm = normalizedEntropyPpm(eligible.map((item) => item.effectiveCount));
    const candidate: CandidateModelEntry = {
      context,
      contextHex: toHex(context),
      predictions: retainedPredictions,
      lineBytes,
      sourceSupport: sourceIds.size,
      documentSupport: documentIds.size,
      topCount,
      totalCount,
      dominancePpm: Math.floor((topCount / totalCount) * 1_000_000),
      entropyPpm,
      utilityPerBytePpm: 0,
    };
    candidate.utilityPerBytePpm = candidateUtilityPerBytePpm(candidate);
    candidates.push(candidate);
  }

  const candidatePredictions = candidates.reduce(
    (sum, candidate) => sum + visiblePredictionCount(candidate),
    0,
  );
  const candidateBytes = serializedLineBytes(candidates.map((candidate) => candidate.lineBytes));
  const ranked = [...candidates].sort(compareCandidateUtility);
  const retained: CandidateModelEntry[] = [];
  let retainedBytes = 0;
  for (const candidate of ranked) {
    const incrementalBytes = candidate.lineBytes + (retained.length > 0 ? 1 : 0);
    if (retainedBytes + incrementalBytes > byteBudget) continue;
    retained.push(candidate);
    retainedBytes += incrementalBytes;
  }

  const model: NGramTable = new Map();
  for (const candidate of retained) model.set(candidate.context, candidate.predictions);
  const retainedPredictions = retained.reduce(
    (sum, candidate) => sum + visiblePredictionCount(candidate),
    0,
  );
  const retainedSet = new Set(retained);
  const evicted = candidates.filter((candidate) => !retainedSet.has(candidate));
  return {
    model,
    budget: {
      configuredBytes: byteBudget,
      candidateEntries: candidates.length,
      retainedEntries: retained.length,
      evictedEntries: candidates.length - retained.length,
      candidatePredictions,
      retainedPredictions,
      evictedPredictions: candidatePredictions - retainedPredictions,
      candidateBytes,
      retainedBytes,
      evictedBytes: candidateBytes - retainedBytes,
      meanRetainedEntropyPpm: meanEntropyPpm(retained),
      meanEvictedEntropyPpm: meanEntropyPpm(evicted),
    },
  };
}

function distillBaselineTables(
  characterTable: TrainingTable,
  wordTable: TrainingTable,
  maxPredictions: number,
  byteBudget: number,
): DistilledBaselineTables {
  const candidates = [
    ...collectBaselineCandidates(characterTable, maxPredictions, 'character'),
    ...collectBaselineCandidates(wordTable, maxPredictions, 'word'),
  ];
  const fixedBytes = Buffer.byteLength(
    serializeBaselineTables({ character: new Map(), word: new Map() }),
    'utf8',
  );
  const candidatePredictions = candidates.reduce(
    (sum, candidate) => sum + visiblePredictionCount(candidate),
    0,
  );
  const candidateBytes =
    fixedBytes +
    serializedProfileBytes(candidates.filter((candidate) => candidate.kind === 'character')) +
    serializedProfileBytes(candidates.filter((candidate) => candidate.kind === 'word'));
  const retained: CandidateModelEntry[] = [];
  const retainedByKind = { character: 0, word: 0 };
  let retainedBytes = fixedBytes;
  for (const candidate of [...candidates].sort(compareCandidateUtility)) {
    const kind = candidate.kind ?? 'character';
    const incremental = candidate.lineBytes + (retainedByKind[kind] > 0 ? 1 : 0);
    if (retainedBytes + incremental > byteBudget) continue;
    retained.push(candidate);
    retainedByKind[kind]++;
    retainedBytes += incremental;
  }

  const character: NGramTable = new Map();
  const word: WordNGramTable = new Map();
  for (const candidate of retained) {
    (candidate.kind === 'word' ? word : character).set(candidate.context, candidate.predictions);
  }
  const actualBytes = Buffer.byteLength(serializeBaselineTables({ character, word }), 'utf8');
  const retainedPredictions = retained.reduce(
    (sum, candidate) => sum + visiblePredictionCount(candidate),
    0,
  );
  const retainedSet = new Set(retained);
  const evicted = candidates.filter((candidate) => !retainedSet.has(candidate));
  return {
    character,
    word,
    budget: {
      configuredBytes: byteBudget,
      candidateEntries: candidates.length,
      retainedEntries: retained.length,
      evictedEntries: candidates.length - retained.length,
      candidatePredictions,
      retainedPredictions,
      evictedPredictions: candidatePredictions - retainedPredictions,
      candidateBytes,
      retainedBytes: actualBytes,
      evictedBytes: Math.max(0, candidateBytes - actualBytes),
      meanRetainedEntropyPpm: meanEntropyPpm(retained),
      meanEvictedEntropyPpm: meanEntropyPpm(evicted),
    },
  };
}

function collectBaselineCandidates(
  table: TrainingTable,
  maxPredictions: number,
  kind: 'character' | 'word',
): CandidateModelEntry[] {
  const candidates: CandidateModelEntry[] = [];
  for (const [context, predictions] of table) {
    const eligible = [...predictions.entries()]
      .filter(([, stats]) => meetsConfiguredDocumentFrequency(stats))
      .map(([next, stats]) => ({ next, stats, effectiveCount: effectiveTransitionCount(stats) }))
      .sort(
        (a, b) =>
          b.effectiveCount - a.effectiveCount || toHex(a.next).localeCompare(toHex(b.next), 'en'),
      );
    const kept = eligible.slice(0, maxPredictions);
    if (kept.length === 0) continue;
    const retainedPredictions = new Map(
      kept.map(({ next, effectiveCount }) => [next, effectiveCount]),
    );
    const sourceIds = new Set<string>();
    const documentIds = new Set<string>();
    let totalCount = 0;
    for (const { stats, effectiveCount } of eligible) {
      totalCount += effectiveCount;
      for (const [sourceId, documents] of stats.documentsBySource) {
        sourceIds.add(sourceId);
        for (const documentId of documents) documentIds.add(documentId);
      }
    }
    const retainedCount = kept.reduce((sum, item) => sum + item.effectiveCount, 0);
    if (totalCount > retainedCount) {
      retainedPredictions.set(
        kind === 'word' ? WORD_OTHER_MASS : NGRAM_OTHER_MASS,
        totalCount - retainedCount,
      );
    }
    const topCount = kept[0]!.effectiveCount;
    const contextOrder =
      kind === 'word' ? context.split('\u001f').length : Array.from(context).length;
    const line =
      kind === 'word'
        ? serializeWordTable(new Map([[context, retainedPredictions]]))
        : serializeEntry(context, retainedPredictions);
    const lineBytes = Buffer.byteLength(line, 'utf8');
    const entropyPpm = normalizedEntropyPpm(eligible.map((item) => item.effectiveCount));
    const candidate: CandidateModelEntry = {
      kind,
      semanticOrder: kind === 'word' ? contextOrder + 4 : contextOrder,
      context,
      contextHex: toHex(context),
      predictions: retainedPredictions,
      lineBytes,
      sourceSupport: sourceIds.size,
      documentSupport: documentIds.size,
      topCount,
      totalCount,
      dominancePpm: Math.floor((topCount / totalCount) * 1_000_000),
      entropyPpm,
      utilityPerBytePpm: 0,
    };
    candidate.utilityPerBytePpm = candidateUtilityPerBytePpm(candidate);
    candidates.push(candidate);
  }
  return candidates;
}

export function serialize(table: NGramTable): string {
  return [...table.entries()]
    .map(([context, predictions]) => ({ context, contextHex: toHex(context), predictions }))
    .sort((a, b) => a.contextHex.localeCompare(b.contextHex, 'en'))
    .map(({ context, predictions }) => serializeEntry(context, predictions))
    .join('\n');
}

function meetsConfiguredDocumentFrequency(stats: TransitionStats): boolean {
  for (const [sourceId, documents] of stats.documentsBySource) {
    const minimum = stats.minDocumentFrequencyBySource.get(sourceId);
    if (minimum !== undefined && documents.size >= minimum) return true;
  }
  return false;
}

function effectiveTransitionCount(stats: TransitionStats): number {
  if (!stats.weightMilliBySource || stats.weightMilliBySource.size === 0) return stats.count;
  let support = 0;
  for (const [sourceId, documents] of stats.documentsBySource) {
    const weightMilli = stats.weightMilliBySource.get(sourceId);
    if (!weightMilli || !Number.isSafeInteger(weightMilli) || weightMilli <= 0) {
      throw new Error(`Transition has no valid fixed-point document weight for ${sourceId}.`);
    }
    support += documents.size * weightMilli;
    if (!Number.isSafeInteger(support)) {
      throw new Error('Independent document support exceeds the safe integer range.');
    }
  }
  return support > 0 ? support : stats.count;
}

function normalizedEntropyPpm(counts: readonly number[]): number {
  const valid = counts.filter((count) => Number.isSafeInteger(count) && count > 0);
  if (valid.length <= 1) return 0;
  const total = valid.reduce((sum, count) => sum + count, 0);
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new Error('Entropy calibration received invalid transition support.');
  }
  let entropy = 0;
  for (const count of valid) {
    const probability = count / total;
    entropy -= probability * Math.log(probability);
  }
  const normalized = entropy / Math.log(valid.length);
  return Math.max(0, Math.min(1_000_000, Math.round(normalized * 1_000_000)));
}

function candidateUtilityPerBytePpm(candidate: CandidateModelEntry): number {
  const evidence = Math.max(1, candidate.documentSupport + candidate.sourceSupport * 4);
  const order = Math.max(1, (candidate.semanticOrder ?? Array.from(candidate.context).length) + 1);
  // Preserve some value for diverse top-k contexts while favoring predictable
  // low-entropy contexts. The score is deterministic and normalized by the
  // exact serialized UTF-8 cost used by the global budget.
  const predictability = 1_500_000 - candidate.entropyPpm;
  return Math.floor((evidence * order * predictability) / Math.max(1, candidate.lineBytes));
}

function meanEntropyPpm(candidates: readonly CandidateModelEntry[]): number {
  if (candidates.length === 0) return 0;
  return Math.round(
    candidates.reduce((sum, candidate) => sum + candidate.entropyPpm, 0) / candidates.length,
  );
}

function compareCandidateUtility(a: CandidateModelEntry, b: CandidateModelEntry): number {
  return (
    b.utilityPerBytePpm - a.utilityPerBytePpm ||
    b.sourceSupport - a.sourceSupport ||
    b.documentSupport - a.documentSupport ||
    a.entropyPpm - b.entropyPpm ||
    (b.semanticOrder ?? 0) - (a.semanticOrder ?? 0) ||
    b.topCount - a.topCount ||
    b.dominancePpm - a.dominancePpm ||
    b.totalCount - a.totalCount ||
    a.contextHex.localeCompare(b.contextHex, 'en')
  );
}

function serializedProfileBytes(entries: CandidateModelEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.lineBytes, 0) + Math.max(0, entries.length - 1);
}

function visiblePredictionCount(candidate: CandidateModelEntry): number {
  const reserved = candidate.kind === 'word' ? WORD_OTHER_MASS : NGRAM_OTHER_MASS;
  return [...candidate.predictions.keys()].filter((next) => next !== reserved).length;
}

function serializeEntry(context: string, predictions: Map<string, number>): string {
  const orderedPredictions = [...predictions.entries()]
    .map(([next, count]) => [toHex(next), count] as const)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'));
  return JSON.stringify([toHex(context), orderedPredictions, 'b']);
}

function serializedLineBytes(lineBytes: number[]): number {
  return lineBytes.reduce((sum, bytes) => sum + bytes, 0) + Math.max(0, lineBytes.length - 1);
}

/** Compatibility scanner used by focused tests and corpus diagnostics. */
export function scanSource(
  sourcePath: string,
  weight: number,
  ngramN: number,
  _options: { skipMixed?: boolean; maxUnits?: number } = {},
): {
  table: NGramTable;
  fileCount: number;
  fragmentCount: number;
  rawSize: number;
  languageDistribution: Record<'zh' | 'en' | 'mixed' | 'unknown', number>;
  skippedMixedFragments: number;
} {
  const files = listTrainingFiles(sourcePath);
  const table: NGramTable = new Map();
  let fragmentCount = 0;
  let skippedMixedFragments = 0;
  let rawSize = 0;
  const languageDistribution = { zh: 0, en: 0, mixed: 0, unknown: 0 };
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    rawSize += Buffer.byteLength(raw, 'utf8');
    for (const fragment of splitTrainingUnits(raw, ngramN)) {
      fragmentCount++;
      const language = detectTrainingLanguage(fragment);
      if (_options.skipMixed && language === 'mixed') {
        skippedMixedFragments++;
        continue;
      }
      languageDistribution[language]++;
      const points = Array.from(fragment);
      for (let index = 0; index < points.length - ngramN; index++) {
        const context = points.slice(index, index + ngramN).join('');
        const next = points[index + ngramN];
        if (!next) continue;
        const predictions = table.get(context) ?? new Map<string, number>();
        predictions.set(next, (predictions.get(next) ?? 0) + Math.max(1, Math.round(weight)));
        table.set(context, predictions);
      }
    }
  }
  return {
    table,
    fileCount: files.length,
    fragmentCount,
    rawSize,
    languageDistribution,
    skippedMixedFragments,
  };
}

/** Compatibility helper retained for script consumers. Web cache is never implicit. */
export function buildProfileSources(
  configSources: SourceConfig[],
  _profile: TrainProfile,
  approvedWebSources: SourceConfig[] = [],
): SourceConfig[] {
  return [
    ...configSources.filter((source) => source.kind !== 'web'),
    ...approvedWebSources.filter((source) => source.kind === 'web'),
  ].filter((source) => !isForbiddenSourcePath(normalizeRelativePath(source.path)));
}

/** Compatibility helper: only explicitly approved, hashed clean files may be returned. */
export function buildWebLocalSourcesFromReport(report: {
  sources: Array<{
    sourceId?: string;
    cleanPath: string | null;
    category: string;
    language?: string;
    weight: number;
    fragmentsKept: number;
    licenseId?: string;
    licenseEvidence?: string;
    cleanSha256?: string;
  }>;
}): SourceConfig[] {
  const seen = new Set<string>();
  const sources: SourceConfig[] = [];
  for (const item of report.sources) {
    const normalized = normalizeRelativePath(item.cleanPath ?? '');
    if (
      !item.sourceId ||
      !normalized.startsWith('_web-cache/_clean/') ||
      item.fragmentsKept <= 0 ||
      !item.licenseId ||
      item.licenseId.toLowerCase() === 'unknown' ||
      !item.licenseEvidence ||
      !item.cleanSha256 ||
      !isSha256(item.cleanSha256) ||
      seen.has(normalized)
    ) {
      continue;
    }
    seen.add(normalized);
    sources.push({
      id: item.sourceId,
      path: normalized,
      weightMilli: Math.max(1, Math.round(item.weight * 1000)),
      category: item.category,
      language: normalizeLanguage(item.language),
      kind: 'web',
      minDocumentFrequency: 3,
      description: `Approved clean web corpus (${item.category})`,
    });
  }
  return sources;
}

export function hashSourcePath(sourcePath: string): string {
  const files = listTrainingFiles(sourcePath);
  return hashSourceFiles(sourcePath, files);
}

function auditSectionedModel(
  serialized: string,
  character: NGramTable,
  word: WordNGramTable,
  minNgramN: number,
  maxNgramN: number,
): string[] {
  const findings = auditFullModel(serialize(character), character, maxNgramN, minNgramN);
  const wordSerialized = serializeWordTable(word);
  const restoredWord = deserializeWordTable(wordSerialized);
  if (restoredWord.size !== word.size) findings.push('word-entry-count-mismatch');
  for (const [context, predictions] of word) {
    const tokens = context.split('\u001f');
    if (
      tokens.length < 1 ||
      tokens.length > 3 ||
      tokens.some((token) => !/^[a-z]+(?:['-][a-z]+)*$/u.test(token))
    ) {
      findings.push(`invalid-word-context-${toHex(context)}`);
    }
    for (const [next, count] of predictions) {
      if (
        (next !== WORD_OTHER_MASS && !/^[a-z]+(?:['-][a-z]+)*$/u.test(next)) ||
        !Number.isSafeInteger(count) ||
        count <= 0
      ) {
        findings.push(`invalid-word-prediction-${toHex(context)}`);
      }
    }
  }
  if (serialized !== serializeBaselineTables({ character, word })) {
    findings.push('sectioned-serialization-mismatch');
  }
  return [...new Set(findings)];
}

export function auditFullModel(
  serialized: string,
  model: NGramTable,
  ngramN: number,
  minNgramN: number = ngramN,
): string[] {
  const findings: string[] = [];
  const seenHex = new Set<string>();
  let parsedLines = 0;
  for (const line of serialized ? serialized.split('\n') : []) {
    parsedLines++;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      findings.push(`invalid-json-line-${parsedLines}`);
      continue;
    }
    if (!Array.isArray(parsed) || typeof parsed[0] !== 'string' || !Array.isArray(parsed[1])) {
      findings.push(`invalid-shape-line-${parsedLines}`);
      continue;
    }
    const contextHex = parsed[0];
    if (!contextHex || contextHex.length % 2 !== 0 || !HEX_RE.test(contextHex)) {
      findings.push(`invalid-context-hex-line-${parsedLines}`);
      continue;
    }
    if (seenHex.has(contextHex)) findings.push(`duplicate-context-${contextHex}`);
    seenHex.add(contextHex);
    const context = Buffer.from(contextHex, 'hex').toString('utf8');
    const contextLength = Array.from(context).length;
    if (contextLength < minNgramN || contextLength > ngramN || context.includes('\ufffd')) {
      findings.push(`invalid-unicode-context-${contextHex}`);
    }
    for (const prediction of parsed[1]) {
      if (
        !Array.isArray(prediction) ||
        typeof prediction[0] !== 'string' ||
        !HEX_RE.test(prediction[0]) ||
        !Number.isSafeInteger(prediction[1]) ||
        prediction[1] <= 0
      ) {
        findings.push(`invalid-prediction-line-${parsedLines}`);
        continue;
      }
      const next = Buffer.from(prediction[0], 'hex').toString('utf8');
      if (Array.from(next).length !== 1 || next.includes('\ufffd')) {
        findings.push(`invalid-unicode-prediction-line-${parsedLines}`);
      }
      const window = `${context}${next}`;
      if (
        window.includes('\ufffd') ||
        window.includes('某机构') ||
        window.includes('有人表示') ||
        /\bsomeone(?:'s)?\b/i.test(window) ||
        /\ban organization\b/i.test(window)
      ) {
        findings.push(`forbidden-model-text-line-${parsedLines}`);
      }
    }
  }
  if (parsedLines !== model.size)
    findings.push(`entry-count-mismatch-${parsedLines}-${model.size}`);
  return [...new Set(findings)];
}

function countEntriesByCodePointLength(table: NGramTable): Record<string, number> {
  const counts = new Map<number, number>();
  for (const context of table.keys()) {
    const order = Array.from(context).length;
    counts.set(order, (counts.get(order) ?? 0) + 1);
  }
  return Object.fromEntries(
    [...counts.entries()].sort(([a], [b]) => a - b).map(([order, count]) => [String(order), count]),
  );
}

export function atomicReplaceFiles(files: Array<{ target: string; content: string }>): void {
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
      // Windows rejects fsync on a read-only descriptor; r+ works on all targets we ship.
      const handle = fs.openSync(temporary, 'r+');
      try {
        fs.fsyncSync(handle);
      } finally {
        fs.closeSync(handle);
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

  // The new group is now complete. Backup cleanup is intentionally outside the
  // rollback transaction so a cleanup failure cannot delete a successfully written model.
  for (const item of staged) {
    try {
      if (fs.existsSync(item.backup)) fs.unlinkSync(item.backup);
    } catch (error) {
      console.warn(`Could not remove completed baseline backup ${item.backup}: ${String(error)}`);
    }
  }
}

function publishBuild(build: TrainingBuild, profile: TrainProfile): void {
  const config = readJson<CorpusConfig>(CONFIG_PATH);
  const profileConfig = config.profiles[profile];
  const outputPath = path.resolve(CORPUS_DIR, profileConfig.outputFile);
  const manifestPath = path.resolve(CORPUS_DIR, profileConfig.manifestFile);
  const reportPath = path.resolve(CORPUS_DIR, profileConfig.reportFile);
  const manifestText = `${JSON.stringify(build.manifest, null, 2)}\n`;
  const reportText = `${JSON.stringify(build.report, null, 2)}\n`;
  if (Buffer.byteLength(build.serialized, 'utf8') !== build.manifest.modelBytes) {
    throw new Error('Refusing to publish: candidate byte count changed.');
  }
  if (sha256(build.serialized) !== build.manifest.sha256) {
    throw new Error('Refusing to publish: candidate SHA-256 changed.');
  }
  atomicReplaceFiles([
    { target: outputPath, content: build.serialized },
    { target: manifestPath, content: manifestText },
    { target: reportPath, content: reportText },
  ]);
}

function publishCandidateBuild(
  build: TrainingBuild,
  profile: TrainProfile,
  candidateDirectory: string,
): void {
  const root = fs.realpathSync(REPOSITORY_ROOT);
  const candidateRoot = path.resolve(process.cwd(), candidateDirectory);
  if (!isWithin(candidateRoot, root)) {
    throw new Error('Candidate output must remain inside the repository workspace.');
  }
  const config = readJson<CorpusConfig>(CONFIG_PATH);
  const profileConfig = config.profiles[profile];
  const officialTargets = [
    profileConfig.outputFile,
    profileConfig.manifestFile,
    profileConfig.reportFile,
  ].map((item) => path.resolve(CORPUS_DIR, item));
  const outputPath = path.join(candidateRoot, path.basename(profileConfig.outputFile));
  const manifestPath = path.join(candidateRoot, path.basename(profileConfig.manifestFile));
  const reportPath = path.join(candidateRoot, path.basename(profileConfig.reportFile));
  if ([outputPath, manifestPath, reportPath].some((target) => officialTargets.includes(target))) {
    throw new Error('Candidate output must not replace official model artifacts.');
  }
  atomicReplaceFiles([
    { target: outputPath, content: build.serialized },
    { target: manifestPath, content: `${JSON.stringify(build.manifest, null, 2)}\n` },
    { target: reportPath, content: `${JSON.stringify(build.report, null, 2)}\n` },
  ]);
}

export function splitTrainingUnits(text: string, ngramN: number): string[] {
  const normalized = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]+`/g, ' ');
  const units: string[] = [];
  for (const lineValue of normalized.split('\n')) {
    let line = lineValue
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/^\s{0,3}(?:[-+*]|\d+[.)])\s+/, '')
      .replace(/^\s{0,3}>\s?/, '')
      .replace(/^\[[ xX]\]\s*/, '')
      .trim();
    if (!line) continue;
    if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line)) continue;
    if ((line.match(/\|/g) ?? []).length >= 2) continue;
    line = line.replace(/\s+/g, ' ');
    for (const sentence of line.split(/(?<=[。！？!?；;])\s*|(?<=\.)\s+/u)) {
      const fragment = sentence.trim();
      if (Array.from(fragment).length >= ngramN + 1) units.push(fragment);
    }
  }
  return units;
}

function findTrainingHoldoutOverlap(
  fragments: CanonicalFragment[],
  holdout: FormalHoldout,
): string[] {
  const overlaps: string[] = [];
  // A 24MiB pool contains hundreds of thousands of sentence fragments. A
  // full holdout x fragment Cartesian scan repeatedly rebuilt the same shingle
  // sets and made governance effectively quadratic. Any exact, >=12-character
  // substring, near-key, or 0.8-Jaccard match necessarily shares a 5-shingle,
  // so an inverted index preserves the fail-closed checks while bounding each
  // holdout comparison to plausible candidates.
  const relevantShingles = new Set<string>();
  for (const item of holdout.cases) {
    for (const shingle of shingles(normalizeCorpusFragment(item.text), 5)) {
      relevantShingles.add(shingle);
    }
  }
  const fragmentsByShingle = new Map<string, number[]>();
  const fragmentsByExact = new Map<string, number>();
  const fragmentsByNear = new Map<string, number[]>();
  for (let index = 0; index < fragments.length; index++) {
    const fragment = fragments[index]!;
    fragmentsByExact.set(fragment.exactKey, index);
    if (fragment.nearKey.length >= 12) {
      const near = fragmentsByNear.get(fragment.nearKey) ?? [];
      near.push(index);
      fragmentsByNear.set(fragment.nearKey, near);
    }
    for (const shingle of shingles(fragment.exactKey, 5)) {
      if (!relevantShingles.has(shingle)) continue;
      const candidates = fragmentsByShingle.get(shingle) ?? [];
      candidates.push(index);
      fragmentsByShingle.set(shingle, candidates);
    }
  }
  for (const holdoutCase of holdout.cases) {
    const holdoutExact = normalizeCorpusFragment(holdoutCase.text);
    const holdoutNear = nearDuplicateCorpusKey(holdoutCase.text);
    const holdoutShingles = shingles(holdoutExact, 5);
    const candidateIndexes = new Set<number>();
    const exactIndex = fragmentsByExact.get(holdoutExact);
    if (exactIndex !== undefined) candidateIndexes.add(exactIndex);
    for (const index of fragmentsByNear.get(holdoutNear) ?? []) candidateIndexes.add(index);
    for (const shingle of holdoutShingles) {
      for (const index of fragmentsByShingle.get(shingle) ?? []) candidateIndexes.add(index);
    }
    for (const index of candidateIndexes) {
      const fragment = fragments[index]!;
      const shorter = Math.min(fragment.exactKey.length, holdoutExact.length);
      const substringOverlap =
        shorter >= 12 &&
        (fragment.exactKey.includes(holdoutExact) || holdoutExact.includes(fragment.exactKey));
      const nearKeyOverlap = fragment.nearKey.length >= 12 && fragment.nearKey === holdoutNear;
      const similarity = jaccard(shingles(fragment.exactKey, 5), holdoutShingles);
      if (
        fragment.exactKey === holdoutExact ||
        substringOverlap ||
        nearKeyOverlap ||
        similarity >= 0.8
      ) {
        overlaps.push(holdoutCase.id);
        break;
      }
    }
  }
  return overlaps;
}

function buildContributionDistribution(
  fragments: CanonicalFragment[],
  getKey: (item: {
    kind: SourceKind;
    weightMilli: number;
    category: string;
    domain?: string;
  }) => string | null,
): Map<string, number> {
  const distribution = new Map<string, number>();
  for (const fragment of fragments) {
    const bytes = Buffer.byteLength(fragment.text, 'utf8');
    for (const contribution of fragment.contributions.values()) {
      const key = getKey(contribution);
      if (!key) continue;
      distribution.set(key, (distribution.get(key) ?? 0) + bytes * contribution.weightMilli);
    }
  }
  return distribution;
}

function validateDistribution(
  distribution: Map<string, number>,
  limit: number,
  label: string,
  errors: string[],
): void {
  const total = [...distribution.values()].reduce((sum, value) => sum + value, 0);
  if (total <= 0 && label === 'web domain') return;
  for (const [key, value] of distribution) {
    const ratio = value / total;
    if (ratio > limit) {
      errors.push(
        `${label} ${key} dominates ${(ratio * 100).toFixed(1)}% (limit ${limit * 100}%).`,
      );
    }
  }
}

function toReportDistribution(
  distribution: Map<string, number>,
): Record<string, { weightedBytes: number; ratio: string }> {
  const total = [...distribution.values()].reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(
    [...distribution.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([key, value]) => [
        key,
        {
          weightedBytes: value,
          ratio: total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '0%',
        },
      ]),
  );
}

function buildInputManifest(
  profile: TrainProfile,
  config: CorpusConfig,
  provenance: ProvenanceManifest,
  holdout: FormalHoldout,
  sourceInputs: TrainReport['sourceInputs'],
  trainingSlice: TrainingSliceSummary,
): unknown {
  return {
    schemaVersion: 1,
    profile,
    configSha256: sha256(canonicalJson(config)),
    provenanceSha256: sha256(canonicalJson(provenance)),
    holdoutSha256: sha256(canonicalJson(holdout)),
    trainingSlice,
    sources: [...sourceInputs].sort((a, b) => a.id.localeCompare(b.id, 'en')),
  };
}

function evaluateHoldoutQualityEvidence(
  evidencePathValue: string | undefined,
  profile: TrainProfile,
  modelSha256: string,
  trainingInputHash: string,
  holdout: FormalHoldout,
  gate: HoldoutQualityGateConfig,
): HoldoutQualitySummary {
  const holdoutSha256 = sha256(canonicalJson(holdout));
  const base: HoldoutQualitySummary = {
    provided: evidencePathValue !== undefined,
    passed: false,
    holdoutSha256,
    errors: [],
  };
  if (!evidencePathValue) {
    base.errors.push('Holdout quality evidence is required for release eligibility.');
    return base;
  }

  const evidencePath = path.resolve(process.cwd(), evidencePathValue);
  if (!fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile()) {
    base.errors.push(`Holdout quality evidence does not exist: ${evidencePathValue}.`);
    return base;
  }
  const realEvidencePath = fs.realpathSync(evidencePath);
  if (!isWithin(realEvidencePath, fs.realpathSync(REPOSITORY_ROOT))) {
    base.errors.push('Holdout quality evidence must remain inside the repository workspace.');
    return base;
  }
  base.evidenceFile = normalizeRelativePath(path.relative(REPOSITORY_ROOT, realEvidencePath));

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(realEvidencePath, 'utf8')) as unknown;
  } catch (error) {
    base.errors.push(`Holdout quality evidence is invalid JSON: ${String(error)}.`);
    return base;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    base.errors.push('Holdout quality evidence has an invalid shape.');
    return base;
  }

  const raw = parsed as Record<string, unknown>;
  const requiredRates = [
    'triggerRate',
    'usableRate',
    'falseTriggerRate',
    'mixedCandidateRate',
  ] as const;
  const shapeIsValid =
    raw.schemaVersion === 1 &&
    raw.profile === 'web-local' &&
    typeof raw.modelSha256 === 'string' &&
    typeof raw.trainingInputHash === 'string' &&
    typeof raw.holdoutSha256 === 'string' &&
    typeof raw.evaluatorVersion === 'string' &&
    /^[a-z0-9][a-z0-9._-]{2,95}$/iu.test(raw.evaluatorVersion) &&
    typeof raw.learningCurveSha256 === 'string' &&
    isSha256(raw.learningCurveSha256) &&
    Number.isSafeInteger(raw.opportunities) &&
    (raw.opportunities as number) >= 0 &&
    requiredRates.every((key) => isUnitRate(raw[key])) &&
    typeof raw.p90Ms === 'number' &&
    Number.isFinite(raw.p90Ms) &&
    raw.p90Ms >= 0;
  if (!shapeIsValid) {
    base.errors.push('Holdout quality evidence has invalid schema or metric values.');
    return base;
  }

  const evidence = raw as unknown as HoldoutQualityEvidence;
  Object.assign(base, {
    evaluatorVersion: evidence.evaluatorVersion,
    qualityEvidenceSha256: sha256(fs.readFileSync(realEvidencePath)),
    learningCurveSha256: evidence.learningCurveSha256.toLowerCase(),
    opportunities: evidence.opportunities,
    triggerRate: evidence.triggerRate,
    usableRate: evidence.usableRate,
    falseTriggerRate: evidence.falseTriggerRate,
    mixedCandidateRate: evidence.mixedCandidateRate,
    p90Ms: evidence.p90Ms,
  });
  if (evidence.profile !== profile) {
    base.errors.push(`Holdout quality profile mismatch (${evidence.profile} != ${profile}).`);
  }
  if (evidence.modelSha256.toLowerCase() !== modelSha256) {
    base.errors.push('Holdout quality evidence is bound to a different model SHA-256.');
  }
  if (evidence.trainingInputHash.toLowerCase() !== trainingInputHash) {
    base.errors.push('Holdout quality evidence is bound to a different training input hash.');
  }
  if (evidence.holdoutSha256.toLowerCase() !== holdoutSha256) {
    base.errors.push('Holdout quality evidence is bound to a different holdout SHA-256.');
  }
  if (evidence.opportunities < gate.minOpportunities) {
    base.errors.push(
      `Holdout quality evidence has ${evidence.opportunities} opportunities; ` +
        `minimum is ${gate.minOpportunities}.`,
    );
  }
  if (evidence.triggerRate < gate.minTriggerRate || evidence.triggerRate > gate.maxTriggerRate) {
    base.errors.push(
      `Holdout trigger rate ${formatRate(evidence.triggerRate)} is outside ` +
        `${formatRate(gate.minTriggerRate)}-${formatRate(gate.maxTriggerRate)}.`,
    );
  }
  if (evidence.usableRate < gate.minUsableRate) {
    base.errors.push(
      `Holdout usable rate ${formatRate(evidence.usableRate)} is below ` +
        `${formatRate(gate.minUsableRate)}.`,
    );
  }
  if (evidence.falseTriggerRate > gate.maxFalseTriggerRate) {
    base.errors.push(
      `Holdout false-trigger rate ${formatRate(evidence.falseTriggerRate)} exceeds ` +
        `${formatRate(gate.maxFalseTriggerRate)}.`,
    );
  }
  if (evidence.mixedCandidateRate > gate.maxMixedCandidateRate) {
    base.errors.push(
      `Holdout mixed-candidate rate ${formatRate(evidence.mixedCandidateRate)} exceeds ` +
        `${formatRate(gate.maxMixedCandidateRate)}.`,
    );
  }
  if (evidence.p90Ms > gate.maxP90Ms) {
    base.errors.push(`Holdout p90 ${evidence.p90Ms}ms exceeds ${gate.maxP90Ms}ms.`);
  }
  base.passed = base.errors.length === 0;
  return base;
}

function auditSourceDirectory(sourcePath: string): void {
  const normalized = normalizeRelativePath(sourcePath);
  if (isForbiddenSourcePath(normalized)) throw new Error(`Forbidden corpus path: ${sourcePath}`);
}

function resolveCorpusSource(
  normalizedPath: string,
  kind: SourceKind,
  errors: string[],
  sourceId: string,
): string | null {
  auditSourceDirectory(normalizedPath);
  const absolute = path.resolve(CORPUS_DIR, normalizedPath);
  const corpusRoot = fs.realpathSync(CORPUS_DIR);
  if (!fs.existsSync(absolute)) {
    errors.push(`${sourceId}: source path does not exist.`);
    return null;
  }
  const real = fs.realpathSync(absolute);
  const cleanRoot = path.join(corpusRoot, '_web-cache', '_clean');
  if (kind === 'curated' && !isWithin(real, corpusRoot)) {
    errors.push(`${sourceId}: curated source escapes corpus root.`);
    return null;
  }
  if (kind === 'web' && !isWithin(real, cleanRoot)) {
    errors.push(`${sourceId}: web source is not inside verified clean cache.`);
    return null;
  }
  return real;
}

function listTrainingFiles(sourcePath: string): string[] {
  if (!fs.existsSync(sourcePath)) return [];
  if (fs.statSync(sourcePath).isFile()) {
    return /\.(md|txt|jsonl)$/i.test(sourcePath) ? [sourcePath] : [];
  }
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Corpus symlink is not allowed: ${fullPath}`);
      if (entry.isDirectory()) walk(fullPath);
      else if (/\.(md|txt|jsonl)$/i.test(entry.name)) files.push(fullPath);
    }
  };
  walk(sourcePath);
  return files.sort((a, b) =>
    normalizeRelativePath(path.relative(sourcePath, a)).localeCompare(
      normalizeRelativePath(path.relative(sourcePath, b)),
      'en',
    ),
  );
}

function hashSourceFiles(sourceRoot: string, files: string[]): string {
  const base = fs.statSync(sourceRoot).isFile() ? path.dirname(sourceRoot) : sourceRoot;
  const entries = files.map((file) => ({
    path: normalizeRelativePath(path.relative(base, file)),
    sha256: sha256(fs.readFileSync(file)),
  }));
  return sha256(JSON.stringify(entries));
}

function validateConfig(config: CorpusConfig): void {
  if (config.version !== 4) throw new Error(`Unsupported corpus config version: ${config.version}`);
  if ('countScale' in (config as unknown as Record<string, unknown>)) {
    throw new Error(
      'countScale is not supported; weightMilli is the sole integer fixed-point scale.',
    );
  }
  if (
    Object.keys(config.profiles).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(config.profiles, 'web-local')
  ) {
    throw new Error('corpus config must expose only the canonical web-local profile.');
  }
  if (config.ngramN < 2 || config.ngramN > 8) throw new Error('ngramN must be between 2 and 8.');
  if (
    !isStrictAscendingIntegerRange(config.ngramOrders, 2, config.ngramN) ||
    config.ngramOrders.at(-1) !== config.ngramN
  ) {
    throw new Error('ngramOrders must be a strictly ascending 2..ngramN list ending at ngramN.');
  }
  if (!isStrictAscendingIntegerRange(config.wordNgramOrders, 1, 3)) {
    throw new Error('wordNgramOrders must be a strictly ascending 1..3 list.');
  }
  if (!Number.isSafeInteger(config.maxPredsPerContext) || config.maxPredsPerContext <= 0) {
    throw new Error('maxPredsPerContext must be a positive safe integer.');
  }
  if (config.hardMaxBytes !== WEB_LOCAL_MAX_BYTES) {
    throw new Error(`hardMaxBytes must remain ${WEB_LOCAL_MAX_BYTES}.`);
  }
  if (config.modelTargetBytes !== WEB_LOCAL_SOFT_TARGET_BYTES) {
    throw new Error(`modelTargetBytes must remain ${WEB_LOCAL_SOFT_TARGET_BYTES}.`);
  }
  if (config.maxCleanPoolBytes > 30 * 1024 * 1024) {
    throw new Error('Clean training pool may not exceed 30MiB.');
  }
  const expectedLearningCurveBytes = [
    104_858, 524_288, 1_048_576, 3_145_728, 8_388_608, 16_777_216, 25_165_824,
  ];
  if (
    !Array.isArray(config.learningCurveBytes) ||
    config.learningCurveBytes.length !== expectedLearningCurveBytes.length ||
    config.learningCurveBytes.some((value, index) => value !== expectedLearningCurveBytes[index])
  ) {
    throw new Error('learningCurveBytes must remain the fixed 0.1/0.5/1/3/8/16/24MiB tiers.');
  }
  if (config.exactDuplicateRateLimit < 0 || config.exactDuplicateRateLimit > 0.01) {
    throw new Error('exactDuplicateRateLimit must remain at or below 1%.');
  }
  if (config.nearDuplicateRateLimit < 0 || config.nearDuplicateRateLimit > 0.03) {
    throw new Error('nearDuplicateRateLimit must remain at or below 3%.');
  }
  if (config.categoryDominanceLimit <= 0 || config.categoryDominanceLimit > 0.4) {
    throw new Error('categoryDominanceLimit must remain at or below 40%.');
  }
  if (config.webDomainDominanceLimit <= 0 || config.webDomainDominanceLimit > 0.05) {
    throw new Error('webDomainDominanceLimit must remain at or below 5%.');
  }
  validateQualityGateConfig(config.qualityGate);
  if (!Array.isArray(config.excludedTrainingFiles)) {
    throw new Error('excludedTrainingFiles must be an array.');
  }
  for (const excludedPath of config.excludedTrainingFiles) {
    const normalized = normalizeRelativePath(excludedPath);
    if (!normalized || isForbiddenSourcePath(normalized) || path.isAbsolute(excludedPath)) {
      throw new Error(`Invalid excluded training path: ${excludedPath}`);
    }
  }
}

function validateQualityGateConfig(gate: HoldoutQualityGateConfig): void {
  if (!gate || !Number.isSafeInteger(gate.minOpportunities) || gate.minOpportunities <= 0) {
    throw new Error('qualityGate.minOpportunities must be a positive safe integer.');
  }
  const rates = [
    gate.minTriggerRate,
    gate.maxTriggerRate,
    gate.minUsableRate,
    gate.maxFalseTriggerRate,
    gate.maxMixedCandidateRate,
  ];
  if (!rates.every(isUnitRate)) {
    throw new Error('All quality gate rates must be finite values between 0 and 1.');
  }
  if (gate.minTriggerRate > gate.maxTriggerRate) {
    throw new Error('qualityGate trigger-rate bounds are inverted.');
  }
  if (!Number.isFinite(gate.maxP90Ms) || gate.maxP90Ms <= 0) {
    throw new Error('qualityGate.maxP90Ms must be positive.');
  }
}

function isStrictAscendingIntegerRange(
  values: unknown,
  minimum: number,
  maximum: number,
): values is number[] {
  return (
    Array.isArray(values) &&
    values.length > 0 &&
    values.every(
      (value, index) =>
        Number.isSafeInteger(value) &&
        value >= minimum &&
        value <= maximum &&
        (index === 0 || value > values[index - 1]!),
    )
  );
}

function validateSourceConfig(source: SourceConfig, errors: string[]): void {
  if (!source.id || !source.path || !source.category) errors.push('Source identity is incomplete.');
  if (!Number.isSafeInteger(source.weightMilli) || source.weightMilli <= 0) {
    errors.push(`${source.id}: weightMilli must be a positive integer.`);
  }
  if (source.language === 'mixed') {
    errors.push(`${source.id}: mixed-language sources are not valid positive training inputs.`);
  }
  if (
    source.documentFormat !== undefined &&
    source.documentFormat !== 'plain' &&
    source.documentFormat !== 'jsonl'
  ) {
    errors.push(`${source.id}: unsupported documentFormat.`);
  }
  if (source.documentFormat === 'jsonl' && source.kind !== 'curated') {
    errors.push(`${source.id}: packed JSONL is only allowed for project-curated sources.`);
  }
  const expectedDocFrequency = source.kind === 'web' ? 3 : 2;
  if (
    !Number.isSafeInteger(source.minDocumentFrequency) ||
    source.minDocumentFrequency < expectedDocFrequency
  ) {
    errors.push(`${source.id}: minDocumentFrequency must be at least ${expectedDocFrequency}.`);
  }
}

function validateHoldout(holdout: FormalHoldout): void {
  if (
    holdout.schemaVersion !== 2 ||
    !holdout.datasetId ||
    !isIsoTimestamp(holdout.frozenAt) ||
    !Array.isArray(holdout.cases) ||
    holdout.cases.length < 50
  ) {
    throw new Error('Formal holdout is missing or invalid.');
  }
  const documentIds = new Set<string>();
  const checkpointIds = new Set<string>();
  const categories = new Set<string>();
  const languageCounts = { zh: 0, en: 0 };
  let silenceCount = 0;
  let checkpointCount = 0;
  for (const item of holdout.cases) {
    if (
      !item.id ||
      !item.text ||
      !item.category ||
      (item.language !== 'zh' && item.language !== 'en') ||
      documentIds.has(item.id) ||
      !Array.isArray(item.checkpoints) ||
      item.checkpoints.length === 0 ||
      item.checkpoints.length > 5
    ) {
      throw new Error('Formal holdout document metadata is invalid.');
    }
    documentIds.add(item.id);
    categories.add(item.category);
    for (const checkpoint of item.checkpoints) {
      const validOffset =
        Number.isSafeInteger(checkpoint.cursorOffset) &&
        checkpoint.cursorOffset >= 0 &&
        checkpoint.cursorOffset <= item.text.length;
      const validBehavior =
        checkpoint.expectedBehavior === 'complete' || checkpoint.expectedBehavior === 'silence';
      const validSuffix =
        checkpoint.expectedBehavior === 'silence'
          ? checkpoint.expectedSuffix === ''
          : checkpoint.expectedSuffix.length > 0 &&
            item.text.slice(checkpoint.cursorOffset).startsWith(checkpoint.expectedSuffix);
      if (
        !checkpoint.id ||
        checkpointIds.has(checkpoint.id) ||
        !validOffset ||
        !validBehavior ||
        !validSuffix
      ) {
        throw new Error(`Formal holdout checkpoint is invalid: ${item.id}.`);
      }
      checkpointIds.add(checkpoint.id);
      languageCounts[item.language]++;
      checkpointCount++;
      if (checkpoint.expectedBehavior === 'silence') silenceCount++;
    }
  }
  if (
    checkpointCount < 200 ||
    languageCounts.zh < 80 ||
    languageCounts.en < 80 ||
    categories.size < 4 ||
    silenceCount / checkpointCount < 0.2
  ) {
    throw new Error('Formal holdout does not meet the frozen coverage requirements.');
  }
}

function isForbiddenSourcePath(normalizedPath: string): boolean {
  const segments = normalizedPath.toLowerCase().split('/').filter(Boolean);
  return segments.includes('novel-zh') || segments.some((segment) => segment === '..');
}

function parseCli(argv: string[]): CliOptions {
  const profileValue = readArg(argv, '--profile') ?? 'web-local';
  if (profileValue !== 'web-local') {
    throw new Error(`Unsupported profile: ${profileValue}`);
  }
  const qualityReportPath = readArg(argv, '--quality-report');
  const candidateDir = readArg(argv, '--candidate-dir');
  const trainingPoolBytesValue = readArg(argv, '--training-pool-bytes');
  if (
    argv.some((item) => item === '--quality-report' || item.startsWith('--quality-report=')) &&
    (!qualityReportPath || qualityReportPath.startsWith('--'))
  ) {
    throw new Error('--quality-report requires a JSON evidence path.');
  }
  if (
    argv.some((item) => item === '--candidate-dir' || item.startsWith('--candidate-dir=')) &&
    (!candidateDir || candidateDir.startsWith('--'))
  ) {
    throw new Error('--candidate-dir requires a workspace-relative directory.');
  }
  const hasTrainingPoolBytes = argv.some(
    (item) => item === '--training-pool-bytes' || item.startsWith('--training-pool-bytes='),
  );
  const trainingPoolBytes = trainingPoolBytesValue ? Number(trainingPoolBytesValue) : undefined;
  if (
    hasTrainingPoolBytes &&
    (typeof trainingPoolBytes !== 'number' ||
      !Number.isSafeInteger(trainingPoolBytes) ||
      trainingPoolBytes <= 0)
  ) {
    throw new Error('--training-pool-bytes requires a positive integer byte count.');
  }
  return {
    profile: profileValue,
    dryRun: argv.includes('--dry-run'),
    allowVerifiedDegraded: argv.includes('--allow-verified-degraded'),
    ...(qualityReportPath ? { qualityReportPath } : {}),
    ...(candidateDir ? { candidateDir } : {}),
    ...(trainingPoolBytes ? { trainingPoolBytes } : {}),
  };
}

function readArg(argv: string[], name: string): string | undefined {
  const inline = argv.find((item) => item.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function normalizeRelativePath(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/{2,}/g, '/');
}

function normalizeLanguage(value: string | undefined): SourceConfig['language'] {
  const normalized = value?.toLowerCase() ?? '';
  if (normalized.startsWith('zh')) return 'zh';
  if (normalized.startsWith('en')) return 'en';
  if (normalized === 'mixed') return 'mixed';
  return 'unknown';
}

function detectTrainingLanguage(text: string): 'zh' | 'en' | 'mixed' | 'unknown' {
  const cjk = (text.match(/[\u3400-\u9fff]/gu) ?? []).length;
  const words = text.match(/[A-Za-z]{3,}/g) ?? [];
  if (cjk >= 4 && words.length >= 4) return 'mixed';
  if (cjk >= 4) return 'zh';
  if (words.length >= 4) return 'en';
  if (cjk > 0 && words.length > 0) return 'mixed';
  return 'unknown';
}

function shingles(text: string, size: number): Set<string> {
  const points = Array.from(text);
  const result = new Set<string>();
  for (let index = 0; index <= points.length - size; index++) {
    result.add(points.slice(index, index + size).join(''));
  }
  return result;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function toHex(value: string): string {
  return Buffer.from(value, 'utf8').toString('hex');
}

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isUnitRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function printSummary(report: TrainReport, options: CliOptions): void {
  console.log(`Verified baseline ${options.dryRun ? 'dry-run' : 'generation'}: ${report.profile}`);
  console.log(`Documents: ${report.documentCount}`);
  console.log(`Fragments: ${report.rawFragmentCount} -> ${report.canonicalFragmentCount}`);
  console.log(
    `Training slice: ${report.trainingSlice.realizedBytes}/${report.trainingSlice.requestedBytes ?? report.trainingSlice.availableBytes} bytes ` +
      `(${report.trainingSlice.selectedFragments}/${report.trainingSlice.availableFragments} fragments)`,
  );
  console.log(`Entries: ${report.totalEntries}`);
  console.log(`Bytes: ${report.modelBytes}`);
  console.log(
    `Budget: ${report.modelBudget.candidateEntries} -> ${report.modelBudget.retainedEntries} entries, ` +
      `${report.modelBudget.candidateBytes} -> ${report.modelBudget.retainedBytes} bytes`,
  );
  console.log(`SHA-256: ${report.modelSha256}`);
  console.log(`Input manifest: ${report.inputManifestHash}`);
  console.log(`Holdout quality passed: ${report.governance.qualityGatePassed}`);
  console.log(`Release eligible: ${report.governance.releaseEligible}`);
  if (report.governance.errors.length > 0) {
    console.log(`Governance: ${report.governance.errors.join('; ')}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runTraining();
}
