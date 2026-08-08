# JotLuck PRD

版本：v1.1（2026-08-04）

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
- 在 Windows 中将 `.md`、`.markdown`、`.mdx`、`.txt` 作为可选的 JotLuck 打开程序关联；安装器不得强制改写用户现有默认应用。
- 以单个 JotLuck 进程处理所有关联文件：每个规范化后的不同文件路径打开独立窗口，重复打开同一路径只恢复、置前并聚焦既有窗口，绝不覆盖其内容。
- 外部关联文件先进入只读阅读器；用户可在同一窗口选择“启用编辑”以编辑该单一授权文件，或选择“添加到笔记”将其父目录提升为持久笔记本。
- 外部文件初始授权必须是只读文件 grant；只有用户明确触发“启用编辑”才可升级为当前文件的读写 grant。任何工作区能力只能在“添加到笔记”后可用，不能由编辑提升隐式获得。
- 在编辑器中实时编辑、预览和自动保存。
- 使用 Wiki-link、反向链接、标签、大纲、搜索、模板、导出和自动补全。
- 通过主题中心安装和切换 UX 主题，切换后当前写作流程不丢失。

## Windows 文档导入要求（F-19）

- Windows 桌面端支持从文件关联、命令行或系统“打开方式”打开 `.docx`、`.pdf`、`.xlsx`、`.xls`。这些格式进入独立的 `document-import-readonly` 会话，只做语义预览，不获得编辑原件、父目录、目录扫描、索引、监听、补全或任意写入能力。
- 导入必须先把已授权原文件复制到窗口私有临时快照并记录 SHA-256，再由受资源限制的隐藏工作进程解析。预览期间不创建用户文件，不修改原件；稳定 Markdown 块到达后立即追加，无法观测的解析阶段显示不确定进度，不伪造百分比。
- DOCX 映射标题、段落、行内强调、链接、嵌套列表、表格、换行、脚注和可用图片；下划线、上下标只使用经清洗的有限 HTML。合并单元格、修订、文本框和不支持媒体必须扁平化或占位并产生警告。
- PDF 逐页提取可选择文字并保留页边界，不做 OCR、不提取图片。扫描件、加密件、损坏件或无可提取文字必须进入可理解的错误状态。
- Excel 每个工作表映射为二级标题；使用行号和 Excel 列标构造已用区域表格，日期输出 ISO，错误值保留原样。公式单元格主表显示缓存值，工作表末尾附坐标、公式和计算值；隐藏表保留并标记，图表和嵌入图片产生降级警告。
- “启动编辑”是唯一编辑入口，只有转换完成且源版本仍有效时可用。点击后提供两个明确动作：“使用检测到的专业软件编辑源文件”和“另存 Markdown 副本并用 JotLuck 编辑”。前者不得授予 JotLuck 写入原件权限；后者必须先明确原件不会被修改，再显示原生另存对话框。
- 源文件被专业软件或其他进程修改后，当前预览标记为过期，旧转换禁止另存，并提供重新转换。JotLuck 在窗口恢复焦点和另存前均复核源 SHA-256。
- Markdown 另存默认 `<原文件名>.md` 并强制 `.md`。DOCX 图片写入 `<Markdown名>.assets`，目录冲突使用 `-2`、`-3` 递增，绝不覆盖已有资产；Markdown 与资产先在目标目录暂存再提交。成功后撤销源授权并原子切换为现有 `external-edit` 会话。
- 单文件资源边界固定为：源 200 MiB、OOXML 总解压 512 MiB、单项 128 MiB、PDF 单页解压 32 MiB、最终 Markdown 5 MiB、DOCX 资产 50 MiB、工作进程 768 MiB；全局最多两个低优先级转换工作进程，超出排队。取消、窗口关闭或异常必须硬终止对应进程并清理临时数据。

## Windows 文件打开方式要求（F-20）

