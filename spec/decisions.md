# Decisions

版本：2026-07-13

## 已确认决策

1. 外观系统采用热插拔 UX Theme Plugin 架构，默认主题为 `paper` / 羽翼布局。
2. 主题包必须使用 `ThemeManifest v2` 声明 runtime、capabilities、permissions、entrypoints、slots、assets、checksums、minAppVersion 和商业化预留字段。
3. 声明式主题通过 DSL 渲染；官方代码主题和本地可信代码主题可通过 `ThemeHostContext` 替换 Shell/主页/弹窗级 UX slot。
4. P0 阶段不做权限审批、沙箱隔离、社区市场审核或远程购买接入。本地主题能力声明不作为安装/启用阻断条件。
5. 商业化通过 `ThemeCommerceProvider` 适配，默认本地 mock。未来接入 Gumroad、Polar 或自建后端时只替换 provider 实现，不改变主题中心和 manifest 结构。

## ADR-011：离线补全采用可撤销分层学习与可验证基线

- **状态**：已接受（2026-07-11）。
- **决策**：当前文档 L1、notebook 按文件贡献 N2、个人明确反馈 Personal L2、公共只读 L3 必须分表；工作区 Predictor/Trainer 稳定复用，L3 由应用级单例加载。
- **持久化**：Personal L2、词典、signals、metrics 和元数据按工作区隔离、校验 schema、串行合并并同步多标签页；旧聚合 N-gram 丢弃后从文件重建。
- **模型治理**：公共模型必须携带 manifest，通过许可证、隐私、样板、重复、类别/域占比、训练—holdout 重叠、大小与哈希闸门；`novel-zh` 保留但硬隔离。
- **后果**：训练池以后可扩至 30MiB，但浏览器/Tauri 实际加载资产继续限制为 6MiB；质量不足时 manifest 必须不可发布，RC gate 必须 fail closed。
- **推理分层**：Personal L2、notebook N2 和公共 L3 分别输出 top-k 候选，由 Resolver 统一处理学习、拒绝和去重；N2 先做跨文档聚合再剪枝，显式个人反馈不得与正文计数相加。
- **语言与预算**：中文公共模型采用高支持度 4→3→2 字符变阶，英文优先词级 bigram/trigram；训练器以全局效用在 6MiB 内确定性蒸馏，不把语料池体积等同于运行时资产体积。
- **发布资格**：`releaseEligible` 同时绑定实际独立 holdout 指标、原始/残余重复治理和模型完整性；profile 名称不能跳过质量闸门。

## ADR-012：付费语义补全采用数据型热插拔重排器

- **状态**：已接受为 V2.1 扩展方向（2026-07-11）；不进入当前 V2 首轮交付。
- **决策**：免费 V2 先产生并硬门控 top-8 候选，V2.1 微型 Transformer 只做候选重排，最终仍经过公共 Resolver 并输出唯一 ghost。结构化候选不进入模型。
- **插件边界**：`.mlcompletion` 是签名数据包，禁止任意 JavaScript、WASM、原生代码或 sidecar；固定宿主只加载白名单架构与算子。首版 capability 仅为 `rerank`，任何生成能力必须另立 ADR。
- **运行时**：Web 与 Tauri 首版共用固定 ONNX/WASM Worker 宿主，以候选批次、deadline、取消、epoch 和原子热切换协议运行。运行时下载 Tauri sidecar 不作为首版方案。
- **降级**：免费 V2 永远是可运行 fallback；插件安装、预热、授权、升级、损坏或超时不得中断编辑器，也不得用迟到结果替换已显示 ghost。
- **隐私与商业化**：插件只接收截断上下文和候选，不获得文件系统或网络能力。离线权重不能承诺不可提取，商业价值依赖签名授权、持续更新和支持，而不是不可破解的本地加密。
- **启动门槛**：只有免费 V2 的 `Oracle@8 - Top1 >= 8pp` 且独立 holdout 证明语义重排有可感知净收益时，V2.1 才进入开发。

## ADR-013：未发布的公共 N-gram V2 由 V2R 短语 Transformer 替换

