import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  aggregateV2RReleaseEvidence,
  canonicalSha256,
  sha256,
  V2R_REPOSITORY_ROOT,
  type V2RFinalOverlapAudit,
  type V2RFinalRunConsumptionReceipt,
  type V2RHoldoutV3,
  type V2RPerHoldoutQualityEvidence,
} from './autocomplete-v2r/index';

type HoldoutName = 'coldValidation' | 'workspaceValidation' | 'coldFinal' | 'workspaceFinal';

interface AggregateOptions {
  workspaceRoot?: string;
  candidateDir: string;
  outputDir: string;
  evaluatorTree: string;
  bundleSizeReport: string;
  holdouts: Record<HoldoutName, string>;
  reports: Record<HoldoutName, string>;
  finalReceipts: { coldFinal: string; workspaceFinal: string };
  finalOverlapAudit: string;
}

export async function aggregateAutocompleteV2REvidence(options: AggregateOptions): Promise<string> {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? V2R_REPOSITORY_ROOT);
  const candidateDir = resolveRepositoryPath(workspaceRoot, options.candidateDir, 'candidateDir');
  const outputDir = resolveRepositoryPath(workspaceRoot, options.outputDir, 'outputDir');
  await assertMissing(outputDir);

  const candidate = await readCandidateIdentity(candidateDir, workspaceRoot);
  const bundleSizeReportPath = resolveRepositoryPath(
    workspaceRoot,
    options.bundleSizeReport,
    'bundleSizeReport',
  );
  const bundleSizeReportBytes = await readFile(bundleSizeReportPath);
  const measuredStaticDeltaBytes = validateBundleSizeReport(
    parseJson(bundleSizeReportBytes, 'bundleSizeReport'),
    candidate,
  );
  const evaluatorTreePath = resolveRepositoryPath(
    workspaceRoot,
    options.evaluatorTree,
    'evaluatorTree',
  );
  const evaluatorTreeBytes = await readFile(evaluatorTreePath);
  const evaluatorTree = parseJson(evaluatorTreeBytes, 'evaluatorTree') as Record<string, unknown>;
  if (
    typeof evaluatorTree !== 'object' ||
    evaluatorTree === null ||
    !('treeSha256' in evaluatorTree) ||
    typeof evaluatorTree.treeSha256 !== 'string'
  ) {
    throw new Error('V2R evaluator source-tree identity is invalid.');
  }

  const holdouts = {} as Parameters<typeof aggregateV2RReleaseEvidence>[0]['holdouts'];
  const holdoutBindings = {} as Record<HoldoutName, { path: string; sha256: string }>;
  for (const name of Object.keys(options.holdouts) as HoldoutName[]) {
    const holdoutPath = resolveRepositoryPath(
      workspaceRoot,
      options.holdouts[name],
      `${name}Holdout`,
    );
    const reportPath = resolveRepositoryPath(workspaceRoot, options.reports[name], `${name}Report`);
    const [holdoutBytes, reportBytes] = await Promise.all([
      readFile(holdoutPath),
      readFile(reportPath),
    ]);
    holdouts[name] = {
      holdout: parseJson(holdoutBytes, `${name} holdout`) as V2RHoldoutV3,
      report: parseJson(reportBytes, `${name} report`) as V2RPerHoldoutQualityEvidence,
      reportFileSha256: sha256(reportBytes),
    };
    holdoutBindings[name] = bindFile(options.holdouts[name], holdoutBytes);
  }
  const [coldReceipt, workspaceReceipt] = await Promise.all([
    readJson(
      resolveRepositoryPath(workspaceRoot, options.finalReceipts.coldFinal, 'coldFinalReceipt'),
    ),
    readJson(
      resolveRepositoryPath(
        workspaceRoot,
        options.finalReceipts.workspaceFinal,
        'workspaceFinalReceipt',
      ),
    ),
  ]);
  const finalOverlapAuditBytes = await readFile(
    resolveRepositoryPath(workspaceRoot, options.finalOverlapAudit, 'finalOverlapAudit'),
  );
  const finalOverlapAudit = parseJson(
    finalOverlapAuditBytes,
    'finalOverlapAudit',
  ) as V2RFinalOverlapAudit;

  const aggregate = aggregateV2RReleaseEvidence({
    ...candidate.identity,
    evaluatorTreeSha256: evaluatorTree.treeSha256,
    trainingInputTreeSha256: finalOverlapAudit.inputTreeSha256,
    measuredStaticDeltaBytes,
    holdouts,
    finalReceipts: {
      coldFinal: coldReceipt as unknown as V2RFinalRunConsumptionReceipt,
      workspaceFinal: workspaceReceipt as unknown as V2RFinalRunConsumptionReceipt,
    },
    finalOverlapAudit,
  });
  const bundleWithoutHash = {
    schema: 'jotluck.autocomplete.v2r-release-evidence-bundle.v1',
    schemaVersion: 1,
    ...candidate.identity,
    candidateDir: repositoryRelative(candidateDir, workspaceRoot),
    bundleSizeReport: bindFile(options.bundleSizeReport, bundleSizeReportBytes),
    evaluatorTree: bindFile(options.evaluatorTree, evaluatorTreeBytes),
    finalOverlapAudit: bindFile(options.finalOverlapAudit, finalOverlapAuditBytes),
    holdouts: holdoutBindings,
    reports: Object.fromEntries(
      (Object.keys(options.reports) as HoldoutName[]).map((name) => [
        name,
        { path: options.reports[name], sha256: holdouts[name].reportFileSha256 },
      ]),
    ),
    aggregateFiles: {
      qualityReport: 'quality-report.json',
      runtimeReport: 'runtime-report.json',
      finalConsumptionReceipt: 'final-consumption-receipt.json',
      finalOverlapAudit: 'final-overlap-audit.json',
    },
  };
  const bundle = {
    ...bundleWithoutHash,
    bundleSha256: canonicalSha256(bundleWithoutHash),
  };

  const temporaryDir = `${outputDir}.${process.pid}.tmp`;
  await rm(temporaryDir, { recursive: true, force: true });
  await mkdir(temporaryDir, { recursive: true });
  try {
    await Promise.all([
      writeJson(path.join(temporaryDir, 'quality-report.json'), aggregate.qualityReport),
      writeJson(path.join(temporaryDir, 'runtime-report.json'), aggregate.runtimeReport),
      writeJson(
        path.join(temporaryDir, 'final-consumption-receipt.json'),
        aggregate.finalConsumptionReceipt,
      ),
      writeFile(path.join(temporaryDir, 'final-overlap-audit.json'), finalOverlapAuditBytes, {
        flag: 'wx',
      }),
      writeJson(path.join(temporaryDir, 'release-evidence-bundle.json'), bundle),
    ]);
    await rename(temporaryDir, outputDir);
  } catch (error) {
    await rm(temporaryDir, { recursive: true, force: true });
    throw error;
  }
  return path.join(outputDir, 'release-evidence-bundle.json');
}

