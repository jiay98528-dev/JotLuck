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
