import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROJECT_OWNED_GENERATOR_V3,
  PROJECT_OWNED_GENERATOR_V3_SEED,
  V2R_DEFAULT_SPLIT_BUDGETS,
  V2R_REPOSITORY_ROOT,
  buildProjectOwnedSourceRegistryV3,
  buildTatoebaCc0Source,
  canonicalSha256,
  generateProjectOwnedDocumentsV3,
  loadOptionalTatoebaCc0Corpus,
  normalizeForComparison,
  normalizeRepositoryRelativePath,
  resolveV2RCacheRoot,
  selectV2RCorpus,
  validateV2RHoldoutV3,
  validateV2RCorpusSelection,
  type GeneratedProjectOwnedDocumentV3,
  type V2RCorpusCandidate,
  type V2RHoldoutClassification,
  type V2RHoldoutV3,
} from './autocomplete-v2r/index';

const CREATED_AT = '2026-07-12T18:00:00.000Z';
const DATASET_ID = 'jotluck-autocomplete-v2r-clean-v1';
const SELECTION_SEED = 'jotluck-autocomplete-v2r-selection-2026-07-12';
const ESTIMATE_DOCUMENTS_PER_SOURCE = 500;
const DEFAULT_VALIDATION_HOLDOUT_PATHS = [
  'scripts/corpus/autocomplete-v2r-holdouts/cold-validation-v3.json',
  'scripts/corpus/autocomplete-v2r-holdouts/workspace-validation-v3.json',
] as const;

export interface MaterializeV2RCorpusOptions {
  workspaceRoot?: string;
  documentsPerSource?: number;
  dryRun?: boolean;
  holdoutPaths?: readonly string[];
  diagnosticWithoutHoldouts?: boolean;
}

export interface MaterializeV2RCorpusResult {
  workspaceRoot: string;
  cacheRoot: string;
  documentsPerSource: number;
  generatedDocuments: number;
  externalDocuments: number;
  duplicateDocumentsDropped: number;
  selectedDocuments: number;
  selectedBytes: typeof V2R_DEFAULT_SPLIT_BUDGETS;
  selectionSha256: string;
  inputTreeSha256: string;
  holdoutTreeSha256: string | null;
  holdoutDocumentsAudited: number;
  maxTemplateRatio: number;
  maxFiveGramRatio: number;
  maxDocumentTrigramRatio: number;
  manifestPath: string;
  sourceRegistryPath: string;
  governancePath: string;
  reportPath: string;
  dryRun: boolean;
}

