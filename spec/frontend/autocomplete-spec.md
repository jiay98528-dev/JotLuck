# JotLuck 文字补全功能规格

> 版本：v1.6 | 日期：2026-07-11 | 状态：✅ V2 运行时完成；⛔ 公共 L3 发布闸门关闭
> 关联文档：`doc/PRD.md` §F-17/F-17.1、`doc/TAD.md` §3.11/§3.12、`spec/decisions.md` ADR-011/ADR-012、`plans/autocomplete-engine-v2.md`

## 一、概述

JotLuck 编辑器内置的轻量级文字补全系统。通过统一幽灵文本管道，在光标后显示一条灰色斜体的最佳预测，用户按 `Tab` 一键接受或继续输入自然覆盖。**无弹出菜单、无下拉选择框。**

## 二、架构

```
GhostTextPlugin (CM6 ViewPlugin)  ← 渲染层
    ↓ getGhostText()
MarkdownPredictor (工作区级服务) ← 融合决策；编辑器重建时复用
    ├── CompletionContextBuilder  ← 语法/语言/行边界上下文
    ├── CompletionProvider[]      ← 结构化/序列/短语/N-gram
    ├── CompletionResolver        ← 排序、同一行、语言隔离、降噪
    └── NGramEngine (纯算法)      ← Unicode-safe 统计预测

L3BaselineLoader (应用级单例)     ← manifest 校验、一次加载、只读共享
CompletionTrainingService         ← notebook 文档贡献替换/撤销，不写 Personal L2
```

### 文件清单

| 文件                                                       | 职责                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| `packages/app/src/utils/ngram-engine.ts`                   | N-gram 纯算法：scan/predict/learn/merge/prune/serialize/deserialize |
| `packages/app/src/services/MarkdownPredictor.ts`           | 兼容 facade：L1/L2/L3 管理、持久化、provider 调度                   |
| `packages/app/src/services/completion/`                    | Context/Provider/Resolver/Metrics 核心实现                          |
| `packages/app/src/utils/cm6-ghost-text.ts`                 | CM6 插件：GhostTextPlugin + Tab/Escape keymap                       |
| `packages/app/src/assets/styles/editor.css`                | Ghost text CSS 样式                                                 |
| `packages/app/src/components/editor/MarkdownEditor.vue`    | 集成点：autocomplete Compartment                                    |
| `scripts/train-baseline.ts`                                | 构建脚本：生成 release/web-local 基准模型                           |
| `packages/app/public/baseline-ngram.web-local.compact.txt` | 默认基准数据文件，发布包携带                                        |
| `packages/app/public/baseline-ngram.v1.compact.txt`        | repo-only fallback 基准数据文件                                     |

## 三、数据架构

### 分层缓存

| 层  | 位置                | 来源                        |      大小      | 生命周期           |
| --- | ------------------- | --------------------------- | :------------: | ------------------ |
| L0  | IndexStore (Pinia)  | .jotluck_index.json         |       —        | 应用启动→关闭      |
| L1  | 内存                | scanDocument(当前文档)      |     ~300KB     | 文档打开→关闭      |
| N2  | 内存                | 当前 notebook 的按文件贡献  | 受训练预算约束 | 工作区打开→关闭    |
| L2  | scoped localStorage | 用户明确接受/拒绝形成的历史 |  ~500KB-3.5MB  | 按 notebook 持久化 |
| L3  | public static file  | 预训练 baseline compact     | ≤6MB hard cap  | 应用级只读单例     |

L1、N2、Personal L2 和 L3 必须使用独立表，并在推理阶段分别产生候选；禁止先合并原始计数再把胜者统一标记成 L2。保存文件时以路径为身份替换 N2 贡献，重复保存相同内容不得增加计数；编辑、删除、重命名和切换工作区必须分别撤销、迁移或重建对应贡献。关闭文档只清理 L1，整篇正文不得合并进 Personal L2。

N2 的单文件贡献以 `minCount=1` 保留，先按工作区聚合计数和文档支持数，再执行最小文档支持及容量剪枝。不得在单文件阶段丢弃“每篇仅出现一次、但跨多篇重复”的规律。Personal L2 的显式接受信号不得被 N2 的正文频次淹没。

### 基准 L3 预训练

