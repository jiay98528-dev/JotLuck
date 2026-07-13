import { shallowRef, type Component } from 'vue';
import { createMockThemeCommerceProvider } from '@/services/ThemeCommerceProvider';
import type {
  InstalledThemePack,
  ShellAction,
  ThemeActionId,
  ThemeChromeState,
  ThemeCommerceProvider,
  ThemeHostDialogApi,
  ThemeHostEditorApi,
  ThemeHostContext,
  ThemePermission,
  ThemePluginModule,
  ThemeHostToastApi,
  ThemeSlotId,
} from '@/types/theme-pack';
import { findUnscopedCssSelector } from './theme-css-scope';

export interface ThemeHostApi extends ThemeHostContext {
  getStorage: (key: string) => string | null;
  setStorage: (key: string, value: string) => void;
}

export type TrustedThemeModule = ThemePluginModule;

export interface TrustedThemeRegistration {
  themeId: string;
  components: Partial<Record<ThemeSlotId, Component>>;
  dispose: () => void;
}

const registrations = new Map<string, TrustedThemeRegistration>();
const objectUrls = new Map<string, string>();
const activationGenerations = new Map<string, number>();
export const themeRuntimeVersion = shallowRef(0);

function bumpRuntimeVersion(): void {
  themeRuntimeVersion.value += 1;
}

function normalizeComponents(
  components: ThemePluginModule['components'],
): Partial<Record<ThemeSlotId, Component>> {
  return (components ?? {}) as Partial<Record<ThemeSlotId, Component>>;
}

function installScopedThemeCss(themeId: string, css?: string): HTMLStyleElement | undefined {
  if (!css?.trim()) return undefined;
  const unscoped = findUnscopedCssSelector(css, themeId);
  if (unscoped) {
    throw new Error(`主题 CSS 未限定在当前主题根节点：${unscoped}`);
  }
  if (typeof document === 'undefined') return undefined;
  const style = document.createElement('style');
  style.dataset.themeId = themeId;
  style.dataset.themeRuntime = 'trusted-code';
  style.textContent = css;
  document.head.appendChild(style);
  return style;
}

function nextActivationGeneration(themeId: string): number {
  const next = (activationGenerations.get(themeId) ?? 0) + 1;
  activationGenerations.set(themeId, next);
  return next;
}

function isCurrentActivation(themeId: string, generation: number): boolean {
  return activationGenerations.get(themeId) === generation;
}

function disposeTrustedTheme(themeId: string): void {
  const existing = registrations.get(themeId);
  if (existing) {
    try {
      existing.dispose();
    } catch (error) {
      // Cleanup must not prevent registration/style/object URL removal.
      // eslint-disable-next-line no-console
      console.warn(`[ThemeRuntimeHost] cleanup failed for ${themeId}`, error);
    } finally {
      registrations.delete(themeId);
      bumpRuntimeVersion();
    }
  }
  const objectUrl = objectUrls.get(themeId);
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrls.delete(themeId);
  }
}

export function registerTrustedTheme(
  themeId: string,
  module: TrustedThemeModule,
  api: ThemeHostApi,
  generation = nextActivationGeneration(themeId),
): TrustedThemeRegistration {
  if (!isCurrentActivation(themeId, generation)) {
    return {
      themeId,
      components: {},
      dispose: () => undefined,
    };
  }
  disposeTrustedTheme(themeId);
  const styleElement = installScopedThemeCss(themeId, module.css);
  let cleanup: void | (() => void);
  try {
    cleanup = module.activate?.(api);
  } catch (error) {
    styleElement?.remove();
    throw error;
  }
  const registration: TrustedThemeRegistration = {
    themeId,
    components: normalizeComponents(module.components),
    dispose: () => {
      try {
        if (typeof cleanup === 'function') cleanup();
      } finally {
        styleElement?.remove();
      }
    },
  };
  registrations.set(themeId, registration);
  bumpRuntimeVersion();
  return registration;
}

export function unregisterTrustedTheme(themeId: string): void {
  nextActivationGeneration(themeId);
  disposeTrustedTheme(themeId);
}

export function getTrustedThemeComponent(
  themeId: string,
  slot: ThemeSlotId,
): Component | undefined {
  return registrations.get(themeId)?.components[slot];
}

export const getThemeSlotComponent = getTrustedThemeComponent;

export function hasThemeSlotComponent(themeId: string, slot: ThemeSlotId): boolean {
  return Boolean(getThemeSlotComponent(themeId, slot));
}