export async function materializeAutocompleteV2RCorpus(
  options: MaterializeV2RCorpusOptions = {},
): Promise<MaterializeV2RCorpusResult> {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? V2R_REPOSITORY_ROOT);
  const cacheRoot = resolveV2RCacheRoot(workspaceRoot);
  const holdoutEvidence = options.diagnosticWithoutHoldouts
    ? null
    : await loadFrozenHoldoutEvidence(
        workspaceRoot,
        options.holdoutPaths ?? DEFAULT_VALIDATION_HOLDOUT_PATHS,
      );
  const documentsPerSource =
    options.documentsPerSource ?? estimateDocumentsPerSource(V2R_DEFAULT_SPLIT_BUDGETS);
  if (!Number.isSafeInteger(documentsPerSource) || documentsPerSource < 1) {
    throw new Error('documentsPerSource must be a positive safe integer.');
  }

  const generatedProjectRaw = generateProjectOwnedDocumentsV3(
    documentsPerSource,
    PROJECT_OWNED_GENERATOR_V3_SEED,
  );
  const external = await loadOptionalTatoebaCc0Corpus(workspaceRoot);
  const generatedRaw: Array<GeneratedProjectOwnedDocumentV3 | V2RCorpusCandidate> = [
    ...generatedProjectRaw,
    ...(external?.documents ?? []),
  ];
  const generated = deduplicateGeneratedDocuments(generatedRaw);
  const generatedProject = generated.filter(isProjectOwnedDocument);
  const provisionalSources = [
    ...buildProjectOwnedSourceRegistryV3(
      generatedProject,
      CREATED_AT,
      PROJECT_OWNED_GENERATOR_V3_SEED,
    ),
    ...(external ? [buildTatoebaCc0Source(external, generated)] : []),
  ];
  const selectionOptions = {
    datasetId: DATASET_ID,
    createdAt: CREATED_AT,
    selectionSeed: SELECTION_SEED,
    targetBytes: { ...V2R_DEFAULT_SPLIT_BUDGETS },
  };
  const provisional = selectV2RCorpus(generated, provisionalSources, selectionOptions);
  if (provisional.status !== 'complete') {
    throw new Error(
      `Generated project-owned pool is too small (${documentsPerSource} documents/source).`,
    );
  }
  const selectedIds = new Set(provisional.documents.map((document) => document.documentId));
  const selected = generated.filter((document) => selectedIds.has(document.documentId));
  const finalSources = [
    ...buildProjectOwnedSourceRegistryV3(
      selected.filter(isProjectOwnedDocument),
      CREATED_AT,
      PROJECT_OWNED_GENERATOR_V3_SEED,
    ),
    ...(external ? [buildTatoebaCc0Source(external, selected)] : []),
  ];
  const manifest = selectV2RCorpus(generated, finalSources, selectionOptions);
  const finalSelectedIds = new Set(manifest.documents.map((document) => document.documentId));
  const materialized = generated.filter((document) => finalSelectedIds.has(document.documentId));
  const governance = validateV2RCorpusSelection(
    manifest,
    materialized,
    holdoutEvidence?.documents ?? [],
    {
      requireComplete: true,
      enforceQuotas: true,
    },
  );
  const inputTreeSha256 = canonicalSha256(
    manifest.documents
      .map((document) => ({ id: document.documentId, sha256: document.sha256 }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
  const manifestPath = path.join(cacheRoot, 'selection-manifest.json');
  const sourceRegistryPath = path.join(cacheRoot, 'source-registry.json');
  const governancePath = path.join(cacheRoot, 'governance-report.json');
  const reportPath = path.join(cacheRoot, 'generator-report.json');
  const report = {
    schema: 'jotluck.autocomplete.v2r-generator-report.v1',
    schemaVersion: 1,
    datasetId: DATASET_ID,
    generatorVersion: PROJECT_OWNED_GENERATOR_V3,
    generatorSeed: PROJECT_OWNED_GENERATOR_V3_SEED,
    createdAt: CREATED_AT,
    documentsPerSource,
    generatedDocuments: generated.length,
    externalDocuments: external?.documents.length ?? 0,
    duplicateDocumentsDropped: generatedRaw.length - generated.length,
    selectedDocuments: materialized.length,
    selectedBytes: manifest.selectedBytes,
    selectionSha256: manifest.selectionSha256,
    inputTreeSha256,
    sourceTreeSha256: canonicalSha256(manifest.sources),
    governanceSha256: canonicalSha256(governance),
    holdoutTreeSha256: holdoutEvidence?.treeSha256 ?? null,
    holdoutScope: holdoutEvidence ? 'validation-only-before-candidate-freeze-v1' : null,
    holdoutDocumentsAudited: governance.holdoutDocumentsAudited,
    releaseEvidence: holdoutEvidence !== null,
    externalCleaningReportSha256: external?.cleaningReportSha256 ?? null,
  };

  if (!options.dryRun) {
    await materializeDocuments(workspaceRoot, materialized);
    await writeJsonAtomic(manifestPath, manifest);
    await writeJsonAtomic(sourceRegistryPath, manifest.sources);
    await writeJsonAtomic(governancePath, governance);
    await writeJsonAtomic(reportPath, report);
  }

  return {
    workspaceRoot,
    cacheRoot,
    documentsPerSource,
    generatedDocuments: generated.length,
    externalDocuments: external?.documents.length ?? 0,
    duplicateDocumentsDropped: generatedRaw.length - generated.length,
    selectedDocuments: materialized.length,
    selectedBytes: manifest.selectedBytes,
    selectionSha256: manifest.selectionSha256,
    inputTreeSha256,
    holdoutTreeSha256: holdoutEvidence?.treeSha256 ?? null,
    holdoutDocumentsAudited: governance.holdoutDocumentsAudited,
    maxTemplateRatio: governance.maxTemplateRatio,
    maxFiveGramRatio: governance.maxFiveGramRatio,
    maxDocumentTrigramRatio: governance.maxDocumentTrigramRatio,
    manifestPath,
    sourceRegistryPath,
    governancePath,
    reportPath,
    dryRun: options.dryRun ?? false,
  };
}

export function deduplicateGeneratedDocuments(
  documents: readonly GeneratedProjectOwnedDocumentV3[],
): GeneratedProjectOwnedDocumentV3[];
export function deduplicateGeneratedDocuments<T extends V2RCorpusCandidate>(
  documents: readonly T[],
): T[];
export function deduplicateGeneratedDocuments<T extends V2RCorpusCandidate>(
  documents: readonly T[],
): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const document of documents) {
    const normalizedSha256 = canonicalSha256(normalizeForComparison(document.text));
    if (seen.has(normalizedSha256)) continue;
    seen.add(normalizedSha256);
    output.push(document);
  }
  return output;
}

export function estimateDocumentsPerSource(
  targetBytes: typeof V2R_DEFAULT_SPLIT_BUDGETS = V2R_DEFAULT_SPLIT_BUDGETS,
): number {
  const sample = generateProjectOwnedDocumentsV3(ESTIMATE_DOCUMENTS_PER_SOURCE);
  const averageBytes =
    sample.reduce((total, document) => total + document.bytes, 0) / sample.length;
  const totalTarget = Object.values(targetBytes).reduce((total, value) => total + value, 0);
  // Selection assigns whole documents and hashes them into 80/10/10 buckets.
  // A deterministic 12% reserve keeps every split fillable without changing
  // the selected membership when the command is repeated.
  return Math.ceil((totalTarget / averageBytes / 10) * 1.12);
}

