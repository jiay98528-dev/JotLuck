# Frontend Pages

版本：2026-06-27

## NotebookHome

- 入口页面，承载编辑器主工作流。
- 挂载时调用 `useThemeStore().init()`，应用持久化 active theme；无有效主题时回退 `paper`。
- 通过 `ThemeSlotBoundary` 暴露 WorkflowCanvas、EditorControl、EditorSurface、文件抽屉、命令面板、导出/模板/设置/分享/新建/删除/外部编辑/草稿退出弹窗、外部只读阅读器、toast、更新提示和 Markdown 速查表。空白缓存草稿必须复用完整 WorkflowCanvas / EditorSurface，不允许主题将其替换为简化 Scratch 编辑器。

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