export function createThemeHostApi(
  pack: InstalledThemePack,
  permissions: readonly ThemePermission[],
  actions: readonly ShellAction[],
  chrome: ThemeChromeState,
  ui: Record<string, unknown> = {},
  commerce = createMockThemeCommerceProvider(() => [pack]),
): ThemeHostApi {
  const themeId = pack.manifest.id;
  const actionMap = new Map(actions.map((action) => [action.id, action]));
  const storagePrefix = `jotluck:theme:${themeId}:`;
  const dispatch = (actionId: ThemeActionId): void => {
    void actionMap.get(actionId)?.run();
  };
  const uiApi = ui as {
    editor?: Partial<ThemeHostEditorApi>;
    dialogs?: Partial<ThemeHostDialogApi>;
    toast?: Partial<ThemeHostToastApi>;
    appState?: Record<string, unknown>;
    commerce?: ThemeCommerceProvider;
  };

  const storage = {
    get(key: string): string | null {
      return localStorage.getItem(`${storagePrefix}${key}`);
    },
    set(key: string, value: string): void {
      localStorage.setItem(`${storagePrefix}${key}`, value);
    },
    remove(key: string): void {
      localStorage.removeItem(`${storagePrefix}${key}`);
    },
  };

  return {
    themeId,
    manifest: pack.manifest,
    runtime: pack.manifest.runtime,
    permissions,
    chrome,
    actions: {
      list: () => actions,
      dispatch,
    },
    slots: {
      has(slot) {
        return hasThemeSlotComponent(themeId, slot);
      },
    },
    storage,
    editor: {
      getContent: () => '',
      ...uiApi.editor,
    },
    dialogs: {
      open: () => undefined,
      close: () => undefined,
      ...uiApi.dialogs,
    },
    toast: {
      show: () => undefined,
      ...uiApi.toast,
    },
    commerce: uiApi.commerce ?? commerce,
    appState: uiApi.appState ?? {},
    ui,
    dispatchAction: dispatch,
    getStorage: storage.get,
    setStorage: storage.set,
  };
}

export async function activateTrustedThemeRuntime(
  pack: InstalledThemePack,
  actions: readonly ShellAction[],
  chrome: ThemeChromeState,
  ui: Record<string, unknown> = {},
  commerce?: ThemeCommerceProvider,
): Promise<void> {
  const generation = nextActivationGeneration(pack.manifest.id);
  if (pack.module?.plugin) {
    disposeTrustedTheme(pack.manifest.id);
    registerTrustedTheme(
      pack.manifest.id,
      pack.module.plugin,
      createThemeHostApi(pack, pack.manifest.permissions ?? [], actions, chrome, ui, commerce),
      generation,
    );
    return;
  }

  if (pack.manifest.runtime !== 'trusted-code') {
    unregisterTrustedTheme(pack.manifest.id);
    return;
  }

  // A failed replacement must not leave the previous trusted runtime active.
  // Invalidate and dispose it before validating/loading the new bundle.
  disposeTrustedTheme(pack.manifest.id);
  const entrypoint = pack.manifest.entrypoints?.[0];
  if (!entrypoint) throw new Error(`Theme is missing code entrypoint: ${pack.manifest.id}`);
  const source = pack.codeBundles?.[entrypoint.module];
  if (!source) throw new Error(`Theme code bundle is not installed: ${entrypoint.module}`);

  const objectUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  objectUrls.set(pack.manifest.id, objectUrl);

  let imported: Record<string, unknown>;
  try {
    imported = (await import(/* @vite-ignore */ objectUrl)) as Record<string, unknown>;
  } catch (error) {
    if (objectUrls.get(pack.manifest.id) === objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrls.delete(pack.manifest.id);
    }
    if (isCurrentActivation(pack.manifest.id, generation)) throw error;
    return;
  }
  if (!isCurrentActivation(pack.manifest.id, generation)) {
    if (objectUrls.get(pack.manifest.id) === objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrls.delete(pack.manifest.id);
    }
    return;
  }
  const exported = imported[entrypoint.exportName ?? 'default'] ?? imported.default;
  if (!isTrustedThemeModule(exported)) {
    if (objectUrls.get(pack.manifest.id) === objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrls.delete(pack.manifest.id);
    }
    throw new Error(`Theme code entrypoint did not export ThemePluginModule: ${pack.manifest.id}`);
  }

  try {
    registerTrustedTheme(
      pack.manifest.id,
      exported,
      createThemeHostApi(pack, pack.manifest.permissions ?? [], actions, chrome, ui, commerce),
      generation,
    );
  } catch (error) {
    if (objectUrls.get(pack.manifest.id) === objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrls.delete(pack.manifest.id);
    }
    throw error;
  }
}

function isTrustedThemeModule(value: unknown): value is TrustedThemeModule {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ThemePluginModule>;
  return (
    (candidate.activate === undefined || typeof candidate.activate === 'function') &&
    (candidate.components === undefined ||
      (typeof candidate.components === 'object' && candidate.components !== null)) &&
    (candidate.css === undefined || typeof candidate.css === 'string')
  );
}
