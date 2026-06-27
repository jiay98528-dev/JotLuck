// ============================================================
// MarkLuck — 类型系统统一入口
// ============================================================
// 所有业务代码应从此文件导入类型。

// --- editor.ts ---
export type {
  BlockType,
  BlockMode,
  MarkdownBlock,
  HeadingItem,
  TabItem,
  ToolbarItemConfig,
  AppSettings,
  BacklinkEntry,
  TagEntry,
  TemplateItem,
  ContextMenuItem,
  ParagraphPreset,
  FormatAction,
} from './editor';

// --- theme-pack.ts ---
export type {
  ThemeRuntime,
  ThemePermission,
  ThemeLayoutPreset,
  ThemeCapability,
  ThemePackSource,
  OfficialThemeRole,
  ThemeEffectProfile,
  ThemePerformanceLevel,
  ThemeTopBarVariant,
  ThemeLeftWingMode,
  ThemeRightWingMode,
  ThemeSidebarMode,
  ThemeToolbarDensity,
  ThemeReferenceSection,
  ThemeWorkspaceIntent,
  ThemeViewMode,
  ThemeTopBarLayout,
  ThemeLeftWingLayout,
  ThemeEditorControlLayout,
  ThemeStatusLayout,
  ThemeRightWingPolicy,
  ThemeActionId,
  ThemeActionRegion,
  ThemeActionPlacements,
  ThemeSlotId,
  ThemePrimitiveType,
  ThemeActionBinding,
  ThemePrimitiveNode,
  UxComponentRecipe,
  ThemeUxRecipeMap,
  ThemeCodeEntrypoint,
  ThemeManifestV2,
  ThemePackageInput,
  ShellAction,
  ThemePerformanceBadge,
  OfficialThemeUiProfile,
  ThemeChromeState,
  OfficialThemeProfile,
  ThemePackManifest,
  InstalledThemePack,
  ThemeValidationIssue,
  ThemePackInstallResult,
} from './theme-pack';

// --- note.ts ---
export type {
  NotePath,
  NoteContent,
  InlineFormatType,
  NoteFrontmatter,
  WikiLink,
  Note,
  Nullable,
  Optional,
  DeepPartial,
  DeepReadonly,
  DeepRequired,
  Result,
  AsyncResult,
  Prettify,
  ValuesOf,
  NonEmptyArray,
  Mutable,
  RequireAtLeastOne,
  Brand,
} from './note';

// --- notebook.ts ---
export type { IndexStatus, Notebook, FileTreeNode, NotebookMeta, RecentNote } from './notebook';

// --- search.ts ---
export type {
  DateRange,
  SearchQuery,
  SearchMatch,
  SearchResult,
  Posting,
  TermEntry,
  DocumentEntry,
  SearchIndex,
} from './search';

// --- export.ts ---
export { ExportFormat, ShareChannel } from './export';
export type { ExportOptions, ExportResult, ShareOptions } from './export';

// --- file-system.ts ---
export type {
  DirEntry,
  FileStat,
  FileChangeEvent,
  NotebookHandle,
  UnwatchFn,
  IFileSystemService,
} from './file-system';
