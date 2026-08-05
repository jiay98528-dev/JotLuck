import { createHash } from 'node:crypto';
import { open, readFile, realpath } from 'node:fs/promises';
import * as path from 'node:path';

import {
  V2_FREE_ENGINE_ID,
  V2_FREE_MATRIX,
  V2_FREE_PEAK_MEMORY_LIMIT_BYTES,
  V2_FREE_STATIC_LIMIT_BYTES,
  V2_FREE_TRAINING_POOL_LIMIT_BYTES,
  assessOraclePrecheck,
  computeV2FreeCandidateArtifactSha256,
  type V2FreeOracleReport,
  type V2FreeSha256,
} from './contract';
import {
  computeV2FreeEvaluatorTreeSha256,
  type V2FreeEvaluationManifest,
  type V2FreeEvaluationObservation,
  type V2FreeEvaluationReport,
} from './evaluation-manifest';

const PUBLIC_MANIFEST_SCHEMA = 'jotluck.autocomplete.public-free-decoder.v1';
const RUNTIME_MEASUREMENT_SCHEMA = 'jotluck.autocomplete.v2-free-runtime-measurement.v1';
const PROMOTION_EVIDENCE_SCHEMA = 'jotluck.autocomplete.v2-free-oracle-promotion.v1';
const OUTPUT_FILE = 'evaluation-manifest.json';
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CANDIDATE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}$/u;
const MINIMUM_MODEL_SAMPLES = 20;

interface TrainedAsset {
  file: string;
  sha256: V2FreeSha256;
  bytes: number;
}

interface TrainedManifest {
  schema: typeof PUBLIC_MANIFEST_SCHEMA;
  schemaVersion: 1;
  engine: typeof V2_FREE_ENGINE_ID;
  candidateId: string;
  candidateArtifactSha256: V2FreeSha256;
  lifecycle: 'trained';
  evaluationOnly: true;
  runtimeEligible: true;
  releaseEligible: false;
  parameterCount: 16_000_000 | 24_000_000 | 32_000_000;
  quantization: 'q4' | 'q8';
  training: { cleanedPoolBytes: number; licenseAuditPassed: true };
  oraclePrecheck: {
    checkpoints: 0;
    oracleAt8: 0;
    oracleAt32: 0;
    chineseOracleAt8: 0;
    englishOracleAt8: 0;
    passed: false;
  };
  assets: { model: TrainedAsset; tokenizer: TrainedAsset };
  runtimeStaticDeltaBytes: 0;
  measuredPeakMemoryBytes: 0;
  measurementClaims?: {
    runtimeStaticDeltaBytes: false;
    measuredPeakMemoryBytes: false;
  };
  releaseEvidence?: never;
  [key: string]: unknown;
}

export interface V2FreeRuntimeMeasurement {
  schema: typeof RUNTIME_MEASUREMENT_SCHEMA;
  schemaVersion: 1;
  engine: typeof V2_FREE_ENGINE_ID;
  candidateId: string;
  candidateArtifactSha256: V2FreeSha256;
  workerExecutableSha256: V2FreeSha256;
  evaluatorTreeSha256: V2FreeSha256;
  runtimeStaticDeltaBytes: number;
  peakMemoryBytes: number;
  modelP90Ms: number;
  modelInferenceSamplesMs: number[];
  peakMemorySamplesBytes: number[];
}

export interface PromoteV2FreeOracleOptions {
  workspaceRoot: string;
  candidateRoot: string;
  trainedManifestPath: string;
  oracleOutputDirectory: string;
  runtimeMeasurementPath: string;
  workerExecutablePath: string;
}

export interface PromoteV2FreeOracleResult {
  candidateId: string;
  candidateArtifactSha256: V2FreeSha256;
  outputPath: string;
  outputSha256: V2FreeSha256;
  oracleAt8: number;
  oracleAt32: number;
  modelP90Ms: number;
}

