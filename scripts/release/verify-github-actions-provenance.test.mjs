import { describe, expect, it, vi } from 'vitest';
import { verifyGitHubActionsProvenance } from './verify-github-actions-provenance.mjs';

const commit = 'a'.repeat(40);
const repository = 'fixture/jotluck';
const releaseId = '0.1.0-preview-candidate';
const manifest = {
  candidate: { commit },
  ci: {
    provider: 'github-actions',
    repository,
    runId: '123',
    runAttempt: 2,
    candidateArtifact: {
      id: '456',
      name: 'jotluck-windows-candidate',
      digest: `sha256:${'1'.repeat(64)}`,
    },
    evidenceArtifact: {
      id: '789',
      name: `jotluck-installed-app-evidence-v2-${releaseId}`,
      digest: `sha256:${'2'.repeat(64)}`,
    },
  },
};

describe('GitHub Actions installed-app provenance', () => {
  it('accepts one successful main workflow run with both fixed artifacts', async () => {
    await expect(verify({})).resolves.toMatchObject({
      runId: '123',
      candidateArtifactId: '456',
      evidenceArtifactId: '789',
    });
  });

  it.each([
    ['wrong workflow', { run: { path: '.github/workflows/other.yml@refs/heads/main' } }],
    ['wrong event', { run: { event: 'push' } }],
    ['stale commit', { run: { head_sha: 'b'.repeat(40) } }],
    ['failed run', { run: { conclusion: 'failure' } }],
    ['wrong attempt', { run: { run_attempt: 1 } }],
    [
      'failed required job',
      {
        jobs: {
          jobs: [
            {
              name: 'Lint & Type Check',
              status: 'completed',
              conclusion: 'failure',
              steps: [],
            },
          ],
        },
      },
    ],
    ['expired artifact', { evidenceArtifact: { expired: true } }],
    [
      'artifact from another run',
      {
        evidenceArtifact: {
          workflow_run: {
            id: 122,
            head_sha: commit,
            repository_id: 10,
            head_repository_id: 10,
          },
        },
      },
    ],
    ['wrong artifact digest', { evidenceArtifact: { digest: `sha256:${'3'.repeat(64)}` } }],
  ])('rejects %s', async (_label, overrides) => {
    await expect(verify(overrides)).rejects.toThrow();
  });

  it('fails closed without a token', async () => {
    await expect(
      verifyGitHubActionsProvenance({ manifest, releaseId, repository, token: '' }),
    ).rejects.toThrow(/GITHUB_TOKEN/u);
  });

  it('rejects a manifest repository different from the formal gate repository', async () => {
    await expect(
      verifyGitHubActionsProvenance({
        manifest,
        releaseId,
        repository: 'other/jotluck',
        token: 'token',
        fetchImpl: vi.fn(),
      }),
    ).rejects.toThrow(/repository/u);
  });

  it('fails closed when GitHub REST is unavailable', async () => {
    await expect(
      verifyGitHubActionsProvenance({
        manifest,
        releaseId,
        repository,
        token: 'token',
        fetchImpl: vi.fn().mockRejectedValue(new Error('offline')),
      }),
    ).rejects.toThrow(/failed closed/u);
  });
});

function verify(overrides) {
  const responses = makeResponses(overrides);
  const fetchImpl = vi.fn(async (url) => {
    const value = [...responses.entries()].find(([suffix]) => String(url).endsWith(suffix))?.[1];
    if (!value) return response({ message: 'not found' }, 404);
    return response(value);
  });
  return verifyGitHubActionsProvenance({
    manifest,
    releaseId,
    repository,
    token: 'token',
    fetchImpl,
  });
}

function makeResponses(overrides = {}) {
  const run = {
    id: 123,
    path: '.github/workflows/ci.yml@refs/heads/main',
    event: 'workflow_dispatch',
    head_branch: 'main',
    head_sha: commit,
    status: 'completed',
    conclusion: 'success',
    run_attempt: 2,
    repository: { id: 10, full_name: repository },
    head_repository: { id: 10 },
    ...overrides.run,
  };
  const artifactBase = {
    expired: false,
    size_in_bytes: 1024,
    workflow_run: {
      id: 123,
      head_sha: commit,
      repository_id: 10,
      head_repository_id: 10,
    },
  };
  return new Map([
    ['/repos/fixture/jotluck/actions/runs/123', run],
    [
      '/repos/fixture/jotluck/actions/runs/123/jobs?filter=latest&per_page=100',
      overrides.jobs ?? jobs(),
    ],
    [
      '/repos/fixture/jotluck/actions/artifacts/456',
      {
        ...artifactBase,
        id: 456,
        name: 'jotluck-windows-candidate',
        digest: `sha256:${'1'.repeat(64)}`,
        ...overrides.candidateArtifact,
      },
    ],
    [
      '/repos/fixture/jotluck/actions/artifacts/789',
      {
        ...artifactBase,
        id: 789,
        name: `jotluck-installed-app-evidence-v2-${releaseId}`,
        digest: `sha256:${'2'.repeat(64)}`,
        ...overrides.evidenceArtifact,
      },
    ],
  ]);
}

function jobs() {
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
    jobs: definitions.map(([name, steps]) => ({
      name,
      status: 'completed',
      conclusion: 'success',
      steps: steps.map((step) => ({ name: step, status: 'completed', conclusion: 'success' })),
    })),
  };
}

function response(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => value,
  };
}
