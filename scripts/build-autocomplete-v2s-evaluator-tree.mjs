import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUTOCOMPLETE_V2S_EVIDENCE_SOURCE_FILES,
  canonicalJson,
  resolveWorkspaceFile,
  sha256,
} from './autocomplete-evidence-integrity.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function buildAutocompleteV2SEvaluatorTree({ rootDir = REPOSITORY_ROOT, outputPath }) {
  const root = realpathSync(path.resolve(rootDir));
  const output = resolveWorkspaceOutput(root, outputPath);
  if (existsSync(output)) {
    throw new Error('V2S evaluator source-tree evidence already exists and cannot be overwritten.');
  }
  const files = AUTOCOMPLETE_V2S_EVIDENCE_SOURCE_FILES.map((relativePath) => ({
    path: relativePath,
    sha256: sha256(readFileSync(resolveWorkspaceFile(root, relativePath))),
  }));
  const identity = {
    schemaVersion: 1,
    files,
    treeSha256: sha256(canonicalJson(files)),
  };
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(identity, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return identity;
}

function resolveWorkspaceOutput(rootDir, value) {
  if (!value || path.isAbsolute(value)) {
    throw new Error('V2S evaluator output must be a repository-relative path.');
  }
  const resolved = path.resolve(rootDir, value);
  const relative = path.relative(rootDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('V2S evaluator output escaped the repository.');
  }
  let existing = path.dirname(resolved);
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error('V2S evaluator output has no safe parent.');
    existing = parent;
  }
  const realRelative = path.relative(rootDir, realpathSync(existing));
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    throw new Error('V2S evaluator output escaped through a symlink or junction.');
  }
  return resolved;
}

function parseArguments(argv) {
  let rootDir = REPOSITORY_ROOT;
  let outputPath = '';
  for (const argument of argv) {
    if (argument.startsWith('--root-dir=')) rootDir = argument.slice('--root-dir='.length);
    else if (argument.startsWith('--output=')) outputPath = argument.slice('--output='.length);
    else throw new Error(`Unknown V2S evaluator-tree argument: ${argument}`);
  }
  if (!outputPath) throw new Error('--output is required.');
  return { rootDir, outputPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(
      JSON.stringify(
        buildAutocompleteV2SEvaluatorTree(parseArguments(process.argv.slice(2))),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
}
