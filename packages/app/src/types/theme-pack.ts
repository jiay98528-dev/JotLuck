export type ThemeRuntime = 'declarative' | 'official-code' | 'trusted-code';

export type ThemePermission =
  | 'shell-layout'
  | 'component-replace'
  | 'visual-effects'
  | 'theme-storage'
  | 'network'
  | 'filesystem-read'
  | 'filesystem-write';

export type ThemeLayoutPreset = 'winged' | 'focus' | 'archive' | 'reader' | 'studio' | 'atelier';

export type ThemeCapability =
  | 'tokens'
  | 'assets'
  | 'animations'
  | 'layout-preset'
  | 'ux-components'
  | 'trusted-code'
  | 'markdown'
  | 'codemirror';

export type ThemePackSource = 'builtin' | 'imported' | 'market';

export type OfficialThemeRole = 'baseline' | 'workflow' | 'collectible';

export type ThemeEffectProfile = 'none' | 'subtle' | 'ambient' | 'immersive';

export type ThemePerformanceLevel = 1 | 2 | 3 | 4 | 5;

export type ThemeTopBarVariant =
  | 'balanced'
  | 'writing'
  | 'archive'
  | 'reader'
  | 'studio'
  | 'atelier';

export type ThemeLeftWingMode = 'default' | 'research' | 'quiet' | 'rail' | 'navigator';

export type ThemeRightWingMode = 'balanced' | 'research' | 'quiet' | 'rail' | 'atlas';

export type ThemeSidebarMode = 'balanced' | 'research' | 'quiet' | 'rail';

export type ThemeToolbarDensity = 'calm' | 'compact' | 'productive';

export type ThemeReferenceSection = 'outline' | 'backlinks' | 'tags';

export type ThemeWorkspaceIntent =
  | 'baseline'
  | 'writing'
  | 'archive'
  | 'reader'
  | 'studio'
  | 'atelier';

export type ThemeViewMode = 'live' | 'split' | 'read';

export type ThemeTopBarLayout =
  | 'classic'
  | 'title-first'
  | 'search-first'
  | 'reader'
  | 'compact'
  | 'workbench';

export type ThemeLeftWingLayout =
  | 'bookmarks'
  | 'quiet-bookmarks'
  | 'research-stack'
  | 'studio-rail'
  | 'navigator';

export type ThemeEditorControlLayout =
  | 'toolbar'
  | 'writing-strip'
  | 'hidden'
  | 'studio-rail'
  | 'stacked';

export type ThemeStatusLayout = 'full' | 'quiet' | 'save-only' | 'compact' | 'dashboard';

export type ThemeRightWingPolicy = 'outline' | 'research' | 'collapsed' | 'production' | 'atlas';

export type ThemeActionId =
  | 'new-note'
  | 'file-drawer'
  | 'search'
  | 'template'
  | 'export'
  | 'share'
  | 'theme'
  | 'settings'
  | 'view-toggle';

export type ThemeActionRegion =
  | 'topbar-left'
  | 'topbar-center'
  | 'topbar-right'
  | 'left-wing'
  | 'editor-control'
  | 'studio-rail'
  | 'reader-bar'
  | 'status-right'
  | 'hidden';

export type ThemeActionPlacements = Record<ThemeActionId, ThemeActionRegion>;

export type ThemeSlotId =
  | 'app-shell'
  | 'topbar'
  | 'left-wing'
  | 'right-wing'
  | 'editor-control'
  | 'status-bar'
  | 'home'
  | 'scratch'
  | 'dialogs.theme';

export type ThemePrimitiveType =
  | 'Stack'
  | 'Grid'
  | 'Panel'
  | 'Text'
  | 'ActionList'
  | 'ActionButton'
  | 'NoteList'
  | 'HeadingTree'
  | 'TagCloud'
  | 'EditorStatus'
  | 'ThemePreview'
  | 'Slot';

export interface ThemeActionBinding {
  actionId: ThemeActionId;
  label?: string;
  icon?: ThemeActionId;
}

export interface ThemePrimitiveNode {
  type: ThemePrimitiveType;
  id?: string;
  className?: string;
  text?: string;
  action?: ThemeActionBinding;
  props?: Record<string, string | number | boolean | undefined>;
  children?: ThemePrimitiveNode[];
}

export interface UxComponentRecipe {
  slot: ThemeSlotId;
  name?: string;
  root: ThemePrimitiveNode;
}

