import * as fs from 'node:fs';
import * as path from 'node:path';

function assertLexicallyWithin(rootDir: string, value: string): { root: string; resolved: string } {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, value);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes the workspace: ${value}.`);
  }
  return { root, resolved };
}

function assertRealPathWithin(
  rootRealPath: string,
  candidateRealPath: string,
  value: string,
): void {
  const relative = path.relative(rootRealPath, candidateRealPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes the workspace through a symlink or junction: ${value}.`);
  }
}

export function resolveWorkspaceInput(rootDir: string, value: string): string {
  const { root, resolved } = assertLexicallyWithin(rootDir, value);
  if (!fs.existsSync(resolved)) throw new Error(`Workspace file does not exist: ${value}.`);
  const rootRealPath = fs.realpathSync(root);
  const resolvedRealPath = fs.realpathSync(resolved);
  assertRealPathWithin(rootRealPath, resolvedRealPath, value);
  return resolvedRealPath;
}

export function resolveWorkspaceOutput(rootDir: string, value: string): string {
  const { root, resolved } = assertLexicallyWithin(rootDir, value);
  const rootRealPath = fs.realpathSync(root);
  let existing = resolved;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error(`No existing parent for workspace output: ${value}.`);
    existing = parent;
  }
  assertRealPathWithin(rootRealPath, fs.realpathSync(existing), value);
  return resolved;
}
