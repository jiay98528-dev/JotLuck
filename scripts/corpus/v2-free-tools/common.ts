import { createHash } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import * as path from 'node:path';

export type Sha256 = string;

// Unicode White_Space (PropList.txt) plus U+FEFF, which ECMAScript also
// treats as whitespace. Keeping the set explicit avoids Python/JavaScript
// `\s` disagreements for U+0085 and embedded BOMs.
const V2_FREE_CANONICAL_WHITESPACE =
  /[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+/gu;

export function collapseV2FreeCanonicalWhitespace(value: string): string {
  return value.replace(V2_FREE_CANONICAL_WHITESPACE, ' ').trim();
}

export function normalizeV2FreeTextIdentity(value: string): string {
  return collapseV2FreeCanonicalWhitespace(value.normalize('NFKC').toLocaleLowerCase('en-US'));
}

export function sha256(value: Uint8Array | string): Sha256 {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

export function canonicalSha256(value: unknown): Sha256 {
  return sha256(canonicalJson(value));
}

export function isSha256(value: unknown): value is Sha256 {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

export function assertSafeIdentifier(value: string, label: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(value)) {
    throw new Error(`${label} is not a safe identifier.`);
  }
}

export function normalizeRepositoryPath(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  if (
    !normalized ||
    path.posix.isAbsolute(normalized) ||
    normalized.split('/').some((segment) => !segment || segment === '..')
  ) {
    throw new Error('Repository path is unsafe.');
  }
  return normalized;
}

export async function resolveWorkspaceInput(workspaceRoot: string, value: string): Promise<string> {
  const root = await realpath(path.resolve(workspaceRoot));
  const relative = normalizeRepositoryPath(value);
  const resolved = await realpath(path.join(root, relative));
  if (!isWithin(resolved, root)) throw new Error('Input escaped the workspace.');
  return resolved;
}

export async function resolveCorpusOutput(workspaceRoot: string, value: string): Promise<string> {
  const root = await realpath(path.resolve(workspaceRoot));
  const relative = normalizeRepositoryPath(value);
  if (relative !== 'scripts/corpus' && !relative.startsWith('scripts/corpus/')) {
    throw new Error('Output must remain under scripts/corpus/.');
  }
  const resolved = path.resolve(root, relative);
  if (!isWithin(resolved, root)) throw new Error('Output escaped the workspace.');
  return resolved;
}

export function workspaceRelative(workspaceRoot: string, value: string): string {
  return path.relative(path.resolve(workspaceRoot), value).replaceAll('\\', '/');
}

export async function readPinnedFile(
  workspaceRoot: string,
  descriptor: { path: string; bytes: number; sha256: Sha256 },
  label: string,
): Promise<{ path: string; bytes: Buffer }> {
  if (!Number.isSafeInteger(descriptor.bytes) || descriptor.bytes < 1) {
    throw new Error(`${label} byte count is invalid.`);
  }
  if (!isSha256(descriptor.sha256)) throw new Error(`${label} SHA-256 is invalid.`);
  const resolved = await resolveWorkspaceInput(workspaceRoot, descriptor.path);
  const bytes = await readFile(resolved);
  if (bytes.byteLength !== descriptor.bytes || sha256(bytes) !== descriptor.sha256) {
    throw new Error(`${label} byte identity is invalid.`);
  }
  return { path: resolved, bytes };
}

export async function writeExclusiveJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const handle = await open(filePath, 'wx');
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeExclusiveBytes(filePath: string, value: Uint8Array): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const handle = await open(filePath, 'wx');
  try {
    await handle.writeFile(value);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function publishStagedDirectory(
  stagingPath: string,
  targetPath: string,
): Promise<void> {
  try {
    await rename(stagingPath, targetPath);
  } catch (error) {
    await safeRemoveStagingDirectory(stagingPath);
    throw error;
  }
}

export async function safeRemoveStagingDirectory(stagingPath: string): Promise<void> {
  const name = path.basename(stagingPath);
  if (!name.startsWith('.staging-') || stagingPath.length < 20) {
    throw new Error('Refusing to remove a non-staging directory.');
  }
  await rm(stagingPath, { recursive: true, force: true });
}

export function isWithin(value: string, root: string): boolean {
  const relative = path.relative(root, value);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8: ${String(error)}`);
  }
}
