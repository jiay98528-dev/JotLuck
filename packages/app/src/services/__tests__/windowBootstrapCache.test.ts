import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getWindowBootstrap, invalidateWindowBootstrap } from '../windowBootstrapCache';

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

function bootstrapCalls(): number {
  return invoke.mock.calls.filter(([command]) => command === 'get_window_bootstrap').length;
}

describe('windowBootstrapCache', () => {
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

    await expect(getWindowBootstrap()).rejects.toThrow('ipc down');
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
