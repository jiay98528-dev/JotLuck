import { createHash } from 'node:crypto';
import { mkdir, open, readFile, realpath } from 'node:fs/promises';
import * as path from 'node:path';

import type { V2FreeSha256 } from './contract';
import { validateV2FreeHoldoutDescriptor, type V2FreeHoldoutDescriptor } from './holdout-validator';

export const V2_FREE_FINAL_CONSUMPTION_ROOT =
  'scripts/corpus/_web-cache/autocomplete-v2-free/final-consumption';

export interface V2FreeFinalPairIdentity {
  coldHoldoutSha256: V2FreeSha256;
  workspaceHoldoutSha256: V2FreeSha256;
  candidateArtifactSha256: V2FreeSha256;
  baselineSha256: V2FreeSha256;
  evaluatorTreeSha256: V2FreeSha256;
}

export interface V2FreeFinalPairClaim extends V2FreeFinalPairIdentity {
  schema: 'jotluck.autocomplete.v2-free-final-pair-claim.v1';
  schemaVersion: 1;
  pairSha256: V2FreeSha256;
  coldDatasetId: string;
  workspaceDatasetId: string;
  claimedAt: string;
  consumedOnce: true;
  claimSha256: V2FreeSha256;
}

export interface V2FreeFinalPairReceipt {
  schema: 'jotluck.autocomplete.v2-free-final-pair-receipt.v1';
  schemaVersion: 1;
  pairSha256: V2FreeSha256;
  claimSha256: V2FreeSha256;
  status: 'completed' | 'failed';
  completedAt: string;
  coldEvaluationManifestSha256?: V2FreeSha256;
  workspaceEvaluationManifestSha256?: V2FreeSha256;
  failureCode?: string;
  receiptSha256: V2FreeSha256;
}

export interface V2FreeFinalPairClaimResult {
  claim: V2FreeFinalPairClaim;
  claimPath: string;
  receiptPath: string;
}

export async function claimV2FreeFinalPair(options: {
  workspaceRoot: string;
  coldDescriptor: V2FreeHoldoutDescriptor;
  workspaceDescriptor: V2FreeHoldoutDescriptor;
  candidateArtifactSha256: string;
  baselineSha256: string;
  evaluatorTreeSha256: string;
  claimedAt?: string;
}): Promise<V2FreeFinalPairClaimResult> {
  const cold = validateV2FreeHoldoutDescriptor(options.coldDescriptor);
  const workspace = validateV2FreeHoldoutDescriptor(options.workspaceDescriptor);
  if (cold.classification !== 'cold-final-v1') {
    throw new Error('Cold final descriptor classification is invalid.');
  }
  if (workspace.classification !== 'workspace-final-v1') {
    throw new Error('Workspace final descriptor classification is invalid.');
  }
  const identity: V2FreeFinalPairIdentity = {
    coldHoldoutSha256: cold.content.sha256,
    workspaceHoldoutSha256: workspace.content.sha256,
    candidateArtifactSha256: requireSha256(options.candidateArtifactSha256, 'candidate artifact'),
    baselineSha256: requireSha256(options.baselineSha256, 'baseline'),
    evaluatorTreeSha256: requireSha256(options.evaluatorTreeSha256, 'evaluator tree'),
  };
  const pairSha256 = computeV2FreeFinalPairSha256(identity);
  const root = await resolveConsumptionRoot(options.workspaceRoot);
  const claimPath = path.join(root, `${pairSha256}.claim.json`);
  const receiptPath = path.join(root, `${pairSha256}.receipt.json`);
  const withoutHash = {
    schema: 'jotluck.autocomplete.v2-free-final-pair-claim.v1' as const,
    schemaVersion: 1 as const,
    ...identity,
    pairSha256,
    coldDatasetId: cold.datasetId,
    workspaceDatasetId: workspace.datasetId,
    claimedAt: canonicalIso(options.claimedAt ?? new Date().toISOString()),
    consumedOnce: true as const,
  };
  const claim: V2FreeFinalPairClaim = {
    ...withoutHash,
    claimSha256: canonicalSha256(withoutHash),
  };
  await writeExclusiveDurable(claimPath, claim, 'V2 free final pair is already consumed.');
  return {
    claim,
    claimPath: toRepositoryPath(options.workspaceRoot, claimPath),
    receiptPath: toRepositoryPath(options.workspaceRoot, receiptPath),
  };
}

