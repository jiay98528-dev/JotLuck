// ============================================================
// spec/types/editor.ts — 编辑器/块级编辑/UI 配置相关类型
// ============================================================

// ===== 语法块 =====

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
  /** 块序号（从 0 开始） */
  index: number;
  /** 块类型 */
  type: BlockType;
  /** 原始 Markdown 文本 */
  raw: string;
  /** CodeMirror 文档中该块的起始位置（字符偏移） */
  from: number;
  /** CodeMirror 文档中该块的结束位置（字符偏移） */
  to: number;
  /** 语法是否有效 */
  isValid: boolean;
  /** 块级元数据（如 heading level、link url、code language 等） */
  meta?: Record<string, unknown>;
}

// ===== 导航树 =====

/** 标题节点（用于导航树渲染） */
export interface HeadingItem {
  /** 唯一标识 */
  id: string;
  /** 标题级别 (1-6) */
  level: number;
  /** 标题文本（去除 # 标记） */
  text: string;
  /** 所在行号（从 1 开始） */
  lineNumber: number;
  /** 子标题列表 */
  children: HeadingItem[];
}

// ===== 标签页 =====

/** 编辑器标签页条目 */
export interface TabItem {
  /** 标签页唯一 ID */
  id: string;
  /** 笔记相对路径 */
  notePath: string;
  /** 显示标题（文件名或首个 H1） */
  title: string;
  /** 是否有未保存的修改 */
  isDirty: boolean;
  /** 笔记内容是否正在加载 */
  isLoading: boolean;
}

// ===== 工具栏 =====

/** 工具栏按钮配置 */
export interface ToolbarItemConfig {
  /** 对应的语法块类型 */
  type: BlockType;
  /** 图标标识（Unicode 字符或 SVG 名称） */
  icon: string;
  /** 按钮文字标签（国际化 key） */
  label: string;
  /** 快捷键提示文本（如 'Ctrl+B'） */
  shortcut: string;
}

// ===== 主题 =====

/** 主题模式 */
export type ThemeMode = 'light' | 'dark' | 'system';

// ===== 文字补全 =====

/** 补全候选条目（结构化补全菜单使用） */
export interface CompletionItem {
  /** 显示标签 */
  label: string;
  /** 补充说明（如文件路径） */
  detail: string;
  /** 实际插入的文本 */
  apply: string;
}

/** 统计预测结果（Ghost Text 使用） */
export interface PredictionResult {
  /** 预测文本（1-20 字符） */
  text: string;
  /** 置信度 0-1，< 阈值时不显示 ghost text */
  confidence: number;
  /** 预测起点在文档中的位置 */
  from: number;
  source?: 'structured' | 'ngram' | 'recent' | 'llm';
  sourceLayer?: CompletionSourceLayer;
  providerId?: string;
  syntaxType?: string;
  learnable?: boolean;
}

export type CompletionSourceLayer =
  | 'l1'
  | 'l2'
  | 'l3'
  | 'short-l1'
  | 'short-l2'
  | 'short-l3'
  | 'provider'
  | 'fallback';

/** 补全源类型 */
export type CompletionSourceType =
  | 'format-closure'
  | 'markdown-structure'
  | 'wiki-link'
  | 'tag'
  | 'file-path'
  | 'sequence-pattern'
  | 'short-chinese'
  | 'short-english'
  | 'ngram'
  | 'recent-phrase'
  | 'llm';

/** 补全源接口 */
export interface CompletionSource {
  /** 补全源类型 */
  type: CompletionSourceType;
  /** 触发前缀字符 */
  trigger: string;
  /** 获取候选列表 */
  getCompletions(query: string): CompletionItem[];
}

export interface CompletionContext {
  doc: string;
  cursorPos: number;
  line: {
    text: string;
    from: number;
    to: number;
    cursorColumn: number;
    beforeCursor: string;
  } | null;
  syntax: {
    type: string;
    prefix: string;
    openMarker?: string;
  };
  atEndOfLine: boolean;
  emptyLine: boolean;
  languageHint: 'zh' | 'en' | 'mixed' | 'unknown';
}