| 优先级 | 类别                     | 配比/约束            | 生成方式                           |
| :----: | ------------------------ | -------------------- | ---------------------------------- |
|   P0   | 结构化 Provider          | 不进入 N-gram 主模型 | 硬编码 provider                    |
|   P1   | 中文短笔记/会议/项目记录 | 35-40%               | repo curated + clean web fragments |
|   P2   | Markdown/知识管理        | 15-20%               | repo curated + clean web fragments |
|   P3   | 中文技术笔记             | 15-20%               | repo curated + clean web fragments |
|   P4   | 英文笔记/技术文档        | 20-30%               | repo curated + clean web fragments |
|   P5   | 百科/通用解释            | ≤5%                  | 低权重 clean web fragments         |

### 持久化格式

```
localStorage key prefix: "jotluck:scope:<notebook-root-hash>:autocomplete:"
personal model: "ngram:v4"                # long/short2/short3 独立表
signals:        "learning-signals:v2"
metrics:        "metrics:v2"
meta:           "meta:v4" → {
  "schemaVersion": 4,
  "docs": N,
  "totalEntries": N,
  "lastSave": T,
  "lastError": optional,
  "migratedFrom": optional
}
```

所有读取必须校验 schema/字段/计数并捕获 JSON 错误；损坏数据降级为空状态，不得中断预测。旧聚合 N-gram 无法区分正文贡献和个人反馈，升级时丢弃并从工作区文件重建；accepted lexicon 与合法学习信号可迁移。写入按 scope 串行合并，可用时使用 Web Locks，并通过 BroadcastChannel/storage event 同步其他标签页。

### 基准语料训练管道

```
scripts/corpus/
├── corpus.config.json              ← 源目录/权重/参数
├── README.md                       ← 语料维护说明
├── SOURCES.md                      ← 来源与采集策略记录
├── web-sources.json                ← 外网正文采集入口
├── training-report.json            ← 训练报告
├── _web-cache/                     ← 本地外网正文缓存，gitignored
│   ├── _raw/                       ← 原始抓取快照
│   ├── _clean/                     ← 碎片化 + 隐私清洗后的训练片段
│   └── _reports/                   ← 采集/训练报告
├── note-patterns-zh/               ← 主语料：短笔记、项目记录、会议、任务、复盘
├── tech-writing-zh/                ← 技术笔记：排障、架构、配置、发布、迁移
├── markdown-structures/            ← Markdown 常用结构周边文本
├── creative-zh/                    ← 少量自然中文表达
│   ├── diary-samples.md            ← 日记/随笔
│   ├── essay-samples.md            ← 散文/杂文
│   └── note-samples.md             ← 日常笔记
├── code-doc-en/                    ← 少量英文编程文档，低权重
│   ├── js-ts-snippets.md
│   └── python-rust-snippets.md
└── project-docs/                   ← 📁 项目自身文档 (路径引用)
    ├── → ../../doc/
    └── → ../../spec/
```

**原则**：仅 P0 格式闭合规则硬编码，语言习惯全部来自语料文件。语料为纯 `.md`，无需标注。`corpus.config.json` 配置源目录和权重。

**语料创作规范**：UTF-8 无 BOM / LF 行尾 / Markdown 格式 / 禁止 frontmatter / 禁止真实隐私 / 训练工具自动剥离代码块和行内代码。发布基线不使用小说或长篇连续叙事语料。

**训练命令**：`pnpm generate-baseline -- --profile web-local --quality-report <json>`。正式资产只有在治理、容量和绑定模型/输入/holdout 哈希的质量证据全部通过时才允许替换；本地诊断使用 `--allow-verified-degraded --candidate-dir <dir>` 写入隔离候选，其 manifest 必须保持 `releaseEligible: false`。

**repo-only fallback 命令**：`pnpm generate-baseline -- --profile release --quality-report <json>`

**外网正文采集命令**：`pnpm collect-web-corpus -- --profile web-local` → `pnpm generate-baseline -- --profile web-local`

**容量目标**：`web-local` compact 使用 5.7MiB 定额蒸馏目标和 6MiB 硬上限；训练器必须先按支持来源数、文档频次、上下文熵、保留质量和验证集效用做确定性的全局定额蒸馏，选择满足质量的最小 Pareto 模型。超过硬上限仍须失败且不更新发布资产，但禁止把“填满 5.7MiB”当作发布质量目标。raw/clean 外网缓存不进入发布包。

**迭代流程**：准备/修改语料 → 运行采集和训练 → 查看 `training-report.web-local.json` → 补充不足类别 → 重新训练。外网正文先进入 `_web-cache/_raw`，再切分为 20-120 字片段并清洗人名、电话、公司名、笔名、账号、地址等隐私实体，训练只读取 `_web-cache/_clean`。训练报告必须包含模型字节数、语言配比、类别有效权重、低价值 top contexts、网页腔命中数、fallback/model 命中拆分。

