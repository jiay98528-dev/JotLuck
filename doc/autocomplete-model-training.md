# JotLuck 离线补全模型训练说明

> 版本：v2.0
> 日期：2026-08-05
> 状态：Public V2R、Public V2S 继续停止；`public-v2-free-decoder-v1` 只进入下一版本 DEVELOPMENT 训练；公共 L3 默认未绑定；本文是模型训练与证据流程的唯一操作说明

## 1. 当前结论

JotLuck 的离线补全不是一个单模型系统。结构化补全、当前文档 L1、Personal L2、Notebook/Hybrid 和可选 Public L3 经过同一个 Resolver，最终只显示一条 ghost text。公共模型失败或不存在时，其他确定性路径仍可工作。

当前边界分为“历史停止架构”和“下一版本开发训练”两部分：

- `public-phrase-transformer-v1`（V2R）受 `scripts/corpus/autocomplete-v2r-architecture-stop.json` 阻断。固定短语输出空间无法覆盖真实写作 continuation。
- `public-v2s-mkn-v1`（V2S）受 `scripts/corpus/autocomplete-v2s-architecture-stop.json` 阻断。固定矩阵的 development Oracle 未达到预登记架构门槛。
- 两份 stop 都是 `releaseEvidence:false` 的停止依据，不是模型质量 PASS；它们只证明对应架构不应继续同根因训练。
- `packages/app/public/autocomplete/` 当前没有可运行的 canonical Public L3。生产 `MarkdownPredictor` 不自动导入已停止的 V2S Worker。
- RC 的预期结果是 code `10`。不得删除 stop、修改资格布尔值或降低阈值来改变结果。
- 新 engine `public-v2-free-decoder-v1` 已获准在独立 DEVELOPMENT 切片训练，但只允许形成 `trained` 或经 Oracle 后的 `oraclePassed` 候选；不得写 production public、切换默认引擎、读取 final 或改变当前 RC。
- V2.2 使用新的 8K Unigram + byte fallback、`JLFDQ02` group-size 64 量化格式和独立缓存。它不能复用 V2R/V2S 的 ID、manifest、缓存、final 或停止证据。

因此，本文的“训练流程”既用于复核历史停止事实，也作为 V2.2 开发候选的操作合同；它绝不是恢复 V2R/V2S 或发布 V2.2 的许可。

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
| V2.2 训练/评测入口 | `scripts/autocomplete-v2-free/`                                                                   | selection、训练、JLFDQ02、评测、final pair ledger |
| 幻15节点操作边界   | `scripts/autocomplete-v2-free/remote/README.md`                                                   | 只描述显式人工初始化、传输、任务与状态合同        |
| Tatoeba 清洗与许可 | `scripts/corpus/tatoeba-cc0-cleaning-report.json`、`scripts/corpus/licenses/tatoeba-cc0.md`       | 固定 CC0 子集、清洗结果和许可证证据               |
| V2.2 补量来源审查  | `scripts/corpus/licenses/v2-free-public-source-review.md`                                         | 官方端点观察、采用/拒绝理由和 manifest 义务       |
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

V2.2 selection 可以从现有约 24.9MiB、哈希完整且许可证仍有效的 V2R train 文档重新物化；任何补充来源都必须是项目自有或具有明确 SPDX/许可证据的公开数据。每篇文档固定记录 source、许可证据、语言、类别、字节数、内容 SHA-256、生成/清洗版本和 seed。训练阶段固定为 32MiB 全链路 smoke、128MiB 四候选矩阵；只有全部失败且最佳候选距离每项 Oracle 门槛均不超过 5 个百分点时，才允许扩到 256MiB 重跑完整矩阵，否则 architecture-stop。清洗池硬上限 512MiB。

2026-08-05 的补量组合只用于 32MiB smoke。2026-08-08 的独立 DEVELOPMENT 审查为 128MiB 正式矩阵追加四个固定 Wikimedia 2026-08-01 自然文本快照；这不是对来源许可证的法律意见：

