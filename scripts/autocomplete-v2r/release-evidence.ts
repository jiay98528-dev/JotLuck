import { canonicalSha256, SHA256_PATTERN } from './common';
import {
  validateV2RHoldoutV3,
  type V2RHoldoutClassification,
  type V2RHoldoutV3,
} from './holdout-v3';
import {
  calculateV2RQualityMetrics,
  type V2REvaluationObservation,
  type V2RQualityMetrics,
} from './metrics';
import type { V2RFinalOverlapAudit } from './final-overlap-audit';

export type V2REvidenceHoldoutName =
  | 'coldValidation'
  | 'workspaceValidation'
  | 'coldFinal'
  | 'workspaceFinal';

export interface V2RCandidateIdentity {
  candidateId: string;
  modelSha256: string;
  phraseBankSha256: string;
  metadataSha256: string;
  runtimeSha256: string;
}

export interface V2RPerHoldoutRuntimeEvidence {
  workerOnly: true;
  backendKinds: string[];
  backendStatuses: string[];
  mainThreadLongTasksOver50Ms: number;
}

export interface V2RPerHoldoutQualityEvidence extends V2RCandidateIdentity {
  schema: 'jotluck.autocomplete.v2r-quality-evidence.v1';
  schemaVersion: 1;
  evaluatorVersion: 'production-router-v2r-v1';
  datasetId: string;
  classification: V2RHoldoutClassification;
  holdoutSha256: string;
  observations: V2REvaluationObservation[];
  metrics: V2RQualityMetrics;
  runtime: V2RPerHoldoutRuntimeEvidence;
  reportSha256: string;
}

export interface V2RFinalRunConsumptionReceipt extends V2RCandidateIdentity {
  schema: 'jotluck.autocomplete.v2r-final-run-consumption.v1';
  schemaVersion: 1;
  datasetId: string;
  holdoutSha256: string;
  status: 'passed';
  consumedAt: string;
  qualityReportFileSha256: string;
}

export interface V2RBoundHoldoutEvidence {
  holdout: V2RHoldoutV3;
  report: V2RPerHoldoutQualityEvidence;
  reportFileSha256: string;
}

export interface AggregateV2RReleaseEvidenceInput extends V2RCandidateIdentity {
  evaluatorTreeSha256: string;
  trainingInputTreeSha256: string;
  measuredStaticDeltaBytes: number;
  holdouts: Record<V2REvidenceHoldoutName, V2RBoundHoldoutEvidence>;
  finalReceipts: {
    coldFinal: V2RFinalRunConsumptionReceipt;
    workspaceFinal: V2RFinalRunConsumptionReceipt;
  };
  finalOverlapAudit: V2RFinalOverlapAudit;
}

const EXPECTED_CLASSIFICATIONS: Record<V2REvidenceHoldoutName, V2RHoldoutClassification> = {
  coldValidation: 'cold-validation-v3',
  workspaceValidation: 'workspace-validation-v3',
  coldFinal: 'cold-final-v3',
  workspaceFinal: 'workspace-final-v3',
};

/**
 * Combine four immutable production-Router runs into the only aggregate
 * evidence shapes accepted by the v5 verifier. Every metric is recomputed
 * from observations; a report cannot self-assert that it passed.
 */
