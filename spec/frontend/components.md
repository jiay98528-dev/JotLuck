# Frontend Components

版本：v1.1（2026-08-04）

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
- `ThemeHostContext` 向主题插件提供 action、slot、editor、dialog、toast、storage、commerce、i18n 和只读 appState API。

## 本地化组件约束

- 所有宿主可见文案、ARIA、title、placeholder、Toast、错误和配置标签使用语义消息 key；组件不得按 locale 写条件分支或把中文原文用作 key。
- `SettingsDialog` 的首个页签固定为 `general`，包含关联到可见 label 的原生语言 `<select>`。语义命中框至少 44px，选项使用各语言本地名称，切换后保持控件焦点和当前弹窗状态。
- 法语长文案、日/韩字体、360px 宽度和 200% 缩放时，设置导航、行布局、按钮和错误文本必须可换行且可滚动，不得裁切操作。
- 官方主题的静态 recipe、manifest 展示信息和代码插件文案通过宿主 i18n 解析；第三方主题作者文本作为外部内容原样显示。

## 笔记本打开门页

- `NotebookOpenGate` 位于既有 `workflow-canvas` 与 `editor-surface` 内，不新增 Theme slot、Theme action 或 Host API。
- Props 固定为 `status: 'idle' | 'opening' | 'error'`、`errorMessage: string | null`、`formatsLabel: string`；只发出 `open-notebook` 事件。
- idle 显示单一主操作“选择笔记本文件夹”；opening 禁用重复触发并设置 `aria-busy`；error 使用 `role="alert"` 展示可理解原因，并保留同一按钮重试。
- 主操作首次显示、取消或失败后都获得焦点；Enter/Space 可触发。360px、200% 缩放和减弱动效下不得溢出或丢失焦点环。
- 门页只说明“文件夹即笔记本”和四种支持格式，不展示教程步骤、插画、示例数据或可写临时草稿。

## 文件抽屉

- `FileDrawer` 在正常 workspace 中显示“切换笔记本”，发出 `open-notebook`；父级与 `Ctrl/Cmd+O` 必须调用同一安全切换函数。
- 切换按钮在 opening 时禁用；外部单文件会话和 workspace-unbound 不通过 FileDrawer 扩大目录权限。

## Markdown 编辑与预览

- `MarkdownEditor` 的 Live Preview 通过可选同步 `resolveImageSrc` 解析图片地址，并以 `imageRevision` 重建异步加载完成后的渲染块；未提供时保持原始 renderer 行为。
- `MarkdownEditor` 必须安装工作区级稳定 Predictor 和编辑器会话级 `CompletionDocumentContextField`；输入热路径只传单调 document revision 与有界上下文快照，不把 `doc.toString()` 或全文 fingerprint 交给补全服务。
- 补全调度分为 composition 稳定后立即运行的结构化平面，以及 40ms 防抖、仅 paragraph/list/quote 行尾运行的预测平面；两者共享单 ghost、无菜单、Tab/Escape 交互。
- Tab 接受必须执行候选的精确 `CompletionTextEdit`。编辑器继续跟踪已插入区间：保存/关闭、编辑越过完整区间，或已接受内容仍完整时失焦，才上报 retained；立即撤销和区间改写分别上报 reverted、modified。未接受 ghost 的继续输入、失焦、切文档或切工作区才是 abandoned，不作负反馈。
- 所有异步补全结果在 dispatch 前重新校验 editor session、workspace scope、document revision、UTF-16 cursor、focus 和 IME；迟到或不匹配结果只清理，不得重入 dispatch 或替换已显示 ghost。
- 即时预览按 Escape 必须恢复刚编辑的精确块并将焦点交给该渲染块；Enter 或点击重新进入源码编辑，IME composition 期间不得消费 Escape。
- 本地图片解析失败或越界时移除不可读取的 `src`、保留 alt 文本，不得把原始本地路径泄漏给 WebView，也不得阻断正文渲染或扩大文件权限；网络、data/blob 与锚点地址保持原有渲染语义。

## 保存状态栏

