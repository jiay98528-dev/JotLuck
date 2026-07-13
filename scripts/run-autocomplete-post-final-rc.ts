/**
 * Final Windows RC sequence for a selected autocomplete candidate:
 * install candidate -> build Tauri -> real WebView smoke -> restore public
 * fail-closed bytes -> atomically publish the one canonical public profile.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { publishAutocompleteFinal } from './publish-autocomplete-final';
import { installRuntimeCandidate } from './run-autocomplete-runtime-candidates';
import { resolveWorkspaceInput, resolveWorkspaceOutput } from './workspace-paths';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CURVE =
  'scripts/corpus/_web-cache/autocomplete-candidates/learning-curve-v2/learning-curve-report.json';
const DEFAULT_FINAL =
  'scripts/corpus/_web-cache/autocomplete-candidates/final-v2-consumption/final-evidence.json';
const DEFAULT_SMOKE = 'scripts/corpus/_web-cache/autocomplete-candidates/tauri-webview-smoke.json';

interface PostFinalCurve {
  schemaVersion: 2;
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

interface PostFinalEvidence {
  classification: 'workspace-final-v2-evidence';
  releaseEligible: true;
  finalHoldoutConsumed: true;
  modelSha256: string;
}

export function selectPostFinalCandidate(
  curve: PostFinalCurve,
  finalEvidence: PostFinalEvidence,
): PostFinalCurve['tiers'][number] {
  if (
    curve.schemaVersion !== 2 ||
    curve.releaseEligible !== false ||
    curve.finalHoldoutConsumed !== false ||
    !curve.selectedTier
  ) {
    throw new Error('No validation tier is eligible; post-final RC was not started.');
  }
  const selected = curve.tiers.find(
    (tier) => tier.id === curve.selectedTier && tier.eligible === true,
  );
  if (!selected) throw new Error('Selected validation tier is missing or ineligible.');
  if (
    finalEvidence.classification !== 'workspace-final-v2-evidence' ||
    finalEvidence.releaseEligible !== true ||
    finalEvidence.finalHoldoutConsumed !== true ||
    finalEvidence.modelSha256 !== selected.modelSha256
  ) {
    throw new Error('Final evidence is absent or belongs to a different candidate.');
  }
  return selected;
}

export function runAutocompletePostFinalRc(
  argv: string[] = process.argv.slice(2),
): ReturnType<typeof publishAutocompleteFinal> {
  if (process.platform !== 'win32') {
    throw new Error('The real Tauri WebView RC sequence must run on Windows.');
  }
  const curvePath = readArg(argv, '--curve') ?? DEFAULT_CURVE;
  const finalPath = readArg(argv, '--final-evidence') ?? DEFAULT_FINAL;
  const smokePath = readArg(argv, '--webview-smoke') ?? DEFAULT_SMOKE;
  const curve = readWorkspaceJson<PostFinalCurve>(curvePath);
  // selected:null must stop before final/smoke paths are opened or created.
  if (!curve.selectedTier) {
    throw new Error('No validation tier is eligible; post-final RC was not started.');
  }
  const finalEvidence = readWorkspaceJson<PostFinalEvidence>(finalPath);
  const selected = selectPostFinalCandidate(curve, finalEvidence);
  const smokeFile = resolveWorkspaceOutput(REPOSITORY_ROOT, smokePath);
  if (fs.existsSync(smokeFile)) {
    throw new Error('Tauri WebView smoke evidence already exists and cannot be overwritten.');
  }

  const restore = installRuntimeCandidate(REPOSITORY_ROOT, selected, {
    releaseCandidate: true,
  });
  try {
    runChecked('pnpm', ['--filter', '@jotluck/app', 'tauri:build'], {
      JOTLUCK_AUTOCOMPLETE_EXPECTED_MODEL_SHA: selected.modelSha256,
    });
    runChecked('pnpm', ['test:tauri:webview-smoke'], {
      JOTLUCK_AUTOCOMPLETE_EXPECTED_MODEL_SHA: selected.modelSha256,
      JOTLUCK_TAURI_WEBVIEW_EVIDENCE: smokeFile,
    });
  } finally {
    // Publisher validation and its transaction always start from the original
    // checked-in fail-closed state, never from the temporary smoke overlay.
    restore();
  }

  const smoke = readWorkspaceJson<Record<string, unknown>>(smokePath);
  if (
    smoke.classification !== 'tauri-webview-offline-smoke' ||
    smoke.status !== 'pass' ||
    smoke.modelSha256 !== selected.modelSha256 ||
    !Number.isFinite(Date.parse(String(smoke.completedAt ?? '')))
  ) {
    throw new Error('Real Tauri WebView smoke did not bind the selected candidate.');
  }
  return publishAutocompleteFinal({
    rootDir: REPOSITORY_ROOT,
    curvePath,
    finalEvidencePath: finalPath,
    webviewSmokePath: smokePath,
  });
}

function runChecked(command: string, args: string[], extraEnv: Record<string, string>): void {
  const executable = process.platform === 'win32' ? `${command}.cmd` : command;
  const result = spawnSync(executable, args, {
    cwd: REPOSITORY_ROOT,
    env: { ...process.env, ...extraEnv, JOTLUCK_AUTOCOMPLETE_RC: '1' },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(
      `RC command failed (${result.status ?? 'signal'}): ${command} ${args.join(' ')}`,
    );
  }
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
  try {
    console.log(JSON.stringify(runAutocompletePostFinalRc(), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
