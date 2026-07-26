#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_VERSION = '2022-11-28';
const WORKFLOW_PATH = '.github/workflows/ci.yml';
const CANDIDATE_ARTIFACT_NAME = 'jotluck-windows-candidate';
const REQUIRED_JOB_STEPS = new Map([
  [
    'Lint & Type Check',
    [
      'Audit production JavaScript dependencies',
      'Audit all JavaScript dependencies',
      'Type check',
      'Lint',
      'Token contract check',
      'Format check',
      'Stylelint',
    ],
  ],
  ['Unit Tests', ['Run unit tests', 'Run coverage', 'Build app']],
  ['Rust Check, Test & Audit', ['Rust check', 'Rust tests', 'Audit Rust dependencies']],
  ['E2E Tests (chromium)', ['Run E2E tests']],
  ['E2E Tests (firefox)', ['Run E2E tests']],
  ['E2E Tests (webkit)', ['Run E2E tests']],
  ['Windows Visual Regression', ['Run Win32-owned visual baselines']],
  [
    'Windows Tauri Build',
    [
      'Build Tauri installer',
      'Run standalone Tauri WebView2 smoke',
      'Upload immutable Windows candidate',
    ],
  ],
  [
    'Installed-app Evidence Capture',
    [
      'Run fixed installed-app evidence adapters',
      'Upload trusted installed-app execution evidence',
    ],
  ],
]);

export async function verifyGitHubActionsProvenance({
  manifest,
  releaseId,
  repository,
  token,
  apiUrl = 'https://api.github.com',
  fetchImpl = globalThis.fetch,
}) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('evidence manifest is required for GitHub provenance verification');
  }
  const ci = manifest.ci;
  if (!ci || typeof ci !== 'object' || Array.isArray(ci)) {
    throw new Error('manifest GitHub Actions binding is missing');
  }
  if (!token) throw new Error('GITHUB_TOKEN is required for formal provenance verification');
  if (!repository || !/^[^/]+\/[^/]+$/u.test(repository)) {
    throw new Error('GITHUB_REPOSITORY is required for formal provenance verification');
  }
  if (typeof fetchImpl !== 'function') throw new Error('GitHub REST client is unavailable');
  if (
    ci.provider !== 'github-actions' ||
    String(ci.repository).toLowerCase() !== repository.toLowerCase()
  ) {
    throw new Error('manifest repository does not match the formal gate repository');
  }

  const runId = assertPositiveId(ci.runId, 'workflow run id');
  if (!Number.isInteger(ci.runAttempt) || ci.runAttempt <= 0) {
    throw new Error('workflow run attempt is invalid');
  }
  const candidateCommit = String(manifest.candidate?.commit ?? '');
  if (!/^[a-f0-9]{40}$/u.test(candidateCommit)) throw new Error('candidate commit is invalid');

  const request = async (route) => {
    let response;
    try {
      response = await fetchImpl(`${apiUrl.replace(/\/$/u, '')}${route}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': API_VERSION,
          'User-Agent': 'jotluck-release-provenance-v2',
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new Error(
        `GitHub provenance request failed closed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) {
      throw new Error(`GitHub provenance request failed closed: HTTP ${response.status}`);
    }
    try {
      return await response.json();
    } catch {
      throw new Error('GitHub provenance response is not valid JSON');
    }
  };

  const encodedRepository = repository
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  const run = await request(`/repos/${encodedRepository}/actions/runs/${runId}`);
  verifyWorkflowRun(run, { repository, candidateCommit, runId, runAttempt: ci.runAttempt });

  const jobsResponse = await request(
    `/repos/${encodedRepository}/actions/runs/${runId}/jobs?filter=latest&per_page=100`,
  );
  verifyRequiredJobs(jobsResponse);

  const candidateArtifact = await request(
    `/repos/${encodedRepository}/actions/artifacts/${assertPositiveId(
      ci.candidateArtifact?.id,
      'candidate artifact id',
    )}`,
  );
  const evidenceArtifact = await request(
    `/repos/${encodedRepository}/actions/artifacts/${assertPositiveId(
      ci.evidenceArtifact?.id,
      'evidence artifact id',
    )}`,
  );
  verifyArtifact(candidateArtifact, ci.candidateArtifact, {
    label: 'candidate',
    expectedName: CANDIDATE_ARTIFACT_NAME,
    run,
  });
  verifyArtifact(evidenceArtifact, ci.evidenceArtifact, {
    label: 'evidence',
    expectedName: `jotluck-installed-app-evidence-v2-${releaseId}`,
    run,
  });
  if (candidateArtifact.id === evidenceArtifact.id) {
    throw new Error('candidate and evidence artifacts must be distinct');
  }

  return {
    repository,
    runId: String(run.id),
    runAttempt: run.run_attempt,
    candidateCommit,
    candidateArtifactId: String(candidateArtifact.id),
    evidenceArtifactId: String(evidenceArtifact.id),
  };
}