async function readCandidateIdentity(
  candidateDir: string,
  workspaceRoot: string,
): Promise<{
  identity: {
    candidateId: string;
    modelSha256: string;
    phraseBankSha256: string;
    metadataSha256: string;
    runtimeSha256: string;
  };
  assetBytes: number;
}> {
  const trainingReportPath = path.join(candidateDir, 'training-report.json');
  const trainingReport = (await readJson(trainingReportPath)) as {
    schema?: string;
    candidateEligible?: boolean;
    assets?: { phraseBank?: { path?: string; sha256?: string } };
  };
  if (
    trainingReport.schema !== 'jotluck.autocomplete.v2r-training-report.v1' ||
    trainingReport.candidateEligible !== true ||
    typeof trainingReport.assets?.phraseBank?.path !== 'string'
  ) {
    throw new Error('V2R candidate has no eligible frozen training report.');
  }
  const files = {
    model: path.join(candidateDir, 'model.int8.onnx'),
    phraseBank: resolveRepositoryPath(
      workspaceRoot,
      trainingReport.assets.phraseBank.path,
      'phraseBank',
    ),
    metadata: path.join(candidateDir, 'runtime-metadata.json'),
    runtime: path.join(candidateDir, 'ort-wasm-simd-threaded.reduced.wasm'),
  };
  const [model, phraseBank, metadata, runtime] = (await Promise.all(
    Object.values(files).map((filePath) => readFile(filePath)),
  )) as [Buffer, Buffer, Buffer, Buffer];
  const identity = {
    candidateId: path.basename(candidateDir),
    modelSha256: sha256(model),
    phraseBankSha256: sha256(phraseBank),
    metadataSha256: sha256(metadata),
    runtimeSha256: sha256(runtime),
  };
  if (trainingReport.assets.phraseBank.sha256 !== identity.phraseBankSha256) {
    throw new Error('V2R phrase bank no longer matches the training report.');
  }
  return {
    identity,
    assetBytes: model.byteLength + phraseBank.byteLength + metadata.byteLength + runtime.byteLength,
  };
}

