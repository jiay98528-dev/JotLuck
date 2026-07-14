# JotLuck 离线补全模型训练说明

> 版本：v1.0
> 日期：2026-07-14
> 状态：Public V2R、Public V2S 均已停止；公共 L3 默认未绑定；本文是模型训练与证据流程的唯一操作说明

## 1. 当前结论

JotLuck 的离线补全不是一个单模型系统。结构化补全、当前文档 L1、Personal L2、Notebook/Hybrid 和可选 Public L3 经过同一个 Resolver，最终只显示一条 ghost text。公共模型失败或不存在时，其他确定性路径仍可工作。

当前不得继续训练或发布公共模型：

- `public-phrase-transformer-v1`（V2R）受 `scripts/corpus/autocomplete-v2r-architecture-stop.json` 阻断。固定短语输出空间无法覆盖真实写作 continuation。
- `public-v2s-mkn-v1`（V2S）受 `scripts/corpus/autocomplete-v2s-architecture-stop.json` 阻断。固定矩阵的 development Oracle 未达到预登记架构门槛。
- 两份 stop 都是 `releaseEvidence:false` 的停止依据，不是模型质量 PASS；它们只证明对应架构不应继续同根因训练。
- `packages/app/public/autocomplete/` 当前没有可运行的 canonical Public L3。生产 `MarkdownPredictor` 不自动导入已停止的 V2S Worker。
- RC 的预期结果是 code `10`。不得删除 stop、修改资格布尔值或降低阈值来改变结果。

因此，本文的“训练流程”用于解释已有管线、复核历史候选，以及约束未来新架构；不是继续当前 V2S 矩阵的运行许可。

## 2. 唯一真相源

| 内容               | 权威位置                                                                                          | 说明                                              |
| ------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 产品与交互合同     | `spec/frontend/autocomplete-spec.md`                                                              | 单 ghost、Tab/Escape、语言与 Markdown 门控        |
| 训练操作说明       | `doc/autocomplete-model-training.md`                                                              | 本文；命令、语料、评测、证据和停止流程            |
| 架构演进记录       | `plans/autocomplete-engine-v2.md`                                                                 | V2、V2R、V2S 的历史决策和结果                     |
| V2R 停止事实       | `scripts/corpus/autocomplete-v2r-architecture-stop.json`                                          | 不可改写的历史停止记录                            |
| V2S 停止事实       | `scripts/corpus/autocomplete-v2s-architecture-stop.json`                                          | 当前公共训练入口的硬停止记录                      |
| v4 来源批准事实    | `scripts/corpus/provenance.json`、`scripts/corpus/SOURCES.md`                                     | 旧 curated/synthetic 来源与永久排除项             |
| V2R/V2S 来源事实   | `scripts/corpus/autocomplete-v2r-generator.json`、`scripts/corpus/autocomplete-v2r-external.json` | v3.1 生成器、外部来源和选择身份                   |
| Tatoeba 清洗与许可 | `scripts/corpus/tatoeba-cc0-cleaning-report.json`、`scripts/corpus/licenses/tatoeba-cc0.md`       | 固定 CC0 子集、清洗结果和许可证证据               |
| 训练缓存           | `scripts/corpus/_web-cache/`                                                                      | 可删除、可再生、Git ignored；不得单独作为放行证据 |
| 正式公共入口       | `packages/app/public/autocomplete/autocomplete-public.manifest.json`                              | 未来发布时只能有这一份 canonical manifest         |

冻结 V1 只属于评测闭包；v4 N-gram、V2R 和 V2S 历史脚本不得成为第二个生产模型真相源。

## 3. 已完成实验

### 3.1 v4 公共 N-gram

七档项目自有合成学习曲线从约 0.1MiB 扩至 24MiB。治理和容量通过，但 cold validation 的绝对可用率均为 0，最终 `selectedTier:null`。扩大同类语料没有形成发布候选。

### 3.2 V2R 固定短语 Transformer

8,192/12,288/16,384 短语库在已观察真实写作诊断集上的绝对表示率最高只有 13%，中文 6%。条件 Oracle 曾因提前过滤 bank miss 而显得较高，不能代表开放写作候选能力。该架构已经停止，ONNX Worker 和运行时依赖不在生产依赖图中。

### 3.3 V2S Subword MKN

V2S 使用中英文物理分区、4096-token 边界感知 tokenizer、2–5 阶 Modified Kneser-Ney、压缩 TypedArray Trie 和选择性 Gate。固定矩阵结果如下：

