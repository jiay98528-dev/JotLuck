import { spawn } from 'node:child_process';
import { access, link, mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAutocompleteV2RTrainingData } from './build-autocomplete-v2r-training-data';
import {
  canonicalSha256,
  calculateV2RPhraseBankRepresentation,
  resolveV2RCacheRoot,
  sha256,
  validateV2RHoldoutV3,
  V2R_REPOSITORY_ROOT,
  type V2RHoldoutV3,
  type V2RPhraseBankEntry,
  type V2RPhraseBankSize,
} from './autocomplete-v2r/index';

const MATRIX = [
  { phraseBankSize: 8192 as const, hiddenSize: 96, layers: 2 },
  { phraseBankSize: 12288 as const, hiddenSize: 128, layers: 2 },
  { phraseBankSize: 16384 as const, hiddenSize: 128, layers: 3 },
] as const;
const SEEDS = [98528, 98529] as const;

interface MatrixOptions {
  workspaceRoot?: string;
  smoke?: boolean;
  prepareOnly?: boolean;
  validationHoldoutPaths?: string[];
}

const DEFAULT_VALIDATION_HOLDOUT_PATHS = [
  'scripts/corpus/autocomplete-v2r-holdouts/cold-validation-v3.json',
  'scripts/corpus/autocomplete-v2r-holdouts/workspace-validation-v3.json',
] as const;

interface CandidateSummary {
  id: string;
  phraseBankSize: V2RPhraseBankSize;
  hiddenSize: number;
  layers: number;
  seed: number;
  trainingReportPath: string;
  trainingReportSha256: string;
  candidateEligible: boolean;
  oracleAt32AbsoluteRate: number;
  usableRate: number;
  modelDataBytes: number;
}

interface RepresentationPreflight {
  phraseBankSize: V2RPhraseBankSize;
  phraseBankSha256: string;
  holdouts: Array<{
    path: string;
    datasetId: string;
    classification: V2RHoldoutV3['classification'];
    datasetSha256: string;
    absoluteRate: number;
    zhAbsoluteRate: number;
    enAbsoluteRate: number;
    passed: boolean;
    reasons: string[];
  }>;
  passed: boolean;
}