export function aggregateV2RReleaseEvidence(input: AggregateV2RReleaseEvidenceInput): {
  qualityReport: Record<string, unknown>;
  runtimeReport: Record<string, unknown>;
  finalConsumptionReceipt: Record<string, unknown>;
} {
  const identity = validateCandidateIdentity(input);
  assertSha(input.evaluatorTreeSha256, 'evaluatorTreeSha256');
  assertSha(input.trainingInputTreeSha256, 'trainingInputTreeSha256');
  if (
    !Number.isSafeInteger(input.measuredStaticDeltaBytes) ||
    input.measuredStaticDeltaBytes <= 0 ||
    input.measuredStaticDeltaBytes > 12 * 1024 * 1024
  ) {
    throw new Error('V2R measured static delta is invalid or exceeds 12 MiB.');
  }

  const audited = {} as Record<
    V2REvidenceHoldoutName,
    { holdoutSha256: string; metrics: V2RQualityMetrics; runtime: V2RPerHoldoutRuntimeEvidence }
  >;
  for (const name of Object.keys(EXPECTED_CLASSIFICATIONS) as V2REvidenceHoldoutName[]) {
    const bound = input.holdouts[name];
    if (!bound) throw new Error(`V2R holdout evidence is missing: ${name}.`);
    const audit = validateV2RHoldoutV3(bound.holdout);
    if (bound.holdout.classification !== EXPECTED_CLASSIFICATIONS[name]) {
      throw new Error(`V2R holdout classification mismatch: ${name}.`);
    }
    const report = validatePerHoldoutReport(
      bound.report,
      identity,
      bound.holdout,
      audit.datasetSha256,
    );
    assertSha(bound.reportFileSha256, `${name}.reportFileSha256`);
    audited[name] = {
      holdoutSha256: audit.datasetSha256,
      metrics: report.metrics,
      runtime: report.runtime,
    };
  }

  validateFinalRunReceipt(
    input.finalReceipts.coldFinal,
    identity,
    audited.coldFinal.holdoutSha256,
    input.holdouts.coldFinal.reportFileSha256,
  );
  validateFinalOverlapAudit(input.finalOverlapAudit, input.holdouts, input);
  validateFinalRunReceipt(
    input.finalReceipts.workspaceFinal,
    identity,
    audited.workspaceFinal.holdoutSha256,
    input.holdouts.workspaceFinal.reportFileSha256,
  );

  const qualityWithoutHash = {
    schema: 'jotluck.autocomplete.v2r-quality-report.v1',
    schemaVersion: 1,
    engine: 'public-phrase-transformer-v1',
    ...identity,
    evaluatorTreeSha256: input.evaluatorTreeSha256,
    candidateFrozenBeforeFinal: true,
    finalOverlapAuditSha256: input.finalOverlapAudit.reportSha256,
    holdouts: mapHoldouts(audited, ({ holdoutSha256, metrics }) => ({
      holdoutSha256,
      metrics,
    })),
    releaseEligible: true,
  };
  const qualityReport = {
    ...qualityWithoutHash,
    reportSha256: canonicalSha256(qualityWithoutHash),
  };

  const finalRuntime = [audited.coldFinal.runtime, audited.workspaceFinal.runtime];
  const runtimeWithoutHash = {
    schema: 'jotluck.autocomplete.v2r-runtime-report.v1',
    schemaVersion: 1,
    candidateId: identity.candidateId,
    modelSha256: identity.modelSha256,
    runtimeSha256: identity.runtimeSha256,
    workerOnly: finalRuntime.every((item) => item.workerOnly),
    mainThreadModelLongTasksOver50Ms: finalRuntime.reduce(
      (sum, item) => sum + item.mainThreadLongTasksOver50Ms,
      0,
    ),
    measuredStaticDeltaBytes: input.measuredStaticDeltaBytes,
    holdouts: mapHoldouts(
      { coldFinal: audited.coldFinal, workspaceFinal: audited.workspaceFinal },
      ({ holdoutSha256, metrics, runtime }) => ({
        holdoutSha256,
        requestCount: metrics.overall.opportunities,
        visibleRequestCount: metrics.overall.triggers,
        allRequestP90Ms: metrics.allRequestP90Ms,
        visibleGhostP90Ms: metrics.visiblePredictionP90Ms,
        timeoutRate: metrics.timeoutRate,
        fallbackRate: metrics.fallbackRate,
        backendKind: singleValue(runtime.backendKinds, 'backend kind'),
        backendStatus: singleValue(runtime.backendStatuses, 'backend status'),
      }),
    ),
  };
  if (
    runtimeWithoutHash.workerOnly !== true ||
    runtimeWithoutHash.mainThreadModelLongTasksOver50Ms !== 0
  ) {
    throw new Error('V2R final runtime evidence is not Worker-only or observed a long task.');
  }
  const runtimeReport = {
    ...runtimeWithoutHash,
    reportSha256: canonicalSha256(runtimeWithoutHash),
  };

  const consumedAt = [
    input.finalReceipts.coldFinal.consumedAt,
    input.finalReceipts.workspaceFinal.consumedAt,
  ].sort()[1]!;
  const receiptWithoutHash = {
    schema: 'jotluck.autocomplete.v2r-final-consumption.v1',
    schemaVersion: 1,
    ...identity,
    status: 'passed',
    consumedOnce: true,
    consumedAt,
    coldFinalSha256: audited.coldFinal.holdoutSha256,
    workspaceFinalSha256: audited.workspaceFinal.holdoutSha256,
    coldFinalQualityReportFileSha256: input.holdouts.coldFinal.reportFileSha256,
    workspaceFinalQualityReportFileSha256: input.holdouts.workspaceFinal.reportFileSha256,
    finalOverlapAuditSha256: input.finalOverlapAudit.reportSha256,
  };
  const finalConsumptionReceipt = {
    ...receiptWithoutHash,
    receiptSha256: canonicalSha256(receiptWithoutHash),
  };

  return { qualityReport, runtimeReport, finalConsumptionReceipt };
}

function validateFinalOverlapAudit(
  audit: V2RFinalOverlapAudit,
  holdouts: AggregateV2RReleaseEvidenceInput['holdouts'],
  input: AggregateV2RReleaseEvidenceInput,
): void {
  const identity = { ...audit } as Record<string, unknown>;
  delete identity.reportSha256;
  const finalHoldoutTreeSha256 = canonicalSha256(
    ([holdouts.coldFinal.holdout, holdouts.workspaceFinal.holdout] as const)
      .map((holdout) => ({
        classification: holdout.classification,
        datasetSha256: validateV2RHoldoutV3(holdout).datasetSha256,
      }))
      .sort((left, right) => left.classification.localeCompare(right.classification)),
  );
  if (
    audit?.schema !== 'jotluck.autocomplete.v2r-final-overlap-audit.v1' ||
    audit.schemaVersion !== 1 ||
    audit.auditorVersion !== 'corpus-governance-v2r-v1' ||
    audit.inputTreeSha256 !== input.trainingInputTreeSha256 ||
    audit.finalHoldoutTreeSha256 !== finalHoldoutTreeSha256 ||
    audit.holdoutExactOverlaps !== 0 ||
    audit.holdoutNearOverlaps !== 0 ||
    audit.passed !== true ||
    audit.reportSha256 !== canonicalSha256(identity)
  ) {
    throw new Error('V2R final overlap audit is invalid or not bound to the frozen candidate.');
  }
}

