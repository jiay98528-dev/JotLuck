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
    expect(theme.themes.length).toBeGreaterThanOrEqual(5);
    expect(publicIds).toEqual(['jotluck.halo-canvas', 'jotluck.lumen-field', 'paper']);
    expect(developerIds).toEqual(['jotluck.ability-lab', 'jotluck.super-workbench']);
    expect(theme.themeCenterCatalogThemes.map((pack) => pack.manifest.id).sort()).toEqual(
      publicIds,
    );
    expect(theme.marketThemes.some((pack) => pack.manifest.id === 'jotluck.ability-lab')).toBe(
      true,
    );
    expect(theme.marketThemes.some((pack) => pack.manifest.id === 'jotluck.lumen-field')).toBe(
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
      'jotluck.ability-lab',
      'jotluck.halo-canvas',
      'jotluck.lumen-field',
      'jotluck.super-workbench',
      'paper',
    ]);
  });

  it('maps official preview images into manifests and installed packs', () => {
    const theme = useThemeStore();
    theme.init();

    for (const themeId of ['paper', 'jotluck.halo-canvas', 'jotluck.lumen-field']) {
      const pack = theme.themes.find((item) => item.manifest.id === themeId);

      expect(pack?.previewImages?.length).toBe(1);
      expect(pack?.manifest.previewImages?.length).toBe(1);
      expect(pack?.manifest.previewImages?.[0]).toBe(pack?.previewImages?.[0]);
    }
  });

  it('previews a catalog theme without changing the active theme', () => {
    const theme = useThemeStore();

    theme.init();
    theme.previewThemeById('jotluck.ability-lab');

    expect(theme.activeThemeId).toBe(DEFAULT_THEME_ID);
    expect(theme.previewThemeId).toBe('jotluck.ability-lab');
    expect(theme.activeChromeState.layoutPreset).toBe('atelier');
    expect(document.documentElement.getAttribute('data-theme-id')).toBe('jotluck.ability-lab');
    expect(document.documentElement.getAttribute('data-active-theme-id')).toBe(DEFAULT_THEME_ID);
  });

  it('activates and persists a developer UX theme by id', () => {
    const theme = useThemeStore();

    theme.init();
    theme.activateTheme('jotluck.ability-lab');

    expect(theme.activeThemeId).toBe('jotluck.ability-lab');
    expect(theme.previewThemeId).toBeNull();
    expect(theme.activeUxRecipes.topbar?.slot).toBe('topbar');
    expect(document.documentElement.getAttribute('data-theme-id')).toBe('jotluck.ability-lab');

    setActivePinia(createPinia());
    const restored = useThemeStore();
    restored.init();

    expect(restored.activeThemeId).toBe('jotluck.ability-lab');
  });

  it('activates the lumen field single-page drawer recipe', () => {
    const theme = useThemeStore();

    theme.init();
    theme.activateTheme('jotluck.lumen-field');

    expect(theme.activeThemeId).toBe('jotluck.lumen-field');
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
    expect(document.documentElement.getAttribute('data-theme-id')).toBe('jotluck.lumen-field');
    expect(document.documentElement.getAttribute('data-layout-preset')).toBe('single-page');
    expect(document.documentElement.getAttribute('data-drawer-shell')).toBe('enabled');
  });

  it('activates Halo Canvas with persistent atelier chrome and removes its CSS on return to paper', () => {
    const theme = useThemeStore();

    theme.init();
    theme.activateTheme('jotluck.halo-canvas');

    expect(theme.activeThemeId).toBe('jotluck.halo-canvas');
    expect(theme.activeChromeState.layoutPreset).toBe('atelier');
    expect(theme.activeChromeState.workspaceIntent).toBe('atelier');
    expect(theme.activeChromeState.defaultViewMode).toBe('live');
    expect(theme.activeChromeState.drawerShell).toBeUndefined();
    expect(theme.activeTheme.manifest.slots).toEqual(
      expect.arrayContaining([
        'topbar',
        'left-wing',
        'right-wing',
        'editor-control',
        'status-bar',
        'workflow-canvas',
        'editor-surface',
        'external-reader',
      ]),
    );
    expect(theme.activeTheme.manifest.slots).not.toEqual(
      expect.arrayContaining(['dialogs.theme', 'file-drawer', 'command-palette']),
    );
    expect(theme.activeTheme.module?.plugin?.css).toBeUndefined();
    expect(theme.activeTheme.css).toContain("[data-theme-id='jotluck.halo-canvas']");
    expect(theme.activeTheme.css).toContain(
      '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))',
    );
    expect(theme.activeTheme.css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(theme.activeTheme.css).toContain('@media (forced-colors: active)');
    expect(document.documentElement.getAttribute('data-theme-id')).toBe('jotluck.halo-canvas');
    expect(document.documentElement.hasAttribute('data-drawer-shell')).toBe(false);
    expect(document.getElementById(ACTIVE_THEME_STYLE_ID)?.textContent).toContain('halo-canvas');

    theme.activateTheme(DEFAULT_THEME_ID);

    expect(document.documentElement.getAttribute('data-theme-id')).toBe(DEFAULT_THEME_ID);
    expect(document.documentElement.hasAttribute('data-drawer-shell')).toBe(false);
    expect(document.getElementById(ACTIVE_THEME_STYLE_ID)?.textContent).not.toContain(
      'halo-canvas',
    );
  });

  it('exposes the full UX plugin validation theme and commerce mock flow', async () => {
    const theme = useThemeStore();

    theme.init();
    theme.activateTheme('jotluck.super-workbench');

    expect(theme.activeThemeId).toBe('jotluck.super-workbench');
    expect(theme.activeTheme.manifest.slots).toContain('app-shell');
    expect(theme.activeTheme.manifest.slots).toContain('command-palette');
    expect(theme.activeTheme.manifest.slots).toContain('scratch-exit-dialog');

    const checkout = await theme.createCheckout('jotluck.super-workbench');
    expect(checkout.state).toBe('local-mock');

    await theme.redeemThemeLicense({
      themeId: 'jotluck.super-workbench',
      licenseKey: 'ML-SUPER',
    });

    expect(theme.entitlementFor('jotluck.super-workbench').state).toBe('owned');
  });

  it('rejects switching to unknown themes', () => {
    const theme = useThemeStore();
    theme.init();

    expect(() => theme.setTheme('nonexistent-theme')).toThrow('主题不存在');
  });
});
