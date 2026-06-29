# CSS Standards

版本：2026-06-27

## 基本原则

1. 使用 `tokens.css`、官方主题 CSS、`theme-layouts.css` 或主题包 manifest 声明的 scoped token。
2. 默认视觉体系为 `paper` / 暖纸方案，但主题包可以通过 `[data-theme-id="<id>"]` 覆盖 token。
3. 不得新增未加主题 scope 的全局配色覆盖；不得用宿主层硬编码 theme id 分支替代 manifest、recipe 或 slot。
4. `.mltheme` 样式通过 ThemeRegistry/ThemePackInstaller 注入，主题作者必须把 CSS 限定在主题作用域内。

## 推荐做法

- 优先使用语义 token：`--paper-*`、`--ink-*`、`--accent-*`、`--rule-*`。
- 布局尺寸使用 `--wing-left-width`、`--wing-right-width`、`--editor-max-width` 等变量。
- 通过 `data-layout-preset` 和 `data-*-layout` 驱动局部布局差异。
- 代码主题需要额外样式时，使用 `[data-theme-id="<id>"] .theme-class` 形式。

## 禁止做法

- 写入宿主级明暗切换。
- 写入未加 scope 的主题全局覆盖。
- 直接引用已删除的旧外观资产。
- 用商业状态改变编辑器、保存、搜索、导出等核心功能的可用性。
