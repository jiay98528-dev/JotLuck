export type ThemeRuntime = 'declarative' | 'official-code' | 'trusted-code';

export type ThemePermission =
  | 'shell-layout'
  | 'component-replace'
  | 'visual-effects'
  | 'theme-storage'
  | 'network'
  | 'filesystem-read'
  | 'filesystem-write';

export type ThemeLayoutPreset =
  | 'winged'
  | 'focus'
  | 'archive'
  | 'reader'
  | 'studio'
  | 'atelier'
  | 'single-page';

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

export type ThemeDrawerSide = 'left' | 'right' | 'bottom';

export interface ThemeDrawerRegionRecipe {
  side: ThemeDrawerSide;
  slot: ThemeSlotId;
  label: string;
  size: number;
  minSize?: number;
  maxSize?: number;
  defaultPinned?: boolean;
}

export interface ThemeDrawerShellRecipe {
  left: ThemeDrawerRegionRecipe;
  right: ThemeDrawerRegionRecipe;
  bottom: ThemeDrawerRegionRecipe;
}

export type ThemeSlotId =
  | 'app-shell'
  | 'topbar'
  | 'left-wing'
  | 'right-wing'
  | 'editor-control'
  | 'status-bar'
  | 'home'
  | 'workflow-canvas'
  | 'editor-surface'
  | 'reader-workbench'
  | 'file-drawer'
  | 'command-palette'
  | 'export-dialog'
  | 'template-dialog'
  | 'settings-dialog'
  | 'share-dialog'
  | 'new-file-dialog'
  | 'delete-confirm-dialog'
  | 'external-edit-dialog'
  | 'scratch-exit-dialog'
  | 'external-reader'
  | 'markdown-cheat-sheet'
  | 'toast-container'
  | 'update-notification'
  | 'dialogs.theme';

export type ThemeCatalogChannel = 'builtin' | 'local-market' | 'remote-market' | 'imported';

export type ThemeCatalogVisibility = 'public' | 'developer';

export type ThemeLicenseKind = 'free' | 'included' | 'paid' | 'supporter' | 'team' | 'unknown';

export type ThemeEntitlementState =
  | 'included'
  | 'free'
  | 'owned'
  | 'trial'
  | 'purchase-required'
  | 'offline-unknown'
  | 'invalid';

export interface ThemePublisherInfo {
  id: string;
  name: string;
  url?: string;
  verified?: boolean;
}

export interface ThemeCompatibilityInfo {
  minAppVersion: string;
  maxAppVersion?: string;
  themeApi: 2;
}

export interface ThemeEntitlementDescriptor {
  state: ThemeEntitlementState;
  licenseKey?: string;
  expiresAt?: string;
  checkedAt?: string;
  provider?: string;
  note?: string;
}

export interface ThemeCommerceDescriptor {
  sku?: string;
  channel?: ThemeCatalogChannel;
  licenseKind?: ThemeLicenseKind;
  entitlement?: ThemeEntitlementDescriptor;
  purchaseUrl?: string;
  catalogUrl?: string;
  bundleUrl?: string;
  publisher?: ThemePublisherInfo;
  releaseNotes?: string;
  compatibility?: ThemeCompatibilityInfo;
  commercialNote?: string;
}

export interface ThemeCatalogItem {
  manifest: ThemePackManifest;
  installed: boolean;
  updateAvailable?: boolean;
  entitlement: ThemeEntitlementDescriptor;
}

export interface ThemeCheckoutRequest {
  themeId: string;
  sku?: string;
  returnUrl?: string;
}

export interface ThemeCheckoutResult {
  provider: string;
  checkoutUrl: string;
  state: 'created' | 'local-mock' | 'unavailable';
}

export interface ThemeLicenseRedeemRequest {
  themeId: string;
  licenseKey: string;
}

