# JotLuck 离线补全语料

> 语料规范 v5.0 | 用于离线字符/词级 N-gram baseline，不用于 LLM 训练。

## 安全边界

- 训练只读取 `corpus.config.json` 明确列出的来源。
- 每个来源必须在 `provenance.json` 中具有批准状态、许可证证据和内容哈希；任一项缺失或哈希漂移都会终止训练。
- `novel-zh/` 即使仍存在于仓库，也被训练器硬隔离，不能通过配置加入。
- 历史回归夹具与高度重复、自指补全文案列入 `excludedTrainingFiles`，保留文件但不进入模型；当前包括 `autocomplete-regression-notes.md`、`short-anchors.md` 和 `software-development-patterns.md`。
- `formal-holdout.json` 是 200-checkpoint 的独立 cold validation；训练器会检测精确、子串、近重复和高相似重叠。`workspace-conditioned-holdout.json` 保留给候选确定后的工作区条件评测，七档学习曲线不得反复消费它。
- 外网页面先经过正文提取、20–120 字符碎片化、跨页去重、网页模板清理和隐私 fail-closed 丢弃；不能用占位符替换后继续训练。

## 容量约束

- 经过验证和清理的训练池最多可扩大到 **30 MiB**。
- Web/Mobile compact 模型硬上限仍是 **6 MiB**，以避免启动反序列化和内存峰值失控。
- 5.7 MiB 是定额蒸馏的目标上限，6 MiB 是不可越过的硬上限；训练器按来源支持、文档频次、阶数和分支集中度保留高效用条目，不要求把资产填满。
- 正式资产只有在语料治理、容量和绑定模型哈希的独立 holdout 质量全部通过后才允许原子替换。`--allow-verified-degraded --candidate-dir <dir>` 只写隔离候选，不得覆盖正式资产。
- cold validation 与 workspace-conditioned holdout 均冻结为 50 篇目标文档、200 个 checkpoint；支持文档与目标文档分离。候选档位未确定前不得把 workspace holdout 结果写成正式发布证据。
- 项目自有合成池固定为最多 **24 MiB**，正文生成在已忽略的
  `_web-cache/generated-project-owned/`；干净克隆必须显式生成，缺失或哈希漂移时训练失败，
  不允许退回缩水池覆盖正式模型。
- 学习曲线固定使用 `0.1 → 0.5 → 1 → 3 → 8 → 16 → 24 MiB` 的同一确定性
  类别轮询序列前缀；每档只写 `_web-cache/autocomplete-candidates/`，候选 manifest 强制
  `releaseEligible: false`，直到独立 V1/V2 对照证据完成。

30 MiB 指清洁训练池，不是 compact 文件大小。不得为了凑体积降低文档频次、隐私、来源或留出集闸门。

## 当前来源

```text
corpus/
├── corpus.config.json
├── provenance.json
├── formal-holdout.json
├── workspace-conditioned-holdout.json
├── creative-zh/
├── tech-writing-zh/
├── note-patterns-zh/
├── markdown-structures/
├── code-doc-en/
├── _web-cache/generated-project-owned/ # 本地可再生 24MiB 项目自有合成池
├── novel-zh/                 # 仓库遗留；训练器硬隔离
└── _web-cache/               # 本地采集缓存；不自动进入训练
```

## 命令

```bash
# 显式生成并校验 24MiB 项目自有短笔记（正文受 git ignore 保护）
pnpm.cmd exec tsx scripts/generate-autocomplete-synthetic-corpus.ts

# 运行七档嵌套学习曲线；只写隔离候选和绑定证据
pnpm.cmd exec tsx scripts/run-autocomplete-learning-curve.ts

# 只计算七档并输出报告，不写候选
pnpm.cmd exec tsx scripts/run-autocomplete-learning-curve.ts --dry-run

# 已验证的仓库 fallback；同样要求绑定质量证据
pnpm generate-baseline -- --profile release --quality-report path/to/quality.json

# 仅在全部治理与绑定质量证据通过时替换正式 web-local
pnpm generate-baseline -- --profile web-local --quality-report path/to/quality.json

# 生成不具发布资格的隔离候选，用于 E2E/holdout 测量
pnpm generate-baseline -- --profile web-local --allow-verified-degraded \
  --candidate-dir packages/app/public/__autocomplete_candidate__

# 仅当 web-sources.json 中所有启用项都有批准的许可证证据时才采集
pnpm collect-web-corpus -- --profile web-local
```

每个模型旁边都有 `.manifest.json`，记录字节数、条目数、模型 SHA-256、输入清单哈希和发布资格；正式质量证据还必须绑定 `holdoutSha256`、`evaluatorVersion`、`qualityEvidenceSha256` 和 `learningCurveSha256`。详细治理证据在 `training-report*.json`。

2026-07-11 的七档候选全部通过治理与容量闸门，但 cold validation usable 均为 0，未选择任何档位；曲线保持 `releaseEligible:false`，没有覆盖正式 public 资产，也没有解锁 V2.1。

## 扩充流程

1. 优先增加项目自有、短笔记形态、与正式留出集独立的材料。
2. 外部材料先确认许可证和授权范围，再启用采集；登录、账户、设置等路径禁止采集。
3. 检查清洗报告和去重结果，把批准的 clean 文件及 SHA-256 显式加入 `corpus.config.json` 与 `provenance.json`。
4. 运行 dry-run，确认原始输入与去重后残余精确重复率都不超过 1%、近似重复率不超过 3%、类别占比不超过 40%、单一 Web 域名占比不超过 5%、mixed 为 0。
5. 先生成隔离候选，校验 sectioned manifest、SHA-256、字节数、整数计数和 Unicode 完整性，再运行独立 holdout；质量证据必须绑定候选模型和训练输入哈希，最后才能替换正式资产。

模型增大不等于质量提高。优先修复覆盖缺口、来源偏置和低信息候选，不再用长篇叙事或重复网页文本堆大 L3。
