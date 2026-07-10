import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));

import {
  TauriIPCService,
  isLikelySystemNotebookScope,
  sanitizeRecentNotebookPaths,
} from '../TauriIPCService';

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  listenMock.mockReset();
  listenMock.mockResolvedValue(vi.fn());
});

describe('TauriIPCService recent notebook sanitizer', () => {
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
});

describe('TauriIPCService watcher lifecycle', () => {
  it('stops the native watcher when unwatchAll is called', async () => {
    const service = new TauriIPCService();
    const unlisten = vi.fn();
    listenMock.mockResolvedValueOnce(unlisten);

    await service.watch('D:/Notes', vi.fn());
    await service.unwatchAll();

    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('start_file_watcher', { rootPath: 'D:/Notes' });
    expect(invokeMock).toHaveBeenCalledWith('stop_file_watcher');
  });

  it('replaces the previous native watcher before watching a new root', async () => {
    const service = new TauriIPCService();

    await service.watch('D:/Notes/A', vi.fn());
    await service.watch('D:/Notes/B', vi.fn());

    expect(invokeMock.mock.calls).toEqual([
      ['start_file_watcher', { rootPath: 'D:/Notes/A' }],
      ['stop_file_watcher'],
      ['start_file_watcher', { rootPath: 'D:/Notes/B' }],
    ]);
  });
});