- 安装器为笔记家族与文档导入分别注册 `JotLuck.Note`、`JotLuck.DocumentImport`，通过 `OpenWithProgids`、`SupportedTypes`、`Capabilities`、`RegisteredApplications` 声明 `.md/.markdown/.mdx/.txt/.docx/.pdf/.xlsx/.xls`，且两个候选 ProgID 均设置 `AllowSilentDefaultTakeOver`；安装、升级、首次启动均不得写扩展名默认值或受保护的 `UserChoice`，也不得因无显式默认值而被 Windows 静默选为回退处理器。
- 欢迎页默认只预选 `.md/.markdown/.mdx`；`.txt`、Word、PDF、Excel 不预选，但说明可预览并转换为 Markdown。用户点击“在 Windows 中确认并应用”后打开 JotLuck 专属默认应用页，返回时按受保护的 `UserChoiceLatest/UserChoice` 实际 ProgID 逐扩展名显示已应用、部分应用或未应用；不得把无显式用户选择时由 `OpenWithProgids` 推导的 Shell 回退候选误报为用户已授权，系统确认完成后该决定立即生效，不用本地 flag 伪装成功。
- 设置页“通用”显示 Markdown、纯文本、Word、PDF、Excel 的真实关联状态和系统更改入口，不使用看似可直接控制系统默认值的开关。
- 专业编辑器使用 Windows 关联处理器 API 枚举并排除 JotLuck：DOCX 优先 Word、WPS Writer、LibreOffice Writer；Excel 优先 Microsoft Excel、WPS Spreadsheets、LibreOffice Calc；PDF 优先 Adobe Acrobat、PDF-XChange Editor、Foxit PDF Editor、WPS PDF。无合格处理器或调用失败时打开系统“打开方式”。
- 卸载只删除 JotLuck 自有 ProgID、Capabilities、OpenWith 和自身 MRU 槽位，不恢复、覆盖或删除其他应用与用户选择的默认程序。

## 界面本地化要求（F-18）

- 应用界面完整支持 `zh-CN`、`en`、`ja`、`ko`、`fr`；简体中文是类型主目录和最终回退语言。
- 没有持久化选择时，首次启动按 `navigator.languages` 的精确代码、主语言代码顺序匹配；所有 `zh-*` 映射到 `zh-CN`，其余不支持语言回退 `zh-CN`。检测结果立即持久化，之后不持续跟随系统变化。
- 设置页新增首个“通用”分类，以原生选择器显示简体中文、English、日本語、한국어、Français。切换即时生效，不刷新，不改变当前路径、笔记内容、编辑选区、主题、弹窗或补全状态。
- 本地化范围包括宿主页面、弹窗、无障碍名称、状态与错误、官方主题、导出包装、原生对话框和 Windows NSIS 安装器。独立网站、用户 Markdown、自定义模板正文、第三方主题作者文案及补全引擎候选/语料不属于该范围。
- 内置模板和示例笔记只在首次创建时按当前语言生成；已有用户文件、模板和示例目录不得因语言切换被重命名或改写。
- 用户可见的文件系统与索引错误必须由稳定错误码和参数驱动翻译；Rust 与 MockFS 不得把可直接展示的固定语言句子作为错误合同。
- 官方主题必须跟随宿主语言；可信第三方主题可从 `ThemeHostContext.i18n` 获取当前语言、宿主翻译、日期/数字格式化及变化订阅。本版本不扩展 `.mltheme` 自带语言包协议。
- 所有语言资源随应用打包并离线加载，不使用运行时机器翻译或网络翻译服务。

## 离线文字补全要求（F-17）