| 候选                      |   训练字节 | Oracle@8 | Oracle@32 | 结论                |
| ------------------------- | ---------: | -------: | --------: | ------------------- |
| 3MiB Unigram              |  3,145,671 |    30.0% |     34.5% | 未通过              |
| 8MiB Unigram              |  8,388,270 |    30.5% |     36.0% | 未通过              |
| 24MiB Unigram             | 24,917,371 |    30.5% |     35.0% | 未通过且无单调增益  |
| 24MiB BPE-en + Unigram-zh | 24,917,371 |    37.0% |     40.0% | 未通过              |
| 固定矩阵逐语言理论前沿    |          — |    37.5% |     40.5% | 仍低于 40%/45% 门槛 |

最大候选二进制为 5,735,917B，解析约 21.47ms、生成 p90 约 8.97ms、mixed 为 0。瓶颈不是体积或延迟，而是候选覆盖与排序余量不足。以上均是 `releaseEvidence:false` 的 development 诊断，不得外推为正式发布质量。

## 4. 训练数据合同

### 4.1 允许来源

训练器只能读取 selection manifest 明确列出的文档。每篇文档必须能回溯到批准来源、许可证证据、相对路径、语言、类别、字节数和内容 SHA-256。

V2R/V2S 固定 selection 只允许以下来源：

- 项目自有短笔记生成器 v3.1；
- 具有固定清洗报告和内容身份的 Tatoeba English CC0 子集；

`provenance.json` 中的 curated/synthetic-v1 只属于 v4 历史来源，不得混入 V2R/V2S selection。Common Voice 没有批准快照，不得自动补入。网页、小说、未知许可证正文、产品规格、E2E holdout 和补全评测样本不得进入训练。

### 4.2 永久隔离

- `scripts/corpus/novel-zh/` 永久硬隔离；文件存在不代表获准训练。
- `doc/`、`spec/`、`memory/`、E2E fixture 和所有 holdout 永远不是语料来源。
- 自指补全文案、高重复 anchor、站点导航、聊天提示、真实姓名、邮箱、电话、地址和账号必须为 0。

### 4.3 数据拆分

历史 30MiB 池按文档和来源分组：24MiB train、3MiB development、3MiB internal selection。较小档必须是较大档的文档 ID 与内容 SHA 严格前缀。不得把 development/internal/final 重新并入 train 来增加体积。

治理硬门槛：

- 未授权来源、隐私残留、导航/会话样板：0；
- 清洗后精确重复：0，近似重复率 ≤3%；
- 单来源 ≤20%，单类别 ≤40%；
- train 与 validation/final 的精确和近似重叠：0；
- 中英文、类别和来源汇总必须从逐文档事实重算，不能相信报告自报。

## 5. 模型构建合同

### 5.1 V2S 历史固定参数

- engine：`public-v2s-mkn-v1`；
- tokenizer：中英文分别比较边界感知 BPE/Unigram，各 4096 token；
- n-gram：2–5 阶 Modified Kneser-Ney；
- 压缩：相对熵与真实 Trie 摊销字节剪枝；
- 数值：概率和 backoff 使用确定性 Q16；
- Gate：G0 L2 正则逻辑回归或 G1 16-hidden INT8 MLP，仅负责 show/abstain；
- 资产：目标 ≤5.5MiB，manifest + model 硬限制 ≤6MiB；
- 运行：只允许 Worker，宿主最多传入最后 256 个 UTF-8 字节。

Gate 不会改变候选文本或重新排列 Top-1。训练 Gate 前，生成器必须先在未过滤机会集通过 Oracle；bank miss 不能标成 abstain，也不能从分母删除。

### 5.2 停止态命令

当前只允许只读检查：

```powershell
# 查看 CLI 和固定参数，不产生候选
pnpm exec tsx scripts/autocomplete-v2s/cli.ts --help

# 验证 stop 记录的 schema、算术、绑定和生命周期
node scripts/verify-autocomplete-v2s-evidence.mjs --mode=ci

# 预期返回 code 10：确认 RC 仍拒绝失格公共模型
node scripts/release-rc-gate.mjs --autocomplete-only
```

预期证据校验状态为 `architecture-stopped-fail-closed`、`releaseEligible:false`。RC code `10` 是正确安全结果，不是待修复错误。

以下入口由 stop 在读取 gate/final 输入前硬阻断：

- `autocomplete-v2s train`；
- `autocomplete-v2s repack-gate`；
- `autocomplete-v2s combine-languages`；
- `publish-autocomplete-v2s-final`；
- V2.1 解锁。

`derive` 和 `diagnose` 仍作为历史 selection/候选复核工具保留，不代表获得继续搜索许可；当前维护流程不得用它们生成新训练结论或覆盖停止记录。

不要为了“复现训练”删除 stop。历史 ignored cache 不是干净克隆可重建的正式发布证据；缺失缓存时只能复核受版本管理的停止记录、源码和测试。

## 6. 评测口径

每套正式 validation/final 固定 200 checkpoints：150 complete、50 silence；中英文各 100。Workspace support 与目标文档完全分离。