export async function readV2FreeFinalPairClaim(options: {
  workspaceRoot: string;
  claimPath: string;
}): Promise<V2FreeFinalPairClaim> {
  const root = await realpath(path.resolve(options.workspaceRoot));
  const claimPath = await resolveExistingInside(root, options.claimPath, 'final pair claim');
  const consumptionRoot = await realpath(path.join(root, V2_FREE_FINAL_CONSUMPTION_ROOT));
  if (!isWithin(claimPath, consumptionRoot)) {
    throw new Error('V2 free final pair claim escaped the global consumption root.');
  }
  const value = JSON.parse(await readFile(claimPath, 'utf8')) as V2FreeFinalPairClaim;
  assertV2FreeFinalPairClaim(value);
  return value;
}

export async function writeV2FreeFinalPairReceipt(options: {
  workspaceRoot: string;
  claim: V2FreeFinalPairClaim;
  status: 'completed' | 'failed';
  coldEvaluationManifestSha256?: string;
  workspaceEvaluationManifestSha256?: string;
  failureCode?: string;
  completedAt?: string;
}): Promise<{ receipt: V2FreeFinalPairReceipt; receiptPath: string }> {
  assertV2FreeFinalPairClaim(options.claim);
  const completed = options.status === 'completed';
  const coldEvaluationManifestSha256 = optionalSha256(
    options.coldEvaluationManifestSha256,
    'cold evaluation manifest',
  );
  const workspaceEvaluationManifestSha256 = optionalSha256(
    options.workspaceEvaluationManifestSha256,
    'workspace evaluation manifest',
  );
  if (completed && (!coldEvaluationManifestSha256 || !workspaceEvaluationManifestSha256)) {
    throw new Error('A completed final receipt requires both evaluation manifests.');
  }
  if (!completed && !isSafeFailureCode(options.failureCode)) {
    throw new Error('A failed final receipt requires a bounded failure code.');
  }
  const root = await resolveConsumptionRoot(options.workspaceRoot);
  const receiptPath = path.join(root, `${options.claim.pairSha256}.receipt.json`);
  const common = {
    schema: 'jotluck.autocomplete.v2-free-final-pair-receipt.v1' as const,
    schemaVersion: 1 as const,
    pairSha256: options.claim.pairSha256,
    claimSha256: options.claim.claimSha256,
    completedAt: canonicalIso(options.completedAt ?? new Date().toISOString()),
  };
  const withoutHash = completed
    ? {
        ...common,
        status: 'completed' as const,
        coldEvaluationManifestSha256: coldEvaluationManifestSha256!,
        workspaceEvaluationManifestSha256: workspaceEvaluationManifestSha256!,
      }
    : {
        ...common,
        status: 'failed' as const,
        failureCode: options.failureCode!,
      };
  const receipt: V2FreeFinalPairReceipt = {
    ...withoutHash,
    receiptSha256: canonicalSha256(withoutHash),
  };
  await writeExclusiveDurable(
    receiptPath,
    receipt,
    'V2 free final pair receipt already exists and cannot be overwritten.',
  );
  return { receipt, receiptPath: toRepositoryPath(options.workspaceRoot, receiptPath) };
}

