import { spawn } from 'node:child_process';
import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertPathInsideV2RCache,
  canonicalSha256,
  normalizeRepositoryRelativePath,
  PROJECT_OWNED_GENERATOR_V3,
  PROJECT_OWNED_GENERATOR_V3_SEED,
  resolveV2RCacheRoot,
  sha256,
  V2R_CACHE_RELATIVE_ROOT,
  V2R_REPOSITORY_ROOT,
} from './autocomplete-v2r/index';

const EVALUATION_DIRECTORY = 'autocomplete-v2r-evaluation';
const EVALUATION_MANIFEST_URL = `/${EVALUATION_DIRECTORY}/manifest.json`;
const MODEL_DATA_LIMIT_BYTES = 6 * 1024 * 1024;
const STATIC_DELTA_LIMIT_BYTES = 12 * 1024 * 1024;
const ARCHITECTURE_MATRIX = new Set(['8192:96:2', '12288:128:2', '16384:128:3']);

interface EvaluationBundleOptions {
  workspaceRoot?: string;
  candidateDir: string;
  distDir?: string;
  buildApp?: boolean;
}

interface FileBinding {
  path: string;
  bytes: Uint8Array;
  sha256: string;
}

type JsonRecord = Record<string, unknown>;

/**
 * Builds an explicitly evaluation-only application bundle for a frozen V2R
 * candidate. It never writes packages/app/public and cannot grant release
 * eligibility. The normal production build has no environment switch that can
 * discover this manifest.
 */
