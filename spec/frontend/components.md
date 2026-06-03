# MarkLuck 组件规格文档 (Component Specification)

> 版本：v1.0 | 日期：2026-06-03 | 状态：Phase 0 奠基

---

## 目录

1. [概述](#1-概述)
2. [App.vue — 根组件](#2-appvue--根组件)
3. [AppLayout.vue — 三栏布局容器](#3-applayoutvue--三栏布局容器)
4. [FileSidebar.vue — 左侧文件树面板](#4-filesidebarvue--左侧文件树面板)
5. [NotebookSelector.vue — 笔记本选择器](#5-notebookselectorvue--笔记本选择器)
6. [FileTree.vue — 文件树](#6-filetreevue--文件树)
7. [FileTreeNode.vue — 单个树节点](#7-filetreenodevue--单个树节点)
8. [RecentNotes.vue — 最近编辑列表](#8-recentnotesvue--最近编辑列表)
9. [EditorArea.vue — 中间编辑区](#9-editorareavue--中间编辑区)
10. [FormatToolbar.vue — 格式工具栏](#10-formattoolbarvue--格式工具栏)
11. [ToolbarButton.vue — 单个工具栏按钮](#11-toolbarbuttonvue--单个工具栏按钮)
12. [MarkdownEditor.vue — CodeMirror 6 编辑器封装](#12-markdowneditorvue--codemirror-6-编辑器封装)
13. [BlockMarker.vue — 语法块标记](#13-blockmarkervue--语法块标记)
14. [RestoreButton.vue — 还原格式按钮](#14-restorebuttonvue--还原格式按钮)
15. [StatusBar.vue — 状态栏](#15-statusbarvue--状态栏)
16. [NavTree.vue — 右侧导航树](#16-navtreevue--右侧导航树)
17. [NavTreeNode.vue — 单个导航节点](#17-navtreenodevue--单个导航节点)
18. [SearchPanel.vue — 搜索面板](#18-searchpanelvue--搜索面板)
19. [SearchInput.vue — 搜索输入框](#19-searchinputvue--搜索输入框)
20. [SearchResultList.vue — 搜索结果列表](#20-searchresultlistvue--搜索结果列表)
21. [SearchResultItem.vue — 单条搜索结果](#21-searchresultitemvue--单条搜索结果)
22. [BacklinksPanel.vue — 反向链接面板](#22-backlinkspanelvue--反向链接面板)
23. [BacklinkItem.vue — 单条反向链接](#23-backlinkitemvue--单条反向链接)
24. [TagPanel.vue — 标签面板](#24-tagpanelvue--标签面板)
25. [ExportDialog.vue — 导出对话框](#25-exportdialogvue--导出对话框)
26. [ShareDialog.vue — 分享对话框](#26-sharedialogvue--分享对话框)
27. [TemplateDialog.vue — 模板选择对话框](#27-templatedialogvue--模板选择对话框)
28. [SettingsPanel.vue — 设置面板](#28-settingspanelvue--设置面板)
29. [common/IconButton.vue — 通用图标按钮](#29-commoniconbuttonvue--通用图标按钮)
30. [common/Dropdown.vue — 通用下拉菜单](#30-commondropdownvue--通用下拉菜单)
31. [common/Modal.vue — 通用模态框](#31-commonmodalvue--通用模态框)
32. [common/Toast.vue — 通用消息提示](#32-commontoastvue--通用消息提示)
33. [common/ContextMenu.vue — 通用右键菜单](#33-commoncontextmenuvue--通用右键菜单)
34. [附录：组件间事件总线约定](#附录组件间事件总线约定)

---

## 1. 概述

本文档定义了 MarkLuck 前端所有 Vue 3 组件的完整接口契约。每个组件严格遵循此规格实现，确保组件间松耦合、可替换、可测试。

### 1.1 类型约定

```typescript
// ===== 复用类型（定义于 src/types/ 各模块） =====

// 笔记路径（统一使用 / 分隔的相对路径）
type NotePath = string;

// 文件/文件夹节点
interface FileTreeNode {
  id: string; // 唯一标识（相对路径哈希）
  name: string; // 文件/文件夹名
  path: string; // 相对路径（使用 / 分隔）
  isDirectory: boolean;
  children?: FileTreeNode[];
  isOpen?: boolean; // 仅文件夹：展开/折叠
}

// 标签页条目
interface TabItem {
  id: string; // 标签页 ID
  notePath: string; // 笔记相对路径
  title: string; // 显示标题（文件名或 H1）
  isDirty: boolean; // 是否有未保存修改
  isLoading: boolean; // 加载中
}

// 语法块类型
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

// 语法块
interface MarkdownBlock {
  index: number;
  type: BlockType;
  raw: string;
  from: number;
  to: number;
  isValid: boolean;
  meta?: Record<string, unknown>;
}

// 块显示模式
type BlockMode = 'source' | 'render';

// 标题节点（导航树）
interface HeadingItem {
  id: string;
  level: number; // 1-6
  text: string;
  lineNumber: number;
  children: HeadingItem[];
}

// 搜索结果
interface SearchResult {
  notePath: string;
  noteTitle: string;
  snippet: string;
  matchType: 'title' | 'content' | 'filename';
  relevanceScore: number;
  positions: { from: number; to: number }[];
}

// 反向链接条目
interface BacklinkEntry {
  sourcePath: string;
  sourceTitle: string;
  context: string; // 引用处的上下文片段
  lineNumber: number;
}

// 标签条目
interface TagEntry {
  tag: string;
  count: number;
  notes: string[];
}

// 最近笔记条目
interface RecentNoteEntry {
  path: string;
  title: string;
  lastOpenedAt: number; // Unix ms
}

// 工具栏按钮配置
interface ToolbarItemConfig {
  type: BlockType;
  icon: string;
  label: string; // 国际化 key
  shortcut: string; // 快捷键提示文本（如 'Ctrl+B'）
}

// 导出选项
interface ExportOptions {
  format: 'pdf' | 'docx' | 'xlsx' | 'csv' | 'txt' | 'html';
  includeFrontmatter: boolean;
  wikiLinkHandling: 'keep-text' | 'convert-to-link' | 'remove';
  codeLineNumbers: boolean;
  imageHandling: 'embed-base64' | 'keep-relative-path' | 'remove';
}

// 分享选项
interface ShareOptions {
  format: 'pdf' | 'md' | 'html' | 'txt';
  channel: 'system' | 'email' | 'clipboard' | 'local';
  fileName: string;
}

// 模板条目
interface TemplateItem {
  id: string;
  name: string;
  description: string;
  content: string; // 原始模板内容（含占位符）
  isBuiltin: boolean; // 是否内置模板
}

// 主题模式
type ThemeMode = 'light' | 'dark' | 'system';
```

### 1.2 Pinia Store 引用约定

组件通过 `useXxxStore()` 获取全局状态，本文档不将 Store 作为 Props 传递（Pinia 自动注入）。仅在需要高可测试性或组件被多 Store 实例化时，才将 Store 作为 Prop 传入。

```typescript
// 主要 Store（定义于 src/stores/）
// useNotebookStore  — 笔记本/文件树/标签页
// useEditorStore    — 编辑器状态/块级编辑/导航树
// useSearchStore    — 搜索状态/结果
// useIndexStore     — 索引数据缓存/反链/标签
// useThemeStore     — 主题模式/代码高亮主题
```

### 1.3 状态分类约定

| 状态         | 说明                                        |
| ------------ | ------------------------------------------- |
| **Loading**  | 数据正在加载中，显示骨架屏或加载指示器      |
| **Empty**    | 数据加载完成但结果集为空，显示引导性空状态  |
| **Error**    | 数据加载失败，显示错误信息和重试按钮        |
| **Normal**   | 正常展示数据                                |
| **Disabled** | 组件因权限/上下文不可用（如无笔记本打开时） |

---

## 2. App.vue — 根组件

**文件路径**: `src/App.vue`

**职责**: 应用程序根组件，负责全局 Provider 注入、路由出口、全局弹窗/Toast 的挂载点。

### 2.1 Props

无（根组件）。

### 2.2 Events

无。

### 2.3 Slots

| 名称        | 说明                            |
| ----------- | ------------------------------- |
| _(default)_ | 路由出口 `<router-view />` 占位 |

### 2.4 States

| 状态                 | 处理方式                                                         |
| -------------------- | ---------------------------------------------------------------- |
| **Loading** (启动)   | 显示全局启动加载画面，等待 Pinia hydration                       |
| **Error** (致命错误) | 显示全屏错误页面（如 IndexedDB 不可用、Service Worker 注册失败） |
| **Normal**           | 渲染 AppLayout + 路由内容                                        |

### 2.5 关键行为

- 在 `onMounted` 中检测运行环境（Tauri / Web），初始化 `IFileSystemService`
- 通过 `provide('fsService', fsService)` 注入文件系统服务
- 挂载 SearchPanel（全局搜索浮层，通过 Teleport 到 body）
- 挂载 Toast 容器（全局消息提示）
- 挂载 ContextMenu 容器

---

## 3. AppLayout.vue — 三栏布局容器

**文件路径**: `src/components/layout/AppLayout.vue`

**职责**: 桌面端三栏布局（左侧文件栏 / 中间编辑区 / 右侧导航栏），移动端自适应切换为单栏 + 抽屉模式。管理各面板的折叠/展开状态。

### 3.1 Props

| 名称                | 类型      | 必填 | 默认值 | 说明                                   |
| ------------------- | --------- | :--: | ------ | -------------------------------------- |
| `showLeftSidebar`   | `boolean` |  否  | `true` | 是否显示左侧文件边栏（桌面端默认展开） |
| `showRightSidebar`  | `boolean` |  否  | `true` | 是否显示右侧导航树面板                 |
| `leftSidebarWidth`  | `number`  |  否  | `260`  | 左侧栏宽度（px），可拖拽调整           |
| `rightSidebarWidth` | `number`  |  否  | `240`  | 右侧栏宽度（px），可拖拽调整           |
| `minSidebarWidth`   | `number`  |  否  | `180`  | 侧边栏最小宽度（px）                   |

### 3.2 Events

| 名称                       | 载荷类型  | 说明                     |
| -------------------------- | --------- | ------------------------ |
| `update:showLeftSidebar`   | `boolean` | 左侧栏折叠/展开切换      |
| `update:showRightSidebar`  | `boolean` | 右侧栏折叠/展开切换      |
| `update:leftSidebarWidth`  | `number`  | 用户拖拽调整左侧栏宽度后 |
| `update:rightSidebarWidth` | `number`  | 用户拖拽调整右侧栏宽度后 |

### 3.3 Slots

| 名称                   | 说明                         |
| ---------------------- | ---------------------------- |
| `left-sidebar`         | 左侧栏内容（FileSidebar）    |
| `editor`               | 中央编辑区内容（EditorArea） |
| `right-sidebar`        | 右侧栏内容（NavTree）        |
| `left-sidebar-toggle`  | 自定义左侧栏折叠按钮         |
| `right-sidebar-toggle` | 自定义右侧栏折叠按钮         |

### 3.4 States

| 状态                    | 处理方式                                            |
| ----------------------- | --------------------------------------------------- |
| **Desktop** (>= 1024px) | 三栏并排，侧边栏可折叠/调整宽度                     |
| **Tablet** (768-1023px) | 左侧栏折叠为图标模式（仅显示关键操作图标）          |
| **Mobile** (< 768px)    | 单栏显示编辑区，侧边栏变为抽屉式（从左侧/右侧滑出） |

### 3.5 关键行为

- 监听 `window.resize`，根据断点自动切换布局模式
- 侧栏宽度拖拽：在分隔线上 `mousedown` 启动拖拽，`mousemove` 实时更新宽度（限制 min/max），`mouseup` 释放
- 移动端抽屉：通过 CSS `transform: translateX()` 实现动画滑入/滑出，背景半透明遮罩
- 宽度偏好存储到 `localStorage`，下次启动恢复

---

## 4. FileSidebar.vue — 左侧文件树面板

**文件路径**: `src/components/file-tree/FileSidebar.vue`

**职责**: 左侧栏面板的顶层组件，组合笔记本选择器、文件树、最近编辑列表。管理三者之间的布局和滚动协调。

### 4.1 Props

| 名称        | 类型      | 必填 | 默认值  | 说明                              |
| ----------- | --------- | :--: | ------- | --------------------------------- |
| `collapsed` | `boolean` |  否  | `false` | 面板是否折叠（由 AppLayout 控制） |

### 4.2 Events

| 名称               | 载荷类型                 | 说明                                 |
| ------------------ | ------------------------ | ------------------------------------ |
| `note-selected`    | `NotePath`               | 用户在文件树或最近列表中选择了笔记   |
| `notebook-changed` | `void`                   | 笔记本切换完成                       |
| `create-note`      | `{ parentPath: string }` | 请求新建笔记（传递给 NotebookStore） |
| `create-folder`    | `{ parentPath: string }` | 请求新建文件夹                       |

### 4.3 Slots

| 名称     | 说明                                   |
| -------- | -------------------------------------- |
| `header` | 面板顶部区域（默认：NotebookSelector） |
| `tree`   | 文件树区域（默认：FileTree）           |
| `footer` | 面板底部区域（默认：RecentNotes）      |

### 4.4 States

| 状态           | 处理方式                                                                      |
| -------------- | ----------------------------------------------------------------------------- |
| **NoNotebook** | 无笔记本打开 → 显示"打开笔记本"按钮（调用 `NotebookSelector.openNotebook()`） |
| **Loading**    | 文件树加载中 → 显示骨架屏（3-5 个占位行）                                     |
| **Empty**      | 笔记本为空（无 .md 文件）→ 显示"创建第一篇笔记"引导提示                       |
| **Error**      | 文件树加载失败 → 显示错误信息 + "重试"按钮                                    |
| **Normal**     | 正常显示文件树和最近列表                                                      |

### 4.5 关键行为

- 不直接操作 Store，通过事件向父级（AppLayout → App）传递用户意图
- 内部使用 `useNotebookStore()` 读取文件树数据
- 面板折叠时仅显示窄图标条（笔记本图标 + 最近图标）

---

## 5. NotebookSelector.vue — 笔记本选择器

**文件路径**: `src/components/file-tree/NotebookSelector.vue`

**职责**: 显示当前笔记本名称，提供切换笔记本和历史笔记本列表。首次启动引导用户选择笔记本文件夹。

### 5.1 Props

| 名称              | 类型       | 必填 | 默认值  | 说明                                       |
| ----------------- | ---------- | :--: | ------- | ------------------------------------------ |
| `notebookName`    | `string`   |  否  | `''`    | 当前笔记本名称（从 useNotebookStore 读取） |
| `recentNotebooks` | `string[]` |  否  | `[]`    | 最近使用的笔记本路径列表                   |
| `compact`         | `boolean`  |  否  | `false` | 紧凑模式（仅显示名称，隐藏下拉箭头）       |

### 5.2 Events

| 名称              | 载荷类型                             | 说明                                                                 |
| ----------------- | ------------------------------------ | -------------------------------------------------------------------- |
| `open-notebook`   | `void`                               | 请求打开笔记本选择对话框（调用 `IFileSystemService.openNotebook()`） |
| `switch-notebook` | `string`                             | 切换到指定的笔记本路径                                               |
| `notebook-opened` | `{ rootPath: string; name: string }` | 笔记本已成功打开                                                     |

### 5.3 Slots

| 名称        | 说明              |
| ----------- | ----------------- |
| _(default)_ | 替换整个选择器 UI |

### 5.4 States

| 状态           | 处理方式                                                         |
| -------------- | ---------------------------------------------------------------- |
| **NoNotebook** | 未打开笔记本 → 显示 "选择笔记文件夹..." 按钮（主色调，引导操作） |
| **Loading**    | 正在扫描笔记本 → 显示旋转加载动画 + "正在扫描..."                |
| **Error**      | 打开失败（权限拒绝 / 路径无效）→ 显示错误信息 + "重新选择"       |
| **Normal**     | 显示笔记本名称 + 下拉箭头（点击展开最近笔记本列表）              |

### 5.5 关键行为

- 在下拉菜单中显示最近笔记本列表（MRU 排序），当前笔记本高亮
- 点击"打开其他文件夹"触发 `open-notebook` 事件
- Web 端调用 `window.showDirectoryPicker()`，Tauri 端通过 IPC 调用 `dialog_open_folder`

---

## 6. FileTree.vue — 文件树

**文件路径**: `src/components/file-tree/FileTree.vue`

**职责**: 渲染笔记本内所有 `.md` 文件和子文件夹的树状结构。支持虚拟滚动处理大量文件（> 10000 条目）。

### 6.1 Props

| 名称             | 类型             | 必填 | 默认值 | 说明                                      |
| ---------------- | ---------------- | :--: | ------ | ----------------------------------------- |
| `nodes`          | `FileTreeNode[]` |  是  | —      | 文件树根节点数组                          |
| `activeNotePath` | `string \| null` |  否  | `null` | 当前选中的笔记路径（高亮）                |
| `virtualScroll`  | `boolean`        |  否  | `true` | 是否启用虚拟滚动（条目 > 500 时强制启用） |
| `itemHeight`     | `number`         |  否  | `32`   | 每行高度（px），虚拟滚动需要              |
| `indentWidth`    | `number`         |  否  | `20`   | 每级缩进宽度（px）                        |

### 6.2 Events

| 名称            | 载荷类型                                                    | 说明                    |
| --------------- | ----------------------------------------------------------- | ----------------------- |
| `select-note`   | `NotePath`                                                  | 用户点击 `.md` 文件     |
| `toggle-folder` | `{ path: string; isOpen: boolean }`                         | 用户展开/折叠文件夹     |
| `context-menu`  | `{ path: string; isDirectory: boolean; event: MouseEvent }` | 右键点击文件/文件夹     |
| `drop`          | `{ sourcePath: string; targetPath: string }`                | 拖拽移动文件/文件夹完成 |

### 6.3 Slots

| 名称           | 说明                                            |
| -------------- | ----------------------------------------------- |
| `context-menu` | 自定义右键菜单内容（默认使用 ContextMenu 组件） |
| `drag-preview` | 自定义拖拽预览                                  |

### 6.4 States

| 状态        | 处理方式                                                     |
| ----------- | ------------------------------------------------------------ |
| **Loading** | 正在扫描文件系统 → 显示骨架屏（树状结构占位）                |
| **Empty**   | 笔记本无任何 `.md` 文件 → 显示 "📄 还没有笔记，创建第一篇吧" |
| **Error**   | 扫描失败 → 显示 "⚠ 无法读取文件列表" + "重试"按钮            |
| **Normal**  | 渲染文件树                                                   |

### 6.5 关键行为

- 虚拟滚动：当 `nodes` 总数 > 500 时，使用 `vue-virtual-scroller` 或自实现虚拟列表（仅渲染可视区域 + 缓冲区内的节点）
- 过滤：仅显示 `.md` 文件和文件夹，隐藏以 `.` 开头的文件/文件夹（除 `_templates/` 和 `assets/` 等系统文件夹）
- 排序：文件夹优先，然后按名称字母排序（支持中文拼音排序）
- 重命名支持：双击文件名进入编辑模式（内联 input）
- 拖拽支持：使用 HTML5 Drag and Drop API，`dragstart` 记录源路径，`dragover` 高亮目标文件夹，`drop` 触发移动
- 保存展开状态到 `localStorage`（按笔记本路径为 key）

---

## 7. FileTreeNode.vue — 单个树节点

**文件路径**: `src/components/file-tree/FileTreeNode.vue`

**职责**: 渲染文件树中的单个节点（文件或文件夹）。递归自引用以渲染子节点。

### 7.1 Props

| 名称             | 类型             | 必填 | 默认值 | 说明                         |
| ---------------- | ---------------- | :--: | ------ | ---------------------------- |
| `node`           | `FileTreeNode`   |  是  | —      | 节点数据                     |
| `depth`          | `number`         |  是  | —      | 当前层级深度（用于缩进计算） |
| `activeNotePath` | `string \| null` |  否  | `null` | 当前选中的笔记路径           |
| `indentWidth`    | `number`         |  否  | `20`   | 每级缩进宽度                 |

### 7.2 Events

| 名称            | 载荷类型                                                    | 说明                         |
| --------------- | ----------------------------------------------------------- | ---------------------------- |
| `select-note`   | `NotePath`                                                  | 点击文件节点                 |
| `toggle-folder` | `{ path: string; isOpen: boolean }`                         | 点击文件夹展开/折叠箭头      |
| `rename`        | `{ oldPath: string; newName: string }`                      | 重命名完成（内联编辑确认后） |
| `delete`        | `string`                                                    | 请求删除文件/文件夹          |
| `context-menu`  | `{ path: string; isDirectory: boolean; event: MouseEvent }` | 右键菜单                     |

### 7.3 Slots

| 名称      | 说明                                        |
| --------- | ------------------------------------------- |
| `icon`    | 自定义节点图标（默认：📁 文件夹 / 📄 文件） |
| `label`   | 自定义节点标签渲染                          |
| `actions` | 节点悬浮时显示的操作按钮                    |

### 7.4 States

| 状态                        | 处理方式                                                     |
| --------------------------- | ------------------------------------------------------------ |
| **Normal (Folder)**         | 显示折叠/展开箭头 + 文件夹图标 + 名称                        |
| **Normal (File, inactive)** | 显示文件图标 + 文件名（不含 .md 后缀）                       |
| **Normal (File, active)**   | 高亮背景 + 文件名加粗                                        |
| **Renaming**                | 节点标签替换为 `<input>` 框，自动聚焦，Enter 确认 / Esc 取消 |
| **Dragging**                | 拖拽源节点半透明（opacity: 0.5），目标文件夹高亮边框         |
| **Loading (Folder)**        | 文件夹展开箭头替换为旋转加载动画（子节点延迟加载）           |

### 7.5 关键行为

- 文件夹点击：切换 `isOpen` 状态，展开时懒加载子节点（如果未加载）
- 文件点击：触发 `select-note` 事件，导航到对应笔记
- 内联重命名：双击文件名触发；验证文件名合法性（不含 OS 保留字符）；重名检测
- 键盘导航：支持 ↑↓ 切换焦点、→ 展开文件夹、← 折叠文件夹、Enter 选中、F2 重命名、Delete 删除
- 递归渲染：当文件夹 `isOpen` 为 true 且有 `children` 时，递归渲染 FileTreeNode（`depth + 1`）

---

## 8. RecentNotes.vue — 最近编辑列表

**文件路径**: `src/components/panels/RecentNotes.vue`

**职责**: 显示最近打开/编辑的笔记列表，按时间倒序排列。固定在侧边栏底部。

### 8.1 Props

| 名称         | 类型                | 必填 | 默认值  | 说明                                    |
| ------------ | ------------------- | :--: | ------- | --------------------------------------- |
| `notes`      | `RecentNoteEntry[]` |  是  | —       | 最近笔记列表（从 `useIndexStore` 获取） |
| `maxDisplay` | `number`            |  否  | `10`    | 最多显示条数                            |
| `compact`    | `boolean`           |  否  | `false` | 紧凑模式（隐藏时间戳，仅显示标题）      |

### 8.2 Events

| 名称          | 载荷类型   | 说明               |
| ------------- | ---------- | ------------------ |
| `select-note` | `NotePath` | 点击某条记录       |
| `clear-all`   | `void`     | 用户点击"清除全部" |

### 8.3 Slots

| 名称     | 说明                                    |
| -------- | --------------------------------------- |
| `header` | 列表标题区域（默认："最近编辑"）        |
| `item`   | 自定义每项渲染（默认：标题 + 相对时间） |
| `empty`  | 自定义空状态                            |

### 8.4 States

| 状态        | 处理方式                                   |
| ----------- | ------------------------------------------ |
| **Loading** | 索引数据加载中 → 显示 3 行占位骨架         |
| **Empty**   | 无历史记录 → 显示 "还没有编辑过笔记"       |
| **Error**   | 索引读取失败 → 隐藏面板或显示 "加载失败"   |
| **Normal**  | 显示最近笔记列表，超过 `maxDisplay` 则截断 |

### 8.5 关键行为

- 时间格式化：< 1 分钟 → "刚刚"；< 1 小时 → "N 分钟前"；< 24 小时 → "N 小时前"；< 7 天 → "N 天前"；其余 → "YYYY-MM-DD"
- 已删除的笔记自动从列表中过滤（对比文件树数据）
- 数据源：`useIndexStore().getRecentNotes(maxDisplay)`

---

## 9. EditorArea.vue — 中间编辑区

**文件路径**: `src/components/editor/EditorArea.vue`

**职责**: 编辑器区域的主容器，组合格式工具栏、Markdown 编辑器和状态栏。当无笔记打开时显示欢迎页。管理多个标签页（多笔记同时打开）。

### 9.1 Props

| 名称          | 类型             | 必填 | 默认值 | 说明                                          |
| ------------- | ---------------- | :--: | ------ | --------------------------------------------- |
| `openTabs`    | `TabItem[]`      |  否  | `[]`   | 当前打开的标签页列表（来自 useNotebookStore） |
| `activeTabId` | `string \| null` |  否  | `null` | 当前活动标签页 ID                             |

### 9.2 Events

| 名称             | 载荷类型     | 说明                                               |
| ---------------- | ------------ | -------------------------------------------------- |
| `switch-tab`     | `string`     | 切换到指定标签页 ID                                |
| `close-tab`      | `string`     | 关闭指定标签页                                     |
| `close-all-tabs` | `void`       | 关闭所有标签页                                     |
| `save-note`      | `void`       | 手动保存当前笔记（Ctrl+S 触发）                    |
| `editor-ready`   | `EditorView` | 编辑器实例初始化完成（暴露 CodeMirror EditorView） |

### 9.3 Slots

| 名称               | 说明                     |
| ------------------ | ------------------------ |
| `welcome`          | 无笔记打开时的欢迎页内容 |
| `toolbar-before`   | 工具栏前插入内容         |
| `toolbar-after`    | 工具栏后插入内容         |
| `statusbar-before` | 状态栏前插入内容         |

### 9.4 States

| 状态               | 处理方式                                                                     |
| ------------------ | ---------------------------------------------------------------------------- |
| **NoNote**         | 无打开笔记 → 显示欢迎页："MarkLuck — 打开或创建一篇笔记开始写作"             |
| **Loading**        | 笔记加载中 → 编辑器区域显示骨架屏 / 加载动画                                 |
| **Error**          | 笔记加载失败 → 显示错误信息："无法加载笔记 [路径]"+ "重试"按钮               |
| **ExternalChange** | 文件被外部修改 → 弹窗提示冲突（保留本地/加载外部/合并），见 `ConflictDialog` |
| **Saving**         | 正在保存 → 状态栏显示保存中动画，编辑器可继续编辑                            |
| **Normal**         | 正常编辑状态                                                                 |

### 9.5 关键行为

- 标签页管理：最多同时打开 `maxTabs`（默认 10）个标签页，超出时关闭最久未访问的标签页
- 键盘快捷键：在组件内监听全局键盘事件（`Ctrl+S` 保存、`Ctrl+W` 关闭当前标签页、`Ctrl+Shift+T` 重新打开最近关闭的标签页）
- 与 `useEditorStore` 交互：切换标签页时调用 `loadNote()`，保存时调用 `saveNote()`
- 标签页拖拽排序（HTML5 Drag and Drop）

---

## 10. FormatToolbar.vue — 格式工具栏

**文件路径**: `src/components/editor/FormatToolbar.vue`

**职责**: 编辑器顶部的格式工具栏，提供可视化格式操作按钮。每个按钮显示对应快捷键。

### 10.1 Props

| 名称       | 类型                  | 必填 | 默认值         | 说明                                 |
| ---------- | --------------------- | :--: | -------------- | ------------------------------------ |
| `items`    | `ToolbarItemConfig[]` |  否  | 预置默认工具栏 | 工具栏按钮配置列表                   |
| `disabled` | `boolean`             |  否  | `false`        | 全局禁用（无笔记打开时）             |
| `compact`  | `boolean`             |  否  | `false`        | 紧凑模式（仅图标，隐藏文字和快捷键） |
| `vertical` | `boolean`             |  否  | `false`        | 垂直排列（移动端底部工具栏可启用）   |

### 10.2 Events

| 名称     | 载荷类型    | 说明             |
| -------- | ----------- | ---------------- |
| `format` | `BlockType` | 用户点击格式按钮 |

### 10.3 Slots

| 名称     | 说明                                     |
| -------- | ---------------------------------------- |
| `before` | 工具栏前插入自定义内容                   |
| `after`  | 工具栏后插入自定义内容                   |
| `button` | 自定义按钮渲染（默认使用 ToolbarButton） |

### 10.4 States

| 状态                 | 处理方式                             |
| -------------------- | ------------------------------------ |
| **Normal**           | 显示全部工具栏按钮                   |
| **Disabled**         | 所有按钮置灰不可点击（无笔记打开时） |
| **Compact (Mobile)** | 横向可滚动容器，隐藏快捷键文字       |

### 10.5 默认工具栏配置

```typescript
const defaultToolbarItems: ToolbarItemConfig[] = [
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
```

### 10.6 关键行为

- 按钮点击 → `emit('format', item.type)` → EditorArea 调用 `useEditorStore.insertFormat(type)`
- 按钮的 `title` 属性显示快捷键（如 "加粗 (Ctrl+B)"）
- 移动端：工具栏横向滚动（`overflow-x: auto`），支持触摸滑动

---

## 11. ToolbarButton.vue — 单个工具栏按钮

**文件路径**: `src/components/editor/ToolbarButton.vue`

**职责**: 格式工具栏中的单个按钮，显示图标、标签（可选）、快捷键（可选）。

### 11.1 Props

| 名称       | 类型      | 必填 | 默认值  | 说明                                         |
| ---------- | --------- | :--: | ------- | -------------------------------------------- |
| `icon`     | `string`  |  是  | —       | 图标文字或 SVG 名称                          |
| `label`    | `string`  |  是  | —       | 按钮文字标签（国际化 key）                   |
| `shortcut` | `string`  |  否  | `''`    | 快捷键提示（显示在 tooltip 中）              |
| `active`   | `boolean` |  否  | `false` | 是否处于激活状态（如光标在 bold 块内时高亮） |
| `disabled` | `boolean` |  否  | `false` | 是否禁用                                     |

### 11.2 Events

| 名称    | 载荷类型 | 说明       |
| ------- | -------- | ---------- |
| `click` | `void`   | 按钮被点击 |

### 11.3 Slots

| 名称    | 说明           |
| ------- | -------------- |
| `icon`  | 自定义图标渲染 |
| `label` | 自定义标签渲染 |

### 11.4 States

| 状态         | 处理方式                                          |
| ------------ | ------------------------------------------------- |
| **Normal**   | 默认样式（次要色文字）                            |
| **Hover**    | 背景色变深，显示完整 tooltip（含快捷键）          |
| **Active**   | 主色调背景 + 文字高亮（表示光标处于对应格式块中） |
| **Disabled** | 灰色文字 + `cursor: not-allowed`                  |

---

## 12. MarkdownEditor.vue — CodeMirror 6 编辑器封装

**文件路径**: `src/components/editor/MarkdownEditor.vue`

**职责**: 基于 CodeMirror 6 的 Markdown 编辑器核心组件。封装所有 CM6 Extension（BlockDecorator、BlockWidget、FormatAutoDetector、RestoreButton、FormatShortcuts、IMEHandler、ThrottledParser）。管理编辑器实例生命周期。

### 12.1 Props

| 名称               | 类型      | 必填 | 默认值          | 说明                           |
| ------------------ | --------- | :--: | --------------- | ------------------------------ |
| `modelValue`       | `string`  |  是  | —               | 编辑器内容（v-model 双向绑定） |
| `readonly`         | `boolean` |  否  | `false`         | 是否只读                       |
| `placeholder`      | `string`  |  否  | `'开始书写...'` | 空白时显示的占位文字           |
| `fontSize`         | `number`  |  否  | `16`            | 编辑器字体大小（px）           |
| `lineHeight`       | `number`  |  否  | `1.6`           | 行高比例                       |
| `showBlockMarkers` | `boolean` |  否  | `true`          | 是否显示语法块标记点           |
| `autoFormat`       | `boolean` |  否  | `true`          | 是否启用自动格式识别           |
| `parseThrottleMs`  | `number`  |  否  | `150`           | 语法解析防抖延迟（ms）         |
| `enableSpellCheck` | `boolean` |  否  | `false`         | 是否启用浏览器拼写检查         |

### 12.2 Events

| 名称                    | 载荷类型                                                              | 说明                           |
| ----------------------- | --------------------------------------------------------------------- | ------------------------------ |
| `update:modelValue`     | `string`                                                              | 内容变更（v-model 双向绑定）   |
| `blocks-changed`        | `MarkdownBlock[]`                                                     | 语法块解析完成（防抖后）       |
| `headings-changed`      | `HeadingItem[]`                                                       | 标题结构更新                   |
| `focused-block-changed` | `{ index: number \| null; mode: BlockMode }`                          | 光标所在块变化 / 块模式切换    |
| `cursor-activity`       | `{ line: number; col: number; charCount: number; wordCount: number }` | 光标移动或内容变更时的位置统计 |
| `save-requested`        | `void`                                                                | 用户按下 Ctrl+S                |
| `editor-ready`          | `EditorView`                                                          | 编辑器实例初始化完成           |

### 12.3 Slots

无（编辑器内容完全由 CodeMirror 管理，不通过 Slots 注入）。

### 12.4 States

| 状态                 | 处理方式                                                                                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Normal**           | 编辑器正常运行                                                                                                                                                                    |
| **ReadOnly**         | 编辑器不可编辑，无光标闪烁，无标记点更新                                                                                                                                          |
| **LargeFile (>5MB)** | **不在本组件处理** — EditorArea 检测到大型文件时不应传入本组件，而应显示纯文本模式。本组件仅设置 `maxContentLength` 内部阈值（如 `props.modelValue.length > 1MB` 时启用简化解析） |
| **Composing**        | 中文 IME 输入过程中 → 暂停块解析和自动格式化，`compositionend` 时恢复                                                                                                             |
| **Error**            | CM6 初始化失败 → 降级为纯 `<textarea>` + 错误提示                                                                                                                                 |

### 12.5 CodeMirror 6 扩展体系

```typescript
// 编辑器初始化时注册的 CM6 Extension 列表
const extensions = [
  // 基础
  markdown(), // CodeMirror Markdown 语言支持
  history(), // 撤销/重做
  keymap.of([...defaultKeymap, ...historyKeymap]),
  EditorView.lineWrapping, // 自动换行
  placeholder(props.placeholder),
  highlightSpecialChars(), // 高亮特殊字符
  drawSelection(), // 选区渲染
  rectangularSelection(), // 矩形选区 (Alt+拖动)

  // MarkLuck 自定义（仅在 props 开启时注册）
  ...(props.showBlockMarkers ? [blockDecorator()] : []),
  blockWidget(), // Tab 切换渲染/源码
  ...(props.autoFormat ? [formatAutoDetector()] : []),
  restoreButton(), // 还原格式按钮
  formatShortcuts(), // 快捷键绑定
  imeHandler(), // 中文 IME 处理
  throttledParser(props.parseThrottleMs),

  // 主题
  EditorView.theme({
    '&': { fontSize: `${props.fontSize}px`, lineHeight: props.lineHeight },
    '.cm-content': { fontFamily: 'var(--font-mono)' },
    '.cm-cursor': { borderLeftColor: 'var(--color-primary)' },
  }),
];
```

### 12.6 关键行为

- `modelValue` 外部变更时需要同步到编辑器（通过 `EditorView.dispatch`），但避免循环更新（对比内容是否实际变化）
- 内容变更时，先更新内部 state（`view.state.doc.toString()`），然后 `emit('update:modelValue', content)`
- 节流解析：内容变更后 150ms 无新输入 → 触发完整解析 → `emit('blocks-changed', blocks)` + `emit('headings-changed', headings)`
- IME 处理：监听 `compositionstart` / `compositionend` 事件，composition 期间暂停解析
- Tab 键：如果光标在语法块内 → 切换该块的模式（source ↔ render）；否则插入 Tab 字符
- 生命周期：`onMounted` 创建 EditorView，`onUnmounted` 销毁 EditorView

---

## 13. BlockMarker.vue — 语法块标记

**文件路径**: `src/components/editor/BlockMarker.vue`

**职责**: 渲染语法块边界的小圆点标记。蓝色表示源码模式，绿色表示渲染模式。这是一个轻量级组件，由 CodeMirror Widget DOM 渲染。

### 13.1 Props

| 名称        | 类型               | 必填 | 默认值        | 说明                               |
| ----------- | ------------------ | :--: | ------------- | ---------------------------------- |
| `mode`      | `BlockMode`        |  是  | —             | 当前块的显示模式（决定圆点颜色）   |
| `position`  | `'start' \| 'end'` |  是  | —             | 标记在块的开始位置还是结束位置     |
| `blockType` | `BlockType`        |  否  | `'paragraph'` | 块类型（影响 tooltip 显示）        |
| `isValid`   | `boolean`          |  否  | `true`        | 语法块是否有效（无效时显示为灰色） |

### 13.2 Events

| 名称    | 载荷类型                                               | 说明                         |
| ------- | ------------------------------------------------------ | ---------------------------- |
| `click` | `{ position: 'start' \| 'end'; blockType: BlockType }` | 点击标记点（可用于切换模式） |

### 13.3 Slots

无。这是一个纯粹的小型标记点，不包含子内容。

### 13.4 States

| 状态              | 处理方式                                                                   |
| ----------------- | -------------------------------------------------------------------------- |
| **Source (蓝色)** | `mode === 'source'` → 蓝色圆点 `#3B82F6` (blue-500)                        |
| **Render (绿色)** | `mode === 'render'` → 绿色圆点 `#10B981` (green-500)                       |
| **Invalid**       | `isValid === false` → 灰色圆点 `#9CA3AF` (gray-400)，`cursor: not-allowed` |

### 13.5 渲染规格

```
圆点样式：
  width: 6px; height: 6px; border-radius: 50%;
  display: inline-block; vertical-align: middle;
  margin: 0 2px; cursor: pointer;
  transition: background-color 0.2s ease;

hover 时放大的 tooltip：
  "bold (渲染模式)" / "bold (源码模式)"
```

---

## 14. RestoreButton.vue — 还原格式按钮

**文件路径**: `src/components/editor/RestoreButton.vue`

**职责**: 当用户修改导致语法块失效时，在块下方显示"还原格式"按钮。点击后恢复上一个有效状态。

### 14.1 Props

| 名称              | 类型      | 必填 | 默认值           | 说明                                       |
| ----------------- | --------- | :--: | ---------------- | ------------------------------------------ |
| `blockIndex`      | `number`  |  是  | —                | 关联的块索引                               |
| `previousContent` | `string`  |  是  | —                | 上一个有效的原始文本（用于还原）           |
| `visible`         | `boolean` |  是  | —                | 是否显示（仅语法失效且存在历史快照时显示） |
| `shortcutHint`    | `string`  |  否  | `'Ctrl+Shift+Z'` | 快捷键提示                                 |

### 14.2 Events

| 名称      | 载荷类型                                  | 说明         |
| --------- | ----------------------------------------- | ------------ |
| `restore` | `{ blockIndex: number; content: string }` | 点击还原按钮 |

### 14.3 Slots

| 名称        | 说明                                                |
| ----------- | --------------------------------------------------- |
| _(default)_ | 自定义按钮内容（默认："↩ 还原格式 (Ctrl+Shift+Z)"） |

### 14.4 States

| 状态        | 处理方式                                                       |
| ----------- | -------------------------------------------------------------- |
| **Hidden**  | `visible === false` → 不渲染                                   |
| **Visible** | 在块下方显示浮动按钮，带弹入动画（`fadeIn + slideDown 200ms`） |
| **Hover**   | 按钮背景色加深，鼠标变为 pointer                               |

### 14.5 关键行为

- 按钮点击 → `emit('restore', { blockIndex, content: previousContent })` → CodeMirror Extension 将内容替换回编辑器
- 还原后按钮自动隐藏
- 快捷键 `Ctrl+Shift+Z` 也可触发还原（由 MarkdownEditor 的 `restoreButton()` Extension 处理）

---

## 15. StatusBar.vue — 状态栏

**文件路径**: `src/components/editor/StatusBar.vue`

**职责**: 编辑器底部状态栏，显示当前笔记的字数、行数、光标位置、保存状态、文件编码等信息。

### 15.1 Props

| 名称                     | 类型             | 必填 | 默认值     | 说明                          |
| ------------------------ | ---------------- | :--: | ---------- | ----------------------------- |
| `charCount`              | `number`         |  否  | `0`        | 字符总数（含空格）            |
| `wordCount`              | `number`         |  否  | `0`        | 英文单词数                    |
| `lineCount`              | `number`         |  否  | `0`        | 总行数                        |
| `cursorLine`             | `number \| null` |  否  | `null`     | 当前光标所在行号（从 1 开始） |
| `cursorCol`              | `number \| null` |  否  | `null`     | 当前光标所在列号（从 1 开始） |
| `isDirty`                | `boolean`        |  否  | `false`    | 是否有未保存修改              |
| `isSaving`               | `boolean`        |  否  | `false`    | 是否正在保存                  |
| `lastSavedAt`            | `number \| null` |  否  | `null`     | 上次保存时间戳（Unix ms）     |
| `saveError`              | `string \| null` |  否  | `null`     | 保存错误信息                  |
| `externalChangeDetected` | `boolean`        |  否  | `false`    | 是否检测到外部文件变更        |
| `themeMode`              | `ThemeMode`      |  否  | `'system'` | 当前主题模式（用于显示/切换） |

### 15.2 Events

| 名称                 | 载荷类型 | 说明             |
| -------------------- | -------- | ---------------- |
| `toggle-theme`       | `void`   | 点击主题切换按钮 |
| `dismiss-save-error` | `void`   | 关闭保存错误提示 |

### 15.3 Slots

| 名称     | 说明                 |
| -------- | -------------------- |
| `left`   | 状态栏左侧自定义内容 |
| `center` | 状态栏中间自定义内容 |
| `right`  | 状态栏右侧自定义内容 |

### 15.4 States

| 状态               | 处理方式                                                 |
| ------------------ | -------------------------------------------------------- | --------------- | ------------------------- |
| **Saved**          | 显示 "✓ 已保存 14:32" （绿色文字）                       |
| **Dirty**          | 显示 "● 未保存" （橙色圆点 + 文字）                      |
| **Saving**         | 显示 "⏳ 保存中..." （加载动画）                         |
| **SaveError**      | 显示 "⚠ 保存失败: [错误信息]" （红色文字）+ 点击查看详情 |
| **ExternalChange** | 显示 "⚠ 外部修改" （黄色警告图标）+ 点击触发冲突解决     |
| **Normal**         | 左侧：行:列                                              | 中间：字数/词数 | 右侧：保存状态 + 主题切换 |

---

## 16. NavTree.vue — 右侧导航树

**文件路径**: `src/components/nav/NavTree.vue`

**职责**: 解析当前 Markdown 文档的标题结构（H1-H6），渲染为可折叠的树状导航列表。点击标题滚动编辑器到对应位置。

### 16.1 Props

| 名称              | 类型             | 必填 | 默认值  | 说明                                    |
| ----------------- | ---------------- | :--: | ------- | --------------------------------------- |
| `headings`        | `HeadingItem[]`  |  是  | —       | 当前文档标题结构（来自 useEditorStore） |
| `activeHeadingId` | `string \| null` |  否  | `null`  | 当前光标所在的标题 ID（高亮）           |
| `collapsed`       | `boolean`        |  否  | `false` | 面板是否折叠                            |
| `maxVisibleDepth` | `number`         |  否  | `6`     | 最多显示的标题层级（1 = 仅 H1）         |

### 16.2 Events

| 名称              | 载荷类型                                    | 说明                              |
| ----------------- | ------------------------------------------- | --------------------------------- |
| `navigate-to`     | `{ headingId: string; lineNumber: number }` | 点击标题 → 请求编辑器滚动到对应行 |
| `toggle-collapse` | `void`                                      | 折叠/展开面板                     |

### 16.3 Slots

| 名称     | 说明                                       |
| -------- | ------------------------------------------ |
| `header` | 导航面板标题区域（默认："大纲"）           |
| `empty`  | 无标题时的空状态                           |
| `item`   | 自定义标题节点渲染（默认使用 NavTreeNode） |

### 16.4 States

| 状态          | 处理方式                                                                 |
| ------------- | ------------------------------------------------------------------------ |
| **Loading**   | 正在解析标题 → 显示 3-5 个占位行骨架                                     |
| **Empty**     | 当前文档无标题 → 显示 "📋 当前文档无标题，使用 # 创建标题以在导航中查看" |
| **Normal**    | 显示标题树，当前光标所在标题高亮，跟随滚动                               |
| **Collapsed** | 面板折叠为窄图标条                                                       |

### 16.5 关键行为

- 标题过长时省略号截断（`text-overflow: ellipsis`，max-width 由面板宽度决定）
- 点击标题 → `emit('navigate-to', { headingId, lineNumber })` → EditorArea 滚动 CodeMirror 到对应行
- 自动跟随：编辑器滚动时，更新 `activeHeadingId` 以高亮当前可视区域内的最顶部标题
- 初始展开：默认展开所有层级，用户折叠状态可持久化
- 层级缩进：H1 无缩进，H2 缩进 1 级，...，H6 缩进 5 级（每级 16px）

---

## 17. NavTreeNode.vue — 单个导航节点

**文件路径**: `src/components/nav/NavTreeNode.vue`

**职责**: 导航树中的单个标题节点。递归引用子标题。

### 17.1 Props

| 名称       | 类型          | 必填 | 默认值  | 说明                       |
| ---------- | ------------- | :--: | ------- | -------------------------- |
| `heading`  | `HeadingItem` |  是  | —       | 标题节点数据               |
| `active`   | `boolean`     |  否  | `false` | 当前光标是否在此标题区域内 |
| `depth`    | `number`      |  是  | —       | 当前层级深度（用于缩进）   |
| `maxDepth` | `number`      |  否  | `6`     | 最大显示深度限制           |

### 17.2 Events

| 名称       | 载荷类型                                    | 说明     |
| ---------- | ------------------------------------------- | -------- |
| `navigate` | `{ headingId: string; lineNumber: number }` | 点击标题 |

### 17.3 Slots

| 名称     | 说明                             |
| -------- | -------------------------------- |
| `prefix` | 标题前自定义修饰（如编号、图标） |
| `text`   | 标题文字渲染                     |

### 17.4 States

| 状态                  | 处理方式                                 |
| --------------------- | ---------------------------------------- |
| **Normal (Inactive)** | 默认文字色，正常字体                     |
| **Active**            | 主色调文字 + 加粗 + 左侧高亮指示条       |
| **Collapsed**         | 有子标题时显示折叠箭头 ►，隐藏子节点     |
| **Expanded**          | 有子标题时显示展开箭头 ▼，渲染子节点列表 |
| **Leaf**              | 无子标题 → 无箭头图标                    |

---

## 18. SearchPanel.vue — 搜索面板

**文件路径**: `src/components/search/SearchPanel.vue`

**职责**: 全局搜索浮层面板（通过 Teleport 渲染到 body）。组合搜索输入框、过滤条件、搜索结果列表。由快捷键 `Ctrl+Shift+F` 触发打开。

### 18.1 Props

| 名称           | 类型      | 必填 | 默认值 | 说明                     |
| -------------- | --------- | :--: | ------ | ------------------------ |
| `visible`      | `boolean` |  是  | —      | 面板是否可见             |
| `initialQuery` | `string`  |  否  | `''`   | 初始搜索词（从外部传入） |

### 18.2 Events

| 名称             | 载荷类型                                    | 说明                               |
| ---------------- | ------------------------------------------- | ---------------------------------- |
| `update:visible` | `boolean`                                   | 面板显示/隐藏                      |
| `search`         | `{ query: string; filters: SearchFilters }` | 用户触发搜索（输入防抖或按 Enter） |
| `select-result`  | `SearchResult`                              | 用户点击某条搜索结果               |
| `close`          | `void`                                      | 关闭面板（Esc 或点击遮罩）         |

### 18.3 Slots

| 名称      | 说明                                         |
| --------- | -------------------------------------------- |
| `header`  | 面板头部区域（默认：SearchInput + 过滤条件） |
| `results` | 搜索结果区域（默认：SearchResultList）       |
| `footer`  | 面板底部（默认：搜索结果统计 + 关闭按钮）    |

### 18.4 States

| 状态           | 处理方式                                             |
| -------------- | ---------------------------------------------------- |
| **Hidden**     | `visible === false` → 不渲染（或 display:none）      |
| **Idle**       | 面板打开但未输入搜索词 → 显示搜索历史 / 搜索提示     |
| **Searching**  | 正在搜索 → 搜索框旁显示加载动画，列表区域显示骨架屏  |
| **NoResults**  | 搜索完成但无结果 → 显示 "🔍 未找到匹配 'XXX' 的笔记" |
| **Error**      | 搜索出错 → 显示错误信息 + "重建索引" 按钮            |
| **HasResults** | 显示搜索结果列表 + 统计（"共 N 条结果"）             |

### 18.5 关键行为

- 打开时自动聚焦搜索输入框
- Esc 关闭面板
- 搜索防抖 300ms：用户停止输入 300ms 后自动触发搜索
- 搜索语法支持：`/pattern/flags` 正则、`tag:xxx` 标签过滤、`date:from..to` 日期范围、`folder:xxx` 文件夹范围
- 面板与 `useSearchStore` 双向同步：搜索结果存入 Store，导航后保持结果列表
- 浮层位置：桌面端居中偏上（`position: fixed; top: 10%; left: 50%; transform: translateX(-50%)`）；移动端全屏

---

## 19. SearchInput.vue — 搜索输入框

**文件路径**: `src/components/search/SearchInput.vue`

**职责**: 搜索输入框组件，支持搜索语法高亮提示、搜索历史下拉、正则表达式验证。

### 19.1 Props

| 名称            | 类型       | 必填 | 默认值                                                       | 说明                       |
| --------------- | ---------- | :--: | ------------------------------------------------------------ | -------------------------- |
| `modelValue`    | `string`   |  是  | —                                                            | 搜索词（v-model 双向绑定） |
| `placeholder`   | `string`   |  否  | `'搜索笔记... (支持 tag:xxx /regex/ date:2026-01..2026-06)'` | 占位文字                   |
| `searchHistory` | `string[]` |  否  | `[]`                                                         | 搜索历史列表（最多 10 条） |

### 19.2 Events

| 名称                | 载荷类型 | 说明                      |
| ------------------- | -------- | ------------------------- |
| `update:modelValue` | `string` | 搜索词变更                |
| `search`            | `string` | 用户按 Enter 触发立即搜索 |
| `clear`             | `void`   | 用户点击清除按钮          |
| `select-history`    | `string` | 用户从下拉历史中选择一条  |

### 19.3 Slots

| 名称     | 说明                                   |
| -------- | -------------------------------------- |
| `prefix` | 输入框前图标/内容（默认：🔍 图标）     |
| `suffix` | 输入框后图标/内容（默认：清除 × 按钮） |

### 19.4 States

| 状态             | 处理方式                                                          |
| ---------------- | ----------------------------------------------------------------- |
| **Empty**        | 显示占位文字，下拉显示搜索历史                                    |
| **Typing**       | 输入框中，搜索语法部分高亮（tag: 蓝色、/regex/ 绿色、date: 橙色） |
| **InvalidRegex** | 检测到无效正则 → 输入框红色边框 + tooltip 显示错误                |

---

## 20. SearchResultList.vue — 搜索结果列表

**文件路径**: `src/components/search/SearchResultList.vue`

**职责**: 渲染搜索结果列表，支持虚拟滚动和键盘导航。

### 20.1 Props

| 名称            | 类型             | 必填 | 默认值  | 说明                          |
| --------------- | ---------------- | :--: | ------- | ----------------------------- |
| `results`       | `SearchResult[]` |  是  | —       | 搜索结果数组                  |
| `selectedIndex` | `number`         |  否  | `-1`    | 当前键盘高亮的索引（↑↓ 导航） |
| `loading`       | `boolean`        |  否  | `false` | 加载中                        |
| `totalCount`    | `number`         |  否  | `0`     | 总结果数（用于显示统计）      |

### 20.2 Events

| 名称                   | 载荷类型       | 说明                 |
| ---------------------- | -------------- | -------------------- |
| `select`               | `SearchResult` | 选择某条结果         |
| `update:selectedIndex` | `number`       | 键盘导航更新选中索引 |

### 20.3 Slots

| 名称      | 说明                                          |
| --------- | --------------------------------------------- |
| `item`    | 自定义结果项渲染（默认使用 SearchResultItem） |
| `empty`   | 自定义无结果状态                              |
| `loading` | 自定义加载状态                                |
| `header`  | 列表顶部统计信息（默认："共 N 条结果"）       |

### 20.4 States

| 状态        | 处理方式        |
| ----------- | --------------- |
| **Loading** | 显示 5 行骨架屏 |
| **Empty**   | 显示空状态      |
| **Normal**  | 渲染搜索结果    |

---

## 21. SearchResultItem.vue — 单条搜索结果

**文件路径**: `src/components/search/SearchResultItem.vue`

**职责**: 渲染单条搜索结果，高亮匹配文本，显示上下文片段和笔记信息。

### 21.1 Props

| 名称           | 类型           | 必填 | 默认值  | 说明                   |
| -------------- | -------------- | :--: | ------- | ---------------------- |
| `result`       | `SearchResult` |  是  | —       | 搜索结果数据           |
| `selected`     | `boolean`      |  否  | `false` | 是否为键盘高亮的当前项 |
| `showFilePath` | `boolean`      |  否  | `true`  | 是否显示文件路径       |

### 21.2 Events

| 名称           | 载荷类型                                      | 说明     |
| -------------- | --------------------------------------------- | -------- |
| `click`        | `SearchResult`                                | 点击该项 |
| `context-menu` | `{ result: SearchResult; event: MouseEvent }` | 右键菜单 |

### 21.3 Slots

| 名称      | 说明                             |
| --------- | -------------------------------- |
| `title`   | 自定义标题区域                   |
| `snippet` | 自定义上下文片段区域             |
| `meta`    | 自定义元数据区域（标签、日期等） |

### 21.4 States

| 状态         | 处理方式                      |
| ------------ | ----------------------------- |
| **Normal**   | 默认背景                      |
| **Selected** | 主色调浅背景 + 左侧高亮指示条 |
| **Hover**    | 次要色浅背景                  |

### 21.5 关键行为

- 标题中匹配文本高亮（`<mark>` 标签）
- 片段的匹配文本高亮
- 显示匹配类型图标：📑 标题匹配 / 📝 正文匹配 / 📄 文件名匹配
- 点击 → 通过 `useNotebookStore.openNote()` 打开笔记并跳转到匹配位置

---

## 22. BacklinksPanel.vue — 反向链接面板

**文件路径**: `src/components/panels/BacklinksPanel.vue`

**职责**: 显示所有引用了当前笔记的其他笔记列表（反向链接）。位于右侧导航面板中。

### 22.1 Props

| 名称              | 类型              | 必填 | 默认值  | 说明                                   |
| ----------------- | ----------------- | :--: | ------- | -------------------------------------- |
| `backlinks`       | `BacklinkEntry[]` |  是  | —       | 反向链接条目列表（来自 useIndexStore） |
| `currentNotePath` | `string \| null`  |  否  | `null`  | 当前笔记路径                           |
| `collapsed`       | `boolean`         |  否  | `false` | 面板是否折叠                           |

### 22.2 Events

| 名称              | 载荷类型        | 说明                          |
| ----------------- | --------------- | ----------------------------- |
| `navigate`        | `BacklinkEntry` | 点击反向链接条目 → 打开源笔记 |
| `toggle-collapse` | `void`          | 折叠/展开面板                 |

### 22.3 Slots

| 名称     | 说明                                      |
| -------- | ----------------------------------------- |
| `header` | 面板标题区域（默认：显示笔记名 + 引用数） |
| `item`   | 自定义条目渲染（默认使用 BacklinkItem）   |
| `empty`  | 自定义空状态                              |

### 22.4 States

| 状态        | 处理方式                                       |
| ----------- | ---------------------------------------------- |
| **NoNote**  | 无笔记打开 → "打开一篇笔记以查看反向链接"      |
| **Loading** | 索引加载中 → 骨架屏                            |
| **Empty**   | 无反向链接 → "📎 还没有其他笔记链接到这篇笔记" |
| **Error**   | 索引加载失败 → 错误信息 + "重试"               |
| **Normal**  | 渲染反向链接列表，按引用时间倒序               |

### 22.5 关键行为

- 数据源：`useIndexStore().getBacklinks(currentNotePath)`
- 点击反向链接条目 → 在新标签页中打开源笔记，滚动到引用位置
- 显示引用统计（如 "3 篇笔记引用了此笔记"）
- 支持 `[[笔记名|别名]]` 的别名显示

---

## 23. BacklinkItem.vue — 单条反向链接

**文件路径**: `src/components/panels/BacklinkItem.vue`

**职责**: 渲染单条反向链接条目，显示源笔记标题和引用上下文片段。

### 23.1 Props

| 名称        | 类型            | 必填 | 默认值  | 说明               |
| ----------- | --------------- | :--: | ------- | ------------------ |
| `entry`     | `BacklinkEntry` |  是  | —       | 反向链接数据       |
| `highlight` | `boolean`       |  否  | `false` | 是否高亮（悬浮时） |

### 23.2 Events

| 名称    | 载荷类型        | 说明     |
| ------- | --------------- | -------- |
| `click` | `BacklinkEntry` | 点击条目 |

### 23.3 Slots

| 名称      | 说明                 |
| --------- | -------------------- |
| `title`   | 自定义标题渲染       |
| `context` | 自定义上下文片段渲染 |

### 23.4 States

| 状态       | 处理方式                                                          |
| ---------- | ----------------------------------------------------------------- |
| **Normal** | 卡片样式：源笔记标题 + 上下文片段（...引用处前后30字符...）+ 行号 |
| **Hover**  | 背景色加深 + 显示完整路径 tooltip                                 |
| **Active** | （导航后）高亮指示                                                |

---

## 24. TagPanel.vue — 标签面板

**文件路径**: `src/components/panels/TagPanel.vue`

**职责**: 展示笔记本中所有标签的云图或列表。按使用频率排序，点击标签触发搜索。

### 24.1 Props

| 名称          | 类型                | 必填 | 默认值    | 说明                           |
| ------------- | ------------------- | :--: | --------- | ------------------------------ |
| `tags`        | `TagEntry[]`        |  是  | —         | 标签列表（来自 useIndexStore） |
| `displayMode` | `'cloud' \| 'list'` |  否  | `'cloud'` | 标签云模式或列表模式           |
| `sortBy`      | `'count' \| 'name'` |  否  | `'count'` | 排序方式                       |
| `maxDisplay`  | `number`            |  否  | `50`      | 最多显示标签数                 |
| `collapsed`   | `boolean`           |  否  | `false`   | 面板是否折叠                   |

### 24.2 Events

| 名称              | 载荷类型 | 说明                           |
| ----------------- | -------- | ------------------------------ |
| `select-tag`      | `string` | 点击标签 → 触发 `tag:xxx` 搜索 |
| `toggle-collapse` | `void`   | 折叠/展开                      |

### 24.3 Slots

| 名称     | 说明           |
| -------- | -------------- |
| `header` | 面板标题区域   |
| `tag`    | 自定义标签渲染 |
| `empty`  | 空状态         |

### 24.4 States

| 状态        | 处理方式                                                                 |
| ----------- | ------------------------------------------------------------------------ |
| **Loading** | 标签聚合中 → 骨架屏                                                      |
| **Empty**   | 无标签 → "🏷 还没有标签，在笔记中使用 #tag 或 YAML frontmatter 添加标签" |
| **Normal**  | Cloud 模式：标签按频率显示不同字号/颜色；List 模式：标签列表 + 频次数字  |

### 24.5 关键行为

- 标签云模式下，字号按频率分 5 级（12px / 14px / 16px / 18px / 20px）
- 点击标签 → 调用 `useSearchStore` 搜索 `tag:xxx`
- 数据源：`useIndexStore().getAllTags()`

---

## 25. ExportDialog.vue — 导出对话框

**文件路径**: `src/components/modals/ExportDialog.vue`

**职责**: 导出选项配置对话框。用户选择导出格式和选项后执行导出。

### 25.1 Props

| 名称              | 类型      | 必填 | 默认值 | 说明                           |
| ----------------- | --------- | :--: | ------ | ------------------------------ |
| `visible`         | `boolean` |  是  | —      | 对话框可见性                   |
| `notePath`        | `string`  |  否  | `''`   | 当前笔记路径（用于默认文件名） |
| `noteTitle`       | `string`  |  否  | `''`   | 当前笔记标题                   |
| `markdownContent` | `string`  |  否  | `''`   | 当前笔记 Markdown 内容         |

### 25.2 Events

| 名称             | 载荷类型                                      | 说明            |
| ---------------- | --------------------------------------------- | --------------- |
| `update:visible` | `boolean`                                     | 对话框显示/隐藏 |
| `export`         | `{ options: ExportOptions; content: string }` | 用户确认导出    |
| `cancel`         | `void`                                        | 用户取消        |

### 25.3 Slots

| 名称              | 说明             |
| ----------------- | ---------------- |
| `header`          | 对话框标题区域   |
| `format-selector` | 格式选择器区域   |
| `options`         | 导出选项配置区域 |
| `footer`          | 底部按钮区域     |

### 25.4 States

| 状态          | 处理方式                                                      |
| ------------- | ------------------------------------------------------------- |
| **Normal**    | 显示格式选择和配置选项                                        |
| **Exporting** | 正在生成导出文件 → 显示进度动画 + "正在导出..."，禁用所有按钮 |
| **Error**     | 导出失败 → 显示错误信息 + "重试"/"取消"                       |

### 25.5 格式选项

| 格式 | 图标 | 说明                                   |
| ---- | ---- | -------------------------------------- |
| PDF  | 🖨   | 浏览器打印 (window.print()) — 默认选中 |
| DOCX | 📝   | Word 文档 (docx.js)                    |
| XLSX | 📊   | Excel 表格 (sheetjs) — 仅导出表格内容  |
| CSV  | 📋   | CSV 文件 — 仅导出表格内容              |
| TXT  | 📄   | 纯文本（去除 Markdown 语法）           |
| HTML | 🌐   | 自包含 HTML（内嵌 CSS）                |

### 25.6 导出选项

- ✅ 包含 YAML frontmatter
- Wiki-link 处理：[ 保留文本 | 转为超链接 | 移除 ]
- ✅ 代码块包含行号
- 图片处理：[ 内嵌 base64 | 保持相对路径 | 移除 ]

---

## 26. ShareDialog.vue — 分享对话框

**文件路径**: `src/components/modals/ShareDialog.vue`

**职责**: 分享对话框，分两步：选择分享格式 → 选择分享渠道。

### 26.1 Props

| 名称              | 类型      | 必填 | 默认值 | 说明                   |
| ----------------- | --------- | :--: | ------ | ---------------------- |
| `visible`         | `boolean` |  是  | —      | 对话框可见性           |
| `noteTitle`       | `string`  |  否  | `''`   | 笔记标题（用于文件名） |
| `markdownContent` | `string`  |  否  | `''`   | Markdown 内容          |

### 26.2 Events

| 名称             | 载荷类型                                           | 说明                              |
| ---------------- | -------------------------------------------------- | --------------------------------- |
| `update:visible` | `boolean`                                          | 对话框显示/隐藏                   |
| `share`          | `{ shareOptions: ShareOptions; markdown: string }` | 用户确认分享（格式 + 渠道已选定） |
| `cancel`         | `void`                                             | 用户取消                          |

### 26.3 Slots

| 名称               | 说明                   |
| ------------------ | ---------------------- |
| `step-indicator`   | 步骤指示器（步骤 1/2） |
| `format-selector`  | 格式选择区域           |
| `channel-selector` | 渠道选择区域           |
| `footer`           | 底部按钮区域           |

### 26.4 流程与状态

| 步骤   | 状态                 | UI                                                                                                                   |
| ------ | -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Step 1 | **FormatSelection**  | 4 个格式选项：PDF（默认推荐）/ Markdown / HTML / TXT。每项显示格式图标 + 说明 + 文件大小估算。点击格式 → 进入 Step 2 |
| Step 2 | **ChannelSelection** | 4 个渠道选项：系统分享面板 / 邮件 / 复制到剪贴板 / 导出到本地。每项显示渠道图标 + 说明                               |
| —      | **Sharing**          | 正在生成文件并分发 → 显示进度 + "正在生成分享文件..."                                                                |
| —      | **Complete**         | 分享完成 → 显示 "✓ 已通过 [渠道] 分享" 消息，1.5s 后自动关闭                                                         |
| —      | **Error**            | 分享失败 → 显示错误信息 + "重试"/"取消"                                                                              |

### 26.5 关键行为

- 默认选中 PDF 格式
- 渠道可用性检测：系统分享面板需要 `navigator.canShare` 支持，不支持的浏览器隐藏该选项
- `share` 事件携带完整选项，由 `ShareManager` 服务处理生成和分发

---

## 27. TemplateDialog.vue — 模板选择对话框

**文件路径**: `src/components/modals/TemplateDialog.vue`

**职责**: 模板选择对话框。用户新建笔记时选择模板，预览模板内容，占位符自动替换。

### 27.1 Props

| 名称        | 类型             | 必填 | 默认值 | 说明         |
| ----------- | ---------------- | :--: | ------ | ------------ |
| `visible`   | `boolean`        |  是  | —      | 对话框可见性 |
| `templates` | `TemplateItem[]` |  是  | —      | 可用模板列表 |

### 27.2 Events

| 名称             | 载荷类型       | 说明                             |
| ---------------- | -------------- | -------------------------------- |
| `update:visible` | `boolean`      | 对话框显示/隐藏                  |
| `select`         | `TemplateItem` | 用户选择模板                     |
| `create-blank`   | `void`         | 用户选择"空白笔记"（不使用模板） |
| `cancel`         | `void`         | 用户取消                         |

### 27.3 Slots

| 名称      | 说明                           |
| --------- | ------------------------------ |
| `header`  | 对话框标题（默认："选择模板"） |
| `preview` | 模板预览区域                   |
| `footer`  | 底部按钮区域                   |

### 27.4 States

| 状态        | 处理方式                                               |
| ----------- | ------------------------------------------------------ |
| **Loading** | 模板列表加载中 → 骨架屏                                |
| **Empty**   | 无可用模板 → 仅显示"空白笔记"选项                      |
| **Normal**  | 模板列表 + 选中模板的预览                              |
| **Preview** | 右侧预览面板显示模板渲染后的效果（占位符替换为示例值） |

### 27.5 内置模板

| 模板     | 占位符                                                 | 说明     |
| -------- | ------------------------------------------------------ | -------- |
| 日记     | `{{date}}` `{{time}}` `{{year}}` `{{month}}` `{{day}}` | 每日日记 |
| 会议纪要 | `{{date}}` `{{time}}`                                  | 会议记录 |
| 周报     | `{{date}}` `{{week}}`                                  | 每周总结 |

### 27.6 关键行为

- 模板预览：将占位符替换为当前值（如 `{{date}}` → `2026-06-03`）后渲染 Markdown
- 选择模板后 → `emit('select', template)` → 父组件调用 `TemplateEngine.render(template.content, new Date())` 获取最终内容并创建笔记

---

## 28. SettingsPanel.vue — 设置面板

**文件路径**: `src/components/modals/SettingsPanel.vue`

**职责**: 应用设置面板（侧滑面板或对话框形式），管理编辑器偏好、主题、快捷键等。

### 28.1 Props

| 名称      | 类型      | 必填 | 默认值 | 说明       |
| --------- | --------- | :--: | ------ | ---------- |
| `visible` | `boolean` |  是  | —      | 面板可见性 |

### 28.2 Events

| 名称               | 载荷类型               | 说明             |
| ------------------ | ---------------------- | ---------------- |
| `update:visible`   | `boolean`              | 面板显示/隐藏    |
| `settings-changed` | `Partial<AppSettings>` | 任一设置项变更后 |

### 28.3 Slots

| 名称      | 说明           |
| --------- | -------------- |
| `header`  | 面板标题       |
| `section` | 自定义设置分区 |

### 28.4 设置项

```typescript
interface AppSettings {
  // 编辑器
  editorFontSize: number; // 默认 16, 范围 12-24
  editorLineHeight: number; // 默认 1.6, 范围 1.2-2.5
  editorFontFamily: string; // 默认 'JetBrains Mono, Consolas, monospace'
  editorTabSize: number; // 默认 2
  editorWordWrap: boolean; // 默认 true
  editorShowLineNumbers: boolean; // 默认 true
  editorShowBlockMarkers: boolean; // 默认 true
  editorAutoFormat: boolean; // 默认 true

  // 主题
  themeMode: ThemeMode; // 默认 'system'
  codeThemeLight: string; // 默认 'github'
  codeThemeDark: string; // 默认 'github-dark'

  // 自动保存
  autoSaveEnabled: boolean; // 默认 true
  autoSaveDelayMs: number; // 默认 2000, 范围 500-10000

  // 文件
  defaultNotebookPath: string; // 默认 ''
  maxRecentNotes: number; // 默认 20

  // 语言
  language: 'zh-CN' | 'en'; // 默认 'zh-CN'
}
```

### 28.5 States

| 状态       | 处理方式                                      |
| ---------- | --------------------------------------------- |
| **Normal** | 分组显示设置项（编辑器 / 外观 / 文件 / 语言） |
| **Dirty**  | 保存按钮高亮提示"有未保存的更改"              |

### 28.6 关键行为

- 变更立即生效（通过 `settings-changed` 事件 → Pinia Store → 各消费组件响应）
- 持久化到 `localStorage`
- 编辑器相关设置通过 `MarkdownEditor` Props 透传

---

## 29. common/IconButton.vue — 通用图标按钮

**文件路径**: `src/components/common/IconButton.vue`

**职责**: 通用图标按钮，支持多种尺寸、样式变体、loading 状态和 tooltip。

### 29.1 Props

| 名称       | 类型                                              | 必填 | 默认值      | 说明                                   |
| ---------- | ------------------------------------------------- | :--: | ----------- | -------------------------------------- |
| `icon`     | `string`                                          |  是  | —           | 图标名称（使用 SVG sprite 或 Unicode） |
| `label`    | `string`                                          |  否  | `''`        | 按钮文字（可选，与图标并排）           |
| `tooltip`  | `string`                                          |  否  | `''`        | Tooltip 文字（悬浮时显示）             |
| `size`     | `'sm' \| 'md' \| 'lg'`                            |  否  | `'md'`      | 按钮尺寸（sm=28px, md=36px, lg=44px）  |
| `variant`  | `'ghost' \| 'outline' \| 'solid'`                 |  否  | `'ghost'`   | 样式变体                               |
| `color`    | `'default' \| 'primary' \| 'danger' \| 'success'` |  否  | `'default'` | 颜色主题                               |
| `disabled` | `boolean`                                         |  否  | `false`     | 是否禁用                               |
| `loading`  | `boolean`                                         |  否  | `false`     | 是否显示加载动画（替代图标）           |
| `active`   | `boolean`                                         |  否  | `false`     | 是否处于激活状态（切换按钮场景）       |
| `round`    | `boolean`                                         |  否  | `false`     | 是否圆形按钮                           |

### 29.2 Events

| 名称    | 载荷类型     | 说明       |
| ------- | ------------ | ---------- |
| `click` | `MouseEvent` | 按钮被点击 |

### 29.3 Slots

| 名称    | 说明           |
| ------- | -------------- |
| `icon`  | 自定义图标渲染 |
| `label` | 自定义文字渲染 |

### 29.4 States

| 状态         | 处理方式                     |
| ------------ | ---------------------------- |
| **Normal**   | 默认样式                     |
| **Hover**    | 背景变深                     |
| **Active**   | 激活态背景色                 |
| **Disabled** | 灰色 + `cursor: not-allowed` |
| **Loading**  | 图标替换为旋转 spinner       |

---

## 30. common/Dropdown.vue — 通用下拉菜单

**文件路径**: `src/components/common/Dropdown.vue`

**职责**: 通用下拉菜单，支持多种触发方式、位置对齐、分组选项、搜索过滤。

### 30.1 Props

| 名称                  | 类型                                                        | 必填 | 默认值           | 说明                             |
| --------------------- | ----------------------------------------------------------- | :--: | ---------------- | -------------------------------- |
| `visible`             | `boolean`                                                   |  否  | `false`          | 控制下拉显示（v-model 模式）     |
| `trigger`             | `'click' \| 'hover' \| 'manual'`                            |  否  | `'click'`        | 触发方式                         |
| `placement`           | `'bottom-start' \| 'bottom' \| 'bottom-end' \| 'top-start'` |  否  | `'bottom-start'` | 弹出位置（相对于触发器）         |
| `closeOnClick`        | `boolean`                                                   |  否  | `true`           | 点击选项后是否自动关闭           |
| `closeOnClickOutside` | `boolean`                                                   |  否  | `true`           | 点击外部是否关闭                 |
| `maxHeight`           | `number`                                                    |  否  | `300`            | 下拉列表最大高度（px），超出滚动 |
| `disabled`            | `boolean`                                                   |  否  | `false`          | 是否禁用                         |

### 30.2 Events

| 名称             | 载荷类型  | 说明          |
| ---------------- | --------- | ------------- |
| `update:visible` | `boolean` | 下拉显示/隐藏 |
| `open`           | `void`    | 下拉打开时    |
| `close`          | `void`    | 下拉关闭时    |

### 30.3 Slots

| 名称        | 说明                             |
| ----------- | -------------------------------- |
| `trigger`   | 触发元素（按钮、图标等）         |
| _(default)_ | 下拉内容（选项列表、自定义内容） |
| `header`    | 下拉菜单顶部固定区域             |
| `footer`    | 下拉菜单底部固定区域             |

### 30.4 States

| 状态         | 处理方式                                    |
| ------------ | ------------------------------------------- |
| **Closed**   | 不渲染下拉内容                              |
| **Open**     | 渲染下拉面板（带进入动画：fadeIn + scaleY） |
| **Opening**  | 打开过渡中                                  |
| **Closing**  | 关闭过渡中                                  |
| **Disabled** | 触发器置灰，点击无效                        |

### 30.5 关键行为

- 使用 Teleport 渲染到 body（避免 overflow: hidden 父级裁剪）
- 自动计算位置：检测底部空间不足时自动翻转到 `top-start`
- 键盘导航：↑↓ 在选项间移动，Enter 选择，Esc 关闭
- 焦点管理：打开时聚焦第一个选项，关闭后聚焦回触发器

---

## 31. common/Modal.vue — 通用模态框

**文件路径**: `src/components/common/Modal.vue`

**职责**: 通用模态框容器，提供遮罩层、标题栏、内容区、底部操作栏的标准布局。支持多种尺寸和关闭方式。

### 31.1 Props

| 名称             | 类型                                           | 必填 | 默认值  | 说明                                      |
| ---------------- | ---------------------------------------------- | :--: | ------- | ----------------------------------------- |
| `visible`        | `boolean`                                      |  是  | —       | 模态框可见性                              |
| `title`          | `string`                                       |  否  | `''`    | 模态框标题                                |
| `size`           | `'sm' \| 'md' \| 'lg' \| 'xl' \| 'fullscreen'` |  否  | `'md'`  | 模态框尺寸                                |
| `closable`       | `boolean`                                      |  否  | `true`  | 是否显示关闭按钮                          |
| `closeOnEsc`     | `boolean`                                      |  否  | `true`  | 是否 Esc 关闭                             |
| `closeOnOverlay` | `boolean`                                      |  否  | `false` | 是否点击遮罩关闭（默认 false 防止误操作） |
| `showFooter`     | `boolean`                                      |  否  | `true`  | 是否显示底部操作栏                        |

### 31.2 Events

| 名称             | 载荷类型  | 说明               |
| ---------------- | --------- | ------------------ |
| `update:visible` | `boolean` | 模态框显示/隐藏    |
| `open`           | `void`    | 模态框打开动画完成 |
| `close`          | `void`    | 模态框关闭         |
| `closed`         | `void`    | 模态框关闭动画完成 |

### 31.3 Slots

| 名称        | 说明             |
| ----------- | ---------------- |
| `header`    | 自定义标题栏     |
| _(default)_ | 模态框主体内容   |
| `footer`    | 底部操作按钮区域 |

### 31.4 尺寸规格

| 尺寸         | 最大宽度      |
| ------------ | ------------- |
| `sm`         | 400px         |
| `md`         | 560px         |
| `lg`         | 720px         |
| `xl`         | 960px         |
| `fullscreen` | 100vw × 100vh |

### 31.5 States

| 状态        | 处理方式                                    |
| ----------- | ------------------------------------------- |
| **Closed**  | 不渲染（或 `display: none`）                |
| **Opening** | 遮罩 fadeIn + 内容 scaleUp 动画（200ms）    |
| **Open**    | 正常显示，`<body>` 添加 `overflow: hidden`  |
| **Closing** | 遮罩 fadeOut + 内容 scaleDown 动画（150ms） |

### 31.6 关键行为

- 焦点捕获：Tab 键在模态框内循环，不会移出到背景元素
- ARIA：`role="dialog"`, `aria-modal="true"`, `aria-labelledby`
- 打开模态框时，`<body>` 添加 `overflow: hidden` 防止背景滚动

---

## 32. common/Toast.vue — 通用消息提示

**文件路径**: `src/components/common/Toast.vue`

**职责**: 轻量级消息提示，从顶部或底部弹出，自动消失。支持成功/警告/错误/信息四种类型。

### 32.1 Props

| 名称       | 类型                                                               | 必填 | 默认值           | 说明                                 |
| ---------- | ------------------------------------------------------------------ | :--: | ---------------- | ------------------------------------ |
| `message`  | `string`                                                           |  是  | —                | 提示消息文字                         |
| `type`     | `'info' \| 'success' \| 'warning' \| 'error'`                      |  否  | `'info'`         | 消息类型                             |
| `duration` | `number`                                                           |  否  | `3000`           | 自动消失时间（ms），0 表示不自动消失 |
| `position` | `'top-center' \| 'top-right' \| 'bottom-center' \| 'bottom-right'` |  否  | `'top-center'`   | 弹出位置                             |
| `closable` | `boolean`                                                          |  否  | `true`           | 是否显示关闭按钮                     |
| `icon`     | `string`                                                           |  否  | 根据类型自动选择 | 自定义图标                           |

### 32.2 Events

| 名称     | 载荷类型 | 说明                           |
| -------- | -------- | ------------------------------ |
| `close`  | `void`   | 提示关闭（自动消失或手动关闭） |
| `action` | `void`   | 用户点击操作按钮（如有）       |

### 32.3 Slots

| 名称      | 说明                 |
| --------- | -------------------- |
| `icon`    | 自定义图标           |
| `message` | 自定义消息内容       |
| `action`  | 操作按钮（如"撤销"） |

### 32.4 States

| 状态         | 处理方式                         |
| ------------ | -------------------------------- |
| **Entering** | slideIn + fadeIn 动画（300ms）   |
| **Visible**  | 正常显示，计时器运行             |
| **Leaving**  | slideOut + fadeOut 动画（200ms） |

### 32.5 类型样式

| 类型      | 图标 | 背景色               | 边框色            |
| --------- | ---- | -------------------- | ----------------- |
| `info`    | ℹ️   | `--color-info-bg`    | `--color-info`    |
| `success` | ✓    | `--color-success-bg` | `--color-success` |
| `warning` | ⚠    | `--color-warning-bg` | `--color-warning` |
| `error`   | ✕    | `--color-error-bg`   | `--color-error`   |

### 32.6 全局 Toast 管理器

```typescript
// 通过 provide/inject 提供全局 toast 方法
interface ToastAPI {
  show(message: string, type?: ToastType, duration?: number): void;
  success(message: string, duration?: number): void;
  warning(message: string, duration?: number): void;
  error(message: string, duration?: number): void;
  info(message: string, duration?: number): void;
  dismiss(): void;
}
```

---

## 33. common/ContextMenu.vue — 通用右键菜单

**文件路径**: `src/components/common/ContextMenu.vue`

**职责**: 通用右键上下文菜单。在鼠标位置弹出菜单选项列表，支持分组、分隔线、快捷键提示、子菜单。

### 33.1 Props

| 名称           | 类型                | 必填 | 默认值 | 说明                  |
| -------------- | ------------------- | :--: | ------ | --------------------- |
| `visible`      | `boolean`           |  是  | —      | 菜单可见性            |
| `x`            | `number`            |  否  | `0`    | 菜单弹出 X 坐标（px） |
| `y`            | `number`            |  否  | `0`    | 菜单弹出 Y 坐标（px） |
| `items`        | `ContextMenuItem[]` |  是  | —      | 菜单项列表            |
| `closeOnClick` | `boolean`           |  否  | `true` | 点击菜单项后是否关闭  |

### 33.2 ContextMenuItem 类型

```typescript
interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string; // 快捷键提示
  disabled?: boolean;
  danger?: boolean; // 危险操作（红色文字）
  divider?: boolean; // 此项是否为分隔线
  children?: ContextMenuItem[]; // 子菜单
  action?: () => void; // 点击回调
}
```

### 33.3 Events

| 名称             | 载荷类型                                    | 说明           |
| ---------------- | ------------------------------------------- | -------------- |
| `update:visible` | `boolean`                                   | 菜单显示/隐藏  |
| `select`         | `{ itemId: string; item: ContextMenuItem }` | 选择某个菜单项 |

### 33.4 Slots

| 名称     | 说明               |
| -------- | ------------------ |
| `item`   | 自定义菜单项渲染   |
| `header` | 菜单顶部自定义内容 |
| `footer` | 菜单底部自定义内容 |

### 33.5 States

| 状态            | 处理方式                                  |
| --------------- | ----------------------------------------- |
| **Closed**      | 不渲染                                    |
| **Opening**     | 在 `(x, y)` 处弹出，scaleIn 动画（100ms） |
| **Open**        | 正常显示菜单列表                          |
| **SubmenuOpen** | 子菜单在父菜单右侧展开                    |

### 33.6 关键行为

- Teleport 到 body
- 自动方向检测：右边缘空间不足时向左弹出，下边缘空间不足时向上弹出
- 点击外部或按 Esc 关闭
- 键盘导航：↑↓ 移动选中项，→ 展开子菜单，← 关闭子菜单，Enter 选择
- 分隔线渲染为 `<hr>` 元素

---

## 34. WelcomePage.vue — 首次启动引导页

### 34.1 概述

WelcomePage 是 MarkLuck 的首次启动引导页。当用户首次打开应用、没有打开过任何笔记本时显示。引导用户选择本地文件夹作为笔记本根目录，或创建新的笔记本文件夹。

### 34.2 Props

| Prop              | 类型       | 必填 | 默认值 | 说明                     |
| ----------------- | ---------- | :--: | ------ | ------------------------ |
| `recentNotebooks` | `string[]` |      | `[]`   | 最近使用的笔记本路径列表 |

### 34.3 Events

| Event            | Payload                          | 说明                           |
| ---------------- | -------------------------------- | ------------------------------ |
| `openNotebook`   | `NotebookHandle`                 | 用户选择了已有文件夹作为笔记本 |
| `createNotebook` | `{ path: string; name: string }` | 用户创建了新的笔记本文件夹     |

### 34.4 Slots

无。

### 34.5 状态

| 状态           | 条件                                  | UI 表现                                              |
| -------------- | ------------------------------------- | ---------------------------------------------------- |
| **Normal**     | 正常显示                              | 显示引导文案 + "打开文件夹"按钮 + "创建新笔记本"按钮 |
| **RecentList** | `recentNotebooks.length > 0`          | 额外显示最近使用的笔记本列表，点击可快速打开         |
| **Error**      | 文件夹选择失败（权限不足 / 路径无效） | 显示错误提示 + 重试按钮                              |

### 34.6 引导文案

- 主标题："欢迎使用 MarkLuck"
- 副标题："打开一个本地文件夹开始记笔记。你的数据完全由你掌控。"
- 打开按钮文字："打开笔记本文件夹"
- 创建按钮文字："创建新笔记本"
- 最近列表标题："最近使用"

### 34.7 交互规则

- 点击"打开笔记本文件夹" → 调用 `IFileSystemService.openNotebook()` → emit `openNotebook`
- 点击"创建新笔记本" → 弹出文件夹创建对话框 → 创建文件夹 → emit `createNotebook`
- 点击最近列表中的项目 → emit `openNotebook`
- 状态切换：WelcomePage 仅在 `NotebookHome` 状态为 `INIT` 或 `EMPTY` 时显示

---

## 35. 附录：组件间事件总线约定

### 34.1 事件命名规范

```
组件名:动作          例: file-tree:node-selected
                    例: editor:content-changed
```

### 34.2 全局事件列表

| 事件名                    | 载荷                          | 发送方                    | 消费方                       |
| ------------------------- | ----------------------------- | ------------------------- | ---------------------------- |
| `app:theme-changed`       | `ThemeMode`                   | SettingsPanel / StatusBar | AppLayout + 所有组件         |
| `app:language-changed`    | `'zh-CN' \| 'en'`             | SettingsPanel             | 所有含国际化文字的组件       |
| `file-tree:note-selected` | `NotePath`                    | FileTree                  | EditorArea                   |
| `file-tree:note-created`  | `NotePath`                    | FileTree                  | EditorArea (自动打开)        |
| `file-tree:note-deleted`  | `NotePath`                    | FileTree                  | EditorArea (关闭对应标签页)  |
| `editor:content-saved`    | `NotePath`                    | EditorArea                | StatusBar, FileTree          |
| `editor:external-change`  | `NotePath`                    | IFileSystemService.watch  | EditorArea (冲突提示)        |
| `search:tag-selected`     | `string`                      | TagPanel                  | SearchPanel (打开并搜索)     |
| `search:result-selected`  | `SearchResult`                | SearchResultList          | EditorArea (打开笔记+跳转)   |
| `index:rebuilt`           | `void`                        | SettingsPanel             | useIndexStore → 刷新所有面板 |
| `toast:show`              | `{ message, type, duration }` | 任意组件                  | Toast 容器                   |
| `modal:open`              | `{ name, props }`             | 任意组件                  | App.vue (模态框管理器)       |
| `modal:close`             | `string (name)`               | Modal 组件                | App.vue                      |

### 34.3 Store 直接通信约定

对于不需要跨组件广播的状态同步，组件通过 Pinia Store 直接通信，不发事件：

- 编辑器内容变更 → `useEditorStore.setContent()`
- 文件树展开/折叠 → `useNotebookStore` 的 fileTree 节点 `isOpen` 属性
- 主题切换 → `useThemeStore.setMode()`
- 搜索执行 → `useSearchStore.search()`

---

> **文档维护规则**: 每次新增/修改/删除组件时，必须同步更新本文档。Props/Events/Slots 的变更即 API 变更，需走 Code Review。
