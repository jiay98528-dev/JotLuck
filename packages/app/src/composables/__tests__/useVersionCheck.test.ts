import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_VERSION } from '@/config/app-meta';
import { translate } from '@/i18n';

const nextMajorVersion = `${Number(APP_VERSION.split('.')[0]) + 1}.0.0`;

describe('useVersionCheck', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('recognizes a stable release as newer than the preview build', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: `v${nextMajorVersion}`,
          html_url: 'https://example.test/releases/stable',
          body: 'Stable release',
        }),
      }),
    );
    const { useVersionCheck } = await import('../useVersionCheck');
    const versionCheck = useVersionCheck();

    await versionCheck.checkNow();

    expect(versionCheck.latestVersion.value).toBe(nextMajorVersion);
    expect(versionCheck.hasUpdate.value).toBe(true);
  });

  it('fails closed when GitHub returns an invalid release tag', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: '0.1',
          html_url: 'https://example.test/releases/invalid',
          body: null,
        }),
      }),
    );
    const { useVersionCheck } = await import('../useVersionCheck');
    const versionCheck = useVersionCheck();

    await versionCheck.checkNow();

    expect(versionCheck.hasUpdate.value).toBe(false);
    expect(versionCheck.latestVersion.value).toBe('');
    expect(versionCheck.error.value).toBe(translate('settings.updates.failed'));
    expect(versionCheck.error.value).not.toContain('invalid release tag');
  });
});