export async function buildAutocompleteV2REvaluationBundle(
  options: EvaluationBundleOptions,
): Promise<string> {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? V2R_REPOSITORY_ROOT);
  const candidateDir = resolveCachePath(workspaceRoot, options.candidateDir, 'candidateDir');
  const distDir = resolveRepositoryPath(
    workspaceRoot,
    options.distDir ?? 'packages/app/dist',
    'distDir',
  );
  const candidateId = path.basename(candidateDir);
  if (!/^[A-Za-z0-9._-]{3,160}$/u.test(candidateId)) {
    throw new Error('V2R evaluation candidate ID is invalid.');
  }

  const trainingReportBinding = await readJsonBinding(
    path.join(candidateDir, 'training-report.json'),
    workspaceRoot,
  );
  const trainingReport = trainingReportBinding.value;
  const architecture = readArchitecture(trainingReport);
  if (
    trainingReport.schema !== 'jotluck.autocomplete.v2r-training-report.v1' ||
    trainingReport.schemaVersion !== 1 ||
    trainingReport.engine !== 'public-phrase-transformer-v1' ||
    trainingReport.quantizationPassed !== true ||
    trainingReport.candidateCapabilityPassed !== true ||
    trainingReport.thresholdCalibrationPassed !== true ||
    trainingReport.internalQualityGatePassed !== true ||
    trainingReport.candidateEligible !== true ||
    trainingReport.releaseEligible !== false
  ) {
    throw new Error('V2R evaluation requires an internally eligible, unreleased frozen candidate.');
  }

  const reportAssets = requireRecord(trainingReport.assets, 'trainingReport.assets');
  const modelReport = requireRecord(reportAssets.int8, 'trainingReport.assets.int8');
  const phraseReport = requireRecord(reportAssets.phraseBank, 'trainingReport.assets.phraseBank');
  const metadataReport = requireRecord(reportAssets.metadata, 'trainingReport.assets.metadata');
  const operatorReport = requireRecord(
    reportAssets.operatorConfig,
    'trainingReport.assets.operatorConfig',
  );
  const phraseSourcePath = requireString(phraseReport.path, 'phraseBank.path');
  const phraseBankPath = resolveCachePath(workspaceRoot, phraseSourcePath, 'phraseBank.path');
  const trainingDataRelativePath = `${V2R_CACHE_RELATIVE_ROOT}/training/${architecture.phraseBankSize}/training-data-report.json`;

  const sourcePaths = {
    model: path.join(candidateDir, 'model.int8.onnx'),
    phraseBank: phraseBankPath,
    metadata: path.join(candidateDir, 'runtime-metadata.json'),
    runtime: path.join(candidateDir, 'ort-wasm-simd-threaded.reduced.wasm'),
    selectionManifest: path.join(resolveV2RCacheRoot(workspaceRoot), 'selection-manifest.json'),
    sourceRegistry: path.join(resolveV2RCacheRoot(workspaceRoot), 'source-registry.json'),
    corpusGovernance: path.join(resolveV2RCacheRoot(workspaceRoot), 'governance-report.json'),
    generatorReport: path.join(resolveV2RCacheRoot(workspaceRoot), 'generator-report.json'),
    trainingInput: resolveRepositoryPath(workspaceRoot, trainingDataRelativePath, 'trainingInput'),
    trainingReport: path.join(candidateDir, 'training-report.json'),
    quantizationReport: path.join(candidateDir, 'quantization-report.json'),
    operatorConfig: path.join(candidateDir, 'required-operators.config'),
    runtimeBuildReport: path.join(candidateDir, 'runtime-build-report.json'),
  } as const;
  const fileBindings = Object.fromEntries(
    await Promise.all(
      Object.entries(sourcePaths).map(async ([name, filePath]) => {
        const bytes = await readFile(filePath);
        return [
          name,
          {
            path: repositoryRelative(filePath, workspaceRoot),
            bytes,
            sha256: sha256(bytes),
          } satisfies FileBinding,
        ] as const;
      }),
    ),
  ) as Record<keyof typeof sourcePaths, FileBinding>;

  assertAssetIdentity(modelReport, fileBindings.model, 'model');
  assertAssetIdentity(phraseReport, fileBindings.phraseBank, 'phrase bank');
  assertAssetIdentity(metadataReport, fileBindings.metadata, 'runtime metadata');
  assertAssetIdentity(operatorReport, fileBindings.operatorConfig, 'operator config');
  assertPhraseBank(fileBindings.phraseBank.bytes, architecture.phraseBankSize);

  const selection = parseJson(fileBindings.selectionManifest.bytes, 'selection manifest');
  const sourceRegistry = parseJsonArray(fileBindings.sourceRegistry.bytes, 'source registry');
  const governance = parseJson(fileBindings.corpusGovernance.bytes, 'corpus governance');
  const generator = parseJson(fileBindings.generatorReport.bytes, 'generator report');
  const trainingInput = parseJson(fileBindings.trainingInput.bytes, 'training input');
  const runtimeBuild = parseJson(fileBindings.runtimeBuildReport.bytes, 'runtime build report');
  const metadata = parseJson(fileBindings.metadata.bytes, 'runtime metadata');

  assertCorpusBindings(selection, sourceRegistry, governance, generator, trainingInput);
  assertTrainingBindings(
    trainingReport,
    trainingInput,
    fileBindings.phraseBank,
    fileBindings.quantizationReport,
    architecture.phraseBankSize,
  );
  assertRuntimeBindings(
    runtimeBuild,
    fileBindings.model,
    fileBindings.operatorConfig,
    fileBindings.runtime,
  );
  assertRuntimeMetadata(metadata, architecture.phraseBankSize);

  const modelDataBytes =
    fileBindings.model.bytes.byteLength +
    fileBindings.phraseBank.bytes.byteLength +
    fileBindings.metadata.bytes.byteLength;
  const staticBundleDeltaBytes = modelDataBytes + fileBindings.runtime.bytes.byteLength;
  if (
    modelDataBytes > MODEL_DATA_LIMIT_BYTES ||
    staticBundleDeltaBytes > STATIC_DELTA_LIMIT_BYTES
  ) {
    throw new Error('V2R evaluation candidate exceeds the frozen model/runtime byte budget.');
  }

  if (options.buildApp !== false) {
    await runViteEvaluationBuild(workspaceRoot, distDir);
  } else {
    await mkdir(distDir, { recursive: true });
  }

  const outputDirectory = path.join(distDir, EVALUATION_DIRECTORY);
  await assertMissing(outputDirectory);
  const temporaryDirectory = `${outputDirectory}.${process.pid}.tmp`;
  await rm(temporaryDirectory, { recursive: true, force: true });
  await mkdir(temporaryDirectory, { recursive: true });

  const selectionSha256 = requireString(selection.selectionSha256, 'selection.selectionSha256');
  const generatorVersion = requireString(generator.generatorVersion, 'generator.generatorVersion');
  const selectedBytes = requireRecord(selection.selectedBytes, 'selection.selectedBytes');
  const manifest = {
    schema: 'jotluck.autocomplete.public-model.v5',
    schemaVersion: 5,
    engine: 'public-phrase-transformer-v1',
    profile: 'web-local',
    createdAt: requireCanonicalTimestamp(selection.createdAt, 'selection.createdAt'),
    architecture: {
      format: 'onnx',
      quantization: 'int8',
      phraseBankSize: architecture.phraseBankSize,
      hiddenSize: architecture.hiddenSize,
      layers: architecture.layers,
      attentionHeads: 4,
      maxContextUtf8Bytes: 192,
      contextPatchBytes: 4,
      maxCandidates: 32,
      abstainClass: true,
    },
    assets: [
      assetBinding('model', 'model.int8.onnx', fileBindings.model),
      assetBinding('phrase-bank', 'phrase-bank.jsonl', fileBindings.phraseBank),
      assetBinding('metadata', 'runtime-metadata.json', fileBindings.metadata),
      assetBinding('runtime', 'ort-wasm-simd-threaded.v2r.wasm', fileBindings.runtime),
    ],
    staticBundleDeltaBytes,
    training: {
      selectionManifestPath: fileBindings.selectionManifest.path,
      selectionManifestSha256: selectionSha256,
      inputTreeSha256: requireSha256(generator.inputTreeSha256, 'generator.inputTreeSha256'),
      generatorVersion,
      seeds: [requireInteger(trainingReport.seed, 'trainingReport.seed', 0)],
      trainBytes: requireInteger(selectedBytes.train, 'selection.selectedBytes.train', 1),
      developmentBytes: requireInteger(
        selectedBytes.development,
        'selection.selectedBytes.development',
        1,
      ),
      internalSelectionBytes: requireInteger(
        selectedBytes.internalSelection,
        'selection.selectedBytes.internalSelection',
        1,
      ),
    },
    runtimeEligible: true,
    qualityGatePassed: false,
    releaseEligible: false,
    evaluationOnly: true,
    candidateId,
    evidenceBindings: Object.fromEntries(
      Object.entries(fileBindings).map(([name, binding]) => [
        name,
        { path: binding.path, sha256: binding.sha256 },
      ]),
    ),
  };

  try {
    await Promise.all([
      copyFile(sourcePaths.model, path.join(temporaryDirectory, 'model.int8.onnx')),
      copyFile(sourcePaths.phraseBank, path.join(temporaryDirectory, 'phrase-bank.jsonl')),
      copyFile(sourcePaths.metadata, path.join(temporaryDirectory, 'runtime-metadata.json')),
      copyFile(
        sourcePaths.runtime,
        path.join(temporaryDirectory, 'ort-wasm-simd-threaded.v2r.wasm'),
      ),
      writeFile(
        path.join(temporaryDirectory, 'manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx' },
      ),
    ]);
    await rename(temporaryDirectory, outputDirectory);
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
  return path.join(outputDirectory, 'manifest.json');
}

