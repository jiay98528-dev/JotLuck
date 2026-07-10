import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type {
  InstalledThemePack,
  ThemeCheckoutResult,
  ThemeChromeState,
  ThemeEntitlementDescriptor,
  ThemeLicenseRedeemRequest,
  ThemeLayoutPreset,
  ThemePackageInput,
  ThemeValidationIssue,
  ThemeUxRecipeMap,
} from '@/types/theme-pack';
import { createMockThemeCommerceProvider } from '@/services/ThemeCommerceProvider';
import {
  ACTIVE_THEME_STYLE_ID,
  DEFAULT_THEME_ID,
  getAllRegistryThemePacks,
} from '@/services/ThemeRegistry';
import {
  importThemePackFromFile,
  installLocalThemePackage,
  loadInstalledThemePacks,
  removeInstalledThemePack,
  validateThemePackage,
} from '@/services/ThemePackInstaller';

const THEME_STATE_KEY = 'jotluck:theme-state:v2';
export const THEME_CENTER_SHOW_DEV_THEMES_KEY = 'jotluck:theme-center:show-dev-themes';

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
    theme: 'topbar-right',
    settings: 'left-wing',
    'view-toggle': 'editor-control',
  },
};

function cloneChromeState(chrome: ThemeChromeState): ThemeChromeState {
  return {
    ...chrome,
    rightWingSections: [...chrome.rightWingSections],
    defaultOpenSections: [...chrome.defaultOpenSections],
    actionPlacements: { ...chrome.actionPlacements },
    drawerShell: chrome.drawerShell
      ? {
          left: { ...chrome.drawerShell.left },
          right: { ...chrome.drawerShell.right },
          bottom: { ...chrome.drawerShell.bottom },
        }
      : undefined,
  };
}

function chromeStateFromPack(pack: InstalledThemePack): ThemeChromeState {
  if (!pack.module) {
    return cloneChromeState({
      ...SAFE_LOCAL_CHROME_STATE,
      layoutPreset: pack.manifest.layoutPreset,
    });
  }

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
    drawerShell: recipe.drawerShell
      ? {
          left: { ...recipe.drawerShell.left },
          right: { ...recipe.drawerShell.right },
          bottom: { ...recipe.drawerShell.bottom },
        }
      : undefined,
  };
}

function uniqueThemes(packs: InstalledThemePack[]): InstalledThemePack[] {
  const byId = new Map<string, InstalledThemePack>();
  for (const pack of packs) {
    byId.set(pack.manifest.id, pack);
  }
  return Array.from(byId.values());
}

function readPersistedThemeId(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(THEME_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { activeThemeId?: string };
    return typeof parsed.activeThemeId === 'string' ? parsed.activeThemeId : null;
  } catch {
    return null;
  }
}

function persistThemeId(themeId: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(THEME_STATE_KEY, JSON.stringify({ activeThemeId: themeId }));
}

function isCatalogTheme(pack: InstalledThemePack): boolean {
  return pack.source === 'builtin' || pack.source === 'market';
}

function isDeveloperCatalogTheme(pack: InstalledThemePack): boolean {
  return pack.catalogVisibility === 'developer' || pack.module?.catalogVisibility === 'developer';
}

function readShowDeveloperThemes(): boolean {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return false;
  return localStorage.getItem(THEME_CENTER_SHOW_DEV_THEMES_KEY) === 'true';
}