function verifyWorkflowRun(run, expected) {
  if (!run || typeof run !== 'object' || Array.isArray(run)) {
    throw new Error('GitHub workflow run response is invalid');
  }
  const workflowPath = String(run.path ?? '').split('@')[0];
  if (
    String(run.id) !== expected.runId ||
    String(run.repository?.full_name ?? '').toLowerCase() !== expected.repository.toLowerCase() ||
    workflowPath !== WORKFLOW_PATH ||
    run.event !== 'workflow_dispatch' ||
    run.head_branch !== 'main' ||
    run.head_sha !== expected.candidateCommit ||
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    run.run_attempt !== expected.runAttempt
  ) {
    throw new Error('GitHub workflow run is not the successful main candidate capture run');
  }
  if (
    !Number.isInteger(run.repository?.id) ||
    !Number.isInteger(run.head_repository?.id) ||
    run.repository.id !== run.head_repository.id
  ) {
    throw new Error('GitHub workflow run repository identity is invalid');
  }
}

function verifyRequiredJobs(response) {
  if (!response || !Array.isArray(response.jobs)) {
    throw new Error('GitHub workflow jobs response is invalid');
  }
  for (const [jobName, requiredSteps] of REQUIRED_JOB_STEPS) {
    const job = response.jobs.find((entry) => entry?.name === jobName);
    if (!job || job.status !== 'completed' || job.conclusion !== 'success') {
      throw new Error(`required GitHub job did not succeed: ${jobName}`);
    }
    if (!Array.isArray(job.steps)) throw new Error(`required GitHub job has no steps: ${jobName}`);
    for (const stepName of requiredSteps) {
      const step = job.steps.find((entry) => entry?.name === stepName);
      if (!step || step.status !== 'completed' || step.conclusion !== 'success') {
        throw new Error(`required GitHub step did not succeed: ${jobName} / ${stepName}`);
      }
    }
  }
}

function verifyArtifact(actual, binding, { label, expectedName, run }) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    throw new Error(`GitHub ${label} artifact response is invalid`);
  }
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
    throw new Error(`manifest ${label} artifact binding is invalid`);
  }
  if (
    String(actual.id) !== String(binding.id) ||
    actual.name !== expectedName ||
    binding.name !== expectedName ||
    actual.expired !== false ||
    !Number.isInteger(actual.size_in_bytes) ||
    actual.size_in_bytes <= 0 ||
    !/^sha256:[a-f0-9]{64}$/u.test(String(actual.digest)) ||
    actual.digest !== binding.digest ||
    String(actual.workflow_run?.id) !== String(run.id) ||
    actual.workflow_run?.head_sha !== run.head_sha ||
    actual.workflow_run?.repository_id !== run.repository.id ||
    actual.workflow_run?.head_repository_id !== run.head_repository.id
  ) {
    throw new Error(`GitHub ${label} artifact provenance does not match the candidate run`);
  }
}

function assertPositiveId(value, label) {
  const text = String(value ?? '');
  if (!/^[1-9]\d*$/u.test(text)) throw new Error(`${label} is invalid`);
  return text;
}

export function readEvidenceManifest(rootDir, releaseId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(String(releaseId ?? ''))) {
    throw new Error('release id is unsafe');
  }
  const manifestPath = path.join(
    path.resolve(rootDir),
    'release-evidence',
    'installed-app',
    'v2',
    releaseId,
    'manifest.json',
  );
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new Error(`evidence manifest is missing or invalid: ${manifestPath}`);
  }
}

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const releaseId = process.argv[2];
  const manifest = readEvidenceManifest(rootDir, releaseId);
  const verified = await verifyGitHubActionsProvenance({
    manifest,
    releaseId,
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN,
    apiUrl: process.env.GITHUB_API_URL,
  });
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      [
        `run_id=${verified.runId}`,
        `candidate_artifact_id=${verified.candidateArtifactId}`,
        `evidence_artifact_id=${verified.evidenceArtifactId}`,
      ].join('\n') + '\n',
      'utf8',
    );
  }
  console.log(JSON.stringify({ status: 'verified', ...verified }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      `[release:provenance] FAIL: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(13);
  });
}