function readArchitecture(trainingReport: JsonRecord): {
  phraseBankSize: 8192 | 12288 | 16384;
  hiddenSize: 96 | 128;
  layers: 2 | 3;
} {
  const architecture = requireRecord(trainingReport.architecture, 'trainingReport.architecture');
  const phraseBankSize = requireInteger(architecture.phraseBankSize, 'phraseBankSize', 1);
  const hiddenSize = requireInteger(architecture.hiddenSize, 'hiddenSize', 1);
  const layers = requireInteger(architecture.layers, 'layers', 1);
  if (
    !ARCHITECTURE_MATRIX.has(`${phraseBankSize}:${hiddenSize}:${layers}`) ||
    architecture.attentionHeads !== 4 ||
    architecture.contextUtf8Bytes !== 192 ||
    architecture.contextPatchBytes !== 4
  ) {
    throw new Error('V2R candidate architecture is outside the frozen matrix.');
  }
  return {
    phraseBankSize: phraseBankSize as 8192 | 12288 | 16384,
    hiddenSize: hiddenSize as 96 | 128,
    layers: layers as 2 | 3,
  };
}

function assertCorpusBindings(
  selection: JsonRecord,
  sourceRegistry: readonly JsonRecord[],
  governance: JsonRecord,
  generator: JsonRecord,
  trainingInput: JsonRecord,
): void {
  const selectionWithoutIdentity = { ...selection };
  delete selectionWithoutIdentity.selectionSha256;
  const selectionSha256 = canonicalSha256(selectionWithoutIdentity);
  const inputTreeSha256 = calculateSelectionInputTree(selection);
  assertSourceRegistryIdentity(sourceRegistry, generator);
  if (
    selection.schema !== 'jotluck.autocomplete.v2r-corpus-selection.v1' ||
    selection.schemaVersion !== 1 ||
    selection.status !== 'complete' ||
    selection.selectionSha256 !== selectionSha256 ||
    canonicalSha256(selection.sources) !== canonicalSha256(sourceRegistry) ||
    generator.schema !== 'jotluck.autocomplete.v2r-generator-report.v1' ||
    generator.schemaVersion !== 1 ||
    generator.selectionSha256 !== selectionSha256 ||
    generator.inputTreeSha256 !== inputTreeSha256 ||
    generator.sourceTreeSha256 !== canonicalSha256(sourceRegistry) ||
    generator.governanceSha256 !== canonicalSha256(governance) ||
    generator.releaseEvidence !== true ||
    generator.holdoutScope !== 'validation-only-before-candidate-freeze-v1' ||
    typeof generator.holdoutTreeSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(generator.holdoutTreeSha256) ||
    generator.holdoutDocumentsAudited !== governance.holdoutDocumentsAudited ||
    typeof governance.holdoutDocumentsAudited !== 'number' ||
    !Number.isSafeInteger(governance.holdoutDocumentsAudited) ||
    governance.holdoutDocumentsAudited < 100 ||
    typeof governance.holdoutInputTreeSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(governance.holdoutInputTreeSha256) ||
    governance.selectionSha256 !== selectionSha256 ||
    governance.forbiddenTextMatches !== 0 ||
    governance.unapprovedLicenseSources !== 0 ||
    governance.isolatedNovelZhReferences !== 0 ||
    typeof governance.maxDocumentTrigramRatio !== 'number' ||
    !Number.isFinite(governance.maxDocumentTrigramRatio) ||
    governance.maxDocumentTrigramRatio > 0.08 ||
    trainingInput.schema !== 'jotluck.autocomplete.v2r-training-data.v3' ||
    trainingInput.schemaVersion !== 3 ||
    trainingInput.selectionSha256 !== selectionSha256 ||
    typeof trainingInput.maxPhraseDocumentRatio !== 'number' ||
    !Number.isFinite(trainingInput.maxPhraseDocumentRatio) ||
    trainingInput.maxPhraseDocumentRatio < 0 ||
    trainingInput.maxPhraseDocumentRatio > 1 ||
    typeof trainingInput.maxStructuralPhraseDocumentRatio !== 'number' ||
    !Number.isFinite(trainingInput.maxStructuralPhraseDocumentRatio) ||
    trainingInput.maxStructuralPhraseDocumentRatio < 0 ||
    trainingInput.maxStructuralPhraseDocumentRatio > 0.1
  ) {
    throw new Error('V2R corpus/training provenance bindings are inconsistent.');
  }
}

