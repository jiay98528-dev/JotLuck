/**
 * Measures only validation tiers that passed every deterministic gate.
 *
 * A candidate is installed into the public web-local slot only for the life
 * of its Playwright subprocess. The checked-in fail-closed asset is restored
 * in a finally block, even when the runtime probe fails.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { atomicReplaceFiles } from './train-baseline';
import {
  CANDIDATE_OUTPUT_ROOT,
  type LearningCurveReport,
  type RuntimeEvidenceReport,
} from './run-autocomplete-learning-curve';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CURVE = `${CANDIDATE_OUTPUT_ROOT}/learning-curve-report.json`;
const DEFAULT_RUNTIME = 'scripts/corpus/_web-cache/autocomplete-candidates/runtime-evidence.json';
const PUBLIC_MODEL = 'packages/app/public/baseline-ngram.web-local.compact.txt';
const PUBLIC_MANIFEST = 'packages/app/public/baseline-ngram.web-local.compact.manifest.json';

type RuntimeCandidateTier = LearningCurveReport['tiers'][number];

export interface RuntimeCandidateRunSummary {
  schemaVersion: 1;
  classification: 'runtime-candidate-orchestration';
  candidateTierIds: string[];
  measuredTierIds: string[];
  failedTierIds: string[];
  publicAssetRestored: true;
}

export function selectRuntimeCandidateTiers(
  report: Pick<LearningCurveReport, 'tiers' | 'selectedTier' | 'releaseEligible'>,
): RuntimeCandidateTier[] {
  if (report.selectedTier !== null || report.releaseEligible !== false) {
    throw new Error('Runtime candidate measurement requires a validation-only learning curve.');
  }
  return report.tiers
    .filter((tier) => tier.runtimeMeasurementRequired)
    .sort((left, right) => left.requestedBytes - right.requestedBytes);
}

export function installRuntimeCandidate(
  rootDir: string,
  tier: Pick<RuntimeCandidateTier, 'id' | 'modelSha256' | 'modelBytes' | 'candidateDirectory'>,
  options: { releaseCandidate?: boolean } = {},
): () => void {
  const root = fs.realpathSync(path.resolve(rootDir));
  const candidateRoot = resolveExistingDirectory(root, tier.candidateDirectory);
  const allowedCandidateRoot = resolveExistingDirectory(root, CANDIDATE_OUTPUT_ROOT);
  if (!isWithin(candidateRoot, allowedCandidateRoot)) {
    throw new Error('Runtime candidate path escapes the learning-curve candidate root.');
  }
  const candidateModelPath = resolveExistingFile(
    root,
    path.relative(root, path.join(candidateRoot, 'model.compact.txt')),
  );
  const candidateManifestPath = resolveExistingFile(
    root,
    path.relative(root, path.join(candidateRoot, 'manifest.json')),
  );
  const model = fs.readFileSync(candidateModelPath, 'utf8');
  const candidateManifest = readJson<Record<string, unknown>>(candidateManifestPath);
  if (
    sha256(model) !== tier.modelSha256 ||
    Buffer.byteLength(model, 'utf8') !== tier.modelBytes ||
    candidateManifest.sha256 !== tier.modelSha256 ||
    candidateManifest.modelBytes !== tier.modelBytes ||
    candidateManifest.releaseEligible !== false
  ) {
    throw new Error(`Runtime candidate ${tier.id} failed model/manifest integrity checks.`);
  }

  const publicModelPath = resolveExistingFile(root, PUBLIC_MODEL);
  const publicManifestPath = resolveExistingFile(root, PUBLIC_MANIFEST);
  const originalModel = fs.readFileSync(publicModelPath, 'utf8');
  const originalManifest = fs.readFileSync(publicManifestPath, 'utf8');
  const runtimeManifest = {
    ...candidateManifest,
    modelFile: path.basename(PUBLIC_MODEL),
    runtimeEligible: true,
    qualityGatePassed: options.releaseCandidate === true,
    releaseEligible: options.releaseCandidate === true,
    degradedReason: options.releaseCandidate === true ? undefined : 'rc-runtime-candidate-only',
    rcRuntimeCandidateTier: tier.id,
  };
  atomicReplaceFiles([
    { target: publicModelPath, content: model },
    { target: publicManifestPath, content: `${JSON.stringify(runtimeManifest, null, 2)}\n` },
  ]);

  let restored = false;
  return () => {
    if (restored) return;
    atomicReplaceFiles([
      { target: publicModelPath, content: originalModel },
      { target: publicManifestPath, content: originalManifest },
    ]);
    restored = true;
  };
}

export function runAutocompleteRuntimeCandidates(
  argv: string[] = process.argv.slice(2),
): RuntimeCandidateRunSummary {
  const curvePath = readArg(argv, '--curve') ?? DEFAULT_CURVE;
  const runtimePath = readArg(argv, '--runtime-evidence') ?? DEFAULT_RUNTIME;
  const report = readWorkspaceJson<LearningCurveReport>(REPOSITORY_ROOT, curvePath);
  if (report.schemaVersion !== 2 || report.stage !== 'validation') {
    throw new Error('Runtime candidates require a schema-v2 validation learning curve.');
  }
  const candidates = selectRuntimeCandidateTiers(report);
  const runtimeReport: RuntimeEvidenceReport = {
    schemaVersion: 2,
    classification: 'production-router-runtime-evidence',
    validationSha256: report.validationSha256,
    evaluatorVersion: 'production-router-runtime-v2',
    tiers: {},
  };
  const runtimeFile = resolveWorkspaceOutput(REPOSITORY_ROOT, runtimePath);
  atomicReplaceFiles([
    { target: runtimeFile, content: `${JSON.stringify(runtimeReport, null, 2)}\n` },
  ]);

  const measuredTierIds: string[] = [];
  const failedTierIds: string[] = [];
  for (const tier of candidates) {
    const restore = installRuntimeCandidate(REPOSITORY_ROOT, tier);
    try {
      const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
      const result = spawnSync(
        executable,
        [
          '--filter',
          '@jotluck/app',
          'exec',
          'playwright',
          'test',
          '25-autocomplete-runtime-evidence.spec.ts',
          '--project=chromium',
          '--workers=1',
        ],
        {
          cwd: REPOSITORY_ROOT,
          env: {
            ...process.env,
            JOTLUCK_AUTOCOMPLETE_RC: '1',
            JOTLUCK_AUTOCOMPLETE_RUNTIME_TIER: tier.id,
            JOTLUCK_AUTOCOMPLETE_RUNTIME_EVIDENCE: runtimeFile,
          },
          encoding: 'utf8',
          stdio: 'inherit',
        },
      );
      if (result.status === 0) measuredTierIds.push(tier.id);
      else failedTierIds.push(tier.id);
    } finally {
      restore();
    }
  }

  const summary: RuntimeCandidateRunSummary = {
    schemaVersion: 1,
    classification: 'runtime-candidate-orchestration',
    candidateTierIds: candidates.map((tier) => tier.id),
    measuredTierIds,
    failedTierIds,
    publicAssetRestored: true,
  };
  const summaryPath = path.join(path.dirname(runtimeFile), 'runtime-candidate-summary.json');
  atomicReplaceFiles([{ target: summaryPath, content: `${JSON.stringify(summary, null, 2)}\n` }]);
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

function readWorkspaceJson<T>(rootDir: string, relativePath: string): T {
  return readJson<T>(resolveExistingFile(rootDir, relativePath));
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function readArg(argv: string[], name: string): string | undefined {
  const inline = argv.find((item) => item.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function resolveExistingFile(rootDir: string, value: string): string {
  return resolveExistingPath(rootDir, value, 'file');
}

function resolveExistingDirectory(rootDir: string, value: string): string {
  return resolveExistingPath(rootDir, value, 'directory');
}

function resolveExistingPath(rootDir: string, value: string, kind: 'file' | 'directory'): string {
  const root = fs.realpathSync(path.resolve(rootDir));
  if (path.isAbsolute(value)) throw new Error(`Path must be workspace-relative: ${value}.`);
  const resolved = path.resolve(root, value);
  if (!isWithin(resolved, root)) throw new Error(`Path escapes the workspace: ${value}.`);
  if (!fs.existsSync(resolved)) throw new Error(`Workspace ${kind} does not exist: ${value}.`);
  const real = fs.realpathSync(resolved);
  if (!isWithin(real, root)) throw new Error(`Path symlink escapes the workspace: ${value}.`);
  const stats = fs.statSync(real);
  if ((kind === 'file' && !stats.isFile()) || (kind === 'directory' && !stats.isDirectory())) {
    throw new Error(`Workspace path is not a ${kind}: ${value}.`);
  }
  return real;
}

export function resolveWorkspaceOutput(rootDir: string, value: string): string {
  const root = fs.realpathSync(path.resolve(rootDir));
  if (path.isAbsolute(value)) throw new Error(`Path must be workspace-relative: ${value}.`);
  const resolved = path.resolve(root, value);
  if (!isWithin(resolved, root)) throw new Error(`Path escapes the workspace: ${value}.`);
  const existingParent = findExistingParent(resolved);
  if (!isWithin(fs.realpathSync(existingParent), root)) {
    throw new Error(`Output parent symlink escapes the workspace: ${value}.`);
  }
  if (fs.existsSync(resolved) && !isWithin(fs.realpathSync(resolved), root)) {
    throw new Error(`Output symlink escapes the workspace: ${value}.`);
  }
  return resolved;
}

function findExistingParent(value: string): string {
  let current = value;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`Cannot resolve an output parent: ${value}.`);
    current = parent;
  }
  return fs.statSync(current).isDirectory() ? current : path.dirname(current);
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    runAutocompleteRuntimeCandidates();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
