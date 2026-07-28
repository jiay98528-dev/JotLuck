# Frontend Components

版本：2026-07-28

## 布局主链

- `AppShell`
- `LeftWing`
- `TopBar`
- `EditorControlStrip`
- `StatusBar`
- `RightWing`
- `ThemeSlotBoundary`
- `NotebookOpenGate`

## 主题插槽约束

- Shell、主页、编辑器表面、文件抽屉、命令面板、导出/模板/设置/分享/新建/删除/外部编辑/草稿退出弹窗、toast、更新提示和 Markdown 速查表都必须通过 `ThemeSlotBoundary` 暴露。
- `ThemeSlotBoundary` 渲染优先级为插件组件 > `UxComponentRecipe` DSL > 宿主默认组件。
- 所有 slot 都必须传入明确 `slotProps`，并保留默认 slot，使主题可以选择完全替换或包裹宿主 UI。
- `ThemeHostContext` 向主题插件提供 action、slot、editor、dialog、toast、storage、commerce 和只读 appState API。

## 笔记本打开门页

- `NotebookOpenGate` 位于既有 `workflow-canvas` 与 `editor-surface` 内，不新增 Theme slot、Theme action 或 Host API。
- Props 固定为 `status: 'idle' | 'opening' | 'error'`、`errorMessage: string | null`、`formatsLabel: string`；只发出 `open-notebook` 事件。
- idle 显示单一主操作“选择笔记本文件夹”；opening 禁用重复触发并设置 `aria-busy`；error 使用 `role="alert"` 展示可理解原因，并保留同一按钮重试。
- 主操作首次显示、取消或失败后都获得焦点；Enter/Space 可触发。360px、200% 缩放和减弱动效下不得溢出或丢失焦点环。
- 门页只说明“文件夹即笔记本”和四种支持格式，不展示教程步骤、插画、示例数据或可写临时草稿。

## 文件抽屉

- `FileDrawer` 在正常 workspace 中显示“切换笔记本”，发出 `open-notebook`；父级与 `Ctrl/Cmd+O` 必须调用同一安全切换函数。
- 切换按钮在 opening 时禁用；外部单文件会话和 workspace-unbound 不通过 FileDrawer 扩大目录权限。

## 外部文件阅读器

- `ExternalReader` 是 `external-readonly` 的独立轻量入口，接收文件名、授权路径、加载状态、错误、统计和标题导航能力；Markdown 必须安全渲染，`.txt` 必须作为转义纯文本保留换行。
- `ExternalReader` 必须复用宿主已有的 Button、Markdown 正文样式、标题树和 RightWing 参考面板，不得另造开发阶段视觉。正文区域是独立的纵向滚动容器，鼠标滚轮、键盘和触控滚动均不得被页面外壳截断。
- 阅读器顶栏必须复用应用正式 Logo 资产，不得使用字母占位符或临时开发图标。
- Markdown 标题目录、文内锚点和外部链接在只读态直接可用。Wiki-link、标签聚合和真实反链依赖笔记本目录；父目录未提升前，参考面板必须保留对应入口，并将反链空状态标注为“添加笔记后可用”，不得伪造结果或为此暗中扫描父目录。
- `external-reader` slot 的 props 名称固定为 `enableEdit` 和 `openParentAsNotebook`，不得因文案调整而改名。默认宿主将 `openParentAsNotebook` 显示为“添加到笔记”。
- `enableEdit` 只将当前窗口的初始只读 file grant 提升为该文件读写，并进入单文件 `external-edit` 壳；它不得暴露文件树、目录选择、跨文件导航或任何 workspace action。`openParentAsNotebook` 才提升父目录为当前窗口 `workspace`，并保留该文件选中。

## 交互要求

- 主题入口位于 TopBar，打开主题中心。
- 主题中心必须显示本地市场、已安装、导入、商业状态和开发者信息。
- 不提供宿主级明暗切换；多 scheme 只能由单个主题 manifest 自行声明。
- 切换主题不得打断当前编辑、搜索、导出、外部单文件会话或草稿流程。
- 外部只读窗口不得挂载文件树、编辑器、导出、索引、监听、补全或更新检查；进入 workspace 后这些目录级组件才可异步初始化。

## 变更记录

- 2026-07-28：定义 NotebookOpenGate 三态、可访问性契约及 FileDrawer 的安全切换事件，不扩展 Theme API v2。
- 2026-07-25：外部阅读器改为复用成熟阅读工作台视觉与参考面板，补充滚动、目录和链接交互约束，并明确未提升父目录时的反链边界。
- 2026-07-25：补充 ExternalReader 的三态会话职责及 `external-reader` Theme API v2 props 兼容约束。
- 2026-07-25：明确 ExternalReader 的初始只读 grant 与单文件编辑提升不能授予 workspace UI。
