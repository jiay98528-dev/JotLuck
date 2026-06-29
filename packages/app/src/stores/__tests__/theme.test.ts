import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ACTIVE_THEME_STYLE_ID, DEFAULT_THEME_ID } from '@/services/ThemeRegistry';
import { THEME_CENTER_SHOW_DEV_THEMES_KEY, useThemeStore } from '../theme';

describe('useThemeStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    document.getElementById(ACTIVE_THEME_STYLE_ID)?.remove();
    document.documentElement.removeAttribute('data-theme-id');
    document.documentElement.removeAttribute('data-active-theme-id');
    document.documentElement.removeAttribute('data-layout-preset');
    document.documentElement.removeAttribute('data-drawer-shell');
  });

  it('initializes to the default paper theme while exposing only public catalog themes', () => {
    const theme = useThemeStore();

    theme.init();

    const publicIds = theme.publicCatalogThemes.map((pack) => pack.manifest.id).sort();
    const developerIds = theme.developerCatalogThemes.map((pack) => pack.manifest.id).sort();

    expect(theme.activeThemeId).toBe(DEFAULT_THEME_ID);
    expect(theme.activeThemeLabel).toBe('羽翼布局');
    expect(theme.themes.length).toBeGreaterThanOrEqual(4);
    expect(publicIds).toEqual(['markluck.lumen-field', 'paper']);
    expect(developerIds).toEqual(['markluck.ability-lab', 'markluck.super-workbench']);
    expect(theme.themeCenterCatalogThemes.map((pack) => pack.manifest.id).sort()).toEqual(
      publicIds,
    );
    expect(theme.marketThemes.some((pack) => pack.manifest.id === 'markluck.ability-lab')).toBe(
      true,
    );
    expect(theme.marketThemes.some((pack) => pack.manifest.id === 'markluck.lumen-field')).toBe(
      true,
    );
    expect(theme.activeChromeState.layoutPreset).toBe('winged');
    expect(document.documentElement.getAttribute('data-theme-id')).toBe(DEFAULT_THEME_ID);
    expect(document.documentElement.getAttribute('data-layout-preset')).toBe('winged');
    expect(document.documentElement.hasAttribute('data-drawer-shell')).toBe(false);
  });

  it('shows developer catalog themes only when the local dev switch is enabled', () => {
    localStorage.setItem(THEME_CENTER_SHOW_DEV_THEMES_KEY, 'true');
    setActivePinia(createPinia());
    const theme = useThemeStore();

    theme.init();

    expect(theme.showDeveloperThemesInCatalog).toBe(true);
    expect(theme.themeCenterCatalogThemes.map((pack) => pack.manifest.id).sort()).toEqual([
      'markluck.ability-lab',
      'markluck.lumen-field',
      'markluck.super-workbench',
      'paper',
    ]);
  });

  it('maps official preview images into manifests and installed packs', () => {
    const theme = useThemeStore();
    theme.init();

    for (const themeId of ['paper', 'markluck.lumen-field']) {
      const pack = theme.themes.find((item) => item.manifest.id === themeId);

      expect(pack?.previewImages?.length).toBe(1);
      expect(pack?.manifest.previewImages?.length).toBe(1);
      expect(pack?.manifest.previewImages?.[0]).toBe(pack?.previewImages?.[0]);
    }
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

  it('activates and persists a developer UX theme by id', () => {
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

  it('activates the lumen field single-page drawer recipe', () => {
    const theme = useThemeStore();

    theme.init();
    theme.activateTheme('markluck.lumen-field');

    expect(theme.activeThemeId).toBe('markluck.lumen-field');
    expect(theme.activeChromeState.layoutPreset).toBe('single-page');
    expect(theme.activeChromeState.workspaceIntent).toBe('studio');
    expect(theme.activeChromeState.defaultViewMode).toBe('live');
    expect(theme.activeChromeState.drawerShell).toEqual({
      left: {
        side: 'left',
        slot: 'left-wing',
        label: '文件信标',
        size: 280,
        minSize: 232,
        maxSize: 360,
      },
      right: {
        side: 'right',
        slot: 'right-wing',
        label: '知识雷达',
        size: 320,
        minSize: 260,
        maxSize: 420,
      },
      bottom: {
        side: 'bottom',
        slot: 'editor-control',
        label: '命令舱',
        size: 164,
        minSize: 124,
        maxSize: 260,
      },
    });
    expect(theme.activeTheme.manifest.slots).toEqual(
      expect.arrayContaining(['left-wing', 'right-wing', 'editor-control', 'status-bar']),
    );
    expect(document.documentElement.getAttribute('data-theme-id')).toBe('markluck.lumen-field');
    expect(document.documentElement.getAttribute('data-layout-preset')).toBe('single-page');
    expect(document.documentElement.getAttribute('data-drawer-shell')).toBe('enabled');
  });

  it('exposes the full UX plugin validation theme and commerce mock flow', async () => {
    const theme = useThemeStore();

    theme.init();
    theme.activateTheme('markluck.super-workbench');

    expect(theme.activeThemeId).toBe('markluck.super-workbench');
    expect(theme.activeTheme.manifest.slots).toContain('app-shell');
    expect(theme.activeTheme.manifest.slots).toContain('command-palette');
    expect(theme.activeTheme.manifest.slots).toContain('scratch-exit-dialog');

    const checkout = await theme.createCheckout('markluck.super-workbench');
    expect(checkout.state).toBe('local-mock');

    await theme.redeemThemeLicense({
      themeId: 'markluck.super-workbench',
      licenseKey: 'ML-SUPER',
    });

    expect(theme.entitlementFor('markluck.super-workbench').state).toBe('owned');
  });

  it('rejects switching to unknown themes', () => {
    const theme = useThemeStore();
    theme.init();

    expect(() => theme.setTheme('nonexistent-theme')).toThrow('主题不存在');
  });
});
