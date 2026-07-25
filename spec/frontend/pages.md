# Frontend Pages

版本：2026-07-25

## NotebookHome

- 入口页面，承载编辑器主工作流。
- 挂载时调用 `useThemeStore().init()`，应用持久化 active theme；无有效主题时回退 `paper`。
- 通过 `ThemeSlotBoundary` 暴露 WorkflowCanvas、EditorControl、EditorSurface、文件抽屉、命令面板、导出/模板/设置/分享/新建/删除/外部编辑/草稿退出弹窗、外部只读阅读器、toast、更新提示和 Markdown 速查表。空白缓存草稿必须复用完整 WorkflowCanvas / EditorSurface，不允许主题将其替换为简化 Scratch 编辑器。

## WindowBootstrap

- 桌面端先读取调用窗口自己的 `WindowBootstrapPayload`；Web/PWA 直接进入既有 `workspace`，不依赖 Tauri IPC。
- `external-readonly`：首屏仅显示 ExternalReader 的 loading、normal、error、超过 5 MiB 四种状态；标题为“文件名 · JotLuck”，复用现有阅读工作台的按钮、正文、大纲和参考面板，并支持正文滚动、标题/文内锚点及外部链接跳转。不得启动目录级服务或更新检查，因此真实 Wiki-link、标签聚合和反链在提升为笔记本前显示明确的能力边界，而不是扫描父目录。
- `external-edit`：同窗口进入完整编辑壳，但只开放初始只读 grant 升级后的当前文件读取、保存和自动保存；不得扫描父目录、打开其他文件、调用 workspace IPC 或持久化最近笔记本。
- `workspace`：显示完整笔记本工作流。由“添加到笔记”进入时，先显示原目标文件，再异步加载文件树、索引、watcher 和 completion；父目录才成为持久最近笔记本。
- 任意窗口只影响自身会话。打开已存在的规范化文件路径时，窗口管理器聚焦原窗口而不重载其内容。

## Theme Center

- 由 TopBar 主题按钮打开。
- 显示本地市场、已安装、导入、开发者信息和商业化状态。
- 支持预览、启用、卸载、刷新授权、mock checkout、mock license redeem 和 `.mltheme` 文件导入。
- 不提供宿主级明暗切换；真实远程市场、支付和账号体系留给后续 provider 实现。

## WelcomePage

- 首次引导页说明本地优先、默认编辑器设置、更新检查和热插拔 UX 主题能力。
- 不承担主题市场或商业化入口。

## SettingsDialog

- 提供编辑器、自动保存、自动补全、更新、关于五类设置。
- 不包含宿主级外观切换页签；主题入口集中在 TopBar 主题中心。

## 变更记录

- 2026-07-25：补充外部只读页的成熟预览复用、滚动、目录、链接与反链边界。
- 2026-07-25：新增 WindowBootstrap 页面状态及外部只读、单文件编辑、完整 workspace 的转换与懒加载边界。
- 2026-07-25：补充 P1 file grant 升级边界：编辑态不能隐式转为工作区。