export async function promoteV2FreeOracle(
  options: PromoteV2FreeOracleOptions,
): Promise<PromoteV2FreeOracleResult> {
  const root = await realpath(path.resolve(options.workspaceRoot));
  const candidateRoot = await resolveCandidateRoot(root, options.candidateRoot);
  const trainedManifestPath = await resolveWorkspaceFile(root, options.trainedManifestPath);
  if (
    path.dirname(trainedManifestPath) !== candidateRoot ||
    path.basename(trainedManifestPath) === OUTPUT_FILE
  ) {
    throw new Error('Trained manifest must be a distinct file directly inside the candidate root.');
  }
  const oracleOutputDirectory = await resolveWorkspaceDirectory(
    root,
    options.oracleOutputDirectory,
  );
  const isolatedCandidateRoot = path.resolve(
    root,
    'scripts/corpus/_web-cache/autocomplete-v2-free/candidates',
  );
  if (
    !isWithin(oracleOutputDirectory, isolatedCandidateRoot) ||
    oracleOutputDirectory === candidateRoot
  ) {
    throw new Error('Oracle output directory must be a distinct isolated candidate directory.');
  }
  const measurementPath = await resolveWorkspaceFile(root, options.runtimeMeasurementPath);
  const workerPath = await resolveWorkspaceFile(root, options.workerExecutablePath);
  const outputPath = path.join(candidateRoot, OUTPUT_FILE);

  const trainedBytes = await readFile(trainedManifestPath);
  const trained = parseTrainedManifest(trainedBytes);
  const model = await readBoundAsset(candidateRoot, trained.assets.model);
  const tokenizer = await readBoundAsset(candidateRoot, trained.assets.tokenizer);
  const computedArtifactSha256 = computeV2FreeCandidateArtifactSha256({
    candidateId: trained.candidateId,
    parameterCount: trained.parameterCount,
    quantization: trained.quantization,
    model: { bytes: model.byteLength, sha256: sha256(model) },
    tokenizer: { bytes: tokenizer.byteLength, sha256: sha256(tokenizer) },
  });
  if (computedArtifactSha256 !== trained.candidateArtifactSha256) {
    throw new Error('Trained candidate artifact identity does not match its asset bytes.');
  }

  const evaluatorTreeSha256 = await computeV2FreeEvaluatorTreeSha256(root);
  const workerBytes = await readFile(workerPath);
  const workerExecutableSha256 = sha256(workerBytes);
  const oracle = await readAndVerifyOracleArtifacts({
    directory: oracleOutputDirectory,
    trained,
    trainedManifestSha256: sha256(trainedBytes),
    evaluatorTreeSha256,
    workerExecutableSha256,
  });
  const measurementBytes = await readFile(measurementPath);
  const measurement = parseRuntimeMeasurement(measurementBytes);
  verifyRuntimeMeasurement({
    measurement,
    trained,
    evaluatorTreeSha256,
    workerExecutableSha256,
  });

  const oracleReport: V2FreeOracleReport = {
    schema: 'jotluck.autocomplete.v2-free-oracle.v1',
    engine: V2_FREE_ENGINE_ID,
    candidateId: trained.candidateId,
    candidateArtifactSha256: trained.candidateArtifactSha256,
    suite: oracle.report.suite,
    holdoutSha256: oracle.report.holdoutSha256,
    evaluatorTreeSha256,
    observationsSha256: oracle.observationsSha256,
    evaluationManifestSha256: oracle.evaluationManifestSha256,
    checkpoints: oracle.aggregate.checkpoints,
    at8: oracle.aggregate.oracleAt8,
    at32: oracle.aggregate.oracleAt32,
    byLanguage: {
      zh: {
        checkpoints: oracle.aggregate.byLanguage.zh.checkpoints,
        at8Hits: oracle.aggregate.byLanguage.zh.oracleAt8Hits,
        at8Rate: countedRate(
          oracle.aggregate.byLanguage.zh.oracleAt8Hits,
          oracle.aggregate.byLanguage.zh.checkpoints,
        ),
      },
      en: {
        checkpoints: oracle.aggregate.byLanguage.en.checkpoints,
        at8Hits: oracle.aggregate.byLanguage.en.oracleAt8Hits,
        at8Rate: countedRate(
          oracle.aggregate.byLanguage.en.oracleAt8Hits,
          oracle.aggregate.byLanguage.en.checkpoints,
        ),
      },
    },
    finalHoldoutsRead: false,
  };
  const oracleFailures = assessOraclePrecheck(oracleReport);
  if (oracleFailures.length > 0) {
    throw new Error(`Oracle promotion gates failed: ${oracleFailures.join(',')}`);
  }

  const promoted = {
    ...trained,
    lifecycle: 'oraclePassed' as const,
    oraclePrecheck: {
      checkpoints: oracleReport.checkpoints,
      oracleAt8: oracleReport.at8.rate,
      oracleAt32: oracleReport.at32.rate,
      chineseOracleAt8: oracleReport.byLanguage.zh.at8Rate,
      englishOracleAt8: oracleReport.byLanguage.en.at8Rate,
      passed: true,
    },
    runtimeStaticDeltaBytes: measurement.runtimeStaticDeltaBytes,
    measuredPeakMemoryBytes: measurement.peakMemoryBytes,
    measuredModelInferenceP90Ms: measurement.modelP90Ms,
    measurementClaims: {
      runtimeStaticDeltaBytes: true,
      measuredPeakMemoryBytes: true,
      measuredModelInferenceP90Ms: true,
    },
    oraclePromotionEvidence: {
      schema: PROMOTION_EVIDENCE_SCHEMA,
      trainedManifestSha256: sha256(trainedBytes),
      oracleEvaluationManifestSha256: oracle.evaluationManifestSha256,
      oracleEvaluationManifestFileSha256: oracle.evaluationManifestFileSha256,
      oracleReportSha256: oracle.reportSha256,
      oracleReportFileSha256: oracle.reportFileSha256,
      observationsSha256: oracle.observationsSha256,
      runtimeMeasurementSha256: sha256(measurementBytes),
      workerExecutableSha256,
      evaluatorTreeSha256,
      modelInferenceSamples: measurement.modelInferenceSamplesMs.length,
      peakMemorySamples: measurement.peakMemorySamplesBytes.length,
    },
  };
  delete promoted.releaseEvidence;
  const outputBytes = jsonBytes(promoted);
  const staticBytes =
    outputBytes.byteLength +
    model.byteLength +
    tokenizer.byteLength +
    measurement.runtimeStaticDeltaBytes;
  if (staticBytes > V2_FREE_STATIC_LIMIT_BYTES) {
    throw new Error('Oracle promotion exceeds the 24 MiB static budget.');
  }
  await writeExclusive(outputPath, outputBytes);
  return {
    candidateId: trained.candidateId,
    candidateArtifactSha256: trained.candidateArtifactSha256,
    outputPath: relativePosix(root, outputPath),
    outputSha256: sha256(outputBytes),
    oracleAt8: oracleReport.at8.rate,
    oracleAt32: oracleReport.at32.rate,
    modelP90Ms: measurement.modelP90Ms,
  };
}