export type ThemeUxRecipeMap = Partial<Record<ThemeSlotId, UxComponentRecipe>>;

export interface ThemeCodeEntrypoint {
  slot: ThemeSlotId;
  module: string;
  exportName?: string;
  checksum: string;
}

export interface ThemeManifestV2 {
  id: string;
  version: string;
  themeApi: 2;
  runtime: ThemeRuntime;
  minAppVersion: string;
  name: string;
  author: string;
  description?: string;
  homepage?: string;
  license?: string;
  capabilities: ThemeCapability[];
  permissions: ThemePermission[];
  layoutPreset: ThemeLayoutPreset;
  checksums: Record<string, string>;
  entrypoints?: ThemeCodeEntrypoint[];
  slots?: ThemeSlotId[];
  previewImages?: string[];
  category?: string;
  tags?: string[];
  price?: string;
}

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
  themeApi: 1 | 2;
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
  permissions?: ThemePermission[];
  entrypoints?: ThemeCodeEntrypoint[];
  slots?: ThemeSlotId[];
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
  ux?: ThemeUxRecipeMap;
  codeBundles?: Record<string, string>;
  readonly?: boolean;
  trustedCodeAuthorized?: boolean;
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

export interface ThemePackageInput {
  manifest: ThemeManifestV2;
  css?: string;
  ux?: ThemeUxRecipeMap;
  codeBundles?: Record<string, string>;
}

export const THEME_API_VERSION = 1;

export const THEME_LAYOUT_PRESETS: ThemeLayoutPreset[] = [
  'winged',
  'focus',
  'archive',
  'reader',
  'studio',
  'atelier',
];

export const THEME_CAPABILITIES: ThemeCapability[] = [
  'tokens',
  'assets',
  'animations',
  'layout-preset',
  'ux-components',
  'trusted-code',
  'markdown',
  'codemirror',
];

export const THEME_DEFAULT_ALLOWED_PERMISSIONS: ThemePermission[] = [
  'shell-layout',
  'component-replace',
  'visual-effects',
  'theme-storage',
];

// ── v2 Declarative Theme Module Types ──────────────────────

/** 区域装配片段 — 每个区域组件接收一个统一的 recipe 对象 */
export interface TopBarRegion {
  variant: ThemeTopBarVariant;
  layout: ThemeTopBarLayout;
}

export interface LeftWingRegion {
  mode: ThemeLeftWingMode;
  layout: ThemeLeftWingLayout;
}

export interface EditorControlRegion {
  layout: ThemeEditorControlLayout;
  density: ThemeToolbarDensity;
}

export interface StatusBarRegion {
  layout: ThemeStatusLayout;
  density: ThemeToolbarDensity;
}

export interface RightWingRegion {
  mode: ThemeRightWingMode;
  policy: ThemeRightWingPolicy;
  sections: ThemeReferenceSection[];
  defaultOpenSections: ThemeReferenceSection[];
}

/** 主题作者声明的 Shell 装配配方 — 直接声明布局意图，无需运行时推导 */
export interface ShellRecipe {
  layoutPreset: ThemeLayoutPreset;
  workspaceIntent: ThemeWorkspaceIntent;
  defaultViewMode: ThemeViewMode;
  topBar: TopBarRegion;
  leftWing: LeftWingRegion;
  editorControl: EditorControlRegion;
  statusBar: StatusBarRegion;
  rightWing: RightWingRegion;
  readingWidth: OfficialThemeUiProfile['readingWidth'];
  drawerEmphasis: OfficialThemeUiProfile['drawerEmphasis'];
  motionIntensity: OfficialThemeUiProfile['motionIntensity'];
  actionPlacements: ThemeActionPlacements;
  ux?: ThemeUxRecipeMap;
}

/** 单主题 token 覆盖 */
export type ThemeTokenSet = Record<string, string>;

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
  /** 全局唯一标识 */
  id: string;
  /** 用户可见名称 */
  name: string;
  /** 分类标签 */
  tags: string[];
  /** 声明的能力集 */
  capabilities: ThemeCapability[];
  /** 品牌信息 */
  meta: OfficialThemeProfile;
  /** 布局装配配方 */
  recipe: ShellRecipe;
  /** Token 覆盖 */
  tokens: ThemeTokenSet;
  /** 可替换 UX 组件 recipe */
  ux?: ThemeUxRecipeMap;
  /** 超出 Token 可表达的附加 CSS */
  css?: string;
  /** 静态资产 */
  assets?: ThemeAssetMap;
}
