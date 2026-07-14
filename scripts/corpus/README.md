# JotLuck 离线补全语料目录

> 语料目录规范 v6.0 | 日期：2026-07-14 | 当前公共模型训练已停止

完整的训练、评测、停止和发布说明见 `doc/autocomplete-model-training.md`。本文件只说明目录职责，避免与权威训练手册重复。

## 当前状态

- V2R 与 V2S 均有受版本管理的 architecture stop；不得继续长训练、Gate、final 或 publisher。
- Public L3 默认未绑定，RC `--autocomplete-only` 预期返回 code 10。
- `_web-cache/` 是可再生、Git ignored 的本地缓存，不能单独作为发布或放行证据。
- `novel-zh/` 永久硬隔离，即使文件仍在仓库也不得进入 selection。

## 目录职责

```text
corpus/
├── corpus.config.json                   # 历史 v4 来源与治理配置
├── provenance.json                      # 批准来源、许可证和内容身份
├── SOURCES.md                            # 人类可读来源索引
├── licenses/                             # 外部来源许可证证据
├── autocomplete-v2r-architecture-stop.json
├── autocomplete-v2s-architecture-stop.json
├── autocomplete-v2r-holdouts/           # V2R holdout 占位与隔离说明
├── autocomplete-v2s-holdouts/           # V2S holdout 占位与隔离说明
├── note-patterns-zh/                     # 项目自有精选短笔记
├── code-doc-en/                          # 项目自有英文笔记
├── creative-zh/ tech-writing-zh/ markdown-structures/
├── novel-zh/                             # 永久排除
└── _web-cache/                           # 本地生成/候选/报告；不提交
```

`doc/`、`spec/`、`memory/`、E2E fixture、validation 和 final 都不是训练来源。v4 来源回溯到 `provenance.json`；V2R/V2S selection 只接受固定 v3.1 生成器与 Tatoeba CC0 身份，并由 `autocomplete-v2r-generator.json`、`autocomplete-v2r-external.json`、清洗报告和许可证证据共同约束。

## 当前允许的只读命令

```powershell
pnpm exec tsx scripts/autocomplete-v2s/cli.ts --help
node scripts/verify-autocomplete-v2s-evidence.mjs --mode=ci
node scripts/release-rc-gate.mjs --autocomplete-only
```

第三条命令预期返回 code 10。该结果表示停止合同仍然有效，不应通过删除 stop 或修改 manifest 资格字段“修复”。

## 安全边界摘要

- 未知许可证、隐私、导航/会话样板、训练—holdout 重叠必须为 0。
- 清洗后精确重复为 0，近似重复率 ≤3%，单来源 ≤20%，单类别 ≤40%。
- 较小训练档必须是较大档的文档 ID 与内容 SHA 严格前缀。
- 缓存缺失、来源漂移或批准证据不足时失败关闭，不得生成缩水模型覆盖正式资产。
- 训练器和评测器只能写隔离候选；未来只有唯一 publisher 可以原子切换 canonical public manifest。
