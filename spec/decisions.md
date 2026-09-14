# Decisions

版本：v1.9（2026-09-14）

## 已确认决策

1. 外观系统采用热插拔 UX Theme Plugin 架构，默认主题为 `paper` / 羽翼布局。
2. 主题包必须使用 `ThemeManifest v2` 声明 runtime、capabilities、permissions、entrypoints、slots、assets、checksums、minAppVersion 和商业化预留字段。
3. 声明式主题通过 DSL 渲染；官方代码主题和本地可信代码主题可通过 `ThemeHostContext` 替换 Shell/主页/弹窗级 UX slot。
4. P0 阶段不做权限审批、沙箱隔离、社区市场审核或远程购买接入。本地主题能力声明不作为安装/启用阻断条件。
5. 商业化通过 `ThemeCommerceProvider` 适配，默认本地 mock。未来接入 Gumroad、Polar 或自建后端时只替换 provider 实现，不改变主题中心和 manifest 结构。

## ADR-027：导出与索引收口——块级权威 AST + 行内共享 marked 词法；Rust 死索引通道删除

- **状态**：已接受（2026-09-14）；PRD-v0.2 R3 切片 D 定稿。门禁实测：renderer 125/125、app vitest 964/964（含 13 份旧实现等价快照不盲刷保持绿 + 5 条硬断言新行为）、双 typecheck 零错、cargo check/test 162/0（tantivy/walkdir/regex 依赖随删）、定向 E2E 39/39（05 导出/03 搜索/09 反链/14 live preview）、全量 chromium 212 通过 + 5 失败全部为既有集（B1-B4/19-462）零新增。互审 R2 PASS-with-minor（2 major 均已裁决：ADR 措辞如实化、图片 title 经 renderer InlineToken.image.title 恢复）；R1 FAIL→三大 major 全裁决：快照忠实性经「HEAD 旧码重建执行」实证（旧 DOCX 产出 nested/task 均空，快照忠生旧输出）、TXT refDefinition 行透传回归确认并修复、TS strict 疑虑经双 tsc 执行推翻；m 级行内 HTML 剥标签口径恢复、误导注释修正，其余入 R4 备案。
- **背景**：Exporter 实为四种解析并存（marked 渲染 / marked.lexer / 自有逐行表格抽取 / TXT 14 条正则链），ShareDialog 另有双轨剥离；Rust tantivy 索引通道（build_index/update_index_document/search_index）注册于 lib.rs 但前端/E2E/vscode-ext 零调用——所有搜索、标签、反链、外部文件变更重提取早已全部在前端 SearchEngine + IndexService（切片 B 后已走 AST）完成；Rust 侧「第三份解析」仅 indexer.rs:389-410 的 extract_title/extract_tags（22 行、零测试）。
- **决策**：
  - **导出**：块级结构权威归 AST（ADR-025「结构性消费一律走 AST」）——ExportModel = parseDocument 块序列（标题级别/表格补齐矩阵/列表 indent 栈重组嵌套/引用 depth/围栏 lang/任务 checked），每格式适配器从模型产出；行内格式（DOCX 富文本）共享 marked 的 `Lexer.lexInline`（renderer 新导出 `lexInlineTokens` 包装，与 renderMarkdown 同引擎同配置）——不手写强调解析器，保证 DOCX 行内格式与 HTML 渲染天然一致。app 包不再直接 import marked（唯一 marked import 收进 renderer 包）。
  - **索引**：删除 Rust 死通道（indexer.rs 整模块 + 三命令注册 + SearchIndexState + tantivy/walkdir 依赖），桌面全文检索由前端 SearchEngine 独担（与现实一致）；`.JotLuck_index` 遗留目录 inert（点前缀被扫描忽略），不主动清理用户磁盘。
  - **明示行为变化（各有专测）**：① 表格 `\|` 转义全格式生效（AST splitTableCells 对齐 GFM 与 live preview 管线）；② `![#tag](u)` 导出层不再固化其旧剥离行为（preprocess 直通；alt 的可见渲染语义属 renderer 存量 quirk——PRD R4 备案⑥——不在本切片范围）；③ refDefinition 行的 `#y` 不再进索引标签；④ Share「HTML」从原始 markdown 改为渲染产物；⑤ 死选项 imageHandling/readBinary 删除；⑥ TXT 导出任务项不再残留 `[x]`/`[ ]` 标记（旧链正则事故产物，清涂为改进型漂移）。另：`extractMarkdownTables/preprocessMarkdown/stripFrontmatter/convertWikiLinks` 四个旧函数名保留为 `@internal` 测试接缝、函数体已全走 AST——「旧实现删除」的验收口径按内核计，勿按函数名误报。
