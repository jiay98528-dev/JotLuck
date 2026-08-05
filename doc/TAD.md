# JotLuck TAD

版本：v1.1（2026-08-04）

## 应用本地化架构

- Vue 层使用 `vue-i18n` Composition API。`zh-CN` 主目录常驻，`en`、`ja`、`ko`、`fr` 作为构建内动态 chunk；应用必须在目标目录加载完成后再挂载，避免混合语言首屏。
- `LocaleManager` 是界面语言唯一真相源，负责支持语言注册、`navigator.languages` 归一化、`jotluck:locale:v1` 持久化、跨窗口同步、`html.lang/dir` 更新及 `Intl` 格式化。不存在 URL locale，也不把语言状态混入笔记内容或补全工作区状态。
- `zh-CN` 消息对象定义 `MessageSchema`。所有目录必须保持相同 key、复数分支和插值参数；缺键只作为生产容错回退中文，自动化检查必须拒绝缺键。
- 组件通过 `useI18n()` 或宿主封装读取文案；Vue 外服务通过 LocaleManager 翻译。文件排序统一使用当前 locale 的 `Intl.Collator`，日期、相对时间、数量和导出语言标签使用同一 locale。
- 会进入本地化 UI 的 Tauri 文件系统、索引、原生对话框等 command 失败返回 `CommandErrorPayload { code, args }`；对应 MockFS 使用同一合同，前端把稳定错误码映射到消息目录。补全检索和纯内部诊断接口保持各自内部错误类型，但不得把诊断直接展示。前端预期错误使用 `UserMessageError`，普通 `Error` 只触发上下文本地化兜底。原生保存/目录对话框由前端传入已翻译标题和过滤器文本，取消仍是正常空结果。
- 内置模板与示例内容由前端单一本地化内容注册表提供。Web 直接使用该 Seed；Tauri 只在新建示例目录时写入调用方提供且通过相对路径校验的 Seed，已存在目录不覆盖。
- `ThemeHostContext.i18n` 向代码主题提供 locale、宿主消息翻译、日期/数字格式化和订阅；官方主题视图模型在语言变化后重新计算。第三方 manifest/DSL 自有文字继续由作者负责。

## UX Theme Runtime v2

- 主题系统的规范源是 `doc/standards-theme-development.md`。TAD 只描述架构方向；具体 Manifest 字段、`.mltheme` 包结构、slot 清单、slot props、Host API、CSS 作用域和商业化接口以主题开发标准为准。
- `ThemeRegistry` 聚合官方模块、本地市场 catalog 与已安装 `.mltheme` 包。
- `ThemeManifest v2` 声明 runtime、capabilities、permissions、entrypoints、slots、assets、checksums、minAppVersion 和商业化预留字段。
- `useThemeStore` 管理运行态、安装包态和商业授权态：`activeThemeId`、`previewThemeId`、`installedThemes`、`entitlements`、安装、导入、卸载、启用、预览、回退和持久化。
- `ThemeSlotBoundary` 是统一 UX 插槽边界，渲染优先级固定为：插件组件 > 声明式 DSL recipe > 宿主默认组件。
- `ThemeRuntimeHost` 加载 `official-code` 和本地 `trusted-code` 插件，并向插件提供 `ThemeHostContext`。P0 阶段本地插件全权限运行，不做授权审批或沙箱隔离；公开 RC 只在导入入口做可信来源确认和实验功能披露，不改变 Theme API v2 的全 UX 插件能力。
- `ThemeCommerceProvider` 预留真实后端契约：`GET /v1/themes/catalog`、`GET /v1/themes/entitlements`、`POST /v1/themes/checkout`、`POST /v1/themes/licenses/redeem`、`POST /v1/themes/entitlements/refresh`。默认实现为本地 mock。

## 总体结构

```text
Vue 3 + Pinia + Vite
  ├─ AppShell / NotebookHome / ThemeSlotBoundary
  ├─ MarkdownEditor / Live Preview / Search / Export
  ├─ ThemeRegistry / ThemeRuntimeHost / ThemePackInstaller
  ├─ useThemeStore / ThemeCommerceProvider
  └─ MockFS / Tauri FS adapters
```

## Markdown 本地图片渲染边界

