import { link, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalSha256, sha256, V2R_REPOSITORY_ROOT } from './autocomplete-v2r/index';

const STATIC_DELTA_LIMIT_BYTES = 12 * 1024 * 1024;

interface MeasureOptions {
  workspaceRoot?: string;
  candidateDir: string;
  distDir?: string;
  outputPath?: string;
}

export async function measureAutocompleteV2RBundle(options: MeasureOptions): Promise<string> {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? V2R_REPOSITORY_ROOT);
  const candidateDir = resolveRepositoryPath(workspaceRoot, options.candidateDir, 'candidateDir');
  const distDir = resolveRepositoryPath(
    workspaceRoot,
    options.distDir ?? 'packages/app/dist',
    'distDir',
  );
  const trainingReport = JSON.parse(
    await readFile(path.join(candidateDir, 'training-report.json'), 'utf8'),
  ) as {
    schema?: string;
    candidateEligible?: boolean;
    assets?: {
      int8?: { sha256?: string };
      phraseBank?: { path?: string; sha256?: string };
      metadata?: { sha256?: string };
    };
  };
  if (
    trainingReport.schema !== 'jotluck.autocomplete.v2r-training-report.v1' ||
    trainingReport.candidateEligible !== true ||
    typeof trainingReport.assets?.phraseBank?.path !== 'string'
  ) {
    throw new Error('V2R bundle measurement requires an eligible frozen candidate.');
  }
  const assetPaths = {
    model: path.join(candidateDir, 'model.int8.onnx'),
    phraseBank: resolveRepositoryPath(
      workspaceRoot,
      trainingReport.assets.phraseBank.path,
      'phraseBank',
    ),
    metadata: path.join(candidateDir, 'runtime-metadata.json'),
    runtime: path.join(candidateDir, 'ort-wasm-simd-threaded.reduced.wasm'),
  };
  const assetEntries = await Promise.all(
    Object.entries(assetPaths).map(async ([name, filePath]) => {
      const bytes = await readFile(filePath);
      return [name, { bytes, sha256: sha256(bytes) }] as const;
    }),
  );
  const assets = Object.fromEntries(assetEntries) as Record<
    keyof typeof assetPaths,
    { bytes: Buffer; sha256: string }
  >;
  if (
    trainingReport.assets.int8?.sha256 !== assets.model.sha256 ||
    trainingReport.assets.phraseBank.sha256 !== assets.phraseBank.sha256 ||
    trainingReport.assets.metadata?.sha256 !== assets.metadata.sha256
  ) {
    throw new Error('V2R candidate assets changed before bundle measurement.');
  }

  const distFiles = await listFiles(distDir);
  const measuredFiles = await Promise.all(
    distFiles.map(async (filePath) => {
      const bytes = await readFile(filePath);
      return {
        path: repositoryRelative(filePath, workspaceRoot),
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
        extension: path.extname(filePath).toLocaleLowerCase('en-US'),
      };
    }),
  );
  measuredFiles.sort((left, right) => left.path.localeCompare(right.path));
  const entireAppJavaScriptBytes = measuredFiles
    .filter((file) => file.extension === '.js' || file.extension === '.mjs')
    .reduce((sum, file) => sum + file.bytes, 0);
  const candidateAssetBytes = Object.values(assets).reduce(
    (sum, asset) => sum + asset.bytes.byteLength,
    0,
  );
  const countCopies = (digest: string): number =>
    measuredFiles.filter((file) => file.sha256 === digest).length;
  const candidateRuntimeCopies = countCopies(assets.runtime.sha256);
  const candidateModelCopies = countCopies(assets.model.sha256);
  const candidatePhraseBankCopies = countCopies(assets.phraseBank.sha256);
  const candidateMetadataCopies = countCopies(assets.metadata.sha256);
  const stockWasmAssets = measuredFiles.filter(
    (file) => file.extension === '.wasm' && file.sha256 !== assets.runtime.sha256,
  ).length;
  const conservativeStaticDeltaUpperBoundBytes = candidateAssetBytes + entireAppJavaScriptBytes;
  const passed =
    candidateRuntimeCopies === 1 &&
    candidateModelCopies === 1 &&
    candidatePhraseBankCopies === 1 &&
    candidateMetadataCopies === 1 &&
    stockWasmAssets === 0 &&
    conservativeStaticDeltaUpperBoundBytes <= STATIC_DELTA_LIMIT_BYTES;
  const withoutIdentity = {
    schema: 'jotluck.autocomplete.v2r-bundle-size.v1',
    schemaVersion: 1,
    measurementMethod: 'candidate-assets-plus-entire-app-js-upper-bound',
    modelSha256: assets.model.sha256,
    phraseBankSha256: assets.phraseBank.sha256,
    metadataSha256: assets.metadata.sha256,
    runtimeSha256: assets.runtime.sha256,
    candidateAssetBytes,
    entireAppJavaScriptBytes,
    conservativeStaticDeltaUpperBoundBytes,
    staticDeltaLimitBytes: STATIC_DELTA_LIMIT_BYTES,
    candidateRuntimeCopies,
    candidateModelCopies,
    candidatePhraseBankCopies,
    candidateMetadataCopies,
    stockWasmAssets,
    distJavaScriptTreeSha256: canonicalSha256(
      measuredFiles
        .filter((file) => file.extension === '.js' || file.extension === '.mjs')
        .map(({ path: filePath, bytes, sha256: digest }) => ({
          path: filePath,
          bytes,
          sha256: digest,
        })),
    ),
    passed,
  };
  const report = { ...withoutIdentity, reportSha256: canonicalSha256(withoutIdentity) };
  const outputPath = resolveRepositoryPath(
    workspaceRoot,
    options.outputPath ??
      repositoryRelative(path.join(candidateDir, 'bundle-size-report.json'), workspaceRoot),
    'outputPath',
  );
  await writeJsonAtomic(outputPath, report);
  if (!passed) {
    throw new Error(
      `V2R production bundle failed: upperBound=${conservativeStaticDeltaUpperBoundBytes}, stockWasm=${stockWasmAssets}, copies=${candidateModelCopies}/${candidatePhraseBankCopies}/${candidateMetadataCopies}/${candidateRuntimeCopies}.`,
    );
  }
  return outputPath;
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
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

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  try {
    const existing = await readFile(filePath, 'utf8');
    if (existing === serialized) return;
    throw new Error('V2R bundle-size evidence already exists with different content.');
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, serialized, { encoding: 'utf8', flag: 'wx' });
  try {
    // A same-directory hard link publishes the complete file without the
    // overwrite semantics of rename(2). Evidence is immutable once visible.
    await link(temporaryPath, filePath);
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    const existing = await readFile(filePath, 'utf8');
    if (existing !== serialized) {
      throw new Error('V2R bundle-size evidence raced with different content.');
    }
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

function isAlreadyExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'EEXIST';
}

function parseArguments(argv: readonly string[]): MeasureOptions {
  const options: Partial<MeasureOptions> = {};
  for (const argument of argv) {
    if (argument.startsWith('--workspace-root=')) {
      options.workspaceRoot = argument.slice('--workspace-root='.length);
    } else if (argument.startsWith('--candidate-dir=')) {
      options.candidateDir = argument.slice('--candidate-dir='.length);
    } else if (argument.startsWith('--dist-dir=')) {
      options.distDir = argument.slice('--dist-dir='.length);
    } else if (argument.startsWith('--output-path=')) {
      options.outputPath = argument.slice('--output-path='.length);
    } else throw new Error(`Unknown V2R bundle-measurement argument: ${argument}`);
  }
  if (!options.candidateDir) throw new Error('--candidate-dir is required.');
  return options as MeasureOptions;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  measureAutocompleteV2RBundle(parseArguments(process.argv.slice(2)))
    .then((filePath) => console.log(filePath))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    });
}