export interface ThemeCommerceProvider {
  id: string;
  catalogEndpoint: '/v1/themes/catalog';
  entitlementsEndpoint: '/v1/themes/entitlements';
  checkoutEndpoint: '/v1/themes/checkout';
  redeemEndpoint: '/v1/themes/licenses/redeem';
  refreshEndpoint: '/v1/themes/entitlements/refresh';
  getCatalog: () => Promise<ThemeCatalogItem[]>;
  getEntitlements: () => Promise<Record<string, ThemeEntitlementDescriptor>>;
  createCheckout: (request: ThemeCheckoutRequest) => Promise<ThemeCheckoutResult>;
  redeemLicense: (
    request: ThemeLicenseRedeemRequest,
  ) => Promise<Record<string, ThemeEntitlementDescriptor>>;
  refreshEntitlements: () => Promise<Record<string, ThemeEntitlementDescriptor>>;
}

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
  sku?: string;
  channel?: ThemeCatalogChannel;
  licenseKind?: ThemeLicenseKind;
  entitlement?: ThemeEntitlementDescriptor;
  purchaseUrl?: string;
  catalogUrl?: string;
  bundleUrl?: string;
  publisher?: ThemePublisherInfo;
  releaseNotes?: string;
  compatibility?: ThemeCompatibilityInfo;
  commercialNote?: string;
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
  drawerShell?: ThemeDrawerShellRecipe;
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
  sku?: string;
  channel?: ThemeCatalogChannel;
  licenseKind?: ThemeLicenseKind;
  entitlement?: ThemeEntitlementDescriptor;
  purchaseUrl?: string;
  catalogUrl?: string;
  bundleUrl?: string;
  publisher?: ThemePublisherInfo;
  releaseNotes?: string;
  compatibility?: ThemeCompatibilityInfo;
  commercialNote?: string;
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
  catalogVisibility?: ThemeCatalogVisibility;
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

export type ThemeSlotProps = Record<string, unknown>;

export interface ThemeHostStorage {
  get: (key: string) => string | null;
  set: (key: string, value: string) => void;
  remove: (key: string) => void;
}

export interface ThemeHostActionRegistry {
  list: () => readonly ShellAction[];
  dispatch: (actionId: ThemeActionId) => void;
}

export interface ThemeHostSlotRegistry {
  has: (slot: ThemeSlotId) => boolean;
}

export interface ThemeHostEditorApi {
  getContent: () => string;
  setContent?: (content: string) => void;
  focus?: () => void;
}

export interface ThemeHostDialogApi {
  open: (dialog: ThemeSlotId) => void;
  close: (dialog: ThemeSlotId) => void;
}

export interface ThemeHostToastApi {
  show: (message: string) => void;
}

export interface ThemeHostContext {
  readonly themeId: string;
  readonly manifest?: ThemePackManifest;
  readonly runtime: ThemeRuntime;
  readonly permissions: readonly ThemePermission[];
  readonly chrome: ThemeChromeState;
  readonly actions: ThemeHostActionRegistry;
  readonly slots: ThemeHostSlotRegistry;
  readonly storage: ThemeHostStorage;
  readonly editor: ThemeHostEditorApi;
  readonly dialogs: ThemeHostDialogApi;
  readonly toast: ThemeHostToastApi;
  readonly commerce: ThemeCommerceProvider;
  readonly appState: Record<string, unknown>;
  readonly ui: Record<string, unknown>;
  dispatchAction: (actionId: ThemeActionId) => void;
}

export interface ThemePluginModule {
  activate?: (context: ThemeHostContext) => void | (() => void);
  components?: Partial<Record<ThemeSlotId, unknown>>;
  css?: string;
}

export interface ThemePluginRegistration {
  themeId: string;
  components: Partial<Record<ThemeSlotId, unknown>>;
  dispose: () => void;
}

export const THEME_API_VERSION = 2;

export const THEME_LAYOUT_PRESETS: ThemeLayoutPreset[] = [
  'winged',
  'focus',
  'archive',
  'reader',
  'studio',
  'atelier',
  'single-page',
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
  'network',
  'filesystem-read',
  'filesystem-write',
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
  drawerShell?: ThemeDrawerShellRecipe;
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
  /** 内部目录可见性，不写入用户导入的 .mltheme manifest。 */
  catalogVisibility?: ThemeCatalogVisibility;
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
  /** P0: 官方本地全权限 UX 插件入口 */
  plugin?: ThemePluginModule;
}
