# JotLuck 主题开发标准

版本：2026-06-27
适用范围：Theme API v2、本地主题市场、`.mltheme` 导入包、官方主题模块、UX Theme Plugin

## 1. 规范地位

本文档是 JotLuck Theme API v2 的主题开发准则。后续新增或修改主题、主题 API、UX slot、`ThemeHostContext`、`ThemeDialog`、`ThemeRuntimeHost`、`ThemePackInstaller`、`ThemeRegistry`、主题 CSS 或 `.mltheme` 示例时，必须先阅读并遵守本文档。

本文档以当前工作区已实现 API 为准，不把未实现的 vNext 能力写成强制规范。若代码需要新增 manifest 字段、slot、Host API、runtime 行为或包结构，必须在同一变更中同步更新本文档、类型定义和测试。

主题渲染优先级固定为：

```text
ThemePluginModule 代码组件 > UxComponentRecipe DSL > 宿主默认组件
```

主题不得在宿主层新增 `themeId` 特判分支。布局、动作、视觉和 UX 接管必须通过 Manifest、`ShellRecipe`、`UxComponentRecipe`、slot 注册和 `ThemeHostContext` 完成。

## 2. Runtime 边界

当前支持三类 runtime：

| Runtime         | 用途                     | 执行边界                                                                                      |
| --------------- | ------------------------ | --------------------------------------------------------------------------------------------- |
| `declarative`   | 外部声明式主题           | 只通过 `theme.css`、`ux.json`、Manifest 和 DSL 控制 UX，不执行任意 JS。                       |
| `official-code` | 内置官方主题模块         | 可携带 TS/Vue 组件和 `OfficialThemeModule.plugin`，随应用构建发布。                           |
| `trusted-code`  | 本地导入的全 UX 插件主题 | 可加载 `runtime/*` 中声明的 JS bundle，注册 Vue 组件、注入 scoped CSS、执行主题生命周期逻辑。 |

`trusted-code` 在当前 P0 产品策略下是本地全 UX 信任模型：不做权限审批、沙箱隔离或社区内容治理；`permissions` 当前作为能力声明和 UI 展示信息，不阻断已知权限值的本地主题启用。公开 RC 的主题中心导入入口必须标记为开发者实验功能，并在打开 `.mltheme/.zip` 文件选择器前要求用户确认主题包来自可信来源。该确认是产品披露，不是权限审批或沙箱。

即便是 `trusted-code`，以下能力仍不属于主题直接接管范围：

- Markdown 安全清洗链路（`marked` 后必须由宿主 `DOMPurify` 清洗）。
- JotLuck 文件 IO、最近笔记、真实文件系统适配和 Tauri 系统 API。
- 搜索索引、标签索引、后台训练和文件监听。
- 导出服务、分享服务、系统保存/打开对话框。
- 核心笔记内容持久化策略。

主题需要触发这些宿主能力时，必须通过 `ThemeHostContext`、宿主 action 或宿主已暴露回调间接执行。

## 3. `.mltheme` 包结构

`.mltheme` 是 zip 兼容主题包。当前 `ThemePackInstaller` 只接受以下顶层条目：

```text
manifest.json      必填，ThemeManifest v2
theme.css          可选，最大 256KB
ux.json            可选，ThemeUxRecipeMap
runtime/*          trusted-code 入口 bundle
assets/*           可选静态资产
preview/*          可选预览图
```

包完整性规则：

| 项                | 当前规则                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| 总包大小          | 解压读取的文件总量不得超过 8MB。                                                               |
| 路径安全          | 路径会统一为 `/`；禁止空路径、`..`、绝对路径和盘符路径。                                       |
| 允许目录          | 只允许 `manifest.json`、`theme.css`、`ux.json`、`runtime/`、`assets/`、`preview/`。            |
| 资产白名单        | `assets/` 与 `preview/` 仅允许 `.png`、`.jpg`、`.jpeg`、`.webp`、`.gif`、`.svg`。              |
| checksum          | 格式必须为 `sha256-` + 64 位 hex。`theme.css` 和代码入口在声明 checksum 时会校验内容。         |
| trusted-code 入口 | `runtime='trusted-code'` 时必须声明至少一个 `entrypoints`，且入口文件必须存在并通过 checksum。 |
| 持久化            | 导入包存入 `localStorage` 的 `jotluck:themes:installed:v2`。                                   |

最小包示例：

