/**
 * useThemeStore — Theme Pack runtime state.
 *
 * Keeps the legacy light/dark storage key as a compatibility mirror while
 * moving active theme and layout preset to the v2 state object.
 *
 * @see spec/frontend/theme-packs.md
 */
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type {
  ColorScheme,
  InstalledThemePack,
  OfficialThemeProfile,
  ThemeChromeState,
  ThemeLayoutPreset,
  ThemePerformanceBadge,
} from '@/types/theme-pack';
import { installThemePack } from '@/services/ThemePackInstaller';
import {
  ACTIVE_THEME_STYLE_ID,
  DEFAULT_THEME_ID,
  LEGACY_THEME_STORAGE_KEY,
  THEME_STATE_STORAGE_KEY,
  getBuiltInThemePacks,
  getThemePerformanceBadge,
  loadInstalledThemePacks,
  removeInstalledThemePack,
} from '@/services/ThemeRegistry';

interface PersistedThemeState {
  activeThemeId?: string;
  colorScheme?: ColorScheme;
}

export interface ThemeViewModel {
  pack: InstalledThemePack;
  id: string;
  name: string;
  description: string;
  sourceLabel: string;
  active: boolean;
  readonly: boolean;
  officialProfile?: OfficialThemeProfile;
  performanceBadge?: ThemePerformanceBadge;
}

export type { ColorScheme };

const SAFE_LOCAL_CHROME_STATE: ThemeChromeState = {
  official: false,
  layoutPreset: 'winged',
  role: 'local',
  topBarVariant: 'balanced',
  leftWingMode: 'default',
  rightWingMode: 'balanced',
  toolbarDensity: 'calm',
  statusDensity: 'calm',
  drawerEmphasis: 'medium',
  readingWidth: 'standard',
  effectProfile: 'none',
  motionIntensity: 'none',
  rightWingSections: ['outline', 'backlinks', 'tags'],
  defaultOpenSections: ['outline', 'tags'],
  workspaceIntent: 'baseline',
  defaultViewMode: 'live',
  topBarLayout: 'classic',
  leftWingLayout: 'bookmarks',
  editorControlLayout: 'toolbar',
  statusLayout: 'full',
  rightWingPolicy: 'outline',
  actionPlacements: {
    'new-note': 'left-wing',
    'file-drawer': 'topbar-left',
    search: 'topbar-right',
    template: 'editor-control',
    export: 'topbar-right',
    share: 'topbar-right',
    settings: 'left-wing',
    'theme-toggle': 'topbar-right',
    'view-toggle': 'editor-control',
  },
};

function cloneChromeState(state: ThemeChromeState): ThemeChromeState {
  return {
    ...state,
    rightWingSections: [...state.rightWingSections],
    defaultOpenSections: [...state.defaultOpenSections],
    actionPlacements: { ...state.actionPlacements },
  };
}

function chromeStateFromPack(pack: InstalledThemePack): ThemeChromeState {
  // v2: 优先从声明式主题模块的 recipe 直接读取
  if (pack.module) {
    const recipe = pack.module.recipe;
    const profile = pack.module.meta;
    return {
      official: true,
      layoutPreset: recipe.layoutPreset,
      role: profile.role,
      topBarVariant: recipe.topBar.variant,
      leftWingMode: recipe.leftWing.mode,
      rightWingMode: recipe.rightWing.mode,
      toolbarDensity: recipe.editorControl.density,
      statusDensity: recipe.statusBar.density,
      drawerEmphasis: recipe.drawerEmphasis,
      readingWidth: recipe.readingWidth,
      effectProfile: profile.effectProfile,
      motionIntensity: recipe.motionIntensity,
      rightWingSections: [...recipe.rightWing.sections],
      defaultOpenSections: [...recipe.rightWing.defaultOpenSections],
      workspaceIntent: recipe.workspaceIntent,
      defaultViewMode: recipe.defaultViewMode,
      topBarLayout: recipe.topBar.layout,
      leftWingLayout: recipe.leftWing.layout,
      editorControlLayout: recipe.editorControl.layout,
      statusLayout: recipe.statusBar.layout,
      rightWingPolicy: recipe.rightWing.policy,
      actionPlacements: { ...recipe.actionPlacements },
    };
  }
  // v1 fallback: 导入/本地主题（无 module）
  return cloneChromeState(SAFE_LOCAL_CHROME_STATE);
}