- Markdown 仍按 `marked → 宿主图片地址解析 → DOMPurify → DOM` 顺序渲染；地址解析只能改写图片 `src`，不能绕过最终清洗。
- renderer 只暴露同步 `resolveImageSrc` 回调，不直接读取文件系统。Notebook 宿主以当前笔记路径为基准规范化相对地址，拒绝越过 notebook root，再通过 `IFileSystemService.readBinary()` 读取受支持图片并生成 `data:image/*;base64` 地址。
- 二进制读取是异步的，宿主按当前笔记缓存结果并用 generation 丢弃迟到回写；图片 revision 触发分栏预览和 Live Preview 重建。
- `external-readonly` 与未提升的 `external-edit` 不解析同级本地图片，不因预览扩大初始单文件 grant；网络、data/blob 和锚点地址保持浏览器原有语义。

## 关联文件窗口会话

- 桌面端维持单进程。启动参数解析全部受支持的 `.md`、`.markdown`、`.mdx`、`.txt` 文件：首项使用 `main` 窗口，其余项创建唯一 label 的窗口；运行中接收关联文件也创建窗口。
- 路径身份是规范化、规范大小写后的绝对路径。若已存在同一路径窗口，后端只恢复、置前并聚焦该窗口。创建窗口从 single-instance 回调异步调度；失败时必须回滚授权和窗口注册表。
- `WindowSessionMode` 为 `workspace | external-readonly | document-import-readonly | external-edit`；窗口只能经后端从调用窗口身份读取自身 `WindowBootstrapPayload`，前端不得提交任意窗口 label。笔记与文档导入授权使用不同状态和命令表，不能相互升级或复用 token。
- `get_window_bootstrap` 仅返回调用窗口的一次性启动会话；`enable_external_edit` 仅把调用窗口切至 `external-edit` 并将同一文件 grant 提升为读写；`promote_external_file_to_notebook` 是唯一允许绑定其父目录为 workspace root 的命令，并返回初始目标文件。
- 所有 workspace IPC 必须先由 Tauri 注入的调用窗口执行 `assert_workspace`，再访问 root、目录扫描、文件树、索引、watcher、completion、最近笔记本或跨文件读写。`external-readonly` 与 `external-edit` 不能通过遗留/通用 IPC 绕过该断言。
- 笔记本 root、Tantivy 索引、notify watcher 和 Completion Retrieval 使用窗口 label 作为状态边界。所有 IPC 从调用窗口解析状态，watcher 事件定向发送，外部文件授权也绑定 owner window。窗口销毁只清理自己的授权和服务状态。
- `external-readonly` 首屏为独立轻量入口：不得导入 CodeMirror、导出、文件抽屉、目录扫描、索引、监听、补全或版本检查；`external-edit` 保持单文件读写；仅 `workspace` 初始化目录级服务与最近笔记本持久化。
- `v0.10.0-rc.1` 的 release gate 单独验证 Public L3 architecture-stop 是可接受的 fail-closed 状态，同时从生产依赖图、Vite/Tauri bundle 和安装包清单验证 V2S Worker、factory、候选 manifest 与候选资产不可达。

## 文档导入隔离转换架构

