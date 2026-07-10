/**
 * JotLuck — Note 核心类型定义
 *
 * 本文件定义与"笔记"相关的所有 TypeScript 类型/接口/枚举，
 * 覆盖实体、frontmatter、Wiki-link、块级编辑器等核心概念。
 *
 * 版本: v1.0
 * 日期: 2026-06-03
 * 关联 ADR: ADR-003 (文件架构), ADR-006 (双标签), ADR-007 (Wiki-link)
 */

// ============================================================================
// 1. 枚举 (Enums)
// ============================================================================

/**
 * 块级编辑器中的语法块类型。
 *
 * 每个 Markdown 语法元素在编辑器中对应一个"块"，可在源码/渲染模式间切换。
 *
 * @see components.md §12 MarkdownEditor — 块级编辑
 * @see ADR-004 (marked) — 解析器需要识别以下所有块类型
 */
export enum BlockType {
  /** 普通段落 */
  Paragraph = 'paragraph',

  /** Markdown 标题 (H1-H6) */
  Heading = 'heading',

  /** 围栏代码块 (```) */
  CodeBlock = 'codeBlock',

  /** 无序/有序列表组 (多个连续列表项视为一个块) */
  List = 'list',

  /** GFM 表格 */
  Table = 'table',

  /** 引用块 (>) */
  Blockquote = 'blockquote',

  /** LaTeX 数学公式块 ($$) */
  Math = 'math',

  /** 水平分割线 (--- / ***) */
  HorizontalRule = 'horizontalRule',
}

/**
 * 行内格式类型。
 *
 * 用于标记文本片段的内联样式，不产生独立的"块"边界。
 * 编辑器渲染时根据格式类型应用对应的 CSS class 和内联样式。
 *
 * 注意: boldItalic 单独列出（而非 bold + italic 叠加），
 * 因为需要支持单个渲染标记（减少 DOM 层级）。
 */
export enum InlineFormatType {
  /** 粗体 **text** */
  Bold = 'bold',

  /** 斜体 *text* */
  Italic = 'italic',

  /** 粗斜体 ***text*** */
  BoldItalic = 'boldItalic',

  /** 行内代码 `code` */
  Code = 'code',

  /** 超链接 [text](url) */
  Link = 'link',

  /** 图片 ![alt](url) */
  Image = 'image',

  /** 删除线 ~~text~~ */
  Strikethrough = 'strikethrough',

  /** 高亮 ==text== (GFM 扩展) */
  Highlight = 'highlight',

  /** 行内 #tag 标签 (非标准 Markdown，JotLuck 扩展) */
  Tag = 'tag',
}

// ============================================================================
// 2. Frontmatter — YAML 头信息
// ============================================================================

/**
 * YAML Frontmatter 解析后的结构化数据。
 *
 * 所有字段均为可选 — 用户可以完全不写 frontmatter。
 * 系统根据文件 mtime 自动填充 `createdAt`/`modifiedAt`，
 * 不强制依赖 frontmatter 中的日期。
 *
 * @see ADR-006 — 标签双轨制: frontmatter 中的 tags 与正文 #tag 统一合并
 *
 * @example
 * ```markdown
 * ---
 * title: JavaScript 闭包学习笔记
 * tags: [javascript, functional-programming]
 * created: 2026-06-03
 * updated: 2026-06-03
 * description: 深入理解 JS 闭包机制
 * ---
 * ```
 */
export interface NoteFrontmatter {
  /**
   * 笔记标题。
   * 优先级: frontmatter.title > 首个 H1 > 文件名(去支持的笔记扩展名)。
   */
  title?: string;

  /**
   * YAML 中声明的标签列表。
   * 会被合并到 `Note.tags`（与行内 #tag 合并去重）。
   */
  tags?: string[];

  /**
   * 创建日期 (ISO 8601 格式，如 "2026-06-03")。
   * 用户可手动编辑；系统以文件 mtime 为准，此字段为辅助参考。
   */
  created?: string;

  /**
   * 最后更新日期 (ISO 8601 格式)。
   * 用户可手动编辑；系统以文件 mtime 为准，此字段为辅助参考。
   */
  updated?: string;

  /**
   * 笔记简短描述。
   * 用于搜索结果摘要、卡片预览等场景。
   */
  description?: string;

  /**
   * 是否为草稿。
   * 草稿笔记在导出/分享时可排除，在文件树中以特殊图标标记。
   */
  draft?: boolean;

  /**
   * 自定义字段 (JotLuck 不解析的任意 YAML key-value)。
   *
   * 例如用户可能使用 Jekyll/Hugo/Obsidian 特有的 frontmatter 字段
   * (layout, permalink, aliases, cssclass 等)。
   * JotLuck 保留但不主动处理这些字段，以保证与其他工具的互操作性。
   */
  [key: string]: unknown;
}