export const useThemeStore = defineStore('theme', () => {
  const colorScheme = ref<ColorScheme>('light');
  const activeThemeId = ref(DEFAULT_THEME_ID);
  const activeLayoutPreset = ref<ThemeLayoutPreset>('winged');
  const installedThemes = ref<InstalledThemePack[]>([]);
  const initialized = ref(false);

  const themes = computed(() => {
    const byId = new Map<string, InstalledThemePack>();
    for (const pack of getBuiltInThemePacks()) byId.set(pack.manifest.id, pack);
    for (const pack of installedThemes.value) byId.set(pack.manifest.id, pack);
    return [...byId.values()];
  });

  const activeTheme = computed(
    () =>
      themes.value.find((pack) => pack.manifest.id === activeThemeId.value) ??
      themes.value.find((pack) => pack.manifest.id === DEFAULT_THEME_ID)!,
  );

  const officialThemes = computed(() => themes.value.filter((pack) => pack.officialProfile));
  const activeOfficialProfile = computed(() => activeTheme.value.officialProfile);
  const activeChromeState = computed<ThemeChromeState>(() =>
    chromeStateFromPack(activeTheme.value),
  );
  const activePerformanceBadge = computed(() => {
    const profile = activeOfficialProfile.value;
    return profile ? getThemePerformanceBadge(profile.performanceLevel) : undefined;
  });
  const themeViewModels = computed<ThemeViewModel[]>(() =>
    themes.value.map((pack) => {
      const officialProfile = pack.officialProfile;
      return {
        pack,
        id: pack.manifest.id,
        name: pack.manifest.name,
        description: pack.manifest.description || '本地主题包',
        sourceLabel: pack.source === 'builtin' ? '官方' : '本地',
        active: pack.manifest.id === activeThemeId.value,
        readonly: pack.readonly === true,
        officialProfile,
        performanceBadge: officialProfile
          ? getThemePerformanceBadge(officialProfile.performanceLevel)
          : undefined,
      };
    }),
  );

  const schemeLabel = computed(() => (colorScheme.value === 'light' ? '亮色' : '暗色'));
  const activeThemeLabel = computed(() => activeTheme.value.manifest.name);

  function init(): void {
    if (initialized.value) return;
    installedThemes.value = loadInstalledThemePacks();

    const persisted = readPersistedState();
    if (persisted?.colorScheme) colorScheme.value = persisted.colorScheme;
    if (persisted?.activeThemeId) activeThemeId.value = persisted.activeThemeId;

    if (!persisted?.colorScheme) {
      const legacyScheme = readLegacyColorScheme();
      if (legacyScheme) {
        colorScheme.value = legacyScheme;
      } else if (typeof window !== 'undefined') {
        const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
        if (mq?.matches) colorScheme.value = 'dark';
      }
    }

    if (!themes.value.some((pack) => pack.manifest.id === activeThemeId.value)) {
      activeThemeId.value = DEFAULT_THEME_ID;
    }

    apply();
    initialized.value = true;
  }

  function apply(): void {
    const pack = activeTheme.value;
    const chrome = activeChromeState.value;
    activeLayoutPreset.value = chrome.layoutPreset;

    if (typeof document !== 'undefined') {
      const html = document.documentElement;
      html.setAttribute('data-color-scheme', colorScheme.value);
      html.setAttribute('data-theme-id', pack.manifest.id);
      html.setAttribute('data-layout-preset', chrome.layoutPreset);
      html.setAttribute('data-chrome-topbar', chrome.topBarVariant);
      html.setAttribute('data-chrome-left-wing', chrome.leftWingMode);
      html.setAttribute('data-chrome-right-wing', chrome.rightWingMode);
      html.setAttribute('data-chrome-toolbar', chrome.toolbarDensity);
      html.setAttribute('data-chrome-drawer', chrome.drawerEmphasis);
      html.setAttribute('data-chrome-reading', chrome.readingWidth);
      html.setAttribute('data-workspace-intent', chrome.workspaceIntent);
      html.setAttribute('data-default-view-mode', chrome.defaultViewMode);
      html.setAttribute('data-topbar-layout', chrome.topBarLayout);
      html.setAttribute('data-left-wing-layout', chrome.leftWingLayout);
      html.setAttribute('data-editor-control-layout', chrome.editorControlLayout);
      html.setAttribute('data-status-layout', chrome.statusLayout);
      html.setAttribute('data-right-wing-policy', chrome.rightWingPolicy);
      if (pack.officialProfile) {
        html.setAttribute('data-theme-role', pack.officialProfile.role);
        html.setAttribute('data-effect-profile', chrome.effectProfile);
        html.setAttribute('data-theme-performance', String(pack.officialProfile.performanceLevel));
      } else {
        html.removeAttribute('data-theme-role');
        html.removeAttribute('data-effect-profile');
        html.removeAttribute('data-theme-performance');
      }
      applyThemeStyle(pack.css);
    }

    persistState();
  }

  function setColorScheme(c: ColorScheme): void {
    colorScheme.value = c;
    apply();
  }

  function toggleColorScheme(): void {
    colorScheme.value = colorScheme.value === 'light' ? 'dark' : 'light';
    apply();
  }

  function setTheme(themeId: string): void {
    if (!themes.value.some((pack) => pack.manifest.id === themeId)) {
      throw new Error(`主题不存在: ${themeId}`);
    }
    activeThemeId.value = themeId;
    apply();
  }

  async function installThemeFromFile(
    file: Blob | ArrayBuffer | Uint8Array,
  ): Promise<InstalledThemePack> {
    const result = await installThemePack(file);
    installedThemes.value = loadInstalledThemePacks();
    activeThemeId.value = result.pack.manifest.id;
    apply();
    return result.pack;
  }

  function uninstallTheme(themeId: string): void {
    if (themeId === DEFAULT_THEME_ID) return;
    installedThemes.value = removeInstalledThemePack(themeId);
    if (activeThemeId.value === themeId) {
      activeThemeId.value = DEFAULT_THEME_ID;
    }
    apply();
  }

  function resetTheme(): void {
    activeThemeId.value = DEFAULT_THEME_ID;
    activeLayoutPreset.value = 'winged';
    apply();
  }

  function refreshInstalledThemes(): void {
    installedThemes.value = loadInstalledThemePacks();
    if (!themes.value.some((pack) => pack.manifest.id === activeThemeId.value)) {
      activeThemeId.value = DEFAULT_THEME_ID;
    }
    apply();
  }

  function readPersistedState(): PersistedThemeState | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(THEME_STATE_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PersistedThemeState;
      return {
        colorScheme:
          parsed.colorScheme === 'dark' || parsed.colorScheme === 'light'
            ? parsed.colorScheme
            : undefined,
        activeThemeId: typeof parsed.activeThemeId === 'string' ? parsed.activeThemeId : undefined,
      };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[themeStore] v2 state parse failed', error);
      return null;
    }
  }

  function readLegacyColorScheme(): ColorScheme | null {
    if (typeof window === 'undefined') return null;
    try {
      const saved = window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
      if (!saved) return null;
      const parsed = JSON.parse(saved) as { c?: string };
      if (parsed.c === 'light' || parsed.c === 'dark') return parsed.c;
    } catch {
      return null;
    }
    return null;
  }

  function persistState(): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LEGACY_THEME_STORAGE_KEY, colorScheme.value);
    window.localStorage.setItem(
      THEME_STATE_STORAGE_KEY,
      JSON.stringify({
        activeThemeId: activeThemeId.value,
        colorScheme: colorScheme.value,
      }),
    );
  }

  function applyThemeStyle(css: string): void {
    let style = document.getElementById(ACTIVE_THEME_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = ACTIVE_THEME_STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent = css;
  }

  return {
    colorScheme,
    activeThemeId,
    activeLayoutPreset,
    installedThemes,
    themes,
    officialThemes,
    activeTheme,
    activeThemeLabel,
    activeOfficialProfile,
    activeChromeState,
    activePerformanceBadge,
    themeViewModels,
    schemeLabel,
    initialized,
    init,
    apply,
    setColorScheme,
    toggleColorScheme,
    setTheme,
    installThemeFromFile,
    uninstallTheme,
    resetTheme,
    refreshInstalledThemes,
  };
});
