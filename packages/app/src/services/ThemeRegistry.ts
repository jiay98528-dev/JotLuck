import archivePreview from '@/assets/theme-assets/archive-preview.webp';
import inkStudyBackground from '@/assets/theme-assets/ink-study-bg.webp';
import inkStudyPreview from '@/assets/theme-assets/ink-study-preview.webp';
import nocturneReaderBackground from '@/assets/theme-assets/nocturne-reader-bg.webp';
import nocturneReaderPreview from '@/assets/theme-assets/nocturne-reader-preview.webp';
import paperPreview from '@/assets/theme-assets/paper-preview.webp';
import studioPreview from '@/assets/theme-assets/studio-preview.webp';
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

const builtInThemes: InstalledThemePack[] = [
  createBuiltInTheme({
    id: DEFAULT_THEME_ID,
    name: '羽翼布局',
    description: '默认三栏羽翼布局，保留 MarkLuck 的安静书房气质。',
    capabilities: ['tokens', 'layout-preset', 'markdown', 'codemirror'],
    layoutPreset: 'winged',
    tags: ['default', 'writing', 'workflow'],
    profile: {
      role: 'baseline',
      headline: '稳定的写作桌面',
      story: 'MarkLuck 的基线体验。左翼承载最近笔记，中心保留写作版心，右翼提供大纲、反链和标签。',
      bestFor: ['日常写作', '首次使用', '低性能设备', '长时间整理'],
      visualFeatures: ['三栏稳定布局', '低干扰纸面', '最少动效', '完整控件权重'],
      uiProfile: {
        toolbarDensity: 'calm',
        sidebarMode: 'balanced',
        drawerEmphasis: 'medium',
        readingWidth: 'standard',
        motionIntensity: 'none',
      },
      performanceLevel: 1,
      previewImage: paperPreview,
      effectProfile: 'none',
    },
    css: '',
  }),
  createBuiltInTheme({
    id: 'markluck.ink-study',
    name: '墨线书房',
    description: '日间墨线、纸纹与纹章背景，适合长文写作和安静校订。',
    capabilities: ['tokens', 'assets', 'animations', 'layout-preset', 'markdown', 'codemirror'],
    layoutPreset: 'focus',
    tags: ['focus', 'writing', 'ink', 'collectible'],
    profile: {
      role: 'collectible',
      headline: '纸面上的建筑线稿',
      story:
        '更窄的焦点版心配合墨绿色结构线。背景不是装饰画，而是把文件、纹章和书写网格融成一个工作台。',
      bestFor: ['长文写作', '校订', '需要轻仪式感的日间工作', '收藏主题展示'],
      visualFeatures: ['本地纸纹背景', '左侧纹章结构', '微弱脉冲线', '轻粒子层'],
      uiProfile: {
        toolbarDensity: 'calm',
        sidebarMode: 'quiet',
        drawerEmphasis: 'low',
        readingWidth: 'standard',
        motionIntensity: 'medium',
      },
      performanceLevel: 3,
      previewImage: inkStudyPreview,
      backgroundAsset: inkStudyBackground,
      effectProfile: 'ambient',
    },
    css: `
[data-theme-id='markluck.ink-study'][data-color-scheme='light'] {
  --paper-bg: oklch(0.968 0.006 205);
  --paper-left: oklch(0.932 0.011 198);
  --paper-surface: oklch(0.989 0.003 190);
  --paper-right: oklch(0.948 0.008 186);
  --paper-raised: oklch(0.996 0.002 190);
  --ink-primary: oklch(0.18 0.018 205);
  --ink-secondary: oklch(0.42 0.016 198);
  --ink-muted: oklch(0.58 0.012 196);
  --accent: oklch(0.44 0.075 190);
  --accent-hover: oklch(0.38 0.085 190);
  --accent-soft: oklch(0.9 0.032 190 / 0.62);
  --rule: oklch(0.79 0.018 190);
  --rule-strong: oklch(0.67 0.024 190);
  --rule-wing: oklch(0.76 0.02 196);
  --editor-bg: oklch(0.985 0.003 190);
  --editor-line-highlight: oklch(0.95 0.012 190);
  --editor-max-width: 720px;
  --lh-body: 1.82;
  --radius: 3px;
  --radius-md: 5px;
  --shadow-sheet: 0 12px 30px oklch(0.42 0.025 190 / 0.1);
}
[data-theme-id='markluck.ink-study'][data-color-scheme='dark'] {
  --paper-bg: oklch(0.14 0.012 210);
  --paper-left: oklch(0.115 0.014 208);
  --paper-surface: oklch(0.17 0.01 208);
  --paper-right: oklch(0.13 0.012 198);
  --paper-raised: oklch(0.205 0.011 205);
  --ink-primary: oklch(0.9 0.005 198);
  --ink-secondary: oklch(0.68 0.008 198);
  --ink-muted: oklch(0.52 0.008 198);
  --accent: oklch(0.68 0.08 184);
  --accent-hover: oklch(0.74 0.08 184);
  --accent-soft: oklch(0.28 0.038 184 / 0.74);
  --rule: oklch(0.29 0.014 205);
  --rule-strong: oklch(0.38 0.016 198);
  --rule-wing: oklch(0.25 0.014 205);
  --editor-bg: oklch(0.158 0.01 208);
  --editor-line-highlight: oklch(0.21 0.012 205);
  --editor-max-width: 720px;
  --lh-body: 1.82;
  --radius: 3px;
  --radius-md: 5px;
  --shadow-sheet: 0 18px 36px oklch(0.02 0.01 210 / 0.38);
}
[data-theme-id='markluck.ink-study'] .app-shell {
  box-shadow:
    inset 1px 0 0 var(--rule-wing),
    inset -1px 0 0 var(--rule-wing);
}
[data-theme-id='markluck.ink-study'] .topbar {
  border-bottom-color: var(--rule-strong);
}
[data-theme-id='markluck.ink-study'] .markdown-body blockquote {
  border-color: var(--accent);
  background: var(--accent-soft);
}
[data-theme-id='markluck.ink-study'] .markdown-body table {
  border-color: var(--rule-strong);
}
[data-theme-id='markluck.ink-study'] .cm-editor .cm-cursor {
  border-left-color: var(--accent);
}
`,
  }),
  createBuiltInTheme({
    id: 'markluck.archive',
    name: '档案馆',
    description: '资料研究工作流主题，强化文件、标签、反链和搜索的权重。',
    capabilities: ['tokens', 'animations', 'layout-preset', 'markdown', 'codemirror'],
    layoutPreset: 'archive',
    tags: ['archive', 'research', 'workflow'],
    profile: {
      role: 'workflow',
      headline: '资料优先的研究台',
      story:
        '侧栏更厚重，文件抽屉和右侧参考区更像档案柜。它不是更花，而是把检索、标签和反链放到更高优先级。',
      bestFor: ['资料整理', '研究笔记', '多文件对照', '标签和反链密集场景'],
      visualFeatures: ['加宽右翼', '厚重侧栏', '档案纸色', '检索面板权重提升'],
      uiProfile: {
        toolbarDensity: 'productive',
        sidebarMode: 'research',
        drawerEmphasis: 'high',
        readingWidth: 'wide',
        motionIntensity: 'low',
      },
      performanceLevel: 2,
      previewImage: archivePreview,
      effectProfile: 'subtle',
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
  --wing-right-width: 284px;
  --drawer-width: 380px;
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
  --wing-right-width: 284px;
  --drawer-width: 380px;
  --radius: 4px;
  --radius-md: 6px;
}
[data-theme-id='markluck.archive'] .app-shell {
  box-shadow: inset 64px 0 0 oklch(0.48 0.04 104 / 0.065);
}
`,
  }),
  createBuiltInTheme({
    id: 'markluck.reader-nocturne',
    name: '夜读星幕',
    description: '深色沉浸阅读主题，降低侧翼噪声并加入本地星幕动效。',
    capabilities: ['tokens', 'assets', 'animations', 'layout-preset', 'markdown', 'codemirror'],
    layoutPreset: 'reader',
    tags: ['reader', 'dark', 'collectible'],
    profile: {
      role: 'collectible',
      headline: '夜间阅读的星幕桌面',
      story:
        '深色正文版心、暗纸纹和轻微星尘层共同服务夜间阅读。它更像一张安静的阅读桌，而不是终端皮肤。',
      bestFor: ['夜间阅读', '外部 Markdown 只读打开', '长文复盘', '沉浸式主题收藏'],
      visualFeatures: ['本地星幕背景', '柔和呼吸光', '弱化侧翼', '更宽阅读版心'],
      uiProfile: {
        toolbarDensity: 'calm',
        sidebarMode: 'quiet',
        drawerEmphasis: 'low',
        readingWidth: 'immersive',
        motionIntensity: 'high',
      },
      performanceLevel: 4,
      previewImage: nocturneReaderPreview,
      backgroundAsset: nocturneReaderBackground,
      effectProfile: 'immersive',
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
  --editor-max-width: 780px;
  --lh-body: 1.9;
}
[data-theme-id='markluck.reader-nocturne'] .markdown-body {
  font-size: 1.04rem;
}
`,
  }),
  createBuiltInTheme({
    id: 'markluck.studio',
    name: '工坊轨道',
    description: '生产工作流主题，压缩工具轨并突出导出、模板和多文件操作。',
    capabilities: ['tokens', 'animations', 'layout-preset', 'markdown', 'codemirror'],
    layoutPreset: 'studio',
    tags: ['studio', 'dense', 'workflow'],
    profile: {
      role: 'workflow',
      headline: '更紧凑的生产轨道',
      story: '顶部工具和状态栏更紧凑，版心更窄，操作密度提升。适合把笔记快速整理、导出和分发。',
      bestFor: ['模板复用', '批量整理', '导出交付', '窗口较小的工作场景'],
      visualFeatures: ['紧凑工具轨', '更短状态栏', '暖橙操作强调', '生产面板优先'],
      uiProfile: {
        toolbarDensity: 'compact',
        sidebarMode: 'rail',
        drawerEmphasis: 'high',
        readingWidth: 'compact',
        motionIntensity: 'low',
      },
      performanceLevel: 2,
      previewImage: studioPreview,
      effectProfile: 'subtle',
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
  }),
];

function createBuiltInTheme(options: {
  id: string;
  name: string;
  description: string;
  capabilities: ThemePackManifest['capabilities'];
  layoutPreset: ThemeLayoutPreset;
  tags: string[];
  profile: OfficialThemeProfile;
  css: string;
}): InstalledThemePack {
  return {
    manifest: {
      id: options.id,
      version: '1.0.0',
      themeApi: 1,
      runtime: 'css-v1',
      minAppVersion: '0.15.0',
      name: options.name,
      author: 'MarkLuck',
      description: options.description,
      capabilities: options.capabilities,
      layoutPreset: options.layoutPreset,
      checksums: { 'theme.css': BUILTIN_CHECKSUM },
      category: 'official',
      tags: options.tags,
      price: 'included',
    },
    css: options.css,
    source: 'builtin',
    installedAt: 0,
    officialProfile: options.profile,
    readonly: true,
  };
}

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
