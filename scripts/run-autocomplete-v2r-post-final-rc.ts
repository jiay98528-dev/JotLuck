/**
 * Final V2R Windows sequence. It packages the already frozen evaluation-only
 * bundle in Tauri, executes ONNX inference in a real WebView2, and only then
 * invokes the fail-closed atomic publisher. No public asset is overlaid for
 * the smoke run.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildAutocompleteV2REvaluationBundle } from './build-autocomplete-v2r-evaluation-bundle';
import {
  publishAutocompleteV2RFinal,
  type PublishAutocompleteV2RFinalOptions,
} from './publish-autocomplete-v2r-final';
import { V2R_REPOSITORY_ROOT } from './autocomplete-v2r/index';
import { resolveWorkspaceInput, resolveWorkspaceOutput } from './workspace-paths';

type HoldoutName = 'coldValidation' | 'workspaceValidation' | 'coldFinal' | 'workspaceFinal';
type AssetRole = 'model' | 'phrase-bank' | 'metadata' | 'runtime';

export interface RunAutocompleteV2RPostFinalOptions extends Omit<
  PublishAutocompleteV2RFinalOptions,
  'rootDir'
> {
  rootDir?: string;
  distDir?: string;
  tauriBinary?: string;
}

export interface EvaluationManifest {
  schema: string;
  schemaVersion: number;
  engine: string;
  profile: string;
  candidateId: string;
  evaluationOnly: boolean;
  runtimeEligible: boolean;
  qualityGatePassed: boolean;
  releaseEligible: boolean;
  assets: Array<{ role: AssetRole; sha256: string }>;
}

export interface V2RWebviewSmoke {
  schema: string;
  schemaVersion: number;
  status: string;
  candidateId: string;
  modelSha256: string;
  phraseBankSha256: string;
  metadataSha256: string;
  runtimeSha256: string;
  tauriWebviewExecuted: boolean;
  offlineReloadPassed: boolean;
  workerInferencePassed: boolean;
  webBuildSubstitute: boolean;
  completedAt: string;
}

export async function runAutocompleteV2RPostFinalRc(
  options: RunAutocompleteV2RPostFinalOptions,
): Promise<ReturnType<typeof publishAutocompleteV2RFinal>> {
  if (process.platform !== 'win32') {
    throw new Error('The real V2R Tauri WebView RC sequence must run on Windows.');
  }
  const rootDir = fs.realpathSync(path.resolve(options.rootDir ?? V2R_REPOSITORY_ROOT));
  const smokePath = resolveWorkspaceOutput(rootDir, options.webviewSmokePath);
  if (fs.existsSync(smokePath)) {
    throw new Error('V2R Tauri WebView smoke evidence already exists and cannot be overwritten.');
  }
  assertAggregatedEvidenceReady(rootDir, options.evidenceBundleDir);

  const manifestPath = await buildAutocompleteV2REvaluationBundle({
    workspaceRoot: rootDir,
    candidateDir: options.candidateDir,
    ...(options.distDir ? { distDir: options.distDir } : {}),
  });
  const manifest = readEvaluationManifest(manifestPath);
  const assetSha256 = evaluationAssetSha256(manifest);

  runChecked(
    rootDir,
    'pnpm',
    [
      '--filter',
      '@jotluck/app',
      'exec',
      'cargo',
      'tauri',
      'build',
      '--no-bundle',
      '--ci',
      '--config',
      JSON.stringify({ build: { beforeBuildCommand: '' } }),
    ],
    {},
  );
  runChecked(rootDir, 'pnpm', ['test:tauri:webview-smoke'], {
    JOTLUCK_AUTOCOMPLETE_V2R_RC: '1',
    JOTLUCK_AUTOCOMPLETE_RC: '0',
    JOTLUCK_AUTOCOMPLETE_EXPECTED_MODEL_SHA: assetSha256.model,
    JOTLUCK_AUTOCOMPLETE_EXPECTED_PHRASE_BANK_SHA: assetSha256.phraseBank,
    JOTLUCK_AUTOCOMPLETE_EXPECTED_METADATA_SHA: assetSha256.metadata,
    JOTLUCK_AUTOCOMPLETE_EXPECTED_RUNTIME_SHA: assetSha256.runtime,
    JOTLUCK_TAURI_WEBVIEW_EVIDENCE: smokePath,
    ...(options.tauriBinary
      ? { JOTLUCK_TAURI_BINARY: resolveWorkspaceInput(rootDir, options.tauriBinary) }
      : {}),
  });

  assertV2RWebviewSmoke(readJson<V2RWebviewSmoke>(smokePath), manifest, assetSha256);
  return publishAutocompleteV2RFinal({
    rootDir,
    candidateDir: options.candidateDir,
    evidenceBundleDir: options.evidenceBundleDir,
    evaluatorTreePath: options.evaluatorTreePath,
    webviewSmokePath: options.webviewSmokePath,
    holdoutPaths: options.holdoutPaths,
  });
}

export function assertV2RWebviewSmoke(
  smoke: V2RWebviewSmoke,
  manifest: EvaluationManifest,
  expected: Record<'model' | 'phraseBank' | 'metadata' | 'runtime', string>,
): void {
  if (
    smoke.schema !== 'jotluck.autocomplete.v2r-webview-smoke.v1' ||
    smoke.schemaVersion !== 1 ||
    smoke.status !== 'pass' ||
    smoke.candidateId !== manifest.candidateId ||
    smoke.modelSha256 !== expected.model ||
    smoke.phraseBankSha256 !== expected.phraseBank ||
    smoke.metadataSha256 !== expected.metadata ||
    smoke.runtimeSha256 !== expected.runtime ||
    smoke.tauriWebviewExecuted !== true ||
    smoke.offlineReloadPassed !== true ||
    smoke.workerInferencePassed !== true ||
    smoke.webBuildSubstitute !== false ||
    !isCanonicalTimestamp(smoke.completedAt)
  ) {
    throw new Error('Real V2R Tauri WebView smoke did not bind the frozen candidate.');
  }
}

function readEvaluationManifest(manifestPath: string): EvaluationManifest {
  const manifest = readJson<EvaluationManifest>(manifestPath);
  if (
    manifest.schema !== 'jotluck.autocomplete.public-model.v5' ||
    manifest.schemaVersion !== 5 ||
    manifest.engine !== 'public-phrase-transformer-v1' ||
    manifest.profile !== 'web-local' ||
    manifest.evaluationOnly !== true ||
    manifest.runtimeEligible !== true ||
    manifest.qualityGatePassed !== false ||
    manifest.releaseEligible !== false ||
    !/^[A-Za-z0-9._-]{3,160}$/u.test(manifest.candidateId) ||
    !Array.isArray(manifest.assets)
  ) {
    throw new Error('V2R evaluation bundle manifest is not a frozen evaluation candidate.');
  }
  return manifest;
}

function evaluationAssetSha256(
  manifest: EvaluationManifest,
): Record<'model' | 'phraseBank' | 'metadata' | 'runtime', string> {
  const values = new Map(manifest.assets.map((binding) => [binding.role, binding.sha256]));
  const required = (role: AssetRole): string => {
    const value = values.get(role);
    if (!value || !/^[a-f0-9]{64}$/u.test(value)) {
      throw new Error(`V2R evaluation manifest is missing the ${role} SHA-256.`);
    }
    return value;
  };
  return {
    model: required('model'),
    phraseBank: required('phrase-bank'),
    metadata: required('metadata'),
    runtime: required('runtime'),
  };
}

function assertAggregatedEvidenceReady(rootDir: string, relativeDirectory: string): void {
  const directory = resolveWorkspaceInput(rootDir, relativeDirectory);
  const quality = readJson<Record<string, unknown>>(path.join(directory, 'quality-report.json'));
  const runtime = readJson<Record<string, unknown>>(path.join(directory, 'runtime-report.json'));
  const receipt = readJson<Record<string, unknown>>(
    path.join(directory, 'final-consumption-receipt.json'),
  );
  assertV2RPostFinalEvidenceReady(quality, runtime, receipt);
}

export function assertV2RPostFinalEvidenceReady(
  quality: Record<string, unknown>,
  runtime: Record<string, unknown>,
  receipt: Record<string, unknown>,
): void {
  if (
    quality.schema !== 'jotluck.autocomplete.v2r-quality-report.v1' ||
    quality.releaseEligible !== true ||
    runtime.schema !== 'jotluck.autocomplete.v2r-runtime-report.v1' ||
    runtime.workerOnly !== true ||
    runtime.mainThreadModelLongTasksOver50Ms !== 0 ||
    receipt.schema !== 'jotluck.autocomplete.v2r-final-consumption.v1' ||
    receipt.status !== 'passed' ||
    receipt.consumedOnce !== true
  ) {
    throw new Error('V2R final evidence is absent or ineligible; Tauri smoke was not started.');
  }
}

function runChecked(
  rootDir: string,
  command: string,
  args: readonly string[],
  extraEnv: NodeJS.ProcessEnv,
): void {
  const executable = process.platform === 'win32' ? `${command}.cmd` : command;
  const result = spawnSync(executable, args, {
    cwd: rootDir,
    env: { ...process.env, ...extraEnv },
    windowsHide: true,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(
      `V2R RC command failed (${result.status ?? 'signal'}): ${command} ${args.join(' ')}`,
    );
  }
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function isCanonicalTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function readArgument(argv: readonly string[], name: string): string | undefined {
  const inline = argv.find((item) => item.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function parseArguments(argv: readonly string[]): RunAutocompleteV2RPostFinalOptions {
  const required = (name: string): string => {
    const value = readArgument(argv, name);
    if (!value) throw new Error(`${name} is required.`);
    return value;
  };
  const holdoutPaths = {
    coldValidation: required('--cold-validation-holdout'),
    workspaceValidation: required('--workspace-validation-holdout'),
    coldFinal: required('--cold-final-holdout'),
    workspaceFinal: required('--workspace-final-holdout'),
  } satisfies Record<HoldoutName, string>;
  return {
    rootDir: readArgument(argv, '--root-dir'),
    candidateDir: required('--candidate-dir'),
    evidenceBundleDir: required('--evidence-bundle-dir'),
    evaluatorTreePath: required('--evaluator-tree'),
    webviewSmokePath: required('--webview-smoke'),
    holdoutPaths,
    distDir: readArgument(argv, '--dist-dir'),
    tauriBinary: readArgument(argv, '--tauri-binary'),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runAutocompleteV2RPostFinalRc(parseArguments(process.argv.slice(2)))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    });
}
