import { canonicalSha256, SHA256_PATTERN, V2S_ENGINE_ID } from './common';

export const V2S_ARCHITECTURE_STOP_SCHEMA = 'jotluck.autocomplete.v2s-architecture-stop.v1';
export const V2S_METHOD_STOP_SCHEMA = 'jotluck.autocomplete.v2s-method-stop.v1';
export const V2S_ARCHITECTURE_STOP_PATH = 'scripts/corpus/autocomplete-v2s-architecture-stop.json';

export interface OracleObservation {
  kind: 'complete' | 'silence';
  representable: boolean;
  oracleHit: boolean;
  language: 'zh' | 'en';
}

export interface AbsoluteOracleReport {
  denominator: 'all-opportunities';
  opportunities: number;
  completeOpportunities: number;
  representableOpportunities: number;
  oracleHits: number;
  absoluteOracleRate: number;
  completeOracleRate: number;
  conditionalRepresentableRate: number;
  byLanguage: Record<
    'zh' | 'en',
    { opportunities: number; oracleHits: number; absoluteOracleRate: number }
  >;
}

export interface V2SArchitectureOracleSummary {
  denominator: 'all-development-opportunities';
  opportunities: number;
  completeOpportunities: number;
  silenceOpportunities: number;
  at8: {
    hits: number;
    absoluteRate: number;
    byLanguage: Record<'zh' | 'en', { opportunities: number; hits: number; absoluteRate: number }>;
  };
  at32: {
    hits: number;
    absoluteRate: number;
    byLanguage: Record<'zh' | 'en', { opportunities: number; hits: number; absoluteRate: number }>;
  };
}

export interface V2SArchitectureStop {
  schema: typeof V2S_ARCHITECTURE_STOP_SCHEMA;
  schemaVersion: 1;
  engine: typeof V2S_ENGINE_ID;
  status: 'architecture-blocked';
  architectureId: typeof V2S_ENGINE_ID;
  formalResult: false;
  releaseEvidence: false;
  stopLongTraining: true;
  reasonCode: 'development-oracle-ceiling' | 'asset-budget' | 'runtime-budget';
  recordedAt: string;
  sourceCommit: string;
  workingTreeClean: false;
  gates: {
    oracleAt8AbsoluteMinimum: 0.4;
    oracleAt32AbsoluteMinimum: 0.45;
    perLanguageOracleAt8AbsoluteMinimum: 0.32;
  };
  oracle: V2SArchitectureOracleSummary;
  frontierDerivation: 'per-language-max-over-fixed-matrix';
  bestFixedMatrixFrontier: V2SArchitectureOracleSummary;
  candidateId: string;
  methodCorrection: 'bpe-en+unigram-zh';
  evidenceBindings: Record<string, { path: string; sha256: string }>;
  lifecycle: {
    gateTrainingStarted: false;
    finalHoldoutsRead: false;
    publicWritten: false;
    v21Unlocked: false;
  };
  recordSha256: string;
}

export interface V2SMethodStop {
  schema: typeof V2S_METHOD_STOP_SCHEMA;
  status: 'method-blocked';
  architectureId: string;
  methodId: string;
  stopLongTraining: true;
  reasonCode: 'optimization-failed' | 'calibration-failed' | 'quality-gate-failed';
  attempts: number;
  maximumAttempts: number;
  evidenceSha256: string;
}

export function calculateAbsoluteOracle(
  observations: readonly OracleObservation[],
): AbsoluteOracleReport {
  if (observations.length === 0)
    throw new Error('Oracle report requires at least one opportunity.');
  for (const [index, observation] of observations.entries()) {
    if (observation.oracleHit && (!observation.representable || observation.kind !== 'complete')) {
      throw new Error(
        `Oracle observation ${index} cannot hit an unrepresentable or silence checkpoint.`,
      );
    }
  }
  const complete = observations.filter((observation) => observation.kind === 'complete');
  const representable = complete.filter((observation) => observation.representable);
  const hits = observations.filter((observation) => observation.oracleHit);
  const byLanguage = Object.fromEntries(
    (['zh', 'en'] as const).map((language) => {
      const languageItems = observations.filter((observation) => observation.language === language);
      const languageHits = languageItems.filter((observation) => observation.oracleHit).length;
      return [
        language,
        {
          opportunities: languageItems.length,
          oracleHits: languageHits,
          absoluteOracleRate: divide(languageHits, languageItems.length),
        },
      ];
    }),
  ) as AbsoluteOracleReport['byLanguage'];
  return {
    denominator: 'all-opportunities',
    opportunities: observations.length,
    completeOpportunities: complete.length,
    representableOpportunities: representable.length,
    oracleHits: hits.length,
    absoluteOracleRate: divide(hits.length, observations.length),
    completeOracleRate: divide(hits.length, complete.length),
    conditionalRepresentableRate: divide(hits.length, representable.length),
    byLanguage,
  };
}

export function finalizeArchitectureStop(
  value: Omit<V2SArchitectureStop, 'recordSha256'>,
): V2SArchitectureStop {
  validateArchitectureStopShape(value);
  return { ...value, recordSha256: canonicalSha256(value) };
}

export function validateArchitectureStop(value: V2SArchitectureStop): void {
  validateArchitectureStopShape(value);
  const { recordSha256, ...unsigned } = value;
  if (!SHA256_PATTERN.test(recordSha256) || canonicalSha256(unsigned) !== recordSha256) {
    throw new Error('Invalid V2S architecture stop record SHA-256.');
  }
}

