import type { V2RNoteCategory } from './corpus-governance';
import { isCandidateUsable, type V2RHoldoutCheckpoint } from './holdout-v3';
import { isMixedLanguageCandidate, type V2RLanguage } from './phrase-extraction';

export interface V2REvaluationObservation {
  checkpointId: string;
  language: V2RLanguage;
  category: V2RNoteCategory;
  checkpoint: V2RHoldoutCheckpoint;
  publicL3Candidates: Array<{
    text: string;
    providerId: 'public-phrase-transformer-v1';
    sourceLayer: 'l3';
    source: 'neural';
  }>;
  resolverTop1?: {
    text: string;
    providerId: string;
    sourceLayer: string;
  } | null;
  allRequestLatencyMs?: number;
  visibleLatencyMs?: number;
  fallback?: boolean;
  timeout?: boolean;
}

export interface V2RMetricSlice {
  opportunities: number;
  completeOpportunities: number;
  silenceOpportunities: number;
  triggers: number;
  triggerRate: number;
  usable: number;
  usableRate: number;
  positiveRecall: number;
  conditionalPrecision: number;
  falseTriggers: number;
  falseTriggerRate: number;
  oracleAt32Hits: number;
  oracleAt32Rate: number;
  oracleAt32PositiveRecall: number;
}

export interface V2RQualityMetrics {
  overall: V2RMetricSlice;
  byLanguage: Record<V2RLanguage, V2RMetricSlice>;
  byCategory: Record<V2RNoteCategory, V2RMetricSlice>;
  mixedVisibleCandidates: number;
  mixedRankedCandidates: number;
  allRequestP90Ms: number;
  visiblePredictionP90Ms: number;
  fallbackRate: number;
  timeoutRate: number;
  candidateGate: { passed: boolean; reasons: string[] };
  releaseGate: { passed: boolean; reasons: string[] };
}

export interface V2RMetricThresholds {
  minimumTriggerRate: number;
  maximumTriggerRate: number;
  minimumUsableRate: number;
  maximumFalseTriggerRate: number;
  minimumLanguageUsableRate: number;
  minimumCategoryUsableRate: number;
  minimumOracleAt32Rate: number;
  minimumLanguageOracleAt32Rate: number;
  maximumP90Ms: number;
}

export const V2R_RELEASE_THRESHOLDS: V2RMetricThresholds = {
  minimumTriggerRate: 0.6,
  maximumTriggerRate: 0.65,
  minimumUsableRate: 0.6,
  maximumFalseTriggerRate: 0.03,
  minimumLanguageUsableRate: 0.55,
  minimumCategoryUsableRate: 0.5,
  minimumOracleAt32Rate: 0.7,
  minimumLanguageOracleAt32Rate: 0.65,
  maximumP90Ms: 140,
};

