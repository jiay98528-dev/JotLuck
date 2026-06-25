# MarkLuck 组件规格文档

> 版本：v1.0 | 日期：2026-06-17 | 基于 `packages/app/src/components/` 下所有 `.vue` 文件自动提取
>
> 每个组件记录：Props（含默认值）、Emits、Slots、Expose（如有）。

---

## 目录

- [common/](#common)
  - [Button](#button)
  - [ContextMenu](#contextmenu)
  - [Toast](#toast)
- [editor/](#editor)
  - [FormatBubble](#formatbubble)
  - [FormatToolbar](#formattoolbar)
  - [EditorControlStrip](#editorcontrolstrip)
  - [StudioRail](#studiorail)
  - [MarkdownEditor](#markdowneditor)
  - [StatusBar](#statusbar)
  - [TopBar](#topbar)
- [file-tree/](#file-tree)
  - [Breadcrumb](#breadcrumb)
- [layout/](#layout)
  - [AppShell](#appshell)
  - [LeftWing](#leftwing)
  - [RightWing](#rightwing)
- [modals/](#modals)
  - [ExportDialog](#exportdialog)
  - [SettingsDialog](#settingsdialog)
  - [ShareDialog](#sharedialog)
  - [TemplateDialog](#templatedialog)
- [theme/](#theme)
  - [ThemeEffectLayer](#themeeffectlayer)
  - [ThemeGallery](#themegallery)
  - [ThemePreviewDrawer](#themepreviewdrawer)
- [overlays/](#overlays)
  - [CommandPalette](#commandpalette)
  - [FileDrawer](#filedrawer)
  - [MarkdownCheatSheet](#markdowncheatsheet)
  - [UpdateNotification](#updatenotification)

---

## common/

### Button

路径：`packages/app/src/components/common/Button.vue`

通用按钮组件，支持多种变体/尺寸，内置 loading 和 icon 插槽。

#### Props

| Prop       | 类型                                                                          | 必需 | 默认值      | 说明                       |
| ---------- | ----------------------------------------------------------------------------- | :--: | ----------- | -------------------------- |
| `variant`  | `'default' \| 'secondary' \| 'outline' \| 'ghost' \| 'destructive' \| 'link'` |  否  | `'default'` | 按钮变体                   |
| `size`     | `'sm' \| 'md' \| 'lg' \| 'icon-sm' \| 'icon' \| 'icon-lg'`                    |  否  | `'md'`      | 按钮尺寸                   |
| `disabled` | `boolean`                                                                     |  否  | `false`     | 禁用状态                   |
| `loading`  | `boolean`                                                                     |  否  | `false`     | 加载中状态（显示 spinner） |
| `type`     | `'button' \| 'submit' \| 'reset'`                                             |  否  | `'button'`  | HTML button type           |

#### Slots

| Slot 名称    | 说明                       |
| ------------ | -------------------------- |
| `default`    | 按钮文字标签               |
| `icon-left`  | 左侧图标（loading 时隐藏） |
| `icon-right` | 右侧图标                   |

#### Emits

无显式 Emits。通过 `v-bind="$attrs"` 透传原生事件。

---

### ContextMenu

路径：`packages/app/src/components/common/ContextMenu.vue`

右键上下文菜单，支持一级子菜单 fly-out、键盘导航、自动定位翻转。

#### Props

| Prop      | 类型                | 必需 | 默认值 | 说明                      |
| --------- | ------------------- | :--: | ------ | ------------------------- |
| `visible` | `boolean`           |  是  | —      | 菜单可见性                |
| `x`       | `number`            |  是  | —      | 锚点 X 坐标 (viewport px) |
| `y`       | `number`            |  是  | —      | 锚点 Y 坐标 (viewport px) |
| `items`   | `ContextMenuItem[]` |  是  | —      | 菜单项数组                |

> `ContextMenuItem` 类型定义见 `@/types`。支持 `divider`、`danger`、`disabled`、`children` (子菜单)、`shortcut`、`action` 字段。

#### Emits

| Event            | Payload                 | 说明                   |
| ---------------- | ----------------------- | ---------------------- |
| `update:visible` | `value: boolean`        | v-model 可见性双向绑定 |
| `select`         | `item: ContextMenuItem` | 用户选择了某个菜单项   |

#### Slots

无。

---

### Toast

路径：`packages/app/src/components/common/Toast.vue`

全局通知系统。模块级响应式状态，`<Toast />` 挂载一次，任意代码调 `useToast()` 即可弹出通知。

#### Props

| Prop         | 类型                                                               | 必需 | 默认值         | 说明               |
| ------------ | ------------------------------------------------------------------ | :--: | -------------- | ------------------ |
| `position`   | `'top-center' \| 'top-right' \| 'bottom-center' \| 'bottom-right'` |  否  | `'top-center'` | 通知容器定位       |
| `maxVisible` | `number`                                                           |  否  | `5`            | 最大同时可见通知数 |

#### Emits

| Event    | Payload                             | 说明                       |
| -------- | ----------------------------------- | -------------------------- |
| `close`  | `toastId: number`                   | 用户关闭了某条通知         |
| `action` | `toastId: number, toast: ToastItem` | 用户点击了通知上的操作按钮 |

#### Slots

| Slot 名称 | Slot Props  | 说明         |
| --------- | ----------- | ------------ |
| `icon`    | `{ toast }` | 通知图标     |
| `message` | `{ toast }` | 通知消息正文 |
| `action`  | `{ toast }` | 操作按钮文字 |

#### 导出的 Composable

`useToast(): ToastAPI`

| 方法                          | 说明                          |
| ----------------------------- | ----------------------------- |
| `show(msg, type?, duration?)` | 显示通知（默认 info, 3000ms） |
| `success(msg, duration?)`     | 成功通知 (3000ms)             |
| `warning(msg, duration?)`     | 警告通知 (3000ms)             |
| `error(msg, duration?)`       | 错误通知 (0ms = 持久不消失)   |
| `info(msg, duration?)`        | 信息通知 (3000ms)             |
| `dismiss()`                   | 关闭所有通知                  |

---

## editor/

### FormatBubble

路径：`packages/app/src/components/editor/FormatBubble.vue`

浮动格式气泡，选中文本时出现在选区上方。提供行内格式和清除格式的就近快捷操作；固定的 Word 式预设由 `FormatToolbar` 承担。

#### Props

| Prop       | 类型                       | 必需 | 默认值         | 说明                |
| ---------- | -------------------------- | :--: | -------------- | ------------------- |
| `visible`  | `boolean`                  |  否  | `false`        | 父组件控制显示/隐藏 |
| `position` | `{ x: number; y: number }` |  否  | `{ x:0, y:0 }` | 选区中心像素坐标    |

#### Emits

| Event    | Payload              | 说明               |
| -------- | -------------------- | ------------------ |
| `format` | `type: FormatAction` | 应用或切换格式动作 |

#### Slots

无。

#### 行为

- 150ms 延迟后 scale+opacity 入场动画
- 3s 无操作自动隐藏
- Esc 键隐藏
- 点击气泡外隐藏
- 行内格式为幂等切换：相同格式再次执行时移除定界符，不允许产生 `****文字****` 等重复嵌套
- 无论选区包含定界符还是只包含定界符内部文字，都必须能识别并移除已有格式
- “清除格式”移除常见行内定界符及标题/引用前缀，保留纯文本内容
- 格式操作完成后恢复编辑器焦点并选中格式化后的正文，下一次键盘或 IME 输入直接进入编辑器

---

### FormatToolbar

路径：`packages/app/src/components/editor/FormatToolbar.vue`

格式控件栏。左侧为段落样式预设，右侧为常用行内格式与清除格式；具体落点由 `EditorControlStrip` 或 `StudioRail` 承载。

#### Props

| Prop           | 类型                                  | 必需 | 默认值        | 说明                     |
| -------------- | ------------------------------------- | :--: | ------------- | ------------------------ |
| `preset`       | `ParagraphPreset`                     |  否  | `'paragraph'` | 当前/待输入段落样式      |
| `activeAction` | `FormatAction \| null`                |  否  | `null`        | 当前预选输入格式         |
| `density`      | `'calm' \| 'compact' \| 'productive'` |  否  | `'calm'`      | 官方主题控制的工具栏密度 |

#### Emits

| Event    | Payload              | 说明               |
| -------- | -------------------- | ------------------ |
| `format` | `type: FormatAction` | 应用或切换格式动作 |

#### 行为

- 始终可见，段落预设为“正文、标题 1、标题 2、标题 3、引用”
- 固定栏采用预选式输入：先选择格式，再输入匹配格式的文字；不修改当前选区，选区后改格式由 `FormatBubble` 负责
- 行内格式激活时预插入成对 Markdown 定界符并把光标置于中间，按钮显示 active 状态
- 段落预设激活时只修改光标所在输入行的前缀
- 非 IME composition 的 Enter 结束当前预选格式，新行恢复正文；IME 候选确认 Enter 不结束格式
- 再次点击当前格式或点击“清除格式”会退出预选状态
- 窄屏保持单行，允许横向滚动并显示细滚动条，不压缩正文编辑宽度
- 所有按钮具备 hover、focus-visible、active、disabled 状态与中文 ARIA 标签

```typescript
type ParagraphPreset = 'paragraph' | 'heading1' | 'heading2' | 'heading3' | 'blockquote';

type FormatAction =
  | ParagraphPreset
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'inlineCode'
  | 'link'
  | 'clear';
```

---

### EditorControlStrip

路径：`packages/app/src/components/editor/EditorControlStrip.vue`

编辑区上方的主题工作流控制条。普通主题渲染标准工具条，墨线书房渲染窄写作条，夜读/工坊由主题 chrome 隐藏或交给 `StudioRail`。

#### Props

| Prop           | 类型                                                        | 必需 | 默认值        | 说明                     |
| -------------- | ----------------------------------------------------------- | :--: | ------------- | ------------------------ |
| `layout`       | `'toolbar' \| 'writing-strip' \| 'hidden' \| 'studio-rail'` |  否  | `'toolbar'`   | 官方主题控制的控件形态   |
| `actions`      | `ShellAction[]`                                             |  否  | `[]`          | 放在编辑控件区的统一动作 |
| `preset`       | `ParagraphPreset`                                           |  否  | `'paragraph'` | 当前/待输入段落样式      |
| `activeAction` | `FormatAction \| null`                                      |  否  | `null`        | 当前预选输入格式         |
| `density`      | `'calm' \| 'compact' \| 'productive'`                       |  否  | `'calm'`      | 官方主题控制的工具密度   |

#### Emits

| Event    | Payload              | 说明               |
| -------- | -------------------- | ------------------ |
| `format` | `type: FormatAction` | 应用或切换格式动作 |

---

### StudioRail

路径：`packages/app/src/components/editor/StudioRail.vue`

工坊轨道主题的纵向紧凑生产工具轨。模板、导出、分享、视图切换和多文件入口在该区域前置，格式按钮以 compact 密度合入同一轨道，使工坊主题的主操作从顶栏迁移到编辑区侧边轨道。

#### Props

| Prop           | 类型                   | 必需 | 默认值        | 说明                |
| -------------- | ---------------------- | :--: | ------------- | ------------------- |
| `actions`      | `ShellAction[]`        |  否  | `[]`          | 生产轨内渲染的动作  |
| `preset`       | `ParagraphPreset`      |  否  | `'paragraph'` | 当前/待输入段落样式 |
| `activeAction` | `FormatAction \| null` |  否  | `null`        | 当前预选输入格式    |

#### Emits

| Event    | Payload              | 说明               |
| -------- | -------------------- | ------------------ |
| `format` | `type: FormatAction` | 应用或切换格式动作 |

---

### MarkdownEditor

路径：`packages/app/src/components/editor/MarkdownEditor.vue`

CodeMirror 6 编辑器封装。支持 v-model、块解析、实时预览、幽灵文本补全。

#### Props

| Prop                             | 类型                                                             | 必需 | 默认值  | 说明                               |
| -------------------------------- | ---------------------------------------------------------------- | :--: | ------- | ---------------------------------- |
| `modelValue`                     | `string`                                                         |  是  | —       | 编辑器内容 (v-model)               |
| `blocks`                         | `MarkdownBlock[]`                                                |  否  | `[]`    | 解析后的 Markdown 块               |
| `readOnly`                       | `boolean`                                                        |  否  | `false` | 只读模式                           |
| `showLineNumbers`                | `boolean`                                                        |  否  | `false` | 显示行号                           |
| `livePreview`                    | `boolean`                                                        |  否  | `false` | 开启实时预览（块级渲染）           |
| `sourceOnly`                     | `boolean`                                                        |  否  | `false` | 纯源码排版，禁用标题放大等语义样式 |
| `pendingFormat`                  | `FormatAction \| null`                                           |  否  | `null`  | 固定栏预选输入格式                 |
| `enableAutocomplete`             | `boolean`                                                        |  否  | `true`  | 开启幽灵文本补全                   |
| `onLivePreviewExternalLinkClick` | `(href: string) => void`                                         |  否  | —       | 预览中点击外部链接回调             |
| `onLivePreviewTagClick`          | `(tag: string) => void`                                          |  否  | —       | 预览中点击标签回调                 |
| `onLivePreviewWikiLinkClick`     | `(note: string, anchor: null \| string) => void`                 |  否  | —       | 预览中点击 Wiki-link 回调          |
| `onEditorDrop`                   | `(event: DragEvent) => void`                                     |  否  | —       | 拖放事件回调                       |
| `onEditorDragOver`               | `(event: DragEvent) => void`                                     |  否  | —       | 拖拽悬停回调                       |
| `onEditorPaste`                  | `(event: ClipboardEvent) => boolean \| void \| Promise<boolean>` |  否  | —       | 粘贴事件回调                       |

#### Emits

| Event                  | Payload                                     | 说明                          |
| ---------------------- | ------------------------------------------- | ----------------------------- |
| `update:modelValue`    | `value: string`                             | v-model 内容更新              |
| `blocks-updated`       | `blocks: MarkdownBlock[]`                   | 块解析结果更新                |
| `selection-change`     | `sel: { from: number; to: number } \| null` | 选区变化（失去焦点时为 null） |
| `pending-format-ended` | —                                           | 用户换行或主动退出预选格式    |

#### Expose

| 方法/属性         | 类型                       | 说明                     |
| ----------------- | -------------------------- | ------------------------ |
| `getEditorView()` | `() => EditorView \| null` | 获取 CM6 EditorView 实例 |
| `focus()`         | `() => void`               | 聚焦编辑器               |
| `predictor`       | `MarkdownPredictor`        | 共享的 N-gram 预测器实例 |

#### Slots

无（纯 div 容器，内容由 CodeMirror 接管）。

---

### StatusBar

路径：`packages/app/src/components/editor/StatusBar.vue`

编辑器底部状态栏。默认三区布局：左（光标位置）/ 中（字词统计）/ 右（保存状态）。夜读主题可切换为仅保存状态，工坊轨道可切换为紧凑布局。

#### Props

| Prop          | 类型                                            | 必需 | 默认值   | 说明                                |
| ------------- | ----------------------------------------------- | :--: | -------- | ----------------------------------- |
| `charCount`   | `number`                                        |  否  | `0`      | 字符总数                            |
| `wordCount`   | `number`                                        |  否  | `0`      | 单词总数                            |
| `lineCount`   | `number`                                        |  否  | `0`      | 行总数                              |
| `cursorLine`  | `number \| null`                                |  否  | `null`   | 光标行号 (1-based)，无光标时为 null |
| `cursorCol`   | `number \| null`                                |  否  | `null`   | 光标列号 (1-based)                  |
| `isDirty`     | `boolean`                                       |  否  | `false`  | 是否有未保存的修改                  |
| `isSaving`    | `boolean`                                       |  否  | `false`  | 是否正在保存中                      |
| `saveError`   | `string \| null`                                |  否  | `null`   | 保存错误信息，非 null 时优先显示    |
| `lastSavedAt` | `number \| null`                                |  否  | `null`   | 上次保存成功的时间戳 (ms)           |
| `density`     | `'calm' \| 'compact' \| 'productive'`           |  否  | `'calm'` | 官方主题控制的状态栏密度            |
| `layout`      | `'full' \| 'quiet' \| 'save-only' \| 'compact'` |  否  | `'full'` | 官方主题控制的状态栏信息密度        |

#### Emits

无。

#### Slots

无。

---

### TopBar

路径：`packages/app/src/components/editor/TopBar.vue`

编辑器顶部工具栏（sticky）。它不直接拥有业务事件，而是按主题 `layout` 渲染 `ShellAction[]`：经典三段、标题优先、搜索优先、阅读台、紧凑生产台。

#### Props

| Prop            | 类型                                                                    | 必需 | 默认值       | 说明                   |
| --------------- | ----------------------------------------------------------------------- | :--: | ------------ | ---------------------- |
| `noteTitle`     | `string`                                                                |  是  | —            | 笔记标题               |
| `notebookName`  | `string`                                                                |  是  | —            | 笔记本名称             |
| `variant`       | `'balanced' \| 'writing' \| 'archive' \| 'reader' \| 'studio'`          |  否  | `'balanced'` | 官方主题控制的顶栏权重 |
| `layout`        | `'classic' \| 'title-first' \| 'search-first' \| 'reader' \| 'compact'` |  否  | `'classic'`  | 官方主题控制的顶栏结构 |
| `leftActions`   | `ShellAction[]`                                                         |  否  | `[]`         | 顶栏左侧动作           |
| `centerActions` | `ShellAction[]`                                                         |  否  | `[]`         | 顶栏中心动作           |
| `rightActions`  | `ShellAction[]`                                                         |  否  | `[]`         | 顶栏右侧动作           |

#### Emits

无。所有动作通过 `ShellAction.run` 执行。

#### Slots

无。

---

## file-tree/

### Breadcrumb

路径：`packages/app/src/components/file-tree/Breadcrumb.vue`

文件路径面包屑导航，显示当前目录路径，支持逐级点击导航。

#### Props

| Prop         | 类型     | 必需 | 默认值   | 说明         |
| ------------ | -------- | :--: | -------- | ------------ |
| `currentDir` | `string` |  是  | —        | 当前目录路径 |
| `rootLabel`  | `string` |  否  | `'Home'` | 根节点标签   |

#### Emits

| Event      | Payload        | 说明                 |
| ---------- | -------------- | -------------------- |
| `navigate` | `path: string` | 用户点击了某级面包屑 |

#### Slots

无。

---

## layout/

### AppShell

路径：`packages/app/src/components/layout/AppShell.vue`

羽翼编纂布局容器（非对称三区）：左翼 56px | 编辑器 flex:1 | 右翼 240px。

#### Props

| Prop              | 类型                                                         | 必需 | 默认值 | 说明                                             |
| ----------------- | ------------------------------------------------------------ | :--: | ------ | ------------------------------------------------ |
| `recentNotes`     | `Array<{ path: string; title: string; colorIndex: number }>` |  是  | —      | 最近笔记列表                                     |
| `activePath`      | `string`                                                     |  是  | —      | 当前活跃笔记路径                                 |
| `noteTitle`       | `string`                                                     |  是  | —      | 笔记标题                                         |
| `notebookName`    | `string`                                                     |  是  | —      | 笔记本名称                                       |
| `showTopBar`      | `boolean`                                                    |  是  | —      | 是否显示 TopBar                                  |
| `showRightWing`   | `boolean`                                                    |  是  | —      | 是否显示右翼面板                                 |
| `headings`        | `HeadingItem[]`                                              |  是  | —      | 大纲标题列表                                     |
| `backlinks`       | `BacklinkEntry[]`                                            |  是  | —      | 反向链接列表                                     |
| `tags`            | `TagEntry[]`                                                 |  是  | —      | 标签列表                                         |
| `activeHeadingId` | `string \| null`                                             |  是  | —      | 当前活跃标题 ID                                  |
| `charCount`       | `number`                                                     |  是  | —      | 字符总数                                         |
| `wordCount`       | `number`                                                     |  是  | —      | 单词总数                                         |
| `lineCount`       | `number`                                                     |  是  | —      | 行总数                                           |
| `cursorLine`      | `number \| null`                                             |  是  | —      | 光标行号 (1-based)                               |
| `cursorCol`       | `number \| null`                                             |  是  | —      | 光标列号 (1-based)                               |
| `isDirty`         | `boolean`                                                    |  是  | —      | 是否有未保存修改                                 |
| `isSaving`        | `boolean`                                                    |  是  | —      | 是否正在保存中                                   |
| `saveError`       | `string \| null`                                             |  是  | —      | 保存错误信息                                     |
| `lastSavedAt`     | `number \| null`                                             |  是  | —      | 上次保存成功时间戳                               |
| `themeChrome`     | `ThemeChromeState`                                           |  是  | —      | 官方主题组件级 chrome；本地主题使用安全 fallback |
| `actions`         | `ShellAction[]`                                              |  是  | —      | NotebookHome 提供的统一 shell 操作模型           |

#### Emits

| Event               | Payload                                 | 说明              |
| ------------------- | --------------------------------------- | ----------------- |
| `select-note`       | `path: string`                          | 选择笔记          |
| `navigate-heading`  | `headingId: string, lineNumber: number` | 导航到标题        |
| `navigate-backlink` | `entry: BacklinkEntry`                  | 导航到反链        |
| `select-tag`        | `tagName: string`                       | 选择标签          |
| `toggle-right-wing` | —                                       | 折叠/展开右翼面板 |

其他 shell 级动作由 `actions` 按 `ThemeChromeState.actionPlacements` 分发到 TopBar、LeftWing、EditorControlStrip、StudioRail 或 reader bar。

#### Slots

| Slot 名称 | 说明                             |
| --------- | -------------------------------- |
| `editor`  | 编辑器区域内容（MarkdownEditor） |

---

### LeftWing

路径：`packages/app/src/components/layout/LeftWing.vue`

56px 左翼书签栏。Logo、主题分配到左翼的操作、彩色圆点书签列表、设置/主题等底部操作。

#### Props

| Prop         | 类型                                                                    | 必需 | 默认值        | 说明                   |
| ------------ | ----------------------------------------------------------------------- | :--: | ------------- | ---------------------- |
| `notes`      | `Array<{ path: string; title: string; colorIndex: number }>`            |  是  | —             | 最近笔记列表           |
| `activePath` | `string`                                                                |  是  | —             | 当前活跃笔记路径       |
| `mode`       | `'default' \| 'research' \| 'quiet' \| 'rail'`                          |  否  | `'default'`   | 官方主题控制的左翼权重 |
| `layout`     | `'bookmarks' \| 'quiet-bookmarks' \| 'research-stack' \| 'studio-rail'` |  否  | `'bookmarks'` | 官方主题控制的左翼形态 |
| `actions`    | `ShellAction[]`                                                         |  否  | `[]`          | 渲染在左翼的统一动作   |

#### Emits

| Event         | Payload        | 说明     |
| ------------- | -------------- | -------- |
| `select-note` | `path: string` | 选择笔记 |

#### Slots

无。

---

### RightWing

路径：`packages/app/src/components/layout/RightWing.vue`

240px 右翼参考面板，含三个折叠区：大纲（HeadingTreeNode 递归树）、反链、标签云。左侧抓取手柄可拖拽调整宽度（200-400px），双击折叠为 0px。

#### Props

| Prop                  | 类型                                                     | 必需 | 默认值                           | 说明                            |
| --------------------- | -------------------------------------------------------- | :--: | -------------------------------- | ------------------------------- |
| `headings`            | `HeadingItem[]`                                          |  是  | —                                | 大纲标题列表                    |
| `backlinks`           | `BacklinkEntry[]`                                        |  是  | —                                | 反向链接列表                    |
| `tags`                | `TagEntry[]`                                             |  是  | —                                | 标签列表                        |
| `activeHeadingId`     | `string \| null`                                         |  是  | —                                | 当前活跃标题 ID                 |
| `collapsed`           | `boolean`                                                |  否  | `false`                          | 面板是否折叠                    |
| `mode`                | `'balanced' \| 'research' \| 'quiet' \| 'rail'`          |  否  | `'balanced'`                     | 官方主题控制的右翼权重          |
| `policy`              | `'outline' \| 'research' \| 'collapsed' \| 'production'` |  否  | `'outline'`                      | 官方主题控制的右翼宽度/视觉策略 |
| `sections`            | `Array<'outline' \| 'backlinks' \| 'tags'>`              |  否  | `['outline','backlinks','tags']` | 区块显示顺序                    |
| `defaultOpenSections` | `Array<'outline' \| 'backlinks' \| 'tags'>`              |  否  | `['outline','tags']`             | 主题切换后的默认展开区块        |

#### Emits

| Event               | Payload                                 | 说明          |
| ------------------- | --------------------------------------- | ------------- |
| `navigate-heading`  | `headingId: string, lineNumber: number` | 导航到标题    |
| `navigate-backlink` | `entry: BacklinkEntry`                  | 导航到反链    |
| `select-tag`        | `tagName: string`                       | 选择标签      |
| `toggle-collapse`   | —                                       | 折叠/展开面板 |

#### 内部导出组件

- `HeadingTreeNode` — 递归标题树节点（`defineComponent`，自引用渲染），Props: `nodes: HeadingItem[]`, `activeId: string | null`, `depth: number`。Emits: `navigate-heading`。

#### Slots

无。

---

## modals/

### ExportDialog

路径：`packages/app/src/components/modals/ExportDialog.vue`

导出笔记对话框。格式网格（PDF/DOCX/XLSX/CSV/TXT/HTML）+ 选项开关 + 状态机（idle/exporting/success/error）。

#### Props

| Prop              | 类型      | 必需 | 默认值 | 说明               |
| ----------------- | --------- | :--: | ------ | ------------------ |
| `visible`         | `boolean` |  是  | —      | 对话框可见性       |
| `notePath`        | `string`  |  否  | —      | 笔记路径           |
| `noteTitle`       | `string`  |  否  | —      | 笔记标题           |
| `markdownContent` | `string`  |  否  | —      | 笔记 Markdown 内容 |

#### Emits

| Event            | Payload   | 说明                   |
| ---------------- | --------- | ---------------------- |
| `update:visible` | `boolean` | v-model 可见性双向绑定 |
| `cancel`         | —         | 用户取消/关闭          |

#### Slots

无。

---

### SettingsDialog

路径：`packages/app/src/components/modals/SettingsDialog.vue`

设置对话框，左导航右内容布局。5 个标签页：编辑器、外观、自动保存、文字补全、更新、关于。

#### Props

| Prop      | 类型      | 必需 | 默认值 | 说明         |
| --------- | --------- | :--: | ------ | ------------ |
| `visible` | `boolean` |  是  | —      | 对话框可见性 |

#### Emits

| Event            | Payload   | 说明                   |
| ---------------- | --------- | ---------------------- |
| `update:visible` | `boolean` | v-model 可见性双向绑定 |

#### Slots

无。

---

### ShareDialog

路径：`packages/app/src/components/modals/ShareDialog.vue`

分享笔记对话框，两步流程：① 选择格式（MD/TXT/HTML/PDF）② 选择渠道（系统分享/邮件/剪贴板/本地导出）。

#### Props

| Prop              | 类型      | 必需 | 默认值 | 说明               |
| ----------------- | --------- | :--: | ------ | ------------------ |
| `visible`         | `boolean` |  是  | —      | 对话框可见性       |
| `noteTitle`       | `string`  |  否  | —      | 笔记标题           |
| `markdownContent` | `string`  |  否  | —      | 笔记 Markdown 内容 |

#### Emits

| Event            | Payload   | 说明                   |
| ---------------- | --------- | ---------------------- |
| `update:visible` | `boolean` | v-model 可见性双向绑定 |
| `cancel`         | —         | 用户取消/关闭          |

#### Slots

无。

---

### TemplateDialog

路径：`packages/app/src/components/modals/TemplateDialog.vue`

新建笔记模板选择对话框。双栏布局：左列表（空白+内置模板+自定义模板）+ 右预览。支持从当前内容保存为自定义模板。

#### Props

| Prop             | 类型      | 必需 | 默认值 | 说明                             |
| ---------------- | --------- | :--: | ------ | -------------------------------- |
| `visible`        | `boolean` |  是  | —      | 对话框可见性                     |
| `currentContent` | `string`  |  否  | —      | 当前编辑器内容（用于另存为模板） |

#### Emits

| Event            | Payload                                       | 说明                   |
| ---------------- | --------------------------------------------- | ---------------------- |
| `update:visible` | `boolean`                                     | v-model 可见性双向绑定 |
| `select`         | `template: RichTemplateItem, content: string` | 选择了某个模板         |
| `create-blank`   | —                                             | 选择空白笔记           |
| `cancel`         | —                                             | 用户取消/关闭          |

#### Slots

无。

---

## theme/

### ThemeEffectLayer

路径：`packages/app/src/components/theme/ThemeEffectLayer.vue`

官方深度主题的显式特效层。由 `ThemeChromeState.effectProfile` 控制，只渲染本地 DOM/CSS 粒子、脉冲线和呼吸光，不拦截点击，不承载功能信息。

#### Props

| Prop              | 类型                                             | 必需 | 默认值   | 说明             |
| ----------------- | ------------------------------------------------ | :--: | -------- | ---------------- |
| `effectProfile`   | `'none' \| 'subtle' \| 'ambient' \| 'immersive'` |  否  | `'none'` | 官方主题动效档位 |
| `motionIntensity` | `'none' \| 'low' \| 'medium' \| 'high'`          |  否  | `'none'` | 官方主题动效强度 |

#### 行为

- `effectProfile === 'none'` 时不渲染 DOM。
- `subtle / ambient / immersive` 渲染真实 `.theme-effect-layer`，可被 E2E 断言。
- `prefers-reduced-motion: reduce` 下关闭粒子位移、脉冲和呼吸光动画。
- 本地 `.markluck-theme` 不获得该组件的官方 effect profile。

---

### ThemeGallery

路径：`packages/app/src/components/theme/ThemeGallery.vue`

主题展柜卡片列表，用于欢迎页、首页空态和设置页。点击卡片只触发预览，不直接启用主题。

#### Props

| Prop       | 类型                                | 必需 | 默认值       | 说明             |
| ---------- | ----------------------------------- | :--: | ------------ | ---------------- |
| `items`    | `ThemeViewModel[]`                  |  是  | —            | 主题视图模型列表 |
| `variant`  | `'settings' \| 'welcome' \| 'home'` |  否  | `'settings'` | 展示场景         |
| `showRole` | `boolean`                           |  否  | `true`       | 是否显示主题角色 |

#### Emits

| Event     | Payload          | 说明             |
| --------- | ---------------- | ---------------- |
| `preview` | `ThemeViewModel` | 打开主题预览抽屉 |

---

### ThemePreviewDrawer

路径：`packages/app/src/components/theme/ThemePreviewDrawer.vue`

主题预览侧滑页，展示官方主题截图、说明、适用场景、主要变化、性能压力和启用动作。本地导入主题显示 CSS 皮肤能力说明。

#### Props

| Prop      | 类型                     | 必需 | 默认值 | 说明         |
| --------- | ------------------------ | :--: | ------ | ------------ |
| `visible` | `boolean`                |  是  | —      | 抽屉可见性   |
| `item`    | `ThemeViewModel \| null` |  是  | —      | 当前预览主题 |

#### Emits

| Event             | Payload  | 说明             |
| ----------------- | -------- | ---------------- |
| `close`           | —        | 关闭抽屉         |
| `apply`           | `string` | 启用指定主题 ID  |
| `restore-default` | —        | 恢复默认 `paper` |

---

## overlays/

### CommandPalette

路径：`packages/app/src/components/overlays/CommandPalette.vue`

Spotlight 风格命令面板（Cmd+P/Ctrl+Shift+P 唤起）。居中浮层，支持全文搜索（含 `tag:xxx` `/regex/` `date:` 高级语法）+ 快捷操作。

#### Props

| Prop      | 类型      | 必需 | 默认值 | 说明       |
| --------- | --------- | :--: | ------ | ---------- |
| `visible` | `boolean` |  是  | —      | 面板可见性 |

#### Emits

| Event            | Payload                                        | 说明                   |
| ---------------- | ---------------------------------------------- | ---------------------- |
| `update:visible` | `value: boolean`                               | v-model 可见性双向绑定 |
| `select-result`  | `result: SearchResult`                         | 选择了某个搜索结果     |
| `quick-action`   | `action: 'new-note' \| 'export' \| 'settings'` | 点击了快捷操作按钮     |

#### Slots

无。

---

### FileDrawer

路径：`packages/app/src/components/overlays/FileDrawer.vue`

左侧滑出文件树面板。覆盖在编辑器之上（无布局偏移）。展示完整笔记本文件树，支持展开/折叠、搜索筛选、右键菜单（重命名/删除）、双击内联重命名。

#### Props

| Prop         | 类型         | 必需 | 默认值  | 说明                 |
| ------------ | ------------ | :--: | ------- | -------------------- |
| `visible`    | `boolean`    |  是  | —       | 抽屉可见性           |
| `files`      | `DirEntry[]` |  是  | —       | 文件/目录条目列表    |
| `rootDir`    | `string`     |  否  | `''`    | 根目录路径           |
| `activePath` | `string`     |  否  | `''`    | 当前活跃文件路径     |
| `loading`    | `boolean`    |  否  | `false` | 是否正在加载文件列表 |
| `error`      | `string`     |  否  | `''`    | 加载错误信息         |

#### Emits

| Event            | Payload                            | 说明                   |
| ---------------- | ---------------------------------- | ---------------------- |
| `update:visible` | `value: boolean`                   | v-model 可见性双向绑定 |
| `select-file`    | `path: string`                     | 选择文件               |
| `navigate-dir`   | `path: string`                     | 导航到目录             |
| `create-file`    | —                                  | 新建文件               |
| `delete-file`    | `path: string`                     | 删除文件               |
| `rename-file`    | `oldPath: string, newName: string` | 重命名文件             |
| `retry`          | —                                  | 加载失败后重试         |

#### 状态机

| 状态      | 触发条件             | UI                         |
| --------- | -------------------- | -------------------------- |
| Loading   | `loading === true`   | 8 行骨架屏 shimmer 动画    |
| Error     | `error !== ''`       | 错误图标 + 消息 + 重试按钮 |
| Empty     | `files.length === 0` | 空状态插画 + 新建按钮      |
| Normal    | `files.length > 0`   | 文件树（含搜索栏）         |
| NoResults | 搜索无匹配           | "无匹配文件"提示           |

#### Slots

无。

---

### MarkdownCheatSheet

路径：`packages/app/src/components/overlays/MarkdownCheatSheet.vue`

浮动 Markdown 语法参考卡片。可拖拽、可折叠，位置和状态通过 localStorage 持久化。

#### Props

无（自包含组件，通过 localStorage 管理状态）。

#### Emits

无（完全自管理）。

#### Slots

无。

#### 行为

- 初始位于编辑器右下角 (bottom: 60px, right: 24px)
- 收起时显示 `? 语法` 圆角药丸按钮
- 展开后显示分类语法参考卡片（标题/行内格式/列表/引用/Wiki-link/模板）
- 顶部 `⠿` 拖拽手柄移动位置，位置持久化到 `localStorage`
- 小屏幕（<800px）自动收起

---

### UpdateNotification

路径：`packages/app/src/components/overlays/UpdateNotification.vue`

版本更新通知卡片。固定于编辑器右下角，15 秒自动消失（带计时条动画）。支持"本版本不再提醒"。

#### Props

| Prop            | 类型      | 必需 | 默认值 | 说明                                     |
| --------------- | --------- | :--: | ------ | ---------------------------------------- |
| `visible`       | `boolean` |  是  | —      | 卡片可见性                               |
| `latestVersion` | `string`  |  是  | —      | 最新版本号（如 `'v0.2.0'`）              |
| `releaseUrl`    | `string`  |  是  | —      | GitHub Release 页面 URL                  |
| `releaseNotes`  | `string`  |  否  | —      | 发行说明摘要（显示前 2-3 行，≤120 字符） |

#### Emits

| Event             | Payload           | 说明                       |
| ----------------- | ----------------- | -------------------------- |
| `update:visible`  | `value: boolean`  | v-model 可见性双向绑定     |
| `dismiss-version` | `version: string` | 用户勾选了"本版本不再提醒" |

#### Slots

无。

---

## 附录：跨组件类型引用

以下类型在多个组件中使用，定义于 `packages/app/src/types/`：

| 类型               | 用途组件                             |
| ------------------ | ------------------------------------ |
| `ContextMenuItem`  | ContextMenu                          |
| `MarkdownBlock`    | MarkdownEditor                       |
| `HeadingItem`      | AppShell, RightWing, HeadingTreeNode |
| `BacklinkEntry`    | AppShell, RightWing                  |
| `TagEntry`         | AppShell, RightWing                  |
| `SearchResult`     | CommandPalette                       |
| `DirEntry`         | FileDrawer                           |
| `TemplateItem`     | TemplateDialog                       |
| `ExportFormat`     | ExportDialog, ShareDialog            |
| `ShareChannel`     | ShareDialog                          |
| `ExportResult`     | ExportDialog                         |
| `ThemeChromeState` | AppShell                             |
| `ThemeViewModel`   | ThemeGallery, ThemePreviewDrawer     |