export async function runAutocompleteV2RTrainingMatrix(
  options: MatrixOptions = {},
): Promise<string> {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? V2R_REPOSITORY_ROOT);
  await assertFixedPhraseArchitectureActive(workspaceRoot, options.prepareOnly ?? false);
  const cacheRoot = resolveV2RCacheRoot(workspaceRoot);
  const candidates: CandidateSummary[] = [];
  const representationPreflights: RepresentationPreflight[] = [];
  const validationHoldouts =
    options.smoke || options.prepareOnly
      ? []
      : await loadValidationHoldouts(
          workspaceRoot,
          options.validationHoldoutPaths ?? [...DEFAULT_VALIDATION_HOLDOUT_PATHS],
        );
  const python = path.join(cacheRoot, '.venv', 'Scripts', 'python.exe');
  if (!options.prepareOnly) await access(python);
  const trainingScript = path.join(
    workspaceRoot,
    'scripts',
    'autocomplete-v2r',
    'train_phrase_transformer.py',
  );
  const trainerSourceIdentity = sha256(await readFile(trainingScript)).slice(0, 12);

  const architectures = options.smoke ? MATRIX.slice(0, 1) : MATRIX;
  const seeds = options.smoke ? SEEDS.slice(0, 1) : SEEDS;
  for (const architecture of architectures) {
    const trainingDataReportPath = await buildAutocompleteV2RTrainingData({
      workspaceRoot,
      phraseBankSize: architecture.phraseBankSize,
    });
    const trainingDataIdentity = sha256(await readFile(trainingDataReportPath)).slice(0, 12);
    if (options.prepareOnly) continue;
    if (!options.smoke) {
      const phraseBankPath = path.join(
        cacheRoot,
        'training',
        String(architecture.phraseBankSize),
        'phrase-bank.jsonl',
      );
      const phraseBankBytes = await readFile(phraseBankPath);
      const phraseBank = parsePhraseBank(phraseBankBytes.toString('utf8'));
      const holdoutReports = validationHoldouts.map(({ path: holdoutPath, holdout, audit }) => {
        const report = calculateV2RPhraseBankRepresentation(holdout, phraseBank);
        return {
          path: repositoryRelative(holdoutPath, workspaceRoot),
          datasetId: holdout.datasetId,
          classification: holdout.classification,
          datasetSha256: audit.datasetSha256,
          absoluteRate: report.overall.absoluteRate,
          zhAbsoluteRate: report.byLanguage.zh.absoluteRate,
          enAbsoluteRate: report.byLanguage.en.absoluteRate,
          passed: report.passed,
          reasons: report.reasons,
        };
      });
      const preflight: RepresentationPreflight = {
        phraseBankSize: architecture.phraseBankSize,
        phraseBankSha256: sha256(phraseBankBytes),
        holdouts: holdoutReports,
        passed: holdoutReports.every((report) => report.passed),
      };
      representationPreflights.push(preflight);
      if (!preflight.passed) continue;
    }
    for (const seed of seeds) {
      const id = `${options.smoke ? 'smoke-' : ''}${architecture.phraseBankSize}-${architecture.hiddenSize}-${architecture.layers}-seed-${seed}-input-${trainingDataIdentity}-trainer-${trainerSourceIdentity}`;
      const outputDir = path.join(cacheRoot, 'candidates', id);
      await assertMissing(outputDir, `V2R candidate ${id} already exists and is immutable.`);
      const temporaryOutputDir = `${outputDir}.${process.pid}.tmp`;
      await rm(temporaryOutputDir, { recursive: true, force: true });
      await mkdir(temporaryOutputDir, { recursive: true });
      const argumentsList = [
        trainingScript,
        `--workspace-root=${workspaceRoot}`,
        `--phrase-bank-size=${architecture.phraseBankSize}`,
        `--hidden-size=${architecture.hiddenSize}`,
        `--layers=${architecture.layers}`,
        `--seed=${seed}`,
        '--epochs=8',
        '--patience=2',
        '--threads=16',
        `--output-dir=${temporaryOutputDir}`,
      ];
      if (options.smoke) {
        replaceArgument(argumentsList, '--epochs=', '--epochs=1');
        argumentsList.push('--max-train-samples=2048', '--max-eval-samples=512');
      }
      let trainingReportBytes: Buffer;
      let report: Record<string, unknown>;
      try {
        await runProcess(python, argumentsList, workspaceRoot);
        const temporaryReportPath = path.join(temporaryOutputDir, 'training-report.json');
        trainingReportBytes = await readFile(temporaryReportPath);
        report = JSON.parse(trainingReportBytes.toString('utf8')) as Record<string, unknown>;
        validateTrainingReportIdentity(report);
        await rename(temporaryOutputDir, outputDir);
      } catch (error) {
        await rm(temporaryOutputDir, { recursive: true, force: true });
        throw error;
      }
      const trainingReportPath = path.join(outputDir, 'training-report.json');
      const internal = report.internalSelectionInt8 as {
        overall: { oracleAt32AbsoluteRate: number; usableRate: number };
      };
      const assets = report.assets as { modelDataBytes: number };
      candidates.push({
        id,
        phraseBankSize: architecture.phraseBankSize,
        hiddenSize: architecture.hiddenSize,
        layers: architecture.layers,
        seed,
        trainingReportPath: repositoryRelative(trainingReportPath, workspaceRoot),
        trainingReportSha256: sha256(trainingReportBytes),
        candidateEligible: report.candidateEligible === true,
        oracleAt32AbsoluteRate: internal.overall.oracleAt32AbsoluteRate,
        usableRate: internal.overall.usableRate,
        modelDataBytes: assets.modelDataBytes,
      });
    }
  }

  const eligible = candidates
    .filter((candidate) => candidate.candidateEligible)
    .sort(
      (left, right) =>
        left.modelDataBytes - right.modelDataBytes ||
        right.usableRate - left.usableRate ||
        left.seed - right.seed,
    );
  const selectedCandidate = eligible[0]?.id ?? null;
  const withoutIdentity = {
    schema: 'jotluck.autocomplete.v2r-training-matrix-report.v1',
    schemaVersion: 1,
    createdAt: '2026-07-12T00:00:00.000Z',
    boundedMatrix: MATRIX,
    seeds: SEEDS,
    smoke: options.smoke ?? false,
    prepareOnly: options.prepareOnly ?? false,
    representationPreflights,
    candidates,
    selectedCandidate: options.smoke ? null : selectedCandidate,
    candidateSelectionPassed: !options.smoke && selectedCandidate !== null,
    finalEvaluationRun: false,
    releaseEligible: false,
    stopReason: options.prepareOnly
      ? 'training-data-prepared'
      : options.smoke
        ? 'smoke-run-never-selects-a-candidate'
        : representationPreflights.some((preflight) => !preflight.passed)
          ? 'phrase-bank-representation-preflight-failed'
          : selectedCandidate
            ? 'candidate-requires-independent-v3-validation-and-final'
            : 'bounded-matrix-has-no-eligible-candidate',
  };
  const matrixReport = {
    ...withoutIdentity,
    reportSha256: canonicalSha256(withoutIdentity),
  };
  const reportName = options.prepareOnly
    ? 'training-matrix-report.prepare.json'
    : options.smoke
      ? 'training-matrix-report.smoke.json'
      : 'training-matrix-report.json';
  const reportPath = path.join(cacheRoot, reportName);
  await writeJsonImmutable(reportPath, matrixReport);
  return reportPath;
}