- 复用项目已经固定、已绑定 raw SHA 和清洗报告的 Tatoeba English CC0 内容中尚未进入当前 V2.2 selection 的合格文档；2026-08-01 上游周快照只能作为来源仍可获取的观察事实，因其字节身份与已固定快照不同，不得静默替换。
- 以 project-owned v1 确定性生成器补齐剩余容量，但必须在 V2.2 下重新绑定 generator version、recipe、seed 和逐文档 SHA；不得直接把历史 v4 selection 当作 V2.2 输入，也不得引入 holdout、测试答案或自指补全文案。
- 32MiB smoke 的两类补充合计至少 9MiB，并在构建后重新执行许可、隐私、重复、分布和 overlap 治理；32MiB 是清洗后 selection 正文容量，不是下载包、压缩包、链接表或 manifest 的文件大小。
- 128MiB 矩阵使用 exact-dated 的 enwiki、zhwiki、enwikibooks、zhwikibooks 四份快照，各最多贡献 24MiB 清洗正文。只允许 namespace 0 自然段，按文章边界切成 256–2,048 UTF-8 bytes，并以 `SHA256(sourceId|pageId|segmentIndex|20260805)` 排序选择。
- Wikimedia 文本按 CC BY-SA 4.0 和上游附加条款记录归因、dump 日期、页面/revision、raw SHA、清洗器与逐段 SHA；只批准 DEVELOPMENT 研究。模型分发所需的 attribution/Share-Alike 处理必须另行审查，不能从训练准入推导 `releaseEligible`。

Tatoeba `cmn` CC0 周快照只有 102 bytes，不能作为中文补量来源。普通 `cmn` 句子导出和全局 links 表不属于本轮 CC0 冻结输入；links 表是关系 ID 而非正文，不得把其 149,039,032 个压缩 bytes 计入训练正文。Wikimedia 只允许使用 `scripts/corpus/licenses/v2-free-public-source-review.md` 中四个 exact-dated 对象，不得回退到 mutable `latest`。若 Wikibooks 清洗后不足，必须先在该记录中新增同语言 Wikisource 固定快照审查，不能静默替换。

本次补量只服务 `public-v2-free-decoder-v1` 的 DEVELOPMENT 训练，不删除、覆盖或重新解释 V2R/V2S 的 architecture-stop，也不授权读取 final、写入 production public 或切换默认引擎。

固定补量入口为 `scripts/corpus/autocomplete-v2-free-supplement.json` 与 `scripts/autocomplete-v2-free/supplement.ts`。2026-08-05 首次物化得到 13,024 篇、9,444,087 bytes（中文 4,846,791；英文 4,597,296），supplement input tree 为 `49d4074202ebceb57a8539b6635aeed0276f89ca6d67fb7b2117340cffc1a1e5`，manifest SHA-256 为 `008ee8e2f315b3d92fa6d4d4e82e9fe1eb45dc831167b02499cf906a7ee936e0`。与固定 V2R train 基线合流后，`formal-32mib-smoke` selection 为 93,637 篇、34,361,458 bytes（中文 17,181,255；英文 17,180,203），input tree 为 `90fc47e1086ff740a0f479b2e718e45aeb57decf876b94325fb3e03708f8d2f8`；确定性 5% development split 为 4,682 篇、1,689,738 bytes。物化正文、supplement manifest 和 selection manifest 均位于 Git ignored 的 `_web-cache`，可由固定配置重建，不是发布资产。

### 4.2 永久隔离

- `scripts/corpus/novel-zh/` 永久硬隔离；文件存在不代表获准训练。
- `doc/`、`spec/`、`memory/`、E2E fixture 和所有 holdout 永远不是语料来源。
- 用户笔记、Personal/Notebook 数据、反馈、本地指标、代码、frontmatter、密钥和测试答案永远不得进入公共训练 selection。
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

### 5.2 V2.2 开放词表 decoder