- 补全必须完全离线运行，只显示一条 ghost text，不提供候选菜单；只有无修饰键 `Tab` 可以接受，`Escape` 只拒绝，失焦、窗口切换和弹窗切换只清除提示。
- 内核分为结构化与正文预测两个平面。Wiki-link、标签、路径、格式和列表在 IME composition 稳定后立即补全；正文预测只在 paragraph/list/quote 行尾运行并保持 40ms 防抖。结构化和强本地候选存在时不得调用公共生成器。
- 所有接受操作使用精确 `CompletionTextEdit { from, to, insertText }`；ghost 的 `displayText` 不得充当正文写入。异步请求必须绑定 editor session、workspace scope、单调 document revision、UTF-16 cursor、上下文快照、deadline 和 `AbortSignal`，迟到结果不得替换已显示 ghost。
- 学习数据按工作区隔离。当前文档、进程内 Session History、notebook 派生模型、Personal L2 与公共模型必须分层；关闭文档不得把全文写入 Personal L2。Session History 每工作区最多 100 条并在进程退出时清空。
- 接受 `Tab` 只产生 `accepted`，不立即持久学习。只有插入内容在后续越过区间或保存/关闭时仍完整，转为 `retained` 后才写 Personal L2、accepted lexicon 和正向排序信号；立即撤销/修改分别记为 `reverted`/`modified`，继续输入、失焦或切文档记为 `abandoned` 且不作负反馈，`Escape` 才是 `explicitRejected`。结构化候选永不写入语料。
- 学习准入固定为 `persist | memoryOnly | skip`：普通工作区正文可持久化，临时/外部会话仅内存；密钥、密码、token、代码和 frontmatter 跳过。用户笔记、反馈和本地指标不得上传或进入公共模型训练。
- V2R 固定短语 Transformer 与 V2S Subword MKN 的 architecture-stop 继续有效。下一版本免费公共引擎必须使用新 ID `public-v2-free-decoder-v1`、新 manifest 和新缓存，不得修改旧停止记录或并行加载第二公共引擎。
- 免费公共引擎固定比较 16M/24M/32M Q4 与 16M Q8 decoder-only，使用单一 8K Unigram + byte fallback 双语 tokenizer、最多 256 tokens 上下文；训练池清洗后上限 512MiB。模型、tokenizer、manifest 与新增推理宿主静态增量合计不超过 24MiB，增量峰值内存不超过 192MiB，模型推理 p90 不超过 80ms。
- V2.2 正式矩阵使用独立的 128MiB DEVELOPMENT selection 和一次冻结、全候选复用的 tokenizer；公开自然文本必须固定来源/许可/快照/页面 revision/清洗器/逐段哈希并通过近重复与 holdout 泄漏检查。训练准入不等于模型分发许可，Share-Alike 来源的发布处理必须另立评估。
- Windows/Tauri 通过同一签名可执行文件的隐藏常驻 completion worker 推理。长度帧、request ID、latest-only 取消、deadline、崩溃隔离和 Job Object 资源限制必须 fail closed；模型只能返回不可信文本，插入区间、来源、优先级与学习策略由宿主决定。
- 公共模型必须来自许可证明确、来源可追溯且通过隐私、样板、原始/残余重复、类别/来源占比和正式 holdout 重叠闸门的语料。上下文胶囊仅含标题链、当前段落、前段尾部和至多一个无路径检索片段，不提供整篇正文、文件名或工作区清单。
- Oracle 预检必须先达到 Oracle@8 ≥45%、Oracle@32 ≥55%、中英文 Oracle@8 各 ≥40%；失败即停止，不训练 visibility gate、不读取 final、不发布资产。旧已观察 holdout 只作回归。
- Cold 与 workspace-conditioned 两套冻结 final 必须分别达到触发率 35%–42%、绝对可用率至少 35%、silence false trigger 不超过 3%、mixed 候选为 0、全请求与可见预测 p90 均不超过 140ms，才允许标记为可发布。每套 200 个 checkpoint 必须触发 70–84 次且至少 70 次可用；`usable/triggered` 只作条件精度诊断，不得冒充绝对可用率。
- 正式证据分为 cold 与 workspace-conditioned 两套 validation/final。validation 可用于选择候选但不得进入训练；final 只能在模型、短语库和阈值冻结后消费一次。final 失败后该版本不可重跑，公共资产继续 fail-closed，Personal Learning 结果不得并入公共模型分数。
- 未发布候选只能由 dev/E2E flag 在隔离候选目录运行，必须保留 `qualityGatePassed/releaseEligible=false`；普通生产构建不得接受候选 URL、候选 manifest 或把候选写入 public。双 final 与真实 Windows 中文 IME GUI 闭环通过后，publisher 才能一次性切换默认并删除生产双引擎比较入口。
- V1 只允许作为仓库内隔离评测快照存在。V1/V2 必须在同一冻结数据上报告 Top-1、Oracle@8、usable、安全与运行时指标；V1 源码、模型和观测补丁不得进入生产依赖图或构建产物。

