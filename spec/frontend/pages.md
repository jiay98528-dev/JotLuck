# Frontend Pages

版本：v1.2（2026-08-14）

## 全局语言启动与切换

- 应用挂载前读取 `jotluck:locale:v1`；不存在时按浏览器/系统首选语言匹配并保存。语言目录加载失败时回退 `zh-CN`，不得阻断打开本地笔记。
- 页面、弹窗、官方主题、导出和原生对话框共享同一当前 locale。切换不导航、不刷新、不重建编辑器，也不清空当前工作区、选区、未保存内容或补全状态。
- `document.documentElement` 必须同步 `lang`、`dir` 和 `data-locale`；多窗口通过 storage 事件同步显式选择。

## NotebookHome

- 入口页面，承载编辑器主工作流。
- 挂载时调用 `useThemeStore().init()`，应用持久化 active theme；无有效主题时回退 `paper`。
- 通过 `ThemeSlotBoundary` 暴露 WorkflowCanvas、EditorControl、EditorSurface、文件抽屉、命令面板、导出/模板/设置/分享/新建/删除/外部编辑/草稿退出弹窗、外部只读阅读器、toast、更新提示和 Markdown 速查表。空白缓存草稿必须复用完整 WorkflowCanvas / EditorSurface，不允许主题将其替换为简化 Scratch 编辑器。
- 桌面 `workspace` 窗口没有可用 notebook root 时，仍复用完整 `AppShell → workflow-canvas → editor-surface`，但 EditorSurface 必须渲染 `NotebookOpenGate`，不得挂载可写编辑器或执行目录级操作。
- 分栏和即时预览只在 workspace 中解析当前笔记引用的本地图片；路径以当前笔记目录为基准且不得越过 notebook root，二进制加载完成后必须重建对应预览。
- Live、分栏、只读和外部阅读预览对 HTTPS 图片使用相同的原位按需加载状态：初始零请求，点击任一可信占位后只授权当前笔记全部 HTTPS 图片，切换返回时保留，刷新或重启后清空。单图失败只原位替换该图为重试控件，失败稳定与重试期间不得再次请求已加载兄弟图片；HTTP 不提供加载动作。外部单文件仍不得读取相邻本地图片。
- 搜索结果携带 1-based 命中行列。选择结果先完成笔记加载与编辑器重挂载，再定位并滚动到首个正文命中；位置陈旧时按命中文本重定位，无法重定位时不做任意跳转。
- 页面内新建、删除、外部编辑和草稿退出确认框遵守统一模态焦点合同；取消或关闭后焦点回到原触发者，原触发者失效时回到编辑器或对应 Shell 操作。
- `workspace` 的只读渲染态将“返回编辑”固定在吸顶阅读栏右侧；进入只读后聚焦该按钮，恢复编辑后聚焦回编辑器，不允许主题布局把恢复入口留在左翼、普通格式栏或正文滚动后不可见的位置。

## WindowBootstrap

