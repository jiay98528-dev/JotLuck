# MarkLuck 页面规格

> 版本：v1.0 | 日期：2026-06-17 | 基线冻结
> 描述：路由表、页面状态机、数据流定义

---

## 1. 路由表

| 路径               | 名称        | 组件           | 懒加载 | 说明         |
| ------------------ | ----------- | -------------- | :----: | ------------ |
| `/`                | `home`      | `NotebookHome` |   是   | 主编辑器页面 |
| `/:pathMatch(.*)*` | `not-found` | `NotebookHome` |   是   | 通配符兜底   |

**路由实现**：`packages/app/src/router/index.ts` — 使用 `createWebHistory()`，无 hash 模式。通配符路由将所有未匹配路径也导向 NotebookHome，由应用内部自行处理"无此笔记"场景。

---

## 2. NotebookHome 页面状态机

### 2.1 顶层状态

```
                    ┌─────────────────┐
                    │   页面挂载       │
                    └───────┬─────────┘
                            │
                            ▼
                    ┌───────────────┐
                    │    Loading    │  loading = true
                    │  (骨架屏)     │  errorMessage = ''
                    └───────┬───────┘
                            │
              ┌─────────────┼──────────────┐
              ▼             │              ▼
      ┌───────────┐        │      ┌──────────────┐
      │   Error   │        │      │    Empty     │
      │ 加载失败  │        │      │  无笔记打开  │
      │ 重试按钮  │        │      │  空状态引导  │
      └─────┬─────┘        │      └──────┬───────┘
            │              │             │
            │ 点击重试     │             │ 用户打开/创建笔记
            ▼              │             ▼
      ┌───────────┐       │      ┌──────────────┐
      │  Loading  │◄──────┘      │   Normal     │
      └───────────┘              │  编辑器就绪  │
                                 └──────────────┘
```

#### Loading

- **触发**：`onMounted` → `initNotebook()` 开始时设置 `loading = true`
- **UI**：骨架屏占位（AppShell 布局骨架，编辑器区域显示加载动画）
- **退出**：`initNotebook()` 完成（`finally` 块设置 `loading = false`）
- **数据**：
  - 调用 `fs.listDirectory('/')` 加载根目录文件列表
  - 调用 `indexStore.initialize(fs)` 构建全文索引

#### Empty

- **条件**：`loading = false` 且 `activePath = ''`（无笔记打开）
- **UI**：AppShell 完整布局就绪，编辑器区域显示空状态引导文案："打开左侧文件抽屉选择笔记，或 Ctrl+N 创建新笔记"
- **可操作**：Ctrl+K 打开命令面板、点击左翼书签创建按钮打开模板对话框、Ctrl+N 新建空白笔记

#### Error

- **条件**：`loading = false` 且 `errorMessage != ''`
- **触发**：`initNotebook()` 中 `loadDirectory('/')` 抛出异常
- **UI**：AppShell 布局就绪，编辑器区域显示错误提示 + 重试按钮
- **数据**：`errorMessage` 为异常信息字符串
- **操作**：
  - 点击"重试"按钮 → 调用 `initNotebook()` 重新加载
  - 文件抽屉组件 (`FileDrawer`) 同样接收 `error` / `loading` / `retry` props，独立展示错误状态

#### Normal

- **条件**：`loading = false` 且 `activePath != ''`（有笔记打开）
- **UI**：编辑器就绪，根据 `viewMode` 渲染不同编辑布局（见 §2.2）
- **数据流**：`currentContent` ← 文件读取 / 用户编辑 → 自动保存（600ms debounce）→ `fs.writeFile()` → `indexStore.refreshDocument()`

### 2.2 Normal 子状态

#### 2.2.1 编辑器保存状态

```
Clean ──(用户编辑)──► Dirty ──(600ms debounce)──► Saving ──(成功)──► Clean
  ▲                      │                           │
  │                      │                           ▼
  │                      │                        Error (saveError != null)
  │                      │                           │
  └──────────────────────┴───────────────────────────┘
                         (继续编辑触发新保存)
```

