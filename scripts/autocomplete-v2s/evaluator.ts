import {
  isMixedV2SCandidate,
  isV2SCandidateUsable,
  type V2SCheckpoint,
  type V2SHoldoutClassification,
  type V2SLanguage,
  type V2SNoteCategory,
} from './holdout';

export interface V2SObservedCandidate {
  text: string;
  providerId: string;
  sourceLayer: string;
}

export interface V2SEvaluationObservation {
  checkpointId: string;
  language: V2SLanguage;
  category: V2SNoteCategory;
  checkpoint: V2SCheckpoint;
  b0Top1: V2SObservedCandidate | null;
  publicCandidates: V2SObservedCandidate[];
  combinedTop1: V2SObservedCandidate | null;
  allRequestLatencyMs: number;
  visibleLatencyMs?: number;
  fallback: boolean;
  timeout: boolean;
  rejectionReasons: string[];
}

export interface V2STop1Metrics {
  opportunities: number;
  completeOpportunities: number;
  silenceOpportunities: number;
  triggers: number;
  triggerRate: number;
  usable: number;
  absoluteUsableRate: number;
  conditionalPrecision: number;
  silenceFalseTriggers: number;
  silenceFalseRate: number;
  unusableTriggers: number;
  unusableTriggerRate: number;
}

export interface V2SOracleMetrics {
  oracleAt8Hits: number;
  oracleAt8AbsoluteRate: number;
  oracleAt32Hits: number;
  oracleAt32AbsoluteRate: number;
  newCoverageOnB0Misses: number;
  newCoverageOnB0MissesAbsoluteRate: number;
}

export interface V2SEvaluationThresholds {
  minimumTriggerRate: number;
  maximumTriggerRate: number;
  minimumAbsoluteUsableRate: number;
  maximumSilenceFalseRate: number;
  minimumLanguageAbsoluteUsableRate: number;
  minimumCategoryAbsoluteUsableRate: number;
  minimumOracleAt8AbsoluteRate: number;
  minimumOracleAt32AbsoluteRate: number;
  minimumLanguageOracleAt8AbsoluteRate: number;
  minimumNewPublicCoverageRate: number;
  maximumP90Ms: number;
  validationMinimumTriggerRate: number;
  validationMaximumTriggerRate: number;
  validationMinimumUsableRate: number;
  validationMaximumP90Ms: number;
}

export interface V2SEvaluationReport {
  classification: V2SHoldoutClassification;
  b0: V2STop1Metrics;
  combined: V2STop1Metrics;
  publicOracle: V2SOracleMetrics;
  combinedByLanguage: Record<V2SLanguage, V2STop1Metrics>;
  combinedByCategory: Record<V2SNoteCategory, V2STop1Metrics>;
  publicOracleByLanguage: Record<V2SLanguage, V2SOracleMetrics>;
  combinedNewUsable: number;
  combinedLostUsable: number;
  mixedPublicCandidates: number;
  mixedVisibleCandidates: number;
  allRequestP90Ms: number;
  visiblePredictionP90Ms: number;
  fallbackRate: number;
  timeoutRate: number;
  rejectionReasons: Record<string, number>;
  architectureGate: { passed: boolean; reasons: string[] };
  releaseGate: { passed: boolean; reasons: string[] };
  validationMargin: { passed: boolean; reasons: string[] };
}

export const V2S_RELEASE_THRESHOLDS: V2SEvaluationThresholds = {
  minimumTriggerRate: 0.35,
  maximumTriggerRate: 0.42,
  minimumAbsoluteUsableRate: 0.35,
  maximumSilenceFalseRate: 0.03,
  minimumLanguageAbsoluteUsableRate: 0.3,
  minimumCategoryAbsoluteUsableRate: 0.25,
  minimumOracleAt8AbsoluteRate: 0.4,
  minimumOracleAt32AbsoluteRate: 0.45,
  minimumLanguageOracleAt8AbsoluteRate: 0.32,
  minimumNewPublicCoverageRate: 0.08,
  maximumP90Ms: 140,
  validationMinimumTriggerRate: 0.37,
  validationMaximumTriggerRate: 0.4,
  validationMinimumUsableRate: 0.37,
  validationMaximumP90Ms: 120,
};