function validateArchitectureStopShape(
  value: Omit<V2SArchitectureStop, 'recordSha256'> | V2SArchitectureStop,
): void {
  if (
    value.schema !== V2S_ARCHITECTURE_STOP_SCHEMA ||
    value.schemaVersion !== 1 ||
    value.engine !== V2S_ENGINE_ID ||
    value.status !== 'architecture-blocked' ||
    value.architectureId !== V2S_ENGINE_ID ||
    value.formalResult !== false ||
    value.releaseEvidence !== false ||
    value.stopLongTraining !== true ||
    !['development-oracle-ceiling', 'asset-budget', 'runtime-budget'].includes(value.reasonCode) ||
    !Number.isFinite(Date.parse(value.recordedAt)) ||
    !/^[0-9a-f]{40}$/u.test(value.sourceCommit) ||
    value.workingTreeClean !== false ||
    value.gates.oracleAt8AbsoluteMinimum !== 0.4 ||
    value.gates.oracleAt32AbsoluteMinimum !== 0.45 ||
    value.gates.perLanguageOracleAt8AbsoluteMinimum !== 0.32 ||
    !isValidArchitectureOracleSummary(value.oracle) ||
    value.frontierDerivation !== 'per-language-max-over-fixed-matrix' ||
    !isValidArchitectureOracleSummary(value.bestFixedMatrixFrontier) ||
    value.bestFixedMatrixFrontier.opportunities !== value.oracle.opportunities ||
    value.bestFixedMatrixFrontier.at8.hits < value.oracle.at8.hits ||
    value.bestFixedMatrixFrontier.at32.hits < value.oracle.at32.hits ||
    (value.reasonCode === 'development-oracle-ceiling' &&
      passesArchitectureOracleGates(value.bestFixedMatrixFrontier, value.gates)) ||
    typeof value.candidateId !== 'string' ||
    value.candidateId.length === 0 ||
    value.methodCorrection !== 'bpe-en+unigram-zh' ||
    Object.keys(value.evidenceBindings).length < 4 ||
    Object.values(value.evidenceBindings).some(
      (binding) =>
        typeof binding.path !== 'string' ||
        binding.path.length === 0 ||
        !SHA256_PATTERN.test(binding.sha256),
    ) ||
    value.lifecycle.gateTrainingStarted !== false ||
    value.lifecycle.finalHoldoutsRead !== false ||
    value.lifecycle.publicWritten !== false ||
    value.lifecycle.v21Unlocked !== false
  ) {
    throw new Error('Invalid V2S architecture stop evidence.');
  }
}

function isValidArchitectureOracleSummary(value: V2SArchitectureOracleSummary): boolean {
  if (
    value.denominator !== 'all-development-opportunities' ||
    !Number.isSafeInteger(value.opportunities) ||
    value.opportunities < 1 ||
    !Number.isSafeInteger(value.completeOpportunities) ||
    !Number.isSafeInteger(value.silenceOpportunities) ||
    value.completeOpportunities + value.silenceOpportunities !== value.opportunities
  ) {
    return false;
  }
  return [value.at8, value.at32].every((level) => {
    if (
      !Number.isSafeInteger(level.hits) ||
      level.hits < 0 ||
      level.hits > value.completeOpportunities ||
      level.absoluteRate !== level.hits / value.opportunities
    ) {
      return false;
    }
    const languageOpportunities =
      level.byLanguage.zh.opportunities + level.byLanguage.en.opportunities;
    const languageHits = level.byLanguage.zh.hits + level.byLanguage.en.hits;
    return (
      languageOpportunities === value.opportunities &&
      languageHits === level.hits &&
      (['zh', 'en'] as const).every((language) => {
        const item = level.byLanguage[language];
        return (
          Number.isSafeInteger(item.opportunities) &&
          item.opportunities > 0 &&
          Number.isSafeInteger(item.hits) &&
          item.hits >= 0 &&
          item.hits <= item.opportunities &&
          item.absoluteRate === item.hits / item.opportunities
        );
      })
    );
  });
}

function passesArchitectureOracleGates(
  oracle: V2SArchitectureOracleSummary,
  gates: V2SArchitectureStop['gates'],
): boolean {
  return (
    oracle.at8.absoluteRate >= gates.oracleAt8AbsoluteMinimum &&
    oracle.at32.absoluteRate >= gates.oracleAt32AbsoluteMinimum &&
    oracle.at8.byLanguage.zh.absoluteRate >= gates.perLanguageOracleAt8AbsoluteMinimum &&
    oracle.at8.byLanguage.en.absoluteRate >= gates.perLanguageOracleAt8AbsoluteMinimum
  );
}

export function validateMethodStop(value: V2SMethodStop): void {
  if (
    value.schema !== V2S_METHOD_STOP_SCHEMA ||
    value.status !== 'method-blocked' ||
    value.stopLongTraining !== true ||
    !Number.isSafeInteger(value.attempts) ||
    !Number.isSafeInteger(value.maximumAttempts) ||
    value.attempts < value.maximumAttempts ||
    !/^[0-9a-f]{64}$/u.test(value.evidenceSha256)
  ) {
    throw new Error('Invalid V2S method stop evidence.');
  }
}

function divide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}
