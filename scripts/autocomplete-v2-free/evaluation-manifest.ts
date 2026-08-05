import { createHash } from 'node:crypto';
import { mkdir, open, readFile, realpath } from 'node:fs/promises';
import * as path from 'node:path';

import type { V2FreeSha256 } from './contract';
import type {
  V2FreeHoldoutClassification,
  V2FreeLanguage,
  V2FreeNoteCategory,
} from './holdout-validator';

export interface V2FreeEvaluationCandidateObservation {
  candidateId: string;
  text: string;
  confidence: number;
  modelScore: number;
  gateScore: number;
  language: 'zh' | 'en';
  usable: boolean;
}

export interface V2FreeEvaluationObservation {
  checkpointId: string;
  targetId: string;
  expectedBehavior: 'complete' | 'silence';
  language: V2FreeLanguage;
  category: V2FreeNoteCategory;
  cursorOffset: number;
  elapsedMs: number;
  triggered: boolean;
  top1Usable: boolean;
  oracleAt8Usable: boolean;
  oracleAt32Usable: boolean;
  candidates: V2FreeEvaluationCandidateObservation[];
}

export interface V2FreeEvaluationRate {
  hits: number;
  checkpoints: number;
  rate: number;
}

export interface V2FreeEvaluationReport {
  schema: 'jotluck.autocomplete.v2-free-evaluation-report.v1';
  schemaVersion: 1;
  engine: 'public-v2-free-decoder-v1';
  mode: 'oracle' | 'final';
  suite: 'cold' | 'workspace';
  classification: V2FreeHoldoutClassification;
  candidateId: string;
  candidateArtifactSha256: V2FreeSha256;
  holdoutSha256: V2FreeSha256;
  evaluatorTreeSha256: V2FreeSha256;
  checkpoints: number;
  completeCheckpoints: number;
  silenceCheckpoints: number;
  oracleAt8: V2FreeEvaluationRate;
  oracleAt32: V2FreeEvaluationRate;
  top1: V2FreeEvaluationRate;
  triggers: V2FreeEvaluationRate;
  silenceFalseTriggers: V2FreeEvaluationRate;
  byLanguage: Record<
    V2FreeLanguage,
    { checkpoints: number; oracleAt8Hits: number; top1Hits: number }
  >;
  byCategory: Record<string, { checkpoints: number; top1Hits: number }>;
  requestP90Ms: number;
  observationsSha256: V2FreeSha256;
  finalClaimSha256?: V2FreeSha256;
  finalHoldoutsRead: boolean;
  passed: false;
  reportSha256: V2FreeSha256;
}

export interface V2FreeEvaluationManifest {
  schema: 'jotluck.autocomplete.v2-free-evaluation-manifest.v1';
  schemaVersion: 1;
  engine: 'public-v2-free-decoder-v1';
  candidateId: string;
  candidateArtifactSha256: V2FreeSha256;
  mode: 'oracle' | 'final';
  classification: V2FreeHoldoutClassification;
  holdoutSha256: V2FreeSha256;
  evaluatorTreeSha256: V2FreeSha256;
  workerExecutableSha256: V2FreeSha256;
  candidateManifestSha256: V2FreeSha256;
  observations: { file: 'observations.json'; bytes: number; sha256: V2FreeSha256 };
  report: { file: 'evaluation-report.json'; bytes: number; sha256: V2FreeSha256 };
  finalClaimSha256?: V2FreeSha256;
  createdAt: string;
  releaseEligible: false;
  manifestSha256: V2FreeSha256;
}

const EVALUATOR_SOURCE_PATHS = Object.freeze([
  'scripts/autocomplete-v2-free/contract.ts',
  'scripts/autocomplete-v2-free/evaluation-manifest.ts',
  'scripts/autocomplete-v2-free/evaluator.ts',
  'scripts/autocomplete-v2-free/holdout-validator.ts',
]);

