import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

const { isTauri, shellOpen, toastError } = vi.hoisted(() => ({
  isTauri: vi.fn(),
  shellOpen: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: shellOpen }));
vi.mock('@/components/common/Toast.vue', () => ({
  useToast: () => ({ error: toastError }),
}));

import { openExternalUrl } from '../urlUtils';

describe('openExternalUrl', () => {
  let browserOpen: MockInstance<typeof window.open>;
  let consoleError: MockInstance<typeof console.error>;

  beforeEach(() => {
    isTauri.mockReset();
    shellOpen.mockReset();
    toastError.mockReset();
    browserOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    browserOpen.mockRestore();
    consoleError.mockRestore();
  });

  it('uses the system shell in the desktop runtime', async () => {
    isTauri.mockReturnValue(true);
    shellOpen.mockResolvedValue(undefined);

    await openExternalUrl('www.example.com');

    expect(shellOpen).toHaveBeenCalledWith('https://www.example.com');
    expect(browserOpen).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('opens a new browser tab on the web without misreading the noopener null return', async () => {
    isTauri.mockReturnValue(false);

    await openExternalUrl('https://example.com');

    expect(browserOpen).toHaveBeenCalledWith(
      'https://example.com',
      '_blank',
      'noopener,noreferrer',
    );
    expect(shellOpen).not.toHaveBeenCalled();
    // noopener 下成功也返回 null：不允许据此误报失败
    expect(toastError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('reports a user-visible failure when the desktop shell open rejects', async () => {
    isTauri.mockReturnValue(true);
    shellOpen.mockRejectedValue(new Error('os refused'));

    await openExternalUrl('https://example.com');

    expect(shellOpen).toHaveBeenCalledWith('https://example.com');
    expect(browserOpen).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('https://example.com'));
  });

  it('does not throw and stays silent when the desktop shell resolves', async () => {
    isTauri.mockReturnValue(true);
    shellOpen.mockResolvedValue(undefined);

    await expect(openExternalUrl('mailto:?subject=hi')).resolves.toBeUndefined();

    expect(shellOpen).toHaveBeenCalledWith('mailto:?subject=hi');
    expect(toastError).not.toHaveBeenCalled();
  });
});
