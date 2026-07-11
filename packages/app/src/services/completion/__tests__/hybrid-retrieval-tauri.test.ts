import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: () => true,
}));

import { TauriHybridRetrievalBackend } from '../hybrid-retrieval-backend';

describe('Tauri hybrid retrieval wire protocol', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('activates a workspace through the native single-scope command', async () => {
    invokeMock.mockResolvedValue({ operation: 'setScope', changed: true, documentCount: 0 });
    const backend = new TauriHybridRetrievalBackend();

    await backend.setWorkspaceScope('workspace-a');

    expect(invokeMock).toHaveBeenCalledWith('completion_v2_set_scope', {
      request: { workspaceScope: 'workspace-a' },
    });
  });

  it('wraps mutation DTOs under the request argument expected by Tauri commands', async () => {
    invokeMock.mockResolvedValue({ operation: 'replace', changed: true, documentCount: 1 });
    const backend = new TauriHybridRetrievalBackend();

    await backend.execute({
      operation: 'replace',
      workspaceScope: 'workspace-a',
      path: '/note.md',
      content: '项目计划需要确认。',
    });

    expect(invokeMock).toHaveBeenCalledWith('completion_v2_replace_document', {
      request: {
        workspaceScope: 'workspace-a',
        path: '/note.md',
        content: '项目计划需要确认。',
      },
    });
  });

  it('sends an atomic document batch through the native batch command', async () => {
    invokeMock.mockResolvedValue({
      operation: 'batch',
      changed: true,
      documentCount: 2,
      revision: 1,
    });
    const backend = new TauriHybridRetrievalBackend();
    const mutations = [
      {
        operation: 'replace' as const,
        workspaceScope: 'workspace-a',
        path: '/a.md',
        content: 'alpha',
      },
      {
        operation: 'replace' as const,
        workspaceScope: 'workspace-a',
        path: '/b.md',
        content: 'beta',
      },
    ];

    await backend.execute({
      operation: 'batch',
      workspaceScope: 'workspace-a',
      mutations,
    });

    expect(invokeMock).toHaveBeenCalledWith('completion_v2_apply_batch', {
      request: {
        workspaceScope: 'workspace-a',
        mutations: [
          { operation: 'replace', path: '/a.md', content: 'alpha' },
          { operation: 'replace', path: '/b.md', content: 'beta' },
        ],
      },
    });
  });

  it('accepts the native query response without allowing platform-specific fields', async () => {
    invokeMock.mockResolvedValue({
      operation: 'query',
      candidates: [
        {
          text: '需要确认。',
          confidence: 0.6,
          support: 2,
          documentSupport: 2,
          providerId: 'hybrid-retrieval-zh',
          sourceLayer: 'notebook',
        },
      ],
    });
    const backend = new TauriHybridRetrievalBackend();

    const response = await backend.execute({
      operation: 'query',
      workspaceScope: 'workspace-a',
      contextBeforeCursor: '项目计划',
      languageHint: 'zh',
      maxCandidates: 8,
    });

    expect(response).toEqual(
      expect.objectContaining({
        operation: 'query',
        candidates: [expect.objectContaining({ providerId: 'hybrid-retrieval-zh' })],
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith('completion_v2_query', {
      request: {
        workspaceScope: 'workspace-a',
        contextBeforeCursor: '项目计划',
        languageHint: 'zh',
        maxCandidates: 8,
      },
    });
  });

  it('reads native snapshot health through the diagnostics command', async () => {
    const diagnostics = {
      committedRevision: 4,
      pendingMutations: 0,
      pendingMutationBatches: 0,
      lastBuildDurationMs: 8,
      totalBuildDurationMs: 21,
      inputBytes: 1024,
      estimatedIndexBytes: 4096,
      longTasksOver50Ms: 0,
    };
    invokeMock.mockResolvedValue(diagnostics);
    const backend = new TauriHybridRetrievalBackend();

    await expect(backend.readHealthDiagnostics('workspace-a')).resolves.toEqual(diagnostics);
    expect(invokeMock).toHaveBeenCalledWith('completion_v2_diagnostics', {
      workspaceScope: 'workspace-a',
    });
  });
});