- `.docx/.pdf/.xlsx/.xls` 启动时由窗口会话注册表创建 `DocumentImportBootstrapPayload`，包含类型、文件名、窗口级只读源授权和初始 `SourceRevision`。该会话不能调用 `enable_external_edit`、父目录提升、workspace IPC 或普通外部笔记读写。
- 主进程以单句柄有界读取把源复制到应用私有临时任务目录，同时计算 SHA-256；隐藏的同一可执行文件以 `--jotluck-document-worker` 模式启动，只接收快照路径、输出目录、类型和资源预算，不接触原文件。
- 主进程与工作进程使用带 `protocolVersion` 的长度帧 stdin/stdout 协议。未知版本、未知事件、乱序 chunk 序号、超限或协议损坏立即终止任务。全局调度器最多运行两个任务，等待任务可取消；Windows 使用 Job Object 将单进程内存限制为 768 MiB，并在取消、窗口销毁或异常时终止进程树。
- `DocumentConversionEvent` 固定为 `phase | chunk | asset | warning | complete | stale | cancelled | error`；进度单位固定为 `bytes | pages | sheets | rows | blocks | assets`。可观测阶段报告真实 `completed/total`，不可观测阶段显式 `indeterminate`；chunk 携带从 0 开始单调递增序号，前端只按序追加。
- DOCX 使用 `docx-rs 0.4.22`，Excel 使用 `calamine 0.36.1`，PDF 使用 `lopdf 0.44`，均关闭不需要的 feature。所有源文本先进行 Markdown 转义；前端追加的完整 Markdown 仍进入既有 `marked → DOMPurify` 管线。
- 转换 Markdown、警告和资产只存在窗口级注册表及私有临时目录。`read_document_conversion_asset` 按调用窗口、conversion ID 与 asset ID 返回原始字节；前端创建的 blob URL 在替换、取消和卸载时撤销。
- 当前源文件通过单文件 `notify` watcher、窗口 focus 复核和另存前复核检测变化。revision 不一致时任务进入 `stale`，禁止旧转换另存；重新转换创建新 conversion ID 并清理旧注册表。
- `save_converted_document_as` 只接受转换 ID 和本地化对话框请求，不接受任意源路径。后端强制 `.md`、选择唯一资产目录、在目标父目录创建同卷临时项并提交；成功后撤销文档源授权，将新 Markdown 建立现有可写外部 grant，并把窗口会话原子替换为 `external-edit`。
- Windows 编辑器集成通过 `SHAssocEnumHandlers` 枚举并优先使用 `IAssocHandler::Invoke`；对没有注册跨 apartment 代理的处理器，只使用同一 `IAssocHandler::GetName` 返回的完整可执行文件路径，验证为现存的绝对 `.exe` 后把源文件作为独立 argv 启动。handler ID 只引用当前窗口后端枚举缓存，任何路径都不解析注册表命令；没有候选或上述路径失败时使用系统 Open With。默认应用状态通过实际 ProgID 查询，设置入口优先 `ms-settings:defaultapps?registeredAppUser=JotLuck`，旧系统回退总页。

## 离线补全架构（3.11，V2.2）