async function readAndVerifyOracleArtifacts(options: {
  directory: string;
  trained: TrainedManifest;
  trainedManifestSha256: V2FreeSha256;
  evaluatorTreeSha256: V2FreeSha256;
  workerExecutableSha256: V2FreeSha256;
}): Promise<{
  manifest: V2FreeEvaluationManifest;
  report: V2FreeEvaluationReport;
  aggregate: ReturnType<typeof aggregateObservations>;
  observationsSha256: V2FreeSha256;
  reportSha256: V2FreeSha256;
  reportFileSha256: V2FreeSha256;
  evaluationManifestSha256: V2FreeSha256;
  evaluationManifestFileSha256: V2FreeSha256;
}> {
  const manifestPath = path.join(options.directory, 'evaluation-manifest.json');
  const manifestBytes = await readFile(manifestPath);
  const manifest = parseRecordJson(
    manifestBytes,
    'Oracle evaluation manifest',
  ) as unknown as V2FreeEvaluationManifest;
  const manifestWithoutHash = omitKey(
    manifest as unknown as Record<string, unknown>,
    'manifestSha256',
  );
  if (
    manifest.schema !== 'jotluck.autocomplete.v2-free-evaluation-manifest.v1' ||
    manifest.schemaVersion !== 1 ||
    manifest.engine !== V2_FREE_ENGINE_ID ||
    manifest.mode !== 'oracle' ||
    (manifest.classification !== 'cold-validation-v1' &&
      manifest.classification !== 'workspace-validation-v1') ||
    manifest.releaseEligible !== false ||
    manifest.finalClaimSha256 !== undefined ||
    manifest.candidateId !== options.trained.candidateId ||
    manifest.candidateArtifactSha256 !== options.trained.candidateArtifactSha256 ||
    manifest.candidateManifestSha256 !== options.trainedManifestSha256 ||
    manifest.evaluatorTreeSha256 !== options.evaluatorTreeSha256 ||
    manifest.workerExecutableSha256 !== options.workerExecutableSha256 ||
    manifest.manifestSha256 !== canonicalSha256(manifestWithoutHash)
  ) {
    throw new Error('Oracle evaluation manifest identity is invalid.');
  }
  if (!isEvidenceDescriptor(manifest.observations) || !isEvidenceDescriptor(manifest.report)) {
    throw new Error('Oracle evaluation manifest evidence descriptors are invalid.');
  }
  const observationsBytes = await readBoundEvidence(
    options.directory,
    manifest.observations,
    'observations.json',
  );
  const reportBytes = await readBoundEvidence(
    options.directory,
    manifest.report,
    'evaluation-report.json',
  );
  const observationsValue = JSON.parse(observationsBytes.toString('utf8')) as unknown;
  if (!Array.isArray(observationsValue)) throw new Error('Oracle observations must be an array.');
  const observations = observationsValue as V2FreeEvaluationObservation[];
  const aggregate = aggregateObservations(observations);
  const report = parseRecordJson(
    reportBytes,
    'Oracle evaluation report',
  ) as unknown as V2FreeEvaluationReport;
  const reportWithoutHash = omitKey(report as unknown as Record<string, unknown>, 'reportSha256');
  const observationsSha256 = sha256(observationsBytes);
  if (
    report.schema !== 'jotluck.autocomplete.v2-free-evaluation-report.v1' ||
    report.schemaVersion !== 1 ||
    report.engine !== V2_FREE_ENGINE_ID ||
    report.mode !== 'oracle' ||
    report.classification !== manifest.classification ||
    report.suite !== (manifest.classification === 'cold-validation-v1' ? 'cold' : 'workspace') ||
    report.candidateId !== options.trained.candidateId ||
    report.candidateArtifactSha256 !== options.trained.candidateArtifactSha256 ||
    report.holdoutSha256 !== manifest.holdoutSha256 ||
    report.evaluatorTreeSha256 !== options.evaluatorTreeSha256 ||
    report.observationsSha256 !== observationsSha256 ||
    report.finalClaimSha256 !== undefined ||
    report.finalHoldoutsRead !== false ||
    report.passed !== false ||
    report.reportSha256 !== canonicalSha256(reportWithoutHash)
  ) {
    throw new Error('Oracle evaluation report identity is invalid.');
  }
  assertReportMatchesAggregate(report, aggregate);
  return {
    manifest,
    report,
    aggregate,
    observationsSha256,
    reportSha256: report.reportSha256,
    reportFileSha256: sha256(reportBytes),
    evaluationManifestSha256: manifest.manifestSha256,
    evaluationManifestFileSha256: sha256(manifestBytes),
  };
}

