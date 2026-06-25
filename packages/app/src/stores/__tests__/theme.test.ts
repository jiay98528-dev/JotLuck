import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useThemeStore } from '../theme';
import {
  ACTIVE_THEME_STYLE_ID,
  DEFAULT_THEME_ID,
  INSTALLED_THEMES_STORAGE_KEY,
  LEGACY_THEME_STORAGE_KEY,
  THEME_STATE_STORAGE_KEY,
} from '@/services/ThemeRegistry';
import type { InstalledThemePack } from '@/types/theme-pack';

describe('useThemeStore theme-pack migration', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    document.getElementById(ACTIVE_THEME_STYLE_ID)?.remove();
    document.documentElement.removeAttribute('data-color-scheme');
    document.documentElement.removeAttribute('data-theme-id');
    document.documentElement.removeAttribute('data-layout-preset');
  });

  it('migrates the legacy light/dark storage key while preserving it as a mirror', () => {
    localStorage.setItem(LEGACY_THEME_STORAGE_KEY, 'dark');

    const theme = useThemeStore();
    theme.init();

    expect(theme.colorScheme).toBe('dark');
    expect(theme.activeThemeId).toBe(DEFAULT_THEME_ID);
    expect(localStorage.getItem(LEGACY_THEME_STORAGE_KEY)).toBe('dark');
    expect(JSON.parse(localStorage.getItem(THEME_STATE_STORAGE_KEY) ?? '{}')).toMatchObject({
      activeThemeId: DEFAULT_THEME_ID,
      colorScheme: 'dark',
    });
    expect(document.documentElement.getAttribute('data-color-scheme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme-id')).toBe(DEFAULT_THEME_ID);
    expect(document.documentElement.getAttribute('data-layout-preset')).toBe('winged');
  });

  it('activates built-in layout presets through html attributes', () => {
    const theme = useThemeStore();
    theme.init();

    theme.setTheme('markluck.archive');

    expect(theme.activeThemeId).toBe('markluck.archive');
    expect(theme.activeLayoutPreset).toBe('archive');
    expect(document.documentElement.getAttribute('data-theme-id')).toBe('markluck.archive');
    expect(document.documentElement.getAttribute('data-layout-preset')).toBe('archive');
    expect(document.getElementById(ACTIVE_THEME_STYLE_ID)?.textContent).toContain(
      "[data-theme-id='markluck.archive']",
    );
  });

  it('falls back to Paper when uninstalling the active imported theme', () => {
    localStorage.setItem(INSTALLED_THEMES_STORAGE_KEY, JSON.stringify([importedPack()]));

    const theme = useThemeStore();
    theme.init();
    theme.setTheme('local.test');
    theme.uninstallTheme('local.test');

    expect(theme.activeThemeId).toBe(DEFAULT_THEME_ID);
    expect(document.documentElement.getAttribute('data-theme-id')).toBe(DEFAULT_THEME_ID);
    expect(JSON.parse(localStorage.getItem(INSTALLED_THEMES_STORAGE_KEY) ?? '[]')).toEqual([]);
  });
});

function importedPack(): InstalledThemePack {
  return {
    manifest: {
      id: 'local.test',
      version: '1.0.0',
      themeApi: 1,
      runtime: 'css-v1',
      minAppVersion: '0.15.0',
      name: 'Local Test',
      author: 'Test',
      description: 'Imported test theme',
      capabilities: ['tokens', 'layout-preset'],
      layoutPreset: 'focus',
      checksums: { 'theme.css': 'sha256-local' },
    },
    css: "[data-theme-id='local.test'] { --accent: oklch(0.5 0.1 120); }",
    source: 'imported',
    installedAt: 1,
    readonly: false,
  };
}