- `MarkdownPredictor` 是工作区级稳定 facade，组合 Markdown 上下文扫描、结构化 Provider、Resolver、N-gram 引擎和按工作区隔离的学习仓库；编辑器 keyed 重建不重建 Predictor。
- CodeMirror 6 `CompletionDocumentContextField` 是热路径上下文真相源：每次 `ChangeSet` 单调递增 document revision，并维护光标语法节点路径、block 类型、标题链、当前/前一段有界切片和语言提示。打开文档允许一次完整初始化；之后禁止在请求热路径调用 `doc.toString()`、计算全文 fingerprint 或从文首扫描 fence/frontmatter。
- 内核拆为结构化平面与预测平面。结构化平面在 composition 稳定后立即调度 Wiki-link、标签、路径、格式和列表；预测平面只在 paragraph/list/quote 行尾、40ms 防抖后运行。两平面最终都进入同一 Resolver 并只显示一条 ghost。
- 数据层固定为当前文档增量段落 L1、每工作区/进程最多 100 条的 Session History、notebook 按文件可撤销贡献 N2、只接收 `retained` 的 Personal L2，以及应用级唯一只读公共插槽。L1 由变更覆盖的段落贡献撤销/重建，N2 先汇总跨文档支持再剪枝；各层原始分数不得直接跨 Provider 比较。
- `CompletionProviderRegistry` 在 Predictor 生命周期内注册一次类型安全描述符，固定声明 mode、上下文能力、priority tier、最大候选数、20ms 本地软预算/35ms Hybrid 软预算、反馈能力和数据权限；不提供任意 JS/WASM/原生代码 Provider 插件。调度顺序为结构化 → 当前文档/Session → Personal/Notebook/Hybrid → 唯一公共生成器 → generic fallback。
- 候选以 `CompletionTextEdit { from, to, insertText }` 作为唯一正文写入；`displayText` 只用于 ghost。去重保留全部 `contributors`，候选同时携带 mode、kind、providerId、sourceLayer、priorityTier、raw/calibrated score 和 feedback policy。
- 请求快照由 `editorSessionId + workspaceScope + documentRevision + UTF-16 cursor + contextSnapshot + deadlineAt` 构成，异步入口一律携带 `AbortSignal`。桌面总请求 80ms 硬截止；超过截止、revision/scope/cursor/epoch 不一致或已经显示 fallback 时，迟到结果直接丢弃。
- 学习仓库 v5 统一保存 Personal L2、legacyAccepted、accepted lexicon、signals、metrics 和元数据；写入按 scope 串行合并，可用时使用 Web Locks，并通过 BroadcastChannel/storage event 同步多标签页。v4 已接受数据只进入 `legacyAccepted` 且以 0.5 权重参与排序，不能伪造 retained 统计。
- 反馈状态机为 `shown → accepted → retained | modified | reverted`，另含 `explicitRejected` 和 `abandoned`。只有 retained 才持久学习；结构化补全永不写语料。准入 `persist | memoryOnly | skip` 由宿主根据会话、block 和敏感内容决定。
- `CompletionEngineRouter` 管理唯一、模型无关的 `CompletionPublicEngine` 生成插槽。公共插槽默认未绑定；只有通过独立证据的模型才能显式安装。V2R/V2S 停止态继续保留且不能作为 fallback。
- 下一版本公共引擎 ID 为 `public-v2-free-decoder-v1`，使用新协议和新缓存。Windows/Tauri 由同一签名可执行文件的隐藏常驻 completion worker 执行长度帧请求、latest-only 取消和 Job Object 资源限制；warmup 重算跨模型/tokenizer 的 candidate hash，并校验 `JLFDQ02`、group-size 64 Q4/Q8 F16 scales、header、payload hash、matrix 与完整张量布局。worker 只返回不可信原始文本，宿主重新执行语言、长度、Markdown、循环、mixed 与精确编辑门控。
- 模型生命周期是单向 `trained → oraclePassed → releaseEligible`。trainer 只能生成 dev/E2E 可加载的 `trained` manifest；Oracle evaluator 才能晋升第二态；唯一 publisher 只有在双 final 与 Windows GUI/IME 证据齐备时才生成第三态。任何 manifest 布尔值都不能绕过对应原始观察和哈希绑定。
- 训练控制面与 CUDA 数据面分离：当前工作站持有 selection、evaluator 和 final；幻15仅执行内容寻址、可恢复的训练 job。Tailscale direct 优先，VPS 只可作为端到端加密 Peer Relay；传输使用临时名 + SHA-256 + 同卷原子转正，final、用户数据和凭据不得上传训练节点或 VPS。
- 公共上下文胶囊只包含标题链、当前段落、前一段尾部和至多一个无路径检索片段，最多 256 tokens；不得提供整篇正文、文件名或工作区清单。模型、8K Unigram+byte fallback tokenizer、manifest 与新增宿主总静态增量 ≤24MiB，增量峰值内存 ≤192MiB，模型推理 p90 ≤80ms。
- 新公共路线固定 16M/24M/32M Q4 与 16M Q8；Oracle@8/32 预检必须分别 ≥45%/55%，且中英文 Oracle@8 各 ≥40%。不通过则停止，不训练 gate、不读取 final、不发布资产。双 final 与真实 Windows IME GUI 闭环前只允许 dev/E2E flag。
- Web/PWA 不运行下一版本公共 decoder，只保留结构化、Session、Personal、Notebook/Hybrid 的安全降级，不继承 Windows cold 质量声明。
- Public V2S 的旧 canonical 入口与 v6 二进制仅属于停止实验记录，不再是目标架构。任何时刻仍不得同时发布两代公共资产，冻结 V1 只存在于隔离评测闭包。
- 已停止的 `public-phrase-transformer-v1` 训练、语料治理、量化和证据代码保留在 `scripts/` 供复核；其 Worker、ONNX adapter、默认 factory 与 `onnxruntime-web` 已从生产依赖图移除。`autocomplete-v2r-architecture-stop.json` 继续阻断长训练、publisher 与 v5 verifier。
- `public-v2s-mkn-v1` 的固定矩阵与唯一逐语言组合修正已完成；最大 5,735,917B 候选的 development Oracle@8/32 为 37%/40%，固定矩阵逐语言最好前沿为 37.5%/40.5%，仍未达到 40%/45% 总体架构门槛。`autocomplete-v2s-architecture-stop.json` 因此在任何输入读取前阻断训练、Gate repack、组合和 publisher；CI 只能确认公共 L3 继续 fail closed，不能把停止状态计为质量 PASS。
- 停止态下 `MarkdownPredictor` 只接受显式注入的 `CompletionPublicEngine`，不自动导入 V2S factory；因此普通生产 bundle 不含已停止 Worker。V2S engine/factory 源码仅供单元测试和隔离评测复核，不能由无 manifest 的生产路径隐式激活。
- 结构化 Provider、L1、Personal L2、Notebook N2 与 Hybrid 是互补来源而非公共模型版本；公共 L3 缺失或失败时它们继续提供免费确定性路径。

## 离线语义补全研究（3.12，V3）

