import { createHash } from 'node:crypto';

export type V2FreeSha256 = string;

export const V2_FREE_ENGINE_ID = 'public-v2-free-decoder-v1';
export const V2_FREE_MATRIX = Object.freeze([
  Object.freeze({ id: '16m-q4', parameterCount: 16_000_000, quantization: 'q4' as const }),
  Object.freeze({ id: '24m-q4', parameterCount: 24_000_000, quantization: 'q4' as const }),
  Object.freeze({ id: '32m-q4', parameterCount: 32_000_000, quantization: 'q4' as const }),
  Object.freeze({ id: '16m-q8', parameterCount: 16_000_000, quantization: 'q8' as const }),
]);
export const V2_FREE_STATIC_LIMIT_BYTES = 24 * 1024 * 1024;
export const V2_FREE_PEAK_MEMORY_LIMIT_BYTES = 192 * 1024 * 1024;
export const V2_FREE_TRAINING_POOL_LIMIT_BYTES = 512 * 1024 * 1024;

export interface V2FreeOracleReport {
  schema: 'jotluck.autocomplete.v2-free-oracle.v1';
  engine: typeof V2_FREE_ENGINE_ID;
  candidateId: string;
  candidateArtifactSha256: V2FreeSha256;
  suite: 'cold' | 'workspace';
  holdoutSha256: V2FreeSha256;
  evaluatorTreeSha256: V2FreeSha256;
  observationsSha256: V2FreeSha256;
  evaluationManifestSha256: V2FreeSha256;
  checkpoints: number;
  at8: { hits: number; rate: number };
  at32: { hits: number; rate: number };
  byLanguage: Record<'zh' | 'en', { checkpoints: number; at8Hits: number; at8Rate: number }>;
  finalHoldoutsRead: false;
}

export interface V2FreeFinalReport {
  schema: 'jotluck.autocomplete.v2-free-final.v1';
  engine: typeof V2_FREE_ENGINE_ID;
  candidateId: string;
  candidateArtifactSha256: V2FreeSha256;
  suite: 'cold' | 'workspace';
  holdoutSha256: V2FreeSha256;
  baselineSha256: V2FreeSha256;
  evaluatorTreeSha256: V2FreeSha256;
  observationsSha256: V2FreeSha256;
  evaluationManifestSha256: V2FreeSha256;
  finalClaimSha256: V2FreeSha256;
  finalReceiptSha256: V2FreeSha256;
  checkpoints: 200;
  completeCheckpoints: 150;
  silenceCheckpoints: 50;
  triggerRate: number;
  absoluteUsableRate: number;
  byLanguage: Record<'zh' | 'en', { checkpoints: number; usableRate: number }>;
  byCategory: Record<string, { checkpoints: number; usableRate: number }>;
  silenceFalseTriggerRate: number;
  mixedVisibleCount: number;
  crossLineCount: number;
  overlongCount: number;
  structuredChecks: number;
  structuredCorrect: number;
  editChecks: number;
  editCorrect: number;
  requestP90Ms: number;
  visibleGhostP90Ms: number;
  mainThreadModelTasksOver50Ms: number;
  consumedOnce: true;
}

export interface V2FreeCandidateEvidence {
  candidateId: string;
  candidateArtifactSha256: V2FreeSha256;
  parameterCount: 16_000_000 | 24_000_000 | 32_000_000;
  quantization: 'q4' | 'q8';
  oracle: V2FreeOracleReport;
  coldFinal?: V2FreeFinalReport;
  workspaceFinal?: V2FreeFinalReport;
  windowsGuiImePassed?: boolean;
  windowsGuiEvidenceSha256?: string;
  staticBytes: number;
  peakMemoryBytes: number;
  modelInferenceP90Ms: number;
  licenseAuditPassed: boolean;
  licenseAuditSha256: V2FreeSha256;
  selectionSha256: V2FreeSha256;
  inputTreeSha256: V2FreeSha256;
  evaluatorTreeSha256: V2FreeSha256;
}

export interface V2FreeCandidateAssessment {
  candidateId: string;
  stage: 'architecture-stop' | 'candidate' | 'release-eligible';
  passed: boolean;
  failures: string[];
}

export interface V2FreeArtifactIdentity {
  candidateId: string;
  parameterCount: 16_000_000 | 24_000_000 | 32_000_000;
  quantization: 'q4' | 'q8';
  model: { sha256: V2FreeSha256; bytes: number };
  tokenizer: { sha256: V2FreeSha256; bytes: number };
}

