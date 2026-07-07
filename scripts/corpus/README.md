# MarkLuck 基准 L3 语料目录

> 语料规范 v3.0 | 本目录用于离线 N-gram baseline，不用于 LLM 训练。

## 定位

MarkLuck 的补全目标是短、准、快、安静。基线语料只训练常见笔记语感，不训练长篇续写。结构化补全由 Provider 处理，语料只补足普通文本的短句搭配。默认发布模型是 `web-local` compact；L2 只代表用户历史和全局本地积累，L3 才是预训练 baseline。

## 目录结构

```text
corpus/
├── corpus.config.json
├── README.md
├── SOURCES.md
├── web-sources.json        # 外网正文采集入口：URL/类别/语言/权重/深度
├── training-report.json
├── _web-cache/             # 本地外网正文缓存，gitignored
│   ├── _raw/               # 原始抓取快照
│   ├── _clean/             # 碎片化 + 隐私清洗后的训练片段
│   └── _reports/           # 采集报告和 web-local 训练报告
├── note-patterns-zh/       # 主语料：短笔记、项目记录、会议、任务、复盘
├── tech-writing-zh/        # 技术笔记：排障、架构、配置、发布、迁移
├── markdown-structures/    # Markdown 常用结构周边文本
├── creative-zh/            # 少量自然中文表达
└── code-doc-en/            # 英文笔记/技术文档，低到中等权重
```

`novel-zh/` 已从语料库移除。发布基线不得重新引入小说、长篇故事或连续叙事语料。

## 语料规范

- 编码：UTF-8，无 BOM。
- 行尾：LF。
- 格式：Markdown 或纯文本。
- 禁止：YAML frontmatter、真实隐私、密钥、访问令牌。
- 每个普通语料文件建议 3KB-8KB；结构模式和回归短句文件可更短。
- 外网正文只进入 `_web-cache/` 本地缓存；必须经过碎片化和隐私清洗，默认不提交原文或清洗片段。

## 训练命令

```bash
pnpm install
pnpm generate-baseline -- --profile web-local
pnpm collect-web-corpus -- --profile web-local
pnpm generate-baseline -- --profile web-local
pnpm generate-baseline -- --profile release
```

输出：

- `packages/app/public/baseline-ngram.web-local.compact.txt`（默认发布模型，6MB hard cap，5.7-6.0MB soft target）
- `packages/app/public/baseline-ngram.v1.compact.txt`（repo-only fallback）
- `scripts/corpus/training-report.json`
- `scripts/corpus/_web-cache/_reports/training-report.web-local.json`

## 验收标准

- `note-patterns-zh + tech-writing-zh + markdown-structures + web-local clean fragments` 的 effective coverage 应为主体。
- `novel-zh` 不应出现在报告中。
- `web-local` 的 `estimatedSize` 不得超过 6MB；低于 5.7MB 时允许通过但应继续扩充高价值语料。
- `release` profile 不读取 `_web-cache`，只生成 repo-only fallback。
- `topContexts` 不应出现 `\r`、乱码或过多纯表格空白上下文。
- probes 需要区分 `model`、`fallback`、`none`，不能把规则 fallback 伪装成模型命中。
- `languageDistribution.mixed` 必须为 0；任一类别有效权重超过 45% 时 `web-local` 训练失败。

## 迭代方式

1. 发现某类补全效果差，先新增对应场景的自有语料。
2. 运行 `pnpm generate-baseline -- --profile release`。
3. 查看 `training-report.json` 的分布和 probes。
4. 只在语料或权重层调整，避免为了语感问题修改运行时 predictor。

外网正文实验流程：

1. 在 `web-sources.json` 中增加 URL、类别、语言、权重、深度和启用状态。
2. 运行 `pnpm collect-web-corpus -- --profile web-local`。
3. 查看 `_web-cache/_reports/collection-report.web-local.json` 的保留片段、隐私命中和丢弃原因。
4. 运行 `pnpm generate-baseline -- --profile web-local`。
5. 默认运行时加载 `/baseline-ngram.web-local.compact.txt`；开发环境仍可用 `VITE_AUTOCOMPLETE_BASELINE_URL` 指向其他 compact 文件做对比。