function aggregateObservations(observations: readonly V2FreeEvaluationObservation[]): {
  checkpoints: number;
  completeCheckpoints: number;
  silenceCheckpoints: number;
  oracleAt8: { hits: number; checkpoints: number; rate: number };
  oracleAt32: { hits: number; checkpoints: number; rate: number };
  top1: { hits: number; checkpoints: number; rate: number };
  triggers: { hits: number; checkpoints: number; rate: number };
  silenceFalseTriggers: { hits: number; checkpoints: number; rate: number };
  byLanguage: Record<'zh' | 'en', { checkpoints: number; oracleAt8Hits: number; top1Hits: number }>;
  byCategory: Record<string, { checkpoints: number; top1Hits: number }>;
  requestP90Ms: number;
} {
  const seen = new Set<string>();
  for (const observation of observations) {
    if (
      !isRecord(observation) ||
      typeof observation.checkpointId !== 'string' ||
      !observation.checkpointId ||
      seen.has(observation.checkpointId) ||
      typeof observation.targetId !== 'string' ||
      (observation.expectedBehavior !== 'complete' && observation.expectedBehavior !== 'silence') ||
      (observation.language !== 'zh' && observation.language !== 'en') ||
      typeof observation.category !== 'string' ||
      !Number.isSafeInteger(observation.cursorOffset) ||
      observation.cursorOffset < 0 ||
      !isNonNegativeFinite(observation.elapsedMs) ||
      !Array.isArray(observation.candidates) ||
      observation.candidates.length > 32
    ) {
      throw new Error('Oracle observation contract is invalid.');
    }
    seen.add(observation.checkpointId);
    for (const candidate of observation.candidates) {
      if (!isRecord(candidate) || typeof candidate.usable !== 'boolean') {
        throw new Error('Oracle candidate observation contract is invalid.');
      }
    }
    const top1Usable = observation.candidates[0]?.usable === true;
    const oracleAt8Usable = observation.candidates
      .slice(0, 8)
      .some((candidate) => candidate.usable);
    const oracleAt32Usable = observation.candidates.some((candidate) => candidate.usable);
    if (
      observation.triggered !== observation.candidates.length > 0 ||
      observation.top1Usable !== top1Usable ||
      observation.oracleAt8Usable !== oracleAt8Usable ||
      observation.oracleAt32Usable !== oracleAt32Usable
    ) {
      throw new Error('Oracle observation derived flags do not match candidate evidence.');
    }
  }
  const complete = observations.filter((item) => item.expectedBehavior === 'complete');
  const silence = observations.filter((item) => item.expectedBehavior === 'silence');
  const byLanguage = {
    zh: aggregateGroup(observations.filter((item) => item.language === 'zh')),
    en: aggregateGroup(observations.filter((item) => item.language === 'en')),
  };
  const byCategory: Record<string, { checkpoints: number; top1Hits: number }> = {};
  for (const observation of observations) {
    const current = byCategory[observation.category] ?? { checkpoints: 0, top1Hits: 0 };
    current.checkpoints++;
    if (observation.top1Usable) current.top1Hits++;
    byCategory[observation.category] = current;
  }
  return {
    checkpoints: observations.length,
    completeCheckpoints: complete.length,
    silenceCheckpoints: silence.length,
    oracleAt8: observationRate(observations, (item) => item.oracleAt8Usable),
    oracleAt32: observationRate(observations, (item) => item.oracleAt32Usable),
    top1: observationRate(observations, (item) => item.top1Usable),
    triggers: observationRate(observations, (item) => item.triggered),
    silenceFalseTriggers: observationRate(silence, (item) => item.triggered),
    byLanguage,
    byCategory,
    requestP90Ms: percentile90(observations.map((item) => item.elapsedMs)),
  };
}

