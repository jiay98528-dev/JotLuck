import { existsSync, realpathSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { normalizeRelativePath } from './common';
import type { V2STokenizerKind } from './tokenizer';

const MIB = 1024 * 1024;
export const V2S_CANDIDATE_ROOT = 'scripts/corpus/_web-cache/autocomplete-v2s/candidates';

export interface V2SMatrixEntry {
  id: string;
  maximumTrainingBytes: number;
  tokenizer: V2STokenizerKind | 'selected';
  assetBudgetBytes: number;
}

export const V2S_BOUNDED_MATRIX: readonly V2SMatrixEntry[] = [
  {
    id: '3mib-bpe-3mib',
    maximumTrainingBytes: 3 * MIB,
    tokenizer: 'bpe',
    assetBudgetBytes: 3 * MIB,
  },
  {
    id: '3mib-unigram-3mib',
    maximumTrainingBytes: 3 * MIB,
    tokenizer: 'unigram',
    assetBudgetBytes: 3 * MIB,
  },
  {
    id: '8mib-selected-3mib',
    maximumTrainingBytes: 8 * MIB,
    tokenizer: 'selected',
    assetBudgetBytes: 3 * MIB,
  },
  {
    id: '24mib-selected-3mib',
    maximumTrainingBytes: 24 * MIB,
    tokenizer: 'selected',
    assetBudgetBytes: 3 * MIB,
  },
  {
    id: '24mib-selected-5.5mib',
    maximumTrainingBytes: 24 * MIB,
    tokenizer: 'selected',
    assetBudgetBytes: Math.floor(5.5 * MIB),
  },
] as const;

export function getV2SMatrixEntry(id: string): V2SMatrixEntry {
  const entry = V2S_BOUNDED_MATRIX.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Unknown bounded V2S matrix id: ${id}.`);
  return entry;
}

export function resolveV2SCandidateDirectory(workspaceRoot: string, candidateId: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(candidateId)) {
    throw new Error('V2S candidate id contains unsupported characters.');
  }
  const normalizedRoot = normalizeRelativePath(V2S_CANDIDATE_ROOT, 'V2S candidate root');
  const realWorkspaceRoot = realpathSync(path.resolve(workspaceRoot));
  const candidateRoot = path.resolve(realWorkspaceRoot, ...normalizedRoot.split('/'));
  const resolved = path.resolve(candidateRoot, candidateId);
  const relative = path.relative(candidateRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('V2S candidate output escapes the candidate cache.');
  }
  const existingAncestor = findExistingAncestor(resolved);
  const realAncestor = realpathSync(existingAncestor);
  if (!isWithin(realAncestor, realWorkspaceRoot)) {
    throw new Error('V2S candidate output ancestor symlink escapes the workspace.');
  }
  if (existsSync(candidateRoot)) {
    if (!statSync(candidateRoot).isDirectory()) {
      throw new Error('V2S candidate cache root is not a directory.');
    }
    const realCandidateRoot = realpathSync(candidateRoot);
    if (!isWithin(realCandidateRoot, realWorkspaceRoot)) {
      throw new Error('V2S candidate cache root symlink escapes the workspace.');
    }
    if (existsSync(resolved) && !isWithin(realpathSync(resolved), realCandidateRoot)) {
      throw new Error('V2S candidate output symlink escapes the candidate cache.');
    }
  }
  return resolved;
}

function findExistingAncestor(value: string): string {
  let current = value;
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Cannot resolve an existing ancestor for ${value}.`);
    }
    current = parent;
  }
  return statSync(current).isDirectory() ? current : path.dirname(current);
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolveMatrixTokenizer(
  entry: V2SMatrixEntry,
  selectedTokenizer?: V2STokenizerKind,
): V2STokenizerKind {
  if (entry.tokenizer !== 'selected') return entry.tokenizer;
  if (selectedTokenizer !== 'bpe' && selectedTokenizer !== 'unigram') {
    throw new Error(`${entry.id} requires a tokenizer selected by the 3MiB comparison.`);
  }
  return selectedTokenizer;
}
