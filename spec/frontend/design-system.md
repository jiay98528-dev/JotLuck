# Frontend Design System

版本：2026-06-27

## 基线

- 默认视觉系统为 `paper` / 羽翼布局。
- 主题系统必须支持 `ThemeManifest v2` 驱动的本地市场、`.mltheme` 导入、安装、预览、启用、卸载和回退。
- 主题 token 必须限定在 `[data-theme-id="<id>"]` 作用域内；代码主题注入样式也必须带主题 scope。
- 主题可以通过 `ThemeSlotBoundary` 接管 Shell、主页、编辑器表面、弹窗和状态层 UX，但不应把核心写作流程变成商业化入口。

## 样式来源

- `packages/app/src/assets/styles/tokens.css`
- `packages/app/src/assets/styles/themes/paper.css`
- `packages/app/src/assets/styles/themes/theme-layouts.css`
- 主题包 manifest 与 scoped CSS

## 运行时属性

- `data-theme-id`
- `data-active-theme-id`
- `data-theme-runtime`
- `data-layout-preset`
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
- 主题中心是产品 UI：状态清晰、按钮一致、错误可恢复、空状态说明下一步。
- 商业状态只作为主题卡片和详情区元信息，不在启动、保存、编辑过程中打断用户。

## 禁止项

- 新增宿主级明暗切换。
- 用硬编码 theme id 分支替代 manifest、recipe 或 slot。
- 未加主题 scope 的全局配色覆盖。
- 启动弹窗式付费提示或保存时商业化打断。