const CATEGORIES: readonly V2SNoteCategory[] = [
  'field-observation',
  'maintenance-log',
  'meeting-note',
  'reading-note',
  'household-plan',
];

export function calculateV2SEvaluation(
  classification: V2SHoldoutClassification,
  observations: readonly V2SEvaluationObservation[],
  thresholds: V2SEvaluationThresholds = V2S_RELEASE_THRESHOLDS,
): V2SEvaluationReport {
  assertReleaseObservationShape(observations);
  const ids = new Set<string>();
  for (const observation of observations) {
    if (!observation.checkpointId || ids.has(observation.checkpointId)) {
      throw new Error(`Duplicate checkpoint observation: ${observation.checkpointId}.`);
    }
    ids.add(observation.checkpointId);
    if (observation.publicCandidates.length > 32) {
      throw new Error(`Checkpoint ${observation.checkpointId} exceeds the 32-candidate limit.`);
    }
    if (!Number.isFinite(observation.allRequestLatencyMs) || observation.allRequestLatencyMs < 0) {
      throw new Error(`Checkpoint ${observation.checkpointId} has invalid all-request latency.`);
    }
    if (
      observation.combinedTop1 &&
      (observation.visibleLatencyMs === undefined ||
        !Number.isFinite(observation.visibleLatencyMs) ||
        observation.visibleLatencyMs < 0)
    ) {
      throw new Error(`Checkpoint ${observation.checkpointId} lacks visible latency evidence.`);
    }
    for (const candidate of observation.publicCandidates) {
      if (
        !candidate.text ||
        candidate.providerId !== 'public-v2s-mkn-v1' ||
        candidate.sourceLayer !== 'l3'
      ) {
        throw new Error(
          `Checkpoint ${observation.checkpointId} has an invalid Public V2S binding.`,
        );
      }
    }
  }

  const b0 = calculateTop1(observations, (item) => item.b0Top1);
  const combined = calculateTop1(observations, (item) => item.combinedTop1);
  const publicOracle = calculateOracle(observations);
  const combinedByLanguage = {
    zh: calculateTop1(
      observations.filter((item) => item.language === 'zh'),
      (item) => item.combinedTop1,
    ),
    en: calculateTop1(
      observations.filter((item) => item.language === 'en'),
      (item) => item.combinedTop1,
    ),
  };
  const publicOracleByLanguage = {
    zh: calculateOracle(observations.filter((item) => item.language === 'zh')),
    en: calculateOracle(observations.filter((item) => item.language === 'en')),
  };
  const combinedByCategory = Object.fromEntries(
    CATEGORIES.map((category) => [
      category,
      calculateTop1(
        observations.filter((item) => item.category === category),
        (item) => item.combinedTop1,
      ),
    ]),
  ) as Record<V2SNoteCategory, V2STop1Metrics>;

  const combinedNewUsable = observations.filter(
    (item) => isUsable(item.combinedTop1, item) && !isUsable(item.b0Top1, item),
  ).length;
  const combinedLostUsable = observations.filter(
    (item) => isUsable(item.b0Top1, item) && !isUsable(item.combinedTop1, item),
  ).length;
  const mixedPublicCandidates = observations.reduce(
    (sum, item) =>
      sum +
      item.publicCandidates.filter((candidate) =>
        isMixedV2SCandidate(candidate.text, item.language),
      ).length,
    0,
  );
  const mixedVisibleCandidates = observations.filter(
    (item) => item.combinedTop1 && isMixedV2SCandidate(item.combinedTop1.text, item.language),
  ).length;
  const allRequestP90Ms = percentile(
    observations.map((item) => item.allRequestLatencyMs),
    0.9,
  );
  const visiblePredictionP90Ms = percentile(
    observations.flatMap((item) =>
      item.combinedTop1 && item.visibleLatencyMs !== undefined ? [item.visibleLatencyMs] : [],
    ),
    0.9,
  );
  const fallbackRate = ratio(
    observations.filter((item) => item.fallback).length,
    observations.length,
  );
  const timeoutRate = ratio(
    observations.filter((item) => item.timeout).length,
    observations.length,
  );
  const rejectionReasons: Record<string, number> = {};
  for (const observation of observations) {
    for (const reason of observation.rejectionReasons) {
      rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
    }
  }

  const architectureReasons: string[] = [];
  if (publicOracle.oracleAt8AbsoluteRate < thresholds.minimumOracleAt8AbsoluteRate) {
    architectureReasons.push('Public Oracle@8 absolute rate is below 40%.');
  }
  if (publicOracle.oracleAt32AbsoluteRate < thresholds.minimumOracleAt32AbsoluteRate) {
    architectureReasons.push('Public Oracle@32 absolute rate is below 45%.');
  }
  for (const language of ['zh', 'en'] as const) {
    if (
      publicOracleByLanguage[language].oracleAt8AbsoluteRate <
      thresholds.minimumLanguageOracleAt8AbsoluteRate
    ) {
      architectureReasons.push(`${language} Public Oracle@8 absolute rate is below 32%.`);
    }
  }
  if (
    classification.startsWith('cold-') &&
    publicOracle.newCoverageOnB0MissesAbsoluteRate < thresholds.minimumNewPublicCoverageRate
  ) {
    architectureReasons.push('Public Oracle adds less than 8pp coverage on B0 misses.');
  }

  const releaseReasons: string[] = [];
  if (
    combined.triggerRate < thresholds.minimumTriggerRate ||
    combined.triggerRate > thresholds.maximumTriggerRate
  ) {
    releaseReasons.push('Combined trigger rate is outside 35%-42%.');
  }
  if (combined.absoluteUsableRate < thresholds.minimumAbsoluteUsableRate) {
    releaseReasons.push('Combined absolute usable rate is below 35%.');
  }
  if (combined.silenceFalseRate > thresholds.maximumSilenceFalseRate) {
    releaseReasons.push('Combined silence false-trigger rate exceeds 3%.');
  }
  for (const language of ['zh', 'en'] as const) {
    if (
      combinedByLanguage[language].absoluteUsableRate < thresholds.minimumLanguageAbsoluteUsableRate
    ) {
      releaseReasons.push(`${language} absolute usable rate is below 30%.`);
    }
  }
  for (const category of CATEGORIES) {
    if (
      combinedByCategory[category].absoluteUsableRate < thresholds.minimumCategoryAbsoluteUsableRate
    ) {
      releaseReasons.push(`${category} absolute usable rate is below 25%.`);
    }
  }
  if (combined.usable < b0.usable || combinedLostUsable > combinedNewUsable) {
    releaseReasons.push('Public V2S regresses the paired Public-off B0 result.');
  }
  releaseReasons.push(...architectureReasons);
  if (mixedPublicCandidates > 0 || mixedVisibleCandidates > 0) {
    releaseReasons.push(
      'Mixed-language candidates must be zero in the full public pool and ghost.',
    );
  }
  if (
    allRequestP90Ms > thresholds.maximumP90Ms ||
    visiblePredictionP90Ms > thresholds.maximumP90Ms
  ) {
    releaseReasons.push('All-request or visible prediction p90 exceeds 140ms.');
  }

  const marginReasons: string[] = [];
  if (
    combined.triggerRate < thresholds.validationMinimumTriggerRate ||
    combined.triggerRate > thresholds.validationMaximumTriggerRate
  ) {
    marginReasons.push('Validation trigger rate is outside the 37%-40% target margin.');
  }
  if (combined.absoluteUsableRate < thresholds.validationMinimumUsableRate) {
    marginReasons.push('Validation absolute usable rate is below the 37% target margin.');
  }
  if (combined.silenceFalseTriggers > 0) {
    marginReasons.push('Validation target margin requires zero silence false triggers.');
  }
  if (
    allRequestP90Ms > thresholds.validationMaximumP90Ms ||
    visiblePredictionP90Ms > thresholds.validationMaximumP90Ms
  ) {
    marginReasons.push('Validation target margin requires both p90 values at or below 120ms.');
  }

  return {
    classification,
    b0,
    combined,
    publicOracle,
    combinedByLanguage,
    combinedByCategory,
    publicOracleByLanguage,
    combinedNewUsable,
    combinedLostUsable,
    mixedPublicCandidates,
    mixedVisibleCandidates,
    allRequestP90Ms,
    visiblePredictionP90Ms,
    fallbackRate,
    timeoutRate,
    rejectionReasons,
    architectureGate: { passed: architectureReasons.length === 0, reasons: architectureReasons },
    releaseGate: { passed: releaseReasons.length === 0, reasons: releaseReasons },
    validationMargin: { passed: marginReasons.length === 0, reasons: marginReasons },
  };
}