- 桌面端先读取调用窗口自己的 `WindowBootstrapPayload`；Web/PWA 直接进入既有 `workspace`，不依赖 Tauri IPC。
- `external-readonly`：首屏仅显示 ExternalReader 的 loading、normal、error、超过 5 MiB 四种状态；标题为“文件名 · JotLuck”，复用现有阅读工作台的按钮、正文、大纲和参考面板，并支持正文滚动、标题/文内锚点及外部链接跳转。不得启动目录级服务或更新检查，因此真实 Wiki-link、标签聚合和反链在提升为笔记本前显示明确的能力边界，而不是扫描父目录。
- `external-edit`：同窗口进入完整编辑壳，但只开放初始只读 grant 升级后的当前文件读取、保存和自动保存；不得扫描父目录、打开其他文件、调用 workspace IPC 或持久化最近笔记本。
- `document-import-readonly`：进入复用 ExternalReader 的渐进转换页；首屏先显示源快照阶段，随后按序追加转换块。该页面只加载渲染器和文档导入 IPC，不加载编辑器、目录服务或普通外部笔记 IPC。完成后才启用双路径编辑；源 revision 变化后进入 stale 并只允许重新转换。
- `workspace`：显示完整笔记本工作流。由“添加到笔记”进入时，先显示原目标文件，再异步加载文件树、索引、watcher 和 completion；父目录才成为持久最近笔记本。
- `workspace-unbound`：仅用于桌面 `workspace` 窗口。最近笔记本全部不可用、或内存引导会话初始化失败时进入门页；Web/PWA 继续使用 MockFS，不进入该状态。门页只有“选择笔记本文件夹”主操作，主题/设置可用，所有写文件、搜索、模板、导出和编辑动作禁用。
- 桌面 `workspace` 在最近列表为空时进入内存引导会话，不打开 AppData 示例目录、不写磁盘。左翼展示 `createSampleNotebookSeed()` 的引导笔记，编辑器打开第一条；自动保存关闭。Ctrl/Cmd+S 与另存只引导用户选择笔记本文件夹。选出文件夹后立即卸下全部引导笔记；若当前这篇有未确认编辑，可丢弃或只把这一篇写入新文件夹。
- `workspace-unbound → opening`：调用原生目录选择器。取消返回 `workspace-unbound` 且不显示错误；路径、权限或 IPC 失败返回带内联错误的 `workspace-unbound`，焦点回到主操作；成功才提交 notebook root。引导会话里的选文件夹动作复用同一选择器，取消后仍留在引导会话。
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
- 正常工作区首次启动且尚未完成引导时自动显示；直接打开外部文件的只读窗口不阻断用户读取文件。
- 完成、跳过、按 Escape 或点击遮罩均结束本次引导并记录完成状态，之后启动不重复显示。
- 设置中的“重新播放欢迎引导”必须在当前工作区立即打开引导，不刷新页面，不中断或丢失当前编辑内容。
- 引导作为模态界面时必须具备首焦点、Tab/Shift+Tab 循环、Escape 退出和关闭后的焦点恢复。
- 默认应用步骤显示五个格式组，默认只选 Markdown；点击系统确认入口后，窗口恢复焦点时按实际 ProgID 更新状态。系统未完成选择也允许继续欢迎流程，但不得显示“已应用”。

## SettingsDialog

- 提供通用、编辑器、自动保存、自动补全、更新、关于六类设置。
- 通用页提供五种语言的原生选择器。选项固定显示本地名称；改变后即时更新整个弹窗和背景页面，并持久化选择。
- 通用页在语言选择器后显示“文件打开方式”，以 Markdown、纯文本、Word、PDF、Excel 五组实际状态和 Windows 系统更改入口呈现；没有桌面能力时显示不可用说明。
- 不包含宿主级外观切换页签；主题入口集中在 TopBar 主题中心。

## 变更记录

- 2026-08-15：四类 Markdown 预览统一接入窗口内、按笔记隔离的 HTTPS 图片按需加载状态。

- 2026-08-14：桌面空启动改为内存引导会话；闸门留给最近项全失败、引导初始化失败和显式选文件夹。
- 2026-08-04（v1.1）：新增 document-import-readonly 渐进页面状态、源过期状态、双路径编辑，以及欢迎/设置的 Windows 实际关联状态流程。

- 2026-08-03：新增全局语言启动/切换状态与 SettingsDialog 通用语言页签。

- 2026-07-30：补充 workspace 本地图片预览、搜索命中跳转和 NotebookHome 内联弹窗焦点合同。
- 2026-07-28：新增桌面 workspace-unbound 门页、目录选择取消/失败状态及已有工作区安全切换契约。
- 2026-07-25：补充外部只读页的成熟预览复用、滚动、目录、链接与反链边界。
- 2026-07-25：新增 WindowBootstrap 页面状态及外部只读、单文件编辑、完整 workspace 的转换与懒加载边界。
- 2026-07-25：补充 P1 file grant 升级边界：编辑态不能隐式转为工作区。
