# MarkLuck 技术架构设计 (TAD)

> 版本：v1.0 | 日期：2026-06-03 | 状态：已确认
>
> 本文档是 MarkLuck 的实现蓝图。所有模块、接口、数据流、类型定义均在此明确规定。编码时以此为唯一技术权威来源。

---

## 目录

1. [架构总览](#1-架构总览)
2. [前端架构](#2-前端架构)
3. [编辑器架构](#3-编辑器架构)
4. [Markdown 渲染管线](#4-markdown-渲染管线)
5. [索引系统](#5-索引系统)
6. [Tauri 后端架构](#6-tauri-后端架构)
7. [导出管线](#7-导出管线)
8. [分享流程](#8-分享流程)
9. [文件系统抽象层](#9-文件系统抽象层)
10. [数据流图](#10-数据流图)

---

## 1. 架构总览

### 1.1 三层架构

MarkLuck 采用严格的三层分离架构：

```
┌──────────────────────────────────────────────────────────────────┐
│                    LAYER 1: 前端 (Frontend)                       │
│                    Vue 3 + Vite + TypeScript                     │
│  ┌────────────┐ ┌───────────┐ ┌────────────┐ ┌───────────────┐  │
│  │  Editor    │ │ Markdown  │ │  Search    │ │  Export/Share │  │
│  │ CodeMirror6│ │ Renderer  │ │  minisearch│ │  docx/sheets  │  │
│  └────────────┘ └───────────┘ └────────────┘ └───────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              Pinia State Management Layer                  │  │
│  │  useNotebookStore / useEditorStore / useSearchStore        │  │
│  │  useIndexStore / useThemeStore                             │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              IFileSystemService (抽象接口)                  │  │
│  └────────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────┤
│                  LAYER 2: 桥接层 (Bridge)                         │
│                      Tauri v2 IPC                                 │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  invoke('cmd', args)  ←→  #[tauri::command] fn cmd(...)    │  │
│  │  序列化：JSON over IPC  双向异步通信                          │  │
│  └────────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────┤
│                 LAYER 3: 文件系统 (File System)                    │
│              Rust 原生 / File System Access API                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────────┐  │
│  │ 文件IO   │ │ 索引引擎  │ │ 文件监控  │ │ 模板/导出引擎     │  │
│  │ fs_ops   │ │ tantivy  │ │ notify   │ │ template/exporter │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────────────┘  │
│                          │                                       │
│                    ┌─────┴─────┐                                 │
│                    │ Local FS  │                                 │
│                    │(.md files)│                                 │
│                    └───────────┘                                 │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 部署形态矩阵

```
                   Web (PWA)            Desktop              Mobile
               ┌─────────────────┐ ┌─────────────────┐ ┌─────────────┐
  Frontend     │ Vue 3 SPA       │ │ Vue 3 SPA       │ │ Vue 3 SPA   │
               │ (WebAssembly *)  │ │ (WebView 嵌入)  │ │ (WebView)   │
  Bridge       │ —               │ │ Tauri v2 IPC    │ │ Tauri v2 IPC│
  FS Layer     │ File System     │ │ Rust std::fs    │ │ Rust std::fs│
               │ Access API /    │ │                 │ │             │
               │ OPFS fallback   │ │                 │ │             │
  Package      │ PWA (Service    │ │ .msi / .dmg /   │ │ .apk        │
               │  Worker)         │ │ .AppImage / .deb│ │             │
  └─────────────────┘ └─────────────────┘ └─────────────┘
```

\*注：WebAssembly 仅在特定场景（如 tantivy 降级为 WASM 版 minisearch）考虑，非默认路径。

### 1.3 关键的不可变决策

| 决策         | 说明                                                                        |
| ------------ | --------------------------------------------------------------------------- |
| 文件即数据源 | `.md` 文件是唯一数据源，绝不引入 SQLite/IndexedDB/LocalStorage 存储笔记内容 |
| 前端先行     | Phase 1-3 纯 Web 开发，Phase 4 接入 Tauri；Mock 与真实实现共享同一接口签名  |
| 离线优先     | 零网络依赖。PWA Service Worker 缓存所有静态资源，Tauri 端完全本地           |
| 安全底线     | 所有 Markdown 渲染必经 DOMPurify。文件操作限定在用户选择的笔记本根目录内    |

### 1.4 项目结构（Monorepo）

为支持多端复用渲染管线，MarkLuck 采用 pnpm workspace monorepo 结构：

```
MarkLuck/
├── packages/
│   ├── renderer/                ← @markluck/renderer (独立 npm 包)
│   │   ├── src/
│   │   │   ├── index.ts         ← 主入口：renderMarkdown(src) → HTML
│   │   │   ├── marked-ext/      ← marked 自定义扩展 (Wiki-link, #tag)
│   │   │   ├── sanitize.ts      ← DOMPurify 清洗配置
│   │   │   ├── highlight.ts     ← highlight.js 配置
│   │   │   └── types.ts         ← 渲染相关类型
│   │   └── package.json
│   │
│   ├── app/                     ← Vue 3 主应用
│   │   ├── src/                 ← (原 src/ 目录迁移至此)
│   │   ├── public/
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   └── vscode-ext/              ← VS Code 渲染插件 (Phase 5)
│       ├── src/
│       │   ├── extension.ts     ← 插件入口 (CustomTextEditorProvider)
│       │   └── webview/         ← Webview UI (复用 @markluck/renderer)
│       ├── package.json
│       └── tsconfig.json
│
├── src-tauri/                   ← Tauri Rust 后端
├── spec/                        ← 规格文档
├── doc/                         ← 设计文档
├── memory/                      ← 项目记忆
├── pnpm-workspace.yaml
└── package.json                 ← 根 package.json (workspace scripts)
```

**包依赖关系**：

```
@markluck/renderer  ← 被 app/ 和 vscode-ext/ 共同依赖
        ↑
        ├── marked (解析)
        ├── dompurify (清洗)
        ├── highlight.js (代码高亮)
        └── 自定义扩展 (Wiki-link, #tag)
```

### 1.5 系统文件关联（Tauri 端）

MarkLuck 可通过 Tauri 配置文件注册为系统默认 `.md` 打开程序。

**`tauri.conf.json` 配置**：

```json
{
  "bundle": {
    "fileAssociations": [
      {
        "ext": ["md", "markdown", "mdx"],
        "name": "Markdown Document",
        "description": "MarkLuck Markdown File",
        "role": "Editor"
      }
    ]
  }
}
```

**交互流程**：

```
Tauri 启动 → 检查是否首次运行 → 是 → 显示 WelcomePage
    ├── [设为默认] → 调用 Tauri API 注册文件关联
    ├── [否] → 跳过
    └── [以后再说] → 记录标志，下次提示
                          ↓
后续：设置页 → "文件关联" → [设为默认] / [取消关联]
```

**平台实现差异**：

- Windows：写入注册表 `HKEY_CLASSES_ROOT\.md`
- macOS：修改 `Info.plist` + Launch Services
- Linux：更新 `.desktop` 文件 MIME 类型

---

## 2. 前端架构

### 2.1 技术栈

```
  Vue 3.4+ (Composition API + <script setup>)
  ├── vue-router 4          路由管理
  ├── Pinia                 状态管理
  ├── TypeScript 5.x strict 类型系统
  ├── Vite 6                构建与 HMR
  └── CodeMirror 6          编辑器内核
```

### 2.2 组件树

```
App.vue
├── AppLayout.vue                          // 三栏布局容器
│   ├── SidebarLeft.vue                    // 左侧栏（桌面端固定，移动端抽屉）
│   │   ├── NotebookSelector.vue           //   笔记本选择器 + 面包屑
│   │   ├── FileTree.vue                   //   文件树（虚拟滚动）
│   │   │   └── FileTreeNode.vue           //     树节点（文件/文件夹）
│   │   ├── RecentNotes.vue                //   最近编辑列表
│   │   └── TagCloud.vue                   //   标签云
│   │
│   ├── EditorArea.vue                     // 中央编辑器区域
│   │   ├── TabBar.vue                     //   标签页栏（多笔记切换）
│   │   │   └── TabItem.vue                //     单个标签页
│   │   ├── FormatToolbar.vue              //   格式工具栏
│   │   │   └── ToolbarButton.vue           //     工具栏按钮（带快捷键提示）
│   │   ├── MarkdownEditor.vue             //   编辑器核心（CodeMirror 6 包装）
│   │   │   ├── BlockDecorator             //     (CM6 Extension) 蓝色标记点
│   │   │   ├── BlockWidget                //     (CM6 Extension) Tab 切换渲染/源码
│   │   │   ├── FormatAutoDetector         //     (CM6 Extension) 自动识别格式化
│   │   │   └── RestoreButton              //     (CM6 Extension) 还原格式按钮
│   │   └── StatusBar.vue                  //   状态栏（字数/行数/光标位置/保存状态）
│   │
│   ├── SidebarRight.vue                   // 右侧栏（可折叠）
│   │   ├── NavTree.vue                    //   导航树（当前文档标题层级）
│   │   │   └── NavTreeNode.vue            //     标题节点（可折叠）
│   │   ├── BacklinksPanel.vue             //   反向链接面板
│   │   └── SearchResults.vue              //   搜索结果列表
│   │       └── SearchResultItem.vue       //     单条搜索结果
│   │
│   └── Modals (Teleported)                // 全局弹窗层
│       ├── SearchDialog.vue               //   全局搜索对话框（Ctrl+Shift+F）
│       ├── ExportDialog.vue               //   导出选项对话框
│       ├── ShareDialog.vue                //   分享对话框
│       ├── TemplatePicker.vue             //   模板选择器
│       ├── SettingsDialog.vue             //   设置对话框
│       └── ConflictDialog.vue             //   文件冲突解决对话框
```

### 2.3 路由设计

```typescript
// src/router/index.ts
const routes = [
  {
    path: '/',
    component: AppLayout,
    children: [
      {
        path: '', // 默认：空白状态 / 欢迎页
        name: 'home',
        component: WelcomePage,
      },
      {
        path: 'notebook/:notebookId',
        name: 'notebook',
        component: NotebookView,
        children: [
          {
            path: 'note/:notePath+', // 笔记路径（支持多级子文件夹）
            name: 'note',
            component: EditorArea,
            props: true,
          },
        ],
      },
    ],
  },
  {
    path: '/settings',
    name: 'settings',
    component: SettingsPage,
  },
  {
    path: '/:pathMatch(.*)*', // 404 兜底
    name: 'not-found',
    component: NotFoundPage,
  },
];
```

### 2.4 状态管理架构 (Pinia Stores)

#### 2.4.1 Store 职责与依赖图

```
                     ┌──────────────┐
                     │useNotebookStore│  ← 笔记本/文件树/标签页状态
                     └──────┬───────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
     ┌────────┴─────┐ ┌────┴──────┐ ┌───┴──────────┐
     │useEditorStore│ │useIndexStore│ │useSearchStore │
     │  编辑器状态   │ │  索引数据   │ │   搜索状态    │
     └──────────────┘ └───────────┘ └──────────────┘
                            │
                     ┌──────┴───────┐
                     │useThemeStore │  ← 全局主题（被所有组件消费）
                     └──────────────┘
```

#### 2.4.2 useNotebookStore — 笔记本与文件管理

```typescript
// src/stores/notebook.ts
interface NotebookState {
  // 当前笔记本
  rootPath: string | null;           // 笔记本根目录绝对路径
  rootHandle: FileSystemDirectoryHandle | null; // Web 端目录句柄

  // 文件树
  fileTree: FileTreeNode[];          // 完整文件树
  fileTreeLoading: boolean;          // 加载中
  fileTreeError: string | null;      // 错误信息

  // 标签页管理
  openTabs: TabItem[];               // 当前打开的标签页
  activeTabId: string | null;        // 当前活动标签页 ID
  maxTabs: number;                   // 最大标签页数（默认 10）

  // 笔记本列表（MRU 排序）
  recentNotebooks: RecentNotebook[];
}

interface FileTreeNode {
  id: string;                        // 唯一标识（相对路径哈希）
  name: string;                      // 文件/文件夹名
  path: string;                      // 相对路径
  isDirectory: boolean;
  children?: FileTreeNode[];
  isOpen?: boolean;                  // 仅文件夹：展开/折叠
}

interface TabItem {
  id: string;                        // 标签页 ID
  notePath: string;                  // 笔记相对路径
  title: string;                     // 显示标题（文件名或 H1）
  isDirty: boolean;                  // 是否有未保存修改
  isLoading: boolean;                // 加载中
}

// Key Actions
actions: {
  openNotebook(rootPath: string): Promise<void>;
  closeNotebook(): void;
  refreshFileTree(): Promise<void>;
  openNote(notePath: string): Promise<void>;
  closeTab(tabId: string): void;
  createNote(parentPath: string, name: string): Promise<void>;
  createFolder(parentPath: string, name: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  renameFile(oldPath: string, newName: string): Promise<void>;
}
```

#### 2.4.3 useEditorStore — 编辑器核心状态

```typescript
// src/stores/editor.ts
interface EditorState {
  // 当前笔记
  currentNotePath: string | null;
  currentContent: string;            // 编辑器原始文本
  savedContent: string;              // 上次保存时的内容（用于 dirty 判定）
  isDirty: boolean;

  // 块级编辑
  blocks: MarkdownBlock[];           // 解析后的语法块列表
  focusedBlockIndex: number | null;  // 当前光标所在的块索引
  blockModes: Map<number, 'source' | 'render'>; // 每个块的显示模式

  // 导航树
  headings: HeadingItem[];           // 当前文档标题结构
  activeHeadingId: string | null;    // 当前光标所在标题

  // 状态
  isSaving: boolean;
  lastSavedAt: number | null;
  saveError: string | null;

  // 外部修改检测
  externalChangeDetected: boolean;
  externalChangeConflict: boolean;
}

interface MarkdownBlock {
  index: number;                     // 块序号（从 0 开始）
  type: BlockType;                   // 块类型
  raw: string;                       // 原始 Markdown 文本
  from: number;                      // CodeMirror 文档起始位置
  to: number;                        // CodeMirror 文档结束位置
  isValid: boolean;                  // 语法是否有效
  meta?: Record<string, unknown>;    // 块元数据（如 heading level, link url）
}

type BlockType =
  | 'heading' | 'paragraph' | 'bold' | 'italic' | 'strikethrough'
  | 'inlineCode' | 'codeBlock' | 'blockquote' | 'unorderedList'
  | 'orderedList' | 'taskList' | 'link' | 'image' | 'table'
  | 'horizontalRule' | 'wikiLink' | 'tag' | 'math' | 'footnote'
  | 'frontmatter';

interface HeadingItem {
  id: string;
  level: number;                     // 1-6
  text: string;
  lineNumber: number;
  children: HeadingItem[];
}

// Key Actions
actions: {
  loadNote(notePath: string): Promise<void>;
  setContent(content: string): void;
  saveNote(): Promise<void>;
  toggleBlockMode(blockIndex: number): void;
  handleExternalChange(newContent: string): void;
  resolveConflict(strategy: 'keep-mine' | 'load-external' | 'merge'): void;
  insertFormat(type: BlockType): void;  // 格式工具栏/快捷键触发
}
```

#### 2.4.4 useSearchStore — 搜索状态

```typescript
// src/stores/search.ts
interface SearchState {
  query: string;
  parsedQuery: ParsedQuery | null; // 解析后的结构化查询
  results: SearchResult[];
  totalResults: number;
  isSearching: boolean;
  searchError: string | null;

  // 高级过滤
  filters: {
    tags: string[];
    dateRange: { from?: string; to?: string } | null;
    folder: string | null;
  };

  // UI 状态
  isSearchDialogOpen: boolean;
  selectedResultIndex: number;
}

interface ParsedQuery {
  fulltext: string; // 纯文本搜索词
  regexp?: RegExp; // 正则模式（如有 /pattern/flags）
  tags: string[]; // tag:xxx
  dateRange?: { from: Date; to: Date };
  folder?: string; // folder:xxx
}

interface SearchResult {
  notePath: string;
  noteTitle: string;
  snippet: string; // 上下文片段（前后各 30 字符）
  matchType: 'title' | 'content' | 'filename';
  relevanceScore: number;
  positions: { from: number; to: number }[]; // 匹配位置（用于高亮）
}
```

#### 2.4.5 useIndexStore — 索引数据缓存

```typescript
// src/stores/index.ts
interface IndexState {
  index: NotebookIndex | null;
  isLoading: boolean;
  lastUpdatedAt: number | null;
  isStale: boolean;                  // 索引是否可能过期
  needsRebuild: boolean;             // 需要完全重建
}

// Key Actions
actions: {
  loadIndex(): Promise<void>;
  incrementallyUpdate(change: FileChange): Promise<void>;
  rebuildIndex(): Promise<void>;
  getBacklinks(notePath: string): BacklinkEntry[];
  getAllTags(): TagEntry[];
  getRecentNotes(limit?: number): RecentNoteEntry[];
}
```

#### 2.4.6 useThemeStore — 主题管理

```typescript
// src/stores/theme.ts
interface ThemeState {
  mode: 'light' | 'dark' | 'system'; // 当前主题模式
  resolved: 'light' | 'dark'; // 实际生效的主题
  codeTheme: 'github' | 'github-dark'; // 代码高亮主题
}
```

### 2.5 服务层抽象

```
┌─────────────────────────────────────────────┐
│             IFileSystemService              │  ← 接口（规格）
├─────────────────────────────────────────────┤
│ + readFile(path): Promise<string>           │
│ + writeFile(path, content): Promise<void>   │
│ + deleteFile(path): Promise<void>           │
│ + renameFile(oldPath, newPath): Promise<void>│
│ + createDirectory(path): Promise<void>      │
│ + listDirectory(path): Promise<DirEntry[]>  │
│ + statFile(path): Promise<FileStat>         │
│ + watch(path, callback): UnwatchFn          │
│ + resolvePath(...segments): string          │
│ + isPathInNotebook(path): boolean           │
└─────────────┬───────────────────────────────┘
              │
     ┌────────┴────────┐
     │                 │
┌────┴──────────┐ ┌───┴─────────────────┐
│ WebFSAService │ │ TauriIPCService     │
│ (Web 实现)    │ │ (Tauri Desktop 实现) │
├───────────────┤ ├─────────────────────┤
│ File System   │ │ invoke('fs_read')   │
│ Access API    │ │ invoke('fs_write')  │
│ + OPFS 降级   │ │ invoke('fs_list')   │
│               │ │ invoke('fs_watch')  │
└───────────────┘ └─────────────────────┘
```

详细接口定义见 [第 9 节：文件系统抽象层](#9-文件系统抽象层)。

### 2.6 目录结构

```
src/
├── main.ts                        # 入口：createApp + router + pinia
├── App.vue                        # 根组件
│
├── router/
│   └── index.ts                   # 路由配置
│
├── stores/
│   ├── notebook.ts                # useNotebookStore
│   ├── editor.ts                  # useEditorStore
│   ├── search.ts                  # useSearchStore
│   ├── index.ts                   # useIndexStore
│   └── theme.ts                   # useThemeStore
│
├── services/
│   ├── IFileSystemService.ts      # 文件系统抽象接口定义
│   ├── WebFSAService.ts           # Web 端实现 (File System Access API)
│   ├── TauriIPCService.ts         # Tauri 端实现 (IPC invoke)
│   ├── MarkdownRenderer.ts        # Markdown → HTML 渲染管线
│   ├── SearchEngine.ts            # 搜索编排（minisearch / tantivy IPC）
│   ├── IndexManager.ts            # .markluck_index.json 读写
│   ├── Exporter.ts                # 导出编排
│   ├── ShareManager.ts            # 分享流程编排
│   └── TemplateEngine.ts          # 模板占位符替换
│
├── components/
│   ├── layout/
│   │   ├── AppLayout.vue
│   │   ├── SidebarLeft.vue
│   │   ├── EditorArea.vue
│   │   └── SidebarRight.vue
│   │
│   ├── editor/
│   │   ├── MarkdownEditor.vue        # CodeMirror 6 包装组件
│   │   ├── FormatToolbar.vue
│   │   ├── ToolbarButton.vue
│   │   ├── TabBar.vue
│   │   ├── TabItem.vue
│   │   └── StatusBar.vue
│   │
│   ├── file-tree/
│   │   ├── FileTree.vue
│   │   ├── FileTreeNode.vue
│   │   └── NotebookSelector.vue
│   │
│   ├── nav/
│   │   ├── NavTree.vue
│   │   └── NavTreeNode.vue
│   │
│   ├── search/
│   │   ├── SearchDialog.vue
│   │   ├── SearchResults.vue
│   │   └── SearchResultItem.vue
│   │
│   ├── panels/
│   │   ├── BacklinksPanel.vue
│   │   ├── TagCloud.vue
│   │   └── RecentNotes.vue
│   │
│   └── modals/
│       ├── ExportDialog.vue
│       ├── ShareDialog.vue
│       ├── TemplatePicker.vue
│       ├── SettingsDialog.vue
│       └── ConflictDialog.vue
│
├── composables/
│   ├── useMarkdownParser.ts         # 块级解析逻辑（供编辑器使用）
│   ├── useBlockDetection.ts         # 语法块自动识别
│   ├── useFormatShortcuts.ts        # 键盘快捷键绑定
│   ├── useFileWatcher.ts            # 文件变更监听 Composable
│   └── useDebouncedSave.ts          # 防抖自动保存
│
├── utils/
│   ├── path.ts                      # 跨平台路径处理工具
│   ├── sanitize.ts                  # DOMPurify 封装
│   ├── marked-extensions.ts         # marked 自定义扩展（wiki-link, #tag）
│   ├── highlight.ts                 # highlight.js 封装
│   └── content-type.ts              # MIME 类型检测
│
├── types/
│   ├── note.ts                      # 笔记实体类型
│   ├── notebook.ts                  # 笔记本/文件树类型
│   ├── editor.ts                    # 编辑器相关类型
│   ├── search.ts                    # 搜索相关类型
│   ├── index.ts                     # 索引 schema 类型
│   ├── export.ts                    # 导出选项类型
│   └── share.ts                     # 分享选项类型
│
└── assets/
    ├── styles/
    │   ├── variables.css            # CSS 自定义属性（设计 Token）
    │   ├── editor.css               # CodeMirror 主题覆盖
    │   ├── print.css                # 打印样式表（PDF 导出用）
    │   └── markdown.css             # 渲染输出的 Markdown 样式
    └── templates/                   # 内置模板文件（仅用于 Web fallback）
```

---

## 3. 编辑器架构

编辑器是 MarkLuck 最复杂的模块。基于 CodeMirror 6，通过自定义 Extension 体系实现块级混合编辑。

### 3.1 CodeMirror 6 核心配置

```typescript
// MarkdownEditor.vue — 编辑器初始化
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';

const extensions = [
  // 基础
  markdown(), // Markdown 语法支持
  history(), // 撤销/重做
  keymap.of([...defaultKeymap, ...historyKeymap]),
  placeholder('开始书写...'),

  // MarkLuck 自定义
  blockDecorator(), // 蓝色/绿色标记点 Deco
  blockWidget(), // Tab 切换 渲染/源码 Widget
  formatAutoDetector(), // 自动识别闭环语法块
  restoreButton(), // 还原格式 Widget
  formatShortcuts(), // 快捷键绑定
  imeHandler(), // 中文 IME 处理
  throttledParser(150), // 150ms 防抖解析

  // 主题
  EditorView.theme({
    /* ... */
  }),
];
```

### 3.2 BlockDecorator — 语法块边界标记

**职责**：在每个有效语法块的开始和结束位置渲染蓝色（源码模式）或绿色（渲染模式）标记点。

```
源码模式（蓝色 ■）:
┌─────────────────────────────┐
│ ■**粗体文本**■              │  标记点为蓝色
│  ■*斜体文本*■               │
│  ■`行内代码`■               │
└─────────────────────────────┘

渲染模式（绿色 ■）:
┌─────────────────────────────┐
│ ■粗体文本■                  │  标记点为绿色，语法标记隐藏
│  ■斜体文本■                 │
│  ■行内代码■                 │
└─────────────────────────────┘
```

实现基于 CodeMirror 的 **Decoration** API：

```typescript
// src/components/editor/BlockDecorator.ts
function blockDecorator(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      buildDecorations(view: EditorView): DecorationSet {
        const blocks = parseBlocks(view.state.doc.toString());
        const widgets: Range<Decoration>[] = [];

        for (const block of blocks) {
          if (!block.isValid) continue;
          const mode = getBlockMode(block.index);

          // 块开始标记
          widgets.push({
            from: block.from,
            to: block.from,
            value: Decoration.widget({
              widget: new BlockMarkerWidget(mode, 'start'),
              side: -1,
            }),
          });

          // 块结束标记
          widgets.push({
            from: block.to,
            to: block.to,
            value: Decoration.widget({
              widget: new BlockMarkerWidget(mode, 'end'),
              side: 1,
            }),
          });
        }

        return Decoration.set(widgets, true);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet) {
          this.decorations = this.buildDecorations(update.view);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
}
```

### 3.3 BlockWidget — Tab 切换渲染/源码

**职责**：当光标位于某个语法块内时，按 Tab 键在"源码模式"和"渲染模式"之间切换。渲染模式下隐藏 Markdown 语法标记，仅显示渲染后的富文本。

```
用户在 **粗体** 上按 Tab：
  → 源码模式消失，显示 "粗体" 富文本，标记点变为绿色

再次按 Tab：
  → 恢复到 **粗体** 源码，标记点变为蓝色
```

```typescript
// src/components/editor/BlockWidget.ts
function blockWidget(): Extension {
  // 使用 Decoration.replace 在渲染模式下替换 Markdown 语法
  // 渲染模式：将 **bold** 替换为渲染后的 DOM 节点
  // 源码模式：保持原始 Markdown 文本

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      update(update: ViewUpdate) {
        // 仅在焦点块模式变化时重建
        if (this.focusedBlockChanged(update)) {
          this.decorations = this.buildWidgets(update.view);
        }
      }

      buildWidgets(view: EditorView): DecorationSet {
        const blocks = parseBlocks(view.state.doc.toString());
        const ranges: Range<Decoration>[] = [];

        for (const block of blocks) {
          if (!block.isValid) continue;
          const mode = getBlockMode(block.index);

          if (mode === 'render') {
            // 用渲染后的 DOM 替换原始 Markdown 范围
            ranges.push({
              from: block.from,
              to: block.to,
              value: Decoration.replace({
                widget: new RenderedBlockWidget(block),
                inclusive: false,
              }),
            });
          }
        }

        return Decoration.set(ranges, true);
      }
    },
  );
}
```

### 3.4 Block 解析管线

```
 raw text → Tokenizer (marked lexer) → Token[] → BlockAssembler → Block[]
                                                         │
                                                         ▼
                                              CodeMirror Decorations/Widgets
```

**解析器设计**：

```typescript
// src/composables/useMarkdownParser.ts
interface ParseResult {
  blocks: MarkdownBlock[];
  headings: HeadingItem[];
  links: WikiLinkRef[]; // [[wikilink]] 引用
  tags: InlineTag[]; // #tag 引用
}

function parseBlocks(raw: string): ParseResult {
  // Step 1: 使用 marked 的 lexer 获取 Token 流
  const tokens = marked.lexer(raw);

  // Step 2: 将 Token 转换为 MarkdownBlock 数组
  const blocks = assembleBlocks(tokens, raw);

  // Step 3: 提取结构化信息
  const headings = extractHeadings(blocks);
  const links = extractWikiLinks(blocks);
  const tags = extractInlineTags(blocks);

  return { blocks, headings, links, tags };
}

function assembleBlocks(tokens: Token[], raw: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  for (const token of tokens) {
    const block: MarkdownBlock = {
      index: index++,
      type: mapTokenType(token.type),
      raw: token.raw,
      from: findOffset(raw, token.raw, lastEnd),
      to: from + token.raw.length,
      isValid: validateBlock(token),
    };
    blocks.push(block);
  }

  return blocks;
}
```

### 3.5 FormatAutoDetector — 自动格式识别

**职责**：监听用户输入，当检测到闭合语法标记时，自动将对应块切换到渲染模式。

```
用户输入: **hello**
  → 输入第二个 * 的瞬间 → 检测到完整 **...** 语法块
  → 自动切换该块到渲染模式 → 显示 "hello" 富文本 + 绿色标记点

用户输入: [text](https://example.com)
  → 输入最后一个 ) 的瞬间 → 检测到完整链接语法
  → 自动切换为渲染后的可点击链接
```

```typescript
// src/composables/useBlockDetection.ts
function formatAutoDetector(): Extension {
  return ViewPlugin.fromClass(
    class {
      update(update: ViewUpdate) {
        if (!update.docChanged) return;

        // 仅检查光标附近的文本变更
        const changedRange = getChangedRange(update);
        const textAround = getTextAroundCursor(update.view);

        // 检测是否有新的闭环语法块形成
        const newBlock = detectClosedBlock(textAround);
        if (newBlock && newBlock.isValid) {
          // 自动切换到渲染模式
          setBlockMode(newBlock.index, 'render');
        }
      }
    },
  );
}

// detectClosedBlock 使用正则快速匹配常见行内语法
const INLINE_PATTERNS = [
  { regex: /\*\*(.+?)\*\*/, type: 'bold' },
  { regex: /\*(.+?)\*/, type: 'italic' },
  { regex: /`(.+?)`/, type: 'inlineCode' },
  { regex: /\[(.+?)\]\((.+?)\)/, type: 'link' },
  { regex: /!\[(.+?)\]\((.+?)\)/, type: 'image' },
  { regex: /\[\[(.+?)\]\]/, type: 'wikiLink' },
  { regex: /#[^\s#]+/, type: 'tag' },
];
```

### 3.6 RestoreButton — 还原格式按钮

**职责**：用户在源码模式下修改导致语法失效时，在块下方显示"还原格式"按钮。

```
用户操作: **hello world**  → 切换到源码 → 删除一个 *
结果: *hello world**        → 语法失效 → 显示 [还原格式] 按钮
点击按钮 / Ctrl+Shift+Z:   → 恢复到 **hello world**
```

```typescript
// src/components/editor/RestoreButton.ts
function restoreButton(): Extension {
  // 使用 Widget 在失效块下方渲染还原按钮
  // 保存每个块的上一个有效状态快照
  // 按钮点击时恢复快照内容

  const blockHistory = new WeakMap<EditorView, Map<number, string>>();

  // 每次块变为有效时，保存其内容快照
  // 当块变为无效且存在快照时，显示还原按钮
}
```

### 3.7 FormatToolbar — 格式工具栏集成

工具栏按钮与编辑器的交互通过 `insertFormat()` 方法统一处理：

```typescript
// src/components/editor/FormatToolbar.vue
const toolbarItems: ToolbarItem[] = [
  { type: 'bold', icon: 'B', label: '加粗', shortcut: 'Ctrl+B' },
  { type: 'italic', icon: 'I', label: '斜体', shortcut: 'Ctrl+I' },
  { type: 'strikethrough', icon: 'S', label: '删除线', shortcut: 'Ctrl+Shift+S' },
  { type: 'heading', icon: 'H', label: '标题', shortcut: 'Ctrl+1-6' },
  { type: 'unorderedList', icon: '•', label: '无序列表', shortcut: 'Ctrl+Shift+U' },
  { type: 'orderedList', icon: '1.', label: '有序列表', shortcut: 'Ctrl+Shift+O' },
  { type: 'taskList', icon: '☑', label: '任务列表', shortcut: 'Ctrl+Shift+T' },
  { type: 'blockquote', icon: '"', label: '引用', shortcut: 'Ctrl+Shift+Q' },
  { type: 'codeBlock', icon: '<>', label: '代码块', shortcut: 'Ctrl+Shift+C' },
  { type: 'link', icon: '🔗', label: '链接', shortcut: 'Ctrl+K' },
  { type: 'image', icon: '🖼', label: '图片', shortcut: 'Ctrl+Shift+I' },
  { type: 'horizontalRule', icon: '—', label: '分割线', shortcut: 'Ctrl+Shift+H' },
];

function handleToolbarClick(type: BlockType) {
  editorStore.insertFormat(type);
}
```

### 3.8 键盘快捷键系统

```typescript
// src/composables/useFormatShortcuts.ts
function formatShortcuts(): Extension {
  return keymap.of([
    // 格式快捷键
    { key: 'Mod-b', run: insertFormat('bold') },
    { key: 'Mod-i', run: insertFormat('italic') },
    { key: 'Mod-Shift-s', run: insertFormat('strikethrough') },
    { key: 'Mod-k', run: insertFormat('link') },
    { key: 'Mod-Shift-i', run: insertFormat('image') },
    { key: 'Mod-Shift-u', run: insertFormat('unorderedList') },
    { key: 'Mod-Shift-o', run: insertFormat('orderedList') },
    { key: 'Mod-Shift-t', run: insertFormat('taskList') },
    { key: 'Mod-Shift-q', run: insertFormat('blockquote') },
    { key: 'Mod-Shift-c', run: insertFormat('codeBlock') },
    { key: 'Mod-Shift-h', run: insertFormat('horizontalRule') },

    // 标题快捷键 (Mod-1 到 Mod-6)
    { key: 'Mod-1', run: insertHeading(1) },
    { key: 'Mod-2', run: insertHeading(2) },
    // ... 3-6

    // 块级编辑快捷键
    { key: 'Tab', run: toggleCurrentBlockMode },
    { key: 'Mod-Shift-z', run: restoreLastValidFormat },
  ]);
}

// insertFormat 实现
function insertFormat(type: BlockType): Command {
  return (view) => {
    const { from, to } = view.state.selection.main;
    const selectedText = view.state.sliceDoc(from, to);

    const syntax = FORMAT_SYNTAX[type];
    // FORMAT_SYNTAX 映射: { bold: ['**', '**'], italic: ['*', '*'], ... }

    if (selectedText) {
      // 选中文本 → 包裹语法标记
      view.dispatch({
        changes: {
          from,
          to,
          insert: `${syntax[0]}${selectedText}${syntax[1]}`,
        },
        selection: { anchor: from + syntax[0].length + selectedText.length },
      });
    } else {
      // 无选中 → 插入占位符
      const placeholder = syntax[2] || type;
      view.dispatch({
        changes: {
          from,
          to,
          insert: `${syntax[0]}${placeholder}${syntax[1]}`,
        },
        selection: { anchor: from + syntax[0].length + placeholder.length },
      });
    }

    return true;
  };
}
```

### 3.9 中文 IME 处理

```typescript
// src/components/editor/IMEHandler.ts
function imeHandler(): Extension {
  return EditorView.updateListener.of((update) => {
    // 检测 composition 事件状态
    // 在 IME 组合输入期间：
    //   1. 暂停块级解析（避免解析不完整的拼音）
    //   2. 暂停自动格式化检测
    //   3. compositionend 时恢复并重新解析
    //
    // 实现方式：通过全局状态标志 isComposing
    //   compositionstart → isComposing = true
    //   compositionend   → isComposing = false + 触发完整重解析
  });
}

// 也可使用 CodeMirror 的 EditorView.compositionStarted / compositionEnded 回调
```

---

## 4. Markdown 渲染管线

### 4.1 管线架构图

```
┌──────────┐    ┌──────────────┐    ┌──────────────┐
│ Raw      │───→│ marked.parse │───→│ Custom       │
│ Markdown │    │  (lex → ast  │    │ Extensions   │
│ Text     │    │   → html)    │    │              │
└──────────┘    └──────────────┘    └──────┬───────┘
                                           │
                    ┌──────────────────────┘
                    │ HTML String
                    ▼
           ┌──────────────┐
           │ DOMPurify    │  ← 安全清洗（阻断 XSS）
           │ .sanitize()  │
           └──────┬───────┘
                  │ Clean HTML
                  ▼
           ┌──────────────┐
           │ highlight.js │  ← 代码块语法高亮
           │ .highlight   │
           │ Element()    │
           └──────┬───────┘
                  │ Highlighted HTML
                  ▼
           ┌──────────────┐
           │ DOM Insert   │  ← innerHTML / v-html
           │ (Vue render) │
           └──────────────┘
```

### 4.2 marked 自定义扩展

```typescript
// src/utils/marked-extensions.ts

// Extension 1: Wiki-link [[...]]
const wikiLinkExtension = {
  name: 'wikiLink',
  level: 'inline' as const,
  start(src: string) {
    return src.indexOf('[[');
  },
  tokenizer(src: string) {
    const rule = /^\[\[([^\]]+)\]\]/;
    const match = rule.exec(src);
    if (match) {
      const raw = match[1];
      // 支持 [[笔记名]]、[[笔记名|显示文字]]、[[笔记名#标题]]
      const parts = raw.split('|');
      const target = parts[0].split('#');
      return {
        type: 'wikiLink',
        raw: match[0],
        text: parts[1] || target[0], // 显示文字
        note: target[0], // 目标笔记名
        anchor: target[1] || null, // 锚点（标题）
        exists: false, // 将在渲染阶段查询索引
      };
    }
  },
  renderer(token: WikiLinkToken) {
    const cls = token.exists ? 'wikilink' : 'wikilink wikilink--dead';
    return `<a class="${cls}" data-note="${escapeAttr(token.note)}" data-anchor="${escapeAttr(token.anchor || '')}" href="javascript:void(0)">${escapeHtml(token.text)}</a>`;
  },
};

// Extension 2: 行内 #tag
const tagExtension = {
  name: 'tag',
  level: 'inline' as const,
  start(src: string) {
    return src.indexOf('#');
  },
  tokenizer(src: string) {
    const rule = /^#([^\s#]+)/;
    const match = rule.exec(src);
    if (match) {
      return {
        type: 'tag',
        raw: match[0],
        text: match[1],
      };
    }
  },
  renderer(token: TagToken) {
    return `<a class="md-tag" data-tag="${escapeAttr(token.text)}" href="javascript:void(0)">#${escapeHtml(token.text)}</a>`;
  },
};
```

### 4.3 安全清洗

```typescript
// src/utils/sanitize.ts
import DOMPurify from 'dompurify';

const purifyConfig: DOMPurify.Config = {
  ALLOWED_TAGS: [
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'br',
    'hr',
    'strong',
    'em',
    'del',
    's',
    'a',
    'img',
    'ul',
    'ol',
    'li',
    'blockquote',
    'pre',
    'code',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'input', // 任务列表 checkbox
    'span',
    'div', // 通用容器
    'sup',
    'sub', // 上下标 / 脚注
    'details',
    'summary', // 折叠块
  ],
  ALLOWED_ATTR: [
    'href',
    'src',
    'alt',
    'class',
    'id',
    'data-note',
    'data-anchor',
    'data-tag', // MarkLuck 自定义属性
    'type',
    'checked',
    'disabled', // 任务列表
    'target',
    'rel',
  ],
  ALLOW_DATA_ATTR: true, // 允许 data-* 属性
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input[type="hidden"]'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
};

export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, purifyConfig);
}
```

### 4.4 代码高亮（按需加载）

```typescript
// src/utils/highlight.ts
import hljs from 'highlight.js/lib/core';

// 按需注册语言包（控制 bundle 体积）
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import markdown from 'highlight.js/lib/languages/markdown';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import xml from 'highlight.js/lib/languages/xml';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('xml', xml);

export function highlightCodeBlocks(container: HTMLElement): void {
  container.querySelectorAll('pre code').forEach((block) => {
    hljs.highlightElement(block as HTMLElement);
  });
}
```

### 4.5 完整渲染流程

```typescript
// src/services/MarkdownRenderer.ts
export class MarkdownRenderer {
  /**
   * 完整渲染管线：Markdown 文本 → 安全 HTML
   */
  static render(markdown: string): string {
    // Step 1: marked 解析（含自定义扩展）
    const rawHtml = marked.parse(markdown, {
      extensions: [wikiLinkExtension, tagExtension],
      gfm: true, // GitHub Flavored Markdown
      breaks: false, // 不自动转换换行为 <br>
    });

    // Step 2: DOMPurify 安全清洗
    const cleanHtml = sanitize(rawHtml);

    return cleanHtml;
  }

  /**
   * 渲染到 DOM 容器（包含代码高亮后处理）
   */
  static renderToDom(markdown: string, container: HTMLElement): void {
    const html = this.render(markdown);
    container.innerHTML = html;

    // Step 3: 代码块语法高亮（后处理）
    highlightCodeBlocks(container);

    // Step 4: 绑定事件处理
    this.bindInteractions(container);
  }

  private static bindInteractions(container: HTMLElement): void {
    // 绑定 Wiki-link 点击 → 跳转笔记
    // 绑定 #tag 点击 → 搜索标签
    // 绑定任务列表 checkbox → 切换状态
  }
}
```

### 4.6 性能策略

| 场景        | 策略         | 说明                                                                                 |
| ----------- | ------------ | ------------------------------------------------------------------------------------ |
| < 100KB     | 全量渲染     | 直接 parse + innerHTML，< 50ms                                                       |
| 100KB - 5MB | 分块渲染     | 将文档按标题拆分为 section，使用 IntersectionObserver 可见性检测，仅渲染可见 section |
| > 5MB       | 纯文本模式   | 显示警告："文件过大，仅显示纯文本"，提供"强制渲染"按钮                               |
| 实时编辑    | 仅渲染当前块 | 编辑器内使用块级渲染，不触发全量 marked 管线                                         |

---

## 5. 索引系统

### 5.1 索引文件 Schema

索引文件 `.markluck_index.json` 位于笔记本根目录：

```typescript
// spec/types/index.ts
interface NotebookIndex {
  /** 索引格式版本 */
  version: 2;

  /** 笔记本根目录（相对路径为空，此为创建时记录的标识） */
  notebookId: string;

  /** 最后完整重建时间 (Unix ms) */
  lastRebuiltAt: number;

  /** 最后增量更新时间 (Unix ms) */
  lastUpdatedAt: number;

  /** 笔记元数据索引 */
  notes: Record<string, NoteIndexEntry>;
  //       ↑ notePath（相对路径）→ 条目

  /** 标签索引：tag → 包含该标签的笔记路径列表 */
  tags: Record<string, TagIndexEntry>;

  /** 反向链接索引：notePath → 引用该笔记的其他笔记路径列表 */
  backlinks: Record<string, BacklinkIndexEntry>;

  /** 全文搜索索引元数据（映射到 minisearch / tantivy） */
  searchIndex: SearchIndexMeta;

  /** 最近编辑笔记列表 */
  recentNotes: RecentNoteEntry[];
}

interface NoteIndexEntry {
  /** 文件相对路径 */
  path: string;

  /** 笔记标题（H1 或文件名） */
  title: string;

  /** 最后修改时间 (Unix ms) */
  mtime: number;

  /** 文件大小（字节） */
  size: number;

  /** 笔记中出现的所有标签 */
  tags: string[];

  /** 笔记中引用的其他笔记（出链） */
  outlinks: string[];

  /** 章节标题列表 */
  headings: { level: number; text: string; line: number }[];

  /** 内容摘要（前 200 字符） */
  excerpt: string;
}

interface TagIndexEntry {
  /** 标签名（不含 #） */
  tag: string;

  /** 引用次数 */
  count: number;

  /** 使用该标签的笔记路径列表 */
  notes: string[];
}

interface BacklinkIndexEntry {
  /** 引用来源笔记路径列表 */
  sources: string[];

  /** 每条引用的上下文片段 */
  contexts: Record<string, string[]>;
  //              ↑ sourcePath → 引用处的上下文片段数组
}

interface SearchIndexMeta {
  /** 已索引的文件数量 */
  indexedCount: number;

  /** 已索引的总字符数 */
  indexedChars: number;

  /** 上次索引时间 (Unix ms) */
  lastIndexedAt: number;

  /** 索引引擎类型 */
  engine: 'minisearch' | 'tantivy';
}

interface RecentNoteEntry {
  /** 笔记相对路径 */
  path: string;

  /** 笔记标题 */
  title: string;

  /** 最后访问时间 (Unix ms) */
  lastOpenedAt: number;
}
```

### 5.2 索引完整结构示例

```json
{
  "version": 2,
  "notebookId": "my-notebook",
  "lastRebuiltAt": 1717430400000,
  "lastUpdatedAt": 1717431000000,
  "notes": {
    "tutorials/javascript.md": {
      "path": "tutorials/javascript.md",
      "title": "JavaScript 入门",
      "mtime": 1717430400000,
      "size": 4096,
      "tags": ["javascript", "tutorial", "beginner"],
      "outlinks": ["basics/variables.md", "basics/functions.md"],
      "headings": [
        { "level": 1, "text": "JavaScript 入门", "line": 1 },
        { "level": 2, "text": "变量声明", "line": 10 },
        { "level": 2, "text": "函数定义", "line": 35 }
      ],
      "excerpt": "JavaScript 是现代 Web 开发的核心语言..."
    }
  },
  "tags": {
    "javascript": {
      "tag": "javascript",
      "count": 12,
      "notes": ["tutorials/javascript.md", "notes/es6.md", "..."]
    }
  },
  "backlinks": {
    "tutorials/javascript.md": {
      "sources": ["notes/roadmap.md", "weekly/2026-05.md"],
      "contexts": {
        "notes/roadmap.md": ["接下来要学习 [[tutorials/javascript]] 的基础语法"],
        "weekly/2026-05.md": ["本周完成了 [[tutorials/javascript]] 的前三章"]
      }
    }
  },
  "searchIndex": {
    "indexedCount": 150,
    "indexedChars": 524288,
    "lastIndexedAt": 1717430400000,
    "engine": "minisearch"
  },
  "recentNotes": [
    {
      "path": "tutorials/javascript.md",
      "title": "JavaScript 入门",
      "lastOpenedAt": 1717431000000
    },
    { "path": "notes/roadmap.md", "title": "学习路线图", "lastOpenedAt": 1717430500000 }
  ]
}
```

### 5.3 增量更新策略

```
文件变更事件 → IndexUpdateQueue → 150ms 防抖 → 批量处理
                                                    │
                          ┌─────────────────────────┐
                          │  what changed?           │
                          └──────────┬──────────────┘
                                     │
                ┌────────────────────┼────────────────────┐
                │                    │                    │
         note.created          note.modified        note.deleted
                │                    │                    │
                ▼                    ▼                    ▼
     ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
     │ 1. 解析新文件    │  │ 1. 解析新内容    │  │ 1. 从索引中移除  │
     │ 2. 提取元数据    │  │ 2. 对比旧元数据   │  │ 2. 更新所有引用  │
     │ 3. 添加搜索索引  │  │ 3. 更新变化项     │  │    该笔记的条目  │
     │ 4. 更新反向链接  │  │ 4. 更新搜索索引   │  │ 3. 从搜索索引移除│
     │ 5. 更新标签索引  │  │ 5. 重新计算反链   │  │ 4. 从最近列表    │
     └─────────────────┘  │ 6. 更新标签索引   │  │    移除（如需要）│
                          └─────────────────┘  └─────────────────┘
```

增量更新的核心原则：

- **只解析变化文件**：不触发全盘扫描
- **级联更新**：修改文件的 outlinks 变化时，级联更新被引用笔记的 backlinks
- **去重**：同一文件的多次变更在 150ms 窗口内合并
- **版本号保护**：索引写回前检查文件 mtime，如果被外部修改则标记 `stale` 而非覆盖

### 5.4 重建索引

触发条件：

- 用户点击"重建索引"按钮
- 笔记本首次打开，`.markluck_index.json` 不存在
- 索引文件格式版本不兼容
- 检测到索引数据严重不一致（notes 数量与实际 .md 文件数量偏差 > 10%）

重建流程：

```
1. 扫描笔记本根目录下所有 .md 文件
2. 逐个解析：提取标题、标签、outlinks、摘要
3. 构建反向链接映射
4. 构建标签索引
5. 构建全文搜索索引（minisearch / tantivy）
6. 原子写入 .markluck_index.json（先写 .tmp 再 rename）
```

---

## 6. Tauri 后端架构

### 6.1 Rust 模块结构

```
src-tauri/
├── Cargo.toml
├── tauri.conf.json
├── icons/
└── src/
    ├── main.rs                 # 入口：Tauri Builder + 命令注册
    ├── lib.rs                  # 库入口
    │
    ├── fs_ops/
    │   ├── mod.rs              # 文件系统操作模块
    │   ├── read.rs             # 文件读取 / 批量读取
    │   ├── write.rs            # 文件写入（含原子写入：.tmp → rename）
    │   ├── list.rs             # 目录扫描（递归 / 过滤 .md）
    │   ├── watch.rs            # 文件监控（notify crate 封装）
    │   └── path.rs             # 跨平台路径处理
    │
    ├── indexer/
    │   ├── mod.rs              # 索引引擎模块
    │   ├── tantivy_index.rs    # tantivy 全文索引（Tauri 端搜索）
    │   ├── metadata.rs         # .markluck_index.json 读写
    │   └── incremental.rs      # 增量更新逻辑
    │
    ├── template_engine/
    │   ├── mod.rs              # 模板引擎
    │   └── placeholders.rs     # 占位符替换（{{date}}, {{time}}, ...）
    │
    ├── exporter/
    │   ├── mod.rs              # 导出模块（Tauri 侧文件生成）
    │   ├── txt.rs              # 纯文本导出
    │   └── html.rs             # 自包含 HTML 生成
    │
    └── utils/
        ├── mod.rs
        ├── encoding.rs         # 文件编码检测与转换
        └── sanitize.rs         # 文件名/路径安全检查
```

### 6.2 IPC 命令定义

```rust
// src-tauri/src/main.rs

#[tauri::command]
fn fs_read_file(path: String) -> Result<String, String>;
// 读取文本文件。自动检测 UTF-8 / UTF-8 BOM 编码
// 路径必须位于用户选择的笔记本根目录内（安全检查）

#[tauri::command]
fn fs_write_file(path: String, content: String) -> Result<(), String>;
// 写入文本文件。原子写入：先写 .tmp 再 rename
// 保存前备份 mtime，写入后检查是否有外部并发修改

#[tauri::command]
fn fs_delete_file(path: String) -> Result<(), String>;

#[tauri::command]
fn fs_rename_file(old_path: String, new_path: String) -> Result<(), String>;

#[tauri::command]
fn fs_create_directory(path: String) -> Result<(), String>;

#[tauri::command]
fn fs_read_directory(path: String) -> Result<Vec<DirEntry>, String>;
// 返回目录内容列表，仅返回 .md 文件和子目录

#[tauri::command]
fn fs_stat_file(path: String) -> Result<FileStat, String>;
// 返回文件大小、mtime、是否是目录

#[tauri::command]
fn fs_start_watching(root_path: String, app_handle: tauri::AppHandle) -> Result<(), String>;
// 启动文件监控。变更事件通过 Tauri Event 推送到前端
// Events: file-changed, file-created, file-deleted, file-renamed

#[tauri::command]
fn fs_stop_watching() -> Result<(), String>;

#[tauri::command]
fn fs_resolve_path(root: String, segments: Vec<String>) -> Result<String, String>;
// 跨平台路径拼接。使用 std::path::PathBuf
// 输出路径使用 / 分隔符（与前端统一）

#[tauri::command]
fn fs_validate_path(root: String, path: String) -> Result<bool, String>;
// 安全检查：确认 path 在 root 目录内，防止路径遍历攻击

// --- 索引命令 ---

#[tauri::command]
fn index_read(root_path: String) -> Result<String, String>;
// 读取 .markluck_index.json 内容（字符串，前端反序列化）

#[tauri::command]
fn index_write(root_path: String, json_content: String) -> Result<(), String>;
// 写入 .markluck_index.json（原子写入）

#[tauri::command]
fn index_search(root_path: String, query: String) -> Result<Vec<SearchResultItem>, String>;
// 使用 tantivy 执行全文搜索
// 返回匹配的笔记路径、分数、片段

#[tauri::command]
fn index_rebuild(root_path: String) -> Result<(), String>;
// 重建整个 tantivy 索引

// --- 模板命令 ---

#[tauri::command]
fn template_list(root_path: String) -> Result<Vec<TemplateItem>, String>;
// 列出 _templates/ 文件夹中的模板

#[tauri::command]
fn template_render(template_content: String, date: String) -> Result<String, String>;
// 替换模板占位符

// --- 导出命令 ---

#[tauri::command]
fn export_generate(
    markdown: String,
    format: String,          // "pdf" | "txt" | "html"
    output_path: String,
    options: ExportOptions,
) -> Result<(), String>;
// Tauri 侧生成导出文件（TXT / HTML）
// PDF 由前端 window.print() 处理，Tauri 侧仅做临时文件准备

// --- 系统 ---

#[tauri::command]
fn system_open_in_default_app(path: String) -> Result<(), String>;
// 使用系统默认应用打开文件（分享流程）

#[tauri::command]
fn system_get_notebooks_mru() -> Result<Vec<String>, String>;
// 获取最近使用的笔记本列表

#[tauri::command]
fn system_add_notebook_mru(root_path: String) -> Result<(), String>;
```

### 6.3 跨平台路径处理

```rust
// src-tauri/src/fs_ops/path.rs

/// 统一路径处理：所有内部路径使用 / 分隔符
/// 与操作系统交互时使用 PathBuf 自动适配
pub fn normalize_path(raw: &str) -> String {
    raw.replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

/// 安全检查：防止路径遍历攻击
/// 确保 target 路径在 root 目录内
pub fn is_safe_path(root: &Path, target: &Path) -> bool {
    let canonical_root = root.canonicalize().unwrap_or_default();
    let canonical_target = target.canonicalize().unwrap_or_default();
    canonical_target.starts_with(&canonical_root)
}

/// 路径拼接：所有输入使用 /，自动转换为平台分隔符
pub fn join_path(root: &str, segments: &[String]) -> PathBuf {
    let mut path = PathBuf::from(root);
    for seg in segments {
        path.push(seg);
    }
    path
}
```

### 6.4 文件监控实现

```rust
// src-tauri/src/fs_ops/watch.rs
use notify::{Watcher, RecursiveMode, Event, EventKind};
use std::sync::mpsc;

pub fn start_watcher(
    root_path: &str,
    app_handle: tauri::AppHandle,
) -> notify::Result<()> {
    let (tx, rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            tx.send(event).unwrap();
        }
    })?;

    watcher.watch(Path::new(root_path), RecursiveMode::Recursive)?;

    // 在独立线程中处理事件
    std::thread::spawn(move || {
        // 150ms 防抖计数器
        let mut debounce: HashMap<PathBuf, Instant> = HashMap::new();

        for event in rx {
            for path in event.paths {
                // 过滤：仅处理 .md 文件和 .markluck_index.json
                if !is_markdown_file(&path) && !is_index_file(&path) {
                    continue;
                }

                // 防抖
                if let Some(last) = debounce.get(&path) {
                    if last.elapsed() < Duration::from_millis(150) {
                        continue;
                    }
                }
                debounce.insert(path.clone(), Instant::now());

                // 推送事件到前端
                let event_name = match event.kind {
                    EventKind::Create(_) => "file-created",
                    EventKind::Modify(_) => "file-changed",
                    EventKind::Remove(_) => "file-deleted",
                    _ => continue,
                };

                let _ = app_handle.emit(event_name, path.to_string_lossy().to_string());
            }
        }
    });

    Ok(())
}
```

---

## 7. 导出管线

### 7.1 导出架构

```
用户选择导出格式 → ExportManager → 格式特定生成器 → 文件写入 → 提示完成
     │
     ├── PDF:   window.print() + print.css
     ├── docx:  docx.js Client API
     ├── XLSX:  sheetjs (仅表格内容)
     ├── CSV:   string concat (仅表格内容)
     ├── TXT:   strip Markdown syntax
     └── HTML:  self-contained HTML (内嵌 CSS + JS)
```

### 7.2 各格式实现细节

#### PDF — window.print()

```typescript
// 策略：不引入任何 PDF 生成库。使用浏览器打印 + 专用打印样式表。
// CSS: @media print { ... } 定义在 src/assets/styles/print.css
//
// 处理流程：
// 1. 创建一个隐藏的 iframe
// 2. 将渲染后的 HTML 注入 iframe
// 3. 注入 print.css 样式
// 4. 调用 iframe.contentWindow.print()
// 5. 打印完成后销毁 iframe
```

#### DOCX — docx.js

```typescript
// src/services/Exporter.ts (docx 部分)
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';

function exportToDocx(markdown: string, options: ExportOptions): Blob {
  const blocks = parseBlocks(markdown);
  const children = blocks.map((block) => {
    switch (block.type) {
      case 'heading':
        return new Paragraph({
          heading: mapHeadingLevel(block.meta?.level as number),
          children: [new TextRun(stripMarkdown(block.raw))],
        });
      case 'paragraph':
        return new Paragraph({ children: parseInlineFormatting(block.raw) });
      case 'codeBlock':
        return new Paragraph({
          style: 'Code',
          children: [new TextRun({ text: block.raw, font: 'Consolas' })],
        });
      // ... 其他块类型映射
      default:
        return new Paragraph({ children: [new TextRun(block.raw)] });
    }
  });

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBlob(doc);
}
```

#### XLSX/CSV — sheetjs

```typescript
// 仅提取 Markdown 中的表格内容导出
function exportToXlsx(markdown: string): Blob {
  const tables = extractTables(markdown);
  const wb = XLSX.utils.book_new();

  tables.forEach((table, i) => {
    const ws = XLSX.utils.aoa_to_sheet(table.rows);
    XLSX.utils.book_append_sheet(wb, ws, `Table_${i + 1}`);
  });

  return new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function exportToCsv(markdown: string): string {
  const tables = extractTables(markdown);
  return tables
    .map((table) =>
      table.rows
        .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
        .join('\n'),
    )
    .join('\n\n');
}
```

#### TXT — 去除语法

````typescript
function exportToTxt(markdown: string): string {
  // 去除 Markdown 语法标记，保留纯文本
  return markdown
    .replace(/#{1,6}\s/g, '') // 标题 #
    .replace(/\*\*(.+?)\*\*/g, '$1') // 加粗
    .replace(/\*(.+?)\*/g, '$1') // 斜体
    .replace(/`(.+?)`/g, '$1') // 行内代码
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // 链接 → 仅文本
    .replace(/!\[(.+?)\]\(.+?\)/g, '$1') // 图片 → alt 文本
    .replace(/^>\s/gm, '') // 引用
    .replace(/^[-*+]\s/gm, '') // 无序列表
    .replace(/^\d+\.\s/gm, '') // 有序列表
    .replace(/^- \[[ x]\] /gm, '') // 任务列表
    .replace(/```[\s\S]*?```/g, '') // 代码块
    .replace(/\n{3,}/g, '\n\n'); // 压缩多余空行
}
````

#### HTML — 自包含

```typescript
function exportToHtml(markdown: string): string {
  const bodyHtml = MarkdownRenderer.render(markdown);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Exported Note</title>
  <style>${EMBEDDED_CSS}</style>   /* 内嵌 markdown.css + highlight.js 主题 */
</head>
<body>
  <article class="markdown-body">
    ${bodyHtml}
  </article>
</body>
</html>`;
}
```

### 7.3 ExportOptions 类型

```typescript
interface ExportOptions {
  /** 是否包含 YAML frontmatter */
  includeFrontmatter: boolean;
  /** Wiki-link 处理方式 */
  wikiLinkHandling: 'keep-text' | 'convert-to-link' | 'remove';
  /** 代码块是否包含行号 */
  codeLineNumbers: boolean;
  /** 图片处理方式 */
  imageHandling: 'embed-base64' | 'keep-relative-path' | 'remove';
}
```

---

## 8. 分享流程

### 8.1 流程图

```
┌──────────────────────────────────────────────────────────────────┐
│                        分享入口 (Share Button)                    │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────┐
              │ Step 1: 选择分享格式      │
              │  ○ PDF (默认推荐)         │
              │  ○ Markdown 源文件        │
              │  ○ 自包含 HTML            │
              │  ○ 纯文本 TXT             │
              └───────────┬─────────────┘
                          │
                          ▼
              ┌─────────────────────────┐
              │ Step 2: 选择分享渠道      │
              │  ○ 系统分享面板           │
              │    (Native Sharing API)  │
              │  ○ 邮件 (mailto:)        │
              │  ○ 复制到剪贴板           │
              │  ○ 导出到本地             │
              └───────────┬─────────────┘
                          │
                          ▼
              ┌─────────────────────────┐
              │ Step 3: 生成文件          │
              │  根据选定格式调用         │
              │  对应 Export 方法         │
              │  生成 Blob 或临时文件     │
              └───────────┬─────────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
          ▼               ▼               ▼
  ┌──────────────┐ ┌────────────┐ ┌──────────────┐
  │系统分享面板   │ │ mailto:    │ │ 剪贴板/导出   │
  │              │ │            │ │              │
  │navigator.    │ │构建 mailto │ │clipboard.    │
  │share({       │ │URI + 附件  │ │write() 文本  │
  │  files: []   │ │本地路径    │ │或 showSave   │
  │})            │ │            │ │FilePicker    │
  └──────────────┘ └────────────┘ └──────────────┘
```

### 8.2 实现细节

```typescript
// src/services/ShareManager.ts
export class ShareManager {
  static async share(options: ShareOptions): Promise<void> {
    // Step 1 & 2 已在 UI 中完成，此处接收完整 options
    const blob = await this.generateFile(options);
    await this.dispatchToChannel(blob, options);
  }

  private static async generateFile(options: ShareOptions): Promise<File> {
    const { format, markdown, exportOptions } = options;
    switch (format) {
      case 'pdf':
        return await this.generatePdf(markdown, exportOptions);
      case 'md':
        return new File([markdown], options.fileName + '.md', { type: 'text/markdown' });
      case 'html':
        return new File([exportToHtml(markdown)], options.fileName + '.html', {
          type: 'text/html',
        });
      case 'txt':
        return new File([exportToTxt(markdown)], options.fileName + '.txt', { type: 'text/plain' });
    }
  }

  private static async dispatchToChannel(file: File, options: ShareOptions): Promise<void> {
    switch (options.channel) {
      case 'system':
        // Web Share API (Level 2) — 支持文件分享
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: options.fileName });
        } else {
          // 降级：下载文件
          await ShareManager.downloadFile(file);
        }
        break;

      case 'email':
        // 邮件：生成 mailto URI，附件路径提示
        // 实际附件由用户手动添加（mailto 不支持直接附件）
        const subject = encodeURIComponent(options.fileName);
        const body = encodeURIComponent(
          `请查收附件：${options.fileName}\n\n（请在邮件客户端中手动添加附件文件）`,
        );
        window.open(`mailto:?subject=${subject}&body=${body}`);
        // 同时触发系统下载已生成文件
        await ShareManager.downloadFile(file);
        break;

      case 'clipboard':
        // 复制内容到剪贴板
        if (options.format === 'md' || options.format === 'txt') {
          const text = await file.text();
          await navigator.clipboard.writeText(text);
        } else {
          // 复制文件到剪贴板（仅支持特定平台）
          await navigator.clipboard.write([new ClipboardItem({ [file.type]: file })]);
        }
        break;

      case 'local':
        // 导出到本地
        await ShareManager.downloadFile(file);
        break;
    }
  }

  private static async downloadFile(file: File): Promise<void> {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  }
}

interface ShareOptions {
  format: 'pdf' | 'md' | 'html' | 'txt';
  channel: 'system' | 'email' | 'clipboard' | 'local';
  markdown: string;
  fileName: string;
  exportOptions: ExportOptions;
}
```

### 8.3 安全与隐私约束

- 分享全程在本地完成，不经过任何服务器
- 生成的文件写入临时目录，分享完成后可清理
- 不记录分享历史
- 使用 `navigator.share()` 时，由 OS 的分享面板控制目标 App 访问权限

---

## 9. 文件系统抽象层

### 9.1 核心接口

```typescript
// src/services/IFileSystemService.ts

/** 目录条目 */
interface DirEntry {
  name: string; // 文件/文件夹名
  path: string; // 相对路径（使用 / 分隔）
  isDirectory: boolean;
  isFile: boolean;
  size?: number; // 文件大小（字节）
  mtime?: number; // 最后修改时间 (Unix ms)
}

/** 文件元数据 */
interface FileStat {
  size: number;
  mtime: number;
  isDirectory: boolean;
  isFile: boolean;
}

/** 文件变更事件 */
interface FileChangeEvent {
  type: 'created' | 'modified' | 'deleted' | 'renamed';
  path: string;
  oldPath?: string; // 仅 renamed 时
}

/** 文件系统抽象接口 */
interface IFileSystemService {
  // --- 基础文件操作 ---
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  renameFile(oldPath: string, newPath: string): Promise<void>;

  // --- 目录操作 ---
  createDirectory(path: string): Promise<void>;
  listDirectory(path: string): Promise<DirEntry[]>;

  // --- 元数据 ---
  statFile(path: string): Promise<FileStat>;

  // --- 文件监控 ---
  watch(rootPath: string, callback: (event: FileChangeEvent) => void): Promise<UnwatchFn>;

  unwatchAll(): Promise<void>;

  // --- 路径工具 ---
  /** 拼接路径。所有输入使用 /，返回使用 / */
  resolvePath(root: string, ...segments: string[]): string;

  /** 安全检查：确认 path 在 root 目录内 */
  isPathInNotebook(root: string, path: string): Promise<boolean>;

  // --- 笔记本管理 ---
  /** 选择笔记本根目录（Web 端弹出目录选择器） */
  openNotebook(): Promise<NotebookHandle>;

  /** 获取最近使用的笔记本列表 */
  getRecentNotebooks(): Promise<string[]>;
}

/** 笔记本句柄 */
interface NotebookHandle {
  rootPath: string; // 显示名称（Web 端为句柄名）
  rootHandle?: FileSystemDirectoryHandle; // Web 端目录句柄
}

/** 取消监听的函数 */
type UnwatchFn = () => void;
```

### 9.2 Web 实现 — WebFSAService

```typescript
// src/services/WebFSAService.ts

class WebFSAService implements IFileSystemService {
  private rootHandle: FileSystemDirectoryHandle | null = null;
  private rootPath: string = '';
  private useFallback: boolean = false; // 降级到 OPFS
  private opfsRoot: FileSystemDirectoryHandle | null = null;
  private watchers: Map<string, () => void> = new Map();

  constructor() {
    this.detectCapabilities();
  }

  private detectCapabilities(): void {
    // 检测 File System Access API 支持
    if ('showDirectoryPicker' in window) {
      this.useFallback = false;
    } else {
      // Firefox / Safari 不完整支持 → OPFS 降级
      this.useFallback = true;
      console.warn('File System Access API 不可用，降级到 OPFS 沙箱存储');
    }
  }

  async openNotebook(): Promise<NotebookHandle> {
    if (this.useFallback) {
      this.opfsRoot = await navigator.storage.getDirectory();
      return {
        rootPath: 'OPFS 本地存储',
        rootHandle: undefined,
      };
    }

    const handle = await window.showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'documents',
    });

    this.rootHandle = handle;
    this.rootPath = handle.name;

    return {
      rootPath: handle.name,
      rootHandle: handle,
    };
  }

  async readFile(path: string): Promise<string> {
    const fileHandle = await this.getFileHandle(path);
    const file = await fileHandle.getFile();
    return await file.text();
  }

  async writeFile(path: string, content: string): Promise<void> {
    // 原子写入策略：
    // 1. 创建临时文件 .{name}.tmp
    // 2. 写入内容
    // 3. 用 .tmp 的内容覆盖原文件（或创建新文件）
    const dirHandle = await this.getParentHandle(path);
    const fileName = this.getFileName(path);

    const tmpHandle = await dirHandle.getFileHandle(`.${fileName}.tmp`, { create: true });
    const writeable = await tmpHandle.createWritable();
    await writeable.write(content);
    await writeable.close();

    // 如果目标文件存在，先删除再创建（rename 无直接对应 API）
    try {
      await dirHandle.removeEntry(fileName);
    } catch {
      /* 文件可能不存在 */
    }

    // 复制 .tmp 内容到新文件
    const targetHandle = await dirHandle.getFileHandle(fileName, { create: true });
    const tmpFile = await tmpHandle.getFile();
    const targetWritable = await targetHandle.createWritable();
    await targetWritable.write(await tmpFile.arrayBuffer());
    await targetWritable.close();

    // 清理 .tmp
    await dirHandle.removeEntry(`.${fileName}.tmp`);
  }

  async listDirectory(path: string): Promise<DirEntry[]> {
    const dirHandle = await this.getDirectoryHandle(path);
    const entries: DirEntry[] = [];

    for await (const [name, handle] of (dirHandle as any).entries()) {
      entries.push({
        name,
        path: path ? `${path}/${name}` : name,
        isDirectory: handle.kind === 'directory',
        isFile: handle.kind === 'file',
      });
    }

    // 过滤：仅显示 .md 文件和文件夹
    return entries.filter((e) => e.isDirectory || e.name.endsWith('.md'));
  }

  async watch(rootPath: string, callback: (event: FileChangeEvent) => void): Promise<UnwatchFn> {
    // File System Access API 不原生支持目录监控
    // 使用轮询 + mtime 对比策略：
    // 每 2 秒检查目录树的 mtime 快照差异

    if (this.useFallback) {
      // OPFS 模式：无外部修改，不需要监控
      return () => {};
    }

    let snapshot = await this.buildMtimeSnapshot(rootPath);
    const intervalId = setInterval(async () => {
      const newSnapshot = await this.buildMtimeSnapshot(rootPath);
      const changes = this.diffSnapshot(snapshot, newSnapshot);
      for (const change of changes) {
        callback(change);
      }
      snapshot = newSnapshot;
    }, 2000);

    const unwatch = () => clearInterval(intervalId);
    this.watchers.set(rootPath, unwatch);
    return unwatch;
  }

  async isPathInNotebook(root: string, path: string): Promise<boolean> {
    // 简单前缀检查
    return path.startsWith(root) || path.startsWith(this.rootPath);
  }

  // --- 私有辅助 ---
  private async getFileHandle(path: string): Promise<FileSystemFileHandle> {
    // 从 rootHandle 逐级导航到目标文件
    // 使用 getFileHandle 递归
  }

  private async getDirectoryHandle(path: string): Promise<FileSystemDirectoryHandle> {
    // 类似 getFileHandle
  }

  private async getParentHandle(path: string): Promise<FileSystemDirectoryHandle> {
    const parentPath = path.substring(0, path.lastIndexOf('/'));
    return parentPath ? await this.getDirectoryHandle(parentPath) : this.rootHandle!;
  }

  private getFileName(path: string): string {
    return path.substring(path.lastIndexOf('/') + 1);
  }

  resolvePath(root: string, ...segments: string[]): string {
    return [root, ...segments].filter(Boolean).join('/');
  }
}
```

### 9.3 Tauri 实现 — TauriIPCService

```typescript
// src/services/TauriIPCService.ts
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

class TauriIPCService implements IFileSystemService {
  private rootPath: string = '';
  private unlistenFns: UnlistenFn[] = [];

  async openNotebook(): Promise<NotebookHandle> {
    // Tauri 使用 rfd (Rust File Dialog) 打开文件夹选择器
    const path = await invoke<string>('dialog_open_folder');
    this.rootPath = path;

    return { rootPath: path };
  }

  async readFile(path: string): Promise<string> {
    return invoke<string>('fs_read_file', { path });
  }

  async writeFile(path: string, content: string): Promise<void> {
    return invoke('fs_write_file', { path, content });
  }

  async deleteFile(path: string): Promise<void> {
    return invoke('fs_delete_file', { path });
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    return invoke('fs_rename_file', { oldPath, newPath });
  }

  async createDirectory(path: string): Promise<void> {
    return invoke('fs_create_directory', { path });
  }

  async listDirectory(path: string): Promise<DirEntry[]> {
    return invoke<DirEntry[]>('fs_read_directory', { path });
  }

  async statFile(path: string): Promise<FileStat> {
    return invoke<FileStat>('fs_stat_file', { path });
  }

  async watch(rootPath: string, callback: (event: FileChangeEvent) => void): Promise<UnwatchFn> {
    // 启动 Rust 侧 notify 监控
    await invoke('fs_start_watching', { rootPath });

    // 监听 Tauri Events
    const unlisten1 = await listen<string>('file-created', (event) => {
      callback({ type: 'created', path: event.payload });
    });
    const unlisten2 = await listen<string>('file-changed', (event) => {
      callback({ type: 'modified', path: event.payload });
    });
    const unlisten3 = await listen<string>('file-deleted', (event) => {
      callback({ type: 'deleted', path: event.payload });
    });

    const unwatch = () => {
      unlisten1();
      unlisten2();
      unlisten3();
      invoke('fs_stop_watching');
    };

    this.unlistenFns.push(unwatch);
    return unwatch;
  }

  async unwatchAll(): Promise<void> {
    for (const fn of this.unlistenFns) fn();
    this.unlistenFns = [];
    await invoke('fs_stop_watching');
  }

  async isPathInNotebook(root: string, path: string): Promise<boolean> {
    return invoke<boolean>('fs_validate_path', { root, path });
  }

  async getRecentNotebooks(): Promise<string[]> {
    return invoke<string[]>('system_get_notebooks_mru');
  }

  resolvePath(root: string, ...segments: string[]): string {
    // 使用统一的 / 分隔符
    return [root, ...segments].filter(Boolean).join('/');
  }
}
```

### 9.4 服务注入

```typescript
// src/main.ts — 应用初始化时选择实现
import { IFileSystemService } from '@/services/IFileSystemService';
import { WebFSAService } from '@/services/WebFSAService';
import { TauriIPCService } from '@/services/TauriIPCService';

function createFileSystemService(): IFileSystemService {
  // 检测运行环境
  if ('__TAURI__' in window) {
    return new TauriIPCService();
  } else {
    return new WebFSAService();
  }
}

// 注入到 Pinia Store 或 provide/inject
const fsService = createFileSystemService();
app.provide('fsService', fsService);
```

### 9.5 Mock 实现（开发阶段）

开发阶段使用 Mock 实现，内存虚拟文件树：

```typescript
// src/services/MockFSService.ts
class MockFSService implements IFileSystemService {
  private virtualFS: Map<string, string> = new Map(); // path → content
  private rootPath: string = '/mock-notebook';

  constructor() {
    // 预置示例文件
    this.virtualFS.set('README.md', '# Welcome to Mock Notebook\n\n...');
    this.virtualFS.set('notes/meeting.md', '# 会议纪要\n\n...');
  }

  async readFile(path: string): Promise<string> {
    await this.delay(50 + Math.random() * 150); // 模拟延迟
    const content = this.virtualFS.get(path);
    if (content === undefined) throw new Error(`文件不存在: ${path}`);
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.delay(30 + Math.random() * 100);
    this.virtualFS.set(path, content);
  }

  async deleteFile(path: string): Promise<void> {
    await this.delay(20);
    if (!this.virtualFS.has(path)) throw new Error(`文件不存在: ${path}`);
    this.virtualFS.delete(path);
  }

  // ... 其他方法类似实现

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

---

## 10. 数据流图

### 10.1 打开笔记本流程

```
用户点击 "打开笔记本"
        │
        ▼
┌───────────────────┐
│ NotebookSelector   │
│ .openNotebook()    │
└────────┬──────────┘
         │
         ▼
┌───────────────────────────┐
│ IFileSystemService        │
│ .openNotebook()           │
│                           │
│ Web: showDirectoryPicker()│
│ Tauri: rfd folder dialog  │
└────────┬──────────────────┘
         │
         ▼
┌───────────────────┐
│ useNotebookStore   │
│ .openNotebook()    │
│                   │
│ 1. 设置 rootPath   │
│ 2. 保存 MRU        │
│ 3. 扫描文件树      │
└────────┬──────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌──────────┐
│ 扫描    │ │ 加载索引  │
│ .md 文件│ │ .markluck │
│         │ │ _index.json│
└────┬────┘ └────┬─────┘
     │           │
     ▼           ▼
┌──────────┐ ┌────────────────┐
│ 构建     │ │ useIndexStore  │
│ FileTree │ │ .loadIndex()   │
│ (Vue 渲染)│ │ 缓存到 Pinia   │
└──────────┘ └────────────────┘
     │
     ▼
┌──────────────────┐
│ SidebarLeft 渲染  │
│ FileTree 组件     │
└──────────────────┘
```

### 10.2 编辑与保存流程

```
用户在编辑器中输入
        │
        ▼
┌───────────────────────┐
│ CodeMirror 6          │
│ dispatch(transaction) │
└────────┬──────────────┘
         │
         ▼
┌───────────────────────────┐
│ ViewPlugin.update()       │
│                           │
│ 1. formatAutoDetector     │  ← 检测新闭环语法块 → 切换渲染模式
│ 2. blockDecorator         │  ← 重建标记点
│ 3. throttledParser(150ms) │  ← 防抖重解析
└────────┬──────────────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌──────────┐
│ 更新    │ │ 更新导航树│
│ Markdown│ │ Headings │
│ Block[] │ │          │
└────┬───┘ └────┬─────┘
     │          │
     ▼          ▼
┌──────────────┐ ┌─────────────────┐
│useEditorStore│ │ NavTree 组件    │
│.setContent() │ │ 重新渲染         │
│ isDirty=true │ └─────────────────┘
└──────┬───────┘
       │
       ▼
┌──────────────────────┐
│ useDebouncedSave     │  ← 2 秒防抖自动保存
│ (Composable)         │
└────────┬─────────────┘
         │
         ▼  (2 秒无输入后)
┌───────────────────────┐
│ useEditorStore        │
│ .saveNote()           │
│                       │
│ 1. 获取 content       │
│ 2. 调用 fs writeFile  │
│ 3. 更新 savedContent  │
│ 4. isDirty = false    │
│ 5. 更新 .markluck     │
│    _index.json        │
│    (增量解析 + 反链)   │
└────────┬──────────────┘
         │
         ▼
┌───────────────────────────────┐
│ IFileSystemService            │
│ .writeFile(path, content)     │
│                               │
│ Web: FileHandle.createWritable│
│ Tauri: invoke('fs_write_file')│
│   → Rust: atomic .tmp→rename  │
└────────┬──────────────────────┘
         │
         ▼
┌───────────────────┐
│ StatusBar 更新     │
│ "已保存 14:32"    │
└───────────────────┘
```

### 10.3 搜索流程

```
用户输入搜索词 / Ctrl+Shift+F
        │
        ▼
┌───────────────────────┐
│ SearchDialog.vue      │
│ query = "tag:js 闭包" │
└────────┬──────────────┘
         │
         ▼
┌───────────────────────────┐
│ searchParser(query)       │  ← 解析搜索语法
│                           │
│ 输入: "tag:js 闭包"       │
│ 输出: {                   │
│   fulltext: "闭包",       │
│   tags: ["js"],           │
│   dateRange: null,        │
│   folder: null,           │
│   regexp: null            │
│ }                         │
└────────┬──────────────────┘
         │
         ▼
┌───────────────────────────────┐
│ useSearchStore.search()       │
│                               │
│ Web 路径 (minisearch):        │
│  1. 从 useIndexStore 获取     │
│     所有 .md 文件文本缓存     │
│  2. 全文搜索: minisearch      │
│  3. 标签过滤: filter by tags  │
│  4. 日期范围: filter by date  │
│  5. 文件夹: filter by folder  │
│  6. 计算相关度 + 排序         │
│                               │
│ Tauri 路径 (tantivy):         │
│  1. invoke('index_search')    │
│  2. Rust 侧 tantivy 全文搜索  │
│  3. 前端做标签/日期/文件夹    │
│     二次过滤                  │
└────────┬──────────────────────┘
         │
         ▼
┌───────────────────────┐
│ SearchResults.vue     │
│ 渲染搜索结果列表       │
│ 匹配关键字高亮         │
│ 上下文片段展示         │
└───────────────────────┘
         │
         ▼ (点击结果)
┌───────────────────────────────┐
│ useNotebookStore.openNote()   │
│ 打开目标笔记，跳转到匹配位置   │
└───────────────────────────────┘
```

### 10.4 导出流程

```
用户在 ExportDialog 选择格式和选项
        │
        ▼
┌───────────────────────┐
│ ExportDialog.vue      │
│ emit('export', {      │
│   format: 'docx',     │
│   ...options,         │
│   markdown: content   │
│ })                    │
└────────┬──────────────┘
         │
         ▼
┌───────────────────────────────┐
│ Exporter.export(options)      │
│                               │
│ ┌─ format === 'pdf' ────────┐ │
│ │ window.print() + print.css│ │
│ └───────────────────────────┘ │
│ ┌─ format === 'docx' ───────┐ │
│ │ docx.js → Blob            │ │
│ └───────────────────────────┘ │
│ ┌─ format === 'xlsx' ───────┐ │
│ │ extractTables → sheetjs   │ │
│ └───────────────────────────┘ │
│ ┌─ format === 'csv' ────────┐ │
│ │ extractTables → CSV str   │ │
│ └───────────────────────────┘ │
│ ┌─ format === 'txt' ────────┐ │
│ │ stripMarkdown()           │ │
│ └───────────────────────────┘ │
│ ┌─ format === 'html' ───────┐ │
│ │ 渲染 + 自包含 HTML 包装    │ │
│ └───────────────────────────┘ │
└────────┬──────────────────────┘
         │
         ▼
┌───────────────────────────────┐
│ 文件写入                      │
│                               │
│ Web: File System Access API   │
│      → showSaveFilePicker()   │
│                               │
│ Tauri: invoke('export_generate')│
│        → Rust 侧写文件        │
└────────┬──────────────────────┘
         │
         ▼
┌───────────────────┐
│ 提示：导出成功     │
│ "已保存到 ... 路径"│
└───────────────────┘
```

### 10.5 分享流程

```
用户点击分享按钮
        │
        ▼
┌───────────────────────┐
│ ShareButton.vue       │
└────────┬──────────────┘
         │
         ▼
┌───────────────────────┐
│ Step 1: FormatPicker  │
│ 选择格式               │
│ ○ PDF (默认)          │
│ ○ Markdown            │
│ ○ HTML                │
│ ○ TXT                 │
└────────┬──────────────┘
         │
         ▼
┌───────────────────────┐
│ Step 2: ChannelPicker │
│ 选择渠道               │
│ ○ 系统分享面板         │
│ ○ 邮件                 │
│ ○ 复制到剪贴板         │
│ ○ 保存到本地           │
└────────┬──────────────┘
         │
         ▼
┌───────────────────────────────┐
│ ShareManager.share(options)   │
│                               │
│ 1. 调用 Exporter 生成 File    │
│ 2. 根据 channel 分发:         │
│    - system: navigator.share()│
│    - email: mailto: + 下载    │
│    - clipboard: clipboard API │
│    - local: download trigger  │
└───────────────────────────────┘
         │
         ▼
┌───────────────────┐
│ 完成反馈           │
│ (渠道确定后操作)   │
└───────────────────┘
```

---

## 附录 A：关键 Data Type 汇总

```typescript
// ===== 笔记相关 =====
type NotePath = string; // 相对路径，使用 / 分隔

interface NoteContent {
  path: NotePath;
  raw: string;
  frontmatter?: Record<string, unknown>;
  blocks: MarkdownBlock[];
}

// ===== 编辑器相关 =====
interface MarkdownBlock {
  index: number;
  type: BlockType;
  raw: string;
  from: number;
  to: number;
  isValid: boolean;
  meta?: Record<string, unknown>;
}

type BlockMode = 'source' | 'render';

// ===== 文件系统相关 =====
interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  size?: number;
  mtime?: number;
}

interface FileStat {
  size: number;
  mtime: number;
  isDirectory: boolean;
  isFile: boolean;
}

type FileChangeEvent = {
  type: 'created' | 'modified' | 'deleted' | 'renamed';
  path: string;
  oldPath?: string;
};

// ===== 搜索相关 =====
interface ParsedQuery {
  fulltext: string;
  regexp?: RegExp;
  tags: string[];
  dateRange?: { from: Date; to: Date };
  folder?: string;
}

interface SearchResult {
  notePath: string;
  noteTitle: string;
  snippet: string;
  matchType: 'title' | 'content' | 'filename';
  relevanceScore: number;
  positions: { from: number; to: number }[];
}

// ===== 导出相关 =====
interface ExportOptions {
  includeFrontmatter: boolean;
  wikiLinkHandling: 'keep-text' | 'convert-to-link' | 'remove';
  codeLineNumbers: boolean;
  imageHandling: 'embed-base64' | 'keep-relative-path' | 'remove';
}

// ===== 分享相关 =====
interface ShareOptions {
  format: 'pdf' | 'md' | 'html' | 'txt';
  channel: 'system' | 'email' | 'clipboard' | 'local';
  markdown: string;
  fileName: string;
  exportOptions: ExportOptions;
}
```

---

## 附录 B：依赖清单

### 前端 (package.json)

| 包名                      | 版本            | 用途              |
| ------------------------- | --------------- | ----------------- |
| vue                       | ^3.4            | 前端框架          |
| vue-router                | ^4              | 路由              |
| pinia                     | ^2              | 状态管理          |
| @codemirror/view          | ^6              | CodeMirror 核心   |
| @codemirror/state         | ^6              | CodeMirror 状态   |
| @codemirror/lang-markdown | ^6              | Markdown 语法支持 |
| @codemirror/commands      | ^6              | 基础快捷键        |
| @codemirror/search        | ^6              | 编辑器内搜索      |
| marked                    | ^14             | Markdown 解析     |
| dompurify                 | ^3              | XSS 防护          |
| highlight.js              | ^11             | 代码语法高亮      |
| minisearch                | ^7              | Web 全文搜索      |
| docx                      | ^9              | DOCX 导出         |
| xlsx                      | ^0.20 (sheetjs) | XLSX 导出         |
| @tauri-apps/api           | ^2              | Tauri IPC 前端    |

### Rust (Cargo.toml) — Phase 4 启用

| Crate               | 用途  |
| ------------------- | ----- | --------------------- |
| tauri               | ^2    | Tauri 框架            |
| tauri-plugin-dialog | ^2    | 文件/文件夹选择对话框 |
| tauri-plugin-fs     | ^2    | 文件系统插件          |
| notify              | ^6    | 文件系统监控          |
| tantivy             | ^0.22 | 全文检索引擎          |
| serde / serde_json  | —     | JSON 序列化           |
| chrono              | —     | 日期时间处理          |
| encoding_rs         | —     | 文件编码检测          |

---

## 附录 C：架构约束速查

| 约束              | 详情                                                                               |
| ----------------- | ---------------------------------------------------------------------------------- |
| 文件 = 唯一数据源 | 笔记内容永远从 `.md` 文件读取，索引从文件派生                                      |
| 前端先行          | Phase 1-3 纯 Web，I/O 抽象确保平滑迁移                                             |
| 服务抽象          | `IFileSystemService` 是唯一文件访问入口，业务代码不可直接操作 DOM API 或 Tauri IPC |
| XSS 阻断          | marked → DOMPurify → DOM，不可跳过 DOMPurify                                       |
| 路径规范          | 前端统一使用 `/` 分隔符，跨平台转换在 Rust 侧处理                                  |
| 原子写入          | 所有文件写入使用 `.tmp` + `rename` 两步完成                                        |
| 150ms 防抖        | 文件监控、编辑器解析、搜索输入均使用同一防抖阈值                                   |
| 性能上限          | 文件 > 5MB 降级纯文本，文件树 > 10000 条目启用虚拟滚动                             |
| 零依赖 PDF        | 仅使用 `window.print()`，不引入任何 PDF 生成库                                     |
| 离线可用          | 所有功能在无网络环境下 100% 可用（PWA Service Worker 缓存全量静态资源）            |