- **后果**：新增导出格式 = 写「AST 模型 ↔ 格式」一个适配器；AGENTS.md 选型表「Tauri 搜索 = tantivy」行与 TAD.md 同步修订为现实；等价回归靠先行特征化基线（旧实现固化断言）+ 分叉点新行为专测。
- **替代方案**：接通 tantivy（前端提交结构化字段）——无人使用的第二搜索引擎，违背业务优先，弃；renderer 新写行内强调解析器——必然与 marked HTML 渲染分叉（嵌套强调规则难对齐），弃；保留 Rust 解析兜底——PRD 铁律不允许第三份解析长期并存，弃。

## ADR-026：聚焦行幽灵语法采用真实占宽 mark 装饰（无 widget、坐标原生）

- **状态**：已接受（2026-09-14）；PRD-v0.2 R2 切片 C 定稿。原型阶段（W1–W2）kill/keep 判据双 PASS → KEEP；放量阶段（W3）覆盖 6 个 Lezer mark + AST 结构 markerRange（含全角 ＃ ＞ －）+ 表格管线（含全角 ｜ 与 \| 转义）+ wiki/tag 定界符与内容着色 + 零宽路线退役 + 早退旁路给 setext 两块。
- **背景**：即时预览中聚焦块回退源码显示（`build()` 聚焦分叉直接 continue），渲染"破面"；PRD R2 要求居中点——聚焦行渲染保持 + 格式符号幽灵弱化可见。选型前核实：聚焦块并非纯等宽源码（全局 `JotLuckHighlightStyle` 已让标题/加粗/斜体/链接内容保持渲染观感），缺的只是符号呈现；最大风险为坐标映射与 IME。
- **决策**：聚焦块呈现 = 真实源文本 + Lezer `syntaxTree` 的 mark 装饰幽灵化（可见低对比度、**真实占宽**）+ 既有语法高亮保持内容渲染。**不插入任何 widget、不做零宽隐藏**——点击、拖选、光标落位全部走 CodeMirror 原生坐标，"选区映射"风险被架构性化解。链接 URL 以原地幽灵样式呈现（源码中 `(url)` 本就在文字后方），不弹窗不浮层。IME 沿用 composition 冻结重建纪律（组合期仅装饰 map 不重建），幽灵装饰不新增任何重建时机。结构标记（列表/引用/表格管线等，Lezer 无 GFM 节点）一律走 ADR-025 AST 源码偏移。
- **kill/keep 判据实测数字**：
  - 判据① 中文 IME 连续 200 字合成组合输入（25 段×8 字），上屏后内容精确、幽灵范围仍恰好覆盖两段 `**`、前缀 6 个位置坐标与组合前一致（±1px 零漂移）、采样点击 3 字符落点正确——**PASS**。
  - 判据② 聚焦行 19 字符逐字符真实 `mouse.click` 落点 `head ∈ {p, p+1}` 100%，加拖选段 `from ∈ {2,3}, to ∈ {12,13}`——**PASS**。
  - 字符边界精度如实登记为设计上限（不在 100% 口径里）。
- **后果**：非聚焦块渲染管线（RenderedBlockWidget）零改动；pin 源码语义保持全对比度（"看源码"的显式动作）；`touchesEmptyCursorLine` 零宽分支在放量期统一为幽灵模式、`.cm-live-source-marker` 路线源码零引用（仅单测反向断言）；setext 标题早退旁路给两块；早退例外数组从 codeSpans 扩到 codeSpans+wikiSpans（避免表格管线在 wiki 别名 `|` 处双染）；三档显示设置为 P2 可选、首版只做默认居中点。
- **替代方案**：聚焦块整块渲染 widget + 自建坐标映射层（映射工程量最大且正是 PRD 点名的最高风险——弃）；零宽折叠扩展到聚焦块（符号不可见，不满足"符号弱化可见"的居中点定义——弃）；ProseMirror 富文本内核（PRD 非目标，G2 天花板被真实需求撞破前不评估）。
- **跨会话教训**：①「幽灵 = 真实占宽 mark」天然化解 PRD 最怕的"选区映射"工程——免坐标层的根本原因是聚焦块没有 widget 插入。②CM6 不承诺合成组合期装饰 DOM 稳定——`compositionstart` ↔ `compositionend` 之间浏览器直接管理 DOM，装饰类可能抖动、可上屏文本可续进相邻 mark span 的文本节点；用户可感知承诺 =「聚焦块不闪回 widget」，断言只能保上屏后归位。③合成 IME 是对真实输入法的近似（无候选窗/preedit），手感属验证者亲自验收。④CM6 HighlightStyle 在全视图生效、与聚焦行类正交——「词仍粗体」与「符号幽灵」是两条独立路径，审查要分层看。