export function calculateV2RQualityMetrics(
  observations: readonly V2REvaluationObservation[],
  thresholds: V2RMetricThresholds = V2R_RELEASE_THRESHOLDS,
  options: { requireRuntimeEvidence?: boolean } = {},
): V2RQualityMetrics {
  if (observations.length === 0) throw new Error('V2R evaluation requires observations.');
  const ids = new Set<string>();
  for (const observation of observations) {
    if (!observation.checkpointId || ids.has(observation.checkpointId)) {
      throw new Error(`Duplicate or empty checkpoint id: ${observation.checkpointId}.`);
    }
    ids.add(observation.checkpointId);
    if (observation.publicL3Candidates.length > 32) {
      throw new Error(`Checkpoint ${observation.checkpointId} returned more than 32 candidates.`);
    }
    for (const candidate of observation.publicL3Candidates) {
      if (
        !candidate.text ||
        candidate.providerId !== 'public-phrase-transformer-v1' ||
        candidate.sourceLayer !== 'l3' ||
        candidate.source !== 'neural'
      ) {
        throw new Error(
          `Checkpoint ${observation.checkpointId} has an invalid public L3 candidate binding.`,
        );
      }
    }
    validateLatency(
      observation.allRequestLatencyMs,
      `${observation.checkpointId}.allRequestLatencyMs`,
    );
    validateLatency(observation.visibleLatencyMs, `${observation.checkpointId}.visibleLatencyMs`);
    if (
      observation.resolverTop1 &&
      (!observation.resolverTop1.text ||
        !observation.resolverTop1.providerId ||
        !observation.resolverTop1.sourceLayer)
    ) {
      throw new Error(
        `Checkpoint ${observation.checkpointId} has an incomplete Resolver Top-1 binding.`,
      );
    }
    if ((options.requireRuntimeEvidence ?? true) && observation.allRequestLatencyMs === undefined) {
      throw new Error(
        `Checkpoint ${observation.checkpointId} is missing all-request latency evidence.`,
      );
    }
    if (
      (options.requireRuntimeEvidence ?? true) &&
      observation.resolverTop1 &&
      observation.visibleLatencyMs === undefined
    ) {
      throw new Error(
        `Checkpoint ${observation.checkpointId} is missing visible latency evidence.`,
      );
    }
  }

  const overall = calculateSlice(observations);
  const byLanguage = {
    zh: calculateSlice(observations.filter((item) => item.language === 'zh')),
    en: calculateSlice(observations.filter((item) => item.language === 'en')),
  };
  const byCategory = {
    'field-observation': calculateSlice(
      observations.filter((item) => item.category === 'field-observation'),
    ),
    'maintenance-log': calculateSlice(
      observations.filter((item) => item.category === 'maintenance-log'),
    ),
    'meeting-note': calculateSlice(observations.filter((item) => item.category === 'meeting-note')),
    'reading-note': calculateSlice(observations.filter((item) => item.category === 'reading-note')),
    'household-plan': calculateSlice(
      observations.filter((item) => item.category === 'household-plan'),
    ),
  };
  const mixedVisibleCandidates = observations.filter(
    (item) =>
      item.resolverTop1?.text && isMixedLanguageCandidate(item.resolverTop1.text, item.language),
  ).length;
  const mixedRankedCandidates = observations.reduce(
    (sum, item) =>
      sum +
      item.publicL3Candidates.filter((candidate) =>
        isMixedLanguageCandidate(candidate.text, item.language),
      ).length,
    0,
  );
  const allRequestP90Ms = percentile(
    observations.flatMap((item) =>
      item.allRequestLatencyMs === undefined ? [] : [item.allRequestLatencyMs],
    ),
    0.9,
  );
  const visiblePredictionP90Ms = percentile(
    observations.flatMap((item) =>
      item.resolverTop1 && item.visibleLatencyMs !== undefined ? [item.visibleLatencyMs] : [],
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

  const candidateReasons: string[] = [];
  if (overall.oracleAt32Rate < thresholds.minimumOracleAt32Rate) {
    candidateReasons.push(
      `Oracle@32 absolute rate ${overall.oracleAt32Rate} is below ${thresholds.minimumOracleAt32Rate}.`,
    );
  }
  for (const language of ['zh', 'en'] as const) {
    if (byLanguage[language].oracleAt32Rate < thresholds.minimumLanguageOracleAt32Rate) {
      candidateReasons.push(
        `${language} Oracle@32 absolute rate ${byLanguage[language].oracleAt32Rate} is below ${thresholds.minimumLanguageOracleAt32Rate}.`,
      );
    }
  }

  const releaseReasons = [...candidateReasons];
  if (
    overall.triggerRate < thresholds.minimumTriggerRate ||
    overall.triggerRate > thresholds.maximumTriggerRate
  ) {
    releaseReasons.push(
      `Trigger rate ${overall.triggerRate} is outside ${thresholds.minimumTriggerRate}-${thresholds.maximumTriggerRate}.`,
    );
  }
  if (overall.usableRate < thresholds.minimumUsableRate) {
    releaseReasons.push(
      `Absolute usable rate ${overall.usableRate} is below ${thresholds.minimumUsableRate}.`,
    );
  }
  if (overall.falseTriggerRate > thresholds.maximumFalseTriggerRate) {
    releaseReasons.push(
      `False-trigger rate ${overall.falseTriggerRate} exceeds ${thresholds.maximumFalseTriggerRate}.`,
    );
  }
  for (const language of ['zh', 'en'] as const) {
    if (byLanguage[language].usableRate < thresholds.minimumLanguageUsableRate) {
      releaseReasons.push(
        `${language} usable rate ${byLanguage[language].usableRate} is below ${thresholds.minimumLanguageUsableRate}.`,
      );
    }
  }
  for (const [category, metrics] of Object.entries(byCategory)) {
    if (metrics.opportunities > 0 && metrics.usableRate < thresholds.minimumCategoryUsableRate) {
      releaseReasons.push(
        `${category} usable rate ${metrics.usableRate} is below ${thresholds.minimumCategoryUsableRate}.`,
      );
    }
  }
  if (mixedVisibleCandidates > 0 || mixedRankedCandidates > 0) {
    releaseReasons.push('Mixed-language candidates must be zero across the full ranked pool.');
  }
  if (
    allRequestP90Ms > thresholds.maximumP90Ms ||
    visiblePredictionP90Ms > thresholds.maximumP90Ms
  ) {
    releaseReasons.push(`Prediction p90 exceeds ${thresholds.maximumP90Ms}ms.`);
  }

  return {
    overall,
    byLanguage,
    byCategory,
    mixedVisibleCandidates,
    mixedRankedCandidates,
    allRequestP90Ms,
    visiblePredictionP90Ms,
    fallbackRate,
    timeoutRate,
    candidateGate: { passed: candidateReasons.length === 0, reasons: candidateReasons },
    releaseGate: { passed: releaseReasons.length === 0, reasons: releaseReasons },
  };
}

export function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0;
  if (!(quantile >= 0 && quantile <= 1)) throw new Error('Quantile must be in [0, 1].');
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(quantile * sorted.length) - 1] ?? sorted[0]!;
}

