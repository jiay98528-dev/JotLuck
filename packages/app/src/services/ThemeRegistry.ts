import { getAllThemeModules } from '@/themes/registry';
import { getLocalMarketModules } from '@/themes/market/local-catalog';
import { APP_VERSION } from '@/config/app-meta';
import type {
  InstalledThemePack,
  OfficialThemeModule,
  OfficialThemeProfile,
  ThemePackManifest,
  ThemePerformanceBadge,
  ThemePerformanceLevel,
  ThemeSlotId,
  ThemeTokenSet,
} from '@/types/theme-pack';
import { findUnscopedCssSelector } from './theme-css-scope';
import { translate } from '@/i18n';
import { createUserMessageError } from './command-errors';

export const ACTIVE_THEME_STYLE_ID = 'jotluck-active-theme';
export const DEFAULT_THEME_ID = 'paper';
export const APP_THEME_VERSION = APP_VERSION;

const BUILTIN_CHECKSUM = 'sha256-builtin';

export function getThemePerformanceBadges(): Record<ThemePerformanceLevel, ThemePerformanceBadge> {
  return {
    1: {
      level: 1,
      name: translate('theme.performance.lightName'),
      color: 'green',
      icon: 'leaf',
      description: translate('theme.performance.lightDescription'),
    },
    2: {
      level: 2,
      name: translate('theme.performance.standardName'),
      color: 'cyan',
      icon: 'gauge',
      description: translate('theme.performance.standardDescription'),
    },
    3: {
      level: 3,
      name: translate('theme.performance.enhancedName'),
      color: 'blue',
      icon: 'spark',
      description: translate('theme.performance.enhancedDescription'),
    },
    4: {
      level: 4,
      name: translate('theme.performance.immersiveName'),
      color: 'purple',
      icon: 'moon',
      description: translate('theme.performance.immersiveDescription'),
    },
    5: {
      level: 5,
      name: translate('theme.performance.heavyName'),
      color: 'orange',
      icon: 'flame',
      description: translate('theme.performance.heavyDescription'),
    },
  };
}

function moduleToPack(
  mod: OfficialThemeModule,
  source: InstalledThemePack['source'],
): InstalledThemePack {
  const uxSlots = mod.ux ? (Object.keys(mod.ux) as ThemeSlotId[]) : [];
  const pluginSlots = mod.plugin?.components
    ? (Object.keys(mod.plugin.components) as ThemeSlotId[])
    : [];
  const slots = Array.from(new Set([...uxSlots, ...pluginSlots]));
  const previewImages = mod.meta.previewImage ? [mod.meta.previewImage] : undefined;
  return {
    manifest: {
      id: mod.id,
      version: '1.0.0',
      themeApi: 2,
      runtime: 'official-code',
      minAppVersion: APP_THEME_VERSION,
      name: mod.name,
      author: 'JotLuck',
      description: mod.meta.story,
      capabilities: mod.capabilities,
      permissions: ['shell-layout', 'component-replace', 'visual-effects', 'theme-storage'],
      layoutPreset: mod.recipe.layoutPreset,
      checksums: { 'theme.css': BUILTIN_CHECKSUM },
      slots: slots.length > 0 ? slots : undefined,
      previewImages,
      category: 'official',
      tags: mod.tags,
      price: 'included',
      sku: `${mod.id}@1.0.0`,
      channel: source === 'market' ? 'local-market' : 'builtin',
      licenseKind: source === 'market' ? 'free' : 'included',
      entitlement: {
        state: source === 'market' ? 'free' : 'included',
        provider: 'local-mock',
      },
      catalogUrl: '/v1/themes/catalog',
      bundleUrl: `local://themes/${mod.id}`,
      publisher: {
        id: 'JotLuck',
        name: 'JotLuck',
        verified: true,
      },
      releaseNotes: 'Bundled with the local JotLuck theme catalog.',
      compatibility: {
        minAppVersion: APP_THEME_VERSION,
        themeApi: 2,
      },
      commercialNote:
        source === 'market'
          ? 'Local market sample. Future paid catalog providers can reuse this manifest shape.'
          : 'Included official theme. Core writing features are never locked behind commerce.',
    },
    css: buildThemeCss(mod.id, mod.tokens, mod.css),
    source,
    installedAt: 0,
    previewImages,
    officialProfile: mod.meta,
    catalogVisibility: mod.catalogVisibility ?? 'public',
    module: mod,
    ux: mod.ux,
    readonly: true,
  };
}

const officialLocaleKeys: Record<string, string> = {
  paper: 'paper',
  'jotluck.ability-lab': 'abilityLab',
  'jotluck.halo-canvas': 'haloCanvas',
  'jotluck.lumen-field': 'lumenField',
  'jotluck.super-workbench': 'superWorkbench',
};

