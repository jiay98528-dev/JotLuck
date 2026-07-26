#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_VERSION = '2022-11-28';
const WORKFLOW_PATH = '.github/workflows/ci.yml';
const MATERIALIZATION_JOB = 'Installed-app Evidence Materialization';
const MATERIALIZATION_STEP = 'Materialize managed evidence bundle';
const PREREQUISITE_JOB_STEPS = new Map([
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

export async function resolveCurrentRunProvenance({
  releaseId,
  repository,
  runId,
  runAttempt,
  headSha,
  candidateArtifactId,
  evidenceArtifactId,
  token,
  apiUrl = 'https://api.github.com',
  fetchImpl = globalThis.fetch,
}) {
  assertSafeSegment(releaseId, 'release id');
  if (!token) throw new Error('GITHUB_TOKEN is required to resolve trusted provenance');
  if (!/^[^/]+\/[^/]+$/u.test(String(repository ?? ''))) throw new Error('repository is invalid');
  if (!/^[1-9]\d*$/u.test(String(runId ?? ''))) throw new Error('run id is invalid');
  if (!Number.isInteger(Number(runAttempt)) || Number(runAttempt) <= 0)
    throw new Error('run attempt is invalid');
  if (!/^[a-f0-9]{40}$/u.test(String(headSha ?? ''))) throw new Error('head SHA is invalid');
  if (typeof fetchImpl !== 'function') throw new Error('GitHub REST client is unavailable');
  const request = createGitHubRequest({ repository, token, apiUrl, fetchImpl });
  const run = await request(`/actions/runs/${runId}`);
  validateCurrentRun(run, {
    repository,
    runId: String(runId),
    runAttempt: Number(runAttempt),
    headSha,
  });
  const jobs = await request(`/actions/runs/${runId}/jobs?filter=latest&per_page=100`);
  validatePrerequisiteJobs(jobs);
  const artifacts = await request(`/actions/runs/${runId}/artifacts?per_page=100`);
  const candidateArtifact = resolveUniqueArtifact(artifacts, {
    id: candidateArtifactId,
    name: 'jotluck-windows-candidate',
    run,
  });
  const evidenceArtifact = resolveUniqueArtifact(artifacts, {
    id: evidenceArtifactId,
    name: `jotluck-installed-app-evidence-v2-${releaseId}`,
    run,
  });
  if (candidateArtifact.id === evidenceArtifact.id)
    throw new Error('candidate and evidence artifacts must be distinct');
  return {
    schema: 'jotluck.github-actions.capture-provenance.v1',
    repository,
    workflow: WORKFLOW_PATH,
    event: 'workflow_dispatch',
    branch: 'main',
    headSha,
    runId: String(run.id),
    runAttempt: run.run_attempt,
    candidateArtifact: artifactBinding(candidateArtifact),
    evidenceArtifact: artifactBinding(evidenceArtifact),
    materialization: { job: MATERIALIZATION_JOB, step: MATERIALIZATION_STEP },
  };
}

function createGitHubRequest({ repository, token, apiUrl, fetchImpl }) {
  const encodedRepository = repository.split('/').map(encodeURIComponent).join('/');
  return async (route) => {
    let response;
    try {
      response = await fetchImpl(
        `${apiUrl.replace(/\/$/u, '')}/repos/${encodedRepository}${route}`,
        {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': API_VERSION,
            'User-Agent': 'jotluck-materialization-provenance-v2',
          },
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch (error) {
      throw new Error(
        `GitHub provenance request failed closed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok)
      throw new Error(`GitHub provenance request failed closed: HTTP ${response.status}`);
    try {
      return await response.json();
    } catch {
      throw new Error('GitHub provenance response is not valid JSON');
    }
  };
}

function validateCurrentRun(run, expected) {
  const workflow = String(run?.path ?? '').split('@')[0];
  if (
    String(run?.id) !== expected.runId ||
    String(run?.repository?.full_name ?? '').toLowerCase() !== expected.repository.toLowerCase() ||
    workflow !== WORKFLOW_PATH ||
    run?.event !== 'workflow_dispatch' ||
    run?.head_branch !== 'main' ||
    run?.head_sha !== expected.headSha ||
    run?.run_attempt !== expected.runAttempt ||
    !['queued', 'in_progress', 'completed'].includes(run?.status) ||
    (run?.status === 'completed' && run?.conclusion !== 'success') ||
    run?.repository?.id !== run?.head_repository?.id
  ) {
    throw new Error('current workflow run provenance is invalid');
  }
}

function validatePrerequisiteJobs(value) {
  if (
    !Array.isArray(value?.jobs) ||
    value.total_count !== value.jobs.length ||
    value.total_count > 100
  ) {
    throw new Error('GitHub jobs response is incomplete or invalid');
  }
  for (const [name, requiredSteps] of PREREQUISITE_JOB_STEPS) {
    const matching = value.jobs.filter((job) => job?.name === name);
    if (
      matching.length !== 1 ||
      matching[0].status !== 'completed' ||
      matching[0].conclusion !== 'success'
    ) {
      throw new Error(`required capture prerequisite did not succeed uniquely: ${name}`);
    }
    if (!Array.isArray(matching[0].steps)) throw new Error(`required job has no steps: ${name}`);
    for (const stepName of requiredSteps) {
      const steps = matching[0].steps.filter((step) => step?.name === stepName);
      if (
        steps.length !== 1 ||
        steps[0].status !== 'completed' ||
        steps[0].conclusion !== 'success'
      ) {
        throw new Error(`required capture step did not succeed uniquely: ${name} / ${stepName}`);
      }
    }
  }
}

function resolveUniqueArtifact(value, expected) {
  if (
    !Array.isArray(value?.artifacts) ||
    value.total_count !== value.artifacts.length ||
    value.total_count > 100
  ) {
    throw new Error('GitHub artifacts response is incomplete or invalid');
  }
  const named = value.artifacts.filter((artifact) => artifact?.name === expected.name);
  if (named.length !== 1) throw new Error(`GitHub artifact name is not unique: ${expected.name}`);
  const artifact = named[0];
  if (
    String(artifact.id) !== String(expected.id) ||
    artifact.expired !== false ||
    !Number.isInteger(artifact.size_in_bytes) ||
    artifact.size_in_bytes <= 0 ||
    !/^sha256:[a-f0-9]{64}$/u.test(String(artifact.digest)) ||
    String(artifact.workflow_run?.id) !== String(expected.run.id) ||
    artifact.workflow_run?.head_sha !== expected.run.head_sha ||
    artifact.workflow_run?.repository_id !== expected.run.repository.id ||
    artifact.workflow_run?.head_repository_id !== expected.run.head_repository.id
  ) {
    throw new Error(`GitHub artifact provenance is invalid: ${expected.name}`);
  }
  return artifact;
}

function artifactBinding(artifact) {
  return {
    id: String(artifact.id),
    name: artifact.name,
    digest: artifact.digest,
    sizeInBytes: artifact.size_in_bytes,
  };
}

function assertSafeSegment(value, label) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(String(value ?? '')))
    throw new Error(`${label} is unsafe`);
}

async function main() {
  const [releaseId, candidateArtifactId, evidenceArtifactId, outputPath] = process.argv.slice(2);
  if (!releaseId || !candidateArtifactId || !evidenceArtifactId || !outputPath) {
    throw new Error(
      'usage: resolve-current-run-provenance <release-id> <candidate-artifact-id> <evidence-artifact-id> <output-json>',
    );
  }
  const provenance = await resolveCurrentRunProvenance({
    releaseId,
    repository: process.env.GITHUB_REPOSITORY,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    headSha: process.env.GITHUB_SHA,
    candidateArtifactId,
    evidenceArtifactId,
    token: process.env.GITHUB_TOKEN,
    apiUrl: process.env.GITHUB_API_URL,
  });
  writeFileSync(outputPath, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `candidate_artifact_id=${provenance.candidateArtifact.id}\nevidence_artifact_id=${provenance.evidenceArtifact.id}\n`,
      'utf8',
    );
  }
  console.log(JSON.stringify({ status: 'trusted-provenance-resolved', runId: provenance.runId }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      `[release:resolve-provenance] FAIL: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(16);
  });
}
