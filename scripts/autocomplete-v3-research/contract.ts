export const V3_RESEARCH_ENGINE_ID = 'public-v3-paid-research-v1';
export const V3_RESEARCH_MATRIX = Object.freeze(
  [48_000_000, 64_000_000, 80_000_000].flatMap((parameterCount) =>
    (['q4', 'q8'] as const).flatMap((quantization) =>
      (
        [
          ['c1', 256],
          ['c2', 512],
          ['c3', 1_024],
        ] as const
      ).map(([contextProfile, contextTokens]) =>
        Object.freeze({
          id: `${parameterCount / 1_000_000}m-${quantization}-${contextProfile}`,
          parameterCount,
          quantization,
          contextProfile,
          contextTokens,
        }),
      ),
    ),
  ),
);

export interface V3BaselineBinding {
  engine: 'public-v2-free-decoder-v1';
  candidateId: string;
  modelSha256: string;
  coldFinalSha256: string;
  workspaceFinalSha256: string;
  coldPassed: true;
  workspacePassed: true;
}

export interface V3ResearchReport {
  schema: 'jotluck.autocomplete.v3-paid-value-research.v1';
  engine: typeof V3_RESEARCH_ENGINE_ID;
  candidateId: string;
  parameterCount: 48_000_000 | 64_000_000 | 80_000_000;
  quantization: 'q4' | 'q8';
  contextProfile: 'c1' | 'c2' | 'c3';
  contextTokens: 256 | 512 | 1_024;
  baseline: V3BaselineBinding;
  cold: { v2UsableRate: number; v3UsableRate: number };
  workspace: { v2UsableRate: number; v3UsableRate: number };
  falseTriggerRate: number;
  mixedVisibleCount: number;
  structuredRegressionCount: number;
  strongLocalRegressionCount: number;
  visibleP90Ms: number;
  incrementalMemoryBytes: number;
  modelAndHostBytes: number;
  dogfood: {
    tasks: 60;
    v2RetainedCharactersPerOpportunity: number;
    v3RetainedCharactersPerOpportunity: number;
    v2PostAcceptUndoRate: number;
    v3PostAcceptUndoRate: number;
  };
  researchOnly: true;
  productizationImplemented: false;
}

export interface V3ResearchAssessment {
  candidateId: string;
  passed: boolean;
  failures: string[];
  nextStep: 'stop' | 'separate-productization-plan';
}

export function assessV3PaidValue(report: V3ResearchReport): V3ResearchAssessment {
  const failures: string[] = [];
  const matrixEntry = V3_RESEARCH_MATRIX.find((entry) => entry.id === report.candidateId);
  if (
    report.schema !== 'jotluck.autocomplete.v3-paid-value-research.v1' ||
    report.engine !== V3_RESEARCH_ENGINE_ID ||
    !matrixEntry ||
    matrixEntry.parameterCount !== report.parameterCount ||
    matrixEntry.quantization !== report.quantization ||
    matrixEntry.contextProfile !== report.contextProfile ||
    matrixEntry.contextTokens !== report.contextTokens ||
    report.researchOnly !== true ||
    report.productizationImplemented !== false
  ) {
    failures.push('research-contract');
  }
  if (
    report.baseline.engine !== 'public-v2-free-decoder-v1' ||
    !report.baseline.candidateId ||
    !isSha256(report.baseline.modelSha256) ||
    !isSha256(report.baseline.coldFinalSha256) ||
    !isSha256(report.baseline.workspaceFinalSha256) ||
    report.baseline.coldPassed !== true ||
    report.baseline.workspacePassed !== true
  ) {
    failures.push('v2-prerequisite');
  }
  if (report.cold.v3UsableRate - report.cold.v2UsableRate < 0.08) {
    failures.push('cold-value-lift');
  }
  if (report.workspace.v3UsableRate - report.workspace.v2UsableRate < 0.08) {
    failures.push('workspace-value-lift');
  }
  if (report.falseTriggerRate > 0.03) failures.push('false-trigger');
  if (report.mixedVisibleCount !== 0) failures.push('mixed');
  if (report.structuredRegressionCount !== 0) failures.push('structured-regression');
  if (report.strongLocalRegressionCount !== 0) failures.push('strong-local-regression');
  if (report.visibleP90Ms > 140) failures.push('visible-p90');
  if (report.incrementalMemoryBytes > 256 * 1024 * 1024) failures.push('memory-budget');
  if (report.modelAndHostBytes > 96 * 1024 * 1024) failures.push('asset-budget');
  if (report.dogfood.tasks !== 60) failures.push('dogfood-task-count');
  const retainedLift = divide(
    report.dogfood.v3RetainedCharactersPerOpportunity -
      report.dogfood.v2RetainedCharactersPerOpportunity,
    report.dogfood.v2RetainedCharactersPerOpportunity,
  );
  if (retainedLift < 0.15) failures.push('dogfood-retained-character-lift');
  if (report.dogfood.v3PostAcceptUndoRate > report.dogfood.v2PostAcceptUndoRate) {
    failures.push('dogfood-undo-regression');
  }
  const uniqueFailures = [...new Set(failures)];
  return {
    candidateId: report.candidateId,
    passed: uniqueFailures.length === 0,
    failures: uniqueFailures,
    nextStep: uniqueFailures.length === 0 ? 'separate-productization-plan' : 'stop',
  };
}

function divide(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return Number.NEGATIVE_INFINITY;
  }
  return numerator / denominator;
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}
