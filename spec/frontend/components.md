# Frontend Components

版本：2026-07-25

## 布局主链

- `AppShell`
- `LeftWing`
- `TopBar`
- `EditorControlStrip`
- `StatusBar`
- `RightWing`
- `ThemeSlotBoundary`

## 主题插槽约束

- Shell、主页、编辑器表面、文件抽屉、命令面板、导出/模板/设置/分享/新建/删除/外部编辑/草稿退出弹窗、toast、更新提示和 Markdown 速查表都必须通过 `ThemeSlotBoundary` 暴露。
- `ThemeSlotBoundary` 渲染优先级为插件组件 > `UxComponentRecipe` DSL > 宿主默认组件。
- 所有 slot 都必须传入明确 `slotProps`，并保留默认 slot，使主题可以选择完全替换或包裹宿主 UI。
- `ThemeHostContext` 向主题插件提供 action、slot、editor、dialog、toast、storage、commerce 和只读 appState API。

## 外部文件阅读器

- `ExternalReader` 是 `external-readonly` 的独立轻量入口，接收文件名、授权路径、加载状态、错误、统计和标题导航能力；Markdown 必须安全渲染，`.txt` 必须作为转义纯文本保留换行。
- `ExternalReader` 必须复用宿主已有的 Button、Markdown 正文样式、标题树和 RightWing 参考面板，不得另造开发阶段视觉。正文区域是独立的纵向滚动容器，鼠标滚轮、键盘和触控滚动均不得被页面外壳截断。
- 阅读器顶栏必须复用应用正式 Logo 资产，不得使用字母占位符或临时开发图标。
- Markdown 标题目录、文内锚点和外部链接在只读态直接可用。Wiki-link、标签聚合和真实反链依赖笔记本目录；父目录未提升前，参考面板必须保留对应入口，并将反链空状态标注为“添加笔记后可用”，不得伪造结果或为此暗中扫描父目录。
- `external-reader` slot 的 props 名称固定为 `enableEdit` 和 `openParentAsNotebook`，不得因文案调整而改名。默认宿主将 `openParentAsNotebook` 显示为“添加到笔记”。
- `enableEdit` 只进入当前窗口的单文件 `external-edit` 壳；`openParentAsNotebook` 才提升父目录为当前窗口 `workspace`，并保留该文件选中。

## 交互要求

- 主题入口位于 TopBar，打开主题中心。
- 主题中心必须显示本地市场、已安装、导入、商业状态和开发者信息。
- 不提供宿主级明暗切换；多 scheme 只能由单个主题 manifest 自行声明。
- 切换主题不得打断当前编辑、搜索、导出、外部单文件会话或草稿流程。
- 外部只读窗口不得挂载文件树、编辑器、导出、索引、监听、补全或更新检查；进入 workspace 后这些目录级组件才可异步初始化。

## 变更记录

- 2026-07-25：外部阅读器改为复用成熟阅读工作台视觉与参考面板，补充滚动、目录和链接交互约束，并明确未提升父目录时的反链边界。
- 2026-07-25：补充 ExternalReader 的三态会话职责及 `external-reader` Theme API v2 props 兼容约束。
