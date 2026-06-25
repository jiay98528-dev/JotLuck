import { getAllThemeModules } from '@/themes/registry';
import type { OfficialThemeModule, ThemeTokenSet } from '@/types/theme-pack';
import type {
  InstalledThemePack,
  OfficialThemeProfile,
  ThemeLayoutPreset,
  ThemePackManifest,
  ThemePerformanceBadge,
  ThemePerformanceLevel,
} from '@/types/theme-pack';

export const THEME_STATE_STORAGE_KEY = 'markluck:theme:v2';
export const LEGACY_THEME_STORAGE_KEY = 'markluck-theme';
export const INSTALLED_THEMES_STORAGE_KEY = 'markluck:themes:installed:v1';
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
};

/**
 * v2 声明式主题模块 → InstalledThemePack 转换器。
 *
 * 将 OfficialThemeModule 的声明式数据（recipe + tokens + meta）转换为
 * 运行时使用的 InstalledThemePack 格式，保持向后兼容。
 */
function moduleToBuiltInPack(mod: OfficialThemeModule): InstalledThemePack {
  return {
    manifest: {
      id: mod.id,
      version: '1.0.0',
      themeApi: 1,
      runtime: 'css-v1',
      minAppVersion: '0.15.0',
      name: mod.name,
      author: 'MarkLuck',
      description: mod.meta.story,
      capabilities: mod.capabilities,
      layoutPreset: mod.recipe.layoutPreset,
      checksums: { 'theme.css': BUILTIN_CHECKSUM },
      category: 'official',
      tags: mod.tags,
      price: 'included',
    },
    css: buildThemeCss(mod.id, mod.tokens, mod.css),
    source: 'builtin',
    installedAt: 0,
    officialProfile: mod.meta,
    module: mod,
    readonly: true,
  };
}

/** 将 token 集 + 额外 CSS 合并为 theme.css 字符串 */
function buildThemeCss(id: string, tokens: ThemeTokenSet, extraCss?: string): string {
  const parts: string[] = [];

  for (const scheme of ['light', 'dark'] as const) {
    const tokenMap = tokens[scheme];
    const entries = Object.entries(tokenMap);
    if (entries.length === 0) continue;

    parts.push(
      `[data-theme-id='${id}'][data-color-scheme='${scheme}'] {\n` +
        entries.map(([key, value]) => `  ${key}: ${value};`).join('\n') +
        '\n}',
    );
  }

  if (extraCss) {
    parts.push(extraCss.trim());
  }

  return parts.join('\n');
}

/** 遍历所有注册的主题模块构建 builtInThemes */
function buildAllBuiltInPacks(): InstalledThemePack[] {
  return getAllThemeModules().map(moduleToBuiltInPack);
}

const builtInThemes: InstalledThemePack[] = buildAllBuiltInPacks();

function storageAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
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
      ...pack.manifest,
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

function sanitizeStoredPack(value: unknown): InstalledThemePack | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<InstalledThemePack>;
  if (!candidate.manifest || typeof candidate.css !== 'string') return null;
  if (typeof candidate.manifest.id !== 'string' || candidate.manifest.id === DEFAULT_THEME_ID) {
    return null;
  }
  return {
    manifest: candidate.manifest as ThemePackManifest,
    css: candidate.css,
    source: 'imported',
    installedAt: typeof candidate.installedAt === 'number' ? candidate.installedAt : Date.now(),
    previewImages: Array.isArray(candidate.previewImages) ? candidate.previewImages : undefined,
    assetMap:
      candidate.assetMap && typeof candidate.assetMap === 'object'
        ? (candidate.assetMap as Record<string, string>)
        : undefined,
    readonly: false,
  };
}

export function getBuiltInThemePacks(): InstalledThemePack[] {
  return builtInThemes.map(cloneThemePack);
}

export function getThemePerformanceBadge(level: ThemePerformanceLevel): ThemePerformanceBadge {
  return THEME_PERFORMANCE_BADGES[level];
}

export function getOfficialThemeProfile(themeId: string): OfficialThemeProfile | undefined {
  return cloneOfficialProfile(
    builtInThemes.find((pack) => pack.manifest.id === themeId)?.officialProfile,
  );
}

export function loadInstalledThemePacks(): InstalledThemePack[] {
  if (!storageAvailable()) return [];
  try {
    const raw = window.localStorage.getItem(INSTALLED_THEMES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeStoredPack)
      .filter((pack): pack is InstalledThemePack => pack !== null);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[ThemeRegistry] failed to read installed themes', error);
    return [];
  }
}

export function persistInstalledThemePacks(packs: InstalledThemePack[]): void {
  if (!storageAvailable()) return;
  const imported = packs
    .filter((pack) => pack.source !== 'builtin' && pack.manifest.id !== DEFAULT_THEME_ID)
    .map((pack) => ({ ...pack, officialProfile: undefined }));
  window.localStorage.setItem(INSTALLED_THEMES_STORAGE_KEY, JSON.stringify(imported));
}

export function listThemePacks(): InstalledThemePack[] {
  const byId = new Map<string, InstalledThemePack>();
  for (const pack of getBuiltInThemePacks()) byId.set(pack.manifest.id, pack);
  for (const pack of loadInstalledThemePacks()) byId.set(pack.manifest.id, pack);
  return [...byId.values()];
}

export function findThemePack(themeId: string): InstalledThemePack | undefined {
  return listThemePacks().find((pack) => pack.manifest.id === themeId);
}

export function saveInstalledThemePack(pack: InstalledThemePack): InstalledThemePack[] {
  const normalized: InstalledThemePack = {
    ...pack,
    source: pack.source === 'builtin' ? 'imported' : pack.source,
    officialProfile: undefined,
    readonly: false,
    installedAt: pack.installedAt || Date.now(),
  };
  const next = loadInstalledThemePacks().filter(
    (item) => item.manifest.id !== normalized.manifest.id,
  );
  next.push(normalized);
  persistInstalledThemePacks(next);
  return next;
}

export function removeInstalledThemePack(themeId: string): InstalledThemePack[] {
  const next = loadInstalledThemePacks().filter((pack) => pack.manifest.id !== themeId);
  persistInstalledThemePacks(next);
  return next;
}

export function isBuiltInThemeId(themeId: string): boolean {
  return builtInThemes.some((pack) => pack.manifest.id === themeId);
}

export function fallbackLayoutPreset(themeId: string): ThemeLayoutPreset {
  return findThemePack(themeId)?.manifest.layoutPreset ?? 'winged';
}
