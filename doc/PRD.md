# JotLuck PRD

版本：2026-07-11

## 产品定位

JotLuck 是本地优先、离线可用的 Markdown 笔记工具。数据以普通文本文件存在，文件夹即笔记本，应用负责提供稳定的编辑、检索、预览、导出、导航和主题化 UX。

## 主题系统要求

- 主题系统的开发边界、包结构、slot、Host API、CSS 作用域和商业化接口以 `doc/standards-theme-development.md` 为唯一规格级准则。PRD 只描述产品目标，不替代主题开发标准。
- 默认官方主题为 `paper` / 羽翼布局，但主题系统必须支持本地市场、`.mltheme` 导入、安装、预览、启用、卸载、回退和刷新后持久化。
- 主题以 `ThemeManifest v2 + ShellRecipe + UxComponentRecipe + ThemePluginModule` 为主协议，可控制 Shell 布局、区域、动作路由、视觉 token、资产、动效和 Shell/主页/弹窗级 UX slot。
- `declarative` 主题通过 DSL 渲染；`official-code` 和本地 `trusted-code` 主题可通过 `ThemeHostContext` 注册 Vue/TS 插件组件。P0 阶段不做权限审批、沙箱隔离或社区内容治理；公开 RC 中本地导入入口必须标记为开发者实验功能，并在打开主题包选择器前要求用户确认可信来源。
- 主题插件可使用宿主提供的 editor、dialog、toast、action、storage、commerce 和只读 appState API。Markdown 安全清洗、文件 IO、搜索索引、导出服务和系统 API 仍由宿主负责。
- 商业化只通过 `ThemeCommerceProvider` 预留后端契约，不锁核心写作功能。当前默认 provider 为本地 mock，不接真实支付、账号或远程市场。

## 核心用户能力

- 打开本地文件夹，浏览 Markdown / 文本笔记。
- 在编辑器中实时编辑、预览和自动保存。
- 使用 Wiki-link、反向链接、标签、大纲、搜索、模板、导出和自动补全。
- 通过主题中心安装和切换 UX 主题，切换后当前写作流程不丢失。

## 离线文字补全要求（F-17）

- 补全必须完全离线运行，只显示一条 ghost text，不提供候选菜单；只有无修饰键 `Tab` 可以接受，`Escape` 只拒绝，失焦、窗口切换和弹窗切换只清除提示。
- 学习数据按工作区隔离。当前文档、notebook 派生模型、个人明确反馈与公共基线必须分层，关闭文档不得把全文写入个人模型。
- 公共基线必须来自许可证明确、来源可追溯且通过隐私、样板、原始/残余重复、类别/域占比和正式 holdout 重叠闸门的语料；训练池与运行时模型体积解耦，压缩资产不得超过 6MiB。
- 未见过的正式 holdout 必须达到触发率 35%–42%、可用率至少 35%、误触发率不超过 3%、mixed 候选为 0、全请求与可见预测 p90 均不超过 140ms，才允许标记为可发布；耗时必须来自生产 EngineRouter/Hybrid/deadline 路径，轮询 ghost 的等待上界不能作为发布证据。
- `formal-holdout` 只用于 cold validation 和七档选型；候选确定后才可消耗一次冻结 workspace final。final 失败后该版本不可重跑，公共资产继续 fail-closed，Personal Learning 结果不得并入公共模型分数。
- V1 只允许作为仓库内隔离评测快照存在。V1/V2 必须在同一冻结数据上报告 Top-1、Oracle@8、usable、安全与运行时指标；V1 源码、模型和观测补丁不得进入生产依赖图或构建产物。

## 付费语义补全扩展（F-17.1，V2.1 规划）

- 免费 Completion Engine V2 必须独立、完整、离线可用；付费扩展不得成为基础补全依赖或降低免费路径质量。
- V2.1 首版只对 V2 已通过硬门控的最多 8 条候选做语义重排，不生成新文本，不改变结构化 Wiki-link、标签、路径、格式和列表补全的优先级。
- 插件未安装、未授权、损坏、超时或加载失败时无感退回免费 V2；已经显示的 ghost text 不得被迟到的插件结果替换。
- V2.1 继续遵守单条 ghost、无候选菜单、Tab/Escape/IME/失焦语义、mixed 为 0 和完全离线；模型只接收截断上下文与候选，不获得文件系统或网络能力。
- 只有免费 V2 的 oracle@8 证明存在足够排名差距，并且独立 holdout 显示可感知净收益时，才允许把 V2.1 从规划转为开发里程碑。

## 验收基线

- 任何主题、Theme API、slot、Host API、manifest、runtime 或 `.mltheme` 示例变更都必须符合 `doc/standards-theme-development.md`，并同步更新类型和测试。
- 启动后默认应用 `paper`；用户可启用 `super-workbench` 验证主题接管能力。
- 主题中心显示本地市场、已安装、导入、商业状态和开发者信息。
- 启用超级主题后 TopBar、LeftWing、RightWing、StatusBar、EditorControl、WorkflowCanvas、EditorSurface、主要弹窗和状态层均有可观测接管或包裹标记；空白缓存草稿必须走完整工作区，不暴露可替换为简化编辑器的独立 Scratch slot。
- 切回 `paper` 后插件 DOM、CSS、事件监听和接管标记无残留。

## 变更记录

- 2026-07-11：将 V2.1 付费微型 Transformer 语义重排器记录为 F-17.1 扩展方向；免费 V2 始终独立可用。
- 2026-07-11：补充 F-17 离线文字补全的交互、分层学习、模型治理和发布质量基线；主题要求未变更。