- V2 将普通候选整理为最多 8 条的不可变 `CandidateBatch`，携带 engine epoch、workspace scope、document version、UTF-16 cursor、deadline 和取消信号；确定性结构化候选旁路语义扩展。
- Web/PWA 的工作区短语检索运行在专用 Worker，Tauri 使用 Rust 应用状态中的等价内存后端；两端共享候选协议，并统一在 TypeScript 层执行排名、Resolver 和质量门控。后端失败或超时始终退回免费 V2 fallback。
- Worker/CSP 不可用时 Hybrid Retrieval 直接 disabled，不允许在主线程同步建索引。文档 mutation 以最多 8 项、正文最多 2MiB 的原子批提交，revision 每批递增一次；latest-only query 可在批次之间读取最近 committed snapshot，不等待 mutation backlog。Web Worker 与 Tauri 都不得向查询暴露半批状态；Tauri query 只短暂克隆 `RwLock<Arc<CommittedSnapshot>>`，contribution 构建和 writer 应用期间仍返回旧 revision。
- 非 Abort 故障按 scope 管理：每个工作区每次会话只重建一次，第二次失败只禁用该 scope；scope/epoch 变化属于 obsolete/cancel，不计故障。恢复从训练服务维护的当前工作区文件事实快照按 `(scope, signal)` 回放，training meta 不得充当唯一文件清单。健康诊断统一暴露 backend、scope status、revision、待处理文档/批次、逐 scope 重建/禁用、构建耗时、输入/估算索引字节和长任务数。
- P1 评测把治理、运行时安全和模型质量分开；冻结 V1 与 V2 必须在同一 cold/workspace-conditioned holdout 上对照。确定性评测报告 Top-1、Oracle@8、usable、完整 mixed、归因与拒绝原因；运行时评测直接调用生产 EngineRouter/Worker/Hybrid/deadline，独立报告全请求/可见 p90、fallback、timeout、warming 和 backend。诊断探针与轮询上界不得解锁 RC。
- 冻结 V1 通过独立子进程运行仓库内压缩快照，manifest 实算绑定 commit、逐文件、旧模型、观测补丁和聚合树 SHA；生产依赖与 Vite bundle 检查必须证明该快照不可达。普通 CI 复算 fail-closed 资产一致性，RC 则重新读取所有绑定文件并计算 canonical/tree SHA；Windows Tauri 发布还必须提供真实 WebView2 smoke 证据。
- Web/Rust 工作区索引采用相同的 fail-closed 默认预算：2,000 篇文档、单文档 512KiB、总输入 16MiB、单文档 20,000 entries、总计 300,000 entries。贡献只保存 fingerprint 和可逆统计；替换超限时保留旧贡献，不驻留原始正文。
- `CompletionEngineRouter` 只在请求安全边界原子切换已预热引擎。异步结果必须校验 epoch、文档版本、光标和焦点；超过 deadline 或迟到的结果被丢弃，不能替换已显示的 ghost。
- V3 只在 V2.2 cold/workspace 双 final 通过后启动；首期使用独立 Windows/Tauri 实验宿主和隔离候选目录，不实现 `.mlcompletion`、授权、商店、支付或账号，也不改变 V2 默认引擎。
- 固定矩阵为 48M/64M/80M、Q4/Q8 与 C1/C2/C3 的 256/512/1024-token 胶囊；不扩展为更大通用模型。模型与实验宿主 ≤96MiB，增量内存 ≤256MiB，可见 p90 ≤140ms。
- 研究候选必须在同集对照中让 cold/workspace 绝对可用率相对精确哈希绑定 V2 各提升至少 8pp，false trigger ≤3%、mixed 0，且结构化和强 Personal/Notebook 候选零回归。
- 固定 60 任务中英 dogfood 的 retained characters/opportunity 必须提升至少 15%，接受后撤销率不得恶化。任一质量、许可、体积或运行门禁失败即停止；只有研究通过后另立付费产品化 ADR 与计划。

## 主题数据流

1. `NotebookHome` 挂载时调用 `theme.init()`。
2. `useThemeStore` 读取 registry、local market、installed packages 和持久化 active theme。
3. `ThemeChromeState` 由当前 rendered theme 的 `ShellRecipe` 推导。
4. `AppShell` 和 `NotebookHome` 通过 `ThemeSlotBoundary` 暴露 Shell、编辑器、弹窗、toast、更新提示等 UX slot。
5. `ThemeRuntimeHost` 注册当前主题插件组件，切换主题时卸载旧插件并触发 runtime version 更新。
6. 主题 CSS 注入到 active style，主题作者必须使用 `[data-theme-id="<id>"]` 作用域。

