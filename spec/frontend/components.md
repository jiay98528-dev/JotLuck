# Frontend Components

版本：2026-06-26

## 布局主链

- `AppShell`
- `LeftWing`
- `TopBar`
- `EditorControlStrip`
- `StatusBar`
- `RightWing`

## 约束

- 组件默认接收 `ThemeChromeState` 或对应 region 数据。
- Shell 级组件必须兼容 `ThemeManifest v2`、`ShellRecipe` 与 `UxComponentRecipe` 驱动的热插拔主题。
- 声明式主题可通过 `ThemeRuntimeRenderer` 渲染受控 DSL；官方代码主题和授权可信代码主题可替换受控 Shell 插槽。

## 交互要求

- 设置按钮默认位于左翼底部，也可由主题 action placement 移动到允许区域。
- 主题入口位于 TopBar，打开本地主题中心；不提供宿主级明暗切换。
- 欢迎页与首页空态文案不得假设只有一种主题。
