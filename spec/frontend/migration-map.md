# MarkLuck UI 控件重构 — 接口迁移重定向文档

> 版本：v1.0 | 日期：2026-06-04 | 用途：全量 UI 控件重构的 API 契约基准
>
> **规则**：重构后的组件/服务/Store/Composable **必须保持本文档定义的接口签名不变**。
> 内部实现可任意重写，但对外暴露的 Props/Events/Slots/方法签名是硬合同。

---

## 目录

1. [组件接口契约 (Props/Events/Slots)](#1-组件接口契约)
2. [页面组件结构](#2-页面组件结构)
3. [Pinia Store 接口](#3-pinia-store-接口)
4. [Service 公共 API](#4-service-公共-api)
5. [Composable 返回类型](#5-composable-返回类型)
6. [Utils 导出函数](#6-utils-导出函数)
7. [TypeScript 类型定义](#7-typescript-类型定义)
8. [CSS Token 体系](#8-css-token-体系)
9. [组件依赖关系图](#9-组件依赖关系图)
10. [重构检查清单](#10-重构检查清单)

---

## 1. 组件接口契约

> **格式**: `ComponentName` → Props | Events | Slots | 依赖

### 1.1 Common 通用组件

#### ThemeSelector

```typescript
// Props
{ compact?: boolean }  // default: false

// Events: 无

// Slots: 无

// 依赖: useThemeStore (Pinia)
// 行为: onMounted 调用 store.init()
// 渲染: 亮色/暗色两个切换按钮
```

#### WelcomePage

```typescript
// Props
{
  recentNotebooks?: string[]   // default: []
  error?: string               // default: ''
}

// Events
{
  createNote: []               // 点击"创建笔记"
  openNotebook: [path: string] // 点击最近笔记本
  retry: []                    // 错误时重试
}

// Slots: 无

// 渲染: 欢迎标题 + 创建笔记按钮 + 键盘提示 + 最近笔记本列表 + 错误状态
```

#### ConfirmDialog `[M0 Placeholder]`

```typescript
// Props
{
  visible: boolean
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

// Events
{
  'update:visible': [value: boolean]
  confirm: []
  cancel: []
}
```

#### ContextMenu `[M0 Placeholder]`

```typescript
// Props
{
  visible: boolean
  x: number
  y: number
  items: ContextMenuItem[]
  closeOnClick?: boolean  // default: true
}

// Events
{
  'update:visible': [value: boolean]
  select: [{ itemId: string; item: ContextMenuItem }]
}

// Slots
{
  default  // 自定义菜单内容
  header   // 顶部固定区
  footer   // 底部固定区
}
```

#### Dropdown `[M0 Placeholder]`

```typescript
// Props
{
  visible?: boolean
  trigger?: 'click' | 'hover' | 'manual'  // default: 'click'
  placement?: 'bottom-start' | 'bottom' | 'bottom-end' | 'top-start'
  closeOnClick?: boolean
  closeOnClickOutside?: boolean
  maxHeight?: number     // default: 300
  disabled?: boolean
}

// Events
{
  'update:visible': [boolean]
  open: []
  close: []
}

// Slots: { trigger, default, header, footer }
```

#### EmptyState `[M0 Placeholder]`

```typescript
// Props
{
  icon?: string
  title: string
  description?: string
  actionLabel?: string
}

// Events: { action: [] }
// Slots: { default, action }
```

#### ErrorDisplay `[M0 Placeholder]`

```typescript
// Props
{
  message: string
  details?: string
  retryLabel?: string
}

// Events: { retry: [] }
```

#### IconButton `[M0 Placeholder]`

```typescript
// Props
{
  icon: string
  label?: string
  tooltip?: string
  size?: 'sm' | 'md' | 'lg'    // default: 'md'
  variant?: 'ghost' | 'outline' | 'solid'  // default: 'ghost'
  color?: 'default' | 'primary' | 'danger' | 'success'  // default: 'default'
  disabled?: boolean
  loading?: boolean
  active?: boolean
  round?: boolean
}

// Events: { click: [MouseEvent] }
// Slots: { icon, label }
```

#### LoadingSpinner `[M0 Placeholder]`

```typescript
// Props
{
  size?: 'sm' | 'md' | 'lg'  // default: 'md'
  label?: string
}

// Slots: { default }
```

#### Modal `[M0 Placeholder]`

```typescript
// Props
{
  visible: boolean
  title?: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'fullscreen'  // default: 'md'
  closable?: boolean     // default: true
  closeOnEsc?: boolean   // default: true
  closeOnOverlay?: boolean  // default: false
  showFooter?: boolean   // default: true
}

// Events
{
  'update:visible': [boolean]
  open: []
  close: []
  closed: []
}

// Slots: { header, default, footer }
```

#### Toast `[M0 Placeholder]`

```typescript
// Props
{
  message: string
  type?: 'info' | 'success' | 'warning' | 'error'  // default: 'info'
  duration?: number   // default: 3000, 0 = 不自动消失
  position?: 'top-center' | 'top-right' | 'bottom-center' | 'bottom-right'
  closable?: boolean
  icon?: string
}

// Events: { close: [], action: [] }
// Slots: { icon, message, action }

// --- 全局 Toast API (provide/inject) ---
interface ToastAPI {
  show(message: string, type?: ToastType, duration?: number): void
  success(message: string, duration?: number): void
  warning(message: string, duration?: number): void
  error(message: string, duration?: number): void
  info(message: string, duration?: number): void
  dismiss(): void
}
```

---

### 1.2 Editor 编辑器组件

#### FormatToolbar

```typescript
// Props
{
  items?: ToolbarItemConfig[]    // default: DEFAULT_TOOLBAR_ITEMS (12 buttons)
  disabled?: boolean             // default: false
  compact?: boolean              // default: false
  vertical?: boolean             // default: false
}

// Events
{
  format: [type: string]  // 点击格式按钮，payload 为 BlockType
}

// Slots
{
  before  // 工具栏前插入内容
  button  // 自定义按钮渲染 (scoped: { item: ToolbarItemConfig })
  after   // 工具栏后插入内容
}

// 依赖: ToolbarButton, DEFAULT_TOOLBAR_ITEMS
```

#### MarkdownEditor `⭐ 核心组件`

```typescript
// Props
{
  modelValue: string              // REQUIRED — v-model 双向绑定
  blocks?: MarkdownBlock[]        // 外部块数据
  readOnly?: boolean              // 只读模式
  onEditorDrop?: (event: DragEvent) => void        // 拖放回调
  onEditorDragOver?: (event: DragEvent) => void    // 拖拽悬停回调
  onEditorPaste?: (event: ClipboardEvent) => boolean | void | Promise<boolean>  // 粘贴回调
}

// Events
{
  'update:modelValue': [value: string]              // v-model
  'blocks-updated': [blocks: MarkdownBlock[]]       // 块解析完成
}

// Slots: 无

// Exposes (defineExpose)
{
  getEditorView: () => EditorView | null  // 获取 CodeMirror EditorView 实例
  focus: () => void                       // 聚焦编辑器
}

// 依赖: CodeMirror 6, cm6-extensions, cm6-live-preview, useThemeStore
// 内部: Compartment 动态主题切换 (亮/暗语法高亮)
```

#### StatusBar

```typescript
// Props
{
  charCount?: number              // default: 0
  wordCount?: number              // default: 0
  lineCount?: number              // default: 0
  cursorLine?: number | null      // default: null
  cursorCol?: number | null       // default: null
  isDirty?: boolean               // default: false
  isSaving?: boolean              // default: false
  saveError?: string | null       // default: null
  lastSavedAt?: number | null     // default: null (Unix ms)
}

// Events: 无
// Slots: 无
// 渲染: 行:列 | 字数/词数 | 保存状态 (纯展示)
```

#### ToolbarButton

```typescript
// Props
{
  icon: string                    // REQUIRED
  label: string                   // REQUIRED
  shortcut?: string               // default: ''
  active?: boolean                // default: false
  disabled?: boolean              // default: false
  compact?: boolean               // default: false
}

// Events: { click: [] }
// Slots: 无
```

#### BlockMarker `[M0 Placeholder]`

```typescript
// Props
{
  mode: 'source' | 'render'
  position: 'start' | 'end'
  blockType?: BlockType
  isValid?: boolean  // default: true
}

// Events: { click: [{ position, blockType }] }
```

#### RestoreButton `[M0 Placeholder]`

```typescript
// Props
{
  blockIndex: number
  previousContent: string
  visible: boolean
  shortcutHint?: string  // default: 'Ctrl+Shift+Z'
}

// Events: { restore: [{ blockIndex, content }] }
```

#### TabBar `[M0 Placeholder]`

```typescript
// Props
{
  tabs: TabItem[]
  activeTabId: string | null
}

// Events
{
  'update:activeTabId': [string]
  close: [tabId: string]
}
```

#### TabItem `[M0 Placeholder]`

```typescript
// Props
{
  tab: TabItem
  active?: boolean
}

// Events: { select: [], close: [] }
```

---

### 1.3 File-Tree 文件树组件

#### Breadcrumb

```typescript
// Props
{
  currentDir: string              // REQUIRED
  rootLabel?: string              // 可选
}

// Events: { navigate: [path: string] }
// Slots: 无
```

#### FileIcon

```typescript
// Props
{
  icon?: string                   // 新 API — 指定图标名
  node?: DirEntry                 // 旧 API — 从 DirEntry 派生图标
  isOpen?: boolean                // default: false (文件夹展开/折叠)
  size?: number                   // default: 16
}

// Events: 无
// Slots: 无
// 内置 18 种 SVG 图标: folder, folder-open, markdown, image, text, generic,
//   plus, search, settings, delete, more, refresh, chevron-right/down/up/left,
//   link, code, table, list, tag, image-block
```

#### FileTree

```typescript
// Props
{
  files: DirEntry[]               // REQUIRED
  rootDir?: string
  loading?: boolean
  error?: string
  activePath?: string
}

// Events
{
  selectFile: [path: string]
  deleteFile: [path: string]
  renameFile: [oldPath: string, newName: string]
  navigateDir: [path: string]
  createFile: []
  retry: []
}

// Slots: 无
// 内部使用: FileTreeNode, Breadcrumb, FileTreeSearch
// 状态: Loading / Empty / Error / Normal
```

#### FileTreeNode

```typescript
// Props
{
  node: DirEntry                  // REQUIRED
  depth?: number                  // default: 0
  activePath?: string             // default: ''
  isOpen?: boolean                // default: false
}

// Events
{
  select: [path: string]
  delete: [path: string]
  rename: [oldPath: string, newName: string]
}

// Slots: 无
// 内部使用: FileIcon
// 行为: 递归自引用子节点, HTML5 Drag & Drop, 内联重命名 (双击)
```

#### FileTreeSearch

```typescript
// Props
{
  count?: number
}

// Events
{
  search: [query: string]  // 150ms 防抖
}

// Slots: 无
```

#### FileSidebar `[M0 Placeholder]`

```typescript
// Props: { collapsed?: boolean }
// Events: { 'note-selected': [NotePath], 'notebook-changed': [], 'create-note': [{ parentPath }], 'create-folder': [{ parentPath }] }
// Slots: { header, tree, footer }
```

#### NotebookSelector `[M0 Placeholder]`

```typescript
// Props: { notebookName?: string, recentNotebooks?: string[], compact?: boolean }
// Events: { 'open-notebook': [], 'switch-notebook': [string], 'notebook-opened': [{ rootPath, name }] }
```

---

### 1.4 Layout 布局组件

#### AppLayout `⭐ 核心布局`

```typescript
// Props: 无

// Events: 无

// Slots
{
  ('left-sidebar'); // 左侧栏 (260px)
  editor; // 中央编辑区 (flex: 1)
  ('right-sidebar'); // 右侧栏 (240px)
}

// 行为: CSS Grid `260px 1fr 240px`, 移动端 (<768px) 单栏 + 抽屉
// 内部状态: showRightSidebar, showMobileSidebar, isMobile
```

#### EditorArea `[M0 Placeholder]`

```typescript
// Props: { openTabs?: TabItem[], activeTabId?: string | null }
// Events: { 'switch-tab': [string], 'close-tab': [string], 'close-all-tabs': [], 'save-note': [], 'editor-ready': [EditorView] }
// Slots: { welcome, 'toolbar-before', 'toolbar-after', 'statusbar-before' }
```

#### SidebarLeft `[M0 Placeholder]` / SidebarRight `[M0 Placeholder]`

- 布局容器，无对外接口

---

### 1.5 Modals 对话框组件

#### ExportDialog

```typescript
// Props
{
  visible: boolean                // REQUIRED
  notePath?: string
  noteTitle?: string
  markdownContent?: string
  readBinary?: (path: string) => Promise<string>  // 图片 base64 回调
}

// Events
{
  'update:visible': [value: boolean]
  cancel: []
}

// Slots: 无 (Teleport to body)

// 状态流程:
//   format_selection → converting (progress) → done → error
// 6 种导出格式: PDF / DOCX / XLSX / CSV / TXT / HTML
// 依赖: exportNote from @/services/Exporter
```

#### ShareDialog

```typescript
// Props
{
  visible: boolean                // REQUIRED
  noteTitle?: string
  markdownContent?: string
}

// Events
{
  'update:visible': [value: boolean]
  cancel: []
}

// Slots: 无 (Teleport to body)

// 状态流程:
//   format_selection → converting → channel_selection → sharing → complete → error
// 分享渠道: 系统分享 / 邮件 / 剪贴板 / 本地导出
```

#### TemplateDialog

```typescript
// Props
{
  visible: boolean                // REQUIRED
  currentContent?: string         // 当前编辑器内容 (保存草稿用)
}

// Events
{
  'update:visible': [value: boolean]
  select: [template: TemplateItem, content: string]
  'create-blank': []              // 选择空白笔记
  cancel: []
}

// Slots: 无 (Teleport to body)

// 依赖: TemplateEngine (renderTemplate, getBuiltInTemplates, getCustomTemplates)
```

#### ConflictDialog `[M0 Placeholder]`

```typescript
// Props: { visible: boolean, notePath: string, localContent: string, externalMtime: number }
// Events: { 'update:visible': [boolean], 'keep-local': [string], 'load-external': [string] }
```

#### SettingsDialog `[M0 Placeholder]`

```typescript
// Props: { visible: boolean }
// Events: { 'update:visible': [boolean] }
// Slots: { default }  // 内容由 SettingsPanel 填充
```

#### SettingsPanel `[M0 Placeholder]`

```typescript
// Props: { visible: boolean }
// Events: { 'update:visible': [boolean], 'settings-changed': [Partial<AppSettings>] }
// 管理 AppSettings 所有字段
```

#### TemplatePicker `[M0 Placeholder]`

```typescript
// Props: { templates: TemplateItem[] }
// Events: { select: [TemplateItem], cancel: [] }
```

---

### 1.6 Nav 导航组件

#### NavTree

```typescript
// Props
{
  headings: HeadingItem[]         // REQUIRED
  activeHeadingId?: string | null
  collapsed?: boolean
  loading?: boolean
}

// Events
{
  'toggle-collapse': []
  'navigate-to': [headingId: string, lineNumber: number]
}

// Slots: 无
// 内部使用: NavTreeNode (递归)
// 状态: Loading / Empty / Normal / Collapsed
```

#### NavTreeNode

```typescript
// Props
{
  heading: HeadingItem            // REQUIRED
  depth?: number                  // default: 1
  active?: boolean                // default: false
  activeChildId?: string | null   // default: null
}

// Events: { navigate: [headingId: string, lineNumber: number] }
// Slots: 无
// 行为: 递归自引用, 折叠/展开子节点
```

---

### 1.7 Panels 面板组件

#### BacklinkItem

```typescript
// Props
{
  entry: BacklinkEntry; // REQUIRED
}

// Events: { click: [entry: BacklinkEntry] }
// Slots: 无
```

#### BacklinksPanel

```typescript
// Props
{
  backlinks: BacklinkEntry[]      // REQUIRED
  collapsed?: boolean
  loading?: boolean
}

// Events
{
  'toggle-collapse': []
  navigate: [entry: BacklinkEntry]
}

// Slots: 无
// 内部使用: BacklinkItem
// 状态: NoNote / Loading / Empty / Error / Normal
```

#### RecentNotes

```typescript
// Props
{
  notes: Array<{
    path: string
    title: string
    lastOpenedAt: number         // Unix ms
  }>                              // REQUIRED
  maxDisplay?: number             // default: 10
  loading?: boolean               // default: false
}

// Events: { 'select-note': [path: string] }
// Slots: 无
// 状态: Loading / Empty / Normal
// 时间格式化: 刚刚 / N分钟前 / N小时前 / N天前 / YYYY-MM-DD
```

#### TagCloud (TagCloudPanel)

```typescript
// Props
{
  tags: TagEntry[]                // REQUIRED
  collapsed?: boolean             // default: false
  loading?: boolean               // default: false
  maxDisplay?: number             // default: 50
}

// Events
{
  'select-tag': [tagName: string]
  'toggle-collapse': []
}

// Slots: 无
// 标签云: 字号按频率分 5 级
// 状态: Loading / Empty / Normal
```

#### TagPanel `[M0 Placeholder]`

```typescript
// Props: { tags: TagEntry[], displayMode?: 'cloud' | 'list', sortBy?: 'count' | 'name', maxDisplay?: number, collapsed?: boolean }
// Events: { 'select-tag': [string], 'toggle-collapse': [] }
```

---

### 1.8 Search 搜索组件

#### SearchInput

```typescript
// Props
{
  modelValue: string              // REQUIRED — v-model
  placeholder?: string            // default: 搜索提示
}

// Events
{
  'update:modelValue': [value: string]
  search: [value: string]         // Enter 键触发
  escape: []                      // Esc 键
  clear: []                       // 清除按钮
}

// Exposes: { focus: () => void }
// Slots: 无
```

#### SearchPanel

```typescript
// Props
{
  visible: boolean                // REQUIRED
}

// Events
{
  'update:visible': [value: boolean]
  'select-result': [result: SearchResult]
}

// Slots: 无 (Teleport to body)
// 依赖: useSearchStore, useSearch composable, SearchResultItem
// 状态: Hidden / Idle / Searching / NoResults / Error / HasResults
// 键盘: ↑↓ 导航, Enter 选择, Esc 关闭
```

#### SearchResultItem

```typescript
// Props
{
  result: SearchResult            // REQUIRED
  selected?: boolean
}

// Events: { click: [result: SearchResult] }
// Slots: 无
// 渲染: 标题 + 高亮匹配文本 + 上下文片段 + 路径 + 匹配类型图标
```

#### SearchResultList

```typescript
// Props
{
  results: SearchResult[]         // REQUIRED
  selectedIndex?: number
  loading?: boolean
  totalCount?: number
}

// Events: { select: [result: SearchResult] }

// Slots
{
  empty   // 无结果
  header  // 统计信息 (默认: "共 N 条结果")
  item    // scoped: { result, selected, index }
}

// 状态: Loading / Empty / Normal
```

#### SearchDialog `[M0 Placeholder]`

```typescript
// Props: { visible: boolean, initialQuery?: string }
// Events: { 'update:visible': [boolean], 'select-result': [SearchResult] }
```

#### SearchResults `[M0 Placeholder]`

```typescript
// Props: { results: SearchResult[], selectedIndex?: number, loading?: boolean, totalCount?: number }
// Events: { select: [SearchResult], 'update:selectedIndex': [number] }
```

---

## 2. 页面组件结构

### NotebookHome `⭐ 主页面`

```
NotebookHome
├── AppLayout
│   ├── #left-sidebar
│   │   ├── ThemeSelector (compact)
│   │   ├── button.btn-new-note (+)
│   │   └── FileTree
│   │       ├── Breadcrumb
│   │       ├── FileTreeSearch
│   │       └── FileTreeNode (递归)
│   │           └── FileIcon
│   ├── #editor
│   │   ├── WelcomePage (条件: 无笔记打开)
│   │   └── editor-wrapper (条件: 有笔记打开)
│   │       ├── FormatToolbar
│   │       │   └── ToolbarButton × 12
│   │       ├── MarkdownEditor (v-show: !showPreview)
│   │       ├── div.markdown-preview (v-if: showPreview)
│   │       └── StatusBar
│   └── #right-sidebar
│       ├── NavTree
│       │   └── NavTreeNode (递归)
│       ├── BacklinksPanel
│       │   └── BacklinkItem × N
│       ├── TagCloud
│       └── RecentNotes
├── SearchPanel (Teleport to body)
├── ExportDialog (Teleport to body)
├── ShareDialog (Teleport to body)
├── TemplateDialog (Teleport to body)
└── input[type=file][hidden]  (图片上传)
```

**NotebookHome 依赖清单**:

| 类别       | 导入                                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 组件       | AppLayout, FileTree, MarkdownEditor, SearchPanel, ExportDialog, ShareDialog, TemplateDialog, StatusBar, FormatToolbar, ThemeSelector, WelcomePage, NavTree, BacklinksPanel, TagCloud, RecentNotes |
| 服务       | MockFSService (instantiated as `new MockFSService(50)`)                                                                                                                                           |
| Store      | useIndexStore, useSearchStore                                                                                                                                                                     |
| Composable | useHeadings, useImageUpload                                                                                                                                                                       |
| Utils      | parseBlocks (blockParser), scanContentWarnings, humanizeError (contentUtils), setImageResolver (cm6-live-preview)                                                                                 |
| 渲染库     | renderMarkdown, highlightCodeBlocks (@markluck/renderer)                                                                                                                                          |

### NotFoundPage `[M0 Placeholder]`

- 404 页面，无 Props/Events

### SettingsPage `[M0 Placeholder]`

- 设置页面路由目标

---

## 3. Pinia Store 接口

### useThemeStore

```typescript
// State
colorScheme: 'light' | 'dark'   // initial: 'light'

// Computed
schemeLabel: '亮色' | '暗色'

// Actions
init(): void                    // 从 localStorage 或系统偏好加载
apply(): void                   // 设置 data-color-scheme 属性 + 持久化
setColorScheme(c: ColorScheme): void
toggleColorScheme(): void

// 存储 key: 'markluck-theme'
```

### useSearchStore

```typescript
// State
query: string                   // initial: ''
results: SearchResult[]         // initial: []
isSearching: boolean            // initial: false
isVisible: boolean              // initial: false
error: string | null            // initial: null
searchHistory: string[]         // initial: [] (persisted to localStorage, max 10)
selectedIndex: number           // initial: -1

// Computed
resultCount: number
hasResults: boolean
hasQuery: boolean

// Actions
setQuery(q: string): void
setResults(r: SearchResult[]): void
clearResults(): void
addToHistory(q: string): void
loadHistory(): void
clearHistory(): void
open(queryText?: string): void
close(): void
selectNext(): void
selectPrev(): void
getSelected(): SearchResult | null
```

### useIndexStore

```typescript
// State
status: 'idle' | 'building' | 'ready' | 'error'   // initial: 'idle'
error: string | null
index: SearchIndex | null
tags: Array<{ name: string; count: number }>
recentNotes: Array<{ path: string; title: string; lastOpenedAt: number }>

// Computed
documentCount: number
isReady: boolean

// Actions
initialize(fs: IFileSystemService): Promise<void>     // 全量索引构建
refreshDocument(fs: IFileSystemService, path: string): Promise<void>  // 增量更新
removeDocument(path: string): void
getBacklinks(notePath: string): BacklinkEntry[]
getDeadLinks(): Array<{ source: string; target: string }>
getEngine(): SearchEngine | null
```

### editor (Store) `[M0 Placeholder]`

- 编辑器内容、块状态、光标位置管理

### notebook (Store) `[M0 Placeholder]`

- 笔记本/文件树/标签页管理

---

## 4. Service 公共 API

### IFileSystemService `⭐ 核心接口 — 不可变`

```typescript
interface IFileSystemService {
  // 文件读写
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  writeBinary(path: string, base64: string): Promise<void>;
  readBinary(path: string): Promise<string>;
  isBinaryPath(path: string): boolean;

  // 文件操作
  deleteFile(path: string): Promise<void>;
  renameFile(oldPath: string, newPath: string): Promise<void>;
  createDirectory(path: string): Promise<void>;

  // 目录浏览
  listDirectory(path: string): Promise<DirEntry[]>;
  statFile(path: string): Promise<FileStat>;

  // 文件监控
  watch(rootPath: string, callback: (events: FileChangeEvent[]) => void): Promise<UnwatchFn>;
  unwatchAll(): Promise<void>;

  // 路径
  resolvePath(root: string, ...segments: string[]): string;
  isPathInNotebook(root: string, path: string): Promise<boolean>;

  // 笔记本
  openNotebook(): Promise<NotebookHandle>;
  getRecentNotebooks(): Promise<string[]>;
}

// 注入 Key
const FS_SERVICE_KEY: unique symbol;
```

### MockFSService `implements IFileSystemService`

```typescript
class MockFSService implements IFileSystemService {
  constructor(delay?: number); // default: 50ms — 模拟文件 IO 延迟

  // 所有 IFileSystemService 方法 + localStorage 持久化
  // 内置示例笔记本数据 (sample notebook)
  // 版本校验: localStorage key => 'markluck-mockfs'
}
```

### TauriIPCService `implements IFileSystemService`

```typescript
class TauriIPCService implements IFileSystemService {
  // 所有 IFileSystemService 方法
  // 委托到 @tauri-apps/api/core invoke()
  // 事件监听 @tauri-apps/api/event listen()

  // 额外方法 (超出接口的 Tauri 特有功能)
  buildIndex(): Promise<number>;
  searchIndex(query: string): Promise<SearchResult[]>;
  updateIndexDocument(filePath: string): Promise<void>;
  renderTemplate(template: string): Promise<string>;
  getBuiltinTemplate(type: string): Promise<string>;
}
```

### ExportService (Exporter)

```typescript
// 主导出入口
function exportNote(
  markdown: string,
  fileName: string,
  options?: Partial<ExportOptions>,
): Promise<ExportResult>;

// 6 种格式导出函数 (内部使用)
function exportPDF(
  markdown: string,
  fileName: string,
  options?: Partial<ExportOptions>,
): Promise<ExportResult>;
function exportDocx(
  markdown: string,
  fileName: string,
  options?: Partial<ExportOptions>,
): Promise<ExportResult>;
function exportXlsx(
  markdown: string,
  fileName: string,
  options?: Partial<ExportOptions>,
): Promise<ExportResult>;
function exportCsv(
  markdown: string,
  fileName: string,
  options?: Partial<ExportOptions>,
): Promise<ExportResult>;
function exportTxt(
  markdown: string,
  fileName: string,
  options?: Partial<ExportOptions>,
): Promise<ExportResult>;
function exportHtml(
  markdown: string,
  fileName: string,
  options?: Partial<ExportOptions>,
): Promise<ExportResult>;
```

### IndexService

```typescript
class IndexService {
  constructor(fs: IFileSystemService);

  getIndex(): SearchIndex | null;
  buildFullIndex(): Promise<SearchIndex>;
  updateDocument(path: string): Promise<void>;
  removeDocument(path: string): void;
  getAllTags(): Array<{ name: string; count: number }>;
  getWikiLinkGraph(): { outgoing: Map; incoming: Map; deadLinks: Array };
  getBacklinks(notePath: string): Array<{
    notePath: string;
    noteTitle: string;
    context: string;
    lineNumber: number;
  }>;
  getRecentNotes(limit?: number): Array<{
    path: string;
    title: string;
    lastOpenedAt: number;
  }>;
}
```

### SearchEngine

```typescript
class SearchEngine {
  constructor();

  buildIndex(documents: Record<string, DocumentEntry>): void;
  preloadContent(
    documents: Record<string, DocumentEntry>,
    contentProvider: (path: string) => Promise<string>,
  ): Promise<void>;
  search(query: SearchQuery): SearchResult[];
  updateDocument(path: string, doc: DocumentEntry, content: string): void;
  removeDocument(path: string): void;
  destroy(): void;
}
```

### TemplateEngine

```typescript
// 模板渲染
function renderTemplate(template: string, date?: Date): string;
function previewTemplate(template: string): string;

// 内置模板 (日记/会议纪要/周报)
function getBuiltInTemplates(): TemplateItem[];
function getBuiltInTemplateContent(templatePath: string): string;

// 自定义模板 (localStorage 持久化)
function getCustomTemplates(): TemplateItem[];
function getCustomTemplateContent(templatePath: string): string;
function saveCustomTemplate(name: string, description: string, content: string): TemplateItem;
function deleteCustomTemplate(path: string): boolean;
```

### YAMLParser

```typescript
// 类型
interface FrontmatterData {
  title?: string;
  tags?: string | string[];
  created?: string;
  updated?: string;
  [key: string]: unknown;
}
interface FrontmatterResult {
  data: FrontmatterData;
  raw: string;
  contentStart: number;
  hasFrontmatter: boolean;
}

// 函数
function parseFrontmatter(content: string): FrontmatterResult;
function stripFrontmatter(content: string): string;
function extractTitle(content: string): string;
```

### block-parser (Service)

```typescript
function parseBlocks(source: string, notePath: string): MarkdownBlock[];
// 内部使用 marked.lexer
```

### MarkdownPredictor `⭐ 文字补全服务`

```typescript
class MarkdownPredictor {
  constructor(indexStore: IndexStore);

  // 统一预测入口 — 融合 N-gram + 结构化知识 + 语法上下文
  getGhostText(cursorPos: number, doc: string): PredictionResult | null;

  // 学习
  learn(ctx: string, acceptedText: string): void;
  rejectEscape(ctx: string): void; // Escape 拒绝时降低权重
  scanDocument(text: string): void; // 全文档扫描构建 L1 统计表

  // 结构化知识注入 (内部调用)
  injectStructuredKnowledge(syntaxCtx: SyntaxContext): PredictionResult | null;

  // 语法上下文检测
  detectSyntaxContext(cursorPos: number, doc: string): SyntaxContext;
  isDisabledContext(cursorPos: number, doc: string): boolean;

  // 持久化
  save(): void; // L2 统计表 → localStorage (Top-N 裁剪)
  load(): void; // localStorage → L2 统计表
  clearDocument(): void; // 切换笔记时清理 L1，保留 L2
}

interface PredictionResult {
  text: string;
  confidence: number; // 0-1
  from: number;
}

type SyntaxContext =
  | { type: 'wiki-link'; prefix: string }
  | { type: 'tag'; prefix: string }
  | { type: 'file-path'; prefix: string }
  | { type: 'markdown-format'; openMarker: string }
  | { type: 'general' };
```

### M0 Placeholder Services

- **IndexManager** — 索引文件 CRUD + 增量更新
- **MarkdownRenderer** — renderMarkdown() 封装
- **ShareManager** — 分享生成和分发逻辑
- **WebFSAService** — File System Access API 实现

---

## 5. Composable 返回类型

### useHeadings

```typescript
function useHeadings(): {
  headings: Ref<HeadingItem[]>;
  parseHeadings(content: string): HeadingItem[];
  update(content: string): void;
  getActiveHeadingId(cursorLine: number): string | null;
};
```

### useImageUpload

```typescript
function useImageUpload(
  fs: IFileSystemService,
  getEditorView: () => EditorView | null,
): {
  isUploading: Ref<boolean>;
  uploadError: Ref<string | null>;
  getFileIcon(path: string): string;
  createFilePickerHandler(): (file: File) => Promise<void>;
  handleDragOver(event: DragEvent): void;
  handleDrop(event: DragEvent): Promise<void>;
  handleFileTreeDrop(event: DragEvent): boolean;
  handlePaste(event: ClipboardEvent): Promise<boolean>;
};
```

### useMarkdownParser

```typescript
function useMarkdownParser(notePath: string): {
  source: Ref<string>;
  blocks: Ref<MarkdownBlock[]>;
  renderedHtml: Ref<string>;
  blockCount: ComputedRef<number>;
  updateBlocks(content: string): void;
  updateRendered(): void;
  applyHighlight(container: HTMLElement): void;
  toggleBlockMode(index: number): void;
};
```

### useSearch

```typescript
function useSearch(): {
  // 300ms 防抖
  searchWithDebounce(queryText: string): void;
  // 立即搜索
  searchImmediately(queryText: string): void;
  // 标签搜索
  selectResultByQuery(tagQuery: string): void;
  // 面板控制
  openSearch(initialQuery?: string): void;
  closeSearch(): void;
  // 键盘导航
  navigateUp(): void;
  navigateDown(): void;
  getSelected(): SearchResult | null;
};
```

### M0 Placeholder Composables

- **useBlockDetection** — 语法格式自动识别
- **useDebouncedSave** — 防抖保存逻辑
- **useFileWatcher** — 文件变更监控订阅
- **useFormatShortcuts** — 键盘快捷键到格式操作的映射

---

## 6. Utils 导出函数

### blockParser (Utils)

```typescript
// 行级正则解析 (不同于 services/block-parser 的 marked 解析)
function parseBlocks(content: string, notePath?: string): MarkdownBlock[];
```

### cm6-extensions

```typescript
// CodeMirror 6 扩展体系
function markluckExtensions(): Extension[]; // [blockDecorator, imeHandler, throttledParser]
function setBlocksForDecorations(blocks: MarkdownBlock[]): void;
function markdownKeymap(): Record<string, (view: EditorView) => boolean>; // Ctrl+B/I/K/`, Enter

// ViewPlugin 工厂
blockDecorator: ViewPlugin; // 块边界标记点
imeHandler: ViewPlugin; // IME composition 状态跟踪
throttledParser: ViewPlugin; // 150ms 防抖解析 + 'markluck-parse' 自定义事件
```

### cm6-live-preview

```typescript
// 实时预览扩展
function livePreviewExtension(): Extension[];
function toggleBlockRender(view: EditorView): boolean; // Ctrl+Click 替代了原来的 Tab 键
function unpinFocusedBlock(view: EditorView): boolean; // Escape 键取消固定
function enableLivePreviewAll(view: EditorView): void;
function setImageResolver(fn: (path: string) => Promise<string | null>): void;

// 内置 Widget: HRWidget, TaskCheckboxWidget, ImageWidget
```

### cm6-ghost-text `← 新增`

```typescript
// Ghost text 统一补全插件：统计预测 + 结构化知识融合
function ghostTextPlugin(predictor: MarkdownPredictor): Extension[];
// 150ms 防抖 → 调用 MarkdownPredictor.getGhostText()
// Decoration.widget 在光标后渲染灰色斜体幽灵文本（1-20字符）
// keymap: Tab → 接受 ghost text（ghost text 可见时优先）
// keymap: Escape → 清除 ghost text（降低该上下文预测权重）
```

### ngram-engine `← 新增`

```typescript
// 纯算法 N-gram 统计预测引擎（零依赖）
function scanNGrams(text: string, n: number): NGramTable;
function predictNext(table: NGramTable, ctx: string, maxLen: number, minConfidence: number): string;
function learnNGram(table: NGramTable, ctx: string, text: string): void;
function mergeTables(a: NGramTable, b: NGramTable): NGramTable;
```

### contentUtils

```typescript
interface ContentWarning {
  type: 'zero-width' | 'bidi-override' | 'control-char';
  message: string;
  position?: number;
}

function scanContentWarnings(content: string): ContentWarning[];
function hasRTLContent(content: string): boolean;
function humanizeError(error: unknown): string; // 技术错误 → 中文用户消息
```

### toolbarConfig

```typescript
interface ToolbarItemConfig {
  type: string;
  icon: string;
  label: string;
  shortcut: string;
  kind?: 'inline' | 'block' | 'special';
}

// 12 个按钮 + 2 个分隔符，分 3 组:
//   Group 1: 加粗, 斜体, 删除线
//   Group 2: 标题, 无序列表, 有序列表, 任务列表, 引用
//   Group 3: 代码块, 链接, 图片, 分割线
const DEFAULT_TOOLBAR_ITEMS: ToolbarItemConfig[];
```

### M0 Placeholder Utils

- **content-type** — MIME 类型检测
- **highlight** — highlight.js 封装
- **marked-extensions** — Wiki-link + #tag marked 扩展
- **path** — 路径安全校验
- **sanitize** — DOMPurify 封装

---

## 7. TypeScript 类型定义

> 所有类型定义在 `packages/app/src/types/` 下，通过 `index.ts` 桶文件统一导出。

### 核心实体类型

```typescript
// === editor.ts ===
type BlockType =
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

type BlockMode = 'source' | 'render';

interface MarkdownBlock {
  id: string;
  index: number;
  type: BlockType;
  raw: string;
  from: number;
  to: number;
  isValid: boolean;
  mode: BlockMode;
  renderedHtml?: string;
  meta?: Record<string, unknown>;
}

interface HeadingItem {
  id: string;
  level: number; // 1-6
  text: string;
  lineNumber: number;
  children: HeadingItem[];
}

interface TabItem {
  id: string;
  notePath: string;
  title: string;
  isDirty: boolean;
  isLoading: boolean;
}

interface BacklinkEntry {
  notePath: string;
  noteTitle: string;
  context: string;
  lineNumber: number;
}

interface TagEntry {
  name: string;
  count: number;
}

interface TemplateItem {
  id: string;
  name: string;
  description: string;
  content: string;
  isBuiltin: boolean;
}

interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
  children?: ContextMenuItem[];
  action?: () => void;
}

type ColorScheme = 'light' | 'dark';

interface AppSettings {
  editorFontSize: number;
  editorLineHeight: number;
  editorFontFamily: string;
  editorTabSize: number;
  editorWordWrap: boolean;
  editorShowLineNumbers: boolean;
  editorShowBlockMarkers: boolean;
  editorAutoFormat: boolean;
  themeMode: 'light' | 'dark' | 'system';
  codeThemeLight: string;
  codeThemeDark: string;
  autoSaveEnabled: boolean;
  autoSaveDelayMs: number;
  defaultNotebookPath: string;
  maxRecentNotes: number;
  language: 'zh-CN' | 'en';
}

// === export.ts ===
enum ExportFormat {
  PDF,
  DOCX,
  XLSX,
  CSV,
  TXT,
  HTML,
  MD,
}

interface ExportOptions {
  format: ExportFormat;
  includeFrontmatter: boolean;
  includeWikiLinks: boolean;
  codeLineNumbers: boolean;
  imageHandling: 'base64' | 'relative-path' | 'remove';
  readBinary?: (path: string) => Promise<string>;
}

enum ShareChannel {
  SYSTEM_SHARE,
  EMAIL,
  CLIPBOARD,
  LOCAL_EXPORT,
}

interface ShareOptions {
  format: ExportFormat;
  channel: ShareChannel;
  fileName: string;
}

interface ExportResult {
  success: boolean;
  format: ExportFormat;
  fileName?: string;
  filePath?: string;
  size?: number;
  error?: string;
}

// === file-system.ts ===
interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isMarkdown: boolean;
  children?: DirEntry[];
  size?: number;
  mtime?: number;
}

interface FileStat {
  path: string;
  size: number;
  mtime: number;
  isDirectory: boolean;
}

interface FileChangeEvent {
  type: 'create' | 'modify' | 'delete';
  path: string;
  isDirectory: boolean;
}

interface NotebookHandle {
  rootPath: string;
  name: string;
}

type UnwatchFn = () => void;

interface IFileSystemService {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  writeBinary(path: string, base64: string): Promise<void>;
  readBinary(path: string): Promise<string>;
  isBinaryPath(path: string): boolean;
  deleteFile(path: string): Promise<void>;
  renameFile(oldPath: string, newPath: string): Promise<void>;
  createDirectory(path: string): Promise<void>;
  listDirectory(path: string): Promise<DirEntry[]>;
  statFile(path: string): Promise<FileStat>;
  watch(rootPath: string, callback: (events: FileChangeEvent[]) => void): Promise<UnwatchFn>;
  unwatchAll(): Promise<void>;
  resolvePath(root: string, ...segments: string[]): string;
  isPathInNotebook(root: string, path: string): Promise<boolean>;
  openNotebook(): Promise<NotebookHandle>;
  getRecentNotebooks(): Promise<string[]>;
}

// === note.ts ===
type NotePath = string;

interface NoteFrontmatter {
  title?: string;
  tags?: string[];
  created?: string;
  updated?: string;
  [key: string]: unknown;
}

interface Note {
  path: string;
  title: string;
  content: string;
  frontmatter: NoteFrontmatter;
  size: number;
  mtime: number;
}

// === notebook.ts ===
interface Notebook {
  rootPath: string;
  name: string;
  fileTree: FileTreeNode[];
  breadcrumb: string[];
}

// === search.ts ===
interface DateRange {
  from?: Date;
  to?: Date;
}

interface SearchQuery {
  text?: string;
  regex?: string;
  regexFlags?: string;
  tags?: string[];
  dateRange?: DateRange;
  folders?: string[];
}

interface SearchMatch {
  text: string;
  positions: Array<{ from: number; to: number }>;
  notePath: string;
  noteTitle: string;
}

interface SearchResult {
  notePath: string;
  noteTitle: string;
  snippet: string;
  matchType: 'title' | 'content' | 'filename';
  relevanceScore: number;
  positions: Array<{ from: number; to: number }>;
}

interface DocumentEntry {
  path: string;
  title: string;
  tags: string[];
  created?: number;
  updated?: number;
  folder: string;
}

interface SearchIndex {
  documents: Record<string, DocumentEntry>;
  termIndex: Record<string, TermEntry>;
  wikiLinks: { outgoing: Record<string, string[]>; incoming: Record<string, string[]> };
  tagIndex: Record<string, string[]>;
}
```

---

## 8. CSS Token 体系

> ⚠️ 重构后的组件必须使用以下 CSS 变量，禁止硬编码色值。

### 纸张隐喻 Token 命名空间

```
paper.css (颜色)                tokens.css (布局/动效)
─────────────────────────       ─────────────────────────
--paper-bg                      --ff-body / --ff-mono
--paper-surface                 --text-xs .. --text-3xl
--paper-raised                  --fw-normal .. --fw-bold
--ink-primary                   --lh-reading / --lh-ui / --lh-heading / --lh-code
--ink-secondary                 --space-0 .. --space-96
--ink-muted                     --sidebar-width / --navtree-width / --content-max-width
--accent / --accent-hover       --z-base .. --z-toast
--accent-soft / --accent-ring   --border-thin / --border-medium
--rule / --rule-strong          --radius
--signal-success / --signal-warning / --signal-error
--signal-success-soft / --signal-warning-soft / --signal-error-soft
--code-bg / --code-text / --code-block-bg
--link / --link-visited / --link-broken
--highlight / --blockquote-rule / --table-stripe
--scrollbar-thumb / --scrollbar-thumb-hover
--shadow-raised / --shadow-overlay / --shadow-float
--editor-bg / --editor-cursor / --editor-selection
--editor-gutter / --editor-line-highlight
--icon-folder / --icon-md / --icon-image / --icon-generic / --icon-action

// 动效 Token
--ease-press / --ease-fold / --ease-fade / --ease-back / --ease-enter / --ease-exit
--dur-press: 80ms / --dur-release: 200ms / --dur-micro: 120ms
--dur-expand: 350ms / --dur-collapse: 250ms
--dur-page-enter: 300ms / --dur-page-exit: 200ms
--dur-shimmer: 1.8s / --dur-breathe: 2s

// 暗色覆盖
[data-color-scheme='dark'] { /* 所有颜色变量覆盖 */ }
```

### 主题切换机制

```typescript
// 仅亮/暗切换，无多主题选择
// data-color-scheme="light" | "dark" 设置在 <html> 上
// 持久化: localStorage key 'markluck-theme'
```

---

## 9. 组件依赖关系图

```
AppLayout ◄── NotebookHome
    │
    ├── FileTree ◄── FileTreeNode (递归) ◄── FileIcon
    │                 ├── Breadcrumb
    │                 └── FileTreeSearch
    │
    ├── MarkdownEditor ◄── CodeMirror 6
    │   (exposes: getEditorView, focus)
    │
    ├── FormatToolbar ◄── ToolbarButton × 12
    │
    ├── StatusBar (纯展示)
    │
    ├── ThemeSelector ◄── useThemeStore
    │
    ├── WelcomePage
    │
    ├── NavTree ◄── NavTreeNode (递归)
    │
    ├── BacklinksPanel ◄── BacklinkItem × N
    │
    ├── TagCloud
    │
    ├── RecentNotes
    │
    ├── SearchPanel ◄── SearchInput + SearchResultList
    │                    └── SearchResultItem
    │
    ├── ExportDialog ◄── Exporter service
    │
    ├── ShareDialog ◄── Exporter service
    │
    └── TemplateDialog ◄── TemplateEngine
```

**Pinia Store 依赖**:

```
NotebookHome
  ├── useIndexStore   ← IndexService ← SearchEngine
  ├── useSearchStore  ← useSearch composable
  └── useThemeStore   (ThemeSelector 内调用)
```

---

## 10. 重构检查清单

重构完成后，逐项验证：

### 接口兼容性

- [ ] 所有组件的 Props 类型签名与本文档一致
- [ ] 所有组件的 Events 名称和 payload 类型与本文档一致
- [ ] 所有组件的 Slots 名称和 scoped 数据与本文档一致
- [ ] `MarkdownEditor` 的 `defineExpose` 暴露 `getEditorView()` 和 `focus()`
- [ ] `SearchInput` 的 `defineExpose` 暴露 `focus()`

### Store 兼容性

- [ ] `useThemeStore` — State/Computed/Actions 全部保持
- [ ] `useSearchStore` — State/Computed/Actions 全部保持
- [ ] `useIndexStore` — State/Computed/Actions 全部保持
- [ ] Store 的 localStorage key 不变

### Service 兼容性

- [ ] `IFileSystemService` 接口 — 18 个方法签名不变
- [ ] `MockFSService` — constructor 参数和所有方法签名不变
- [ ] `TauriIPCService` — 所有方法签名不变
- [ ] `exportNote()` 函数签名不变
- [ ] `IndexService` 类 — 所有公共方法签名不变
- [ ] `SearchEngine` 类 — 所有公共方法签名不变
- [ ] `TemplateEngine` — 所有导出函数签名不变
- [ ] `YAMLParser` — 所有导出函数和类型不变

### 页面集成

- [ ] `NotebookHome.vue` 的组件导入路径有效
- [ ] `NotebookHome.vue` 的 template 中所有组件标签名可用
- [ ] `AppLayout` 的三个命名 slot 正常工作
- [ ] Teleport 组件 (SearchPanel/ExportDialog/ShareDialog/TemplateDialog) 正常渲染到 body
- [ ] `setImageResolver()` 在 `onMounted` 中正确注册

### Token 合规

- [ ] 无硬编码色值 (stylelint `color-no-hex` 通过)
- [ ] 所有颜色使用 `--paper-*` / `--ink-*` / `--accent` / `--rule` / `--signal-*` Token
- [ ] 所有间距使用 `--space-*` Token
- [ ] 所有动效使用 `--dur-*` / `--ease-*` Token
- [ ] 暗色模式通过 `[data-color-scheme='dark']` 覆盖
- [ ] `prefers-reduced-motion` 媒体查询正确覆盖

### 类型安全

- [ ] `vue-tsc --noEmit` 零错误
- [ ] 所有组件 Props 有完整类型注解
- [ ] 所有 Store 的 State 类型导出
- [ ] `types/index.ts` 桶文件导出完整

---

> **本文档是重构的唯一接口合同。任何偏离必须在本文档中记录为 ADR。**
