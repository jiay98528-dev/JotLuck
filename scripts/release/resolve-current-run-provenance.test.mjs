import { describe, expect, it, vi } from 'vitest';
import { resolveCurrentRunProvenance } from './resolve-current-run-provenance.mjs';

const releaseId = '0.1.0-preview-candidate';
const repository = 'fixture/jotluck';
const headSha = 'a'.repeat(40);

describe('current-run provenance resolver', () => {
  it('resolves unique same-run artifact IDs, sizes, and digests', async () => {
    await expect(resolve({})).resolves.toMatchObject({
      schema: 'jotluck.github-actions.capture-provenance.v1',
      headSha,
      candidateArtifact: { id: '456', sizeInBytes: 1024 },
      evidenceArtifact: { id: '789', sizeInBytes: 2048 },
    });
  });

  it.each([
    ['stale SHA', { run: { head_sha: 'b'.repeat(40) } }],
    ['wrong workflow', { run: { path: '.github/workflows/other.yml@refs/heads/main' } }],
    ['wrong repository', { run: { repository: { id: 10, full_name: 'other/jotluck' } } }],
    ['wrong event', { run: { event: 'push' } }],
    ['wrong attempt', { run: { run_attempt: 1 } }],
    ['failed prerequisite', { failJob: 'Unit Tests' }],
    ['failed prerequisite step', { failStep: 'Build app' }],
    ['expired artifact', { evidence: { expired: true } }],
    ['digest missing', { evidence: { digest: null } }],
    ['artifact size missing', { evidence: { size_in_bytes: 0 } }],
    [
      'artifact from another SHA',
      {
        evidence: {
          workflow_run: {
            id: 123,
            head_sha: 'b'.repeat(40),
            repository_id: 10,
            head_repository_id: 10,
          },
        },
      },
    ],
    ['duplicate artifact name', { duplicateEvidence: true }],
  ])('fails closed for %s', async (_label, overrides) => {
    await expect(resolve(overrides)).rejects.toThrow();
  });

  it('fails closed without a token or when the network is unavailable', async () => {
    await expect(resolveCurrentRunProvenance(baseOptions({ token: '' }))).rejects.toThrow(
      /GITHUB_TOKEN/u,
    );
    await expect(
      resolveCurrentRunProvenance(
        baseOptions({ fetchImpl: vi.fn().mockRejectedValue(new Error('offline')) }),
      ),
    ).rejects.toThrow(/failed closed/u);
  });
});

function resolve(overrides) {
  const data = responses(overrides);
  const fetchImpl = vi.fn(async (url) => {
    const match = [...data.entries()].find(([suffix]) => String(url).endsWith(suffix));
    return match ? response(match[1]) : response({ message: 'not found' }, 404);
  });
  return resolveCurrentRunProvenance(baseOptions({ fetchImpl }));
}

function baseOptions(overrides = {}) {
  return {
    releaseId,
    repository,
    runId: '123',
    runAttempt: 2,
    headSha,
    candidateArtifactId: '456',
    evidenceArtifactId: '789',
    token: 'token',
    ...overrides,
  };
}

function responses(overrides = {}) {
  const run = {
    id: 123,
    path: '.github/workflows/ci.yml@refs/heads/main',
    event: 'workflow_dispatch',
    head_branch: 'main',
    head_sha: headSha,
    status: 'in_progress',
    conclusion: null,
    run_attempt: 2,
    repository: { id: 10, full_name: repository },
    head_repository: { id: 10 },
    ...overrides.run,
  };
  const workflowRun = { id: 123, head_sha: headSha, repository_id: 10, head_repository_id: 10 };
  const candidate = {
    id: 456,
    name: 'jotluck-windows-candidate',
    expired: false,
    size_in_bytes: 1024,
    digest: `sha256:${'1'.repeat(64)}`,
    workflow_run: workflowRun,
  };
  const evidence = {
    id: 789,
    name: `jotluck-installed-app-evidence-v2-${releaseId}`,
    expired: false,
    size_in_bytes: 2048,
    digest: `sha256:${'2'.repeat(64)}`,
    workflow_run: workflowRun,
    ...overrides.evidence,
  };
  const artifacts = [candidate, evidence];
  if (overrides.duplicateEvidence) artifacts.push({ ...evidence, id: 790 });
  return new Map([
    ['/actions/runs/123', run],
    [
      '/actions/runs/123/jobs?filter=latest&per_page=100',
      jobs(overrides.failJob, overrides.failStep),
    ],
    ['/actions/runs/123/artifacts?per_page=100', { total_count: artifacts.length, artifacts }],
  ]);
}

function jobs(failJob, failStep) {
  const definitions = [
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
  ];
  return {
    total_count: definitions.length,
    jobs: definitions.map(([name, steps]) => ({
      name,
      status: 'completed',
      conclusion: name === failJob ? 'failure' : 'success',
      steps: steps.map((step) => ({
        name: step,
        status: 'completed',
        conclusion: step === failStep ? 'failure' : 'success',
      })),
    })),
  };
}

function response(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => value };
}