```json
{
  "id": "local.example.theme",
  "version": "1.0.0",
  "themeApi": 2,
  "runtime": "declarative",
  "minAppVersion": "0.15.0",
  "name": "Example Theme",
  "author": "Local Author",
  "capabilities": ["tokens", "layout-preset", "ux-components"],
  "permissions": ["shell-layout", "component-replace", "visual-effects", "theme-storage"],
  "layoutPreset": "winged",
  "checksums": {
    "theme.css": "sha256-0000000000000000000000000000000000000000000000000000000000000000"
  },
  "slots": ["topbar", "workflow-canvas"]
}
```

## 4. ThemeManifest v2

Manifest 类型权威来源是 `packages/app/src/types/theme-pack.ts` 的 `ThemeManifestV2`。

必填字段：

| 字段            | 类型                     | 要求                                                                                   |
| --------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| `id`            | `string`                 | 稳定包名格式，必须匹配 `/^[a-z0-9][a-z0-9._-]+$/i`。                                   |
| `version`       | `string`                 | 主题版本。                                                                             |
| `themeApi`      | `2`                      | 当前仅支持 Theme API v2。                                                              |
| `runtime`       | `ThemeRuntime`           | `declarative`、`official-code` 或 `trusted-code`。                                     |
| `minAppVersion` | `string`                 | 不得高于当前 `APP_THEME_VERSION`。                                                     |
| `name`          | `string`                 | 用户可见主题名。                                                                       |
| `author`        | `string`                 | 作者名。                                                                               |
| `capabilities`  | `ThemeCapability[]`      | 能力声明。                                                                             |
| `permissions`   | `ThemePermission[]`      | 当前作为本地能力声明，不作为默认安装阻断。                                             |
| `layoutPreset`  | `ThemeLayoutPreset`      | 当前可选：`winged`、`focus`、`archive`、`reader`、`studio`、`atelier`、`single-page`。 |
| `checksums`     | `Record<string, string>` | 包文件 checksum 映射。                                                                 |

可选产品字段：

| 字段                                                                                                                                                     | 用途                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `description`、`homepage`、`license`、`previewImages`、`category`、`tags`、`price`                                                                       | 主题中心展示信息。                                                          |
| `entrypoints`                                                                                                                                            | `trusted-code` 代码入口，包含 `slot`、`module`、`exportName?`、`checksum`。 |
| `slots`                                                                                                                                                  | 主题声明覆盖的 UX slot。                                                    |
| `sku`、`channel`、`licenseKind`、`entitlement`、`purchaseUrl`、`catalogUrl`、`bundleUrl`、`publisher`、`releaseNotes`、`compatibility`、`commercialNote` | 商业化和本地市场预留字段。                                                  |

`catalogVisibility?: 'public' | 'developer'` 是官方内置主题模块的内部目录可见性字段，仅允许写在 `OfficialThemeModule` 上，不属于 `.mltheme` manifest 协议。默认值为 `public`；标记为 `developer` 的主题只用于本机开发和回归验收，普通主题中心不得展示，但仍必须能通过主题 id 被测试或内部入口直接激活。

官方主题模块的 `meta.previewImage` 会由 `ThemeRegistry` 写入 `manifest.previewImages` 与 `InstalledThemePack.previewImages`。正式内置主题必须提交真实首页截图缩略图；外部导入主题缺少预览图时，主题中心才允许使用低调 fallback。

外部导入主题必须在 UI 上明确区分于官方内置主题。导入入口不得暗示 JotLuck 已审核主题包内容；若主题包包含 `trusted-code`，用户必须先看到“可执行本地主题代码”的说明。

当前能力枚举：

```ts
type ThemeCapability =
  | 'tokens'
  | 'assets'
  | 'animations'
  | 'layout-preset'
  | 'ux-components'
  | 'trusted-code'
  | 'markdown'
  | 'codemirror';
```

当前权限枚举：

```ts
type ThemePermission =
  | 'shell-layout'
  | 'component-replace'
  | 'visual-effects'
  | 'theme-storage'
  | 'network'
  | 'filesystem-read'
  | 'filesystem-write';
```

## 5. ShellRecipe 与动作路由

`ShellRecipe` 声明主题的 Shell 装配意图，不能依赖宿主层 `themeId` 分支推导。

