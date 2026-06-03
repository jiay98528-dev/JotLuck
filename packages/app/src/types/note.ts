// ============================================================
// MarkLuck — Note 核心类型定义
// ============================================================
// Source: spec/types/note.ts + spec/types/editor.ts (BlockType)

import type { BlockType } from './editor';

/** 笔记相对路径（统一使用 / 分隔符） */
export type NotePath = string;

/** 笔记正文内容 */
export type NoteContent = string;

/** 行内格式类型 */
export type InlineFormatType =
  | 'bold'
  | 'italic'
  | 'boldItalic'
  | 'code'
  | 'link'
  | 'image'
  | 'strikethrough'
  | 'highlight'
  | 'tag';

/** YAML Frontmatter 解析后的结构化数据 */
export interface NoteFrontmatter {
  title?: string;
  tags?: string[];
  created?: string;
  updated?: string;
  description?: string;
  draft?: boolean;
  [key: string]: unknown;
}

/** 解析后的 Wiki-link 实体 */
export interface WikiLink {
  target: string;
  alias?: string;
  anchor?: string;
  isValid: boolean;
}

/** 编辑器中的一个语法块 */
export interface NoteBlock {
  id: string;
  type: BlockType;
  rawContent: string;
  renderedContent: string;
  mode: 'source' | 'render';
  isValid: boolean;
  startOffset: number;
  endOffset: number;
  meta?: Record<string, unknown>;
}

/** MarkLuck 核心实体 — 笔记 */
export interface Note {
  id: string;
  title: string;
  path: string;
  content: string;
  frontmatter: NoteFrontmatter;
  createdAt: number;
  modifiedAt: number;
  tags: string[];
  links: WikiLink[];
}

// ================================================================
// 共享泛型工具类型
// ================================================================

/** 将 T 变为可空类型（T | null） */
export type Nullable<T> = T | null;

/** 将 T 变为可空类型（T | undefined） */
export type Optional<T> = T | undefined;

/** 递归地将类型 T 的所有属性变为可选 */
export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

/** 递归地将类型 T 的所有属性变为只读 */
export type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

/** 递归地将类型 T 的所有属性变为必填 */
export type DeepRequired<T> = T extends object ? { [K in keyof T]-?: DeepRequired<T[K]> } : T;

/** Rust 风格的 Result 类型 */
export type Result<T, E = Error> = { success: true; data: T } | { success: false; error: E };

/** Result<T, E> 的 Promise 包装 */
export type AsyncResult<T, E = Error> = Promise<Result<T, E>>;

/** 展开交叉类型，使 IDE 的类型提示更可读 */
export type Prettify<T> = { [K in keyof T]: T[K] } & {};

/** 提取对象/枚举类型 T 的所有值类型的联合 */
export type ValuesOf<T> = T[keyof T];

/** 至少包含一个元素的数组 */
export type NonEmptyArray<T> = [T, ...T[]];

/** 移除类型 T 所有属性的 readonly 修饰符 */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** 要求类型 T 中至少存在 Keys 联合中的一个属性 */
export type RequireAtLeastOne<T, Keys extends keyof T = keyof T> = {
  [K in Keys]-?: Required<Pick<T, K>> & Partial<Omit<T, K>>;
}[Keys] &
  Omit<T, Keys>;

/** 名义类型标记 */
export type Brand<T, BrandName extends string> = T & { __brand: BrandName };