| 状态   | 标志位                                | StatusBar 显示                         |
| ------ | ------------------------------------- | -------------------------------------- |
| Clean  | `isDirty = false`, `isSaving = false` | "已保存" + `lastSavedAt` 时间戳        |
| Dirty  | `isDirty = true`, `isSaving = false`  | "未保存"（dot 指示器）                 |
| Saving | `isSaving = true`                     | "保存中..."（spinner）                 |
| Error  | `saveError != null`                   | 错误信息（红色）+ 自动重试（下次编辑） |

**并发控制**：`saveGeneration` 计数器 — 每次新保存递增，回调中检查 `gen !== saveGeneration` 则丢弃过期结果。

**自动保存**：用户输入 → `onContentUpdate()` → 清除旧 timer → 600ms debounce → `debouncedSave(path, content)`。

**切换笔记前保存**：`onSelectNote()` 中检查 `isDirty`，若为 true 则先 `await debouncedSave()` 再切换。

#### 2.2.2 视图模式

| 模式  | `viewMode` 值 | 编辑器渲染                                                                      | 切换方式               |
| ----- | :-----------: | ------------------------------------------------------------------------------- | ---------------------- |
| Live  |    `live`     | 单个 `MarkdownEditor`，`live-preview = true`                                    | 点击右上角视图切换按钮 |
| Split |    `split`    | 左：`MarkdownEditor`（`live-preview = false`）+ 右：`splitPreviewHtml` 渲染预览 | 点击右上角视图切换按钮 |

**视图切换按钮**：位于编辑器右上角，显示当前模式标签（"即时"/"分栏"），hover 提示下一个模式。点击循环切换 `['split', 'live']`。

**分栏拖拽**：`splitRatio`（默认 50），范围 [30, 70]。拖拽分栏线 (`split-divider`) 调整左右比例，`mousedown` → `mousemove` → `mouseup` 清理。

**分栏预览渲染**：`updateSplitPreview()` — 50ms debounce 后对完整文档调用一次 `renderMarkdown()`，再通过 `highlightCodeBlocks()` 应用语法高亮。禁止逐行包装独立段落。

**分栏视觉约束**：左侧使用纯 Markdown 源码排版，不应用标题字号、粗体等渲染态视觉样式；右侧第一行必须位于固定格式栏下方，不得被遮挡。

**Live 模式交互**：

- Wiki-link 点击 → `onLivePreviewWikiLinkClick()` → 查找目标笔记 → `onSelectNote()`
- Tag 点击 → `onLivePreviewTagClick()` → `searchStore.open()` + 打开命令面板
- 外部链接点击 → `onLivePreviewExternalLinkClick()` → `window.open()` 新标签页

#### 2.2.3 抽屉与面板状态

| 组件            | 状态变量                 | 初始值  | 触发打开                                | 触发关闭                                     |
| --------------- | ------------------------ | :-----: | --------------------------------------- | -------------------------------------------- |
| 文件抽屉 (左滑) | `showLeftDrawer`         | `false` | 左翼按钮 / TopBar 汉堡菜单              | 选择文件后自动关闭 / 点击遮罩 / 再次点击按钮 |
| 命令面板        | `searchVisible`          | `false` | Ctrl+K / Ctrl+Shift+P / TopBar 搜索按钮 | 选择结果 / Esc / 点击遮罩                    |
| 导出对话框      | `showExport`             | `false` | TopBar 导出按钮 / 命令面板快捷操作      | 对话框内关闭 / 点击遮罩                      |
| 模板对话框      | `showTemplate`           | `false` | 左翼新建按钮 / 命令面板快捷操作         | 选择模板后自动关闭 / 点击遮罩                |
| 设置对话框      | `showSettings`           | `false` | 左翼设置按钮 / 命令面板快捷操作         | 对话框内关闭 / 点击遮罩                      |
| 分享对话框      | `showShare`              | `false` | TopBar 分享按钮                         | 对话框内关闭 / 点击遮罩                      |
| 新建文件对话框  | `showNewFileDialog`      | `false` | 文件抽屉内"新建文件"按钮                | 确认/取消 / 点击遮罩                         |
| 右翼面板        | `showRightWing`          | `true`  | 默认显示 / 右翼折叠按钮                 | 右翼折叠按钮                                 |
| 更新通知        | `showUpdateNotification` | 见下表  | 挂载 15s 后检查到新版本                 | 关闭 / 忽略此版本                            |

