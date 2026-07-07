# MarkLuck 文字补全功能规格

> 版本：v1.2 | 日期：2026-07-06 | 状态：✅ 已实现（Provider + web-local baseline）
> 关联文档：`doc/PRD.md` §F-17、`doc/TAD.md` §3.10、`spec/decisions.md` ADR-011、`plans/openapi-delightful-sunrise.md`

## 一、概述

MarkLuck 编辑器内置的轻量级文字补全系统。通过统一幽灵文本管道，在光标后显示一条灰色斜体的最佳预测，用户按 `Tab` 一键接受或继续输入自然覆盖。**无弹出菜单、无下拉选择框。**

## 二、架构

```
GhostTextPlugin (CM6 ViewPlugin)  ← 渲染层
    ↓ getGhostText()
MarkdownPredictor (服务层)        ← 融合决策
    ├── CompletionContextBuilder  ← 语法/语言/行边界上下文
    ├── CompletionProvider[]      ← 结构化/序列/短语/N-gram
    ├── CompletionResolver        ← 排序、同一行、语言隔离、降噪
    └── NGramEngine (纯算法)      ← 统计预测
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

| 层  | 位置               | 来源                    |     大小      | 生命周期       |
| --- | ------------------ | ----------------------- | :-----------: | -------------- |
| L0  | IndexStore (Pinia) | .markluck_index.json    |       —       | 应用启动→关闭  |
| L1  | 内存               | scanDocument(当前文档)  |    ~300KB     | 文档打开→关闭  |
| L2  | localStorage       | 用户历史/全局积累       | ~500KB-3.5MB  | 持久化         |
| L3  | public static file | 预训练 baseline compact | ≤6MB hard cap | 发布包静态资源 |

### 基准 L3 预训练

| 优先级 | 类别                     | 配比/约束            | 生成方式                           |
| :----: | ------------------------ | -------------------- | ---------------------------------- |
|   P0   | 结构化 Provider          | 不进入 N-gram 主模型 | 硬编码 provider                    |
|   P1   | 中文短笔记/会议/项目记录 | 35-45%               | repo curated + clean web fragments |
|   P2   | Markdown/知识管理        | 15-20%               | repo curated + clean web fragments |
|   P3   | 中文技术笔记             | 15-20%               | repo curated + clean web fragments |
|   P4   | 英文笔记/技术文档        | 20-30%               | repo curated + clean web fragments |
|   P5   | 百科/通用解释            | ≤5%                  | 低权重 clean web fragments         |

### 持久化格式

```
localStorage key: "markluck:ngram:v2"      # 兼容旧键名，内容为 v3 JSONL
格式: 每行一个 JSON tuple: [ctxHex, [[predHex,count], ...], flag]
meta:  "markluck:ngram:meta" → {
  "schemaVersion": 3,
  "docs": N,
  "totalEntries": N,
  "lastSave": T,
  "lastError": optional,
  "migratedFrom": optional
}
```

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

**训练命令**：`pnpm generate-baseline -- --profile web-local`

**repo-only fallback 命令**：`pnpm generate-baseline -- --profile release`

**外网正文采集命令**：`pnpm collect-web-corpus -- --profile web-local` → `pnpm generate-baseline -- --profile web-local`

**容量目标**：`web-local` compact 硬上限 6MB，软目标 5.7-6.0MB；超过硬上限训练失败且不更新发布资产。raw/clean 外网缓存不进入发布包。

**迭代流程**：准备/修改语料 → 运行采集和训练 → 查看 `training-report.web-local.json` → 补充不足类别 → 重新训练。外网正文先进入 `_web-cache/_raw`，再切分为 20-120 字片段并清洗人名、电话、公司名、笔名、账号、地址等隐私实体，训练只读取 `_web-cache/_clean`。训练报告必须包含模型字节数、语言配比、类别有效权重、低价值 top contexts、网页腔命中数、fallback/model 命中拆分。

**默认输出**：`packages/app/public/baseline-ngram.web-local.compact.txt`（运行时首次 fetch → localStorage）

**fallback 输出**：`packages/app/public/baseline-ngram.v1.compact.txt`。运行时默认加载 web-local compact；加载失败时回退 v1。开发和调试仍可用 `VITE_AUTOCOMPLETE_BASELINE_URL` 覆盖默认 URL。

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
结构化上下文 > 序列/LineEcho > 当前文档词库 > 短语槽位 > 近期短语 > 用户词库 > N-gram > 固定 fallback
非结构化候选必须同一行、短文本、行尾触发
中文上下文不接受英文开头候选；英文上下文不接受 CJK 候选；mixed 候选丢弃
空结果或低价值候选 → 返回 null，不显示 ghost text
```

