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
  ThemeMode,
  AppSettings,
  BacklinkEntry,
  TagEntry,
  TemplateItem,
  ContextMenuItem,
} from './editor';

export type { ColorScheme } from './editor';

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