**文件抽屉自动关闭（Overlay 遮挡防护）**：选择笔记后 `showLeftDrawer = false`，模板选择后 `showTemplate = false`。遵循 tool.md §5.9 规则 — 改变全局 UI 状态的交互完成后必须关闭 overlay。

#### 2.2.4 格式气泡

| 触发条件                        | 状态                                       |
| ------------------------------- | ------------------------------------------ |
| 编辑器内选中文字（非空选区）    | `bubbleVisible = true`，定位到选区中心上方 |
| 选区清空 / 无选区               | `bubbleVisible = false`                    |
| 点击格式按钮（B/I/S/Code/Link） | 应用格式 → `bubbleVisible = false`         |

**首次使用提示**：`localStorage` 键 `markluck:formatBubble:hintShown`，首次选中文字时显示一次性 toast 提示。

---

## 3. WelcomePage 状态

WelcomePage 是 Teleport 到 `<body>` 的首次引导向导，通过 `localStorage` 持久化完成状态。

### 3.1 状态机

```
                  ┌──────────────────────┐
                  │   页面挂载            │
                  │   onMounted()         │
                  └──────────┬───────────┘
                             │
              ┌──────────────┴──────────────┐
              │ 检查 localStorage            │
              │ 'markluck:welcome:completed' │
              └──────────────┬──────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              │              ▼
      ┌───────────────┐     │      ┌───────────────┐
      │   Active      │     │      │  Dismissed    │
      │  visible=true │     │      │ visible=false │
      │  显示引导向导 │     │      │ 永久关闭      │
      └───────┬───────┘     │      └───────────────┘
              │             │
    ┌─────────┼─────────┐   │
    │ 完成/跳过 │ 点击遮罩│   │
    ▼         ▼         ▼   │
  complete() complete() 检查 localStorage
    │         │         若 completed='1' → emit('update:visible', false)
    ▼         ▼
  localStorage.setItem('markluck:welcome:completed', '1')
  emit('complete')
    │
    ▼
  Dismissed (visible=false)
```

### 3.2 Props & Events

| 成员             | 类型                       | 说明                 |
| ---------------- | -------------------------- | -------------------- |
| `visible`        | `boolean` (prop)           | 父组件控制显隐       |
| `update:visible` | `(boolean) => void` (emit) | v-model 双向绑定     |
| `complete`       | `() => void` (emit)        | 引导完成时通知父组件 |

### 3.3 步骤子状态

引导共 5 步，`currentStep` 从 1 到 5。

| 步骤 | 标题                           | 内容                                                                     | 交互                                  |
| :--: | ------------------------------ | ------------------------------------------------------------------------ | ------------------------------------- |
|  1   | 不绑定工具，你的笔记永远属于你 | .md 纯文本 + 文件夹即笔记本 + 任意工具打开                               | 点击"下一步"                          |
|  2   | 你的隐私永远是底线             | 完全离线 + 基于算法的文字补全 + 本地学习习惯                             | 点击"下一步"                          |
|  3   | MarkLuck 能为你做什么？        | 即时渲染 / Wiki-link / 模板 / 全文搜索 / 多格式导出                      | 点击"下一步"                          |
|  4   | 把我设为默认编辑器？           | 双击 .md 即刻编辑。按钮调用 Tauri API（Web 端 no-op）                    | "设为默认编辑器" / "暂不设置"         |
|  5   | 需要我保持最新版本么？         | 自动检查更新设置（toggle + radio）+ 自动安装（暂不可用，代码签名待完成） | toggle 切换 + 选择 radio + "完成设置" |

**步骤指示器**：5 个圆点 + 4 条连线，已完成步骤高亮（accent 色），当前步骤圆点放大 (scale 1.25)。

**步骤过渡动效**：`step-slide` transition — 进入从右侧滑入 + 淡入，离开向左侧滑出 + 淡出。