- **状态**：已接受（2026-07-12）；V2R 未通过独立 final 前继续 fail closed。
- **决策**：停止修补 sectioned v4 公共 N-gram。免费公共 L3 改为边界感知的固定短语库加微型 Transformer `abstain` 模型；结构化 Provider、L1、Personal L2、Notebook N2、Resolver 和单 ghost 交互保持不变。
- **原因**：正式 cold holdout 的全部英文正例都位于完整单词末尾，而旧运行时只在词内字符路径接受纯字母候选，结构性丢弃空格和标点续写；在该约束下总触发率理论上无法达到 40%。24MiB 同模板扩池已饱和且 usable 为 0。
- **运行时边界**：公共模型只在 Worker 中运行，最多读取光标前 192 个 UTF-8 字节和非敏感结构特征；失败、取消、超时或损坏时关闭公共 L3，不在主线程降级。模型/短语包 ≤6MiB，含精简运行时的应用静态增量 ≤12MiB。未发布候选只能进入显式 evaluation-only 构建，普通生产 mode 必须忽略候选 URL 并拒绝资格标志未齐全的 manifest。
- **训练与证据**：训练池上限为 30MiB，允许经过批准且内容哈希固定的 CC0 外部来源；固定训练矩阵和多参考 validation/final 必须在发布前冻结。每档先证明短语库可表示总体 ≥70%、中英文各 ≥65% 的 Oracle@32，再允许启动两个 seed 的 CPU 训练。同一光标的全部合法完整前缀共同构成训练/Oracle 目标，selection、generator、training-data 与 production bundle 必须由 v5 manifest 逐文件绑定并交叉重算。发布门槛为 60%–65% 触发率、至少 60% 绝对可用率、false trigger ≤3%、mixed 0 和双 p90 ≤140ms。
- **静默语义**：training-data v3 只允许文档末尾作为公共模型的真实 abstain 样本；短语库未覆盖真实 continuation 时只记录 bank coverage 缺口，禁止把表示失败训练成拒答。192-byte 上下文固定以 48 个有序 4-byte patch 输入模型，改变 patch 或静默语义必须升级训练数据/manifest 契约并使旧缓存失效。
- **迁移**：新 v5 资产通过全部证据后原子替换生产公共模型；旧 v4 资产不得作为 fallback。冻结 V1 继续仅作隔离评测。ADR-012 的 V2.1 Ranker 接口保留，但其启动证据改为基于 V2R 候选池重新计算。

## ADR-014：停止固定短语库公共 Transformer，公共 L3 继续 fail closed

- **状态**：已接受（2026-07-13）；取代 ADR-013 的发布方向，但保留其实验和证据代码供复核。
- **决策**：停止 `public-phrase-transformer-v1` 的后续长训练与发布。`scripts/corpus/autocomplete-v2r-architecture-stop.json` 存在时，固定矩阵训练入口、publisher 与 v5 verifier 必须拒绝执行；不得通过删除指标、降低门槛或改 manifest 恢复资格。
- **证据**：三档短语库在内部生成池上的覆盖率为 74.54%/78.56%/80.97%，但在已观察真实写作诊断集上的绝对单参考表示率仅 10.5%/10.5%/13%，16,384 档中文 6%、英文 20%。8,192 完整训练的 internal usable 仅 38.16%，且该 internal 集事先过滤了 bank miss，不能代表开放写作 Oracle。
- **架构判断**：排序、阈值和量化只能在候选存在时改善结果；固定短语库无法覆盖中文组合空间和开放领域措辞。继续扩充同类语料或训练更久属于无收益搜索。未来公共神经补全必须采用开放词表或可组合输出，并以新 engine ID、manifest schema、ADR 和未观察 holdout 重新立项。
- **后果**：生产仍只使用结构化、L1、Personal L2、Notebook/Hybrid 与 Resolver；公共 v4/v5 均不可发布，RC code 10 是正确状态。V2.1 Ranker 继续锁定，因为没有合格免费公共候选池可供证明增益。

## ADR-015：公共补全模型采用唯一真相源

- **状态**：已接受（2026-07-13）。
- **决策**：生产只保留一个模型无关的 `CompletionPublicEngine` 插槽，并默认不绑定实现。公共目录只保留 `baseline-ngram.web-local.compact.txt` 及其 manifest 作为 canonical、fail-closed 的 v4 诊断资产；删除字节相同的 `baseline-ngram.v1.compact.*`，训练、验证、publisher 和 RC 不得再生成或要求第二 profile。
- **运行时边界**：停止的 V2R Worker、ONNX adapter、默认 factory 与 `onnxruntime-web` 不进入应用源码依赖图或构建产物。V2R 训练/证据/stop 记录只保留在 `scripts/` 供审计，不能成为运行时 fallback。冻结 V1 仍是评测专用快照，不是公共模型来源。
- **迁移规则**：未来公共模型必须先通过独立证据链，再经唯一安装入口替换公共 L3；不得并行加载多个公共模型，不得用旧模型 fallback 掩盖新模型失败。L1、Personal L2、Notebook N2 和 Hybrid 是互补数据层，不属于模型版本冗余。

