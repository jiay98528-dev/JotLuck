# MarkLuck PRD

版本：2026-06-27

## 产品定位

MarkLuck 是本地优先、离线可用的 Markdown 笔记工具。数据以普通文本文件存在，文件夹即笔记本，应用负责提供稳定的编辑、检索、预览、导出、导航和主题化 UX。

## 主题系统要求

- 主题系统的开发边界、包结构、slot、Host API、CSS 作用域和商业化接口以 `doc/standards-theme-development.md` 为唯一规格级准则。PRD 只描述产品目标，不替代主题开发标准。
- 默认官方主题为 `paper` / 羽翼布局，但主题系统必须支持本地市场、`.mltheme` 导入、安装、预览、启用、卸载、回退和刷新后持久化。
- 主题以 `ThemeManifest v2 + ShellRecipe + UxComponentRecipe + ThemePluginModule` 为主协议，可控制 Shell 布局、区域、动作路由、视觉 token、资产、动效和 Shell/主页/弹窗级 UX slot。
- `declarative` 主题通过 DSL 渲染；`official-code` 和本地 `trusted-code` 主题可通过 `ThemeHostContext` 注册 Vue/TS 插件组件。P0 阶段不做权限审批、沙箱隔离或社区内容治理。
- 主题插件可使用宿主提供的 editor、dialog、toast、action、storage、commerce 和只读 appState API。Markdown 安全清洗、文件 IO、搜索索引、导出服务和系统 API 仍由宿主负责。
- 商业化只通过 `ThemeCommerceProvider` 预留后端契约，不锁核心写作功能。当前默认 provider 为本地 mock，不接真实支付、账号或远程市场。

## 核心用户能力

- 打开本地文件夹，浏览 Markdown / 文本笔记。
- 在编辑器中实时编辑、预览和自动保存。
- 使用 Wiki-link、反向链接、标签、大纲、搜索、模板、导出和自动补全。
- 通过主题中心安装和切换 UX 主题，切换后当前写作流程不丢失。

## 验收基线

- 任何主题、Theme API、slot、Host API、manifest、runtime 或 `.mltheme` 示例变更都必须符合 `doc/standards-theme-development.md`，并同步更新类型和测试。
- 启动后默认应用 `paper`；用户可启用 `super-workbench` 验证主题接管能力。
- 主题中心显示本地市场、已安装、导入、商业状态和开发者信息。
- 启用超级主题后 TopBar、LeftWing、RightWing、StatusBar、EditorControl、WorkflowCanvas、EditorSurface、主要弹窗和状态层均有可观测接管或包裹标记；空白缓存草稿必须走完整工作区，不暴露可替换为简化编辑器的独立 Scratch slot。
- 切回 `paper` 后插件 DOM、CSS、事件监听和接管标记无残留。