## 边界

- 主题可以接管 JotLuck Shell 级 UX 与主要弹窗入口。
- 主题开发必须遵守 `doc/standards-theme-development.md`；不得新增未文档化 slot、Host API、Manifest 字段或宿主层 theme-id 特判。
- 主题不得直接替换 Markdown 清洗、文件 IO、搜索索引、导出服务或系统 API；这些能力通过宿主 action/API 间接触发。
- 商业化当前只提供接口和 mock 状态，不做真实支付、远程下载、账号体系或社区审核。
- 系统关联只注册为可选打开程序，ProgID 设置 `AllowSilentDefaultTakeOver`，不得写扩展名默认值或 `UserChoice`；欢迎页与设置页按 `UserChoiceLatest` 优先、`UserChoice` 回退读取用户明确选择，不用 Shell 候选推导冒充授权状态。
- NSIS 卸载按字母槽识别 `JotLuck.exe`，仅从 `MRUList` 删除对应字母并保持剩余顺序；不存在 JotLuck 槽时不得写 MRU，仍有其他槽时不得删除整个 `MRUList`。
- installed-app evidence 的正式信任根为 GitHub Actions + REST provenance。候选和 execution evidence artifact 必须来自同一个 `main`/`workflow_dispatch` run，`head_sha` 等于候选提交且 required jobs/steps 全部成功；缺 token、REST 失败、artifact 过期或 digest 不一致一律 fail-closed。
- required-case catalog 固定 adapter 与 artifact kinds；case result 必须包含可解析的 `execution-log.ndjson` 和指定观察产物。adapter 意图日志与真实 WebDriver 命令记录分离；WebDriver v3 以 `remote()` 返回后的 handshake 绑定 `attemptId + sessionId`，只保留锁定 `@wdio/protocols` 的 W3C 命令并折叠 browser/element wrapper 的重复 hook，只接受 handshake 后真实观察到的 case 命令与 `deleteSession`，不得伪造 hook 无法观察的 `newSession`。证据提交中的 raw report、case results 和附件必须与下载的 execution artifact 精确同构，transcript 只允许守恒转录。
- capture 只调用仓库内固定的 28 个 adapter，不接受 manifest、参数或环境变量注入测试命令。Windows runner 从卸载注册表解析真实安装位置，并要求安装后 EXE 与候选 artifact 中 `jotluck.exe` 的字节数/SHA-256 完全一致；ASSOC-01～08 还必须绑定 case 对应扩展名、目标内容或二进制前后 readback、注册命令的规范安装路径，通过 `ShellExecuteExW` 对笔记格式指定 `JotLuck.Note`、对文档格式指定 `JotLuck.DocumentImport`，并用 UI Automation 保存正文 matched text 与 CIM `ExecutablePath`。所有 case 完成或失败后统一回收 WebDriver、Shell PID、应用进程、安装状态、临时文件和测试注册表项。
- materialization job 必须先通过同一 run 的 REST resolver 核验 repository/workflow/event/branch/SHA/attempt、前置 job、固定 artifact ID/name/digest/size/唯一性，再按 ID 下载。materializer 对 raw report、case results 和附件逐文件验证增删改，生成 transcript、manifest、构建 inventory 与 preview-gate；该输出在进入独立 evidence commit 并通过在线 provenance 前只能称为 `structural-diagnostic`。
- 安装版性能使用 catalog 中的 `coldStartP90ReferenceMs` / `hotWindowP90ReferenceMs`。20/30 原始样本、正数约束、P90 复算和 advisory 守恒是硬门控；20 次冷启动每轮前后必须为零进程，30 次热开窗每轮关闭后必须恢复原窗口数，热会话结束后必须再次为零进程。超过参考线只返回 `pass-with-warnings`，不改变退出码；生命周期边界不完整仍硬失败。

## 变更记录

- 2026-08-05：Windows 专业编辑器启动增加不可跨 apartment 的关联处理器兼容路径；仍只使用系统枚举返回的完整可执行文件，不解析注册表命令，并保留 Open With 末级回退。