- engine：`public-v2-free-decoder-v1`；
- 候选矩阵：16M Q4、16M Q8、24M Q4、32M Q4；16M 只训练一份 float checkpoint，再从同一权重分别导出 Q4/Q8；
- tokenizer：单一 8K Unigram、固定 `character_coverage=0.9995`、完整 256-byte fallback、NFKC 与训练/Rust runtime golden parity；极低频 Unicode 字符必须走 byte fallback，不得为保留全字符而扩大词表；
- tokenizer 身份：128MiB train split 只冻结一次 `tokenizer.unigram.model` 与 `tokenizer.runtime.json`；四个候选的 RemoteTrainingJob 必须同时绑定两份输入及组合 SHA，trainer 禁止按 job 重新训练 tokenizer；
- 模型：decoder-only、context 256、seed `20260805`、AdamW betas `0.9/0.95`、weight decay `0.1`、peak LR `3e-4`、2% warmup + cosine、FP16 GradScaler、clip `1.0`、global batch 128；
- 量化：`JLFDQ02` / `jotluck.autocomplete.quantized-decoder.v2`，group-size 64，Q4/Q8 分组 F16 scale，F16 vector；model header、payload 和每个 tensor 都绑定哈希与完整覆盖；
- checkpoint：每 1,000 optimizer step 原子写入，可 resume，只保留最近两个与 best；最多 3 epochs，以 dev loss 选择 best；
- 远程任务：正式矩阵只使用 `resume.mode=if-available`；已完成且 job/manifest/hash 完全匹配时幂等返回 completed，计划任务重跑不得覆盖成功状态；
- 解码：一次 prefill 后使用逐层 KV cache，固定 beam width 32、每 beam Top-4、累计 log-probability、长度归一化 `alpha=0.6`；全局截宽后只对入选 beam 执行下一步 forward，相同分数按 token ID 序列稳定排序；每步检查 latest-only cancellation 与 deadline；
- 生命周期：`trained` 只能 dev/E2E 加载且 Oracle 全零；`oraclePassed` 才允许 calibration/validation；`releaseEligible` 只可能由双 final 与 Windows GUI/IME 证据齐备后的唯一 publisher 生成；
- 预算：model + tokenizer + manifest + 新增 runtime 静态增量 ≤24MiB，峰值增量内存 ≤192MiB，模型推理 p90 ≤80ms。

本机负责源码、selection、评测、Rust parity 和 final 保管；幻15只执行哈希绑定的 CUDA 训练 job。final 不上传幻15或 VPS。传输必须先写临时名，复核 bytes/SHA-256 后同卷原子转正；SSH 断开不得终止由计划任务托管的训练。Tailscale direct 达到 20Mbps 时保持直连，否则才评估 VPS Peer Relay；Peer Relay 低于 10Mbps或不稳定才另行决定 WireGuard。任何系统账户、OpenSSH、Tailscale、防火墙、计划任务或 VPS 变更都必须由用户在目标机器上显式执行，仓库脚本不得自动远程施加配置。

### 5.3 2026-08-08 V2.2 实施停止点

32MiB/16M smoke 已证明 float 训练、JLFDQ02 Q4/Q8 导出和 Python quantized→Rust 单步 parity 可以运行，但旧 checkpoint 使用了约 `std=1.0` 的 embedding 初始化，Q4 误差会逐层放大，不能直接成为正式候选。trainer 已改为 `std=0.02` 初始化、共享 embedding/output、padding row 归零，并为 Q4 增加在实际 F16 scale 上的分组 MSE 优化和量化诊断；正式候选仍必须重新训练。

Rust worker 已实现一次 prefill、逐层 KV cache、固定 beam width 32 / Top-4 / `alpha=0.6` 的确定性多步解码。当前 K×B 批处理与逐 beam scalar 的 logits/cache 精确等价，取消保持事务性；真实 smoke 权重的 25 条候选语义哈希在调度改造前后相同。内存门禁通过，但延迟门禁失败：

- 默认 `opt-level=s`：prefill `42.286ms`，单次 batch32 advance `60.411ms`；仅这两段已为 `102.697ms`，尚未包含后续多步解码；
- 完整固定中文请求：`518.6–544.7ms`，peak Working Set `82,907,136B`；
- `opt-level=3` 更慢；隔离 SGEMM 探针最好为 prefill `26.654ms`、batch32 `40.852ms`，仍不是足以让多步完整请求达到 `80ms` 的数量级提升，因此实验依赖已回退；
- 未运行 10 warmup + 100 measurement，未把单样本伪装成 p90，也未启动 ROG 正式矩阵。

四份固定 Wikimedia DEVELOPMENT 来源已清洗出 `100,662,801` bytes / `63,487` docs，中英文只差 `243` bytes。正式 selection 首次验证在内嵌 `U+FEFF` 的跨语言空白归一化差异上 fail closed；修复已锁定显式空白码点集合和跨语言 golden，但 supplement 尚未按新 cleaner identity 重新物化。新的 validation/final fingerprint inventory 也尚未冻结。

因此本轮在运行时 80ms 前置门禁处停止：不得连接 ROG、不得生成正式训练 job、不得读取 final、不得运行 publisher。后续只有在新的运行时方案能以相同 Beam32/Top-4/长度边界通过完整请求 80ms 门禁后，才允许重新物化 selection、冻结 holdout/tokenizer并启动矩阵。

