import { describe, expect, it, vi, beforeEach } from 'vitest';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...(args as [])),
  isTauri: () => true,
}));

import { formatShortcut, getPlatformOS } from '../platform';

describe('platform detection', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    vi.resetModules();
  });

  it('returns the OS reported by the backend', async () => {
    invokeMock.mockResolvedValue('linux');
    await expect(getPlatformOS()).resolves.toBe('linux');
    expect(invokeMock).toHaveBeenCalledWith('platform_os');
  });

  it('falls back to navigator detection when the invoke fails', async () => {
    invokeMock.mockRejectedValue(new Error('unavailable'));
    await expect(getPlatformOS()).resolves.toBeTypeOf('string');
  });

  it('rewrites Ctrl tokens to Command only on macOS', () => {
    expect(formatShortcut('加粗 (Ctrl+B)', 'macos')).toBe('加粗 (⌘B)');
    expect(formatShortcut('加粗 (Ctrl+B)', 'windows')).toBe('加粗 (Ctrl+B)');
    expect(formatShortcut('加粗 (Ctrl+B)', 'linux')).toBe('加粗 (Ctrl+B)');
    // mac-port 合并增强：Shift 组合与双写按 macOS 惯例符号化
    expect(formatShortcut('Ctrl + Shift + P', 'macos')).toBe('⇧⌘P');
    expect(formatShortcut('Ctrl/Cmd + O', 'macos')).toBe('⌘O');
  });
});
