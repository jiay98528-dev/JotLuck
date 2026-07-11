/**
 * One-shot workspace final-v2 evidence finalizer.
 *
 * This command finalizes evidence after the one-shot runtime orchestrator has
 * claimed the frozen holdout and measured the exact selected candidate.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadAndValidateWorkspaceFinalV2 } from './workspace-final-holdout';
import { resolveWorkspaceInput, resolveWorkspaceOutput } from './workspace-paths';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CURVE =
  'scripts/corpus/_web-cache/autocomplete-candidates/learning-curve-v2/learning-curve-report.json';
const DEFAULT_RUNTIME =
  'scripts/corpus/_web-cache/autocomplete-candidates/workspace-final-runtime-evidence.json';
const CONSUMPTION_ROOT = 'scripts/corpus/_web-cache/autocomplete-candidates/final-v2-consumption';

interface CurveReport {
  schemaVersion: 2;
  learningCurveSha256: string;
  selectedTier: string | null;
  finalHoldoutConsumed: false;
  tiers: Array<{ id: string; modelSha256: string; candidateDirectory: string }>;
}

export interface FinalRuntimeEvidence {
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
    zh: { top1Rate: number; usableRate: number; v1Top1Rate: number; v1UsableRate: number };
    en: { top1Rate: number; usableRate: number; v1Top1Rate: number; v1UsableRate: number };
  };
}

export function claimFinalHoldoutConsumption(
  receiptPath: string,
  receipt: Record<string, unknown>,
): void {
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(receiptPath, 'wx');
    fs.writeFileSync(descriptor, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('Workspace final-v2 holdout version has already been consumed.');
    }
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function finalHoldoutConsumptionReceiptPath(
  repositoryRoot: string,
  finalHoldoutSha256: string,
): string {
  if (!/^[a-f0-9]{64}$/u.test(finalHoldoutSha256)) {
    throw new Error('Final holdout SHA-256 is invalid.');
  }
  // A frozen final dataset is consumed globally, not once per candidate. A
  // failed candidate therefore forces the next attempt onto a newly frozen
  // dataset version, exactly like a sealed test set.
  return resolveWorkspaceOutput(
    repositoryRoot,
    path.join(CONSUMPTION_ROOT, `${finalHoldoutSha256}.json`),
  );
}

export function assertFinalRuntimeEvidence(
  evidence: FinalRuntimeEvidence,
  modelSha256: string,
  finalHoldoutSha256: string,
): void {
  if (
    evidence.schemaVersion !== 1 ||
    evidence.classification !== 'workspace-final-v2-runtime-evidence' ||
    evidence.stage !== 'final' ||
    evidence.productionRouterObserved !== true ||
    evidence.modelSha256 !== modelSha256 ||
    evidence.finalHoldoutSha256 !== finalHoldoutSha256 ||
    evidence.opportunities !== 200 ||
    evidence.requestCount !== 200 ||
    !Number.isSafeInteger(evidence.visibleSampleCount) ||
    evidence.visibleSampleCount <= 0 ||
    evidence.visibleSampleCount > evidence.requestCount
  ) {
    throw new Error('Workspace final runtime evidence identity is invalid.');
  }
  const rates = [
    evidence.triggerRate,
    evidence.usableRate,
    evidence.falseTriggerRate,
    evidence.mixedCandidateRate,
    evidence.oracleAt8Rate,
    evidence.top1Rate,
  ];
  if (!rates.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new Error('Workspace final runtime evidence contains invalid rates.');
  }
  if (
    evidence.triggerRate < 0.35 ||
    evidence.triggerRate > 0.42 ||
    evidence.usableRate < 0.35 ||
    evidence.falseTriggerRate > 0.03 ||
    evidence.mixedCandidateRate !== 0 ||
    !Number.isFinite(evidence.allRequestP90Ms) ||
    evidence.allRequestP90Ms < 0 ||
    !Number.isFinite(evidence.visiblePredictionP90Ms) ||
    evidence.visiblePredictionP90Ms < 0 ||
    evidence.allRequestP90Ms > 140 ||
    evidence.visiblePredictionP90Ms > 140
  ) {
    throw new Error('Workspace final runtime evidence failed the absolute release gates.');
  }
  for (const language of ['zh', 'en'] as const) {
    const metrics = evidence.language[language];
    if (
      !metrics ||
      ![metrics.top1Rate, metrics.usableRate, metrics.v1Top1Rate, metrics.v1UsableRate].every(
        (value) => Number.isFinite(value) && value >= 0 && value <= 1,
      ) ||
      metrics.top1Rate + 0.02 < metrics.v1Top1Rate ||
      metrics.usableRate + 0.02 < metrics.v1UsableRate
    ) {
      throw new Error(`Workspace final ${language} quality regressed beyond 2pp from V1.`);
    }
  }
}

export function assertFinalHoldoutConsumptionReceipt(
  receiptPath: string,
  expected: {
    finalHoldoutSha256: string;
    modelSha256: string;
    validationCurveSha256: string;
  },
): void {
  if (!fs.existsSync(receiptPath)) {
    throw new Error('Workspace final-v2 must be claimed before runtime evaluation starts.');
  }
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')) as Record<string, unknown>;
  if (
    receipt.schemaVersion !== 1 ||
    receipt.classification !== 'workspace-final-v2-consumption-receipt' ||
    receipt.finalHoldoutSha256 !== expected.finalHoldoutSha256 ||
    receipt.modelSha256 !== expected.modelSha256 ||
    receipt.validationCurveSha256 !== expected.validationCurveSha256
  ) {
    throw new Error('Workspace final-v2 consumption receipt identity is invalid.');
  }
}

export async function runAutocompleteFinalEvaluation(
  argv: string[] = process.argv.slice(2),
): Promise<Record<string, unknown>> {
  const curvePath = readArg(argv, '--curve') ?? DEFAULT_CURVE;
  const runtimePath = readArg(argv, '--runtime-evidence') ?? DEFAULT_RUNTIME;
  const curve = readWorkspaceJson<CurveReport>(curvePath);
  if (curve.schemaVersion !== 2 || !curve.selectedTier || curve.finalHoldoutConsumed !== false) {
    throw new Error('No validation tier is eligible; workspace final-v2 was not consumed.');
  }
  const selected = curve.tiers.find((tier) => tier.id === curve.selectedTier);
  if (!selected) throw new Error('Selected validation tier is missing from the learning curve.');
  const { audit } = loadAndValidateWorkspaceFinalV2(REPOSITORY_ROOT);
  const runtime = readWorkspaceJson<FinalRuntimeEvidence>(runtimePath);
  if (runtime.modelSha256 !== selected.modelSha256) {
    throw new Error('Final runtime evidence belongs to a different candidate model.');
  }
  const receiptPath = finalHoldoutConsumptionReceiptPath(REPOSITORY_ROOT, audit.datasetSha256);
  assertFinalHoldoutConsumptionReceipt(receiptPath, {
    finalHoldoutSha256: audit.datasetSha256,
    modelSha256: selected.modelSha256,
    validationCurveSha256: curve.learningCurveSha256,
  });
  assertFinalRuntimeEvidence(runtime, selected.modelSha256, audit.datasetSha256);
  const evidence = {
    schemaVersion: 1,
    classification: 'workspace-final-v2-evidence',
    releaseEligible: true,
    finalHoldoutConsumed: true,
    modelSha256: selected.modelSha256,
    validationCurveSha256: curve.learningCurveSha256,
    finalHoldoutSha256: audit.datasetSha256,
    finalAudit: audit,
    runtime,
    runtimeEvidenceSha256: sha256(
      fs.readFileSync(resolveWorkspaceInput(REPOSITORY_ROOT, runtimePath)),
    ),
    consumptionReceiptSha256: sha256(fs.readFileSync(receiptPath)),
    v21Eligible:
      runtime.oracleAt8Rate - runtime.top1Rate >= 0.08 &&
      (['zh', 'en'] as const).every(
        (language) =>
          runtime.language[language].top1Rate + 0.02 >= runtime.language[language].v1Top1Rate &&
          runtime.language[language].usableRate + 0.02 >= runtime.language[language].v1UsableRate,
      ),
  };
  const outputPath = resolveWorkspaceOutput(
    REPOSITORY_ROOT,
    path.relative(REPOSITORY_ROOT, path.join(path.dirname(receiptPath), 'final-evidence.json')),
  );
  if (fs.existsSync(outputPath)) {
    throw new Error('Workspace final evidence already exists and cannot be overwritten.');
  }
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return evidence;
}

function readWorkspaceJson<T>(relativePath: string): T {
  const resolved = resolveWorkspaceInput(REPOSITORY_ROOT, relativePath);
  return JSON.parse(fs.readFileSync(resolved, 'utf8')) as T;
}

function readArg(argv: string[], name: string): string | undefined {
  const inline = argv.find((item) => item.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function sha256(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runAutocompleteFinalEvaluation()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
