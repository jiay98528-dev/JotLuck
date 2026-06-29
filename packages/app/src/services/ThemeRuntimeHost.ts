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
export const themeRuntimeVersion = shallowRef(0);

function bumpRuntimeVersion(): void {
  themeRuntimeVersion.value += 1;
}

function normalizeComponents(
  components: ThemePluginModule['components'],
): Partial<Record<ThemeSlotId, Component>> {
  return (components ?? {}) as Partial<Record<ThemeSlotId, Component>>;
}

export function registerTrustedTheme(
  themeId: string,
  module: TrustedThemeModule,
  api: ThemeHostApi,
): TrustedThemeRegistration {
  unregisterTrustedTheme(themeId);
  const cleanup = module.activate?.(api);
  const registration: TrustedThemeRegistration = {
    themeId,
    components: normalizeComponents(module.components),
    dispose: () => {
      if (typeof cleanup === 'function') cleanup();
    },
  };
  registrations.set(themeId, registration);
  bumpRuntimeVersion();
  return registration;
}

export function unregisterTrustedTheme(themeId: string): void {
  const existing = registrations.get(themeId);
  if (!existing) return;
  existing.dispose();
  registrations.delete(themeId);
  bumpRuntimeVersion();
  const objectUrl = objectUrls.get(themeId);
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrls.delete(themeId);
  }
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
  const storagePrefix = `markluck:theme:${themeId}:`;
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
  if (pack.module?.plugin) {
    registerTrustedTheme(
      pack.manifest.id,
      pack.module.plugin,
      createThemeHostApi(pack, pack.manifest.permissions ?? [], actions, chrome, ui, commerce),
    );
    return;
  }

  if (pack.manifest.runtime !== 'trusted-code') {
    unregisterTrustedTheme(pack.manifest.id);
    return;
  }

  const entrypoint = pack.manifest.entrypoints?.[0];
  if (!entrypoint) throw new Error(`Theme is missing code entrypoint: ${pack.manifest.id}`);
  const source = pack.codeBundles?.[entrypoint.module];
  if (!source) throw new Error(`Theme code bundle is not installed: ${entrypoint.module}`);

  unregisterTrustedTheme(pack.manifest.id);
  const objectUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  objectUrls.set(pack.manifest.id, objectUrl);

  const imported = (await import(/* @vite-ignore */ objectUrl)) as Record<string, unknown>;
  const exported = imported[entrypoint.exportName ?? 'default'] ?? imported.default;
  if (!isTrustedThemeModule(exported)) {
    throw new Error(`Theme code entrypoint did not export ThemePluginModule: ${pack.manifest.id}`);
  }

  registerTrustedTheme(
    pack.manifest.id,
    exported,
    createThemeHostApi(pack, pack.manifest.permissions ?? [], actions, chrome, ui, commerce),
  );
}

function isTrustedThemeModule(value: unknown): value is TrustedThemeModule {
  return typeof value === 'object' && value !== null;
}