async function materializeDocuments(
  workspaceRoot: string,
  documents: readonly V2RCorpusCandidate[],
): Promise<void> {
  const batchSize = 128;
  for (let offset = 0; offset < documents.length; offset += batchSize) {
    await Promise.all(
      documents.slice(offset, offset + batchSize).map(async (document) => {
        const absolutePath = path.resolve(workspaceRoot, ...document.relativePath.split('/'));
        assertInsideWorkspaceCache(absolutePath, workspaceRoot);
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeIfChanged(absolutePath, document.text);
      }),
    );
  }
}

function isProjectOwnedDocument(
  document: V2RCorpusCandidate,
): document is GeneratedProjectOwnedDocumentV3 {
  return (
    'generatorVersion' in document &&
    document.generatorVersion === PROJECT_OWNED_GENERATOR_V3 &&
    'generatorSeed' in document &&
    document.generatorSeed === PROJECT_OWNED_GENERATOR_V3_SEED
  );
}

async function loadFrozenHoldoutEvidence(
  workspaceRoot: string,
  relativePaths: readonly string[],
): Promise<{
  treeSha256: string;
  documents: Array<{ id: string; text: string }>;
}> {
  if (relativePaths.length !== DEFAULT_VALIDATION_HOLDOUT_PATHS.length) {
    throw new Error(
      'V2R pre-training corpus governance requires both frozen validation v3 holdouts.',
    );
  }
  const expected = new Set<V2RHoldoutClassification>([
    'cold-validation-v3',
    'workspace-validation-v3',
  ]);
  const identities: Array<{
    classification: V2RHoldoutClassification;
    datasetSha256: string;
  }> = [];
  const documents: Array<{ id: string; text: string }> = [];
  for (const relativePath of relativePaths) {
    const normalized = normalizeRepositoryRelativePath(relativePath, 'V2R holdout path');
    const absolutePath = path.resolve(workspaceRoot, ...normalized.split('/'));
    if (path.relative(workspaceRoot, absolutePath).startsWith('..')) {
      throw new Error(`V2R holdout path escaped the workspace: ${relativePath}.`);
    }
    let holdout: V2RHoldoutV3;
    try {
      holdout = JSON.parse(await readFile(absolutePath, 'utf8')) as V2RHoldoutV3;
    } catch (error) {
      throw new Error(
        `Frozen V2R holdout is missing or invalid: ${relativePath}. ${String(error)}`,
      );
    }
    const audit = validateV2RHoldoutV3(holdout);
    if (!expected.delete(holdout.classification)) {
      throw new Error(
        `Duplicate or unexpected V2R holdout classification: ${holdout.classification}.`,
      );
    }
    identities.push({
      classification: holdout.classification,
      datasetSha256: audit.datasetSha256,
    });
    for (const target of holdout.targets) {
      documents.push({
        id: `${holdout.classification}:target:${target.id}`,
        text: target.text,
      });
    }
    for (const support of holdout.supportDocuments) {
      documents.push({
        id: `${holdout.classification}:support:${support.id}`,
        text: support.text,
      });
    }
  }
  if (expected.size !== 0) {
    throw new Error(`V2R corpus governance is missing holdouts: ${[...expected].join(', ')}.`);
  }
  return {
    treeSha256: canonicalSha256(
      identities.sort((left, right) => left.classification.localeCompare(right.classification)),
    ),
    documents,
  };
}

async function writeIfChanged(filePath: string, content: string): Promise<void> {
  try {
    if ((await readFile(filePath, 'utf8')) === content) return;
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
  await writeFile(filePath, content, 'utf8');
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, filePath);
}

function assertInsideWorkspaceCache(filePath: string, workspaceRoot: string): void {
  const cacheRoot = `${resolveV2RCacheRoot(workspaceRoot)}${path.sep}`.toLocaleLowerCase('en-US');
  if (!filePath.toLocaleLowerCase('en-US').startsWith(cacheRoot)) {
    throw new Error('Generated document path escaped the V2R cache root.');
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function parseCliArguments(argv: readonly string[]): MaterializeV2RCorpusOptions {
  const options: MaterializeV2RCorpusOptions = {};
  for (const argument of argv) {
    if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--diagnostic-without-holdouts') {
      options.diagnosticWithoutHoldouts = true;
    } else if (argument.startsWith('--documents-per-source=')) {
      options.documentsPerSource = Number(argument.slice('--documents-per-source='.length));
    } else if (argument.startsWith('--workspace-root=')) {
      options.workspaceRoot = argument.slice('--workspace-root='.length);
    } else {
      throw new Error(`Unknown V2R corpus argument: ${argument}`);
    }
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  materializeAutocompleteV2RCorpus(parseCliArguments(process.argv.slice(2)))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    });
}
