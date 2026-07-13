import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const V2R_CACHE_RELATIVE_ROOT = 'scripts/corpus/_web-cache/autocomplete-v2r';
export const V2R_REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

export function resolveV2RCacheRoot(workspaceRoot: string = V2R_REPOSITORY_ROOT): string {
  if (!path.isAbsolute(workspaceRoot)) throw new Error('workspaceRoot must be absolute.');
  return path.resolve(workspaceRoot, V2R_CACHE_RELATIVE_ROOT);
}

export function normalizeRepositoryRelativePath(value: string, label = 'path'): string {
  if (!value || value.includes('\\') || path.isAbsolute(value) || /^[A-Za-z]:/u.test(value)) {
    throw new Error(`${label} must be a non-empty repository-relative POSIX path.`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`${label} escapes its allowed repository root.`);
  }
  return normalized;
}

export function assertPathInsideV2RCache(value: string, label = 'path'): string {
  const normalized = normalizeRepositoryRelativePath(value, label);
  if (
    normalized !== V2R_CACHE_RELATIVE_ROOT &&
    !normalized.startsWith(`${V2R_CACHE_RELATIVE_ROOT}/`)
  ) {
    throw new Error(`${label} must stay inside ${V2R_CACHE_RELATIVE_ROOT}.`);
  }
  if (normalized.split('/').some((segment) => segment.toLocaleLowerCase('en-US') === 'novel-zh')) {
    throw new Error(`${label} must not reference the isolated novel-zh corpus.`);
  }
  return normalized;
}