## ADR-025：统一解析层采用自维护行扫描 AST（落 @jotluck/renderer），marked 保留为 HTML 渲染后端

- **状态**：已接受（2026-09-14）；PRD-v0.2 R3 切片 B 的选型登记。
- **背景**：同一套 Markdown 语法曾在 7 处独立手写解析（渲染扩展、frontmatter×3、大纲、索引标签/双链、编辑器块识别、行内格式剥离、分享清洗），规则互相漂移。统一解析层的底层选型有三个候选：marked lexer、Lezer（@lezer/markdown）、自维护行扫描器。
- **决策**：权威结构解析器 = 自维护行扫描器 `parseDocument`，落 `packages/renderer/src/ast.ts`（纯 TS、无依赖、app 与 renderer 共用）。所有节点携带源码 UTF-16 偏移与行号；识别在全角归一化视图进行，范围字段一律由含全角字符类的源码空间正则直接切出（归一化下标永不充当源码偏移）。语法规则单点化到 `syntax.ts`（全角归一、wiki-link/tag 词法、表格工具、headingIdFromText），marked 扩展与 AST 行内扫描共用同一份定义。
- **marked 保留为 HTML 渲染后端**：`renderMarkdown` 继续用 marked.parse 产 HTML，行为不变；渲染管线内的标题锚点 id 注入（addHeadingIds）跟随渲染引擎自己的 token 序列（互审实证：AST 与 marked 在引用内嵌标题/缩进 ATX/空标题等边界形态判定不同，跨引擎配对会张冠李戴）。即：结构性消费（大纲/索引/编辑器/续格式/清洗/导出）一律走 AST；HTML 生成的内部细节归 marked。
- **不选 marked lexer 当 AST**：marked token 不携带任何源码位置（实证 marked.d.ts 无 start/end/line 字段），而装饰、续格式、大纲行号都要位置。
- **不选 Lezer 当唯一权威**：Lezer 语法树只在编辑器内可用，服务不了 IndexService/ShareDialog/导出等非编辑器消费方；编辑器内现有两处 Lezer 消费（行内符号折叠、补全 FencedCode 判定）维持不动。
- **前端收口事实**：useHeadings/IndexService/YAMLParser 边界/markdown-formatting 剥离/ShareDialog 清洗/cm6-smart-continue 检测/cm6-live-preview 块识别全部改消费 AST 或共享规则；零引用死代码 blockParser.ts 删除。Exporter 三路线与 Rust 索引收口属切片 D（首选前端产出结构化字段随索引提交，Rust 只存不解析）。
- **后果**：新增一种语法（如 callout）只需在 syntax.ts/ast.ts 定义一次，结构消费方同时生效；渲染侧若需新语法的 HTML，则在 marked-extensions 消费同一规则定义。行为等价底线附带 8 处明示收紧（PRD-v0.2 变更记录 v1.3 逐条登记）。
- **替代方案**：marked lexer 派生 AST（无位置——弃）；Lezer GFM 全量启用（出不了编辑器——弃）；AST 直产 HTML 取代 marked（重写渲染器风险远超切片收益——后置，不承诺）。

## ADR-024：V2.5 个性化采用解码期浅融合（首 token 双倍 + 纯分门控）