## 五、交互规范

| 用户行为         | 系统响应                                               |
| ---------------- | ------------------------------------------------------ |
| 停止输入 150ms   | 出现 ghost text（如果存在高置信度预测）                |
| `Tab`            | ghost text 变为实际文本，learn() 更新统计表            |
| 继续输入任意字符 | ghost text 消失，150ms 后重新预测                      |
| `Escape`         | 清除 ghost text；同段落同 provider 连续拒绝 2 次后静默 |
| 切换笔记         | L1 切换为新文档，L2 保留                               |
| 清空本地学习数据 | 删除 L2 N-gram、短语词库、训练 meta；保留当前笔记内容  |
| 首次启动         | fetch L3 baseline → 基础预测立即可用                   |

### 快捷键

| 按键     | 行为                               | 优先级 |
| -------- | ---------------------------------- | :----: |
| `Tab`    | Ghost text 可见 → 接受补全         |  最高  |
| `Tab`    | Ghost text 不可见 → 插入制表符缩进 |  默认  |
| `Escape` | 清除 ghost text + 降低权重         |   高   |

### 禁用区域

- 代码块内（` ``` ` 到 ` ``` `）
- YAML frontmatter 内（文件开头的 `---` 到 `---`）
- 空行/纯空白行（严格序列规律补全除外）
- 置信度 < 0.15

## 六、性能约束

| 指标                  | 目标           |
| --------------------- | -------------- |
| scanDocument (100KB)  | < 50ms         |
| 单次 predict          | < 1ms          |
| Ghost text 渲染       | < 5ms          |
| 结构化匹配            | < 1ms          |
| Provider 计算 p90     | < 30ms         |
| 用户可见 p90 (含防抖) | < 230ms        |
| L1 内存占用           | < 500KB        |
| L2 localStorage       | < 5MB          |
| Bundle 增量 (gzip)    | < 5KB          |
| L3 web-local baseline | ≤ 6MB hard cap |

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
4. **数据不离开浏览器** — 纯 localStorage，不上传任何数据
5. **永远不主动扫描用户文件** — 只读用户显式打开的文档和 .markluck_index.json
6. **预训练和用户历史分层** — L3 baseline 是发布资产，L2 只保存本地用户历史，二者不合并写回。

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
- `LLMProvider` 仅保留禁用 stub，不进入默认链路

`SequencePatternProvider` 只在光标位于行尾时运行，读取紧邻上方的连续非空行；至少两行格式骨架一致且序号严格递增时，才补下一项。当前行为空时可补完整下一项，例如 `第一条、第一天` / `第二条、第二天` 后补 `第三条、第三天`；当前行已经输入前缀时只补剩余部分，例如输入 `第三` 后补 `条：`。它不写入 N-gram、不跨空行、不复制正文内容。

`LexiconProvider` 是输入法式补全的词库层，只补当前文档、笔记标题、标签、最近打开文件标题、已接受短语中出现过的 2-8 字词，不预测完整句子。用户接受过的短语保存在本地 localStorage 的 autocomplete 命名空间，设置页“清空本地学习数据”会一并删除。`PhraseSlotProvider` 只在中文 paragraph/list/quote 行尾触发，为高频写作槽位提供短标点或短语，例如 `我认为` → `，`、`原因是` → `因为`、`需要注意` → `的是`。两者都不在 code/frontmatter/table/mixed 上下文触发。

`CompletionContext` 除语法上下文外，还提供 `paragraphBeforeCursor`、`blockType`、`sentencePrefix`、`recentTokens`。其中 `blockType` 至少区分 paragraph、heading、list、quote、table、code、frontmatter，普通文章补全只允许 paragraph/list/quote 行尾触发。

Resolver 规则：结构化上下文优先，其次严格连续的序列/LineEcho、当前文档词库、短语槽位、近期短语、用户词库、N-gram。非结构化候选只允许光标位于行尾时显示；光标在行中时只允许结构化候选。Resolver 使用 `languageHint` 做双向隔离：中文上下文不接受英文开头候选，英文上下文不接受 CJK 候选，混合语言候选默认丢弃。低价值单字、英文残词、网页腔短语会被降权或压制。所有候选最终只渲染为一条 ghost text，不弹出候选菜单。
