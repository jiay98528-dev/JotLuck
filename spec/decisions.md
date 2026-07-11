# Decisions

版本：2026-07-11

## 已确认决策

1. 外观系统采用热插拔 UX Theme Plugin 架构，默认主题为 `paper` / 羽翼布局。
2. 主题包必须使用 `ThemeManifest v2` 声明 runtime、capabilities、permissions、entrypoints、slots、assets、checksums、minAppVersion 和商业化预留字段。
3. 声明式主题通过 DSL 渲染；官方代码主题和本地可信代码主题可通过 `ThemeHostContext` 替换 Shell/主页/弹窗级 UX slot。
4. P0 阶段不做权限审批、沙箱隔离、社区市场审核或远程购买接入。本地主题能力声明不作为安装/启用阻断条件。
5. 商业化通过 `ThemeCommerceProvider` 适配，默认本地 mock。未来接入 Gumroad、Polar 或自建后端时只替换 provider 实现，不改变主题中心和 manifest 结构。

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

## 变更记录

- 2026-07-11：新增 ADR-012，将微型 Transformer 固定为候选后的数据型付费重排扩展；不改变免费 V2 路线。
- 2026-07-11：补充 ADR-011 的分层候选、语言分路、定额蒸馏和发布资格约束；既有主题决策未变更。
