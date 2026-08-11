import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ThemeDialog from '../ThemeDialog.vue';
import { THEME_CENTER_SHOW_DEV_THEMES_KEY, useThemeStore } from '@/stores/theme';

const wrappers: ReturnType<typeof mount>[] = [];

function mountDialog() {
  const theme = useThemeStore();
  theme.init();
  const wrapper = mount(ThemeDialog, {
    props: { visible: true },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  return { theme, wrapper };
}

describe('ThemeDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    while (wrappers.length > 0) wrappers.pop()?.unmount();
    document.body.replaceChildren();
  });

  it('renders as a user-facing appearance selector without developer copy', () => {
    mountDialog();

    const text = document.body.textContent ?? '';

    expect(text).toContain('选择主题');
    expect(text).toContain('当前使用');
    expect(text).toContain('主题说明');
    expect(text).toContain('导入主题文件');
    expect(text).toContain('开发者实验功能');
    expect(text).toContain('来自可信来源');
    expect(text).toContain('羽翼布局');
    expect(text).toContain('光环画布（Halo Canvas）');
    expect(text).toContain('暖纸工作台将最近笔记置于左栏');
    expect(text).not.toContain('银白云母环境');
    expect(text).toContain('光场知识舱');
    expect(text).not.toContain('能力验证台');
    expect(text).not.toContain('超级工作台');

    for (const forbidden of [
      'Theme API',
      'Provider',
      'mock',
      'catalog',
      'slots',
      'SKU',
      '授权',
      '模拟购买',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('uses real preview images for public official themes', () => {
    mountDialog();

    const images = Array.from(document.body.querySelectorAll<HTMLImageElement>('.theme-card img'));
    const sources = images.map((image) => image.getAttribute('src') ?? '');

    expect(images).toHaveLength(3);
    expect(sources.every(Boolean)).toBe(true);
    expect(sources.some((source) => source.includes('halo-canvas-preview'))).toBe(true);
  });

  it('shows developer themes only behind the local dev switch', () => {
    localStorage.setItem(THEME_CENTER_SHOW_DEV_THEMES_KEY, 'true');
    mountDialog();

    const text = document.body.textContent ?? '';

    expect(text).toContain('开发主题');
    expect(text).toContain('能力验证台');
    expect(text).toContain('超级工作台');
  });

  it('shows a localized fallback without exposing theme parser diagnostics', async () => {
    const { theme } = mountDialog();
    vi.spyOn(theme, 'importThemePack').mockRejectedValue(
      new Error('C:\\private\\broken.mltheme: invalid central directory'),
    );
    const trustInput = document.body.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    trustInput.checked = true;
    trustInput.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();
    const input = document.body.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['broken'], 'broken.mltheme')],
    });

    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();

    expect(document.body.textContent).toContain('操作失败，请重试');
    expect(document.body.textContent).not.toContain('private');
    expect(document.body.textContent).not.toContain('central directory');
  });
});