function validatePerHoldoutReport(
  report: V2RPerHoldoutQualityEvidence,
  identity: V2RCandidateIdentity,
  holdout: V2RHoldoutV3,
  holdoutSha256: string,
): V2RPerHoldoutQualityEvidence {
  if (
    report?.schema !== 'jotluck.autocomplete.v2r-quality-evidence.v1' ||
    report.schemaVersion !== 1 ||
    report.evaluatorVersion !== 'production-router-v2r-v1' ||
    report.datasetId !== holdout.datasetId ||
    report.classification !== holdout.classification ||
    report.holdoutSha256 !== holdoutSha256 ||
    report.observations.length !== 200
  ) {
    throw new Error(`V2R per-holdout report identity is invalid: ${holdout.classification}.`);
  }
  validateCandidateIdentity(report, identity);
  const withoutHash = { ...report } as Record<string, unknown>;
  delete withoutHash.reportSha256;
  if (report.reportSha256 !== canonicalSha256(withoutHash)) {
    throw new Error(`V2R per-holdout report hash is invalid: ${holdout.classification}.`);
  }
  const recalculated = calculateV2RQualityMetrics(report.observations);
  if (canonicalSha256(recalculated) !== canonicalSha256(report.metrics)) {
    throw new Error(`V2R per-holdout metrics were not derived from observations.`);
  }
  if (!recalculated.candidateGate.passed || !recalculated.releaseGate.passed) {
    throw new Error(`V2R holdout quality gate failed: ${holdout.classification}.`);
  }
  if (
    report.runtime?.workerOnly !== true ||
    report.runtime.mainThreadLongTasksOver50Ms !== 0 ||
    singleValue(report.runtime.backendKinds, 'backend kind') !== 'worker' ||
    singleValue(report.runtime.backendStatuses, 'backend status') !== 'ready'
  ) {
    throw new Error(`V2R holdout runtime is degraded: ${holdout.classification}.`);
  }
  return { ...report, metrics: recalculated };
}

function validateFinalRunReceipt(
  receipt: V2RFinalRunConsumptionReceipt,
  identity: V2RCandidateIdentity,
  holdoutSha256: string,
  qualityReportFileSha256: string,
): void {
  if (
    receipt?.schema !== 'jotluck.autocomplete.v2r-final-run-consumption.v1' ||
    receipt.schemaVersion !== 1 ||
    receipt.status !== 'passed' ||
    receipt.holdoutSha256 !== holdoutSha256 ||
    receipt.qualityReportFileSha256 !== qualityReportFileSha256 ||
    !isCanonicalIso(receipt.consumedAt)
  ) {
    throw new Error(`V2R final-run consumption receipt is invalid: ${receipt?.datasetId}.`);
  }
  validateCandidateIdentity(receipt, identity);
}

function validateCandidateIdentity(
  value: V2RCandidateIdentity,
  expected?: V2RCandidateIdentity,
): V2RCandidateIdentity {
  if (!value?.candidateId || value.candidateId.length > 160) {
    throw new Error('V2R candidateId is invalid.');
  }
  for (const key of [
    'modelSha256',
    'phraseBankSha256',
    'metadataSha256',
    'runtimeSha256',
  ] as const) {
    assertSha(value[key], key);
    if (expected && value[key] !== expected[key]) {
      throw new Error(`V2R candidate identity mismatch: ${key}.`);
    }
  }
  if (expected && value.candidateId !== expected.candidateId) {
    throw new Error('V2R candidate identity mismatch: candidateId.');
  }
  return {
    candidateId: value.candidateId,
    modelSha256: value.modelSha256,
    phraseBankSha256: value.phraseBankSha256,
    metadataSha256: value.metadataSha256,
    runtimeSha256: value.runtimeSha256,
  };
}

function mapHoldouts<T extends object, R>(
  input: T,
  mapper: (value: T[keyof T]) => R,
): { [K in keyof T]: R } {
  return Object.fromEntries(
    Object.entries(input).map(([name, value]) => [name, mapper(value as T[keyof T])]),
  ) as { [K in keyof T]: R };
}

function singleValue(values: readonly string[], label: string): string {
  if (!Array.isArray(values) || values.length === 0) throw new Error(`V2R ${label} is missing.`);
  const unique = [...new Set(values)];
  if (unique.length !== 1) throw new Error(`V2R ${label} is not stable across the run.`);
  return unique[0]!;
}

function assertSha(value: string, label: string): void {
  if (!SHA256_PATTERN.test(value)) throw new Error(`V2R ${label} is not a SHA-256 digest.`);
}

function isCanonicalIso(value: string): boolean {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
