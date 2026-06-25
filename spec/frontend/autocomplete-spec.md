# MarkLuck 文字补全功能规格

> 版本：v1.1 | 日期：2026-06-12 | 状态：✅ 已实现（Phase 1/2/3 全部完成）
> 关联文档：`doc/PRD.md` §F-17、`doc/TAD.md` §3.10、`spec/decisions.md` ADR-011、`plans/openapi-delightful-sunrise.md`

## 一、概述

MarkLuck 编辑器内置的轻量级文字补全系统。通过统一幽灵文本管道，在光标后显示一条灰色斜体的最佳预测，用户按 `Tab` 一键接受或继续输入自然覆盖。**无弹出菜单、无下拉选择框。**

## 二、架构

```
GhostTextPlugin (CM6 ViewPlugin)  ← 渲染层
    ↓ getGhostText()
MarkdownPredictor (服务层)        ← 融合决策
    ├── NGramEngine (纯算法)      ← 统计预测
    ├── IndexStore (Pinia)        ← 结构化数据
    └── 语法上下文检测器           ← 短路/增强
```

### 文件清单

| 文件                                                    | 职责                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| `packages/app/src/utils/ngram-engine.ts`                | N-gram 纯算法：scan/predict/learn/merge/prune/serialize/deserialize |
| `packages/app/src/services/MarkdownPredictor.ts`        | 服务层：L1/L2 管理 + 融合决策 + 持久化 + 淘汰                       |
| `packages/app/src/utils/cm6-ghost-text.ts`              | CM6 插件：GhostTextPlugin + Tab/Escape keymap                       |
| `packages/app/src/assets/styles/editor.css`             | Ghost text CSS 样式                                                 |
| `packages/app/src/components/editor/MarkdownEditor.vue` | 集成点：autocomplete Compartment                                    |
| `scripts/train-baseline.ts`                             | 构建脚本：生成基准 L2                                               |
| `packages/app/public/baseline-ngram.v1.compact.txt`     | 基准数据文件                                                        |

## 三、数据架构

### 分层缓存

| 层  | 位置               | 来源                   |     大小     | 生命周期      |
| --- | ------------------ | ---------------------- | :----------: | ------------- |
| L0  | IndexStore (Pinia) | .markluck_index.json   |      —       | 应用启动→关闭 |
| L1  | 内存               | scanDocument(当前文档) |    ~300KB    | 文档打开→关闭 |
| L2  | localStorage       | 基准 + 用户积累        | ~500KB-3.5MB | 持久化        |

### 基准 L2 预训练

| 优先级 | 类别                 |   条目    | 生成方式                  |
| :----: | -------------------- | :-------: | ------------------------- |
|   P0   | Markdown 格式闭合    |    ~80    | 硬编码规则                |
|   P1   | 中文技术文档搭配     |   ~1200   | 扫描 doc/_.md + spec/_.md |
|   P2   | 标点/空白/换行模式   |   ~300    | 硬编码规则                |
|   P3   | 英文编程/文档 N-gram |   ~600    | 手工列表                  |
|   P4   | 中文技术高频搭配     |   ~500    | 手工列表                  |
|   P5   | 日期/时间/模板       |   ~200    | 硬编码规则                |
|        | **合计**             | **~2880** |                           |

### 持久化格式

```
localStorage key: "markluck:ngram:v2"
格式: ctx(hex)|pred1,cnt1|pred2,cnt2|pred3,cnt3|flag\n
meta:  "markluck:ngram:meta" → {"v":2,"docs":N,"lastPrune":T,"totalEntries":N}
```

### 基准语料训练管道

```
scripts/corpus/
├── corpus.config.json              ← 源目录/权重/参数
├── README.md                       ← 语料维护说明
├── training-report.json            ← 训练报告
├── novel-zh/                       ← 🖋️ 小说类 (用户提供语料)
│   ├── 1984川菜馆/                 ← 都市/系统流
│   └── 老卒问道/                   ← 仙侠/古典
├── creative-zh/                    ← ✍️ 中文创作类 (AI 生成)
│   ├── diary-samples.md            ← 日记/随笔
│   ├── essay-samples.md            ← 散文/杂文
│   └── note-samples.md             ← 日常笔记
├── tech-writing-zh/                ← 📋 中文技术写作 (AI 生成)
│   ├── tutorial-style.md           ← 教程风格
│   ├── api-doc-style.md            ← API 文档风格
│   └── readme-templates.md         ← README 风格
├── code-doc-en/                    ← 💻 英文编程文档 (AI 生成)
│   ├── js-ts-snippets.md
│   └── python-rust-snippets.md
├── markdown-structures/            ← 📐 Markdown 结构模式 (AI 生成)
│   └── common-patterns.md
└── project-docs/                   ← 📁 项目自身文档 (路径引用)
    ├── → ../../doc/
    └── → ../../spec/
```