export async function computeV2FreeEvaluatorTreeSha256(
  workspaceRoot: string,
): Promise<V2FreeSha256> {
  const root = await realpath(path.resolve(workspaceRoot));
  const entries = [];
  for (const relativePath of EVALUATOR_SOURCE_PATHS) {
    const absolutePath = await realpath(path.join(root, relativePath));
    if (!isWithin(absolutePath, root)) throw new Error('Evaluator source escaped the workspace.');
    const bytes = await readFile(absolutePath);
    entries.push({ path: relativePath, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  return canonicalSha256(entries);
}

export async function writeV2FreeEvaluationArtifacts(options: {
  workspaceRoot: string;
  outputDirectory: string;
  observations: readonly V2FreeEvaluationObservation[];
  report: Omit<V2FreeEvaluationReport, 'observationsSha256' | 'reportSha256'>;
  workerExecutablePath: string;
  candidateManifestPath: string;
  createdAt?: string;
}): Promise<{ manifest: V2FreeEvaluationManifest; outputDirectory: string }> {
  const root = await realpath(path.resolve(options.workspaceRoot));
  const outputDirectory = resolveOutputInsideCandidateRoot(root, options.outputDirectory);
  const parent = path.dirname(outputDirectory);
  await mkdir(parent, { recursive: true });
  await mkdir(outputDirectory, { recursive: false });

  const observationsBytes = jsonBytes(options.observations);
  const observationsSha256 = sha256(observationsBytes);
  const reportWithoutHash = { ...options.report, observationsSha256 };
  const report: V2FreeEvaluationReport = {
    ...reportWithoutHash,
    reportSha256: canonicalSha256(reportWithoutHash),
  };
  const reportBytes = jsonBytes(report);
  const workerExecutablePath = await resolveExisting(root, options.workerExecutablePath, true);
  const candidateManifestPath = await resolveExisting(root, options.candidateManifestPath, false);
  const workerExecutableSha256 = sha256(await readFile(workerExecutablePath));
  const candidateManifestSha256 = sha256(await readFile(candidateManifestPath));

  await writeExclusive(path.join(outputDirectory, 'observations.json'), observationsBytes);
  await writeExclusive(path.join(outputDirectory, 'evaluation-report.json'), reportBytes);
  const manifestWithoutHash = {
    schema: 'jotluck.autocomplete.v2-free-evaluation-manifest.v1' as const,
    schemaVersion: 1 as const,
    engine: 'public-v2-free-decoder-v1' as const,
    candidateId: report.candidateId,
    candidateArtifactSha256: report.candidateArtifactSha256,
    mode: report.mode,
    classification: report.classification,
    holdoutSha256: report.holdoutSha256,
    evaluatorTreeSha256: report.evaluatorTreeSha256,
    workerExecutableSha256,
    candidateManifestSha256,
    observations: {
      file: 'observations.json' as const,
      bytes: observationsBytes.byteLength,
      sha256: observationsSha256,
    },
    report: {
      file: 'evaluation-report.json' as const,
      bytes: reportBytes.byteLength,
      sha256: sha256(reportBytes),
    },
    ...(report.finalClaimSha256 ? { finalClaimSha256: report.finalClaimSha256 } : {}),
    createdAt: canonicalIso(options.createdAt ?? new Date().toISOString()),
    releaseEligible: false as const,
  };
  const manifest: V2FreeEvaluationManifest = {
    ...manifestWithoutHash,
    manifestSha256: canonicalSha256(manifestWithoutHash),
  };
  await writeExclusive(path.join(outputDirectory, 'evaluation-manifest.json'), jsonBytes(manifest));
  return { manifest, outputDirectory };
}

function resolveOutputInsideCandidateRoot(root: string, value: string): string {
  if (!value || path.isAbsolute(value)) throw new Error('Evaluation output must be relative.');
  const normalized = value.replaceAll('\\', '/');
  if (normalized.split('/').some((segment) => segment === '..' || segment === '')) {
    throw new Error('Evaluation output contains traversal.');
  }
  const output = path.resolve(root, normalized);
  const candidateRoot = path.resolve(
    root,
    'scripts/corpus/_web-cache/autocomplete-v2-free/candidates',
  );
  if (!isWithin(output, candidateRoot) || output === candidateRoot) {
    throw new Error('Evaluation output escaped the V2 free candidate root.');
  }
  return output;
}

async function resolveExisting(
  root: string,
  value: string,
  allowAbsolute: boolean,
): Promise<string> {
  const candidate = path.isAbsolute(value) ? value : path.join(root, value);
  if (path.isAbsolute(value) && !allowAbsolute) {
    throw new Error('Candidate manifest path must be workspace-relative.');
  }
  const resolved = await realpath(candidate);
  if (!allowAbsolute && !isWithin(resolved, root)) throw new Error('Input escaped the workspace.');
  return resolved;
}

async function writeExclusive(target: string, bytes: Buffer): Promise<void> {
  const handle = await open(target, 'wx');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function canonicalIso(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error('Evaluation timestamp must be canonical ISO.');
  }
  return value;
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function sha256(bytes: Buffer): V2FreeSha256 {
  return createHash('sha256').update(bytes).digest('hex') as V2FreeSha256;
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