export function assertV2FreeFinalPairClaim(
  claim: V2FreeFinalPairClaim,
): asserts claim is V2FreeFinalPairClaim {
  const identity: V2FreeFinalPairIdentity = {
    coldHoldoutSha256: requireSha256(claim.coldHoldoutSha256, 'cold final'),
    workspaceHoldoutSha256: requireSha256(claim.workspaceHoldoutSha256, 'workspace final'),
    candidateArtifactSha256: requireSha256(claim.candidateArtifactSha256, 'candidate artifact'),
    baselineSha256: requireSha256(claim.baselineSha256, 'baseline'),
    evaluatorTreeSha256: requireSha256(claim.evaluatorTreeSha256, 'evaluator tree'),
  };
  const withoutHash = {
    schema: claim.schema,
    schemaVersion: claim.schemaVersion,
    ...identity,
    pairSha256: claim.pairSha256,
    coldDatasetId: claim.coldDatasetId,
    workspaceDatasetId: claim.workspaceDatasetId,
    claimedAt: claim.claimedAt,
    consumedOnce: claim.consumedOnce,
  };
  if (
    claim.schema !== 'jotluck.autocomplete.v2-free-final-pair-claim.v1' ||
    claim.schemaVersion !== 1 ||
    claim.consumedOnce !== true ||
    !isSafeIdentifier(claim.coldDatasetId) ||
    !isSafeIdentifier(claim.workspaceDatasetId) ||
    !isCanonicalIso(claim.claimedAt) ||
    claim.pairSha256 !== computeV2FreeFinalPairSha256(identity) ||
    claim.claimSha256 !== canonicalSha256(withoutHash)
  ) {
    throw new Error('V2 free final pair claim identity is invalid.');
  }
}

export function computeV2FreeFinalPairSha256(
  identity: Pick<V2FreeFinalPairIdentity, 'coldHoldoutSha256' | 'workspaceHoldoutSha256'>,
): V2FreeSha256 {
  requireSha256(identity.coldHoldoutSha256, 'cold final');
  requireSha256(identity.workspaceHoldoutSha256, 'workspace final');
  return canonicalSha256({
    coldHoldoutSha256: identity.coldHoldoutSha256,
    workspaceHoldoutSha256: identity.workspaceHoldoutSha256,
  });
}

async function resolveConsumptionRoot(workspaceRoot: string): Promise<string> {
  const root = await realpath(path.resolve(workspaceRoot));
  const target = path.resolve(root, V2_FREE_FINAL_CONSUMPTION_ROOT);
  if (!isWithin(target, root)) throw new Error('Final consumption root escaped the workspace.');
  await mkdir(target, { recursive: true });
  return realpath(target);
}

async function writeExclusiveDurable(
  target: string,
  value: unknown,
  duplicateMessage: string,
): Promise<void> {
  let handle;
  try {
    handle = await open(target, 'wx');
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(duplicateMessage);
    throw error;
  } finally {
    await handle?.close();
  }
}

async function resolveExistingInside(root: string, value: string, label: string): Promise<string> {
  if (!value || path.isAbsolute(value)) throw new Error(`${label} path must be relative.`);
  const normalized = value.replaceAll('\\', '/');
  if (normalized.split('/').some((segment) => segment === '..' || segment === '')) {
    throw new Error(`${label} path contains traversal.`);
  }
  const resolved = await realpath(path.join(root, normalized));
  if (!isWithin(resolved, root)) throw new Error(`${label} path escaped the workspace.`);
  return resolved;
}

function toRepositoryPath(workspaceRoot: string, value: string): string {
  const relative = path.relative(path.resolve(workspaceRoot), value).replaceAll('\\', '/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new Error('Final ledger path escaped the workspace.');
  }
  return relative;
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function requireSha256(value: unknown, label: string): V2FreeSha256 {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} is not a SHA-256 identity.`);
  }
  return value as V2FreeSha256;
}

function optionalSha256(value: unknown, label: string): V2FreeSha256 | undefined {
  return value === undefined ? undefined : requireSha256(value, label);
}

function isSafeFailureCode(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,95}$/u.test(value);
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/u.test(value);
}

function canonicalIso(value: string): string {
  if (!isCanonicalIso(value)) throw new Error('Ledger timestamp must be canonical ISO.');
  return value;
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

function canonicalSha256(value: unknown): V2FreeSha256 {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex') as V2FreeSha256;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
