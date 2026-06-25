import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useThemeStore } from '../theme';
import {
  ACTIVE_THEME_STYLE_ID,
  DEFAULT_THEME_ID,
  INSTALLED_THEMES_STORAGE_KEY,
  LEGACY_THEME_STORAGE_KEY,
  THEME_PERFORMANCE_BADGES,
  THEME_STATE_STORAGE_KEY,
  getThemePerformanceBadge,
} from '@/services/ThemeRegistry';
import type { InstalledThemePack, ThemeChromeState } from '@/types/theme-pack';

describe('useThemeStore theme-pack migration', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    document.getElementById(ACTIVE_THEME_STYLE_ID)?.remove();
    document.documentElement.removeAttribute('data-color-scheme');
    document.documentElement.removeAttribute('data-theme-id');
    document.documentElement.removeAttribute('data-layout-preset');
    document.documentElement.removeAttribute('data-theme-role');
    document.documentElement.removeAttribute('data-effect-profile');
    document.documentElement.removeAttribute('data-theme-performance');
    document.documentElement.removeAttribute('data-chrome-topbar');
    document.documentElement.removeAttribute('data-chrome-left-wing');
    document.documentElement.removeAttribute('data-chrome-right-wing');
    document.documentElement.removeAttribute('data-chrome-toolbar');
    document.documentElement.removeAttribute('data-chrome-reading');
    document.documentElement.removeAttribute('data-workspace-intent');
    document.documentElement.removeAttribute('data-default-view-mode');
    document.documentElement.removeAttribute('data-topbar-layout');
    document.documentElement.removeAttribute('data-left-wing-layout');
    document.documentElement.removeAttribute('data-editor-control-layout');
    document.documentElement.removeAttribute('data-status-layout');
    document.documentElement.removeAttribute('data-right-wing-policy');
  });

  it('migrates the legacy light/dark storage key while preserving it as a mirror', () => {
    localStorage.setItem(LEGACY_THEME_STORAGE_KEY, 'dark');

    const theme = useThemeStore();
    theme.init();

    expect(theme.colorScheme).toBe('dark');
    expect(theme.activeThemeId).toBe(DEFAULT_THEME_ID);
    expect(theme.activeThemeLabel).toBe('羽翼布局');
    expect(localStorage.getItem(LEGACY_THEME_STORAGE_KEY)).toBe('dark');
    expect(JSON.parse(localStorage.getItem(THEME_STATE_STORAGE_KEY) ?? '{}')).toMatchObject({
      activeThemeId: DEFAULT_THEME_ID,
      colorScheme: 'dark',
    });
    expect(document.documentElement.getAttribute('data-color-scheme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme-id')).toBe(DEFAULT_THEME_ID);
    expect(document.documentElement.getAttribute('data-layout-preset')).toBe('winged');
    expect(document.documentElement.getAttribute('data-theme-role')).toBe('baseline');
    expect(document.documentElement.getAttribute('data-effect-profile')).toBe('none');
    expect(document.documentElement.getAttribute('data-theme-performance')).toBe('1');
    expect(document.documentElement.getAttribute('data-workspace-intent')).toBe('baseline');
    expect(document.documentElement.getAttribute('data-default-view-mode')).toBe('live');
    expect(document.documentElement.getAttribute('data-topbar-layout')).toBe('classic');
    expect(theme.activeChromeState).toMatchObject({
      official: true,
      layoutPreset: 'winged',
      topBarVariant: 'balanced',
      leftWingMode: 'default',
      rightWingMode: 'balanced',
      toolbarDensity: 'calm',
      rightWingSections: ['outline', 'backlinks', 'tags'],
      defaultOpenSections: ['outline', 'tags'],
      workspaceIntent: 'baseline',
      defaultViewMode: 'live',
      topBarLayout: 'classic',
      leftWingLayout: 'bookmarks',
      editorControlLayout: 'toolbar',
      statusLayout: 'full',
      rightWingPolicy: 'outline',
      actionPlacements: expect.objectContaining({
        'new-note': 'left-wing',
        'file-drawer': 'topbar-left',
        search: 'topbar-right',
        template: 'editor-control',
        export: 'topbar-right',
        share: 'topbar-right',
        settings: 'left-wing',
        'theme-toggle': 'topbar-right',
        'view-toggle': 'editor-control',
      }),
    });
  });

  it('maps every official built-in theme to full workflow chrome', () => {
    const theme = useThemeStore();
    theme.init();

    expect(theme.officialThemes).toHaveLength(5);
    expect(theme.themeViewModels.map((item) => item.name)).toEqual([
      '羽翼布局',
      '墨线书房',
      '档案馆',
      '夜读星幕',
      '工坊轨道',
    ]);

    const cases: Array<{
      id: string;
      label: string;
      layoutPreset: ThemeChromeState['layoutPreset'];
      role: ThemeChromeState['role'];
      performanceName: string;
      effectProfile: ThemeChromeState['effectProfile'];
      chrome: Partial<ThemeChromeState>;
    }> = [
      {
        id: 'paper',
        label: '羽翼布局',
        layoutPreset: 'winged',
        role: 'baseline',
        performanceName: '轻盈',
        effectProfile: 'none',
        chrome: {
          workspaceIntent: 'baseline',
          defaultViewMode: 'live',
          topBarLayout: 'classic',
          leftWingLayout: 'bookmarks',
          editorControlLayout: 'toolbar',
          statusLayout: 'full',
          rightWingPolicy: 'outline',
          actionPlacements: expect.objectContaining({
            'new-note': 'left-wing',
            'file-drawer': 'topbar-left',
            search: 'topbar-right',
            template: 'editor-control',
            export: 'topbar-right',
            share: 'topbar-right',
            settings: 'left-wing',
            'theme-toggle': 'topbar-right',
            'view-toggle': 'editor-control',
          }),
        },
      },
      {
        id: 'markluck.ink-study',
        label: '墨线书房',
        layoutPreset: 'focus',
        role: 'collectible',
        performanceName: '增强',
        effectProfile: 'ambient',
        chrome: {
          workspaceIntent: 'writing',
          defaultViewMode: 'live',
          topBarLayout: 'title-first',
          leftWingLayout: 'quiet-bookmarks',
          editorControlLayout: 'writing-strip',
          statusLayout: 'quiet',
          rightWingPolicy: 'collapsed',
          defaultOpenSections: ['outline'],
          actionPlacements: expect.objectContaining({
            search: 'topbar-right',
            template: 'editor-control',
            export: 'topbar-right',
            share: 'hidden',
            'view-toggle': 'editor-control',
          }),
        },
      },
      {
        id: 'markluck.archive',
        label: '档案馆',
        layoutPreset: 'archive',
        role: 'workflow',
        performanceName: '标准',
        effectProfile: 'subtle',
        chrome: {
          workspaceIntent: 'archive',
          defaultViewMode: 'split',
          topBarLayout: 'search-first',
          leftWingLayout: 'research-stack',
          editorControlLayout: 'toolbar',
          statusLayout: 'full',
          rightWingPolicy: 'research',
          rightWingSections: ['backlinks', 'tags', 'outline'],
          defaultOpenSections: ['backlinks', 'tags'],
          actionPlacements: expect.objectContaining({
            search: 'topbar-center',
            template: 'hidden',
            export: 'topbar-right',
            share: 'topbar-right',
            'view-toggle': 'editor-control',
          }),
        },
      },
      {
        id: 'markluck.reader-nocturne',
        label: '夜读星幕',
        layoutPreset: 'reader',
        role: 'collectible',
        performanceName: '沉浸',
        effectProfile: 'immersive',
        chrome: {
          workspaceIntent: 'reader',
          defaultViewMode: 'read',
          topBarLayout: 'reader',
          leftWingLayout: 'quiet-bookmarks',
          editorControlLayout: 'hidden',
          statusLayout: 'save-only',
          rightWingPolicy: 'collapsed',
          actionPlacements: expect.objectContaining({
            'new-note': 'hidden',
            'file-drawer': 'topbar-left',
            search: 'topbar-right',
            template: 'hidden',
            export: 'topbar-right',
            share: 'hidden',
            settings: 'topbar-right',
            'theme-toggle': 'hidden',
            'view-toggle': 'reader-bar',
          }),
        },
      },
      {
        id: 'markluck.studio',
        label: '工坊轨道',
        layoutPreset: 'studio',
        role: 'workflow',
        performanceName: '标准',
        effectProfile: 'subtle',
        chrome: {
          workspaceIntent: 'studio',
          defaultViewMode: 'split',
          topBarLayout: 'compact',
          leftWingLayout: 'studio-rail',
          editorControlLayout: 'studio-rail',
          statusLayout: 'compact',
          rightWingPolicy: 'production',
          defaultOpenSections: ['outline', 'backlinks', 'tags'],
          actionPlacements: expect.objectContaining({
            'new-note': 'studio-rail',
            'file-drawer': 'studio-rail',
            template: 'studio-rail',
            export: 'studio-rail',
            share: 'studio-rail',
            search: 'topbar-right',
            settings: 'left-wing',
            'view-toggle': 'studio-rail',
          }),
        },
      },
    ];

    for (const item of cases) {
      theme.setTheme(item.id);

      expect(theme.activeThemeId).toBe(item.id);
      expect(theme.activeThemeLabel).toBe(item.label);
      expect(theme.activeLayoutPreset).toBe(item.layoutPreset);
      expect(theme.activeOfficialProfile?.role).toBe(item.role);
      expect(theme.activePerformanceBadge?.name).toBe(item.performanceName);
      expect(theme.activeChromeState).toMatchObject({
        official: true,
        layoutPreset: item.layoutPreset,
        role: item.role,
        effectProfile: item.effectProfile,
        ...item.chrome,
      });
      expect(document.documentElement.getAttribute('data-theme-id')).toBe(item.id);
      expect(document.documentElement.getAttribute('data-layout-preset')).toBe(item.layoutPreset);
      expect(document.documentElement.getAttribute('data-theme-role')).toBe(item.role);
      expect(document.documentElement.getAttribute('data-effect-profile')).toBe(item.effectProfile);
      expect(document.documentElement.getAttribute('data-workspace-intent')).toBe(
        item.chrome.workspaceIntent,
      );
      expect(document.documentElement.getAttribute('data-default-view-mode')).toBe(
        item.chrome.defaultViewMode,
      );
      expect(document.documentElement.getAttribute('data-topbar-layout')).toBe(
        item.chrome.topBarLayout,
      );
      expect(document.documentElement.getAttribute('data-left-wing-layout')).toBe(
        item.chrome.leftWingLayout,
      );
      expect(document.documentElement.getAttribute('data-editor-control-layout')).toBe(
        item.chrome.editorControlLayout,
      );
      expect(document.documentElement.getAttribute('data-status-layout')).toBe(
        item.chrome.statusLayout,
      );
      expect(document.documentElement.getAttribute('data-right-wing-policy')).toBe(
        item.chrome.rightWingPolicy,
      );
    }

    expect(document.getElementById(ACTIVE_THEME_STYLE_ID)?.textContent).toContain(
      "[data-theme-id='markluck.studio']",
    );
  });

  it('keeps the five performance badge mappings stable', () => {
    expect(THEME_PERFORMANCE_BADGES).toEqual({
      1: {
        level: 1,
        name: '轻盈',
        color: 'green',
        icon: 'leaf',
        description: '几乎无额外渲染，适合所有设备。',
      },
      2: {
        level: 2,
        name: '标准',
        color: 'cyan',
        icon: 'gauge',
        description: '少量布局权重和阴影变化，日常使用稳定。',
      },
      3: {
        level: 3,
        name: '增强',
        color: 'blue',
        icon: 'spark',
        description: '包含本地背景和轻动效，适合较新的设备。',
      },
      4: {
        level: 4,
        name: '沉浸',
        color: 'purple',
        icon: 'moon',
        description: '包含粒子和呼吸光效，低性能设备可关闭动效。',
      },
      5: {
        level: 5,
        name: '重载',
        color: 'orange',
        icon: 'flame',
        description: '保留给未来高级主题，首发主题不默认使用。',
      },
    });
    expect(getThemePerformanceBadge(4)).toEqual(THEME_PERFORMANCE_BADGES[4]);
  });

  it('keeps imported themes at css skin level and falls back when uninstalling active import', () => {
    localStorage.setItem(INSTALLED_THEMES_STORAGE_KEY, JSON.stringify([importedPack()]));

    const theme = useThemeStore();
    theme.init();
    theme.setTheme('local.test');

    expect(theme.activeThemeId).toBe('local.test');
    expect(theme.activeLayoutPreset).toBe('winged');
    expect(theme.activeOfficialProfile).toBeUndefined();
    expect(theme.activePerformanceBadge).toBeUndefined();
    expect(theme.activeChromeState).toMatchObject({
      official: false,
      layoutPreset: 'winged',
      role: 'local',
      effectProfile: 'none',
      topBarVariant: 'balanced',
      rightWingSections: ['outline', 'backlinks', 'tags'],
      workspaceIntent: 'baseline',
      defaultViewMode: 'live',
      topBarLayout: 'classic',
      leftWingLayout: 'bookmarks',
      editorControlLayout: 'toolbar',
      statusLayout: 'full',
      rightWingPolicy: 'outline',
      actionPlacements: expect.objectContaining({
        search: 'topbar-right',
        template: 'editor-control',
        share: 'topbar-right',
        'view-toggle': 'editor-control',
      }),
    });
    expect(document.documentElement.getAttribute('data-layout-preset')).toBe('winged');
    expect(document.documentElement.getAttribute('data-workspace-intent')).toBe('baseline');
    expect(document.documentElement.getAttribute('data-default-view-mode')).toBe('live');
    expect(document.documentElement.getAttribute('data-topbar-layout')).toBe('classic');
    expect(document.documentElement.getAttribute('data-left-wing-layout')).toBe('bookmarks');
    expect(document.documentElement.getAttribute('data-editor-control-layout')).toBe('toolbar');
    expect(document.documentElement.getAttribute('data-status-layout')).toBe('full');
    expect(document.documentElement.getAttribute('data-right-wing-policy')).toBe('outline');
    expect(document.documentElement.hasAttribute('data-theme-role')).toBe(false);
    expect(document.documentElement.hasAttribute('data-effect-profile')).toBe(false);
    expect(document.documentElement.hasAttribute('data-theme-performance')).toBe(false);

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