```text
TriggerRate          = 触发数 T / 200
AbsoluteUsableRate   = 可用数 U / 200
ConditionalPrecision = U / T，仅诊断
SilenceFalseRate     = silence 误触发 F / 50
Oracle@K             = 前 K 个候选任一满足人工参考的 checkpoint 数 / 200
```

V2S 架构预检要求 Oracle@8 ≥40%、Oracle@32 ≥45%、中英文 Oracle@8 各 ≥32%。发布要求每套：

- 触发率 35%–42%（70–84/200）；
- 绝对可用率 ≥35%（至少 70/200）；
- silence false ≤3%，按 50 个样本即最多 1 次；
- 每种语言绝对可用率 ≥30%，每类别 ≥25%；
- 完整候选池和最终 ghost 的 mixed 均为 0；
- 全请求与可见 ghost p90 均 ≤140ms；
- B0 + Public 不得低于 Public-off B0，cold 新增覆盖至少 8pp。

Oracle 必须使用全部机会点为分母。固定探针、seeded 场景、条件 bank-hit 指标、轮询上界延迟和 skipped E2E 都不能成为发布质量 PASS。

## 7. 候选、final 与发布顺序

未来新架构只有在新 ADR、新 engine ID、新 manifest schema 和未观察 holdout 已冻结后，才能重新进入以下流程：

1. 物化批准语料并生成逐文档 selection manifest。
2. 运行许可、隐私、重复、分布和 train–validation overlap 治理。
3. 在隔离 candidate 目录训练；训练器永远不得写 `packages/app/public/`。
4. 使用绑定模型真实重放 validation，先验证绝对 Oracle，再验证 Top-1、Gate 和运行时。
5. 冻结候选、阈值、模型 SHA、训练输入树和 evaluator 源码树。
6. 同时 claim cold/workspace final SHA，之后才解封 final 明文。
7. final 失败、中断或 overlap 失败都消费该版本，禁止回到同一 final 调参。
8. Windows Tauri WebView 真实执行离线烟测；Web build 或 Rust 单测不能替代。
9. 唯一 publisher 重算全部证据，先安装内容寻址模型，最后原子切换 canonical manifest。
10. RC 从实际 artifact 重放并验证；不得相信 manifest 的资格布尔值。

正式证据必须绑定精确候选 commit、模型 SHA、训练输入树、holdout 树、evaluator 源码树、原始执行 transcript、非零 counters、退出码、运行时报告、WebView smoke 和二次只读转录。任何 skip、零测试、ignored 唯一产物、路径越界、符号链接或内容漂移都失败关闭。

## 8. 未来重启条件

当前 V2S 不因增加同分布语料而重启。已有 3→8→24MiB 曲线没有单调收益，且最大模型已接近预算。若未来重新研究公共 L3，必须满足：

- 新 ADR 解释它如何突破候选覆盖或 Top-1 排序瓶颈；
- 使用新的 engine ID 和 manifest schema，不修改历史 stop；
- 新 validation/final 在训练前冻结，不能复用已观察 development；
- 先执行有界 24/48/96MiB 或等价规模实验，并预登记停止条件；
- 若首个扩容档 Oracle@8/32 增益均 <2pp，停止同分布扩容；下一档增益 <1pp 时确认饱和；
- 选择性 Gate 不能提升原始 Top-1，因此原始 Top-1 低于 70/200 时不得声称可达到 35%绝对可用率；
- 新方案仍只能占用一个 `CompletionPublicEngine` 插槽和一个 canonical public manifest。

这允许未来采用更有效的组合式生成或极小候选重排，但不允许在 V2R/V2S 上继续无边界调参。

## 9. 最小维护检查表

- [ ] 当前 stop 是否仍在 CLI、trainer、publisher、verifier 和 RC 输入读取前生效？
- [ ] 普通生产 bundle 是否不包含已停止 Worker/WASM/ONNX？
- [ ] public 目录是否只有零或一份 canonical manifest及其唯一内容寻址资产？
- [ ] selection 的每篇文档是否能回溯到批准来源、许可证和内容 SHA？
- [ ] train、validation、final 是否按时序隔离且无精确/近似重叠？
- [ ] Oracle、Top-1、usable 是否都使用完整机会点作为分母？
- [ ] 英文候选是否保持完整词边界，中文候选是否至少 3 个有效汉字？
- [ ] mixed、循环、残词、多行和低信息候选是否在完整候选池检查？
- [ ] 正式评测是否由绑定二进制真实重放，而非报告自报？
- [ ] final 是否只消费一次，WebView smoke 是否真实执行？
- [ ] 发布是否由唯一 publisher 原子切换 canonical manifest？
- [ ] RC 失败时是否保持 Public L3 关闭且不回退历史模型？