## 付费语义补全研究（F-17.1，V3 研究）

- 免费 Completion Engine V2 必须独立、完整、离线可用；付费扩展不得成为基础补全依赖或降低免费路径质量。
- V3 只有在免费 V2.2 的 cold/workspace 双 final 通过后才能启动；首期只产出隔离研究候选，不实现 `.mlcompletion` 安装、授权、商店、支付、账号或生产默认切换。
- 固定比较 48M/64M/80M、Q4/Q8，以及 C1/C2/C3 的 256/512/1024-token 上下文；不扩展到更大通用模型。实验宿主和候选目录不得写生产 public 或改变免费默认引擎。
- V3 相对同集、精确哈希绑定的 V2，cold 与 workspace 绝对可用率必须分别提升至少 8 个百分点，false trigger ≤3%、mixed 为 0，结构化及强 Personal/Notebook 候选零回归；可见 p90 ≤140ms、峰值增量内存 ≤256MiB、模型与实验宿主 ≤96MiB。
- 固定 60 任务中英本地 dogfood 的 retained characters/opportunity 必须比 V2 提升至少 15%，接受后撤销率不得恶化。任一质量、许可、体积或运行门禁失败即停止；只有研究通过后才另立付费产品化计划。

## 验收基线

- 外部关联窗口具有 `external-readonly`、`document-import-readonly`、`external-edit`、`workspace` 四态。两个只读态均不得初始化编辑器、文件树、目录扫描、索引、文件监听、补全、导出或更新检查；`.txt` 必须以保留换行的转义纯文本显示，Markdown 与转换后的 Markdown 仍经安全清洗后渲染。
- “启用编辑”只能读写当前外部授权文件，不得扫描父目录或写入最近笔记本；“添加到笔记”才可绑定该文件父目录、保留目标文件为当前项、启动目录级服务并持久记录最近笔记本。
- 多窗口的笔记本 root、索引、文件监听器和补全检索必须按窗口隔离；关闭一个窗口不得影响其他窗口。外部文件授权归属其创建窗口，窗口关闭后撤销该授权。
- 关于页显示构建版本 `v0.10.0-rc.1`。
- `v0.10.0-rc.1` 的独立 preview gate 允许 Public L3 继续 architecture-stop / fail-closed；但生产依赖图、桌面 bundle 和安装包均不得包含或可达 V2S Worker、factory、候选资产或自动加载路径。
- 文件关联安装只把八种扩展名注册为可选打开程序；默认应用改变只经 Windows 系统 UI 完成。卸载只移除 JotLuck 自身槽位，并保持其他应用的 Open With 项和 `MRUList` 原有顺序，不修改当前默认 ProgID。
- 正式 installed-app evidence 必须来自候选提交在 `main` 上触发的 GitHub Actions `workflow_dispatch`：固定 adapter 产生执行日志和可观察产物，GitHub REST 同时核验 workflow run、head SHA、attempt、job/step conclusion 及候选/证据 artifact 来源；本地结构校验不得单独产生正式 PASS。
- 安装版性能必须保留 20 次冷启动和 30 次运行中新窗口的全部正数原始样本，并由捕获器、物化器和校验器复算 P90。样本缺失、数量错误、不可复算或证据不守恒继续阻断；参考机上冷启动 P90 超过 2 秒或热开窗 P90 超过 1 秒只产生固定代码的非阻断警告，不得因测试机并行负载单独否决内测候选。
- 任何主题、Theme API、slot、Host API、manifest、runtime 或 `.mltheme` 示例变更都必须符合 `doc/standards-theme-development.md`，并同步更新类型和测试。
- 启动后默认应用 `paper`；用户可启用 `super-workbench` 验证主题接管能力。
- 主题中心显示本地市场、已安装、导入、商业状态和开发者信息。
- 启用超级主题后 TopBar、LeftWing、RightWing、StatusBar、EditorControl、WorkflowCanvas、EditorSurface、主要弹窗和状态层均有可观测接管或包裹标记；空白缓存草稿必须走完整工作区，不暴露可替换为简化编辑器的独立 Scratch slot。
- 切回 `paper` 后插件 DOM、CSS、事件监听和接管标记无残留。