```ts
interface ShellRecipe {
  layoutPreset: ThemeLayoutPreset;
  workspaceIntent: ThemeWorkspaceIntent;
  defaultViewMode: ThemeViewMode;
  topBar: TopBarRegion;
  leftWing: LeftWingRegion;
  editorControl: EditorControlRegion;
  statusBar: StatusBarRegion;
  rightWing: RightWingRegion;
  readingWidth: OfficialThemeUiProfile['readingWidth'];
  drawerEmphasis: OfficialThemeUiProfile['drawerEmphasis'];
  motionIntensity: OfficialThemeUiProfile['motionIntensity'];
  actionPlacements: ThemeActionPlacements;
  drawerShell?: ThemeDrawerShellRecipe;
  ux?: ThemeUxRecipeMap;
}
```

`drawerShell` 用于声明单页面动态抽屉布局，仅在 `layoutPreset='single-page'` 时生效。当前支持左、右、底三向抽屉：

```ts
type ThemeDrawerSide = 'left' | 'right' | 'bottom';

interface ThemeDrawerRegionRecipe {
  side: ThemeDrawerSide;
  slot: ThemeSlotId;
  label: string;
  size: number;
  minSize?: number;
  maxSize?: number;
  defaultPinned?: boolean;
}

interface ThemeDrawerShellRecipe {
  left: ThemeDrawerRegionRecipe;
  right: ThemeDrawerRegionRecipe;
  bottom: ThemeDrawerRegionRecipe;
}
```

约定：

- `left` 通常使用 `left-wing` slot，承载文件、最近笔记和新建入口。
- `right` 通常使用 `right-wing` slot，承载大纲、反链和标签。
- `bottom` 通常使用 `editor-control` 与 `status-bar`，承载命令、格式工具和保存状态。
- 抽屉默认关闭；用户可临时打开或固定。固定后宿主必须让出版心，不能长期遮挡正文。
- 抽屉布局是通用 recipe 能力，宿主不得为某个 `themeId` 写特判。

当前 action id：

```ts
type ThemeActionId =
  | 'new-note'
  | 'file-drawer'
  | 'search'
  | 'template'
  | 'export'
  | 'share'
  | 'theme'
  | 'settings'
  | 'view-toggle';
```

当前 action region：

```ts
type ThemeActionRegion =
  | 'topbar-left'
  | 'topbar-center'
  | 'topbar-right'
  | 'left-wing'
  | 'editor-control'
  | 'studio-rail'
  | 'reader-bar'
  | 'status-right'
  | 'hidden';
```

主题只能通过 `actionPlacements` 改变 action 的位置、隐藏和区域归属。代码主题调用动作时必须使用 `context.dispatchAction(actionId)` 或 `context.actions.dispatch(actionId)`。

## 6. UxComponentRecipe DSL

声明式 UX 组件使用 `ThemeUxRecipeMap = Partial<Record<ThemeSlotId, UxComponentRecipe>>`。

```ts
interface UxComponentRecipe {
  slot: ThemeSlotId;
  name?: string;
  root: ThemePrimitiveNode;
}
```

当前 `ThemePrimitiveType`：

```ts
type ThemePrimitiveType =
  | 'Stack'
  | 'Grid'
  | 'Panel'
  | 'Text'
  | 'ActionList'
  | 'ActionButton'
  | 'NoteList'
  | 'HeadingTree'
  | 'TagCloud'
  | 'EditorStatus'
  | 'ThemePreview'
  | 'Slot';
```

当前 renderer 语义：

| Primitive                                                      | 当前行为                                                                |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `Slot`                                                         | 渲染宿主默认 slot 内容。                                                |
| `Text`                                                         | 渲染静态文本。                                                          |
| `ActionList`                                                   | 按 `props.region` 过滤并渲染 `ShellActionButton` 列表。                 |
| `ActionButton`                                                 | 渲染 `node.action.actionId` 对应的 `ShellActionButton`。                |
| `EditorStatus`                                                 | 渲染 `ThemeSlotBoundary.statusText`。                                   |
| `Grid`                                                         | 渲染 `div.theme-runtime-node--grid`。                                   |
| `Panel`                                                        | 渲染 `section.theme-runtime-node--panel`。                              |
| `Stack`、`NoteList`、`HeadingTree`、`TagCloud`、`ThemePreview` | 当前作为结构容器渲染，动态数据语义需由代码主题接管或后续扩展 renderer。 |

DSL 不得假设未实现的数据绑定能力。需要复杂行为、组件替换、动画循环、DOM 特效或 slot props 消费时，使用 `official-code` 或 `trusted-code`。

## 7. ThemePluginModule

代码主题入口必须导出 `ThemePluginModule` 兼容对象：