export const useThemeStore = defineStore('theme', () => {
  const activeThemeId = ref(DEFAULT_THEME_ID);
  const previewThemeId = ref<string | null>(null);
  const activeLayoutPreset = ref<ThemeLayoutPreset>('winged');
  const initialized = ref(false);
  const registryThemes = ref<InstalledThemePack[]>(getAllRegistryThemePacks());
  const installedThemes = ref<InstalledThemePack[]>([]);
  const entitlements = ref<Record<string, ThemeEntitlementDescriptor>>({});
  const commerceError = ref<string | null>(null);
  const showDeveloperThemesInCatalog = ref(readShowDeveloperThemes());

  const themes = computed(() => uniqueThemes([...registryThemes.value, ...installedThemes.value]));
  const commerce = createMockThemeCommerceProvider(() => themes.value);
  const marketThemes = computed(() => themes.value.filter((pack) => pack.source === 'market'));
  const importedThemes = computed(() => themes.value.filter((pack) => pack.source === 'imported'));
  const publicCatalogThemes = computed(() =>
    themes.value.filter((pack) => isCatalogTheme(pack) && !isDeveloperCatalogTheme(pack)),
  );
  const developerCatalogThemes = computed(() =>
    themes.value.filter((pack) => isCatalogTheme(pack) && isDeveloperCatalogTheme(pack)),
  );
  const themeCenterCatalogThemes = computed(() =>
    showDeveloperThemesInCatalog.value
      ? [...publicCatalogThemes.value, ...developerCatalogThemes.value]
      : publicCatalogThemes.value,
  );

  const activeTheme = computed(() => {
    return (
      themes.value.find((pack) => pack.manifest.id === activeThemeId.value) ??
      themes.value.find((pack) => pack.manifest.id === DEFAULT_THEME_ID) ??
      themes.value[0]!
    );
  });

  const previewTheme = computed(() => {
    if (!previewThemeId.value) return null;
    return themes.value.find((pack) => pack.manifest.id === previewThemeId.value) ?? null;
  });

  const renderedTheme = computed(() => previewTheme.value ?? activeTheme.value);
  const activeThemeLabel = computed(() => activeTheme.value.manifest.name);
  const activeChromeState = computed<ThemeChromeState>(() =>
    chromeStateFromPack(renderedTheme.value),
  );
  const activeUxRecipes = computed<ThemeUxRecipeMap>(() => renderedTheme.value.ux ?? {});

  function refreshRegistry(): void {
    registryThemes.value = getAllRegistryThemePacks();
    installedThemes.value = loadInstalledThemePacks();
  }

  function refreshThemeCenterDeveloperVisibility(): void {
    showDeveloperThemesInCatalog.value = readShowDeveloperThemes();
  }

  async function refreshEntitlements(): Promise<void> {
    try {
      entitlements.value = await commerce.refreshEntitlements();
      commerceError.value = null;
    } catch (error) {
      commerceError.value = error instanceof Error ? error.message : String(error);
      entitlements.value = Object.fromEntries(
        themes.value.map((pack) => [
          pack.manifest.id,
          {
            state: 'offline-unknown',
            checkedAt: new Date().toISOString(),
            provider: commerce.id,
            note: 'Entitlement refresh failed; installed themes remain usable offline.',
          } satisfies ThemeEntitlementDescriptor,
        ]),
      );
    }
  }

  function init(): void {
    if (initialized.value) return;
    refreshRegistry();
    const persisted = readPersistedThemeId();
    activeThemeId.value = themes.value.some((pack) => pack.manifest.id === persisted)
      ? persisted!
      : DEFAULT_THEME_ID;
    apply();
    initialized.value = true;
    void refreshEntitlements();
  }

  function apply(): void {
    const pack = renderedTheme.value;
    const chrome = activeChromeState.value;
    activeLayoutPreset.value = chrome.layoutPreset;

    if (typeof document !== 'undefined') {
      const html = document.documentElement;
      html.setAttribute('data-theme-id', pack.manifest.id);
      html.setAttribute('data-active-theme-id', activeTheme.value.manifest.id);
      html.setAttribute('data-theme-runtime', pack.manifest.runtime);
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
      if (chrome.drawerShell) {
        html.setAttribute('data-drawer-shell', 'enabled');
      } else {
        html.removeAttribute('data-drawer-shell');
      }
      html.setAttribute('data-theme-role', pack.officialProfile?.role ?? 'baseline');
      html.setAttribute(
        'data-theme-performance',
        String(pack.officialProfile?.performanceLevel ?? 1),
      );
      html.removeAttribute('data-effect-profile');
      for (const attribute of Array.from(html.attributes)) {
        if (attribute.name.startsWith('data-color-')) {
          html.removeAttribute(attribute.name);
        }
      }
      applyThemeStyle(pack.css);
    }
  }

  function activateTheme(themeId: string): void {
    const pack = themes.value.find((item) => item.manifest.id === themeId);
    if (!pack) throw new Error(`主题不存在: ${themeId}`);
    activeThemeId.value = themeId;
    previewThemeId.value = null;
    persistThemeId(themeId);
    apply();
  }

  function setTheme(themeId: string): void {
    activateTheme(themeId);
  }

  function previewThemeById(themeId: string): void {
    if (!themes.value.some((pack) => pack.manifest.id === themeId)) {
      throw new Error(`主题不存在: ${themeId}`);
    }
    previewThemeId.value = themeId;
    apply();
  }

  function clearPreview(): void {
    previewThemeId.value = null;
    apply();
  }

  function installTheme(input: ThemePackageInput): ThemeValidationIssue[] {
    installLocalThemePackage(input);
    refreshRegistry();
    void refreshEntitlements();
    return [];
  }

  async function importThemePack(
    input: Blob | ArrayBuffer | Uint8Array,
  ): Promise<InstalledThemePack> {
    const pack = await importThemePackFromFile(input);
    refreshRegistry();
    void refreshEntitlements();
    return pack;
  }

  function uninstallTheme(themeId: string): void {
    const pack = themes.value.find((item) => item.manifest.id === themeId);
    if (!pack) return;
    if (pack.readonly) throw new Error(`内置主题不可卸载: ${themeId}`);
    removeInstalledThemePack(themeId);
    refreshRegistry();
    if (activeThemeId.value === themeId) {
      activeThemeId.value = DEFAULT_THEME_ID;
      persistThemeId(DEFAULT_THEME_ID);
    }
    if (previewThemeId.value === themeId) previewThemeId.value = null;
    apply();
    void refreshEntitlements();
  }

  function authorizeTrustedCode(themeId: string): void {
    void themeId;
    refreshRegistry();
  }

  function validateTheme(input: ThemePackageInput): ThemeValidationIssue[] {
    return validateThemePackage(input);
  }

  function entitlementFor(themeId: string): ThemeEntitlementDescriptor {
    return (
      entitlements.value[themeId] ?? {
        state: 'offline-unknown',
        checkedAt: new Date(0).toISOString(),
        provider: commerce.id,
      }
    );
  }

  async function createCheckout(themeId: string): Promise<ThemeCheckoutResult> {
    const pack = themes.value.find((item) => item.manifest.id === themeId);
    return commerce.createCheckout({ themeId, sku: pack?.manifest.sku });
  }

  async function redeemThemeLicense(request: ThemeLicenseRedeemRequest): Promise<void> {
    entitlements.value = await commerce.redeemLicense(request);
  }

  function resetTheme(): void {
    activeThemeId.value = DEFAULT_THEME_ID;
    previewThemeId.value = null;
    activeLayoutPreset.value = 'winged';
    persistThemeId(DEFAULT_THEME_ID);
    apply();
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
    activeThemeId,
    previewThemeId,
    activeLayoutPreset,
    registryThemes,
    installedThemes,
    entitlements,
    commerce,
    commerceError,
    themes,
    marketThemes,
    importedThemes,
    publicCatalogThemes,
    developerCatalogThemes,
    themeCenterCatalogThemes,
    showDeveloperThemesInCatalog,
    activeTheme,
    previewTheme,
    renderedTheme,
    activeThemeLabel,
    activeChromeState,
    activeUxRecipes,
    initialized,
    init,
    apply,
    setTheme,
    activateTheme,
    previewThemeById,
    clearPreview,
    installTheme,
    importThemePack,
    uninstallTheme,
    authorizeTrustedCode,
    validateTheme,
    entitlementFor,
    refreshEntitlements,
    refreshThemeCenterDeveloperVisibility,
    createCheckout,
    redeemThemeLicense,
    resetTheme,
  };
});