function assertReportMatchesAggregate(
  report: V2FreeEvaluationReport,
  aggregate: ReturnType<typeof aggregateObservations>,
): void {
  if (
    report.checkpoints !== aggregate.checkpoints ||
    report.completeCheckpoints !== aggregate.completeCheckpoints ||
    report.silenceCheckpoints !== aggregate.silenceCheckpoints ||
    !sameJson(report.oracleAt8, aggregate.oracleAt8) ||
    !sameJson(report.oracleAt32, aggregate.oracleAt32) ||
    !sameJson(report.top1, aggregate.top1) ||
    !sameJson(report.triggers, aggregate.triggers) ||
    !sameJson(report.silenceFalseTriggers, aggregate.silenceFalseTriggers) ||
    !sameJson(report.byLanguage, aggregate.byLanguage) ||
    !sameJson(report.byCategory, aggregate.byCategory) ||
    report.requestP90Ms !== aggregate.requestP90Ms
  ) {
    throw new Error('Oracle report aggregate does not match its raw observations.');
  }
}

function parseTrainedManifest(bytes: Buffer): TrainedManifest {
  const value = parseRecordJson(bytes, 'Trained manifest');
  const training = isRecord(value.training) ? value.training : null;
  const tokenizer = isRecord(value.tokenizer) ? value.tokenizer : null;
  const context = isRecord(value.context) ? value.context : null;
  const output = isRecord(value.output) ? value.output : null;
  const oracle = isRecord(value.oraclePrecheck) ? value.oraclePrecheck : null;
  const assets = isRecord(value.assets) ? value.assets : null;
  const measurementClaims = isRecord(value.measurementClaims) ? value.measurementClaims : null;
  if (
    value.schema !== PUBLIC_MANIFEST_SCHEMA ||
    value.schemaVersion !== 1 ||
    value.engine !== V2_FREE_ENGINE_ID ||
    typeof value.candidateId !== 'string' ||
    !CANDIDATE_ID_PATTERN.test(value.candidateId) ||
    !isSha256(value.candidateArtifactSha256) ||
    value.lifecycle !== 'trained' ||
    value.evaluationOnly !== true ||
    value.runtimeEligible !== true ||
    value.releaseEligible !== false ||
    value.releaseEvidence !== undefined ||
    !V2_FREE_MATRIX.some(
      (entry) =>
        entry.parameterCount === value.parameterCount && entry.quantization === value.quantization,
    ) ||
    !tokenizer ||
    tokenizer.kind !== 'unigram' ||
    tokenizer.vocabularySize !== 8_000 ||
    tokenizer.byteFallback !== true ||
    tokenizer.bilingual !== true ||
    !context ||
    context.maximumTokens !== 256 ||
    !output ||
    output.chineseMaximumCodePoints !== 8 ||
    output.englishMaximumCodePoints !== 12 ||
    output.preserveCompleteEnglishWord !== true ||
    !training ||
    training.licenseAuditPassed !== true ||
    !isPositiveSafeInteger(training.cleanedPoolBytes) ||
    training.cleanedPoolBytes > V2_FREE_TRAINING_POOL_LIMIT_BYTES ||
    !oracle ||
    oracle.checkpoints !== 0 ||
    oracle.oracleAt8 !== 0 ||
    oracle.oracleAt32 !== 0 ||
    oracle.chineseOracleAt8 !== 0 ||
    oracle.englishOracleAt8 !== 0 ||
    oracle.passed !== false ||
    !assets ||
    !isAsset(assets.model) ||
    !isAsset(assets.tokenizer) ||
    value.runtimeStaticDeltaBytes !== 0 ||
    value.measuredPeakMemoryBytes !== 0 ||
    !measurementClaims ||
    measurementClaims.runtimeStaticDeltaBytes !== false ||
    measurementClaims.measuredPeakMemoryBytes !== false
  ) {
    throw new Error('Trained manifest is not a valid unpromoted runtime candidate.');
  }
  return value as unknown as TrainedManifest;
}

