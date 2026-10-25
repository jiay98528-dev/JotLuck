import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsDialog from '../SettingsDialog.vue';
import {
  DEFAULT_EDITOR_SETTINGS,
  EDITOR_SETTINGS_KEY,
  subscribeEditorSettings,
  type EditorSettings,
} from '@/services/editor-settings';

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
  formatShortcut: (label: string) => label,
}));

/**
 * 设置页「编辑器/自动保存」六控件接线契约：
 * - 控件读写全部落 editor-settings 服务（localStorage 信封 + 事件广播），
 *   不再是本地死 ref；
 * - 默认呈现对齐接线前实际行为（自动保存延迟 600ms）；
 * - 控件操作后外部订阅者（NotebookHome 镜像）能收到规范化后的新设置。
 */
describe('SettingsDialog editor/autosave controls persist via editor-settings', () => {
  beforeEach(() => {
    invoke.mockReset();
    localStorage.clear();
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  function readStoredSettings(): EditorSettings {
    const raw = localStorage.getItem(EDITOR_SETTINGS_KEY);
    expect(raw).not.toBeNull();
    const envelope = JSON.parse(raw!) as { version: number; settings: EditorSettings };
    expect(envelope.version).toBe(1);
    return envelope.settings;
  }

  function navToTab(label: string): void {
    const tab = [...document.querySelectorAll<HTMLButtonElement>('.nav-item')].find(
      (button) => button.textContent?.trim() === label,
    );
    expect(tab).toBeDefined();
    tab!.click();
  }

  function findSwitchByLabel(label: string): HTMLElement {
    const switches = [...document.querySelectorAll<HTMLElement>('[role="switch"]')];
    const target = switches.find((element) => element.getAttribute('aria-label') === label);
    expect(target).toBeDefined();
    return target!;
  }

  function findSliderByLabel(label: string): HTMLInputElement {
    const selector = `input[type="range"][aria-label="${label}"]`;
    const slider = document.querySelector<HTMLInputElement>(selector);
    expect(slider).not.toBeNull();
    return slider!;
  }

  async function mountDialog() {
    const wrapper = mount(SettingsDialog, {
      props: { visible: true },
      attachTo: document.body,
    });
    await flushPromises();
    return wrapper;
  }

  it('自动保存页默认呈现 600ms（对齐接线前 600ms 硬编码现状，非死 UI 时代的 3000）', async () => {
    const wrapper = await mountDialog();
    navToTab('自动保存');

    expect(document.body.textContent).toContain('600ms');
    wrapper.unmount();
  });

  it('持久化设置在打开时回显到控件（信封读取链）', async () => {
    localStorage.setItem(
      EDITOR_SETTINGS_KEY,
      JSON.stringify({
        version: 1,
        settings: { ...DEFAULT_EDITOR_SETTINGS, autoSaveDelay: 1500, fontSize: 20 },
      }),
    );
    const wrapper = await mountDialog();
    navToTab('自动保存');

    expect(findSliderByLabel('保存延迟').value).toBe('1500');
    wrapper.unmount();
  });

  it('Tab 宽度切到 4：写信封 + 广播事件，订阅者收到 tabSize=4', async () => {
    const received: EditorSettings[] = [];
    const unsubscribe = subscribeEditorSettings((settings) => received.push(settings));
    const wrapper = await mountDialog();
    navToTab('编辑器');

    const tabButton = [...document.querySelectorAll<HTMLButtonElement>('.segment-btn')].find(
      (button) => button.textContent?.trim() === '4',
    );
    expect(tabButton).toBeDefined();
    tabButton!.click();
    await flushPromises();

    expect(readStoredSettings().tabSize).toBe(4);
    expect(received.at(-1)?.tabSize).toBe(4);
    unsubscribe();
    wrapper.unmount();
  });

  it('字号滑杆拖动：即时写服务并钳制回滑杆边界', async () => {
    const wrapper = await mountDialog();
    navToTab('编辑器');

    const slider = findSliderByLabel('字体大小');
    slider.value = '20';
    slider.dispatchEvent(new Event('input'));
    await flushPromises();

    expect(readStoredSettings().fontSize).toBe(20);

    // range 输入受滑杆 max=24 约束：越界拖动落库值不超边界（服务层钳制另有单测）
    slider.value = '99';
    slider.dispatchEvent(new Event('input'));
    await flushPromises();

    expect(readStoredSettings().fontSize).toBe(24);
    wrapper.unmount();
  });

  it('自动换行开关关闭：持久化 false 并广播；重开对话框仍回显关闭态', async () => {
    const events: EditorSettings[] = [];
    const unsubscribe = subscribeEditorSettings((settings) => events.push(settings));
    const wrapper = await mountDialog();
    navToTab('编辑器');

    findSwitchByLabel('自动换行').click();
    await flushPromises();

    expect(readStoredSettings().wordWrap).toBe(false);
    expect(events.at(-1)?.wordWrap).toBe(false);

    wrapper.unmount();
    const remount = await mountDialog();
    navToTab('编辑器');
    expect(findSwitchByLabel('自动换行').getAttribute('aria-checked')).toBe('false');
    remount.unmount();
    unsubscribe();
  });

  it('关闭自动保存：持久化 autoSaveEnabled=false（保存管线将停止排程）', async () => {
    const wrapper = await mountDialog();
    navToTab('自动保存');

    findSwitchByLabel('启用自动保存').click();
    await flushPromises();

    const stored = readStoredSettings();
    expect(stored.autoSaveEnabled).toBe(false);
    // 延迟滑杆随开关禁用（既有 UI 行为不动），值本身保留
    expect(stored.autoSaveDelay).toBe(600);
    wrapper.unmount();
  });
});