- **状态**：已接受（2026-09-08）；ADR-023 个性化迭代的第一实现路线。
- **决策**：个性化以推理期浅融合（shallow fusion）进入 V2.5 one-unit writing 的生成阶段：宿主从个人语料（Personal L2 n-gram、短表、会话历史、保留短语库）构建有界先验（≤8 条 one-unit 短语 + weight + fusionWeight），随 generate 请求传给 Rust worker；worker 把活跃匹配的续写 token 注入 beam 扩展集（`rank_logits_with_extra`），并在选择分上加先验偏置——**首匹配 token 双倍、后续 token 单倍、完整匹配再加一倍**（one-unit 的单位选择发生在首 token）。λ（fusionWeight）契约上限 1.0，默认 1.0（2026-09-08 worker probe 定标：低 λ 无法越过 one-unit 的 logprob 陡峭差距）。
- **分数纪律**：`log_probability`/`normalized_score`/上报的 `modelScore`/`gateScore` 保持纯模型值；偏置只影响 beam 排序与剪枝。宿主可见性门（triggerPolicy 地板 + visibilityCalibration）因此成为安全网——模型不看好的用户词可在 worker 层登顶，但低 modelScore 在宿主被拦，不会降低 ghost 质量。实证（probe 证据，本地不入库）：带内词（modelScore ≥ 地板、基线 rank-2）融合后登顶且分数不变（端到端可见翻转）；`banana` 类错误先验在 worker 产生 `bananaly` 垃圾 top-1 但 modelScore 0.0034 被门拦截。
- **回退合同**：空先验/关闭开关（`settings.personalization`，默认开启）/清空学习数据 → 请求不含先验字段 → worker 搜索与基线**字节级一致**（probe 5/5 用例逐候选断言）。协议新增可选字段 `personalPrior`（serde default，PROTOCOL_VERSION 不变），仅 one-unit runtime 接受；非法先验（超 8 条、超 24 code points、PUA/换行、weight 或 λ 越界）在 worker 校验拒绝。
- **边界**：先验仅进程内传递（host→worker IPC），零持久化零网络；外发短语复用敏感内容过滤；端侧适配层（路线 C）与重训（路线 D）延后至后续迭代（骨架 §4.1 裁决：仓内无训练设施 + 语料许可未过）。
- **后果**：one-unit 引擎候选从单一路径变为「模型分布 × 个人先验」的融合排序；宿主三粒度加权继续作用于候选之后；`priorFlippedTop`/`personalPriorApplied` 进入 worker 诊断供评测观测。
- **替代方案**：capsule 注入个人语料（writing 路线序列化无 `<retrieval>` 段且训练未见，128-token cap 下挤占真实上下文——弃）；仅宿主侧重排（无法改变生成本身——现状，不够）。

## ADR-023：V2.5 补全模型下一迭代基线包含用户个性化（模型线解冻）

- **状态**：已接受（2026-09-08）；取代 2026-09-06 的「等有真实用户后再解冻」口径。
- **背景**：V2.5 one-unit writing 引擎已随 v0.13.0-preview 成为 Windows 生产默认补全引擎，仓库不含模型资产。宿主侧已具备分层候选源（当前文档 L1、Session、Notebook、Personal L2）、三粒度习惯加权（学习信号、provider×层×语法指标、会话接受加成）与全生命周期反馈合同（ADR-021）；但模型侧不个性化——用户习惯只影响候选生成后的重排与压制，个人语料不进入引擎上下文。
- **决策**：模型线即刻解冻并立项下一迭代；新迭代的基线版本必须包含并做好用户个性化，让 V2.5 模型在生成阶段感知用户习惯/个人语料，而不只是在生成后重排。下一步开发即为此目标。
- **数据边界**：个性化学习仅使用本地/设备内用户数据；JotLuck 无后端，用户语料不得离开本机。学习准入沿用 ADR-021 的敏感内容 skip 边界。
- **约束降级**：旧「语料许可审计 → 干净语料重训评估 → 默认引擎切换 → 公开权重」四步链路废止为涉及时适用的约束——语料许可仅在引入新训练语料或对外公开权重声明时适用；当前语料许可审计未通过，公开权重继续被阻断。「默认引擎切换」一步已由 v0.13.0 实际完成。
- **后果**：宿主学习机制与模型个性化的衔接成为下一开发主线的设计核心；迭代骨架见本地 `plans/autocomplete-engine-v2.5-personalization-unlock.md`（不入库）。不得从既有训练记录、训练 loss 或汇总百分比推断个性化已实现或已通过；训练事实仍以本地归档 `local-archive/v25-docs/` 的实际报告为准。
- **替代方案**：保持冻结等待真实用户（被本决策取代）；仅依赖宿主侧重排个性化（现状，已证明无法改变模型生成内容本身）。

## ADR-022：免费公共补全采用开放词表生成器与 24MiB 总预算

