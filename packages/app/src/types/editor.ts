// ============================================================
// JotLuck — Editor Types
// ============================================================

import type { SupportedLocale } from './i18n';

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
  language: SupportedLocale;
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