function parseRuntimeMeasurement(bytes: Buffer): V2FreeRuntimeMeasurement {
  const value = parseRecordJson(bytes, 'Runtime measurement');
  if (
    value.schema !== RUNTIME_MEASUREMENT_SCHEMA ||
    value.schemaVersion !== 1 ||
    value.engine !== V2_FREE_ENGINE_ID ||
    typeof value.candidateId !== 'string' ||
    !isSha256(value.candidateArtifactSha256) ||
    !isSha256(value.workerExecutableSha256) ||
    !isSha256(value.evaluatorTreeSha256) ||
    !isPositiveSafeInteger(value.runtimeStaticDeltaBytes) ||
    !isPositiveSafeInteger(value.peakMemoryBytes) ||
    !isPositiveFinite(value.modelP90Ms) ||
    !Array.isArray(value.modelInferenceSamplesMs) ||
    value.modelInferenceSamplesMs.length < MINIMUM_MODEL_SAMPLES ||
    !value.modelInferenceSamplesMs.every(isPositiveFinite) ||
    !Array.isArray(value.peakMemorySamplesBytes) ||
    value.peakMemorySamplesBytes.length < 1 ||
    !value.peakMemorySamplesBytes.every(isPositiveSafeInteger)
  ) {
    throw new Error('Runtime measurement contract is invalid or lacks raw samples.');
  }
  return value as unknown as V2FreeRuntimeMeasurement;
}