// ============================================================================
// 3. Wiki-link — 笔记间链接
// ============================================================================

/**
 * 解析后的 Wiki-link 实体。
 *
 * 支持 Obsidian 兼容的完整语法:
 * - `[[笔记名]]` — 基础形式
 * - `[[笔记名|显示文字]]` — 别名
 * - `[[笔记名#标题]]` — 锚点
 * - `[[笔记名#标题|显示文字]]` — 别名 + 锚点
 *
 * 当 `isValid` 为 false 时，渲染为"死链"样式 (红色虚线)，
 * 用户可点击死链一键创建目标笔记。
 *
 * @see ADR-007 — Wiki-link 语法设计
 * @see components.md §23 BacklinkItem — 反向链接中使用此类型
 */
export interface WikiLink {
  /**
   * 目标笔记名称 (不含支持的笔记扩展名，不含路径)。
   *
   * 例如 `[[tutorials/JavaScript 闭包]]` 解析后 target = "JavaScript 闭包"。
   */
  target: string;

  /**
   * 显示别名。
   *
   * 例如 `[[JavaScript 闭包|JS 闭包学习]]` → alias = "JS 闭包学习"。
   * 若未指定别名，渲染时使用 target 作为默认显示文字。
   */
  alias?: string;

  /**
   * 链接到的章节锚点 (不含 # 前缀)。
   *
   * 例如 `[[JavaScript 闭包#作用域链]]` → anchor = "作用域链"。
   * 渲染时生成 `href="#作用域链"` 的页内跳转。
   */
  anchor?: string;

  /**
   * 目标笔记是否真实存在于笔记本中。
   *
   * - `true`:  在索引中找到同名支持格式笔记文件 → 正常渲染为蓝色可点击链接
   * - `false`: 索引中找不到 → 渲染为红色虚线"死链"，点击可创建目标笔记
   *
   * 解析时机: 打开笔记时由 useIndexStore 验证并填充此字段。
   */
  isValid: boolean;
}

// ============================================================================
// 4. NoteBlock — 块级编辑器
// ============================================================================

/**
 * 编辑器中的一个语法块。
 *
 * JotLuck 的编辑器采用"块级混合编辑"模式:
 * - 每个 Markdown 语法元素被解析为一个独立的 NoteBlock
 * - 用户可按 Tab 在源码/渲染模式间切换单个块
 * - 当语法结构遭到破坏 (如未闭合代码块) 时，`isValid` 置为 false
 *
 * 块的边界检测由 CodeMirror 6 Extension `throttledParser` 执行，
 * 内容变更后 150ms 防抖触发重新解析。
 *
 * @see components.md §12 MarkdownEditor
 * @see components.md §13 BlockMarker
 * @see components.md §14 RestoreButton
 */
export interface NoteBlock {
  /**
   * 块的唯一标识符。
   *
   * 格式: `${notePath}::${startOffset}` — 在同一笔记内稳定且唯一。
   * 当内容变更导致偏移量重算时，id 可能改变 (块重新创建)。
   */
  id: string;

  /**
   * 语法块类型，决定默认渲染行为和可用的格式操作。
   */
  type: BlockType;

  /**
   * 原始 Markdown 源码文本 (包含语法标记)。
   *
   * 例如一个段落块的 rawContent 可能是 `"**hello world** — 这是一段文字"`。
   */
  rawContent: string;

  /**
   * 渲染后的 HTML 内容 (经过 marked + DOMPurify)。
   *
   * 在渲染模式下注入 CodeMirror Widget DOM 显示此 HTML。
   * 在源码模式下，编辑器直接显示 rawContent，忽略此字段。
   */
  renderedContent: string;

  /**
   * 当前块的显示模式。
   *
   * - `'source'`: 显示原始 Markdown 源码 (可编辑)
   * - `'render'`: 显示渲染后的 HTML (只读预览)
   *
   * 用户按 Tab 或点击 BlockMarker 切换模式。
   * 当配置 `autoFormat: true` 时，系统检测到语法块完整闭合后自动切换为 `'render'`。
   */
  mode: 'source' | 'render';

  /**
   * 块的语法是否完整有效。
   *
   * - `true`:  语法正确闭合 (代码块有对应结束标记、bold 标记正确配对等)
   * - `false`: 语法结构被破坏 (如未闭合代码块、标记不配对)
   *
   * 当 isValid 为 false 时:
   * - BlockMarker 显示灰色圆点 (而非蓝色/绿色)
   * - 块下方显示 RestoreButton (还原到上一个有效状态)
   * - 渲染模式下使用降级渲染 (尽力而为的 HTML 输出)
   */
  isValid: boolean;

