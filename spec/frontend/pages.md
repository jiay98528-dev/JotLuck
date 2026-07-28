# Frontend Pages

版本：2026-07-28

## NotebookHome

- 入口页面，承载编辑器主工作流。
- 挂载时调用 `useThemeStore().init()`，应用持久化 active theme；无有效主题时回退 `paper`。
- 通过 `ThemeSlotBoundary` 暴露 WorkflowCanvas、EditorControl、EditorSurface、文件抽屉、命令面板、导出/模板/设置/分享/新建/删除/外部编辑/草稿退出弹窗、外部只读阅读器、toast、更新提示和 Markdown 速查表。空白缓存草稿必须复用完整 WorkflowCanvas / EditorSurface，不允许主题将其替换为简化 Scratch 编辑器。
- 桌面 `workspace` 窗口没有可用 notebook root 时，仍复用完整 `AppShell → workflow-canvas → editor-surface`，但 EditorSurface 必须渲染 `NotebookOpenGate`，不得挂载可写编辑器或执行目录级操作。

## WindowBootstrap

- 桌面端先读取调用窗口自己的 `WindowBootstrapPayload`；Web/PWA 直接进入既有 `workspace`，不依赖 Tauri IPC。
- `external-readonly`：首屏仅显示 ExternalReader 的 loading、normal、error、超过 5 MiB 四种状态；标题为“文件名 · JotLuck”，复用现有阅读工作台的按钮、正文、大纲和参考面板，并支持正文滚动、标题/文内锚点及外部链接跳转。不得启动目录级服务或更新检查，因此真实 Wiki-link、标签聚合和反链在提升为笔记本前显示明确的能力边界，而不是扫描父目录。
- `external-edit`：同窗口进入完整编辑壳，但只开放初始只读 grant 升级后的当前文件读取、保存和自动保存；不得扫描父目录、打开其他文件、调用 workspace IPC 或持久化最近笔记本。
- `workspace`：显示完整笔记本工作流。由“添加到笔记”进入时，先显示原目标文件，再异步加载文件树、索引、watcher 和 completion；父目录才成为持久最近笔记本。
- `workspace-unbound`：仅用于桌面 `workspace` 窗口。最近笔记本为空或全部不可用时进入门页；Web/PWA 继续使用 MockFS，不进入该状态。门页只有“选择笔记本文件夹”主操作，主题/设置可用，所有写文件、搜索、模板、导出和编辑动作禁用。
- `workspace-unbound → opening`：调用原生目录选择器。取消返回 `workspace-unbound` 且不显示错误；路径、权限或 IPC 失败返回带内联错误的 `workspace-unbound`，焦点回到主操作；成功才提交 notebook root。
- `opening → workspace`：先绑定可读 root，再清除旧 root 的文件、活动笔记、索引、watcher、模板和补全派生状态；加载根目录后恢复 workspace 动作，并在后台重建索引。后台扫描失败显示非阻断 warning，不回退到旧 root。
- 已有 `workspace` 的“切换笔记本”与 `Ctrl/Cmd+O` 复用相同 opening 流程。切换前必须完成当前保存；原生选择器等待期间旧 watcher 保持工作，新 root 返回后才停止旧 watcher 并进入提交阶段；保存失败、选择取消或 root 打开失败时保留原 root、正文和派生状态。选择相同 root 不重置当前笔记。
- `external-readonly` / `external-edit` 不响应 workspace 切换动作，继续只通过“添加到笔记”显式提升既有 file grant。
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

- 2026-07-28：新增桌面 workspace-unbound 门页、目录选择取消/失败状态及已有工作区安全切换契约。
- 2026-07-25：补充外部只读页的成熟预览复用、滚动、目录、链接与反链边界。
- 2026-07-25：新增 WindowBootstrap 页面状态及外部只读、单文件编辑、完整 workspace 的转换与懒加载边界。
- 2026-07-25：补充 P1 file grant 升级边界：编辑态不能隐式转为工作区。
