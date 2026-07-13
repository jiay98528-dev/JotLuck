import { spawn } from 'node:child_process';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalSha256, sha256, V2R_REPOSITORY_ROOT } from './autocomplete-v2r/index';

const CONFIG_PATH = 'scripts/corpus/autocomplete-v2r-external.json';
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;

interface CollectOptions {
  workspaceRoot?: string;
  download?: boolean;
}

interface SourceConfig {
  downloadUrl: string;
  rawCachePath: string;
  rawBytes: number;
  rawSha256: string;
  cleanedCachePath: string;
  cleanedBytes: number;
  cleanedSha256: string;
  cleaningReportPath: string;
}

export async function collectAutocompleteV2RExternal(
  options: CollectOptions = {},
): Promise<{ rawSha256: string; cleanedSha256: string; cleanedBytes: number }> {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? V2R_REPOSITORY_ROOT);
  const registry = JSON.parse(await readFile(path.join(workspaceRoot, CONFIG_PATH), 'utf8')) as {
    schema?: unknown;
    schemaVersion?: unknown;
    sources?: SourceConfig[];
  };
  if (
    registry.schema !== 'jotluck.autocomplete.v2r-external-sources.v1' ||
    registry.schemaVersion !== 1 ||
    registry.sources?.length !== 1
  ) {
    throw new Error('V2R external source registry is invalid.');
  }
  const source = registry.sources[0]!;
  const rawPath = resolveRepositoryPath(workspaceRoot, source.rawCachePath, 'rawCachePath');
  const cleanedPath = resolveRepositoryPath(
    workspaceRoot,
    source.cleanedCachePath,
    'cleanedCachePath',
  );
  if (options.download) {
    const response = await fetch(source.downloadUrl, { redirect: 'follow' });
    if (!response.ok || !response.body) {
      throw new Error(`Tatoeba download failed with HTTP ${response.status}.`);
    }
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
      throw new Error('Tatoeba download exceeds its byte limit.');
    }
    const bytes = await readBoundedResponse(response, MAX_DOWNLOAD_BYTES);
    assertIdentity(bytes, source.rawBytes, source.rawSha256, 'downloaded Tatoeba export');
    await writeAtomic(rawPath, bytes);
  } else {
    await access(rawPath);
  }
  const raw = await readFile(rawPath);
  assertIdentity(raw, source.rawBytes, source.rawSha256, 'cached Tatoeba export');

  const cacheRoot = path.join(workspaceRoot, 'scripts/corpus/_web-cache/autocomplete-v2r');
  const venvPython = path.join(cacheRoot, '.venv', 'Scripts', 'python.exe');
  await access(venvPython);
  const temporaryReport = path.join(path.dirname(cleanedPath), 'cleaning-report.generated.json');
  await runProcess(
    venvPython,
    [
      path.join(workspaceRoot, 'scripts/autocomplete-v2r/clean_tatoeba_cc0.py'),
      '--input',
      rawPath,
      '--output',
      cleanedPath,
      '--report',
      temporaryReport,
      '--expected-sha256',
      source.rawSha256,
    ],
    workspaceRoot,
  );
  const cleaned = await readFile(cleanedPath);
  assertIdentity(cleaned, source.cleanedBytes, source.cleanedSha256, 'cleaned Tatoeba cache');
  const expectedReport = await readFile(path.join(workspaceRoot, source.cleaningReportPath));
  const actualReport = await readFile(temporaryReport);
  if (
    canonicalSha256(JSON.parse(expectedReport.toString('utf8'))) !==
    canonicalSha256(JSON.parse(actualReport.toString('utf8')))
  ) {
    throw new Error('Generated Tatoeba cleaning report differs from the pinned report.');
  }
  return {
    rawSha256: sha256(raw),
    cleanedSha256: sha256(cleaned),
    cleanedBytes: cleaned.byteLength,
  };
}

async function readBoundedResponse(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel('byte-limit');
        throw new Error('Tatoeba download exceeds its byte limit.');
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function assertIdentity(
  bytes: Uint8Array,
  expectedBytes: number,
  expectedSha256: string,
  label: string,
): void {
  if (bytes.byteLength !== expectedBytes || sha256(bytes) !== expectedSha256) {
    throw new Error(`${label} identity is invalid.`);
  }
}

function resolveRepositoryPath(workspaceRoot: string, value: string, label: string): string {
  if (!value || path.isAbsolute(value) || value.split(/[\\/]/u).includes('..')) {
    throw new Error(`${label} must be repository-relative.`);
  }
  const result = path.resolve(workspaceRoot, ...value.split('/'));
  const relative = path.relative(workspaceRoot, result);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} escaped the repository.`);
  }
  return result;
}

async function writeAtomic(filePath: string, bytes: Uint8Array): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, filePath);
}

async function runProcess(
  command: string,
  argumentsList: readonly string[],
  cwd: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, argumentsList, { cwd, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code} and signal ${signal ?? 'none'}.`));
    });
  });
}

function parseArguments(argv: readonly string[]): CollectOptions {
  const options: CollectOptions = {};
  for (const argument of argv) {
    if (argument === '--download') options.download = true;
    else if (argument.startsWith('--workspace-root=')) {
      options.workspaceRoot = argument.slice('--workspace-root='.length);
    } else throw new Error(`Unknown V2R external collection argument: ${argument}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  collectAutocompleteV2RExternal(parseArguments(process.argv.slice(2)))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    });
}
