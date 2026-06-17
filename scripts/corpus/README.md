# MarkLuck 基准 L2 语料目录

> 语料规范 v1.0 | 日期：2026-06-08

## 目录结构

```
corpus/
├── corpus.config.json          ← 训练配置（源目录/权重/参数）
├── README.md                   ← 本文件
├── training-report.json        ← 训练报告（自动生成）
│
├── novel-zh/                   ← 小说类语料
│   ├── 1984川菜馆/             ← 都市/系统流 (32章)
│   └── 老卒问道/               ← 仙侠/古典 (34章)
│
├── creative-zh/                ← 中文创作类语料
│   ├── diary-samples.md        ← 日记/随笔
│   ├── essay-samples.md        ← 散文/杂文
│   └── note-samples.md         ← 日常笔记
│
├── tech-writing-zh/            ← 中文技术写作
│   ├── tutorial-style.md       ← 教程风格
│   ├── api-doc-style.md        ← API 文档风格
│   └── readme-templates.md     ← README 风格
│
├── code-doc-en/                ← 英文编程文档
│   ├── js-ts-snippets.md       ← JS/TS
│   └── python-rust-snippets.md ← Python/Rust
│
└── markdown-structures/        ← Markdown 结构模式
    └── common-patterns.md      ← 列表/表格/引用
```

## 语料规范

### 文件格式
- 编码：UTF-8，无 BOM
- 格式：Markdown (.md)
- 行尾：LF (\n)
- 文件名：英文小写 + 连字符
- 禁止：YAML frontmatter

### 内容要求
- 完整、连贯、自然的文本
- 覆盖该风格的典型写作模式
- 不需要任何标注或标签
- 代码块和行内代码会被训练工具自动剥离
- 每个文件 ≥ 3KB

### 如何添加新语料
1. 在对应子目录下创建 .md 文件
2. 内容遵循上述格式和内容要求
3. 运行 `npx tsx scripts/train-baseline.ts` 重新训练
4. 查看 `training-report.json` 确认覆盖度

### 如何迭代
1. 发现某类写作场景预测效果不好
2. 往对应语料目录添加更多该风格的示例文本
3. 重新训练 → 覆盖度提升
4. 不需要改任何 TypeScript 代码

### 命名规则
- `_draft/` 或 `_archive/` 前缀的目录会被训练工具忽略
- 文件名使用英文描述语料类型：`diary-samples.md`、`tutorial-style.md`