function calculateSelectionInputTree(selection: JsonRecord): string {
  if (!Array.isArray(selection.documents) || selection.documents.length === 0) {
    throw new Error('V2R corpus selection has no document identities.');
  }
  const identities = selection.documents.map((value, index) => {
    const document = requireRecord(value, `selection.documents[${index}]`);
    return {
      id: requireString(document.documentId, `selection.documents[${index}].documentId`),
      sha256: requireSha256(document.sha256, `selection.documents[${index}].sha256`),
    };
  });
  identities.sort((left, right) => left.id.localeCompare(right.id, 'en'));
  return canonicalSha256(identities);
}

function assertSourceRegistryIdentity(
  sourceRegistry: readonly JsonRecord[],
  generator: JsonRecord,
): void {
  if (sourceRegistry.length === 0) throw new Error('V2R source registry is empty.');
  let projectOwnedSources = 0;
  for (const [index, source] of sourceRegistry.entries()) {
    if (source.kind === 'project-owned') {
      projectOwnedSources++;
      if (
        source.licenseSpdx !== 'MIT' ||
        source.generatorVersion !== PROJECT_OWNED_GENERATOR_V3 ||
        source.generatorSeed !== PROJECT_OWNED_GENERATOR_V3_SEED
      ) {
        throw new Error(`V2R project-owned source ${index} has invalid generator provenance.`);
      }
    } else if (source.licenseSpdx !== 'CC0-1.0') {
      throw new Error(`V2R external source ${index} is not CC0-1.0.`);
    }
  }
  if (projectOwnedSources === 0)
    throw new Error('V2R source registry has no project-owned source.');
  if (
    generator.generatorVersion !== PROJECT_OWNED_GENERATOR_V3 ||
    generator.generatorSeed !== PROJECT_OWNED_GENERATOR_V3_SEED
  ) {
    throw new Error('V2R generator report does not match the frozen generator identity.');
  }
}