**默认输出**：`packages/app/public/baseline-ngram.web-local.compact.txt`。模型至少包含中文 Unicode code point 4→3→2 变阶表；英文正文优先查询词级 bigram/trigram，字符 4-gram 只承担词内续写回退。运行时同时读取对应 manifest，验证 schema、阶数范围、表 profile、字节数、条目数、训练输入清单哈希和 SHA-256；L3 不写入 localStorage，只在应用级单例中只读共享。

**fallback 输出**：`packages/app/public/baseline-ngram.v1.compact.txt`，也必须有同级 manifest。HTTP 200 空内容、HTML、截断、超限、hash/schema/最小条目或 `runtimeEligible` 失败均视为加载失败并回退；旧污染模型不得作为静默 fallback。两个模型均失败时返回空 L3，编辑器仍可工作。开发和 E2E 可用 `VITE_AUTOCOMPLETE_BASELINE_URL` 加载隔离候选，生产构建忽略该覆盖。

训练管线必须 fail closed：来源 manifest 的许可证覆盖率为 100%，未知许可、隐私/样板文本、原始输入重复、清洗后残余重复、训练—正式 holdout 重叠、类别/域占比、模型容量或独立 holdout 质量任一闸门失败时，不得覆盖现有模型或报告。原始输入精确重复率和去重后残余精确重复率都必须 ≤1%，近似重复率 ≤3%、单类别 ≤40%、单 Web 域名 ≤5%，正式 holdout 与训练文本重叠为 0。`releaseEligible` 必须由实际 holdout 指标、治理闸门和容量共同决定，profile 名称不得绕过质量结果。模型和报告先写临时文件，全部通过后原子替换。`novel-zh` 保留在仓库但硬隔离，配置或参数命中该目录时训练立即失败。

## 四、预测场景

### 场景覆盖矩阵

