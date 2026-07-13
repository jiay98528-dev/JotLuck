# V2R 冻结评测集入口

此目录只定义正式评测集的交付边界，不提供自动生成的参考答案。训练前只允许物化两套 validation；任一 validation 缺失时语料物化和训练矩阵失败关闭。两套 final 由独立保管方扣留到候选冻结和 SHA 占用完成后，任一 final 缺失时 RC 失败关闭。

## 文件与角色

- `cold-validation-v3.json`
- `workspace-validation-v3.json`
- `cold-final-v3.json`
- `workspace-final-v3.json`

每个文件必须通过 `validateV2RHoldoutV3`：50 篇目标、200 个 checkpoint、中英文各 100、150 complete、50 silence、五类别均衡。每个 complete checkpoint 需要 3–5 条人工可接受 continuation；workspace 支持文档必须声明 `patternIds`，且每个模式至少由两篇独立文档支持。

## 盲测与一次性消费

- validation 可在候选选择阶段读取，但不得复制措辞进入训练池。
- final 必须由独立审阅者冻结；训练器、生成器和训练前语料治理不得读取其正文或 continuation。
- 正式 RC 在读取 final 前按数据集 SHA 创建不可复用的 Git ref；任何失败或中断都视为该 final 版本已消费。
- final 明文下载后、质量评测前，聚合器从冻结 selection 重新读取并校验全部训练文档，生成不可覆盖的 `final-overlap-audit.json`；精确或近似重叠不为 0 时立即消费并拒绝该 final，不得返回训练阶段修补候选。
- `run-autocomplete-v2r-holdout.ts` 的 final 模式还会用不可覆盖 receipt 绑定候选四类资产、数据集 SHA 与质量报告。
- 纯本地同权限进程只能实现程序性隔离；需要严格盲测时，final 正文应由独立保管方在候选冻结后作为受控 CI artifact 提供。

禁止把旧 v2、synthetic development/internal selection、固定探针或自动生成 continuation 复制到此目录。
