export type ColorScheme = 'light' | 'dark';

export type ThemeRuntime = 'css-v1' | 'sandboxed-plugin-v2';

export type ThemeLayoutPreset = 'winged' | 'focus' | 'archive' | 'reader' | 'studio';

export type ThemeCapability =
  | 'tokens'
  | 'assets'
  | 'animations'
  | 'layout-preset'
  | 'markdown'
  | 'codemirror';

export type ThemePackSource = 'builtin' | 'imported' | 'market';

export type OfficialThemeRole = 'baseline' | 'workflow' | 'collectible';

export type ThemeEffectProfile = 'none' | 'subtle' | 'ambient' | 'immersive';

export type ThemePerformanceLevel = 1 | 2 | 3 | 4 | 5;

export type ThemeTopBarVariant = 'balanced' | 'writing' | 'archive' | 'reader' | 'studio';

export type ThemeLeftWingMode = 'default' | 'research' | 'quiet' | 'rail';

export type ThemeRightWingMode = 'balanced' | 'research' | 'quiet' | 'rail';

export type ThemeSidebarMode = 'balanced' | 'research' | 'quiet' | 'rail';

export type ThemeToolbarDensity = 'calm' | 'compact' | 'productive';

export type ThemeReferenceSection = 'outline' | 'backlinks' | 'tags';

export type ThemeWorkspaceIntent = 'baseline' | 'writing' | 'archive' | 'reader' | 'studio';

export type ThemeViewMode = 'live' | 'split' | 'read';

export type ThemeTopBarLayout = 'classic' | 'title-first' | 'search-first' | 'reader' | 'compact';

export type ThemeLeftWingLayout =
  | 'bookmarks'
  | 'quiet-bookmarks'
  | 'research-stack'
  | 'studio-rail';

export type ThemeEditorControlLayout = 'toolbar' | 'writing-strip' | 'hidden' | 'studio-rail';

export type ThemeStatusLayout = 'full' | 'quiet' | 'save-only' | 'compact';

export type ThemeRightWingPolicy = 'outline' | 'research' | 'collapsed' | 'production';

export type ThemeActionId =
  | 'new-note'
  | 'file-drawer'
  | 'search'
  | 'template'
  | 'export'
  | 'share'
  | 'settings'
  | 'theme-toggle'
  | 'view-toggle';

export type ThemeActionRegion =
  | 'topbar-left'
  | 'topbar-center'
  | 'topbar-right'
  | 'left-wing'
  | 'editor-control'
  | 'studio-rail'
  | 'reader-bar'
  | 'hidden';

export type ThemeActionPlacements = Record<ThemeActionId, ThemeActionRegion>;

export interface ShellAction {
  id: ThemeActionId;
  region: ThemeActionRegion;
  label: string;
  shortLabel: string;
  title: string;
  icon: ThemeActionId;
  run: () => void | Promise<void>;
  active?: boolean;
  disabled?: boolean;
}

export interface ThemePerformanceBadge {
  level: ThemePerformanceLevel;
  name: string;
  color: string;
  icon: string;
  description: string;
}

export interface OfficialThemeUiProfile {
  toolbarDensity: ThemeToolbarDensity;
  sidebarMode: ThemeSidebarMode;
  drawerEmphasis: 'low' | 'medium' | 'high';
  readingWidth: 'standard' | 'wide' | 'immersive' | 'compact';
  motionIntensity: 'none' | 'low' | 'medium' | 'high';
}

export interface ThemeChromeState {
  official: boolean;
  layoutPreset: ThemeLayoutPreset;
  role: OfficialThemeRole | 'local';
  topBarVariant: ThemeTopBarVariant;
  leftWingMode: ThemeLeftWingMode;
  rightWingMode: ThemeRightWingMode;
  toolbarDensity: ThemeToolbarDensity;
  statusDensity: ThemeToolbarDensity;
  drawerEmphasis: OfficialThemeUiProfile['drawerEmphasis'];
  readingWidth: OfficialThemeUiProfile['readingWidth'];
  effectProfile: ThemeEffectProfile;
  motionIntensity: OfficialThemeUiProfile['motionIntensity'];
  rightWingSections: ThemeReferenceSection[];
  defaultOpenSections: ThemeReferenceSection[];
  workspaceIntent: ThemeWorkspaceIntent;
  defaultViewMode: ThemeViewMode;
  topBarLayout: ThemeTopBarLayout;
  leftWingLayout: ThemeLeftWingLayout;
  editorControlLayout: ThemeEditorControlLayout;
  statusLayout: ThemeStatusLayout;
  rightWingPolicy: ThemeRightWingPolicy;
  actionPlacements: ThemeActionPlacements;
}