- 正常工作区继续使用自动保存，不要求常驻手动保存按钮；Ctrl/Cmd+S 必须立即提交当前内容。
- 保存错误不得只显示不可操作的文字。`StatusBar` 必须显示“重新保存”和“另存副本”原生按钮，并分别发出 `retry-save`、`save-copy`；`AppShell` 将事件交还页面的统一保存流程。
- 恢复成功后必须清除旧错误，使切换笔记、切换笔记本和关闭窗口重新可达。两个恢复按钮的命中区域均不得小于 `--touch-target-min`。
- 原位置持续不可写时，关闭窗口必须提供“另存副本并退出”和“不保存并退出”，不得让保存错误形成无法退出的循环。
- 编辑器读取文件时必须保存对应内容版本。自动保存只在磁盘版本仍一致时写入；外部程序或另一窗口改过文件后，必须停止覆盖并完整保留本地草稿。
- 版本冲突必须提供“采用外部版本 / 明确覆盖原文件 / 另存副本 / 复制全文”；原文件已移动或删除时提供“在原位置重建 / 另存副本 / 复制全文”。覆盖与重建都必须由用户明确选择，普通“重新保存”不得暗中执行。
- 切换笔记、切换笔记本、关闭窗口前必须先锁住编辑输入，等候已接管的图片任务和当前保存完成。锁定期间正文仍可选择，并支持 Ctrl/Cmd+A、Ctrl/Cmd+C。

## 命令面板与搜索结果

- 命令面板支持一个 `/pattern/flags` 正则字面量，可与 `tag:`、`date:`、`folder:` 共存；允许空格与 `\/`。无 flags 时默认大小写不敏感，执行前移除有状态的 `g/y`；未闭合字面量按普通文本处理，已识别但无法编译时返回空结果。
- 多个 `tag:` 为 AND 语义。点击正文命中后必须等待笔记加载，定位首个真实命中并滚动；标题命中或陈旧命中无法重定位时只打开笔记。

## 通用弹窗

- 所有宿主 `aria-modal` 浮层必须记录触发者、设置明确首焦点、在最上层内循环 Tab/Shift+Tab、阻止程序化焦点逃到背景，并在关闭后恢复触发者；触发者失效时使用调用方提供的安全 fallback。
- 嵌套浮层只允许最上层捕获焦点。Escape 由各浮层状态机处理；文件抽屉继续保持“菜单 → 重命名 → 抽屉”的优先级。
- 新建文件首焦点是文件名输入框；删除、放弃和退出确认首焦点是取消按钮；其余弹窗使用显式首控件或第一个可用控件。
- 通用关闭控件的可点击尺寸不得小于 `--touch-target-min`，视觉图标可保持原尺寸。

## ExportDialog

- exporting 期间禁止重复提交。服务返回失败或 Promise reject 均进入 error，显示可理解原因并恢复取消和重试；失败不得清空用户已选格式与选项。

## 外部文件阅读器

- `ExternalReader` 是 `external-readonly` 的独立轻量入口，接收文件名、授权路径、加载状态、错误、统计和标题导航能力；Markdown 必须安全渲染，`.txt` 必须作为转义纯文本保留换行。
- `ExternalReader` 必须复用宿主已有的 Button、Markdown 正文样式、标题树和 RightWing 参考面板，不得另造开发阶段视觉。正文区域是独立的纵向滚动容器，鼠标滚轮、键盘和触控滚动均不得被页面外壳截断。
- 阅读器顶栏必须复用应用正式 Logo 资产，不得使用字母占位符或临时开发图标。
- Markdown 标题目录、文内锚点和外部链接在只读态直接可用。Wiki-link、标签聚合和真实反链依赖笔记本目录；父目录未提升前，参考面板必须保留对应入口，并将反链空状态标注为“添加笔记后可用”，不得伪造结果或为此暗中扫描父目录。
- `external-reader` slot 的 props 名称固定为 `enableEdit` 和 `openParentAsNotebook`，不得因文案调整而改名。默认宿主将 `openParentAsNotebook` 显示为“添加到笔记”。
- `enableEdit` 只将当前窗口的初始只读 file grant 提升为该文件读写，并进入单文件 `external-edit` 壳；它不得暴露文件树、目录选择、跨文件导航或任何 workspace action。`openParentAsNotebook` 才提升父目录为当前窗口 `workspace`，并保留该文件选中。

## 文档导入阅读器

