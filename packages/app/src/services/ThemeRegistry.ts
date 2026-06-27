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

export const ACTIVE_THEME_STYLE_ID = 'markluck-active-theme';
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
  return {
    manifest: {
      id: mod.id,
      version: '1.0.0',
      themeApi: 2,
      runtime: 'official-code',
      minAppVersion: APP_THEME_VERSION,
      name: mod.name,
      author: 'MarkLuck',
      description: mod.meta.story,
      capabilities: mod.capabilities,
      permissions: ['shell-layout', 'component-replace', 'visual-effects', 'theme-storage'],
      layoutPreset: mod.recipe.layoutPreset,
      checksums: { 'theme.css': BUILTIN_CHECKSUM },
      slots: mod.ux ? (Object.keys(mod.ux) as ThemeSlotId[]) : undefined,
      category: 'official',
      tags: mod.tags,
      price: 'included',
    },
    css: buildThemeCss(mod.id, mod.tokens, mod.css),
    source,
    installedAt: 0,
    officialProfile: mod.meta,
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