function assertTrainingBindings(
  trainingReport: JsonRecord,
  trainingInput: JsonRecord,
  phraseBank: FileBinding,
  quantizationReport: FileBinding,
  phraseBankSize: number,
): void {
  const inputWithoutIdentity = { ...trainingInput };
  delete inputWithoutIdentity.reportSha256;
  const trainingDataReportSha256 = canonicalSha256(inputWithoutIdentity);
  const quantization = requireRecord(
    trainingReport.quantizationReport,
    'trainingReport.quantizationReport',
  );
  const labelSemantics = requireRecord(
    trainingReport.labelSemantics,
    'trainingReport.labelSemantics',
  );
  if (
    trainingInput.reportSha256 !== trainingDataReportSha256 ||
    trainingReport.trainingDataReportSha256 !== trainingDataReportSha256 ||
    trainingInput.phraseBankSize !== phraseBankSize ||
    trainingInput.phraseBankSha256 !== phraseBank.sha256 ||
    trainingInput.phraseBankBytes !== phraseBank.bytes.byteLength ||
    labelSemantics.abstainClassWeight !== 1 ||
    labelSemantics.abstainReasonPolicy !== 'document-end-only-v1' ||
    labelSemantics.bankMissIsCoverageOnly !== true ||
    quantization.sha256 !== quantizationReport.sha256
  ) {
    throw new Error('V2R candidate training/quantization evidence is inconsistent.');
  }
  const samples = requireRecord(trainingInput.samples, 'trainingInput.samples');
  for (const split of ['train', 'development', 'internalSelection']) {
    const sample = requireRecord(samples[split], `trainingInput.samples.${split}`);
    const reasons = requireRecord(
      sample.abstainReasons,
      `trainingInput.samples.${split}.abstainReasons`,
    );
    if (reasons.bankMiss !== 0 || reasons.documentEnd !== sample.abstain) {
      throw new Error(`V2R ${split} contains non-silence abstain labels.`);
    }
  }
}

function assertRuntimeBindings(
  runtimeBuild: JsonRecord,
  model: FileBinding,
  operatorConfig: FileBinding,
  runtime: FileBinding,
): void {
  const withoutIdentity = { ...runtimeBuild };
  delete withoutIdentity.reportSha256;
  if (
    runtimeBuild.schema !== 'jotluck.autocomplete.v2r-runtime-build.v1' ||
    runtimeBuild.schemaVersion !== 1 ||
    runtimeBuild.reducedOperatorBuild !== true ||
    runtimeBuild.passed !== true ||
    runtimeBuild.modelSha256 !== model.sha256 ||
    runtimeBuild.operatorConfigSha256 !== operatorConfig.sha256 ||
    runtimeBuild.runtimeSha256 !== runtime.sha256 ||
    runtimeBuild.runtimeBytes !== runtime.bytes.byteLength ||
    runtimeBuild.reportSha256 !== canonicalSha256(withoutIdentity)
  ) {
    throw new Error('V2R reduced runtime evidence is inconsistent.');
  }
  if (
    runtime.bytes.byteLength < 8 ||
    runtime.bytes[0] !== 0x00 ||
    runtime.bytes[1] !== 0x61 ||
    runtime.bytes[2] !== 0x73 ||
    runtime.bytes[3] !== 0x6d
  ) {
    throw new Error('V2R reduced runtime is not WebAssembly.');
  }
}

function assertRuntimeMetadata(metadata: JsonRecord, phraseBankSize: number): void {
  const tokenizer = requireRecord(metadata.byteTokenizer, 'runtimeMetadata.byteTokenizer');
  if (
    metadata.schema !== 'jotluck.autocomplete.public-runtime-metadata.v1' ||
    metadata.schemaVersion !== 1 ||
    metadata.abstainIndex !== phraseBankSize ||
    tokenizer.sequenceLength !== 192 ||
    tokenizer.patchBytes !== 4 ||
    tokenizer.alignment !== 'right'
  ) {
    throw new Error('V2R runtime metadata is incompatible with the Worker contract.');
  }
}

function assertAssetIdentity(report: JsonRecord, binding: FileBinding, label: string): void {
  if (report.sha256 !== binding.sha256 || report.bytes !== binding.bytes.byteLength) {
    throw new Error(`V2R ${label} does not match its training report.`);
  }
}

function assertPhraseBank(bytes: Uint8Array, expectedEntries: number): void {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const entries = text.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (entries.length !== expectedEntries) {
    throw new Error('V2R phrase bank entry count does not match the architecture.');
  }
}