function validateBundleSizeReport(
  value: unknown,
  candidate: Awaited<ReturnType<typeof readCandidateIdentity>>,
): number {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('V2R bundle-size report is invalid.');
  }
  const report = value as Record<string, unknown>;
  const identity = { ...report };
  delete identity.reportSha256;
  const measured = report.conservativeStaticDeltaUpperBoundBytes;
  if (
    report.schema !== 'jotluck.autocomplete.v2r-bundle-size.v1' ||
    report.schemaVersion !== 1 ||
    report.measurementMethod !== 'candidate-assets-plus-entire-app-js-upper-bound' ||
    report.modelSha256 !== candidate.identity.modelSha256 ||
    report.phraseBankSha256 !== candidate.identity.phraseBankSha256 ||
    report.metadataSha256 !== candidate.identity.metadataSha256 ||
    report.runtimeSha256 !== candidate.identity.runtimeSha256 ||
    report.candidateAssetBytes !== candidate.assetBytes ||
    !Number.isSafeInteger(report.entireAppJavaScriptBytes) ||
    (report.entireAppJavaScriptBytes as number) <= 0 ||
    !Number.isSafeInteger(measured) ||
    (measured as number) < candidate.assetBytes ||
    (measured as number) > 12 * 1024 * 1024 ||
    report.staticDeltaLimitBytes !== 12 * 1024 * 1024 ||
    report.candidateRuntimeCopies !== 1 ||
    report.candidateModelCopies !== 1 ||
    report.candidatePhraseBankCopies !== 1 ||
    report.candidateMetadataCopies !== 1 ||
    report.stockWasmAssets !== 0 ||
    report.passed !== true ||
    report.reportSha256 !== canonicalSha256(identity)
  ) {
    throw new Error('V2R bundle-size report does not prove the frozen candidate bundle.');
  }
  return measured as number;
}

function resolveRepositoryPath(workspaceRoot: string, value: string, label: string): string {
  if (!value || path.isAbsolute(value) || value.split(/[\\/]/u).includes('..')) {
    throw new Error(`${label} must be a repository-relative path.`);
  }
  const resolved = path.resolve(workspaceRoot, value);
  repositoryRelative(resolved, workspaceRoot);
  return resolved;
}

function repositoryRelative(filePath: string, workspaceRoot: string): string {
  const relative = path.relative(workspaceRoot, filePath).split(path.sep).join('/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new Error('V2R path escaped the repository.');
  }
  return relative;
}

function bindFile(filePath: string, bytes: Uint8Array): { path: string; sha256: string } {
  return { path: filePath.split(path.sep).join('/'), sha256: sha256(bytes) };
}

async function assertMissing(filePath: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    return;
  }
  throw new Error('V2R aggregate evidence output already exists and cannot be overwritten.');
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  return parseJson(await readFile(filePath), filePath) as Record<string, unknown>;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    throw new Error(`V2R ${label} is not valid UTF-8 JSON: ${String(error)}.`);
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
}

function parseArguments(argv: readonly string[]): AggregateOptions {
  const values = new Map<string, string>();
  for (const argument of argv) {
    const match = /^--([a-z-]+)=(.+)$/u.exec(argument);
    if (!match) throw new Error(`Unknown V2R aggregate argument: ${argument}`);
    values.set(match[1]!, match[2]!);
  }
  const required = (name: string): string => {
    const value = values.get(name);
    if (!value) throw new Error(`--${name} is required.`);
    return value;
  };
  return {
    workspaceRoot: values.get('workspace-root'),
    candidateDir: required('candidate-dir'),
    outputDir: required('output-dir'),
    evaluatorTree: required('evaluator-tree'),
    bundleSizeReport: required('bundle-size-report'),
    holdouts: {
      coldValidation: required('cold-validation-holdout'),
      workspaceValidation: required('workspace-validation-holdout'),
      coldFinal: required('cold-final-holdout'),
      workspaceFinal: required('workspace-final-holdout'),
    },
    reports: {
      coldValidation: required('cold-validation-report'),
      workspaceValidation: required('workspace-validation-report'),
      coldFinal: required('cold-final-report'),
      workspaceFinal: required('workspace-final-report'),
    },
    finalReceipts: {
      coldFinal: required('cold-final-receipt'),
      workspaceFinal: required('workspace-final-receipt'),
    },
    finalOverlapAudit: required('final-overlap-audit'),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  aggregateAutocompleteV2REvidence(parseArguments(process.argv.slice(2)))
    .then((filePath) => console.log(filePath))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    });
}
