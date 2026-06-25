/**
 * useThemeStore — Theme Pack v1 runtime state.
 *
 * Keeps the legacy light/dark storage key as a compatibility mirror while
 * moving active theme and layout preset to the v2 state object.
 *
 * @see spec/frontend/theme-packs.md
 */
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { ColorScheme, InstalledThemePack, ThemeLayoutPreset } from '@/types/theme-pack';
import { installThemePack } from '@/services/ThemePackInstaller';
import {
  ACTIVE_THEME_STYLE_ID,
  DEFAULT_THEME_ID,
  LEGACY_THEME_STORAGE_KEY,
  THEME_STATE_STORAGE_KEY,
  getBuiltInThemePacks,
  loadInstalledThemePacks,
  removeInstalledThemePack,
} from '@/services/ThemeRegistry';

interface PersistedThemeState {
  activeThemeId?: string;
  colorScheme?: ColorScheme;
}

export type { ColorScheme };

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
    activeLayoutPreset.value = pack.manifest.layoutPreset;

    if (typeof document !== 'undefined') {
      const html = document.documentElement;
      html.setAttribute('data-color-scheme', colorScheme.value);
      html.setAttribute('data-theme-id', pack.manifest.id);
      html.setAttribute('data-layout-preset', pack.manifest.layoutPreset);
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
    activeTheme,
    activeThemeLabel,
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