async function assertFixedPhraseArchitectureActive(
  workspaceRoot: string,
  prepareOnly: boolean,
): Promise<void> {
  if (prepareOnly) return;
  const stopPath = path.join(
    workspaceRoot,
    'scripts',
    'corpus',
    'autocomplete-v2r-architecture-stop.json',
  );
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(await readFile(stopPath, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (
    value.schema !== 'jotluck.autocomplete.v2r-architecture-stop.v1' ||
    value.engine !== 'public-phrase-transformer-v1' ||
    value.status !== 'architecture-blocked' ||
    value.stopLongTraining !== true
  ) {
    throw new Error('V2R architecture-stop record is invalid.');
  }
  throw new Error(
    'V2R fixed-phrase architecture is blocked; long training is disabled until a new ADR replaces the output space.',
  );
}

function replaceArgument(values: string[], prefix: string, replacement: string): void {
  const index = values.findIndex((value) => value.startsWith(prefix));
  if (index < 0) throw new Error(`Missing process argument: ${prefix}`);
  values[index] = replacement;
}

async function runProcess(command: string, args: readonly string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else
        reject(new Error(`V2R trainer exited with code ${code} and signal ${signal ?? 'none'}.`));
    });
  });
}

function validateTrainingReportIdentity(report: Record<string, unknown>): void {
  const architecture = report.architecture as Record<string, unknown> | undefined;
  const labelSemantics = report.labelSemantics as Record<string, unknown> | undefined;
  if (
    report.schema !== 'jotluck.autocomplete.v2r-training-report.v1' ||
    report.schemaVersion !== 1 ||
    report.engine !== 'public-phrase-transformer-v1' ||
    architecture?.contextUtf8Bytes !== 192 ||
    architecture.contextPatchBytes !== 4 ||
    labelSemantics?.abstainClassWeight !== 1 ||
    labelSemantics?.abstainReasonPolicy !== 'document-end-only-v1' ||
    labelSemantics?.bankMissIsCoverageOnly !== true ||
    typeof report.trainerCanonicalSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(report.trainerCanonicalSha256)
  ) {
    throw new Error('V2R training report identity is invalid.');
  }
}