```ts
interface ThemePluginModule {
  activate?: (context: ThemeHostContext) => void | (() => void);
  components?: Partial<Record<ThemeSlotId, unknown>>;
  css?: string;
}
```

生命周期要求：

- `activate(context)` 在主题启用时调用。
- `activate` 返回的函数是 cleanup，主题切换或卸载时必须清理 DOM、CSS、事件监听、动画循环、订阅、计时器和临时状态。
- `components` 的 key 必须是已文档化的 `ThemeSlotId`。
- `css` 必须 scoped 到当前主题，不得污染宿主全局。
- 插件不得直接 import 宿主内部 Pinia store、文件服务、搜索索引、导出服务或 Tauri command；必须通过 `ThemeHostContext` 和 slot props 交互。

`trusted-code` bundle 当前通过 `Blob` object URL 动态 `import()` 加载。入口 `exportName` 默认是 `default`。

示例：

```ts
import type { ThemePluginModule } from '@/types/theme-pack';
import CustomTopBar from './CustomTopBar.vue';

const plugin: ThemePluginModule = {
  activate(context) {
    context.toast.show(`${context.manifest?.name ?? context.themeId} enabled`);
    const timer = window.setInterval(() => {
      document.documentElement.dataset.themeHeartbeat = context.themeId;
    }, 1000);

    return () => {
      window.clearInterval(timer);
      delete document.documentElement.dataset.themeHeartbeat;
    };
  },
  components: {
    topbar: CustomTopBar,
  },
  css: `
    [data-theme-id='local.example.theme'] .custom-topbar {
      border-bottom: var(--border-thin) solid var(--rule);
    }
  `,
};

export default plugin;
```

## 8. ThemeHostContext

`ThemeHostContext` 是代码主题接入宿主的唯一稳定 API。

```ts
interface ThemeHostContext {
  readonly themeId: string;
  readonly manifest?: ThemePackManifest;
  readonly runtime: ThemeRuntime;
  readonly permissions: readonly ThemePermission[];
  readonly chrome: ThemeChromeState;
  readonly actions: ThemeHostActionRegistry;
  readonly slots: ThemeHostSlotRegistry;
  readonly storage: ThemeHostStorage;
  readonly editor: ThemeHostEditorApi;
  readonly dialogs: ThemeHostDialogApi;
  readonly toast: ThemeHostToastApi;
  readonly commerce: ThemeCommerceProvider;
  readonly appState: Record<string, unknown>;
  readonly ui: Record<string, unknown>;
  dispatchAction: (actionId: ThemeActionId) => void;
}
```

子 API：

| API        | 当前方法                                     | 语义                                                       |
| ---------- | -------------------------------------------- | ---------------------------------------------------------- |
| `actions`  | `list()`、`dispatch(actionId)`               | 读取和触发宿主 action。                                    |
| `slots`    | `has(slot)`                                  | 判断当前主题是否已注册代码 slot 组件。                     |
| `storage`  | `get(key)`、`set(key, value)`、`remove(key)` | 主题私有 localStorage，前缀为 `jotluck:theme:<themeId>:`。 |
| `editor`   | `getContent()`、`setContent?()`、`focus?()`  | 编辑器受控能力，由宿主按当前页面状态注入。                 |
| `dialogs`  | `open(slot)`、`close(slot)`                  | 打开/关闭已暴露的 dialog slot。                            |
| `toast`    | `show(message)`                              | 展示宿主 toast。                                           |
| `commerce` | `ThemeCommerceProvider`                      | 读取主题目录、授权状态、购买/兑换/刷新契约。               |
| `appState` | readonly record                              | 只读应用状态快照。                                         |
| `ui`       | record                                       | 宿主传给 runtime 的扩展 UI API 容器。                      |

兼容别名：

```ts
context.getStorage(key);
context.setStorage(key, value);
```

禁止事项：

- 不得直接修改宿主 Pinia store。
- 不得绕过宿主 editor API 写文件。
- 不得在未清理的情况下向 `window`、`document`、`body` 挂长期事件。
- 不得修改 Markdown sanitization、搜索索引、导出、文件监听或系统对话框实现。
- 不得把用户笔记内容写入主题私有 storage。

## 9. 可接管 UX Slot

当前 `ThemeSlotId` 清单：

