# JotLuck TAD

版本：2026-07-11

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

## 离线补全架构（3.11）

- `MarkdownPredictor` 是工作区级稳定 facade，组合 Markdown 上下文扫描、结构化 Provider、Resolver、N-gram 引擎和按工作区隔离的学习仓库；编辑器 keyed 重建不重建 Predictor。
- 数据层固定为当前文档 L1、notebook 按文件可撤销贡献 N2、仅接收明确用户反馈的 Personal L2，以及应用级只读单例 L3。各层分别输出 top-k 候选；N2 先汇总跨文档支持再剪枝，不与 Personal L2 原始计数合并。
- 学习仓库统一持久化 Personal L2、accepted lexicon、signals、metrics 和元数据；写入按 scope 串行合并，可用时使用 Web Locks，并通过 BroadcastChannel/storage event 同步多标签页。
- L3 采用 sectioned v4：中文字符表支持高文档频次 4→3→2 回退，英文优先词级 bigram/trigram，字符 4-gram 只做词内回退。manifest 约束表 profile、阶数范围、定点计数尺度、条目数、字节数、SHA-256、训练输入哈希、`runtimeEligible` 和发布资格；大表按批异步解析并让出主线程，加载失败时只允许回退到另一份通过同等验证且可运行的内置模型。
- 训练管线使用批准来源、全局定额蒸馏和原子发布，硬隔离 `novel-zh`，运行时模型保持 ≤6MiB；原始重复率、独立 holdout 质量或哈希绑定失败时只能生成隔离候选，不能替换正式资产。24MiB 学习曲线具有独立 source set，只允许五个同版本、同 seed 的项目生成器来源；curated 或生成目录外路径进入该 source set 时立即失败。
- 扩池评测使用固定 `0.1/0.5/1/3/8/16/24MiB-cap` 嵌套样本和冻结 checkpoint；成员关系以文档 ID 与内容 SHA 集合验证，小档必须是大档严格前缀，末档允许使用不超过 24MiB 的完整批准池。cold validation 选择满足绝对门槛且不低于同集 V1 的最小档；只有选出候选后才能一次性消耗 workspace final。发布资格绑定模型、输入、validation、final、评测器源码树、V1 快照、质量/运行时/V1-V2/学习曲线证据的实际路径与 SHA，不能由单一布尔值放行。
- 运行时解析采用可测量的分块让出策略；最大同步 chunk 必须小于 50ms，否则发布前升级为 Worker 或紧凑 Trie。英文词边界只查询词级 bigram/trigram，字符模型仅在未完成单词内部承担拼写续写。

## 离线补全可插拔扩展（3.12，V2.1 规划）

- V2 将普通候选整理为最多 8 条的不可变 `CandidateBatch`，携带 engine epoch、workspace scope、document version、UTF-16 cursor、deadline 和取消信号；确定性结构化候选旁路语义扩展。
- Web/PWA 的工作区短语检索运行在专用 Worker，Tauri 使用 Rust 应用状态中的等价内存后端；两端共享候选协议，并统一在 TypeScript 层执行排名、Resolver 和质量门控。后端失败或超时始终退回免费 V2 fallback。
- Worker/CSP 不可用时 Hybrid Retrieval 直接 disabled，不允许在主线程同步建索引。文档 mutation 以最多 8 项、正文最多 2MiB 的原子批提交，revision 每批递增一次；latest-only query 可在批次之间读取最近 committed snapshot，不等待 mutation backlog。Web Worker 与 Tauri 都不得向查询暴露半批状态；Tauri query 只短暂克隆 `RwLock<Arc<CommittedSnapshot>>`，contribution 构建和 writer 应用期间仍返回旧 revision。
- 非 Abort 故障按 scope 管理：每个工作区每次会话只重建一次，第二次失败只禁用该 scope；scope/epoch 变化属于 obsolete/cancel，不计故障。恢复从训练服务维护的当前工作区文件事实快照按 `(scope, signal)` 回放，training meta 不得充当唯一文件清单。健康诊断统一暴露 backend、scope status、revision、待处理文档/批次、逐 scope 重建/禁用、构建耗时、输入/估算索引字节和长任务数。
- P1 评测把治理、运行时安全和模型质量分开；冻结 V1 与 V2 必须在同一 cold/workspace-conditioned holdout 上对照。确定性评测报告 Top-1、Oracle@8、usable、完整 mixed、归因与拒绝原因；运行时评测直接调用生产 EngineRouter/Worker/Hybrid/deadline，独立报告全请求/可见 p90、fallback、timeout、warming 和 backend。诊断探针与轮询上界不得解锁 RC。
- 冻结 V1 通过独立子进程运行仓库内压缩快照，manifest 实算绑定 commit、逐文件、旧模型、观测补丁和聚合树 SHA；生产依赖与 Vite bundle 检查必须证明该快照不可达。普通 CI 复算 fail-closed 资产一致性，RC 则重新读取所有绑定文件并计算 canonical/tree SHA；Windows Tauri 发布还必须提供真实 WebView2 smoke 证据。
- Web/Rust 工作区索引采用相同的 fail-closed 默认预算：2,000 篇文档、单文档 512KiB、总输入 16MiB、单文档 20,000 entries、总计 300,000 entries。贡献只保存 fingerprint 和可逆统计；替换超限时保留旧贡献，不驻留原始正文。
- `CompletionEngineRouter` 只在请求安全边界原子切换已预热引擎。异步结果必须校验 epoch、文档版本、光标和焦点；超过 deadline 或迟到的结果被丢弃，不能替换已显示的 ghost。
- V2.1 的 `SemanticReranker` 位于候选硬门控之后、最终 Resolver 之前，不作为普通 Provider。它只能重排已有候选，不能改写文本、插入位置、来源归因或学习属性。
- `.mlcompletion` 是签名数据包，只能包含白名单模型、tokenizer、manifest 和校验信息，禁止任意 JS/WASM/原生代码。首版由固定 ONNX/WASM Worker 宿主加载；Tauri 不采用运行时下载 sidecar。
- 插件只接收截断上下文和候选，不暴露文件系统、工作区枚举或网络能力。安装、预热、升级、授权变化、切换和回滚必须原子化，免费 V2 始终保持可用。
- 免费 V2 的公共检索资产以 ≤4MiB 为产品目标、6MiB 为兼容硬上限；工作区内存索引与 V2.1 可选包分别核算。

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

## 变更记录

- 2026-07-11：补齐 synthetic-only source set、validation/final 一次性语义、V1 子进程快照、实际证据复算、Hybrid 原子批/逐 scope 恢复与真实 WebView2 smoke 合同。
- 2026-07-11：补充 P1/P2 可信评测、原子快照查询、Worker 不可用禁用策略和单次回放重建合同；主题架构未变更。
- 2026-07-11：新增 §3.12，定义 V2 异步候选批次与 V2.1 数据型语义重排扩展边界。
- 2026-07-11：补充 §3.11 的嵌套学习曲线、冻结 holdout、解析长任务和发布证据绑定；主题架构未变更。
- 2026-07-11：补充 §3.10 的分层 top-k、跨文档支持、sectioned v4 语言分路和定额蒸馏发布闸门；主题架构未变更。
