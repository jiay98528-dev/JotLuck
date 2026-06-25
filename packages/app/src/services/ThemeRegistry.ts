import type { InstalledThemePack, ThemeLayoutPreset, ThemePackManifest } from '@/types/theme-pack';

export const THEME_STATE_STORAGE_KEY = 'markluck:theme:v2';
export const LEGACY_THEME_STORAGE_KEY = 'markluck-theme';
export const INSTALLED_THEMES_STORAGE_KEY = 'markluck:themes:installed:v1';
export const ACTIVE_THEME_STYLE_ID = 'markluck-active-theme';
export const DEFAULT_THEME_ID = 'paper';
export const APP_THEME_VERSION = '0.15.0';

const BUILTIN_CHECKSUM = 'sha256-builtin';

const builtInThemes: InstalledThemePack[] = [
  {
    manifest: {
      id: DEFAULT_THEME_ID,
      version: '1.0.0',
      themeApi: 1,
      runtime: 'css-v1',
      minAppVersion: '0.15.0',
      name: 'Paper',
      author: 'MarkLuck',
      description: '默认纸张主题，保留 MarkLuck 的安静书房气质。',
      capabilities: ['tokens', 'layout-preset', 'markdown', 'codemirror'],
      layoutPreset: 'winged',
      checksums: { 'theme.css': BUILTIN_CHECKSUM },
      category: 'official',
      tags: ['default', 'writing'],
      price: 'included',
    },
    css: '',
    source: 'builtin',
    installedAt: 0,
    readonly: true,
  },
  {
    manifest: {
      id: 'markluck.archive',
      version: '1.0.0',
      themeApi: 1,
      runtime: 'css-v1',
      minAppVersion: '0.15.0',
      name: 'Archive Desk',
      author: 'MarkLuck',
      description: '更重的文件柜质感，适合长期资料整理。',
      capabilities: ['tokens', 'animations', 'layout-preset', 'markdown', 'codemirror'],
      layoutPreset: 'archive',
      checksums: { 'theme.css': BUILTIN_CHECKSUM },
      category: 'official',
      tags: ['archive', 'research'],
      price: 'included',
    },
    css: `
[data-theme-id='markluck.archive'][data-color-scheme='light'] {
  --paper-bg: oklch(0.965 0.006 76);
  --paper-left: oklch(0.94 0.014 82);
  --paper-surface: oklch(0.982 0.004 78);
  --paper-right: oklch(0.953 0.006 108);
  --paper-raised: oklch(0.995 0.002 78);
  --ink-primary: oklch(0.19 0.01 72);
  --ink-secondary: oklch(0.42 0.012 80);
  --accent: oklch(0.48 0.1 155);
  --accent-hover: oklch(0.43 0.11 155);
  --accent-soft: oklch(0.9 0.04 155 / 0.55);
  --editor-max-width: 740px;
  --wing-right-width: 272px;
  --radius: 4px;
  --radius-md: 6px;
}
[data-theme-id='markluck.archive'][data-color-scheme='dark'] {
  --paper-bg: oklch(0.16 0.009 80);
  --paper-left: oklch(0.13 0.012 84);
  --paper-surface: oklch(0.19 0.008 78);
  --paper-right: oklch(0.16 0.01 120);
  --paper-raised: oklch(0.23 0.008 78);
  --ink-primary: oklch(0.88 0.006 78);
  --ink-secondary: oklch(0.66 0.008 86);
  --accent: oklch(0.66 0.11 155);
  --accent-hover: oklch(0.72 0.11 155);
  --accent-soft: oklch(0.28 0.045 155 / 0.7);
  --editor-max-width: 740px;
  --wing-right-width: 272px;
  --radius: 4px;
  --radius-md: 6px;
}
[data-theme-id='markluck.archive'] .app-shell {
  box-shadow: inset 56px 0 0 oklch(0.48 0.04 104 / 0.06);
}
`,
    source: 'builtin',
    installedAt: 0,
    readonly: true,
  },
  {
    manifest: {
      id: 'markluck.reader-nocturne',
      version: '1.0.0',
      themeApi: 1,
      runtime: 'css-v1',
      minAppVersion: '0.15.0',
      name: 'Nocturne Reader',
      author: 'MarkLuck',
      description: '夜间阅读优先，弱化侧翼和工具噪声。',
      capabilities: ['tokens', 'animations', 'layout-preset', 'markdown', 'codemirror'],
      layoutPreset: 'reader',
      checksums: { 'theme.css': BUILTIN_CHECKSUM },
      category: 'official',
      tags: ['reader', 'dark'],
      price: 'included',
    },
    css: `
[data-theme-id='markluck.reader-nocturne'] {
  --paper-bg: oklch(0.12 0.008 245);
  --paper-left: oklch(0.105 0.01 245);
  --paper-surface: oklch(0.155 0.008 250);
  --paper-right: oklch(0.12 0.01 232);
  --paper-raised: oklch(0.2 0.009 250);
  --ink-primary: oklch(0.9 0.004 250);
  --ink-secondary: oklch(0.69 0.006 245);
  --ink-muted: oklch(0.52 0.006 245);
  --accent: oklch(0.72 0.09 196);
  --accent-hover: oklch(0.78 0.09 196);
  --accent-soft: oklch(0.26 0.04 196 / 0.68);
  --rule: oklch(0.25 0.008 245);
  --rule-wing: oklch(0.22 0.009 245);
  --editor-bg: oklch(0.14 0.007 250);
  --editor-line-highlight: oklch(0.18 0.008 250);
  --editor-max-width: 760px;
  --lh-body: 1.9;
  --theme-bg-opacity: 0.16;
}
[data-theme-id='markluck.reader-nocturne'] .markdown-body {
  font-size: 1.04rem;
}
`,
    source: 'builtin',
    installedAt: 0,
    readonly: true,
  },
  {
    manifest: {
      id: 'markluck.studio',
      version: '1.0.0',
      themeApi: 1,
      runtime: 'css-v1',
      minAppVersion: '0.15.0',
      name: 'Studio Rail',
      author: 'MarkLuck',
      description: '更紧凑的生产布局，适合模板、导出和多文件整理。',
      capabilities: ['tokens', 'animations', 'layout-preset', 'markdown', 'codemirror'],
      layoutPreset: 'studio',
      checksums: { 'theme.css': BUILTIN_CHECKSUM },
      category: 'official',
      tags: ['studio', 'dense'],
      price: 'included',
    },
    css: `
[data-theme-id='markluck.studio'][data-color-scheme='light'] {
  --paper-bg: oklch(0.965 0.004 215);
  --paper-left: oklch(0.94 0.008 220);
  --paper-surface: oklch(0.985 0.002 215);
  --paper-right: oklch(0.948 0.007 210);
  --ink-primary: oklch(0.16 0.006 220);
  --accent: oklch(0.5 0.12 28);
  --accent-hover: oklch(0.45 0.13 28);
  --accent-soft: oklch(0.92 0.045 28 / 0.55);
  --editor-max-width: 640px;
  --topbar-height: 40px;
  --statusbar-height: 26px;
  --radius: 5px;
}
[data-theme-id='markluck.studio'][data-color-scheme='dark'] {
  --paper-bg: oklch(0.145 0.006 220);
  --paper-left: oklch(0.12 0.008 220);
  --paper-surface: oklch(0.18 0.006 220);
  --paper-right: oklch(0.14 0.008 210);
  --ink-primary: oklch(0.9 0.004 220);
  --accent: oklch(0.66 0.13 28);
  --accent-hover: oklch(0.72 0.13 28);
  --accent-soft: oklch(0.25 0.05 28 / 0.72);
  --editor-max-width: 640px;
  --topbar-height: 40px;
  --statusbar-height: 26px;
  --radius: 5px;
}
`,
    source: 'builtin',
    installedAt: 0,
    readonly: true,
  },
];

function storageAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
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
  return builtInThemes.map((pack) => ({ ...pack, manifest: { ...pack.manifest } }));
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
  const imported = packs.filter(
    (pack) => pack.source !== 'builtin' && pack.manifest.id !== DEFAULT_THEME_ID,
  );
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
