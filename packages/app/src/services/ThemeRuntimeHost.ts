import type { Component } from 'vue';
import type {
  InstalledThemePack,
  ShellAction,
  ThemePermission,
  ThemeSlotId,
} from '@/types/theme-pack';

export interface ThemeHostApi {
  readonly themeId: string;
  readonly permissions: readonly ThemePermission[];
  dispatchAction: (actionId: ShellAction['id']) => void;
  getStorage: (key: string) => string | null;
  setStorage: (key: string, value: string) => void;
}

export interface TrustedThemeModule {
  activate?: (api: ThemeHostApi) => void | (() => void);
  components?: Partial<Record<ThemeSlotId, Component>>;
}

export interface TrustedThemeRegistration {
  themeId: string;
  components: Partial<Record<ThemeSlotId, Component>>;
  dispose: () => void;
}

const registrations = new Map<string, TrustedThemeRegistration>();
const objectUrls = new Map<string, string>();

export function registerTrustedTheme(
  themeId: string,
  module: TrustedThemeModule,
  api: ThemeHostApi,
): TrustedThemeRegistration {
  unregisterTrustedTheme(themeId);
  const cleanup = module.activate?.(api);
  const registration: TrustedThemeRegistration = {
    themeId,
    components: module.components ?? {},
    dispose: () => {
      if (typeof cleanup === 'function') cleanup();
    },
  };
  registrations.set(themeId, registration);
  return registration;
}

export function unregisterTrustedTheme(themeId: string): void {
  const existing = registrations.get(themeId);
  if (!existing) return;
  existing.dispose();
  registrations.delete(themeId);
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

export function createThemeHostApi(
  themeId: string,
  permissions: readonly ThemePermission[],
  actions: readonly ShellAction[],
): ThemeHostApi {
  const actionMap = new Map(actions.map((action) => [action.id, action]));
  return {
    themeId,
    permissions,
    dispatchAction(actionId) {
      void actionMap.get(actionId)?.run();
    },
    getStorage(key) {
      return localStorage.getItem(`markluck:theme:${themeId}:${key}`);
    },
    setStorage(key, value) {
      localStorage.setItem(`markluck:theme:${themeId}:${key}`, value);
    },
  };
}

export async function activateTrustedThemeRuntime(
  pack: InstalledThemePack,
  actions: readonly ShellAction[],
): Promise<void> {
  if (pack.manifest.runtime !== 'trusted-code') {
    unregisterTrustedTheme(pack.manifest.id);
    return;
  }
  if (!pack.trustedCodeAuthorized) return;

  const entrypoint = pack.manifest.entrypoints?.[0];
  if (!entrypoint) throw new Error(`主题缺少代码入口: ${pack.manifest.id}`);
  const source = pack.codeBundles?.[entrypoint.module];
  if (!source) throw new Error(`主题代码 bundle 未安装: ${entrypoint.module}`);

  unregisterTrustedTheme(pack.manifest.id);
  const objectUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  objectUrls.set(pack.manifest.id, objectUrl);

  const imported = (await import(/* @vite-ignore */ objectUrl)) as Record<string, unknown>;
  const exported = imported[entrypoint.exportName ?? 'default'] ?? imported.default;
  if (!isTrustedThemeModule(exported)) {
    throw new Error(`主题代码入口未导出 TrustedThemeModule: ${pack.manifest.id}`);
  }

  registerTrustedTheme(
    pack.manifest.id,
    exported,
    createThemeHostApi(pack.manifest.id, pack.manifest.permissions ?? [], actions),
  );
}

function isTrustedThemeModule(value: unknown): value is TrustedThemeModule {
  return typeof value === 'object' && value !== null;
}