**原则**：仅 P0 格式闭合规则硬编码，语言习惯全部来自语料文件。语料为纯 `.md`，无需标注。`corpus.config.json` 配置源目录和权重。

**语料创作规范**：UTF-8 编码 / Markdown 格式 / 禁止 frontmatter / 自然连贯文本 / 每个文件 ≥ 3KB / 训练工具自动剥离代码块和行内代码

**训练命令**：`npx tsx scripts/train-baseline.ts`

**迭代流程**：准备/修改语料 → 运行训练 → 查看 `training-report.json` → 补充不足类别 → 重新训练。无需改代码。

**输出**：`packages/app/public/baseline-ngram.v1.compact.txt`（运行时首次 fetch → localStorage）

## 四、预测场景

### 场景覆盖矩阵

| 上下文    | 触发条件                     | 预测来源       | 示例输入 → 预测                  |
| --------- | ---------------------------- | -------------- | -------------------------------- |
| 普通段落  | 任意文本                     | N-gram (L1+L2) | `为了解` → `决这个问题`          |
| 格式闭合  | `**`/`*`/`` ` ``/`__` 未闭合 | N-gram         | `**粗` → `体**`                  |
| Wiki-link | `[[` 内                      | 结构化优先     | `[[` → `快速入门]]`              |
| 标签      | 空格后 `#`                   | 结构化优先     | `#` → `javascript `              |
| 文件路径  | `[text](` 或 `![](`` 内      | 结构化优先     | `[link](` → `./notes/readme.md)` |
| 列表续行  | `- ` / `1. ` 行首            | N-gram         | `- ` → `列表项`                  |
| 代码块    | ` ``` ` 内                   | **不触发**     | —                                |

### 语法上下文检测

```typescript
type SyntaxContext =
  | { type: 'wiki-link'; prefix: string }
  | { type: 'tag'; prefix: string }
  | { type: 'file-path'; prefix: string }
  | { type: 'markdown-format'; openMarker: string }
  | { type: 'general' };
```

### 融合决策

```
structured.confidence > 0.8 → 返回 structured
否则 → 返回 ngram (L1 和 L2 中取置信度更高者)
结构化为 null → 返回 ngram
ngram 为 null → 返回 structured
两者都为 null → 返回 null (不显示 ghost text)
```

## 五、交互规范

| 用户行为         | 系统响应                                    |
| ---------------- | ------------------------------------------- |
| 停止输入 150ms   | 出现 ghost text（如果存在高置信度预测）     |
| `Tab`            | ghost text 变为实际文本，learn() 更新统计表 |
| 继续输入任意字符 | ghost text 消失，150ms 后重新预测           |
| `Escape`         | 清除 ghost text，降低该上下文权重           |
| 切换笔记         | L1 切换为新文档，L2 保留                    |
| 首次启动         | fetch 基准 L2 → 基础预测立即可用            |

### 快捷键

| 按键     | 行为                               | 优先级 |
| -------- | ---------------------------------- | :----: |
| `Tab`    | Ghost text 可见 → 接受补全         |  最高  |
| `Tab`    | Ghost text 不可见 → 插入制表符缩进 |  默认  |
| `Escape` | 清除 ghost text + 降低权重         |   高   |

### 禁用区域

- 代码块内（` ``` ` 到 ` ``` `）
- YAML frontmatter 内（文件开头的 `---` 到 `---`）
- 空行/纯空白行
- 置信度 < 0.15

## 六、性能约束

| 指标                  | 目标                 |
| --------------------- | -------------------- |
| scanDocument (100KB)  | < 50ms               |
| 单次 predict          | < 1ms                |
| Ghost text 渲染       | < 5ms                |
| 结构化匹配            | < 1ms                |
| 总端到端延迟 (含防抖) | < 160ms              |
| L1 内存占用           | < 500KB              |
| L2 localStorage       | < 5MB                |
| Bundle 增量 (gzip)    | < 5KB                |
| Baseline 静态资源     | < 500KB (gzip ~90KB) |

## 七、验收标准

### Phase 1 验收

- [x] `**粗` 停顿 → ghost text `体**` → Tab 接受 → 文本变为 `**粗体**`
- [x] 代码块内 `function` → 无 ghost text
- [x] 首次启动 fetch 基准文件 → L2 有基础预测
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
- [x] 冷启动基准 L2 提供基础预测
- [x] 低置信度 (< 0.15) 不显示
- [x] E2E 测试全部通过

## 八、关键设计决策

1. **永不弹出菜单** — 所有补全通过幽灵文本显示
2. **预测非生成** — 不创造新内容，只基于已有模式推荐
3. **拒绝成本为零** — 继续输入即可覆盖
4. **数据不离开浏览器** — 纯 localStorage，不上传任何数据
5. **永远不主动扫描用户文件** — 只读用户显式打开的文档和 .markluck_index.json
6. **基准可被淘汰** — 出厂基准通过 sourceWeight=0.5 打折，用户不用的自然沉底