function assertReleaseObservationShape(observations: readonly V2SEvaluationObservation[]): void {
  if (observations.length !== 200) {
    throw new Error(
      `Public V2S evaluation requires exactly 200 observations, got ${observations.length}.`,
    );
  }
  const complete = observations.filter(
    (item) => item.checkpoint.expectedBehavior === 'complete',
  ).length;
  const silence = observations.length - complete;
  if (complete !== 150 || silence !== 50) {
    throw new Error(
      `Public V2S evaluation requires 150 complete and 50 silence observations, got ${complete}/${silence}.`,
    );
  }
  for (const language of ['zh', 'en'] as const) {
    const count = observations.filter((item) => item.language === language).length;
    if (count !== 100) {
      throw new Error(`Public V2S evaluation requires 100 ${language} observations, got ${count}.`);
    }
  }
  for (const category of CATEGORIES) {
    const count = observations.filter((item) => item.category === category).length;
    if (count !== 40) {
      throw new Error(`Public V2S evaluation requires 40 ${category} observations, got ${count}.`);
    }
  }
}

export function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0;
  if (!(quantile >= 0 && quantile <= 1)) throw new Error('Quantile must be in [0, 1].');
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * quantile) - 1] ?? sorted[0]!;
}

function calculateTop1(
  observations: readonly V2SEvaluationObservation[],
  select: (observation: V2SEvaluationObservation) => V2SObservedCandidate | null,
): V2STop1Metrics {
  const triggered = observations.filter((item) => Boolean(select(item)));
  const usable = triggered.filter((item) => isUsable(select(item), item));
  const silence = observations.filter((item) => item.checkpoint.expectedBehavior === 'silence');
  const silenceFalse = silence.filter((item) => Boolean(select(item)));
  return {
    opportunities: observations.length,
    completeOpportunities: observations.length - silence.length,
    silenceOpportunities: silence.length,
    triggers: triggered.length,
    triggerRate: ratio(triggered.length, observations.length),
    usable: usable.length,
    absoluteUsableRate: ratio(usable.length, observations.length),
    conditionalPrecision: ratio(usable.length, triggered.length),
    silenceFalseTriggers: silenceFalse.length,
    silenceFalseRate: ratio(silenceFalse.length, silence.length),
    unusableTriggers: triggered.length - usable.length,
    unusableTriggerRate: ratio(triggered.length - usable.length, observations.length),
  };
}

