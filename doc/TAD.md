# JotLuck TAD

版本：2026-07-13

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
- `CompletionEngineRouter` 管理唯一、模型无关的 `CompletionPublicEngine` 生成插槽与未来只做重排的 V2.1 `CompletionRanker`。公共插槽默认未绑定；只有通过独立证据的模型才能显式安装。epoch、workspace scope、document version、UTF-16 cursor、deadline 与 AbortSignal 继续作为迟到结果边界。
- Public V2S 的目标 canonical 入口为 `packages/app/public/autocomplete/autocomplete-public.manifest.json`，只引用一份内容寻址 v6 二进制；候选阶段仍保留当前 v4 pair 的 fail-closed 状态，正式切换时必须删除旧 pair。任何时刻都不得同时发布两代公共资产，冻结 V1 只存在于隔离评测闭包。
- 已停止的 `public-phrase-transformer-v1` 训练、语料治理、量化和证据代码保留在 `scripts/` 供复核；其 Worker、ONNX adapter、默认 factory 与 `onnxruntime-web` 已从生产依赖图移除。`autocomplete-v2r-architecture-stop.json` 继续阻断长训练、publisher 与 v5 verifier。
- Public V2S 在专用 Worker 内执行中英文独立的边界感知 Subword Modified Kneser-Ney 查询和小型选择性门控。宿主只传光标前最后 256 个 UTF-8 字节；Worker 只返回原始文本/分数，Router 校验并盖章插入位置、来源、层级和优先级。Worker/CSP/资产校验失败时返回空 L3，禁止主线程推理。
- canonical manifest 与内容寻址二进制只有在 schema、大小和 SHA 全部通过后才可写入 `jotluck-public-v2s-v1` CacheStorage；离线时只读该验证后缓存，身份不符立即关闭 Public L3。中英文 tokenizer/Trie 可在训练期分别选择，但发布时仍封装为同一 v6 二进制和一个公共插槽。
- `public-v2s-mkn-v1` 的固定矩阵与唯一逐语言组合修正已完成；最大 5,735,917B 候选的 development Oracle@8/32 为 37%/40%，固定矩阵逐语言最好前沿为 37.5%/40.5%，仍未达到 40%/45% 总体架构门槛。`autocomplete-v2s-architecture-stop.json` 因此在任何输入读取前阻断训练、Gate repack、组合和 publisher；CI 只能确认公共 L3 继续 fail closed，不能把停止状态计为质量 PASS。
- 停止态下 `MarkdownPredictor` 只接受显式注入的 `CompletionPublicEngine`，不自动导入 V2S factory；因此普通生产 bundle 不含已停止 Worker。V2S engine/factory 源码仅供单元测试和隔离评测复核，不能由无 manifest 的生产路径隐式激活。
- 公共模型仍须满足 manifest+单资产 ≤6MiB、主线程无模型长任务、双 p90 ≤140ms、独立 cold/workspace final 和完整证据绑定；发布器只能原子替换唯一 canonical profile，不能并行安装多版本或用旧模型 fallback 掩盖失败。
- 结构化 Provider、L1、Personal L2、Notebook N2 与 Hybrid 是互补来源而非公共模型版本；公共 L3 缺失或失败时它们继续提供免费确定性路径。

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