function localizedThemeModule(mod: OfficialThemeModule): OfficialThemeModule {
  const localeKey = officialLocaleKeys[mod.id];
  if (!localeKey) return mod;
  // i18n-dynamic-key: localeKey is a closed official theme key and fields are fixed below.
  const key = (field: string): string => translate(`theme.official.${localeKey}.${field}`);
  const drawerShell = mod.recipe.drawerShell
    ? {
        left: { ...mod.recipe.drawerShell.left, label: translate('theme.plugin.fileBeacon') },
        right: {
          ...mod.recipe.drawerShell.right,
          label: translate('theme.plugin.knowledgeRadar'),
        },
        bottom: {
          ...mod.recipe.drawerShell.bottom,
          label: translate('theme.plugin.commandDeck'),
        },
      }
    : undefined;
  const ux = mod.ux
    ? Object.fromEntries(
        Object.entries(mod.ux).map(([slot, recipe]) => [
          slot,
          recipe
            ? {
                ...recipe,
                root: {
                  ...recipe.root,
                  children: recipe.root.children?.map((child) =>
                    child.type === 'Text' ? { ...child, text: key('name') } : child,
                  ),
                },
              }
            : recipe,
        ]),
      )
    : undefined;
  return {
    ...mod,
    name: key('name'),
    meta: {
      ...mod.meta,
      headline: key('headline'),
      story: key('story'),
      bestFor: key('bestFor').split('|'),
      visualFeatures: key('features').split('|'),
      uiProfile: { ...mod.meta.uiProfile },
    },
    recipe: { ...mod.recipe, drawerShell },
    ux,
  };
}

function buildThemeCss(id: string, tokens: ThemeTokenSet, extraCss?: string): string {
  const parts: string[] = [];
  const entries = Object.entries(tokens);

  if (entries.length > 0) {
    parts.push(
      `[data-theme-id='${id}'] {\n` +
        entries.map(([key, value]) => `  ${key}: ${value};`).join('\n') +
        '\n}',
    );
  }

  if (extraCss) {
    const unscoped = findUnscopedCssSelector(extraCss, id);
    if (unscoped) {
      throw createUserMessageError('theme.validation.officialCssUnscoped', {
        selector: unscoped,
      });
    }
    parts.push(extraCss.trim());
  }

  return parts.join('\n');
}

function cloneOfficialProfile(profile?: OfficialThemeProfile): OfficialThemeProfile | undefined {
  if (!profile) return undefined;
  return {
    ...profile,
    bestFor: [...profile.bestFor],
    visualFeatures: [...profile.visualFeatures],
    uiProfile: { ...profile.uiProfile },
  };
}

function cloneThemePack(pack: InstalledThemePack): InstalledThemePack {
  return {
    ...pack,
    manifest: {
      ...(pack.manifest as ThemePackManifest),
      capabilities: [...pack.manifest.capabilities],
      checksums: { ...pack.manifest.checksums },
      previewImages: pack.manifest.previewImages ? [...pack.manifest.previewImages] : undefined,
      tags: pack.manifest.tags ? [...pack.manifest.tags] : undefined,
      entitlement: pack.manifest.entitlement ? { ...pack.manifest.entitlement } : undefined,
      publisher: pack.manifest.publisher ? { ...pack.manifest.publisher } : undefined,
      compatibility: pack.manifest.compatibility ? { ...pack.manifest.compatibility } : undefined,
    },
    previewImages: pack.previewImages ? [...pack.previewImages] : undefined,
    assetMap: pack.assetMap ? { ...pack.assetMap } : undefined,
    officialProfile: cloneOfficialProfile(pack.officialProfile),
  };
}

export function getBuiltInThemePacks(): InstalledThemePack[] {
  return getAllThemeModules().map((mod) =>
    cloneThemePack(moduleToPack(localizedThemeModule(mod), 'builtin')),
  );
}

export function getLocalMarketThemePacks(): InstalledThemePack[] {
  return getLocalMarketModules().map((mod) =>
    cloneThemePack(moduleToPack(localizedThemeModule(mod), 'market')),
  );
}

export function getAllRegistryThemePacks(): InstalledThemePack[] {
  return [...getBuiltInThemePacks(), ...getLocalMarketThemePacks()];
}

export function getThemePerformanceBadge(level: ThemePerformanceLevel): ThemePerformanceBadge {
  return getThemePerformanceBadges()[level];
}

export function getOfficialThemeProfile(themeId: string): OfficialThemeProfile | undefined {
  return cloneOfficialProfile(
    getAllRegistryThemePacks().find((pack) => pack.manifest.id === themeId)?.officialProfile,
  );
}