export interface CompletionCandidate {
  text: string;
  confidence: number;
  informationScore?: number;
  from: number;
  providerId: CompletionSourceType;
  source: 'structured' | 'ngram' | 'recent' | 'llm';
  sourceLayer?: CompletionSourceLayer;
  syntaxType: string;
  learnable: boolean;
  priority: number;
}

export interface CompletionProvider {
  id: CompletionSourceType;
  priority: number;
  canProvide(context: CompletionContext): boolean;
  provide(context: CompletionContext): CompletionCandidate | null;
}

// ===== 应用设置 =====

/** 应用全局设置（持久化到 localStorage） */
export interface AppSettings {
  // --- 编辑器 ---
  /** 编辑器字体大小 (px)，默认 16，范围 12-24 */
  editorFontSize: number;
  /** 编辑器行高比例，默认 1.6 */
  editorLineHeight: number;
  /** 编辑器等宽字体栈 */
  editorFontFamily: string;
  /** Tab 缩进空格数，默认 2 */
  editorTabSize: number;
  /** 是否启用自动换行 */
  editorWordWrap: boolean;
  /** 是否显示行号 */
  editorShowLineNumbers: boolean;
  /** 是否显示语法块边界标记点 */
  editorShowBlockMarkers: boolean;
  /** 是否启用自动格式识别 */
  editorAutoFormat: boolean;
  /** 是否启用文字补全（幽灵文本 + 结构化补全） */
  editorAutoCompletion: boolean;

  // --- 主题 ---
  /** 主题模式 */
  themeMode: ThemeMode;
  /** 浅色主题下的代码高亮主题名 */
  codeThemeLight: string;
  /** 深色主题下的代码高亮主题名 */
  codeThemeDark: string;

  // --- 自动保存 ---
  /** 是否启用自动保存 */
  autoSaveEnabled: boolean;
  /** 自动保存防抖延迟 (ms)，默认 2000 */
  autoSaveDelayMs: number;

  // --- 文件 ---
  /** 默认笔记本路径 */
  defaultNotebookPath: string;
  /** 最近笔记最大记录数，默认 20 */
  maxRecentNotes: number;

  // --- 语言 ---
  /** 界面语言 */
  language: 'zh-CN' | 'en';
}

// ===== Wiki-link / 反向链接 / 标签（展示层类型） =====

/** 反向链接条目（BacklinksPanel 使用） */
export interface BacklinkEntry {
  /** 引用来源笔记路径 */
  sourcePath: string;
  /** 引用来源笔记标题 */
  sourceTitle: string;
  /** 引用处的上下文片段（前后各 30 字符） */
  context: string;
  /** 引用所在行号 */
  lineNumber: number;
}

/** 标签条目（TagPanel 使用） */
export interface TagEntry {
  /** 标签名（不含 #） */
  tag: string;
  /** 引用次数 */
  count: number;
  /** 使用该标签的笔记路径列表 */
  notes: string[];
}

/** 模板条目（TemplateDialog 使用） */
export interface TemplateItem {
  /** 模板唯一标识 */
  id: string;
  /** 模板名称 */
  name: string;
  /** 模板描述 */
  description: string;
  /** 原始模板内容（含占位符如 {{date}}） */
  content: string;
  /** 是否为内置模板 */
  isBuiltin: boolean;
}

/** 右键菜单项配置 */
export interface ContextMenuItem {
  /** 菜单项唯一标识 */
  id: string;
  /** 显示文字 */
  label: string;
  /** 图标 */
  icon?: string;
  /** 快捷键提示 */
  shortcut?: string;
  /** 是否禁用 */
  disabled?: boolean;
  /** 是否为危险操作（红色文字） */
  danger?: boolean;
  /** 此项是否为分隔线 */
  divider?: boolean;
  /** 子菜单项 */
  children?: ContextMenuItem[];
  /** 点击回调 */
  action?: () => void;
}
