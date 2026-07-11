/**
 * One-shot production-Router evaluation for the frozen workspace final-v2.
 *
 * Governance and candidate integrity are checked before the holdout is
 * claimed. The receipt is then written before Playwright sees any target, so
 * a failed or interrupted evaluation still consumes the entire holdout
 * version for every future candidate.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertFinalRuntimeEvidence,
  assertFinalHoldoutConsumptionReceipt,
  claimFinalHoldoutConsumption,
  finalHoldoutConsumptionReceiptPath,
  runAutocompleteFinalEvaluation,
  type FinalRuntimeEvidence,
} from './run-autocomplete-final-evaluation';
import { installRuntimeCandidate } from './run-autocomplete-runtime-candidates';
import { loadAndValidateWorkspaceFinalV2 } from './workspace-final-holdout';
import { resolveWorkspaceInput, resolveWorkspaceOutput } from './workspace-paths';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CURVE =
  'scripts/corpus/_web-cache/autocomplete-candidates/learning-curve-v2/learning-curve-report.json';
const DEFAULT_RUNTIME =
  'scripts/corpus/_web-cache/autocomplete-candidates/workspace-final-runtime-evidence.json';

interface SelectedCurve {
  schemaVersion: 2;
  learningCurveSha256: string;
  selectedTier: string | null;
  releaseEligible: false;
  finalHoldoutConsumed: false;
  tiers: Array<{
    id: string;
    modelSha256: string;
    modelBytes: number;
    candidateDirectory: string;
    eligible: boolean;
  }>;
}

export async function runAutocompleteWorkspaceFinalRuntime(
  argv: string[] = process.argv.slice(2),
): Promise<Record<string, unknown>> {
  const curvePath = readArg(argv, '--curve') ?? DEFAULT_CURVE;
  const runtimePath = readArg(argv, '--runtime-evidence') ?? DEFAULT_RUNTIME;
  const claimOnly = argv.includes('--claim-only');
  const resumeClaimed = argv.includes('--resume-claimed');
  if (claimOnly && resumeClaimed)
    throw new Error('Choose either --claim-only or --resume-claimed.');
  const curve = readWorkspaceJson<SelectedCurve>(curvePath);
  if (
    curve.schemaVersion !== 2 ||
    curve.releaseEligible !== false ||
    curve.finalHoldoutConsumed !== false ||
    !curve.selectedTier
  ) {
    throw new Error('No validation tier is eligible; workspace final-v2 was not started.');
  }
  const selected = curve.tiers.find(
    (tier) => tier.id === curve.selectedTier && tier.eligible === true,
  );
  if (!selected) throw new Error('Selected validation tier is missing or ineligible.');

  // This includes template/long-fragment governance. Invalid final data must
  // fail before a receipt or runtime artifact is created.
  const { audit } = loadAndValidateWorkspaceFinalV2(REPOSITORY_ROOT);
  const runtimeFile = resolveWorkspaceOutput(REPOSITORY_ROOT, runtimePath);
  if (fs.existsSync(runtimeFile)) {
    throw new Error('Workspace final runtime evidence already exists and cannot be overwritten.');
  }

  const receiptPath = finalHoldoutConsumptionReceiptPath(REPOSITORY_ROOT, audit.datasetSha256);
  const receiptIdentity = {
    finalHoldoutSha256: audit.datasetSha256,
    modelSha256: selected.modelSha256,
    validationCurveSha256: curve.learningCurveSha256,
  };
  if (resumeClaimed) {
    assertFinalHoldoutConsumptionReceipt(receiptPath, receiptIdentity);
  } else {
    claimFinalHoldoutConsumption(receiptPath, {
      schemaVersion: 1,
      classification: 'workspace-final-v2-consumption-receipt',
      ...receiptIdentity,
      claimedAt: '2026-07-11T00:00:00.000Z',
    });
  }
  if (claimOnly) {
    return {
      schemaVersion: 1,
      classification: 'workspace-final-v2-claim',
      receiptPath: path.relative(REPOSITORY_ROOT, receiptPath).replace(/\\/gu, '/'),
      ...receiptIdentity,
    };
  }

  const restore = installRuntimeCandidate(REPOSITORY_ROOT, selected);
  try {
    const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    const result = spawnSync(
      executable,
      [
        '--filter',
        '@jotluck/app',
        'exec',
        'playwright',
        'test',
        '26-autocomplete-workspace-final-runtime.spec.ts',
        '--project=chromium',
        '--workers=1',
      ],
      {
        cwd: REPOSITORY_ROOT,
        env: {
          ...process.env,
          JOTLUCK_AUTOCOMPLETE_RC: '1',
          JOTLUCK_AUTOCOMPLETE_RUNTIME_TIER: selected.id,
          JOTLUCK_AUTOCOMPLETE_EXPECTED_MODEL_SHA: selected.modelSha256,
          JOTLUCK_AUTOCOMPLETE_FINAL_RUNTIME_EVIDENCE: runtimeFile,
        },
        stdio: 'inherit',
      },
    );
    if (result.status !== 0) {
      throw new Error(
        `Workspace final runtime evaluation failed; holdout ${audit.datasetSha256} is consumed.`,
      );
    }
  } finally {
    restore();
  }

  const runtime = readWorkspaceJson<FinalRuntimeEvidence>(runtimePath);
  assertFinalRuntimeEvidence(runtime, selected.modelSha256, audit.datasetSha256);
  return runAutocompleteFinalEvaluation([
    `--curve=${curvePath}`,
    `--runtime-evidence=${runtimePath}`,
  ]);
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runAutocompleteWorkspaceFinalRuntime()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