function calculateSlice(observations: readonly V2REvaluationObservation[]): V2RMetricSlice {
  const opportunities = observations.length;
  const completeOpportunities = observations.filter(
    (item) => item.checkpoint.expectedBehavior === 'complete',
  ).length;
  const silenceOpportunities = opportunities - completeOpportunities;
  const triggered = observations.filter((item) => Boolean(item.resolverTop1?.text));
  const usable = triggered.filter((item) =>
    isCandidateUsable(item.resolverTop1!.text, item.checkpoint, item.language),
  ).length;
  const falseTriggers = triggered.filter(
    (item) => item.checkpoint.expectedBehavior === 'silence',
  ).length;
  const oracleAt32Hits = observations.filter((item) =>
    item.publicL3Candidates.some((candidate) =>
      isCandidateUsable(candidate.text, item.checkpoint, item.language),
    ),
  ).length;
  return {
    opportunities,
    completeOpportunities,
    silenceOpportunities,
    triggers: triggered.length,
    triggerRate: ratio(triggered.length, opportunities),
    usable,
    usableRate: ratio(usable, opportunities),
    positiveRecall: ratio(usable, completeOpportunities),
    conditionalPrecision: ratio(usable, triggered.length),
    falseTriggers,
    falseTriggerRate: ratio(falseTriggers, silenceOpportunities),
    oracleAt32Hits,
    oracleAt32Rate: ratio(oracleAt32Hits, opportunities),
    oracleAt32PositiveRecall: ratio(oracleAt32Hits, completeOpportunities),
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function validateLatency(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new Error(`${label} is invalid.`);
  }
}
