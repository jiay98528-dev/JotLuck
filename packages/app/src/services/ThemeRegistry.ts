import { getAllThemeModules } from '@/themes/registry';
import { localMarketModules } from '@/themes/market/local-catalog';
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

export const ACTIVE_THEME_STYLE_ID = 'jotluck-active-theme';
export const DEFAULT_THEME_ID = 'paper';
export const APP_THEME_VERSION = '0.15.0';

const BUILTIN_CHECKSUM = 'sha256-builtin';

export const THEME_PERFORMANCE_BADGES: Record<ThemePerformanceLevel, ThemePerformanceBadge> = {
  1: {
    level: 1,
    name: '轻盈',
    color: 'green',
    icon: 'leaf',
    description: '默认羽翼布局，稳定且低开销。',
  },
  2: {
    level: 2,
    name: '标准',
    color: 'cyan',
    icon: 'gauge',
    description: '保留字段，仅供兼容旧文档类型。',
  },
  3: {
    level: 3,
    name: '增强',
    color: 'blue',
    icon: 'spark',
    description: '保留字段，仅供兼容旧文档类型。',
  },
  4: {
    level: 4,
    name: '沉浸',
    color: 'purple',
    icon: 'moon',
    description: '保留字段，仅供兼容旧文档类型。',
  },
  5: {
    level: 5,
    name: '重载',
    color: 'orange',
    icon: 'flame',
    description: '保留字段，仅供兼容旧文档类型。',
  },
};

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
      throw new Error(`官方主题 CSS 未限定在当前主题根节点：${unscoped}`);
    }
    parts.push(extraCss.trim());
  }

  return parts.join('\n');
}

const builtInThemes: InstalledThemePack[] = getAllThemeModules().map((mod) =>
  moduleToPack(mod, 'builtin'),
);
const localMarketThemes: InstalledThemePack[] = localMarketModules.map((mod) =>
  moduleToPack(mod, 'market'),
);

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
  return builtInThemes.map(cloneThemePack);
}

export function getLocalMarketThemePacks(): InstalledThemePack[] {
  return localMarketThemes.map(cloneThemePack);
}

export function getAllRegistryThemePacks(): InstalledThemePack[] {
  return [...getBuiltInThemePacks(), ...getLocalMarketThemePacks()];
}

export function getThemePerformanceBadge(level: ThemePerformanceLevel): ThemePerformanceBadge {
  return THEME_PERFORMANCE_BADGES[level];
}

export function getOfficialThemeProfile(themeId: string): OfficialThemeProfile | undefined {
  return cloneOfficialProfile(
    [...builtInThemes, ...localMarketThemes].find((pack) => pack.manifest.id === themeId)
      ?.officialProfile,
  );
}
