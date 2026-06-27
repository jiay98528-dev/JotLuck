// ============================================================
// MarkLuck — Editor / Block Types
// ============================================================
// Source: spec/types/editor.ts (authoritative for BlockType)

/** 语法块类型枚举 */
export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'inlineCode'
  | 'codeBlock'
  | 'blockquote'
  | 'unorderedList'
  | 'orderedList'
  | 'taskList'
  | 'link'
  | 'image'
  | 'table'
  | 'horizontalRule'
  | 'wikiLink'
  | 'tag'
  | 'math'
  | 'footnote'
  | 'frontmatter';

/** 语法块显示模式 */
export type BlockMode = 'source' | 'render';

/** 固定格式栏的段落样式预设 */
export type ParagraphPreset = 'paragraph' | 'heading1' | 'heading2' | 'heading3' | 'blockquote';

/** 编辑器格式命令 */
export type FormatAction =
  | ParagraphPreset
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'inlineCode'
  | 'link'
  | 'clear';

/** 解析后的单个语法块 — M1 统一类型（合并 MarkdownBlock + NoteBlock） */
export interface MarkdownBlock {
  /** 块唯一标识符（格式: ${notePath}::${startOffset}） */
  id: string;
  /** 块在笔记中的序号（从 0 开始） */
  index: number;
  /** 块类型 */
  type: BlockType;
  /** 原始 Markdown 源码 */
  raw: string;
  /** CodeMirror 文档中的起始字符偏移 */
  from: number;
  /** CodeMirror 文档中的结束字符偏移 */
  to: number;
  /** 语法是否完整有效 */
  isValid: boolean;
  /** 显示模式：源码编辑 / 渲染预览 */
  mode: BlockMode;
  /** 渲染后的 HTML（仅在 render 模式下填充） */
  renderedHtml?: string;
  /** 附加元数据（按 BlockType 不同携带不同信息） */
  meta?: Record<string, unknown>;
}

/** 标题节点（用于导航树渲染） */
export interface HeadingItem {
  id: string;
  level: number;
  text: string;
  lineNumber: number;
  children: HeadingItem[];
}

/** 编辑器标签页条目 */
export interface TabItem {
  id: string;
  notePath: string;
  title: string;
  isDirty: boolean;
  isLoading: boolean;
}

/** 工具栏按钮配置 */
export interface ToolbarItemConfig {
  id: string;
  label: string;
  icon: string;
  action: string;
  shortcut?: string;
}

/** 应用全局设置 */
export interface AppSettings {
  autoFormat: boolean;
  autoFormatDelay: number;
  fontSize: number;
  tabSize: number;
  showLineNumbers: boolean;
  defaultNotebookPath?: string;
}

/** 反向链接条目 */
export interface BacklinkEntry {
  notePath: string;
  noteTitle: string;
  context: string;
  lineNumber: number;
}

/** 标签条目（在标签云/过滤中展示） */
export interface TagEntry {
  name: string;
  count: number;
}

/** 模板条目 */
export interface TemplateItem {
  id: string;
  name: string;
  description?: string;
  content: string;
  isBuiltin: boolean;
}

/** 右键菜单项 */
export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  action?: string | (() => void);
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
  children?: ContextMenuItem[];
}
