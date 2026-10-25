import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsDialog from '../SettingsDialog.vue';
import { APP_VERSION } from '@/config/app-meta';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
  isTauri: () => true,
}));
vi.mock('@/utils/runtime', () => ({
  isDesktopRuntime: () => false,
}));
vi.mock('@/utils/platform', () => ({
  isWindows: () => false,
  isMac: () => false,
  isLinux: () => false,
  getPlatformOS: async () => 'linux',
  initializePlatform: async () => 'linux',
  getPlatformOSSync: () => 'linux',
}));

/**
 * 设置页更新检查必须复用 useVersionCheck 的判定口径（normalizeReleaseVersion
 * 剥 v/V 前缀 + isSemVerNewer 严格 SemVer 比较），而非本地上报字符串不等比较：
 * - 同版本 -preview 预发布标签不得假阳性报"发现新版本"；
 * - 大写 V 前缀的高版本须正确识别并以剥前缀后的版本号呈现；
 * - releases/latest 404（仓库暂无正式 release）时如实呈现检查失败；
 * - 手动检查写入 24h 缓存并联动全局 hasUpdate 通知状态。
 */
describe('SettingsDialog update check reuses useVersionCheck semantics', () => {
  beforeEach(() => {
    invoke.mockReset();
    localStorage.clear();
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  /** 组件根节点是 Teleport to="body"：断言一律读真实传送目标 document.body */
  function bodyText(): string {
    return document.body.textContent ?? '';
  }

  async function openUpdatesTabAndGetCheckButton() {
    const wrapper = mount(SettingsDialog, {
      props: { visible: true },
      attachTo: document.body,
    });
    // 组件根节点是 Teleport to="body"：wrapper.findAll 穿不透传送门，须从真实 DOM 取
    const updatesTab = [...document.querySelectorAll<HTMLButtonElement>('.nav-item')].find(
      (button) => button.textContent?.trim() === '更新',
    );
    expect(updatesTab).toBeDefined();
    updatesTab!.click();
    await flushPromises();
    const checkButton = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === '立即检查更新',
    );
    expect(checkButton).toBeDefined();
    return { wrapper, checkButton: checkButton! };
  }

  it('reports the check as failed when releases/latest answers 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const { wrapper, checkButton } = await openUpdatesTabAndGetCheckButton();

    checkButton.click();
    await flushPromises();

    expect(bodyText()).toContain('检查失败，请稍后重试');
    // 失败结果不得写入版本缓存
    expect(localStorage.getItem('jotluck:version:latestInfo')).toBeNull();
    wrapper.unmount();
  });

  it('does not report a same-version prerelease tag as a new version', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: `v${APP_VERSION}-preview`,
          html_url: 'https://example.test/releases/preview',
          body: null,
        }),
      }),
    );
    const { wrapper, checkButton } = await openUpdatesTabAndGetCheckButton();

    checkButton.click();
    await flushPromises();

    // 旧本地实现 cleanVersion(tag) !== current 会假阳性报新版本
    expect(bodyText()).toContain('已是最新版本');
    expect(bodyText()).not.toContain('发现新版本');
    wrapper.unmount();
  });

  it('recognizes an uppercase-V newer prerelease tag and shows the stripped version', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: 'V0.4.0-preview',
          html_url: 'https://example.test/releases/next',
          body: 'Next preview',
        }),
      }),
    );
    const { wrapper, checkButton } = await openUpdatesTabAndGetCheckButton();

    checkButton.click();
    await flushPromises();

    expect(bodyText()).toContain('发现新版本 0.4.0-preview');
    // 大写 V 前缀必须被剥掉（normalizeReleaseVersion 口径），不得原样透出
    expect(bodyText()).not.toContain('V0.4.0');
    wrapper.unmount();
  });

  it('caches the manual check result and drives the shared hasUpdate state', async () => {
    const major = Number(APP_VERSION.split('.')[0]) + 1;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: `v${major}.0.0`,
          html_url: 'https://example.test/releases/stable',
          body: 'Stable release',
        }),
      }),
    );
    const { wrapper, checkButton } = await openUpdatesTabAndGetCheckButton();

    checkButton.click();
    await flushPromises();

    expect(bodyText()).toContain(`发现新版本 ${major}.0.0`);
    const cached = localStorage.getItem('jotluck:version:latestInfo');
    expect(cached).not.toBeNull();
    expect(JSON.parse(cached!)).toMatchObject({
      latest: `${major}.0.0`,
      releaseUrl: 'https://example.test/releases/stable',
    });
    // 手动检查联动全局通知单例（设置页外的新版本横幅同源）
    const { useVersionCheck } = await import('@/composables/useVersionCheck');
    expect(useVersionCheck().hasUpdate.value).toBe(true);
    wrapper.unmount();
  });
});
