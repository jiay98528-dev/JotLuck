import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
const openMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: openMock,
}));

import {
  TauriIPCService,
  isLikelySystemNotebookScope,
  sanitizeRecentNotebookPaths,
} from '../TauriIPCService';

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(1);
  listenMock.mockReset();
  listenMock.mockResolvedValue(vi.fn());
  openMock.mockReset();
  openMock.mockResolvedValue(null);
});

describe('TauriIPCService recent notebook sanitizer', () => {
  it('returns null when the native directory picker is cancelled', async () => {
    const service = new TauriIPCService();

    await expect(service.openNotebook()).resolves.toBeNull();
    expect(invokeMock).not.toHaveBeenCalledWith('open_notebook', expect.anything());
  });

  it('opens a selected directory and removes a failed recent root', async () => {
    const service = new TauriIPCService();
    localStorage.setItem(
      'jotluck-recent-notebooks',
      JSON.stringify(['D:/Notes/Missing', 'D:/Notes/Keep']),
    );
    openMock.mockResolvedValueOnce('D:/Notes/Selected');
    invokeMock.mockResolvedValueOnce('D:/Notes/Selected');

    await expect(service.openNotebook()).resolves.toMatchObject({
      rootPath: 'D:/Notes/Selected',
      name: 'Selected',
    });

    invokeMock.mockRejectedValueOnce(new Error('文件夹不存在'));
    await expect(service.openNotebookAt('D:/Notes/Missing')).rejects.toThrow('文件夹不存在');
    expect(JSON.parse(localStorage.getItem('jotluck-recent-notebooks') ?? '[]')).toEqual([
      'D:/Notes/Selected',
      'D:/Notes/Keep',
    ]);
  });

  it('filters system-wide folders that should not auto-open as notebooks', () => {
    expect(isLikelySystemNotebookScope('C:/Users/alice')).toBe(true);
    expect(isLikelySystemNotebookScope('C:/Users/alice/Desktop')).toBe(true);
    expect(isLikelySystemNotebookScope('C:/Users/alice/Downloads/')).toBe(true);
    expect(isLikelySystemNotebookScope('D:/')).toBe(true);
    expect(isLikelySystemNotebookScope('D:/VibeCoding/MarkLuck')).toBe(false);
  });

  it('deduplicates and preserves normal notebook paths', () => {
    const result = sanitizeRecentNotebookPaths([
      'C:/Users/alice/Desktop',
      'D:/Notes/Project',
      'D:/Notes/Project/',
      'D:/Notes/Research',
    ]);

    expect(result).toEqual(['D:/Notes/Project', 'D:/Notes/Research']);
  });

  it('promotes an external file grant without submitting a directory path', async () => {
    invokeMock.mockResolvedValueOnce('D:/Notes/Project');
    const service = new TauriIPCService();

    await expect(service.openNotebookFromExternalGrant('opaque-grant')).resolves.toMatchObject({
      rootPath: 'D:/Notes/Project',
      name: 'Project',
    });
    expect(invokeMock).toHaveBeenCalledWith('open_external_notebook', {
      accessToken: 'opaque-grant',
    });
  });
});

describe('TauriIPCService watcher lifecycle', () => {
  it('stops the native watcher when unwatchAll is called', async () => {
    const service = new TauriIPCService();
    const unlisten = vi.fn();
    listenMock.mockResolvedValueOnce(unlisten);

    await service.watch('D:/Notes', vi.fn());
    await service.unwatchAll();

    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('start_file_watcher', {
      rootPath: 'D:/Notes',
      accessToken: null,
      relativePath: null,
    });
    expect(invokeMock).toHaveBeenCalledWith('stop_file_watcher');
  });

  it('replaces the previous native watcher before watching a new root', async () => {
    const service = new TauriIPCService();

    await service.watch('D:/Notes/A', vi.fn());
    await service.watch('D:/Notes/B', vi.fn());

    expect(invokeMock.mock.calls).toEqual([
      ['start_file_watcher', { rootPath: 'D:/Notes/A', accessToken: null, relativePath: null }],
      ['stop_file_watcher'],
      ['start_file_watcher', { rootPath: 'D:/Notes/B', accessToken: null, relativePath: null }],
    ]);
  });
});

describe('TauriIPCService path boundaries', () => {
  it('does not confuse sibling directories that share a string prefix', async () => {
    const service = new TauriIPCService();

    await expect(service.isPathInNotebook('C:/Notes', 'C:/Notes/a.md')).resolves.toBe(true);
    await expect(service.isPathInNotebook('C:/Notes', 'C:/Notes2/a.md')).resolves.toBe(false);
    await expect(service.isPathInNotebook('C:/NOTES', 'c:/notes/a.md')).resolves.toBe(true);
  });
});
