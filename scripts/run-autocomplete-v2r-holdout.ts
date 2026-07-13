/** Runs one frozen V2R holdout against the exact evaluation-only app bundle. */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildAutocompleteV2REvaluationBundle } from './build-autocomplete-v2r-evaluation-bundle';
import { measureAutocompleteV2RBundle } from './measure-autocomplete-v2r-bundle';
import {
  canonicalSha256,
  validateV2RHoldoutV3,
  V2R_REPOSITORY_ROOT,
  type V2RHoldoutV3,
} from './autocomplete-v2r/index';
import { resolveWorkspaceInput, resolveWorkspaceOutput } from './workspace-paths';

type AssetRole = 'model' | 'phrase-bank' | 'metadata' | 'runtime';

interface RunV2RHoldoutOptions {
  rootDir?: string;
  candidateDir: string;
  holdoutPath: string;
  reportPath: string;
  finalReceiptPath?: string;
  distDir?: string;
  bundleSizeReportPath?: string;
}

interface EvaluationManifest {
  candidateId: string;
  assets: Array<{ role: AssetRole; sha256: string }>;
}

export async function runAutocompleteV2RHoldout(options: RunV2RHoldoutOptions): Promise<unknown> {
  const rootDir = fs.realpathSync(path.resolve(options.rootDir ?? V2R_REPOSITORY_ROOT));
  const holdoutFile = resolveWorkspaceInput(rootDir, options.holdoutPath);
  const holdout = readJson<V2RHoldoutV3>(holdoutFile);
  const audit = validateV2RHoldoutV3(holdout);
  const isFinal = holdout.classification.endsWith('-final-v3');
  if (isFinal !== Boolean(options.finalReceiptPath)) {
    throw new Error(
      'V2R final holdouts require a receipt; validation holdouts must not create one.',
    );
  }

  const reportFile = resolveWorkspaceOutput(rootDir, options.reportPath);
  if (fs.existsSync(reportFile)) {
    throw new Error('V2R holdout report already exists and cannot be overwritten.');
  }
  const receiptFile = options.finalReceiptPath
    ? resolveWorkspaceOutput(rootDir, options.finalReceiptPath)
    : undefined;
  if (receiptFile && fs.existsSync(receiptFile)) {
    throw new Error('V2R final holdout receipt already exists; this final version is consumed.');
  }

  const manifestPath = await buildAutocompleteV2REvaluationBundle({
    workspaceRoot: rootDir,
    candidateDir: options.candidateDir,
    ...(options.distDir ? { distDir: options.distDir } : {}),
  });
  const manifest = readJson<EvaluationManifest>(manifestPath);
  const assets = readAssetIdentity(manifest);
  await measureAutocompleteV2RBundle({
    workspaceRoot: rootDir,
    candidateDir: options.candidateDir,
    ...(options.distDir ? { distDir: options.distDir } : {}),
    ...(options.bundleSizeReportPath ? { outputPath: options.bundleSizeReportPath } : {}),
  });

  runChecked(
    rootDir,
    'pnpm',
    [
      '--filter',
      '@jotluck/app',
      'exec',
      'playwright',
      'test',
      '27-autocomplete-v2r-evidence.spec.ts',
      '--project=chromium',
      '--workers=1',
      '--reporter=list',
    ],
    {
      CI: '',
      JOTLUCK_AUTOCOMPLETE_V2R_EVALUATION_BUNDLE: '1',
      JOTLUCK_AUTOCOMPLETE_V2R_HOLDOUT: holdoutFile,
      JOTLUCK_AUTOCOMPLETE_V2R_REPORT: reportFile,
      JOTLUCK_AUTOCOMPLETE_V2R_CANDIDATE: manifest.candidateId,
      JOTLUCK_AUTOCOMPLETE_V2R_MODEL_SHA256: assets.model,
      JOTLUCK_AUTOCOMPLETE_V2R_PHRASE_BANK_SHA256: assets.phraseBank,
      JOTLUCK_AUTOCOMPLETE_V2R_METADATA_SHA256: assets.metadata,
      JOTLUCK_AUTOCOMPLETE_V2R_RUNTIME_SHA256: assets.runtime,
      ...(receiptFile ? { JOTLUCK_AUTOCOMPLETE_V2R_FINAL_RECEIPT: receiptFile } : {}),
    },
  );

  const report = readJson<Record<string, unknown>>(reportFile);
  if (
    report.candidateId !== manifest.candidateId ||
    report.holdoutSha256 !== audit.datasetSha256 ||
    report.modelSha256 !== assets.model ||
    report.phraseBankSha256 !== assets.phraseBank ||
    report.metadataSha256 !== assets.metadata ||
    report.runtimeSha256 !== assets.runtime
  ) {
    throw new Error('V2R holdout report is not bound to the frozen candidate and dataset.');
  }
  return report;
}

function readAssetIdentity(
  manifest: EvaluationManifest,
): Record<'model' | 'phraseBank' | 'metadata' | 'runtime', string> {
  if (!/^[A-Za-z0-9._-]{3,160}$/u.test(manifest.candidateId) || !Array.isArray(manifest.assets)) {
    throw new Error('V2R evaluation manifest identity is invalid.');
  }
  const values = new Map(manifest.assets.map((binding) => [binding.role, binding.sha256]));
  const required = (role: AssetRole): string => {
    const value = values.get(role);
    if (!value || !/^[a-f0-9]{64}$/u.test(value)) {
      throw new Error(`V2R evaluation manifest is missing ${role}.`);
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
      `V2R holdout command failed (${result.status ?? 'signal'}): ${command} ${args.join(' ')}`,
    );
  }
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function readArgument(argv: readonly string[], name: string): string | undefined {
  const inline = argv.find((item) => item.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function parseArguments(argv: readonly string[]): RunV2RHoldoutOptions {
  const required = (name: string): string => {
    const value = readArgument(argv, name);
    if (!value) throw new Error(`${name} is required.`);
    return value;
  };
  return {
    rootDir: readArgument(argv, '--root-dir'),
    candidateDir: required('--candidate-dir'),
    holdoutPath: required('--holdout'),
    reportPath: required('--report'),
    finalReceiptPath: readArgument(argv, '--final-receipt'),
    distDir: readArgument(argv, '--dist-dir'),
    bundleSizeReportPath: readArgument(argv, '--bundle-size-report'),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runAutocompleteV2RHoldout(parseArguments(process.argv.slice(2)))
    .then((report) =>
      console.log(
        JSON.stringify(
          {
            reportSha256: canonicalSha256(report),
            status: 'passed',
          },
          null,
          2,
        ),
      ),
    )
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    });
}
