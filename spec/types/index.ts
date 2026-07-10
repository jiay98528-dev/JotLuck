// ============================================================
// spec/types/index.ts — JotLuck 类型系统统一入口
// ============================================================
//
// 本文件是 JotLuck 所有 TypeScript 类型的唯一聚合导出点。
// 所有业务代码应从此文件导入类型，而非直接从子模块导入。
//
// 用法：
//   import type { NotePath, MarkdownBlock, SearchResult } from '@/types';
//   import type { Result, Nullable, DeepPartial } from '@/types';
//
// ============================================================

// ================================================================
// 一、子模块类型全部透出 (barrel re-exports)
// ================================================================

// --- note.ts ---
export type { NotePath, NoteContent } from './note';

// --- notebook.ts ---
export type { IndexStatus, Notebook, FileTreeNode, NotebookMeta, RecentNote } from './notebook';

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

// --- export.ts  (also contains share types) ---
export type {
  ExportFormat,
  ExportOptions,
  ExportResult,
  ShareChannel,
  ShareOptions,
} from './export';

// --- file-system.ts ---
export type {
  DirEntry,
  FileStat,
  FileChangeEvent,
  NotebookHandle,
  UnwatchFn,
  IFileSystemService,
} from './file-system';

// ================================================================
// 二、共享泛型工具类型 (Shared Utility Types)
// ================================================================

// ------------------------------------------------------------------
// Nullable<T>
// ------------------------------------------------------------------
/** 将 T 变为可空类型（T | null）。比直接写 null 更语义化。 */
export type Nullable<T> = T | null;

// ------------------------------------------------------------------
// Optional<T>
// ------------------------------------------------------------------
/** 将 T 变为可空类型（T | undefined）。 */
export type Optional<T> = T | undefined;

// ------------------------------------------------------------------
// DeepPartial<T>
// ------------------------------------------------------------------
/**
 * 递归地将类型 T 的所有属性变为可选。
 *
 * 适用于：
 * - Pinia Store 的 patch/update 方法参数
 * - 用户设置的部分更新（SettingsPanel 的 settings-changed 事件）
 * - 索引增量更新（部分字段变更）
 */
export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

// ------------------------------------------------------------------
// DeepReadonly<T>
// ------------------------------------------------------------------
/** 递归地将类型 T 的所有属性变为只读 */
export type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

// ------------------------------------------------------------------
// DeepRequired<T>
// ------------------------------------------------------------------
/** 递归地将类型 T 的所有属性变为必填（去除 optional 修饰符） */
export type DeepRequired<T> = T extends object ? { [K in keyof T]-?: DeepRequired<T[K]> } : T;

// ------------------------------------------------------------------
// Result<T, E>
// ------------------------------------------------------------------
/**
 * Rust 风格的 Result 类型，用于明确表达可失败操作的返回值。
 *
 * 成功时携带 data，失败时携带 error。
 * 业务代码通过判别式联合进行类型收窄 (type narrowing)。
 *
 * 用法：
 * ```typescript
 * function readConfig(): Result<Config, 'FileNotFound' | 'ParseError'> {
 *   if (!fileExists) return { success: false, error: 'FileNotFound' };
 *   return { success: true, data: config };
 * }
 *
 * const result = readConfig();
 * if (result.success) {
 *   console.log(result.data.theme);
 * } else {
 *   console.error(`加载失败: ${result.error}`);
 * }
 * ```
 */
export type Result<T, E = Error> = { success: true; data: T } | { success: false; error: E };

// ------------------------------------------------------------------
// AsyncResult<T, E>
// ------------------------------------------------------------------
/** Result<T, E> 的 Promise 包装，用于异步操作的返回类型标注。 */
export type AsyncResult<T, E = Error> = Promise<Result<T, E>>;

// ------------------------------------------------------------------
// Prettify<T>
// ------------------------------------------------------------------
/**
 * 展开交叉类型，使 IDE 的类型提示更可读。
 *
 * 用法：
 * ```typescript
 * type NoteWithMeta = Prettify<NoteContent & { indexEntry: NoteIndexEntry }>;
 * ```
 */
export type Prettify<T> = { [K in keyof T]: T[K] } & {};

// ------------------------------------------------------------------
// ValuesOf<T>
// ------------------------------------------------------------------
/** 提取对象/枚举类型 T 的所有值类型的联合 */
export type ValuesOf<T> = T[keyof T];

// ------------------------------------------------------------------
// NonEmptyArray<T>
// ------------------------------------------------------------------
/** 至少包含一个元素的数组 */
export type NonEmptyArray<T> = [T, ...T[]];

// ------------------------------------------------------------------
// Mutable<T>
// ------------------------------------------------------------------
/** 移除类型 T 所有属性的 readonly 修饰符 */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// ------------------------------------------------------------------
// RequireAtLeastOne<T, Keys>
// ------------------------------------------------------------------
/**
 * 要求类型 T 中至少存在 Keys 联合中的一个属性。
 *
 * 适用于：
 * - 搜索参数（至少提供 text 或 tags 或 dateRange 之一）
 * - 组件 Props（至少提供一种数据源）
 */
export type RequireAtLeastOne<T, Keys extends keyof T = keyof T> = {
  [K in Keys]-?: Required<Pick<T, K>> & Partial<Omit<T, K>>;
}[Keys] &
  Omit<T, Keys>;

// ------------------------------------------------------------------
// Brand<T, BrandName>
// ------------------------------------------------------------------
/**
 * 名义类型标记 (Nominal Typing / Branded Type)。
 *
 * 为基本类型（如 string）附加编译时的品牌标记，
 * 防止不同类型的 string 相互错误赋值。
 *
 * 用法：
 * ```typescript
 * type UserId = Brand<string, 'UserId'>;
 * type NoteId = Brand<string, 'NoteId'>;
 * const uid: UserId = 'usr_123' as UserId;
 * const nid: NoteId = 'note_456' as NoteId;
 * // uid = nid;  // 编译错误
 * ```
 */
export type Brand<T, BrandName extends string> = T & { __brand: BrandName };
