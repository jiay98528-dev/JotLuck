import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ACTIVE_THEME_STYLE_ID, DEFAULT_THEME_ID } from '@/services/ThemeRegistry';
import { useThemeStore } from '../theme';

describe('useThemeStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    document.getElementById(ACTIVE_THEME_STYLE_ID)?.remove();
    document.documentElement.removeAttribute('data-theme-id');
    document.documentElement.removeAttribute('data-active-theme-id');
    document.documentElement.removeAttribute('data-layout-preset');
  });

  it('initializes to the default paper theme while exposing the local catalog', () => {
    const theme = useThemeStore();

    theme.init();

    expect(theme.activeThemeId).toBe(DEFAULT_THEME_ID);
    expect(theme.activeThemeLabel).toBe('羽翼布局');
    expect(theme.themes.length).toBeGreaterThanOrEqual(2);
    expect(theme.marketThemes.some((pack) => pack.manifest.id === 'markluck.ability-lab')).toBe(
      true,
    );
    expect(theme.activeChromeState.layoutPreset).toBe('winged');
    expect(document.documentElement.getAttribute('data-theme-id')).toBe(DEFAULT_THEME_ID);
    expect(document.documentElement.getAttribute('data-layout-preset')).toBe('winged');
  });

  it('previews a catalog theme without changing the active theme', () => {
    const theme = useThemeStore();

    theme.init();
    theme.previewThemeById('markluck.ability-lab');

    expect(theme.activeThemeId).toBe(DEFAULT_THEME_ID);
    expect(theme.previewThemeId).toBe('markluck.ability-lab');
    expect(theme.activeChromeState.layoutPreset).toBe('atelier');
    expect(document.documentElement.getAttribute('data-theme-id')).toBe('markluck.ability-lab');
    expect(document.documentElement.getAttribute('data-active-theme-id')).toBe(DEFAULT_THEME_ID);
  });

  it('activates and persists a catalog UX theme', () => {
    const theme = useThemeStore();

    theme.init();
    theme.activateTheme('markluck.ability-lab');

    expect(theme.activeThemeId).toBe('markluck.ability-lab');
    expect(theme.previewThemeId).toBeNull();
    expect(theme.activeUxRecipes.topbar?.slot).toBe('topbar');
    expect(document.documentElement.getAttribute('data-theme-id')).toBe('markluck.ability-lab');

    setActivePinia(createPinia());
    const restored = useThemeStore();
    restored.init();

    expect(restored.activeThemeId).toBe('markluck.ability-lab');
  });

  it('rejects switching to unknown themes', () => {
    const theme = useThemeStore();
    theme.init();

    expect(() => theme.setTheme('nonexistent-theme')).toThrow('主题不存在');
  });
});