- **状态**：已接受为下一版本开发方向（2026-08-05）；不得进入既有 Windows RC 候选。
- **决策**：新公共引擎 ID 固定为 `public-v2-free-decoder-v1`，使用 8K Unigram + byte fallback 的双语 decoder-only 开放词表生成器。它不复用 V2R/V2S 的 engine ID、manifest、缓存、final 或停止记录；生产仍只允许一个公共生成引擎。
- **有界矩阵**：只比较 16M/24M/32M Q4 与 16M Q8，最多 256 tokens 上下文；中文默认最多 8 code points，英文最多 12 code points 且必须完整成词。许可证通过的清洗训练池上限为 512MiB，不继续无界扩池。
- **运行时**：Windows/Tauri 使用同一签名可执行文件的隐藏常驻 completion worker，采用长度帧、request ID、latest-only 取消和 Job Object 资源限制。模型输出是不可信文本，不能声明编辑区间、优先级、来源或学习策略，全部由宿主重新盖章和门控。
- **量化与生命周期**：浮点权重导出为 `JLFDQ02`（group-size 64，Q4/Q8 分组 F16 scale、F16 vector）。候选只能按 `trained → oraclePassed → releaseEligible` 单向晋升；trainer 不得生成 Oracle 或 release 资格，publisher 不得接受缺少原始观察和双 final/GUI 哈希绑定的布尔声明。
- **训练节点**：当前工作站保管 selection、evaluator 和 final，幻15只承担内容寻址的 CUDA job。Tailscale direct 优先，VPS Peer Relay 仅作加密转发；final、用户数据和凭据不得上传训练节点或 VPS。该分工不改变离线产品的数据边界。
- **正式矩阵合同**：128MiB selection 固定四个 dated Wikimedia DEVELOPMENT 来源与近重复/泄漏门禁；8K tokenizer 只冻结一次并由全部 job 复用。RemoteTrainingJob v2 绑定 source tree、recipe、selection、corpus 与两份 tokenizer 资产，使用幂等 `if-available` resume。
- **序列推理**：Rust/Python 共同采用一次 prefill、逐层 KV cache、beam width 32、Top-4 扩展、`alpha=0.6` 长度归一化和 token 序列稳定 tie-break；全局截宽后才执行下一步 forward，并在每步检查取消/deadline。
- **预算**：模型、tokenizer、manifest 与新增推理宿主静态增量合计不超过 24MiB，增量峰值内存不超过 192MiB，Windows worker 模型请求 p90 不超过 200ms。Web/PWA 不继承桌面模型承诺，只保留结构化、个人和工作区安全降级。
- **停止与放行**：训练 visibility gate 前，Oracle@8 必须 ≥45%、Oracle@32 ≥55%、中英文 Oracle@8 各 ≥40%；不通过即停止该路线且不读取 final。通过预检后，cold/workspace 两套各 200 checkpoint 的独立 final 仍必须同时达到 35%–42% 触发率、绝对可用率 ≥35%、silence false trigger ≤3%、mixed/跨行/超长为 0、全请求 p90 ≤200ms 和含 40ms 防抖的可见 ghost p90 ≤250ms，才允许 publisher 原子安装唯一 canonical 公共引擎。
- **后果**：ADR-014/016 的 architecture-stop 原样有效；旧观察 holdout 只用于回归，新的 validation/final 必须重新冻结且 final 每套只消费一次。新引擎在双 final 与真实 Windows GUI/IME 闭环前只能由 dev/E2E flag 显式启用。

## ADR-021：补全内核采用双平面、精确编辑与保留后反馈

- **状态**：已接受为 Completion Engine V2.2（2026-08-05）；保持单条 ghost、`Tab` 接受、`Escape` 拒绝和无候选菜单。
- **双平面**：结构化平面处理 Wiki-link、标签、路径、格式和列表，composition 稳定后立即运行；预测平面只在 paragraph/list/quote 行尾运行并保持 40ms 防抖。强结构化、本地或个人候选存在时不调用公共生成器，迟到结果永不替换已显示 ghost。
- **上下文**：CodeMirror 6 `CompletionDocumentContextField` 维护单调 revision、语法节点路径、block、标题链、当前/前段有界切片和语言提示。打开文档允许一次完整初始化；后续热路径禁止 `doc.toString()`、全文 fingerprint 和从文首重扫 fenced code/frontmatter，L1 按受影响段落增量撤销/重建。
- **编辑合同**：候选的唯一正文写入是 `CompletionTextEdit { from, to, insertText }`；`displayText` 仅用于 ghost。请求身份由 editor session、workspace scope、document revision、UTF-16 cursor、上下文快照、deadline 与取消信号构成。
- **Provider 合同**：内部类型安全 Registry 在 Predictor 生命周期内注册一次，描述 mode、上下文能力、优先层、候选上限、软预算、反馈能力和数据权限；不开放任意 JS/WASM/原生 Provider 插件。顺序固定为结构化 → 当前文档/Session → Personal/Notebook/Hybrid → 免费公共生成器 → 唯一 generic fallback。
- **反馈合同**：事件状态为 `shown → accepted → retained | modified | reverted`，另有 `explicitRejected` 与无负反馈的 `abandoned`。只有 `retained` 才写入 Personal L2、accepted lexicon 和正向排序信号；结构化候选永不进入语料。学习准入只有 `persist | memoryOnly | skip`，密钥、密码、token、代码和 frontmatter 必须 skip。
- **迁移**：持久化 schema 升级为 v5；v4 已接受数据进入 `legacyAccepted` 分区并以 0.5 权重参与排序，不伪造 retained。每工作区 Session History 最多 100 条且进程退出清空。
- **预算**：同步本地 Provider 20ms 软预算、Hybrid 35ms 软预算保持不变；桌面预测请求硬截止调整为 200ms。结构化与强本地候选仍立即显示且不等待公共模型；包含 40ms 防抖的公共可见 ghost 以 ≤250ms 为硬门禁、≤220ms 为目标。