| 上下文    | 触发条件                     | 预测来源                                            | 示例输入 → 预测                    |
| --------- | ---------------------------- | --------------------------------------------------- | ---------------------------------- |
| 普通段落  | paragraph/list/quote 行尾    | 词库 + 短语槽位 + recent + L1/L2/L3 N-gram          | `我认为` → `，`                    |
| 格式闭合  | `**`/`*`/`` ` ``/`__` 未闭合 | FormatClosureProvider                               | `**粗` → `**`                      |
| Wiki-link | `[[` 内                      | 结构化优先                                          | `[[` → `快速入门]]`                |
| 标签      | 空格后 `#`                   | 结构化优先                                          | `#` → `javascript `                |
| 文件路径  | `[text](` 或 `![](`` 内      | 结构化优先                                          | `[link](` → `./notes/readme.md)`   |
| 序列规律  | 紧邻上方两行以上同形递增     | SequencePatternProvider                             | `第一条.../第二条...` → `第三条：` |
| 列表续行  | `- ` / `1. ` 行首            | MarkdownStructureProvider / SequencePatternProvider | `1.` → ` `                         |
| 代码块    | ` ``` ` 内                   | **不触发**                                          | —                                  |

### 语法上下文检测

```typescript
type SyntaxContext =
  | { type: 'wiki-link'; prefix: string }
  | { type: 'tag'; prefix: string }
  | { type: 'file-path'; prefix: string }
  | { type: 'markdown-format'; openMarker: string }
  | { type: 'markdown-structure'; prefix: string }
  | { type: 'general' };
```

### 融合决策

```
ContextBuilder → Provider[] → Resolver
结构化上下文 > 序列/LineEcho > 当前文档词库 > 短语槽位 > 近期短语 > 用户词库 > 分层 N-gram > 固定 fallback
非结构化候选必须同一行、短文本、行尾触发
中文上下文不接受英文开头候选；英文上下文不接受 CJK 候选；mixed 候选丢弃
空结果或低价值候选 → 返回 null，不显示 ghost text
```

N-gram Provider 必须用 `provideMany` 暴露 L1、Personal L2、N2、L3 各层的 top-k 候选，由 Resolver 在规范化去重、拒绝抑制和学习信号之后选出唯一 ghost text。引擎置信度必须按 manifest 的整数定点 `countScale` 校准样本量，并把 top-k 淘汰分支保存为不可输出的 `other mass`，使分母保留剪枝前总支持；禁止仅用剪枝后剩余分支的比例把单例样本表示为满置信度。文档支持数在训练入口作为硬门槛和蒸馏效用信号。

## 五、交互规范

| 用户行为         | 系统响应                                              |
| ---------------- | ----------------------------------------------------- |
| 停止输入 150ms   | 出现 ghost text（如果存在高置信度预测）               |
| 无修饰键 `Tab`   | 编辑区持焦、空选区、非 IME 且 ghost 可见时接受并学习  |
| `Shift+Tab`      | 保持原生焦点/反向缩进导航，不接受 ghost               |
| 继续输入任意字符 | ghost text 消失，150ms 后重新预测；不记录接受或拒绝   |
| `Escape`         | 清除 ghost text；同段落同候选文本连续拒绝 2 次后静默  |
| 切换笔记         | L1 切换为新文档，L2 保留                              |
| 编辑器/窗口失焦  | 仅清除 ghost 和定时器，不改变正文、不记录接受         |
| 清空本地学习数据 | 删除 L2 N-gram、短语词库、训练 meta；保留当前笔记内容 |
| 首次启动         | fetch L3 baseline → 基础预测立即可用                  |

### 快捷键

| 按键     | 行为                               | 优先级 |
| -------- | ---------------------------------- | :----: |
| `Tab`    | Ghost text 可见 → 接受补全         |  最高  |
| `Tab`    | Ghost text 不可见 → 插入制表符缩进 |  默认  |
| `Escape` | 清除 ghost text + 降低权重         |   高   |

### 禁用区域

- CommonMark fenced code 内（反引号或波浪号，允许最多三空格缩进，闭合长度不短于开启长度）
- YAML frontmatter 内（文件开头的 `---` 到配对 `---`；未闭合时直到文末均禁用）
- heading 和 table（只允许显式结构化 Provider）
- 空行/纯空白行（严格序列规律补全除外）
- 置信度 < 0.15

## 六、性能约束

| 指标                  | 目标                |
| --------------------- | ------------------- |
| scanDocument (100KB)  | < 50ms              |
| 单次 predict          | < 1ms               |
| Ghost text 渲染       | < 5ms               |
| 结构化匹配            | < 1ms               |
| Provider 计算 p90     | < 30ms              |
| 用户可见 p90 (含防抖) | ≤ 140ms             |
| L1 内存占用           | < 500KB             |
| L2 localStorage       | < 5MB               |
| 免费 V2 Bundle 增量   | 以实际构建报告核算  |
| L3 web-local baseline | ≤ 6MB hard cap      |
| L3 主线程单次任务     | < 50ms              |
| 切换 20 篇笔记        | L3 只加载/解析 1 次 |

## 七、验收标准

### Phase 1 验收

- [x] `**粗` 停顿 → ghost text `**` → Tab 接受 → 文本闭合
- [x] 代码块内 `function` → 无 ghost text
- [x] 首次启动 fetch L3 基准文件 → 有基础预测
- [x] Tab (无 ghost text) → 正常缩进
- [x] `npm run generate-baseline` 正常运行
- [x] NGramEngine 单元测试全部通过
- [x] MarkdownPredictor 单元测试覆盖 ≥ 80%（72 个用例，6 大类全覆盖）

### Phase 2 验收

- [x] `[[` → ghost text 显示最可能笔记名
- [x] `#` (空格后) → ghost text 显示最常用标签
- [x] `[text](` → ghost text 显示文件路径
- [x] F5 刷新 → 统计保持
- [x] 切换笔记 → L1 正确切换，L2 保留
- [x] L2 > 4.5MB → 末位淘汰触发

### Phase 3 验收

- [x] SettingsDialog 可开关补全
- [x] 冷启动 L3 baseline 提供基础预测
- [x] 低置信度 (< 0.15) 不显示
- [x] E2E 测试全部通过

### Phase 4 验收

- [x] web-local compact 作为默认运行时模型，失败回退 v1。
- [x] web-local compact 硬上限 6MB，训练报告记录模型字节数和类别有效权重。
- [x] 中文 probes ≥50、英文 probes ≥30、结构化 probes ≥15、负例 probes ≥20。
- [x] 用户手测回归覆盖“这是我最喜欢的事情”和“第一条/第二条/第三条”序列规律。
- [x] mixed language 候选为 0，负例误触发 ≤5%。

### Phase 5 验收

- [x] CodeMirror ghost 清理不在 `ViewPlugin.update()` 内同步 dispatch，输入/Tab/Escape/连续替换无插件崩溃。
- [x] 黑盒中文用例源码为 UTF-8 真中文，自动化守卫拒绝 mojibake。
- [x] `LexiconProvider` 从当前文档高频词、笔记标题/标签、最近打开文件标题和用户接受短语生成 2-8 字短候选。
- [x] `PhraseSlotProvider` 覆盖中文真实写作槽位：`我认为`、`原因是`、`也就是说`、`换句话说`、`需要注意`、`接下来` 等。
- [x] Resolver 支持 provider top-N 汇总、反馈 boost、连续拒绝降权、普通中文候选 2-8 字裁剪。
- [x] 设置页提供“清空本地学习数据”，清理 N-gram、accepted lexicon 和训练 meta，不删除任何笔记文件。
- [x] 真实中文写作 E2E：触发率 30-45%，可用率 15-30%，mixed 候选 0，可见 p90 ≤230ms。

## 八、关键设计决策

1. **永不弹出菜单** — 所有补全通过幽灵文本显示
2. **预测非生成** — 不创造新内容，只基于已有模式推荐
3. **拒绝成本为零** — 继续输入即可覆盖
4. **数据不离开设备** — 不上传任何补全文本或学习信号
5. **只训练显式打开的 notebook** — 单文件会话不启动后台训练；notebook 文档贡献仅驻留内存
6. **四层严格隔离** — L1/N2/Personal L2/L3 不共享可变表或 entry flags
7. **确定性模型** — N-gram 按 Unicode code point 训练，计数为正整数；short2/short3 分表查询并具备周期检测
8. **评测独立** — 正式质量 holdout 与训练/验证文本规范化重叠必须为 0
9. **预算优先** — 语料池大小与运行时模型大小解耦，训练器按全局效用在 6MiB 内蒸馏，不以硬失败替代选择
10. **语言分路** — 中文使用高支持的 4→3→2 字符变阶，英文优先词级 bigram/trigram；输出仍必须保持单一语言且 mixed 候选为 0

## 九、Provider Pipeline v2

运行时采用本地优先的分层 Provider 架构，`MarkdownPredictor` 保持对外 facade：

```text
GhostTextPlugin
  -> MarkdownPredictor.getGhostText()
  -> CompletionContextBuilder
  -> CompletionProvider[]
  -> CompletionResolver
  -> single ghost text
```

首批默认 Provider：

- `FormatClosureProvider`
- `MarkdownStructureProvider`
- `WikiLinkProvider`
- `TagProvider`
- `FilePathProvider`
- `SequencePatternProvider`
- `LineEchoProvider`
- `LexiconProvider`
- `PhraseSlotProvider`
- `RecentPhraseProvider`
- `ShortChineseProvider`
- `ShortEnglishProvider`
- `NgramProvider`

神经语义能力不得伪装成普通 Provider；V2.1 `SemanticReranker` 只位于已门控 CandidateBatch 与最终选择之间。

`SequencePatternProvider` 只在光标位于行尾时运行，读取紧邻上方的连续非空行；至少两行格式骨架一致且序号严格递增时，才补下一项。当前行为空时可补完整下一项，例如 `第一条、第一天` / `第二条、第二天` 后补 `第三条、第三天`；当前行已经输入前缀时只补剩余部分，例如输入 `第三` 后补 `条：`。它不写入 N-gram、不跨空行、不复制正文内容。

`LexiconProvider` 是输入法式补全的词库层，只补当前文档、笔记标题、标签、最近打开文件标题、已接受短语中出现过的 2-8 字词，不预测完整句子。用户接受过的短语保存在本地 localStorage 的 autocomplete 命名空间，设置页“清空本地学习数据”会一并删除。`PhraseSlotProvider` 只在中文 paragraph/list/quote 行尾触发，为高频写作槽位提供短标点或短语，例如 `我认为` → `，`、`原因是` → `因为`、`需要注意` → `的是`。两者都不在 code/frontmatter/table/mixed 上下文触发。

`CompletionContext` 除语法上下文外，还提供 `paragraphBeforeCursor`、`blockType`、`sentencePrefix`、`recentTokens`。其中 `blockType` 至少区分 paragraph、heading、list、quote、table、code、frontmatter，普通文章补全只允许 paragraph/list/quote 行尾触发。mixed 技术写作可按光标最近的完整局部语言片段选择单语模型，但候选自身含中英混写时仍必须拒绝；`the`、`a`、`to`、`of` 等英文功能词不能单独把中文段落切换到英文模型。

Resolver 规则：结构化上下文优先，其次严格连续的序列/LineEcho、当前文档词库、短语槽位、近期短语、用户词库、N-gram。非结构化候选只允许光标位于行尾时显示；光标在行中时只允许结构化候选。Resolver 使用 `languageHint` 做双向隔离：中文上下文不接受英文开头候选，英文上下文不接受 CJK 候选，混合语言候选默认丢弃。低价值单字、英文残词、网页腔短语会被降权或压制。所有候选最终只渲染为一条 ghost text，不弹出候选菜单。

Resolver 在排序前按规范化 suggestion 文本去重，拒绝信号对跨 Provider 的相同文本生效。固定优先级只定义语义层级，同层候选必须允许学习 boost/penalty 改变最终胜者。普通 Provider 只允许 paragraph/list/quote；格式、Wiki-link、标签、路径和列表结构由结构化 Provider 单独处理。

## 十、v1.4 验收增补

- 同一路径同一正文训练两次计数不变；编辑/删除撤销旧贡献，重命名只迁移一次。
- 裸格式标记不产生占位建议；Unicode 非 BMP 序列化往返一致；周期候选停止生成。
- metrics/signals/Personal L2 按 notebook scope 隔离且损坏可恢复。
- baseline 空文件、HTML、截断、hash/schema 错误可观测地回退；发布 compact ≤6MB。
- 未见 holdout 的真实写作触发率 35-42%、可用率 ≥35%、误触发率 ≤3%、mixed 0、可见 p90 ≤140ms。
- `formal-holdout.json` 是冻结 cold validation；`workspace-conditioned-holdout.json` 仅保留为 `releaseEvidence:false` 的历史诊断；正式 final 固定为 `workspace-conditioned-final-v2.json`。cold validation 与 final 均为 50 篇目标、200 个 checkpoint、中英文各 100 个、silence 50 个。七档只消费 cold validation；只有 validation 选出候选后，才允许一次性消费 final。若任一证据缺失，web-local manifest 必须保持 `releaseEligible:false`。
- Personal L2、N2、L3 的同上下文候选可同时进入 Resolver；显式接受和拒绝能改变最终胜者，且相同文本换 Provider 后不会立即重现。
- 同一 transition 在多篇文档各出现一次时能进入 N2；单篇孤立 transition 不因提前剪枝伪装成跨文档规律。
- 中文 L3 可按 4→3→2 变阶回退，英文 L3 可使用词级上下文；top-k 诊断能区分覆盖、排名和门控损失。
- 定额蒸馏后模型稳定不超过 6MiB，manifest 记录候选/保留条目、各阶/各 profile 条目和被淘汰字节。
- 原始输入精确重复率超过 1% 或独立 holdout 质量未达标时，任何 profile 的 `releaseEligible` 都必须为 false。

## 十一、v1.5 训练扩池与独立评测协议

### 11.1 语料来源与嵌套采样

- 扩池只读取 `corpus.config.json` 和 `provenance.json` 同时批准、许可证明确且内容哈希可复核的来源。未知许可证网页缓存、`novel-zh` 与正式 holdout 均不得进入训练或验证。
- 允许使用固定版本生成器产生项目自有/合成短笔记；生成器必须固定随机种子、模板版本、分类配额和输出清单，并把生成文件按项目许可证登记为独立来源。训练池总量不得超过 30MiB。
- 学习曲线固定使用 `0.1 → 0.5 → 1 → 3 → 8 → 16 → 24MiB` 七档。样本顺序由规范化片段哈希和固定分类轮转共同决定；较小档必须是较大档的严格子集，训练报告记录请求/实际字节、片段数、选择顺序版本和选择清单哈希。
- 运行时 compact 资产继续以 5.7MiB 为蒸馏目标、6MiB 为硬上限。语料池扩大不得绕过模型字节、条目、隐私、重复、来源占比和类别占比闸门。

### 11.2 冻结 holdout 与指标定义

- 正式 holdout 的 checkpoint 必须随数据记录 `cursorOffset`、`expectedSuffix` 和 `expectedBehavior`；评测器不得在代码中另藏 marker。每个 checkpoint 独立从原文前缀构造，不接受前一个预测，不共享 L1、Personal L2、Notebook 或学习事件。
- 正式发布至少使用 50 篇独立目标文档和 200 个冻结 checkpoint；单文档最多 5 个，中英文各不少于 80 个，至少覆盖 4 类真实笔记，`silence` 负例不少于 20%。final 的支持文档与目标必须分离，continuation 精确重复为 0、近重复率 ≤3%、单类别 ≤40%、结构模板占比 ≤10%，并禁止跨文档共享中文 16-code-point / 英文 10-word 长片段。
- validation 可反复用于选档；final 以 holdout SHA 为唯一消费键，在生产 Router 读取任何目标前写入不可覆盖的 receipt。final 失败或中断后，即使更换模型也不得复用该 holdout 版本。
- 每一档必须记录：L3-only context hit、top-1、top-3/Oracle@8、quality gate/Resolver 拒绝数与拒绝率、full-stack usable rate、sourceLayer/provider 归因、false trigger、完整候选 mixed、模型字节/条目、双 p90、fallback/timeout、解析最大同步 chunk 和长任务数。真实运行时证据必须绑定候选模型 SHA，`requestCount` 必须等于 holdout 机会数且 `visibleSampleCount > 0`；空样本不得以 p90=0 通过。
- `context hit` 仅表示模型存在可查询上下文；`top-1/top-3` 以期望后缀是否匹配原始 L3 候选计算；`usable` 必须经过同一质量门控与 Resolver；`false trigger` 只在预注册 `silence` checkpoint 上计算。诊断读取必须只读，不能再次记录 shown/accepted/rejected。

### 11.3 停止、解析与发布绑定

- 相邻档以同一组配对 checkpoint 计算 L3-only usable rate 增量。连续两次扩池增量均 `<1` 个百分点时停止继续训练，选择停止前最后一个仍有有效增益且满足全部闸门的最小档；不足三档时不得声称触发该停止规则。
- 模型蒸馏按真实独立文档支持、有效样本量、完整分支熵、验证集增益和 UTF-8 字节成本排序；被裁剪分支仍计入 `other mass`，禁止把高重复单文档误当高置信度。
- v4 文本模型必须分块解析并测量主线程同步 chunk。若任一正式候选出现 `>50ms` chunk，发布前必须迁移到 Worker 或紧凑 Trie/等价二进制表示；未超阈值时保留可审计的分块文本解析，避免无证据增加双实现复杂度。
- `releaseEligible` 必须 fail-closed 地分别绑定模型、训练输入、validation holdout、final holdout、final 报告、评测器源码树、冻结 V1、质量报告、真实运行时报告、V1/V2 对照、学习曲线和 Tauri WebView smoke 的仓库相对路径及 SHA。RC gate 必须重读文件，按固定源码闭包重算 evaluator tree，并验证冻结 V1 的源码、runner、tsconfig 及压缩/解压模型后重新计算 canonical/tree SHA；不能只信任布尔值、identity 内部声明或 64 位字符串形状。

## 十二、Completion Engine V2 与 V2.1 语义扩展

### 12.1 版本范围

- V2 是免费、完整、离线的混合检索引擎：结构化规则、当前文档复用、工作区短语检索、词典/英文词前缀和现有分层 N-gram 共同产生候选，由统一排名与 Resolver 输出唯一 ghost。
- V2.1 是计划中的付费语义重排扩展，只重排 V2 候选，不生成候选池之外的文本。V2.1 不进入本轮 V2 发布范围。
- 免费 V2 永远是可运行 fallback；插件未安装、未授权、损坏、超时或加载失败不得降低基础补全能力。

### 12.2 CandidateBatch 与异步契约

普通候选在规范化、跨 Provider 去重及语言/Markdown/质量硬门控后形成最多 8 条的 `CandidateBatch`，同时保存确定性 V2 fallback。请求快照至少包含 `requestId`、engine `epoch`、workspace scope、document version、UTF-16 cursor、截断上下文与 deadline；所有异步调用接受 `AbortSignal`。

响应只有在 epoch、文档版本、光标和焦点仍匹配时可被使用。deadline 后立即使用 V2 fallback；已经显示的 ghost 不得被迟到结果替换。工作区切换、编辑器销毁、继续输入、选区变化、IME 开始和失焦必须取消或废弃旧请求。

结构化候选绕过语义重排并保持最高优先级。任何异步后端或插件只能返回已有候选的索引/分数，不得改写 `text`、`from`、`sourceLayer`、学习属性或硬门控结果。

### 12.3 V2 双后端与共同排名

- Web/PWA 用专用 Web Worker 持有工作区短语索引；Tauri 用 Rust 应用状态持有等价内存索引。两端支持按路径替换、删除、重命名、清空和查询，不把正文派生索引长期落盘。
- 两端共享候选协议，并统一在 TypeScript 侧执行轻量排名、Resolver 和质量门控。后端异常必须降级为同步免费候选。
- 两端默认最多索引 2,000 篇文档；单文档输入 ≤512KiB、工作区输入合计 ≤16MiB、单文档贡献 ≤20,000 entries、工作区贡献合计 ≤300,000 entries。只保留 fingerprint 与可逆贡献；替换按净值核算，任何超限都必须保留旧贡献并 fail closed。
- 默认 soft deadline 为桌面 80ms、Web 110ms；包含输入防抖的最终可见预测仍须满足 p90 ≤140ms。防抖不得配置为大于最终 p90 预算的固定值。

### 12.4 P1/P2 评测与后端可靠性合同

- 质量结论必须分成治理正确、运行时安全和模型质量；前两者通过不能表述为模型质量通过。固定探针、精确 seeded 场景和训练集内 checkpoint 只用于诊断。
- 正式 workspace-conditioned holdout 必须让支持文档和目标文档完全分离，至少包含 50 篇目标文档、200 个 checkpoint，中英文各不少于 80 个、silence 不少于 20%。每个可学习模式至少由两篇措辞不同的支持文档提供，禁止复制目标句或完整 continuation。
- 冻结 V1 只作为独立子进程评测快照，固定 `fb46b1e`、逐文件/模型/聚合树 SHA 和行为 golden，不进入生产依赖图。普通 CI 在 Vite build 后扫描真实 `dist` chunk，发现快照标识、observer 或旧模型 SHA 即失败。V1/V2 对照必须使用完全相同的 cold/workspace holdout SHA，并报告 context hit、Top-1、Oracle@8、usable、false trigger、完整候选 mixed、全请求/可见预测 p90、fallback/timeout、Provider/sourceLayer 和拒绝原因。
- RC 必须先生成候选，再只对已通过确定性质量闸门的档位临时加载精确模型，通过生产 `EngineRouter`/Worker/deadline 采样，随后恢复 checked-in fail-closed 资产并用运行时报告重新选档。对 public fail-closed 模型的测量不能充当候选运行时证据。
- manifest 和 RC 证据必须绑定模型 SHA、训练输入 SHA、holdout SHA、评测器版本、质量证据 SHA 和学习曲线 SHA。普通 CI 仅验证安全回归及绑定一致性；RC gate 在任何正式指标缺失或不达标时非零退出。
- Worker/CSP 不可用时 Hybrid Retrieval 必须为 disabled，禁止回退到主线程同步索引。查询读取最近一次原子提交的快照并返回 `committedRevision`、`pendingMutations`、`warming`；scope/epoch 改变立即废弃旧结果。
- 非 Abort 后端故障每个工作区每次会话最多重建一次，训练服务从当前工作区文件幂等回放。重建期间的新 mutation 必须在替换完成后提交；第二次故障进入 disabled，确定性 L1/Personal L2/公共模型路径继续工作。
- 健康诊断至少包含 backend kind、ready/warming/degraded/disabled、revision、mutation 积压、重建次数、总构建耗时、估算内存和超过 50ms 的长任务数。

### 12.5 V2.1 数据型插件

`.mlcompletion` 必须是经过签名的数据包，manifest 声明 schema、插件/引擎 API 版本、`micro-transformer-reranker-v1` runtime、`rerank` capability、语言、最小应用版本、模型/tokenizer 的大小与 SHA-256、产品授权标识和发布签名。包内禁止任意 JavaScript、WASM、原生 sidecar 或系统权限。

宿主只支持白名单模型架构和算子。首版建议使用约 0.8–1.5M 参数的 INT8 微型 cross-encoder，并在固定 ONNX/WASM Worker 中批量评分最多 8 个 `(context, candidate)`；Tauri 首版复用 WebView Worker，只有延迟证据不达标时才增加等价原生 adapter。安装、预热、切换和回滚必须原子化。

### 12.6 隐私、资产与商业化闸门

插件推理只接收截断上下文和候选，不接收文件路径、工作区枚举、网络或文件系统能力。免费 V2 的公共检索资产合计以 ≤4MiB 为产品目标、6MiB 为兼容硬上限；工作区内存索引不计入静态资产。V2.1 的可选运行时/模型包单独核算，签名插件包连同精简运行时目标 ≤15MiB。

启动 V2.1 训练前，免费 V2 必须证明 `Oracle@8 - Top1 >= 8pp`。付费版本相对免费 V2 的可用率需提升至少 3 个百分点，或机会集条件可用率提升至少 8 个百分点；静默负例误触发恶化 ≤0.2 个百分点、mixed 保持 0、插件推理 p90 桌面 ≤50ms/Web ≤80ms、超时 fallback 率 ≤5%。详细执行顺序见 `plans/autocomplete-engine-v2.md`。
