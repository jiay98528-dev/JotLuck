import { createHash } from 'node:crypto';
import * as path from 'node:path';

export const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
export const V2S_ENGINE_ID = 'public-v2s-mkn-v1';

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function canonicalSha256(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function assertPlainObject(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

export function assertSafeInteger(
  value: unknown,
  label: string,
  options: { min?: number; max?: number } = {},
): asserts value is number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer.`);
  if (options.min !== undefined && (value as number) < options.min) {
    throw new Error(`${label} must be at least ${options.min}.`);
  }
  if (options.max !== undefined && (value as number) > options.max) {
    throw new Error(`${label} must be at most ${options.max}.`);
  }
}

export function assertSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
}

export function normalizeRelativePath(value: string, label: string): string {
  const normalized = value.replaceAll('\\', '/');
  if (
    normalized.length === 0 ||
    path.posix.isAbsolute(normalized) ||
    /^[a-z]:/iu.test(normalized) ||
    normalized.split('/').some((part) => part === '..')
  ) {
    throw new Error(`${label} must be a repository-relative path without traversal.`);
  }
  return normalized.replace(/^\.\//u, '');
}

export function resolveInside(root: string, relativePath: string, label: string): string {
  const normalized = normalizeRelativePath(relativePath, label);
  const absoluteRoot = path.resolve(root);
  const resolved = path.resolve(absoluteRoot, ...normalized.split('/'));
  const relative = path.relative(absoluteRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes the workspace root.`);
  }
  return resolved;
}

export function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function normalizeForComparison(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en-US');
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort(compareStrings)) {
      output[key] = sortJson((value as Record<string, unknown>)[key]);
    }
    return output;
  }
  return value;
}
