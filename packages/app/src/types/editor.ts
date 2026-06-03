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

/** 解析后的单个语法块 */
export interface MarkdownBlock {
  index: number;
  type: BlockType;
  raw: string;
  from: number;
  to: number;
  isValid: boolean;
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

/** 主题模式 */
export type ThemeMode = 'construct' | 'glass';
export type ColorScheme = 'light' | 'dark';

/** 应用全局设置 */
export interface AppSettings {
  theme: ThemeMode;
  colorScheme: ColorScheme;
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
  name: string;
  path: string;
  description?: string;
}

/** 右键菜单项 */
export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  action: string;
  disabled?: boolean;
  divider?: boolean;
}