  /**
   * 块在笔记全文中的起始字符偏移量 (0-based)。
   * 用于 CodeMirror rangemarks 定位和导航树跳转。
   */
  startOffset: number;

  /**
   * 块在笔记全文中的结束字符偏移量 (不含换行符，0-based)。
   *
   * `endOffset - startOffset` 等于块的总字符数 (含语法标记)。
   */
  endOffset: number;

  /**
   * 块的附加元数据，按块类型不同携带不同信息:
   *
   * | BlockType      | meta 包含                                |
   * |----------------|------------------------------------------|
   * | Heading        | `{ level: 1-6 }`                         |
   * | CodeBlock      | `{ language?: string, lineCount: number }`|
   * | List           | `{ ordered: boolean, items: number }`     |
   * | Table          | `{ rows: number, cols: number }`          |
   * | Math           | `{ display: boolean }`                    |
   * | 其他类型       | `undefined` (不使用)                      |
   */
  meta?: Record<string, unknown>;
}

// ============================================================================
// 5. Note — 核心笔记实体
// ============================================================================

/**
 * JotLuck 核心实体 — 笔记。
 *
 * 一条笔记对应文件系统中的一个支持格式纯文本笔记文件。
 * 当笔记在编辑器中打开时，Note.content 实时反映当前编辑内容；
 * 当笔记未打开时，Note.content 为从文件系统读取的最后一次保存内容。
 *
 * 生命周期:
 *   `创建 → useNotebookStore.openNote() → 加载 content →
 *    解析 frontmatter/links → 渲染块 → 用户编辑 →
 *    useEditorStore 更新 content → 防抖保存 → 写回笔记文件 →
 *    增量更新索引`
 *
 * @see ADR-003 — 纯文件架构，笔记即纯文本文件
 * @see ADR-006 — 标签来源: frontmatter.tags + 正文 #tag 合并
 * @see ADR-007 — links[] 解析自 [[Wiki-link]] 语法
 */
export interface Note {
  /**
   * 笔记唯一标识符。
   *
   * 采用相对路径 (使用 `/` 分隔) 相对于笔记本根目录。
   * 例如: `"tutorials/javascript/闭包详解.md"`
   *
   * **设计决策**: 不使用 UUID 或数据库自增 ID — 文件路径即是 ID。
   * 这保证了即使 `.jotluck_index.json` 损坏/重建，笔记标识依然稳定。
   */
  id: string;

  /**
   * 笔记标题。
   *
   * 确定优先级: YAML frontmatter.title > 首个 H1 > 文件名(去除支持的笔记扩展名)。
   * 若三个来源均无 → `"Untitled"` (需引导用户补充标题)。
   */
  title: string;

  /**
   * 笔记文件相对于笔记本根目录的路径 (使用 `/` 分隔)。
   *
   * 与 id 语义相同，保留此字段以区隔"标识"和"路径"两种用例。
   * 例如: `"学习日记/2026-06-03.md"`
   */
  path: string;

  /**
   * 笔记正文 (Markdown 源码)。
   *
   * 包含 YAML frontmatter (若存在)。
   * 当笔记在编辑器中打开时，此字段实时更新 (非防抖)。
   */
  content: string;

  /**
   * 解析后的 YAML frontmatter 数据。
   *
   * 若笔记文件无 frontmatter，所有已知字段为 undefined。
   * 每次保存/索引更新时重新解析。
   */
  frontmatter: NoteFrontmatter;

  /**
   * 文件系统创建时间 (Unix 毫秒时间戳)。
   *
   * 来源: 文件的 `birthtime` / `ctime` (若 OS 支持)，
   * 降级顺序: birthtime → ctime → mtime → frontmatter.created 解析值。
   */
  createdAt: number;

  /**
   * 文件系统最后修改时间 (Unix 毫秒时间戳)。
   *
   * 来源: 文件的 `mtime`。
   * 每次 JotLuck 保存或外部修改时由文件监控更新。
   */
  modifiedAt: number;

  /**
   * 笔记的所有标签 (frontmatter + 行内 #tag 合并去重)。
   *
   * 排序规则: 按标签名拼音/字母序。
   *
   * 此字段由 useIndexStore 在索引构建/更新时填充并缓存，
   * 保证每次查询标签时无需重新遍历全文解析。
   */
  tags: string[];

  /**
   * 笔记中的所有 Wiki-link (出链)。
   *
   * 解析自 `[[...]]` 语法，每个链接对应一个 WikiLink 实体。
   *
   * 用途:
   * - 渲染时替换为可点击链接或死链标记
   * - 构建反向链接图谱 (通过 `.jotluck_index.json` 的 outlinks 字段)
   * - 知识图谱可视化 (节点 = 笔记，边 = 链接)
   */
  links: WikiLink[];
}
