# Decisions

版本：2026-06-27

## 已确认决策

1. 外观系统采用热插拔 UX Theme Plugin 架构，默认主题为 `paper` / 羽翼布局。
2. 主题包必须使用 `ThemeManifest v2` 声明 runtime、capabilities、permissions、entrypoints、slots、assets、checksums、minAppVersion 和商业化预留字段。
3. 声明式主题通过 DSL 渲染；官方代码主题和本地可信代码主题可通过 `ThemeHostContext` 替换 Shell/主页/弹窗级 UX slot。
4. P0 阶段不做权限审批、沙箱隔离、社区市场审核或远程购买接入。本地主题能力声明不作为安装/启用阻断条件。
5. 商业化通过 `ThemeCommerceProvider` 适配，默认本地 mock。未来接入 Gumroad、Polar 或自建后端时只替换 provider 实现，不改变主题中心和 manifest 结构。
