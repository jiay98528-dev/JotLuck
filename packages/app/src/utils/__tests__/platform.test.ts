import { describe, expect, it, vi, beforeEach } from 'vitest';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...(args as [])),
  isTauri: () => true,
}));

import { getPlatformOS } from '../platform';

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
});