## 变更记录

- 2026-08-05：F-17 升级为 V2.2 双平面、精确 TextEdit、retained 学习和 `public-v2-free-decoder-v1`；24MiB 总静态预算与 V3 隔离研究门禁只属于下一版本，现有 RC 不变。

- 2026-08-04（v1.1）：新增 F-19 Windows DOCX/PDF/Excel 隔离导入、渐进语义预览、源版本过期与双路径编辑；新增 F-20 八扩展名可选注册、专业编辑器调用和真实默认应用状态。

- 2026-08-03：新增 F-18 五语言界面本地化、首次系统语言检测、内容保护、结构化错误和主题语言感知合同；补全引擎保持不变。

- 2026-07-27：补齐 24 个固定安装版 adapter 与可信 evidence materialization 契约；将可复算的 2 秒/1 秒性能参考线降为非阻断警告，样本和来源完整性仍保持硬门控。
- 2026-07-26：收紧 installed-app evidence v2 的真实执行与 GitHub Actions provenance 契约；补充卸载保持其他应用 Open With 顺序的产品约束。

- 2026-07-25：新增关联文件多窗口产品合同：单进程一文件一窗口、路径去重、只读/单文件编辑/完整笔记本三态、四扩展名可选关联及窗口级服务隔离；构建版本指定为 `v0.10.0-rc.1`。
- 2026-07-25：补充 P1 最小授权边界与 `v0.10.0-rc.1` 独立 gate：只读初始 grant、编辑仅提升单文件，以及 Public L3 停止态下生产依赖图必须排除 V2S。
- 2026-07-13：F-17 的 Public V2S 有界架构预检停止：实际最大逐语言组合 Oracle@8/32 为 37%/40%，固定矩阵逐语言最好前沿也只有 37.5%/40.5%，未达到 40%/45% 总体门槛；未训练 Gate、未读取 final、未写 public，RC 继续 fail closed。
- 2026-07-13：F-17 启动 Public V2S：双语 Subword MKN + 小型选择性门控，恢复 35%–42% 触发率与至少 35% 绝对可用率的双 final 发布合同，并要求唯一 manifest/单资产/单 publisher。
- 2026-07-13：F-17 将固定短语库 V2R 标记为 architecture-blocked；16,384 档真实写作诊断表示率仅 13%（中文 6%），停止长训练并继续 fail closed。

- 2026-07-12：F-17 补充多合法前缀训练语义和 selection→generator→training-data→bundle 的可重算发布证据链。
- 2026-07-12：F-17 升级为 V2R 公共短语 Transformer，修正英文完整词边界断路，并将正式发布门槛提高为 60%–65% 触发率与至少 60% 绝对可用率；旧 v4 公共 N-gram 仅保留诊断身份。
- 2026-07-11：将 V2.1 付费微型 Transformer 语义重排器记录为 F-17.1 扩展方向；免费 V2 始终独立可用。
- 2026-07-11：补充 F-17 离线文字补全的交互、分层学习、模型治理和发布质量基线；主题要求未变更。