function verifyRuntimeMeasurement(options: {
  measurement: V2FreeRuntimeMeasurement;
  trained: TrainedManifest;
  evaluatorTreeSha256: V2FreeSha256;
  workerExecutableSha256: V2FreeSha256;
}): void {
  const measuredModelP90 = percentile90(options.measurement.modelInferenceSamplesMs);
  const measuredPeak = Math.max(...options.measurement.peakMemorySamplesBytes);
  if (
    options.measurement.candidateId !== options.trained.candidateId ||
    options.measurement.candidateArtifactSha256 !== options.trained.candidateArtifactSha256 ||
    options.measurement.workerExecutableSha256 !== options.workerExecutableSha256 ||
    options.measurement.evaluatorTreeSha256 !== options.evaluatorTreeSha256
  ) {
    throw new Error('Runtime measurement identity does not match the evaluated candidate.');
  }
  if (
    options.measurement.modelP90Ms !== measuredModelP90 ||
    options.measurement.peakMemoryBytes !== measuredPeak
  ) {
    throw new Error('Runtime measurement summary does not match its raw samples.');
  }
  if (options.measurement.modelP90Ms > 80) throw new Error('Runtime model p90 exceeds 80 ms.');
  if (options.measurement.peakMemoryBytes > V2_FREE_PEAK_MEMORY_LIMIT_BYTES) {
    throw new Error('Runtime peak memory exceeds 192 MiB.');
  }
}

async function readBoundAsset(directory: string, asset: TrainedAsset): Promise<Buffer> {
  const target = await realpath(path.join(directory, asset.file));
  if (path.dirname(target) !== directory) throw new Error('Candidate asset escaped its directory.');
  const bytes = await readFile(target);
  if (bytes.byteLength !== asset.bytes || sha256(bytes) !== asset.sha256) {
    throw new Error(`Candidate asset identity mismatch: ${asset.file}`);
  }
  return bytes;
}

async function readBoundEvidence(
  directory: string,
  descriptor: { file: string; bytes: number; sha256: V2FreeSha256 },
  expectedFile: string,
): Promise<Buffer> {
  if (
    descriptor.file !== expectedFile ||
    !isPositiveSafeInteger(descriptor.bytes) ||
    !isSha256(descriptor.sha256)
  ) {
    throw new Error(`Oracle ${expectedFile} descriptor is invalid.`);
  }
  const target = await realpath(path.join(directory, descriptor.file));
  if (path.dirname(target) !== directory) throw new Error('Oracle evidence escaped its directory.');
  const bytes = await readFile(target);
  if (bytes.byteLength !== descriptor.bytes || sha256(bytes) !== descriptor.sha256) {
    throw new Error(`Oracle ${expectedFile} identity mismatch.`);
  }
  return bytes;
}