### 5.4 历史停止态命令

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

V2.2 架构预检要求 Oracle@8 ≥45%、Oracle@32 ≥55%、中英文 Oracle@8 各 ≥40%；任一失败立即停止该候选，不训练 visibility gate、不读取 final。发布要求每套：

- 触发率 35%–42%（70–84/200）；
- 绝对可用率 ≥35%（至少 70/200）；
- silence false ≤3%，按 50 个样本即最多 1 次；
- 每种语言绝对可用率 ≥32%，每类别 ≥30%；
- 完整候选池和最终 ghost 的 mixed 均为 0；
- 全请求与可见 ghost p90 均 ≤140ms；
- 结构化结果与精确编辑区间正确率 100%，主线程不得出现 >50ms 模型任务。

V2S 的 40%/45%/32% 只属于历史停止实验，不得用于降低 V2.2 门槛。

Oracle 必须使用全部机会点为分母。固定探针、seeded 场景、条件 bank-hit 指标、轮询上界延迟和 skipped E2E 都不能成为发布质量 PASS。

## 7. 候选、final 与发布顺序

V2.2 只有在新 ADR、新 engine ID、新 manifest schema 和未观察 holdout 已冻结后，才能进入以下流程：

1. 物化批准语料并生成逐文档 selection manifest。
2. 运行许可、隐私、重复、分布和 train–validation overlap 治理。
3. 在隔离 candidate 目录训练并生成 `trained` manifest；训练器永远不得写 `packages/app/public/`。
4. 使用绑定模型真实重放 Oracle；通过后由不可覆盖的评测 manifest 晋升为 `oraclePassed`，再运行 calibration、validation、Top-1、Gate 和运行时门禁。
5. 冻结候选、阈值、模型 SHA、训练输入树和 evaluator 源码树。
6. 同时 claim cold/workspace final SHA，之后才解封 final 明文。
7. final 失败、中断或 overlap 失败都消费该版本，禁止回到同一 final 调参。
8. Windows Tauri WebView 真实执行离线烟测；Web build 或 Rust 单测不能替代。
9. 唯一 publisher 重算全部证据，先安装内容寻址模型，最后原子切换 canonical manifest。
10. RC 从实际 artifact 重放并验证；不得相信 manifest 的资格布尔值。

正式证据必须绑定精确候选 commit、模型 SHA、训练输入树、holdout 树、evaluator 源码树、原始执行 transcript、非零 counters、退出码、运行时报告、WebView smoke 和二次只读转录。任何 skip、零测试、ignored 唯一产物、路径越界、符号链接或内容漂移都失败关闭。

## 8. 停止与边界条件

当前 V2S 不因增加同分布语料而重启。已有 3→8→24MiB 曲线没有单调收益，且最大模型已接近预算。V2.2 也只能在预登记的 32/128/可选256MiB 阶段内运行；不得用无界扩池或降低门槛延长路线。任何后续新架构必须满足：

- 新 ADR 解释它如何突破候选覆盖或 Top-1 排序瓶颈；
- 使用新的 engine ID 和 manifest schema，不修改历史 stop；
- 新 validation/final 在训练前冻结，不能复用已观察 development；
- 先执行有界矩阵并预登记停止条件；
- 若首个扩容档 Oracle@8/32 增益均 <2pp，停止同分布扩容；下一档增益 <1pp 时确认饱和；
- 选择性 Gate 不能提升原始 Top-1，因此原始 Top-1 低于 70/200 时不得声称可达到 35%绝对可用率；
- 新方案仍只能占用一个 `CompletionPublicEngine` 插槽和一个 canonical public manifest。

这允许未来采用更有效的组合式生成或极小候选重排，但不允许在 V2R/V2S 上继续无边界调参。

## 9. 最小维护检查表

- [ ] 当前 stop 是否仍在 CLI、trainer、publisher、verifier 和 RC 输入读取前生效？
- [ ] V2.2 候选是否始终处于 `trained → oraclePassed → releaseEligible` 的单向生命周期，且训练器不能直接伪造后两态？
- [ ] 16M Q4/Q8 是否来自同一 float checkpoint，而不是重复训练两份权重？
- [ ] JLFDQ02 group64、Python quantized 与 Rust logits/token/Top-K parity 是否在真实 smoke 权重上通过？
- [ ] 幻15/VPS 是否只接收训练 bundle，且从未接收 final、用户数据或凭据？
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