## ADR-020：二进制文档采用隔离语义转换与双路径编辑

- **状态**：已接受（2026-08-04）。
- **决策**：Windows 只读导入 DOCX、PDF、XLSX、XLS；以 Markdown 语义映射渐进预览，不承诺 Office/PDF 像素级复刻。原件始终只读，编辑由专业软件处理；JotLuck 只编辑用户明确另存的 Markdown 副本。
- **隔离**：Rust MSRV 提升到 1.88；同一可执行文件增加隐藏 worker 模式，主进程先快照和哈希，worker 只读快照。最多两个低优先级 worker，Windows Job Object 限制 768 MiB，任务可硬取消。解析依赖固定为最小 feature 的 docx-rs 0.4.22、calamine 0.36.1、lopdf 0.44。
- **会话**：新增 `document-import-readonly`，不复用普通外部笔记 grant；转换、资产、警告、编辑器候选和源 revision 都按窗口/conversion ID 隔离。旧 conversion 在源变化后失效，不能另存。
- **编辑**：单一“启动编辑”弹窗提供专业软件编辑原件或另存 Markdown。专业软件使用 Shell 关联处理器 API；Markdown 另存强制新文件和唯一资产目录，成功才原子切换到 `external-edit`。
- **系统关联**：`JotLuck.Note` 与 `JotLuck.DocumentImport` 只注册候选，并设置 `AllowSilentDefaultTakeOver`。默认应用必须由 Windows 系统 UI 确认；欢迎页和设置页以 `UserChoiceLatest` 优先、`UserChoice` 回退读取用户明确选择的实际 ProgID，不把无显式选择时的 Shell 候选推导结果当成已应用，也不持久化伪成功。
- **后果**：转换器增加有限原生依赖和约 3 MiB 安装包预算；若最小 feature、LTO、strip 后安装器仍不低于 10 MiB，则本功能停止交付，不能放宽产品体积上限。

## ADR-019：界面本地化采用类型化目录与结构化原生错误

- **状态**：已接受（2026-08-03）。
- **决策**：支持 `zh-CN`、`en`、`ja`、`ko`、`fr`，以 `zh-CN` 作为类型主 Schema 和最终回退。使用 Vue I18n Composition API；非中文目录作为离线动态 chunk，在应用挂载前完成首选目录加载。
- **偏好语义**：没有 `jotluck:locale:v1` 时按系统语言检测并立即保存；之后只响应用户显式切换，不持续跟随系统。语言切换不重建路由、编辑器、主题、弹窗或补全引擎。
- **内容边界**：只翻译应用拥有的 UI、错误、官方主题、内置模板/示例和导出包装。用户笔记、自定义模板、既有示例及第三方主题作者文字不迁移、不改写。
- **原生边界**：Rust 与 MockFS 共享稳定错误码；自然语言翻译只发生在前端。NSIS 使用五份安装器语言资源，原生对话框显示字符串由当前界面目录提供。
- **主题边界**：Theme API v2 以加法方式提供只读 i18n Host API，不改变 `.mltheme` 包结构。新增第三方主题语言包协议必须另行升级标准。
- **后果**：新增语言只需注册 locale、补齐完整消息/内容目录、安装器资源和契约测试；页面组件不再增加语言分支。

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