- `document-import-readonly` 复用 `ExternalReader` 的顶栏、正文滚动区、Markdown 样式和 RightWing，不新增 Office 工具栏或独立阅读器。右上角只有一个明显的“启动编辑”按钮，文案、图标、ARIA 与点击结果必须表达同一动作。
- 转换状态覆盖 `queued / snapshotting / converting / complete / stale / cancelled / error`。确定进度使用原生 `progressbar` 语义与 `aria-valuenow/min/max`；不可确定阶段使用 `aria-busy` 和明确阶段文案，不填伪造数值。chunk 只能按序追加，追加不得抢滚动或焦点。
- 警告区使用非模态、可折叠列表，不能用颜色作为唯一信号。错误必须说明发生了什么、为何无法继续以及“重试/重新转换”动作；取消后可重试。减弱动效下禁用内容位移，只保留状态变化。
- “启动编辑”在转换未完成或已过期时禁用。点击打开统一模态框，首焦点为“编辑源文件”，第二操作为“编辑 Markdown 副本”，并提供明确关闭按钮、遮罩关闭、Escape 和焦点恢复；按钮命中区至少 44px。
- 专业软件选项展示当前检测名称，如“在 Microsoft Word 中编辑”；没有候选时显示“选择其他应用”，触发系统 Open With。另存路径先显示“原文件不会被修改”，再调用原生对话框；取消保持当前预览和按钮状态。
- 保存成功后撤销所有转换 blob URL/临时资产，路由进入现有 `external-edit`；源文件不再属于该窗口。源过期时正文顶部出现常驻状态和“重新转换”，旧“启动编辑”与另存均不可达。

## 文件打开方式控件

- 欢迎页用五个格式组表达 Markdown、纯文本、Word、PDF、Excel；默认只选 Markdown。格式组是可访问 checkbox/switch 语义，视觉选中与实际系统状态分开显示。
- 欢迎页主动作固定为“在 Windows 中确认并应用”；系统页返回/窗口恢复焦点后重新读取状态，逐项显示已应用、部分应用、未应用，并为未完成项保留“继续设置”。欢迎流程不因未完成关联而阻塞。
- 设置“通用”页新增“文件打开方式”区，显示同五组真实状态和一个系统更改按钮；不得以 toggle 表示 JotLuck 可直接改写 Windows 默认值。Web/PWA 显示桌面能力说明，不能调用 Windows IPC。

## 交互要求

- 主题入口位于 TopBar，打开主题中心。
- 主题中心必须显示本地市场、已安装、导入、商业状态和开发者信息。
- 不提供宿主级明暗切换；多 scheme 只能由单个主题 manifest 自行声明。
- 切换主题不得打断当前编辑、搜索、导出、外部单文件会话或草稿流程。
- 外部只读窗口不得挂载文件树、编辑器、导出、索引、监听、补全或更新检查；进入 workspace 后这些目录级组件才可异步初始化。

## 变更记录

- 2026-08-05：补充 V2.2 CM6 增量上下文、双平面、精确 TextEdit、retained 反馈和异步身份边界。

- 2026-08-04（v1.1）：定义文档导入渐进状态、唯一编辑入口双选模态、源过期重转、欢迎格式组和设置页真实关联状态控件。

- 2026-08-03：新增五语言组件文案规则、SettingsDialog 通用/语言入口和 ThemeHostContext i18n 约束。

- 2026-08-03：定义带文件版本的条件保存、冲突/缺失恢复选择，以及笔记切换期间“可复制但不可继续写”的交互屏障。
- 2026-08-02：定义保存错误的重新保存/另存副本动作、Ctrl/Cmd+S 共用保存流程及失败后的明确退出闭环。
- 2026-07-30：定义图片地址解析与 Live Preview Escape 焦点语义；补充正则/多标签/命中跳转、导出异常恢复和统一模态焦点合同。
- 2026-07-28：定义 NotebookOpenGate 三态、可访问性契约及 FileDrawer 的安全切换事件，不扩展 Theme API v2。
- 2026-07-25：外部阅读器改为复用成熟阅读工作台视觉与参考面板，补充滚动、目录和链接交互约束，并明确未提升父目录时的反链边界。
- 2026-07-25：补充 ExternalReader 的三态会话职责及 `external-reader` Theme API v2 props 兼容约束。
- 2026-07-25：明确 ExternalReader 的初始只读 grant 与单文件编辑提升不能授予 workspace UI。
