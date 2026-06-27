# Decisions

版本：2026-06-26

## 已确认决策

1. 外观系统采用热插拔 UX 主题架构，默认主题为 `paper` / 羽翼布局。
2. 主题包必须使用 `ThemeManifest v2` 声明 runtime、capabilities、permissions、entrypoints、slots、assets、checksums 与 minAppVersion。
3. 声明式主题优先；官方代码主题和授权可信代码主题可替换受控 Shell 插槽，但只能通过 `ThemeHostApi` 与宿主交互。
4. 网络、文件系统读写、搜索索引、Markdown 安全清洗、导出服务和系统 API 不向主题默认开放。