## ADR-017：关联文件采用单进程、多窗口、按窗口隔离的会话

- **状态**：已接受（2026-07-25）。
- **决策**：保留一个 JotLuck 进程，但每个不同的规范化绝对文件路径拥有一个独立窗口。首个冷启动文件使用 `main`，其余文件及运行时关联请求创建唯一 label 的窗口；重复路径只恢复并聚焦现有窗口。
- **会话**：窗口会话固定为 `workspace`、`external-readonly`、`external-edit`。外部文件先只读；启用编辑只授权当前文件；添加到笔记才将父目录升级为该窗口的 workspace，并持久记录最近笔记本。四种支持格式为 `.md`、`.markdown`、`.mdx`、`.txt`，安装器仅注册可选打开程序。
- **隔离与安全**：root、索引、watcher、completion、外部授权及事件路由均按窗口 label 隔离；命令仅从 Tauri 注入的调用窗口身份取得会话，禁止前端传入或伪造窗口 label。窗口关闭只回收本窗口资源。
- **P1 授权边界**：外部文件初始 grant 是只读；`enable_external_edit` 只能把同一文件升为读写，不能授予父目录或任意工作区能力。所有 workspace IPC 必须对调用窗口执行 `assert_workspace`；只有 `promote_external_file_to_notebook` 可原子绑定父目录、更新会话并开启 workspace 服务。
- **Preview gate**：`v0.10.0-rc.1` 接受 Public L3 保持 architecture-stop / fail-closed，但 release gate 必须证明生产依赖图、bundle 和安装包不含可达的 V2S Worker、factory、候选资产或自动加载入口。
- **后果**：外部只读入口可保持轻量并避免目录级副作用，但后端状态不再能够使用进程单例；必须为多窗口和关闭清理建立独立测试覆盖。

## ADR-018：安装版证据采用固定执行、同源解析和独立物化

- **状态**：已接受（2026-07-27）。
- **决策**：installed-app v2 的 24 个 required case 只允许由仓库内固定 adapter 执行；capture artifact 保存原始报告、逐 case 结果、执行日志和可观察产物。任何 manifest、命令行或环境变量都不能提供替代命令。
- **来源边界**：GitHub REST 是正式来源信任根。同一 `main`/`workflow_dispatch` run 必须绑定精确 candidate SHA、attempt、成功前置 job/step，以及名称唯一、未过期、非空且 digest/size 可核验的 candidate 与 execution artifact。物化前按 API 已核验的 ID 下载；最终 gate 还必须从该下载目录独立重哈希唯一 `jotluck.exe`，不能只信任 materializer 写入的 metadata。
- **物化边界**：materializer 只复制可信 execution artifact 中由 raw report 守恒列出的普通非空文件，并生成 transcript、manifest 和生产 inventory。它的本地自检只能输出 `structural-diagnostic`；正式 PASS 仍要求独立 evidence commit、在线 provenance、精确 candidate 二进制和完整 GUI/安装旅程。
- **观察边界**：adapter 意图必须写入独立 `adapter-action-log`；WebDriver v3 在 `remote()` 成功返回处记录 handshake，并以 `attemptId + sessionId` 绑定随后 hooks 真实观察到的 W3C 协议命令、结果、错误和删除终态。WebdriverIO wrapper 的重复 hook 必须在 session 内折叠，`$`/`click`/`setValue`/`emit` 等库包装器不得冒充驱动命令；`newSession` 发生在 hooks 建立前，不得作为可观察命令伪造。ASSOC-01～04 必须保存目标内容前后 readback、UIA 命中文字与同一 Shell PID 的 CIM `ExecutablePath`；RF-10 必须保存 packaged/installed EXE 身份并与最终 gate 的独立候选哈希闭合。
- **性能语义**：20 次冷启动与 30 次热开窗原始样本、正数、数量、P90 和 advisory 必须可复算且跨报告守恒；每次冷启动前后必须为零进程，每次热窗口关闭后必须恢复原窗口数，热会话结束后必须再次为零进程。2 秒/1 秒是参考环境目标，不是能力或安全边界；超过时返回固定 advisory 与 `pass-with-warnings`，缺样本、生命周期不完整或伪造结果仍硬失败。
- **后果**：测试机并行负载不会单独阻断 preview，但也不能用“环境抖动”豁免缺安装旅程、缺样本、缺 provenance、缺证据提交或产品功能失败。

## 变更记录