export function computeV2FreeCandidateArtifactSha256(identity: V2FreeArtifactIdentity): string {
  if (
    !identity.candidateId ||
    !isSha256(identity.model.sha256) ||
    !isSha256(identity.tokenizer.sha256) ||
    !Number.isSafeInteger(identity.model.bytes) ||
    identity.model.bytes < 1 ||
    !Number.isSafeInteger(identity.tokenizer.bytes) ||
    identity.tokenizer.bytes < 1
  ) {
    throw new Error('V2 free candidate artifact identity is invalid.');
  }
  const canonical = JSON.stringify({
    candidateId: identity.candidateId,
    engine: V2_FREE_ENGINE_ID,
    model: { bytes: identity.model.bytes, sha256: identity.model.sha256 },
    parameterCount: identity.parameterCount,
    quantization: identity.quantization,
    tokenizer: { bytes: identity.tokenizer.bytes, sha256: identity.tokenizer.sha256 },
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function assessOraclePrecheck(report: V2FreeOracleReport): string[] {
  const failures: string[] = [];
  if (
    report.schema !== 'jotluck.autocomplete.v2-free-oracle.v1' ||
    report.engine !== V2_FREE_ENGINE_ID ||
    !report.candidateId ||
    !isSha256(report.candidateArtifactSha256) ||
    !Number.isSafeInteger(report.checkpoints) ||
    report.checkpoints !== 200 ||
    (report.suite !== 'cold' && report.suite !== 'workspace') ||
    !isSha256(report.holdoutSha256) ||
    !isSha256(report.evaluatorTreeSha256) ||
    !isSha256(report.observationsSha256) ||
    !isSha256(report.evaluationManifestSha256) ||
    report.finalHoldoutsRead !== false
  ) {
    failures.push('oracle-contract');
    return failures;
  }
  validateCountedRate(report.at8.hits, report.checkpoints, report.at8.rate, 'oracle-at8', failures);
  validateCountedRate(
    report.at32.hits,
    report.checkpoints,
    report.at32.rate,
    'oracle-at32',
    failures,
  );
  const languageTotal = report.byLanguage.zh.checkpoints + report.byLanguage.en.checkpoints;
  if (languageTotal !== report.checkpoints) failures.push('oracle-language-denominator');
  for (const language of ['zh', 'en'] as const) {
    const item = report.byLanguage[language];
    validateCountedRate(
      item.at8Hits,
      item.checkpoints,
      item.at8Rate,
      `oracle-${language}-at8`,
      failures,
    );
  }
  if (report.at8.rate < 0.45) failures.push('oracle-at8-minimum');
  if (report.at32.rate < 0.55) failures.push('oracle-at32-minimum');
  if (report.byLanguage.zh.at8Rate < 0.4) failures.push('oracle-zh-at8-minimum');
  if (report.byLanguage.en.at8Rate < 0.4) failures.push('oracle-en-at8-minimum');
  return failures;
}

export function assessFinalReport(report: V2FreeFinalReport): string[] {
  const failures: string[] = [];
  if (
    report.schema !== 'jotluck.autocomplete.v2-free-final.v1' ||
    report.engine !== V2_FREE_ENGINE_ID ||
    !report.candidateId ||
    !isSha256(report.candidateArtifactSha256) ||
    (report.suite !== 'cold' && report.suite !== 'workspace') ||
    !isSha256(report.holdoutSha256) ||
    !isSha256(report.baselineSha256) ||
    !isSha256(report.evaluatorTreeSha256) ||
    !isSha256(report.observationsSha256) ||
    !isSha256(report.evaluationManifestSha256) ||
    !isSha256(report.finalClaimSha256) ||
    !isSha256(report.finalReceiptSha256) ||
    report.checkpoints !== 200 ||
    report.completeCheckpoints !== 150 ||
    report.silenceCheckpoints !== 50 ||
    report.consumedOnce !== true
  ) {
    failures.push(`${report.suite}-contract`);
    return failures;
  }
  if (report.triggerRate < 0.35 || report.triggerRate > 0.42) {
    failures.push(`${report.suite}-trigger-rate`);
  }
  if (report.absoluteUsableRate < 0.35) failures.push(`${report.suite}-usable-rate`);
  const languageTotal = report.byLanguage.zh.checkpoints + report.byLanguage.en.checkpoints;
  if (languageTotal !== 200 || report.byLanguage.zh.checkpoints !== 100) {
    failures.push(`${report.suite}-language-balance`);
  }
  for (const language of ['zh', 'en'] as const) {
    if (report.byLanguage[language].usableRate < 0.32) {
      failures.push(`${report.suite}-${language}-usable-rate`);
    }
  }
  if (Object.keys(report.byCategory).length === 0) failures.push(`${report.suite}-categories`);
  for (const [category, value] of Object.entries(report.byCategory)) {
    if (value.checkpoints < 1 || value.usableRate < 0.3) {
      failures.push(`${report.suite}-category-${category}`);
    }
  }
  if (report.silenceFalseTriggerRate > 0.03) failures.push(`${report.suite}-false-trigger`);
  if (report.mixedVisibleCount !== 0) failures.push(`${report.suite}-mixed`);
  if (report.crossLineCount !== 0) failures.push(`${report.suite}-cross-line`);
  if (report.overlongCount !== 0) failures.push(`${report.suite}-overlong`);
  if (
    report.structuredChecks < 1 ||
    report.structuredCorrect !== report.structuredChecks ||
    report.editChecks < 1 ||
    report.editCorrect !== report.editChecks
  ) {
    failures.push(`${report.suite}-structured-edit-correctness`);
  }
  if (report.requestP90Ms > 140) failures.push(`${report.suite}-request-p90`);
  if (report.visibleGhostP90Ms > 140) failures.push(`${report.suite}-visible-p90`);
  if (report.mainThreadModelTasksOver50Ms !== 0) failures.push(`${report.suite}-main-thread`);
  return failures;
}

export function assessV2FreeCandidate(
  evidence: V2FreeCandidateEvidence,
): V2FreeCandidateAssessment {
  const matrixEntry = V2_FREE_MATRIX.some(
    (entry) =>
      entry.parameterCount === evidence.parameterCount &&
      entry.quantization === evidence.quantization,
  );
  const oracleFailures = assessOraclePrecheck(evidence.oracle);
  if (!matrixEntry) oracleFailures.unshift('matrix');
  if (evidence.oracle.candidateId !== evidence.candidateId) {
    oracleFailures.unshift('candidate-identity');
  }
  if (
    !isSha256(evidence.candidateArtifactSha256) ||
    evidence.oracle.candidateArtifactSha256 !== evidence.candidateArtifactSha256
  ) {
    oracleFailures.unshift('candidate-artifact-identity');
  }
  if (oracleFailures.length > 0) {
    if (evidence.coldFinal || evidence.workspaceFinal) {
      oracleFailures.push('final-consumed-before-oracle');
    }
    return {
      candidateId: evidence.candidateId,
      stage: 'architecture-stop',
      passed: false,
      failures: oracleFailures,
    };
  }

  const failures: string[] = [];
  if (
    !evidence.licenseAuditPassed ||
    !isSha256(evidence.licenseAuditSha256) ||
    !isSha256(evidence.selectionSha256) ||
    !isSha256(evidence.inputTreeSha256)
  ) {
    failures.push('license');
  }
  if (
    !isSha256(evidence.evaluatorTreeSha256) ||
    evidence.oracle.evaluatorTreeSha256 !== evidence.evaluatorTreeSha256
  ) {
    failures.push('evaluator-identity');
  }
  if (evidence.staticBytes > V2_FREE_STATIC_LIMIT_BYTES) failures.push('static-budget');
  if (evidence.peakMemoryBytes > V2_FREE_PEAK_MEMORY_LIMIT_BYTES) failures.push('memory-budget');
  if (evidence.modelInferenceP90Ms > 80) failures.push('model-p90');
  if (!evidence.coldFinal || !evidence.workspaceFinal) failures.push('dual-final-missing');
  if (evidence.coldFinal) failures.push(...assessFinalReport(evidence.coldFinal));
  if (evidence.workspaceFinal) failures.push(...assessFinalReport(evidence.workspaceFinal));
  if (
    evidence.coldFinal?.candidateId !== evidence.candidateId ||
    evidence.workspaceFinal?.candidateId !== evidence.candidateId
  ) {
    failures.push('final-candidate-identity');
  }
  if (
    evidence.coldFinal?.candidateArtifactSha256 !== evidence.candidateArtifactSha256 ||
    evidence.workspaceFinal?.candidateArtifactSha256 !== evidence.candidateArtifactSha256
  ) {
    failures.push('final-candidate-artifact-identity');
  }
  if (
    evidence.coldFinal?.evaluatorTreeSha256 !== evidence.evaluatorTreeSha256 ||
    evidence.workspaceFinal?.evaluatorTreeSha256 !== evidence.evaluatorTreeSha256
  ) {
    failures.push('final-evaluator-identity');
  }
  if (
    evidence.coldFinal?.finalClaimSha256 !== evidence.workspaceFinal?.finalClaimSha256 ||
    evidence.coldFinal?.finalReceiptSha256 !== evidence.workspaceFinal?.finalReceiptSha256
  ) {
    failures.push('final-pair-consumption-identity');
  }
  if (evidence.windowsGuiImePassed !== true) failures.push('windows-gui-ime');
  if (!isSha256(evidence.windowsGuiEvidenceSha256 ?? '')) {
    failures.push('windows-gui-evidence-identity');
  }
  return {
    candidateId: evidence.candidateId,
    stage: failures.length === 0 ? 'release-eligible' : 'candidate',
    passed: failures.length === 0,
    failures: [...new Set(failures)],
  };
}

export function selectSmallestPassingV2FreeCandidate(
  candidates: readonly V2FreeCandidateEvidence[],
): V2FreeCandidateEvidence {
  const eligible = candidates.filter((candidate) => assessV2FreeCandidate(candidate).passed);
  if (eligible.length === 0) throw new Error('No V2 free candidate passes every release gate.');
  return [...eligible].sort(
    (left, right) =>
      left.staticBytes - right.staticBytes ||
      left.parameterCount - right.parameterCount ||
      left.quantization.localeCompare(right.quantization) ||
      left.candidateId.localeCompare(right.candidateId),
  )[0]!;
}

function validateCountedRate(
  hits: number,
  denominator: number,
  rate: number,
  label: string,
  failures: string[],
): void {
  if (
    !Number.isSafeInteger(hits) ||
    !Number.isSafeInteger(denominator) ||
    denominator < 1 ||
    hits < 0 ||
    hits > denominator ||
    rate !== hits / denominator
  ) {
    failures.push(`${label}-denominator`);
  }
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}
