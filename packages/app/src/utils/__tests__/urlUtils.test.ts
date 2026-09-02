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
  });

  it('opens a new browser tab on the web', async () => {
    isTauri.mockReturnValue(false);

    await openExternalUrl('https://example.com');

    expect(browserOpen).toHaveBeenCalledWith(
      'https://example.com',
      '_blank',
      'noopener,noreferrer',
    );
    expect(shellOpen).not.toHaveBeenCalled();
  });

  it('falls back to window.open when the shell open rejects on desktop', async () => {
    isTauri.mockReturnValue(true);
    shellOpen.mockRejectedValue(new Error('not allowed'));
    browserOpen.mockImplementation(() => ({}) as WindowProxy);

    await openExternalUrl('https://example.com');

    expect(shellOpen).toHaveBeenCalledWith('https://example.com');
    expect(browserOpen).toHaveBeenCalledWith(
      'https://example.com',
      '_blank',
      'noopener,noreferrer',
    );
    expect(consoleError).toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('reports a user-visible failure when desktop shell and window.open both fail', async () => {
    isTauri.mockReturnValue(true);
    shellOpen.mockRejectedValue(new Error('os refused'));

    const settled = await openExternalUrl('https://example.com');

    expect(settled).toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
  });

  it('reports a failure when the web runtime blocks window.open', async () => {
    isTauri.mockReturnValue(false);

    await openExternalUrl('https://example.com');

    expect(consoleError).toHaveBeenCalled();
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
  });
});
