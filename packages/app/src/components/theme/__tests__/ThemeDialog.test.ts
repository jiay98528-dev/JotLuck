import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import ThemeDialog from '../ThemeDialog.vue';
import { THEME_CENTER_SHOW_DEV_THEMES_KEY, useThemeStore } from '@/stores/theme';

function mountDialog() {
  const theme = useThemeStore();
  theme.init();
  const wrapper = mount(ThemeDialog, {
    props: { visible: true },
    attachTo: document.body,
  });
  return { theme, wrapper };
}

describe('ThemeDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    setActivePinia(createPinia());
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
});