- 2026-09-14（v1.9）：ADR-027 定稿为已接受——门禁与互审数字补全（含 R1 三大 major 的实证裁决：旧码重建审计证明快照忠实、refDefinition TXT 透传修复、双 tsc 推翻 strict 疑虑）。
- 2026-09-14（v1.8）：新增 ADR-027（提案中）——导出与索引收口：块级权威 AST + 行内共享 marked 词法、Rust 死索引通道删除；切片 D 门禁全绿后定稿。
- 2026-09-14（v1.7）：ADR-026 定稿为已接受；补全 kill/keep 双判据实测数字（IME 200 字合成组合零漂移 + 19 字符逐字符真实点击落点 100% 正确）；附跨会话教训（真实占宽免坐标工程、CM6 组合期 DOM 不承诺、合成 IME 近似边界、HighlightStyle 与聚焦行类正交）。

- 2026-09-08（v1.5）：新增 ADR-024，V2.5 个性化第一迭代采用解码期浅融合（首 token 双倍偏置 + 纯模型分门控 + 空先验字节级回退）；设置新增个性化开关（默认开启）。

- 2026-09-08（v1.4）：新增 ADR-023，模型线解冻并立项用户个性化为下一迭代基线；旧「等真实用户 → 四步解冻」口径废止为涉及时适用的约束（语料许可审计未通过期间公开权重仍被阻断）。

- 2026-08-09（v1.3）：根据正式矩阵真实 Windows worker 数据，将 V2.2 模型请求 p90 与桌面预测硬截止从 80ms 调整为 200ms；含 40ms 防抖的可见 ghost 门禁同步调整为 250ms。质量、内存、静态体积和 final 门禁不降低。

- 2026-08-05（v1.2）：新增 ADR-021/022，确立 PowerShell 式双平面补全、精确编辑、retained 学习合同，以及下一版本免费开放词表公共生成器和 24MiB 总预算。

- 2026-08-04（v1.1）：新增 ADR-020，确定 Office/PDF 隔离语义导入、可取消 worker、双路径编辑和 Windows 系统默认应用边界。

- 2026-08-03：新增 ADR-019，确定五语言类型化目录、首次系统检测、内容保护、结构化原生错误和 Theme Host i18n 边界。

- 2026-07-27：新增 ADR-018，确立固定 adapter、REST 同源解析、独立物化及性能参考警告语义。
- 2026-07-27：ADR-018 补充 Shell/ProgID 关联启动、驱动事实与 adapter 旁白分离、verifier 语义解析及冷启动零进程边界。
- 2026-07-27：ADR-018 补充 WebDriver v3 handshake 状态机、候选 EXE 最终重哈希、ASSOC/RF-10 版本化身份对象与仓库 LF 字节契约。
- 2026-07-25：新增 ADR-017，确立单进程多窗口关联文件、规范路径去重、三态窗口会话及窗口级服务隔离。
- 2026-07-25：ADR-017 补充只读初始 grant、单文件编辑提升、`assert_workspace` 与唯一目录提升命令，并定义 preview 的 V2S 不可达门槛。
- 2026-07-13：ADR-016 完成有界矩阵与逐语言组合预检；固定矩阵最好前沿 Oracle 37.5%/40.5% 未达 40%/45% 架构门槛，记录 architecture stop，未训练 Gate 或消费 final。
- 2026-07-13：新增 ADR-016，确认 Public V2S 的组合式统计生成、Worker 信任边界、有界训练矩阵、双 final 与单一发布协议。
- 2026-07-13：新增 ADR-015，移除停止 V2R 的生产运行时和重复 v4 profile，公共 L3 收口为一个默认未绑定的模型插槽。
- 2026-07-13：新增 ADR-014，停止固定短语库 V2R 架构，要求未来开放词表/组合输出另立 ADR。
- 2026-07-12：ADR-013 固定 4-byte patch 与 silence-safe v3 训练语义，禁止 bank miss 冒充 abstain。
- 2026-07-12：ADR-013 补充多合法前缀训练语义与可重算 generator/training-data/bundle 证据边界。
- 2026-07-12：新增 ADR-013，确认公共 L3 从未发布的 v4 N-gram 重构为 V2R 短语 Transformer，并冻结新的训练、体积和独立质量边界。
- 2026-07-11：新增 ADR-012，将微型 Transformer 固定为候选后的数据型付费重排扩展；不改变免费 V2 路线。
- 2026-07-11：补充 ADR-011 的分层候选、语言分路、定额蒸馏和发布资格约束；既有主题决策未变更。
