# Public V2S 冻结评测集入口

本目录只定义 Public V2S 正式评测集的受控交付边界，不生成、复制或推断参考答案。自动生成的短笔记、旧 V2/V2R holdout、固定探针和历史真实写作样本均不得放入这里冒充发布证据。

正式文件名固定为：

- `cold-validation-v2s-v1.json`
- `workspace-validation-v2s-v1.json`
- `cold-final-v2s-v1.json`
- `workspace-final-v2s-v1.json`

每套数据都必须通过 `validateV2SHoldout`：50 篇目标文档、200 个 checkpoint、中英文各 100、150 个 complete、50 个 silence、五类各 40。每个 complete checkpoint 冻结 3–5 条人工可接受 continuation；workspace 支持文档与目标文档必须分离，每个模式至少绑定两篇独立支持文档。

## 独立性与一次性消费

- validation 只能在候选选择阶段使用，不得把措辞复制回训练池。
- final 明文由独立保管方持有。候选模型、tokenizer、Gate 阈值和两套 final SHA 同时冻结后，才允许在受控 RC 任务中解封。
- cold final 与 workspace final 必须同时 claim；任一任务失败、中断或只跑出一套结果，两套版本均视为已消费。
- final 明文不得由训练器、语料生成器或评测代码自动创建。缺少任一正式文件时，训练可以产出 fail-closed candidate，但发布器和 RC 必须拒绝放行。
- 当前仓库没有独立审阅者交付的四套明文，因此不得创建 `releaseEligible: true` 的 Public V2S manifest。

## 质量闸门

每套 validation/final 独立要求：触发 70–84/200、绝对可用至少 70/200、silence 误触发不超过 1/50、完整候选池及最终 ghost 的 mixed 为 0、中英文绝对可用率分别至少 30%、每类至少 25%、全请求和可见预测 p90 均不超过 140ms。validation 选型目标进一步收紧为触发 37%–40%、绝对可用至少 37%、silence 误触发 0、双 p90 不超过 120ms。
