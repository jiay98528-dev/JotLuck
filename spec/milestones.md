# Milestones

版本：2026-08-05

## 当前状态

- 外观系统重建为产品级热插拔 UX Theme Plugin 架构，默认主题为 `paper` / 羽翼布局。
- 当前路线包含本地市场、声明式主题、官方代码主题、本地代码主题、`.mltheme` 导入和 ThemeCommerceProvider 商业化接口预留。
- `super-workbench` 是能力验证主题，用于证明主题可接管 Shell、主页、编辑器表面、弹窗和状态层 UX。

## 后续工作

- M6: Tauri 打包与真实文件系统验证。
- M7: 发布打磨与稳定性修复。
- M8: 搜索、导出、自动补全、主题中心 GUI 验收与发布收口。
- M9（下一版本，禁止回灌当前 RC）：Completion Engine V2.2。先交付 CM6 增量上下文、双平面 Provider Registry、精确 TextEdit、retained 反馈/v5 迁移与 Session History；随后在 dev/E2E flag 下研究 `public-v2-free-decoder-v1`，只有 Oracle 预检、cold/workspace 双 final 和 Windows 中文 IME GUI 闭环全部通过才切换默认。
- Future: 远程主题市场、真实支付、账号、社区审核和沙箱隔离。
- Future（M9 双 final 通过后才可启动）：离线语义短续写 V3 研究；固定比较 48M/64M/80M、Q4/Q8 与 256/512/1024-token 上下文，模型与实验宿主硬上限 96MiB。首期不做插件、授权、商店或支付；未达 +8pp 双 holdout 与 +15% retained characters/opportunity 即停止。详见 `plans/autocomplete-semantic-generation-v3.md`。

## 变更记录

- 2026-08-05：登记下一版本 M9 Completion Engine V2.2；明确当前 RC 不变、公共 decoder 仅 dev/E2E 启用，以及 V3 必须等待 V2 双 final。

- 2026-07-28：登记离线语义短续写 V3 为 Future 研究项目；明确当前里程碑、既有补全路线和停止记录均不变。