## ADR-016：Public V2S 采用双语 Subword MKN 与选择性门控

- **状态**：架构预检停止（2026-07-13）；正式资产继续 fail closed。
- **决策**：公共 L3 使用 `public-v2s-mkn-v1`。中英文分区分别在训练期从边界感知 BPE/Unigram 二选一，运行时以 2–5 阶 Modified Kneser-Ney 压缩 Trie 组合生成候选；不得用总体平均替代逐语言选择。G0 逻辑门控与 G1 16-hidden INT8 MLP 组成唯一有界门控挑战，不引入 Transformer、Tiny GRU、ONNX 或通用推理运行时。
- **信任边界**：宿主按完整 code point 截取最后 256 个 UTF-8 字节；模型只在 Worker 解析和查询。Worker 返回不带插入权限的原始候选，Router 强制校验并写入 `from/source/sourceLayer/providerId/priority`。失败、损坏、CSP、取消或超时只关闭公共 L3。
- **唯一真相源**：v6 canonical manifest 只引用一份内容寻址二进制，二进制内含双语 tokenizer、Trie、量化参数、Gate 和阈值。训练器只能写候选缓存，只有 V2S publisher 可写 public；RC 拒绝旧新并存、孤儿资产、重复 hash 别名和仅靠资格布尔值的放行。
- **训练与停止**：复用已治理的 24/3/3MiB v3.1 pool，固定执行 3MiB 双 tokenizer、8MiB/24MiB 与 3/5.5MiB 资产矩阵。若逐语言结果方向相反，只允许从该固定对照各取胜者并组合一次；组合最大档仍未达到 Oracle@8 absolute ≥40%、Oracle@32 absolute ≥45%、中英文 Oracle@8 各 ≥32% 时记录 architecture stop，不训练 Gate。Oracle 足够但固定 Gate 加一次 hard-negative 修订仍失败则记录 method stop。
- **停止证据**：最大 `BPE-en + Unigram-zh` 候选在 200 checkpoint development 预检上的 Oracle@8/32 为 37%/40%，中文 43%/45%，英文 31%/35%。逐语言取固定矩阵最好值后的理论前沿为 37.5%/40.5%，英文 Oracle@8 为 32%；总体两项仍未达 40%/45% 门槛，故 `autocomplete-v2s-architecture-stop.json` 阻断后续训练、Gate repack、publisher 与 RC release 路径。该证据不是 final，也不构成发布质量 PASS。
- **停止态运行时**：普通生产 Predictor 不再导入或自动构造 V2S factory，已停止的 Worker 不进入 bundle；公共引擎仅可由测试/隔离评测显式注入。恢复生产自动加载必须使用新的 engine ID/ADR，而不是删除 stop 记录。
- **发布合同**：全新的 cold/workspace validation/final 每套 200 checkpoints。两套 final 分别要求触发 70–84、绝对可用至少 70、50 个 silence 最多误触发 1、mixed 0、双 p90 ≤140ms，并不得低于同集 Public-off B0。final 只在候选身份冻结后消费一次。

## 变更记录

- 2026-07-13：ADR-016 完成有界矩阵与逐语言组合预检；固定矩阵最好前沿 Oracle 37.5%/40.5% 未达 40%/45% 架构门槛，记录 architecture stop，未训练 Gate 或消费 final。
- 2026-07-13：新增 ADR-016，确认 Public V2S 的组合式统计生成、Worker 信任边界、有界训练矩阵、双 final 与单一发布协议。
- 2026-07-13：新增 ADR-015，移除停止 V2R 的生产运行时和重复 v4 profile，公共 L3 收口为一个默认未绑定的模型插槽。
- 2026-07-13：新增 ADR-014，停止固定短语库 V2R 架构，要求未来开放词表/组合输出另立 ADR。
- 2026-07-12：ADR-013 固定 4-byte patch 与 silence-safe v3 训练语义，禁止 bank miss 冒充 abstain。
- 2026-07-12：ADR-013 补充多合法前缀训练语义与可重算 generator/training-data/bundle 证据边界。
- 2026-07-12：新增 ADR-013，确认公共 L3 从未发布的 v4 N-gram 重构为 V2R 短语 Transformer，并冻结新的训练、体积和独立质量边界。
- 2026-07-11：新增 ADR-012，将微型 Transformer 固定为候选后的数据型付费重排扩展；不改变免费 V2 路线。
- 2026-07-11：补充 ADR-011 的分层候选、语言分路、定额蒸馏和发布资格约束；既有主题决策未变更。