export interface OfficialThemeProfile {
  role: OfficialThemeRole;
  headline: string;
  story: string;
  bestFor: string[];
  visualFeatures: string[];
  uiProfile: OfficialThemeUiProfile;
  performanceLevel: ThemePerformanceLevel;
  previewImage?: string;
  backgroundAsset?: string;
  effectProfile: ThemeEffectProfile;
}

export interface ThemePackManifest {
  id: string;
  version: string;
  themeApi: 1;
  runtime: ThemeRuntime;
  minAppVersion: string;
  name: string;
  author: string;
  description?: string;
  homepage?: string;
  license?: string;
  capabilities: ThemeCapability[];
  layoutPreset: ThemeLayoutPreset;
  checksums: Record<string, string>;
  previewImages?: string[];
  category?: string;
  tags?: string[];
  price?: string;
}

export interface InstalledThemePack {
  manifest: ThemePackManifest;
  css: string;
  source: ThemePackSource;
  installedAt: number;
  previewImages?: string[];
  assetMap?: Record<string, string>;
  officialProfile?: OfficialThemeProfile;
  /** v2: 关联的声明式主题模块（仅 officialTheme 填充） */
  module?: OfficialThemeModule;
  readonly?: boolean;
}

export interface ThemeValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export interface ThemePackInstallResult {
  pack: InstalledThemePack;
  warnings: ThemeValidationIssue[];
}

export const THEME_API_VERSION = 1;

export const THEME_LAYOUT_PRESETS: ThemeLayoutPreset[] = [
  'winged',
  'focus',
  'archive',
  'reader',
  'studio',
];

export const THEME_CAPABILITIES: ThemeCapability[] = [
  'tokens',
  'assets',
  'animations',
  'layout-preset',
  'markdown',
  'codemirror',
];

// ── v2 Declarative Theme Module Types ──────────────────────

/** 主题作者声明的 Shell 装配配方 — 直接声明布局意图，无需运行时推导 */
export interface ShellRecipe {
  layoutPreset: ThemeLayoutPreset;
  workspaceIntent: ThemeWorkspaceIntent;
  defaultViewMode: ThemeViewMode;
  topBar: { variant: ThemeTopBarVariant; layout: ThemeTopBarLayout };
  leftWing: { mode: ThemeLeftWingMode; layout: ThemeLeftWingLayout };
  editorControl: { layout: ThemeEditorControlLayout; density: ThemeToolbarDensity };
  statusBar: { layout: ThemeStatusLayout; density: ThemeToolbarDensity };
  rightWing: {
    mode: ThemeRightWingMode;
    policy: ThemeRightWingPolicy;
    sections: ThemeReferenceSection[];
    defaultOpenSections: ThemeReferenceSection[];
  };
  readingWidth: OfficialThemeUiProfile['readingWidth'];
  drawerEmphasis: OfficialThemeUiProfile['drawerEmphasis'];
  motionIntensity: OfficialThemeUiProfile['motionIntensity'];
  actionPlacements: ThemeActionPlacements;
}

/** 每个主题声明 light + dark 两套 OKLCH CSS 自定义属性覆盖 */
export interface ThemeTokenSet {
  light: Record<string, string>;
  dark: Record<string, string>;
}

export interface ThemeAssetMap {
  background?: string;
  crest?: string;
  [key: string]: string | undefined;
}

/**
 * 官方深度主题模块 — 主题作者使用的声明式接口。
 * 一个模块声明了 meta（品牌信息）、recipe（布局装配）、tokens（色值）和可选 CSS/资产。
 */
export interface OfficialThemeModule {
  /** 全局唯一标识（如 'markluck.ink-study'） */
  id: string;
  /** 用户可见名称（如 '墨线书房'） */
  name: string;
  /** 分类标签 */
  tags: string[];
  /** 声明的能力集 */
  capabilities: ThemeCapability[];
  /** 品牌信息 */
  meta: OfficialThemeProfile;
  /** 布局装配配方 */
  recipe: ShellRecipe;
  /** light + dark 两套 OKLCH 色值 */
  tokens: ThemeTokenSet;
  /** 超出 Token 可表达的附加 CSS */
  css?: string;
  /** 静态资产 */
  assets?: ThemeAssetMap;
}