```ts
type ThemeSlotId =
  | 'app-shell'
  | 'topbar'
  | 'left-wing'
  | 'right-wing'
  | 'editor-control'
  | 'status-bar'
  | 'home'
  | 'workflow-canvas'
  | 'editor-surface'
  | 'reader-workbench'
  | 'file-drawer'
  | 'command-palette'
  | 'export-dialog'
  | 'template-dialog'
  | 'settings-dialog'
  | 'share-dialog'
  | 'new-file-dialog'
  | 'delete-confirm-dialog'
  | 'external-edit-dialog'
  | 'scratch-exit-dialog'
  | 'external-reader'
  | 'markdown-cheat-sheet'
  | 'toast-container'
  | 'update-notification'
  | 'dialogs.theme';
```

禁止新增未文档化 slot。若必须新增 slot，必须同步更新：

- `packages/app/src/types/theme-pack.ts`
- `ThemeSlotBoundary` 调用点和 slot props
- 本文档 slot 清单和 props 表
- 主题 runtime/store/installer 相关测试

### 9.1 禁止裸 `scratch` slot

当前没有裸 `scratch` slot。空白启动的缓存草稿必须走完整工作区，暴露为 `workflow-canvas` 与 `editor-surface`：

```text
空白缓存草稿 = AppShell + workflow-canvas + editor-control + editor-surface
```

主题不得把空白草稿替换成独立简化编辑器。外部打开现有 Markdown 文件的只读模式使用 `external-reader` slot，启用编辑后回到完整工作区。

## 10. Slot Props

代码主题组件会收到：

```ts
{
  slotId,
  actions,
  statusText,
  ...slotProps
}
```

`slotProps` 由宿主按 slot 注入。当前字段如下。

### 10.1 AppShell slots

| Slot         | Props                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app-shell`  | `chrome`, `activePath`, `noteTitle`, `notebookName`, `showTopBar`, `showRightWing`                                                                      |
| `topbar`     | `noteTitle`, `notebookName`, `region`, `leftActions`, `centerActions`, `rightActions`                                                                   |
| `left-wing`  | `notes`, `activePath`, `region`, `actions`, `onSelectNote`                                                                                              |
| `right-wing` | `headings`, `backlinks`, `tags`, `activeHeadingId`, `collapsed`, `region`, `onNavigateHeading`, `onNavigateBacklink`, `onSelectTag`, `onToggleCollapse` |
| `status-bar` | `charCount`, `wordCount`, `lineCount`, `cursorLine`, `cursorCol`, `isDirty`, `isSaving`, `saveError`, `lastSavedAt`, `region`, `actions`, `statusText`  |

### 10.2 工作区 slots

| Slot              | Props                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `workflow-canvas` | `activePath`, `noteTitle`, `notebookName`, `isDraftSession`, `viewMode`, `workspaceIntent`, `switchViewMode`, `saveDraftAs` |
| `editor-control`  | `region`, `actions`, `preset`, `activeAction`, `format`                                                                     |
| `editor-surface`  | `activePath`, `isDraftSession`, `viewMode`, `splitRatio`, `charCount`, `wordCount`, `headings`, `setViewMode`               |
| `external-reader` | `fileName`, `filePath`, `stats`, `headings`, `loading`, `error`, `enableEdit`, `openParentAsNotebook`, `scrollHeading`      |

### 10.3 弹窗与状态层 slots

| Slot                    | Props                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `dialogs.theme`         | `visible`, `activeThemeId`, `themes`, `entitlements`, `commerceError`, `close`, `activateTheme`, `refreshEntitlements` |
| `command-palette`       | `visible`, `close`                                                                                                     |
| `file-drawer`           | `visible`, `files`, `activePath`, `loading`, `error`, `close`                                                          |
| `export-dialog`         | `visible`, `notePath`, `noteTitle`, `close`                                                                            |
| `template-dialog`       | `visible`, `activePath`, `close`                                                                                       |
| `settings-dialog`       | `visible`, `completionSettings`, `completionTrainingMeta`, `close`                                                     |
| `share-dialog`          | `visible`, `noteTitle`, `close`                                                                                        |
| `toast-container`       | `activeThemeId`                                                                                                        |
| `update-notification`   | `visible`, `latestVersion`, `releaseUrl`, `close`                                                                      |
| `markdown-cheat-sheet`  | `activeThemeId`                                                                                                        |
| `new-file-dialog`       | `visible`, `fileName`, `supportedExtensions`, `cancel`, `confirm`                                                      |
| `delete-confirm-dialog` | `visible`, `path`, `name`, `cancel`, `confirm`                                                                         |
| `external-edit-dialog`  | `visible`, `cancel`, `confirmEditOnly`, `confirmScan`                                                                  |
| `scratch-exit-dialog`   | `visible`, `cancel`, `discard`, `save`                                                                                 |

Slot props 是主题与宿主的契约。主题组件必须对缺失可选字段做防御处理，因为某些 slot 在特定页面状态下不会提供完整数据。

## 11. CSS 标准

主题 CSS 必须限定作用域：

```css
[data-theme-id='local.example.theme'] {
  --paper-bg: oklch(0.98 0.01 95);
}