### 3.4 localStorage 持久化键

| 键                             | 值       | 说明                         |
| ------------------------------ | -------- | ---------------------------- |
| `markluck:welcome:completed`   | `'1'`    | 引导是否已完成               |
| `markluck:version:autoCheck`   | `'true'` | 自动检查更新开关             |
| `markluck:version:autoInstall` | `'true'` | 自动安装更新开关（暂不可用） |

---

## 4. 页面数据流

### 4.1 NotebookHome 数据依赖

```
NotebookHome
  ├── fs: IFileSystemService          ← createFileSystem()  (TauriIPC | MockFS)
  │   ├── listDirectory(dir)          → files: DirEntry[]
  │   ├── readFile(path)             → currentContent: string
  │   ├── writeFile(path, content)
  │   ├── statFile(path)             → FileStat
  │   ├── deleteFile(path)
  │   └── renameFile(old, new)
  │
  ├── indexStore: useIndexStore()     ← indexService.buildFullIndex()
  │   ├── recentNotes                → LeftWing 书签列表
  │   ├── tags                       → RightWing 标签面板
  │   ├── getBacklinks(path)         → RightWing 反向链接面板
  │   └── getIndexService()          → MarkdownPredictor 结构化补全数据
  │
  ├── searchStore: useSearchStore()   ← 命令面板搜索
  │   ├── open(query?) / close()
  │   └── results / query / isVisible
  │
  ├── theme: useThemeStore()          ← 亮/暗色方案
  │   └── toggleColorScheme()
  │
  └── headings: useHeadings()         ← 当前文档标题树
      └── update(content) / getActiveHeadingId(line)
```

### 4.2 笔记加载完整链路

```
用户点击笔记 / 创建笔记
  → onSelectNote(path) / onTemplateSelect(content)
    → 1. 刷新未保存内容 (isDirty → debouncedSave)
    → 2. loading = true, 重置状态
    → 3. fs.readFile(path) → content
    → 4. activePath = path, currentContent = content  (同步赋值，编辑器立即挂载)
    → 5. loadDirectory(dir) → files 更新
    → 6. updateHeadings(content) → 更新目录树
    → 7. updateEditorStats(content) → 更新状态栏字数统计
    → 8. updateSplitPreview() → 更新分栏预览 (如 viewMode='split')
    → 9. indexStore.refreshDocument(fs, path) → 更新索引/标签/反向链接
    → 10. showLeftDrawer = false  (关闭文件抽屉)
    → 11. loading = false
```

### 4.3 保存完整链路

```
用户编辑内容
  → onContentUpdate(content) / onSplitContentUpdate(content)
    → 1. currentContent = content (同步)
    → 2. updateHeadings(content) (同步)
    → 3. updateEditorStats(content) (同步)
    → 4. isDirty = true, saveError = null
    → 5. 清除旧 saveTimer → 新 600ms debounce
    ── 600ms 后 ──
  → debouncedSave(path, content)
    → 1. saveGeneration++
    → 2. isSaving = true
    → 3. fs.writeFile(path, content)
    → 4. indexStore.refreshDocument(fs, path)
    → 5. lastSavedAt = Date.now()
    → 6. 确保至少展示 500ms "保存中"状态
    → 7. isDirty = false, isSaving = false
    → 8. 若 writeFile 抛出异常 → saveError = String(e)
```

---

## 5. 跨页面状态

### 5.1 主题持久化

`useThemeStore` 是全局单例，在 `NotebookHome.onMounted()` 中调用 `theme.init()` 初始化。通过 `<html data-color-scheme="light|dark">` 切换，`localStorage` 键 `markluck-theme` 持久化。

### 5.2 引导完成状态

`WelcomePage` 的完成状态通过 `localStorage` 键 `markluck:welcome:completed` 跨会话持久化。父组件（App.vue）控制 WelcomePage 的 `visible` prop，完成时接收 `complete` 事件。

### 5.3 搜索历史

`useSearchStore` 管理搜索历史（`localStorage` 键 `markluck-search-history`），最多保留 10 条，跨页面共享。
