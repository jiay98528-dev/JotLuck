# CSS Standards

版本：2026-06-26

## 基本原则

1. 使用 `tokens.css`、官方主题 CSS、`theme-layouts.css` 或主题包 manifest 声明的 scoped token。
2. 默认视觉体系为 `paper` / 暖纸方案，但主题包可以通过 `[data-theme-id="<id>"]` 覆盖 token。
3. 不得新增未加主题 scope 的全局配色覆盖；不得用宿主层硬编码 theme id 分支替代 manifest/recipe。
4. 第三方主题样式必须通过 ThemeRegistry/ThemePackInstaller 校验后注入，并限制在主题作用域内。

## 推荐做法

- 优先使用语义 token：`--paper-*`、`--ink-*`、`--accent-*`、`--rule-*`
- 布局尺寸使用 `--wing-left-width`、`--wing-right-width`、`--editor-max-width`
- 通过 `data-layout-preset="winged"` 和 `data-*-layout` 驱动局部布局差异

## 禁止做法

- 书写已废弃的颜色方案属性
- 书写已废弃的视觉层属性
- 新增旧外观切换类名
- 直接引用已删除的外观资产