[data-theme-id='local.example.theme'] .my-theme-panel {
  border-radius: var(--radius-lg);
}
```

允许：

- 覆盖主题 token。
- 在当前主题 root 下定义主题组件样式。
- 使用 `assets/` 或 `preview/` 中的白名单资产。
- 为当前主题添加视觉特效、动效和装饰层。

禁止：

- 全局覆盖 `html`、`body`、`:root`、`.cm-editor` 等宿主基础选择器，除非选择器被 `[data-theme-id='<id>']` scope 限定。
- 污染 Markdown 清洗输出约束或让未清洗 HTML 进入 DOM。
- 使用未清理的全局 style 节点。
- 修改 CodeMirror 核心行为来绕过宿主编辑器状态机。
- 用 CSS 隐藏宿主必须可达的安全/保存/退出确认入口。

`ThemeRegistry.buildThemeCss()` 会把官方 token 包装到 `[data-theme-id='<id>']` 下；外部主题作者必须对自带 `theme.css` 也保持同等约束。

## 12. 商业化接口

商业化当前只预留契约，不锁核心写作功能。默认 provider 是本地 mock，不联网、不接真实支付、不做账号体系。

`ThemeCommerceProvider` 当前端点契约：

```ts
interface ThemeCommerceProvider {
  id: string;
  catalogEndpoint: '/v1/themes/catalog';
  entitlementsEndpoint: '/v1/themes/entitlements';
  checkoutEndpoint: '/v1/themes/checkout';
  redeemEndpoint: '/v1/themes/licenses/redeem';
  refreshEndpoint: '/v1/themes/entitlements/refresh';
  getCatalog(): Promise<ThemeCatalogItem[]>;
  getEntitlements(): Promise<Record<string, ThemeEntitlementDescriptor>>;
  createCheckout(request: ThemeCheckoutRequest): Promise<ThemeCheckoutResult>;
  redeemLicense(
    request: ThemeLicenseRedeemRequest,
  ): Promise<Record<string, ThemeEntitlementDescriptor>>;
  refreshEntitlements(): Promise<Record<string, ThemeEntitlementDescriptor>>;
}
```

未来接入 Gumroad、Polar 或自建后端时，应替换 `ThemeCommerceProvider` 实现，而不是改主题中心、runtime、installer 或主题包协议。当前主题开发应填好商业字段，但不得依赖真实购买链路才能启用本地主题。

## 13. 交付验收清单

主题开发完成前必须验证：

- Manifest 通过 `validateThemePackage()`。
- `.mltheme` 包结构、路径安全、大小限制、资产白名单和 checksum 均符合当前 installer。
- `declarative` 主题的 `ux.json` 只使用当前 DSL 已实现语义。
- `trusted-code` 主题的 entrypoint 存在、checksum 通过、导出 `ThemePluginModule` 兼容对象。
- 主题启用后当前编辑内容、视图模式、选区格式气泡、格式预选栏、即时/分栏/阅读切换不丢失。
- 主题接管的 slot 在切换回 `paper` 后无 DOM、CSS、事件监听、动画循环、object URL 或 storage listener 残留。
- 空白缓存草稿仍走完整工作区，不退化为简化 MarkdownEditor。
- 外部现有 Markdown 文件默认进入 `external-reader` 只读模式，启用编辑后回到完整编辑工作区。
- 主题中心可展示 runtime、slot 覆盖范围、版本、来源、商业状态、安装/预览/启用/卸载状态。
- 当前主题刷新后持久化；主题不存在、校验失败或运行异常时回退 `paper`。

涉及 Theme API、slot、Host API 或包协议变更时，最低自动化检查：

```bash
pnpm.cmd --filter @jotluck/app typecheck
npx.cmd eslint packages/app/src/ packages/renderer/src/
pnpm.cmd --filter @jotluck/app lint:style
pnpm.cmd --filter @jotluck/app exec vitest run
pnpm.cmd --filter @jotluck/app build
```

仅修改本文档或元指令时，可只执行文档一致性与格式检查。