async function resolveCandidateRoot(root: string, value: string): Promise<string> {
  const candidateRoot = await resolveWorkspaceDirectory(root, value);
  const allowedRoot = path.resolve(
    root,
    'scripts/corpus/_web-cache/autocomplete-v2-free/candidates',
  );
  if (!isWithin(candidateRoot, allowedRoot) || candidateRoot === allowedRoot) {
    throw new Error('Candidate root escaped the isolated V2 free candidate directory.');
  }
  return candidateRoot;
}

async function resolveWorkspaceFile(root: string, value: string): Promise<string> {
  if (!value || path.isAbsolute(value)) throw new Error('Input file must be workspace-relative.');
  const resolved = await realpath(path.join(root, value));
  if (!isWithin(resolved, root)) throw new Error('Input file escaped the workspace.');
  return resolved;
}

async function resolveWorkspaceDirectory(root: string, value: string): Promise<string> {
  if (!value || path.isAbsolute(value))
    throw new Error('Input directory must be workspace-relative.');
  const resolved = await realpath(path.join(root, value));
  if (!isWithin(resolved, root)) throw new Error('Input directory escaped the workspace.');
  return resolved;
}

async function writeExclusive(target: string, bytes: Buffer): Promise<void> {
  const handle = await open(target, 'wx');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function aggregateGroup(items: readonly V2FreeEvaluationObservation[]): {
  checkpoints: number;
  oracleAt8Hits: number;
  top1Hits: number;
} {
  return {
    checkpoints: items.length,
    oracleAt8Hits: items.filter((item) => item.oracleAt8Usable).length,
    top1Hits: items.filter((item) => item.top1Usable).length,
  };
}

function observationRate(
  items: readonly V2FreeEvaluationObservation[],
  predicate: (item: V2FreeEvaluationObservation) => boolean,
): { hits: number; checkpoints: number; rate: number } {
  const hits = items.filter(predicate).length;
  return { hits, checkpoints: items.length, rate: countedRate(hits, items.length) };
}

function countedRate(hits: number, checkpoints: number): number {
  return checkpoints === 0 ? 0 : hits / checkpoints;
}

function percentile90(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.9) - 1)] ?? 0;
}

function isAsset(value: unknown): value is TrainedAsset {
  if (!isRecord(value)) return false;
  return (
    typeof value.file === 'string' &&
    /^[a-z0-9][a-z0-9._-]{0,127}$/u.test(value.file) &&
    !value.file.includes('..') &&
    isSha256(value.sha256) &&
    isPositiveSafeInteger(value.bytes)
  );
}

function isEvidenceDescriptor(
  value: unknown,
): value is { file: string; bytes: number; sha256: V2FreeSha256 } {
  if (!isRecord(value)) return false;
  return (
    typeof value.file === 'string' && isPositiveSafeInteger(value.bytes) && isSha256(value.sha256)
  );
}

function parseRecordJson(bytes: Buffer, label: string): Record<string, unknown> {
  const value = JSON.parse(bytes.toString('utf8')) as unknown;
  if (!isRecord(value)) throw new Error(`${label} must be a JSON object.`);
  return value;
}

function omitKey(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const output = { ...value };
  delete output[key];
  return output;
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function canonicalSha256(value: unknown): V2FreeSha256 {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex') as V2FreeSha256;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('Canonical JSON cannot encode undefined.');
  return encoded;
}

function sha256(bytes: Buffer): V2FreeSha256 {
  return createHash('sha256').update(bytes).digest('hex') as V2FreeSha256;
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function relativePosix(root: string, target: string): string {
  return path.relative(root, target).replaceAll('\\', '/');
}

function isSha256(value: unknown): value is V2FreeSha256 {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