function calculateOracle(observations: readonly V2SEvaluationObservation[]): V2SOracleMetrics {
  const oracleAt8Hits = observations.filter((item) =>
    item.publicCandidates
      .slice(0, 8)
      .some((candidate) => isV2SCandidateUsable(candidate.text, item.checkpoint, item.language)),
  ).length;
  const oracleAt32Hits = observations.filter((item) =>
    item.publicCandidates.some((candidate) =>
      isV2SCandidateUsable(candidate.text, item.checkpoint, item.language),
    ),
  ).length;
  const newCoverageOnB0Misses = observations.filter(
    (item) =>
      !isUsable(item.b0Top1, item) &&
      item.publicCandidates
        .slice(0, 8)
        .some((candidate) => isV2SCandidateUsable(candidate.text, item.checkpoint, item.language)),
  ).length;
  return {
    oracleAt8Hits,
    oracleAt8AbsoluteRate: ratio(oracleAt8Hits, observations.length),
    oracleAt32Hits,
    oracleAt32AbsoluteRate: ratio(oracleAt32Hits, observations.length),
    newCoverageOnB0Misses,
    newCoverageOnB0MissesAbsoluteRate: ratio(newCoverageOnB0Misses, observations.length),
  };
}

function isUsable(
  candidate: V2SObservedCandidate | null,
  observation: V2SEvaluationObservation,
): boolean {
  return Boolean(
    candidate && isV2SCandidateUsable(candidate.text, observation.checkpoint, observation.language),
  );
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}