- 2026-08-05：离线补全升级到 V2.2 双平面、CM6 增量上下文、精确 TextEdit、retained 学习与 v5 持久化；登记 `public-v2-free-decoder-v1`、24MiB 总预算和 V3 隔离研究前置门禁，既有 RC 与 V2R/V2S stop 不变。

- 2026-08-04（v1.1）：增加独立文档导入会话、同可执行文件转换 worker、版本化流协议、资源/取消边界、源 revision、原子另存和 Windows 关联处理器架构。

- 2026-08-04：将结构化错误合同限定到会进入本地化 UI 的 IPC/MockFS，补全检索和内部诊断明确排除。
- 2026-08-03：新增五语言 Vue 运行时、LocaleManager、结构化 Tauri/MockFS 错误、单一内置内容源及 Theme Host i18n 数据流。

- 2026-07-30：补充本地图片的宿主解析、DOMPurify 顺序、异步 generation 与外部单文件授权边界。
- 2026-07-27：增加固定 installed-app adapter、同 run REST resolver 和 evidence materializer；性能参考线改为可复算 advisory，证据完整性仍 fail-closed。
- 2026-07-27：installed-app evidence 增加 Shell/ProgID 真实关联路径、adapter/driver 双日志、WebDriver 语义校验与冷启动零进程生命周期。
- 2026-07-27：关联证据进一步绑定 case 扩展名、候选/安装 EXE 哈希和注册命令路径；WebDriver 改为逐 case 命令合同，RF-10 补齐热窗口与会话终态。
- 2026-07-27：WebDriver 观察升级为真实 remote handshake + attempt/session 状态机；最终 gate 独立重哈希候选 EXE，ASSOC/RF-10 使用版本化 readback/identity，仓库文本固定为 LF。
- 2026-07-26：installed-app evidence v2 改用 GitHub REST run/artifact provenance，并加入固定 adapter、执行日志和 execution artifact 精确快照；NSIS 卸载改为 MRU 保序清理。
- 2026-07-25：新增单进程多窗口窗口会话架构、窗口身份 IPC、规范路径去重、外部只读轻量入口以及窗口级 root/index/watcher/completion 隔离。
- 2026-07-25：明确 P1 grant 升级与 `assert_workspace` 命令边界；增加 `v0.10.0-rc.1` Public L3 stop / V2S 生产不可达 gate。
- 2026-07-13：Public V2S 在有界 development 预检中未达到 Oracle 架构门槛，记录 architecture stop；不训练 Gate、不读取 final、不安装 v6 public 资产。
- 2026-07-13：新增 Public V2S 目标架构：双语 Subword MKN + 小门控、256-byte Worker 边界、v6 单 manifest/单资产与 35% 绝对可用率双 final 合同。
- 2026-07-13：`public-phrase-transformer-v1` 固定短语分类架构停止；训练、publisher 和 v5 verifier 由 architecture-stop 记录硬阻断，未来开放词表/组合生成需新 ADR 与 manifest schema。

- 2026-07-12：V2R 输入固定为 192-byte/48×4-byte patch；训练数据升级为 silence-safe v3，禁止把短语库表示缺口标为 abstain，并将生成器治理升级为 v3.1 的文档级多样性约束。
- 2026-07-12：V2R 训练样本升级为多合法前缀目标，并补齐 generator/training-data/bundle 与 manifest 的可重算证据闭环；新增不可进入普通生产构建的 evaluation-only 候选包，发布闸门保持关闭。
- 2026-07-12：公共 L3 升级为 V2R 边界感知短语 Transformer，新增生成引擎 Worker/v5 manifest、30MiB 训练拆分、多参考 cold/workspace 盲测与 60% 绝对可用率发布合同；主题架构未变更。
- 2026-07-11：补齐 synthetic-only source set、validation/final 一次性语义、V1 子进程快照、实际证据复算、Hybrid 原子批/逐 scope 恢复与真实 WebView2 smoke 合同。
- 2026-07-11：补充 P1/P2 可信评测、原子快照查询、Worker 不可用禁用策略和单次回放重建合同；主题架构未变更。
- 2026-07-11：新增 §3.12，定义 V2 异步候选批次与 V2.1 数据型语义重排扩展边界。
- 2026-07-11：补充 §3.11 的嵌套学习曲线、冻结 holdout、解析长任务和发布证据绑定；主题架构未变更。
- 2026-07-11：补充 §3.10 的分层 top-k、跨文档支持、sectioned v4 语言分路和定额蒸馏发布闸门；主题架构未变更。