function assetBinding(
  role: 'model' | 'phrase-bank' | 'metadata' | 'runtime',
  fileName: string,
  source: FileBinding,
): { role: string; path: string; bytes: number; sha256: string } {
  // The runtime resolves packages/app/public/* relative to the manifest URL.
  // In this isolated build the URL lives in /autocomplete-v2r-evaluation/.
  return {
    role,
    path: `packages/app/public/${fileName}`,
    bytes: source.bytes.byteLength,
    sha256: source.sha256,
  };
}

async function runViteEvaluationBuild(workspaceRoot: string, distDir: string): Promise<void> {
  const appRoot = path.join(workspaceRoot, 'packages', 'app');
  const viteEntry = path.join(appRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  await runProcess(
    process.execPath,
    [
      viteEntry,
      'build',
      '--mode',
      'autocomplete-v2r-evaluation',
      '--outDir',
      distDir,
      '--emptyOutDir',
    ],
    {
      cwd: appRoot,
      env: {
        ...process.env,
        VITE_AUTOCOMPLETE_V2R_MANIFEST_URL: EVALUATION_MANIFEST_URL,
      },
    },
  );
}

async function runProcess(
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`V2R evaluation build failed (code=${code}, signal=${signal}).`));
    });
  });
}

async function readJsonBinding(
  filePath: string,
  workspaceRoot: string,
): Promise<FileBinding & { value: JsonRecord }> {
  const bytes = await readFile(filePath);
  return {
    path: repositoryRelative(filePath, workspaceRoot),
    bytes,
    sha256: sha256(bytes),
    value: parseJson(bytes, filePath),
  };
}

function parseJson(bytes: Uint8Array, label: string): JsonRecord {
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    return requireRecord(value, label);
  } catch (error) {
    throw new Error(`V2R ${label} is not valid UTF-8 JSON: ${String(error)}.`);
  }
}

function parseJsonArray(bytes: Uint8Array, label: string): JsonRecord[] {
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
    return value.map((item, index) => requireRecord(item, `${label}[${index}]`));
  } catch (error) {
    throw new Error(`V2R ${label} is not valid UTF-8 JSON: ${String(error)}.`);
  }
}

function requireRecord(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is invalid.`);
  return value;
}

function requireSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} is not a SHA-256 digest.`);
  }
  return value;
}

function requireInteger(value: unknown, label: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${label} must be an integer >= ${minimum}.`);
  }
  return value as number;
}

function requireCanonicalTimestamp(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`${label} must be a canonical ISO timestamp.`);
  }
  return value;
}

function resolveCachePath(workspaceRoot: string, value: string, label: string): string {
  const normalized = assertPathInsideV2RCache(
    normalizeRepositoryRelativePath(value.split(path.sep).join('/'), label),
    label,
  );
  return path.resolve(workspaceRoot, normalized);
}

function resolveRepositoryPath(workspaceRoot: string, value: string, label: string): string {
  const normalized = normalizeRepositoryRelativePath(value.split(path.sep).join('/'), label);
  const resolved = path.resolve(workspaceRoot, normalized);
  repositoryRelative(resolved, workspaceRoot);
  return resolved;
}

function repositoryRelative(filePath: string, workspaceRoot: string): string {
  const relative = path.relative(workspaceRoot, filePath).split(path.sep).join('/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new Error('V2R path escaped the repository.');
  }
  return normalizeRepositoryRelativePath(relative, 'repository path');
}

async function assertMissing(filePath: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    return;
  }
  throw new Error('V2R evaluation bundle already exists and cannot be overwritten.');
}

function parseArguments(argv: readonly string[]): EvaluationBundleOptions {
  const options: Partial<EvaluationBundleOptions> = {};
  for (const argument of argv) {
    if (argument.startsWith('--workspace-root=')) {
      options.workspaceRoot = argument.slice('--workspace-root='.length);
    } else if (argument.startsWith('--candidate-dir=')) {
      options.candidateDir = argument.slice('--candidate-dir='.length);
    } else if (argument.startsWith('--dist-dir=')) {
      options.distDir = argument.slice('--dist-dir='.length);
    } else if (argument === '--skip-app-build') options.buildApp = false;
    else throw new Error(`Unknown V2R evaluation-bundle argument: ${argument}`);
  }
  if (!options.candidateDir) throw new Error('--candidate-dir is required.');
  return options as EvaluationBundleOptions;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildAutocompleteV2REvaluationBundle(parseArguments(process.argv.slice(2)))
    .then((manifestPath) => console.log(manifestPath))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    });
}
