import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isTauri, shellOpen } = vi.hoisted(() => ({
  isTauri: vi.fn(),
  shellOpen: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: shellOpen }));

import { openExternalUrl } from '../urlUtils';

describe('openExternalUrl', () => {
  beforeEach(() => {
    isTauri.mockReset();
    shellOpen.mockReset();
  });

  it('uses the system shell in the desktop runtime', async () => {
    isTauri.mockReturnValue(true);
    shellOpen.mockResolvedValue(undefined);

    await openExternalUrl('www.example.com');

    expect(shellOpen).toHaveBeenCalledWith('https://www.example.com');
  });

  it('opens a new browser tab on the web', () => {
    isTauri.mockReturnValue(false);
    const browserOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

    openExternalUrl('https://example.com');

    expect(browserOpen).toHaveBeenCalledWith(
      'https://example.com',
      '_blank',
      'noopener,noreferrer',
    );
    expect(shellOpen).not.toHaveBeenCalled();
    browserOpen.mockRestore();
  });
});
