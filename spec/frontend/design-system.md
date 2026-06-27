# Frontend Design System

版本：2026-06-26

## 基线

- 默认视觉系统：`paper` / 羽翼布局
- 主题系统必须支持 `ThemeManifest v2` 驱动的本地市场、安装、预览、启用和回退。
- 主题 token 必须限定在 `[data-theme-id="<id>"]` 作用域内；代码主题注入样式也必须带主题 scope。
- 声明式主题通过 DSL 控制 Shell UX；官方代码主题和授权可信代码主题可替换受控 Shell 插槽。

## 样式来源

- `packages/app/src/assets/styles/tokens.css`
- `packages/app/src/assets/styles/themes/paper.css`
- `packages/app/src/assets/styles/themes/theme-layouts.css`

## 运行时属性

- `data-theme-id="paper"`
- `data-layout-preset="winged"`
- `data-chrome-topbar`
- `data-chrome-left-wing`
- `data-chrome-right-wing`
- `data-chrome-toolbar`
- `data-chrome-drawer`
- `data-chrome-reading`
- `data-topbar-layout`
- `data-left-wing-layout`
- `data-editor-control-layout`
- `data-status-layout`
- `data-right-wing-policy`
- `data-workspace-intent`

## 视觉原则

- 背景使用暖纸面而非纯白。
- 控件层级通过纸面、边框、阴影和留白区分。
- 不维护额外配色覆盖层。
- 不维护按外观切换的纹理、预览图或额外视觉层。

## 禁止项

- 新增额外配色切换
- 新增第三方外观样式注入
- 依赖已废弃的外观属性
