import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelDocumentConversion,
  enableExternalEdit,
  getWindowBootstrap,
  invalidateWindowBootstrap,
  promoteExternalFileToNotebook,
  startDocumentConversion,
} from '../windowSession';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const readonlyPayload = {
  mode: 'external-readonly',
  openedFile: {
    absolutePath: 'D:/notes/plain.md',
    relativePath: '/plain.md',
    accessToken: 'token',
  },
};

const workspacePayload = { mode: 'workspace' };

const promotedPayload = { rootPath: 'D:/notes', name: 'notes', initialRelativePath: '/plain.md' };

function bootstrapCalls(): number {
  return invoke.mock.calls.filter(([command]) => command === 'get_window_bootstrap').length;
}

describe('windowSession bootstrap cache', () => {
  beforeEach(() => {
    invoke.mockReset();
    invalidateWindowBootstrap();
  });

  it('shares one IPC request across callers within the window', async () => {
    invoke.mockResolvedValue(readonlyPayload);

    const first = getWindowBootstrap();
    const second = getWindowBootstrap();

    expect(second).toBe(first);
    await expect(first).resolves.toEqual(readonlyPayload);
    expect(bootstrapCalls()).toBe(1);
  });

  it('does not cache IPC failures so the next call retries', async () => {
    invoke.mockRejectedValueOnce(new Error('ipc down')).mockResolvedValue(readonlyPayload);

    // 收口后错误经 normalizeCommandError 归一为 CommandError，原始信息进 diagnostic。
    await expect(getWindowBootstrap()).rejects.toMatchObject({
      name: 'CommandError',
      diagnostic: 'ipc down',
    });
    await expect(getWindowBootstrap()).resolves.toEqual(readonlyPayload);

    expect(bootstrapCalls()).toBe(2);
  });

  it('re-invokes after invalidation and resolves the fresh payload', async () => {
    invoke.mockResolvedValueOnce(readonlyPayload).mockResolvedValueOnce(workspacePayload);

    await expect(getWindowBootstrap()).resolves.toEqual(readonlyPayload);
    invalidateWindowBootstrap();
    await expect(getWindowBootstrap()).resolves.toEqual(workspacePayload);

    expect(bootstrapCalls()).toBe(2);
  });

  it('repeated invalidation is idempotent and spawns no extra IPC', async () => {
    invoke.mockResolvedValue(readonlyPayload);

    await getWindowBootstrap();
    invalidateWindowBootstrap();
    invalidateWindowBootstrap();
    await getWindowBootstrap();

    expect(bootstrapCalls()).toBe(2);
  });

  it('keeps the fresh cache entry when a stale in-flight request fails after invalidation', async () => {
    let rejectStale: ((error: Error) => void) | undefined;
    invoke
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectStale = reject;
          }),
      )
      .mockResolvedValueOnce(workspacePayload)
      .mockResolvedValue(workspacePayload);

    void getWindowBootstrap();
    invalidateWindowBootstrap();
    await expect(getWindowBootstrap()).resolves.toEqual(workspacePayload);
    expect(bootstrapCalls()).toBe(2);

    rejectStale?.(new Error('stale failure'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(getWindowBootstrap()).resolves.toEqual(workspacePayload);
    expect(bootstrapCalls()).toBe(2);
  });
});

describe('windowSession identity commands', () => {
  beforeEach(() => {
    invoke.mockReset();
    invalidateWindowBootstrap();
  });

  it('enableExternalEdit invalidates the bootstrap cache after success', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'get_window_bootstrap') return readonlyPayload;
      if (command === 'enable_external_edit') return undefined;
      throw new Error(`unexpected command: ${command}`);
    });

    await getWindowBootstrap();
    expect(bootstrapCalls()).toBe(1);

    await enableExternalEdit();
    expect(invoke).toHaveBeenCalledWith('enable_external_edit');

    await getWindowBootstrap();
    expect(bootstrapCalls()).toBe(2);
  });

  it('enableExternalEdit keeps the cache when the command fails', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'get_window_bootstrap') return readonlyPayload;
      if (command === 'enable_external_edit') throw new Error('ipc down');
      throw new Error(`unexpected command: ${command}`);
    });

    await getWindowBootstrap();
    await expect(enableExternalEdit()).rejects.toMatchObject({ name: 'CommandError' });

    await getWindowBootstrap();
    expect(bootstrapCalls()).toBe(1);
  });

  it('promoteExternalFileToNotebook invalidates the bootstrap cache after success', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'get_window_bootstrap') return readonlyPayload;
      if (command === 'promote_external_file_to_notebook') return promotedPayload;
      throw new Error(`unexpected command: ${command}`);
    });

    await getWindowBootstrap();
    expect(bootstrapCalls()).toBe(1);

    await expect(promoteExternalFileToNotebook()).resolves.toEqual(promotedPayload);

    await getWindowBootstrap();
    expect(bootstrapCalls()).toBe(2);
  });

  it('promoteExternalFileToNotebook keeps the cache when the command fails', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'get_window_bootstrap') return readonlyPayload;
      if (command === 'promote_external_file_to_notebook') throw new Error('ipc down');
      throw new Error(`unexpected command: ${command}`);
    });

    await getWindowBootstrap();
    await expect(promoteExternalFileToNotebook()).rejects.toMatchObject({
      name: 'CommandError',
    });

    await getWindowBootstrap();
    expect(bootstrapCalls()).toBe(1);
  });
});

describe('windowSession document import passthrough', () => {
  beforeEach(() => {
    invoke.mockReset();
    invalidateWindowBootstrap();
  });

  it('passes the caller-held Channel through to start_document_conversion', async () => {
    invoke.mockResolvedValue('conversion-1');
    const channel = { onmessage: null } as unknown as Parameters<typeof startDocumentConversion>[0];

    await expect(startDocumentConversion(channel)).resolves.toBe('conversion-1');
    expect(invoke).toHaveBeenCalledWith('start_document_conversion', { channel });
  });

  it('forwards the conversion id to cancel_document_conversion', async () => {
    invoke.mockResolvedValue(undefined);

    await expect(cancelDocumentConversion('conversion-9')).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith('cancel_document_conversion', {
      conversionId: 'conversion-9',
    });
  });
});