function repositoryRelative(filePath: string, workspaceRoot: string): string {
  const relative = path.relative(workspaceRoot, filePath).split(path.sep).join('/');
  if (relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new Error('V2R report path escaped the repository.');
  }
  return relative;
}

async function writeJsonImmutable(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  try {
    const existing = await readFile(filePath, 'utf8');
    if (existing === serialized) return;
    throw new Error('V2R training-matrix evidence already exists with different content.');
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, serialized, { encoding: 'utf8', flag: 'wx' });
  try {
    await link(temporaryPath, filePath);
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    const existing = await readFile(filePath, 'utf8');
    if (existing !== serialized) {
      throw new Error('V2R training-matrix evidence raced with different content.');
    }
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function assertMissing(filePath: string, message: string): Promise<void> {
  try {
    await access(filePath);
  } catch (error) {
    if (isMissingFile(error)) return;
    throw error;
  }
  throw new Error(message);
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

function isAlreadyExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'EEXIST';
}

function parseArguments(argv: readonly string[]): MatrixOptions {
  const options: MatrixOptions = {};
  for (const argument of argv) {
    if (argument === '--smoke') options.smoke = true;
    else if (argument === '--prepare-only') options.prepareOnly = true;
    else if (argument.startsWith('--workspace-root=')) {
      options.workspaceRoot = argument.slice('--workspace-root='.length);
    } else if (argument.startsWith('--validation-holdout=')) {
      (options.validationHoldoutPaths ??= []).push(argument.slice('--validation-holdout='.length));
    } else throw new Error(`Unknown V2R matrix argument: ${argument}`);
  }
  return options;
}

async function loadValidationHoldouts(
  workspaceRoot: string,
  relativePaths: readonly string[],
): Promise<
  Array<{
    path: string;
    holdout: V2RHoldoutV3;
    audit: ReturnType<typeof validateV2RHoldoutV3>;
  }>
> {
  if (relativePaths.length !== 2) {
    throw new Error('Formal V2R training requires cold and workspace validation holdouts.');
  }
  const loaded: Array<{
    path: string;
    holdout: V2RHoldoutV3;
    audit: ReturnType<typeof validateV2RHoldoutV3>;
  }> = [];
  // Validate in the declared order so a missing pair has a deterministic,
  // actionable first failure instead of a Promise scheduling race.
  for (const relativePath of relativePaths) {
    const absolutePath = path.resolve(workspaceRoot, relativePath);
    repositoryRelative(absolutePath, workspaceRoot);
    let holdout: V2RHoldoutV3;
    try {
      holdout = JSON.parse(await readFile(absolutePath, 'utf8')) as V2RHoldoutV3;
    } catch (error) {
      throw new Error(
        `Frozen V2R validation holdout is missing or invalid: ${relativePath}. ${String(error)}`,
      );
    }
    const audit = validateV2RHoldoutV3(holdout);
    loaded.push({ path: absolutePath, holdout, audit });
  }
  const classifications = new Set(loaded.map((item) => item.holdout.classification));
  if (
    !classifications.has('cold-validation-v3') ||
    !classifications.has('workspace-validation-v3')
  ) {
    throw new Error('Formal V2R training requires one cold and one workspace validation v3.');
  }
  return loaded;
}

function parsePhraseBank(value: string): V2RPhraseBankEntry[] {
  const entries = value
    .split(/\r?\n/gu)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as V2RPhraseBankEntry);
  if (entries.length === 0) throw new Error('V2R phrase bank is empty.');
  return entries;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAutocompleteV2RTrainingMatrix(parseArguments(process.argv.slice(2)))
    .then((reportPath) => console.log(reportPath))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    });
}
