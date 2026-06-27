# MarkLuck TAD

## UX Theme Runtime v2（当前权威）

- `ThemeRegistry` 聚合官方模块、本地市场 catalog 与已安装 `.mltheme` 包。
- `ThemeManifest v2` 声明 runtime、capabilities、permissions、entrypoints、slots、assets、checksums 与 minAppVersion。
- `useThemeStore` 管理 `installedThemes`、`activeThemeId`、`previewThemeId`、安装、卸载、启用、回退和持久化。
- `declarative` 主题通过 `UxComponentRecipe` DSL 控制 Shell UX，不执行任意代码。
- `official-code` 与授权后的 `trusted-code` 主题可通过 `ThemeHostApi` 注册受控 Shell 插槽组件。
- 网络、文件系统读写、搜索索引、Markdown 安全清洗、导出服务和系统 API 不向主题默认开放。

版本：2026-06-26

## 总体架构

```text
Vue 3 + Pinia + Vite
  ├─ AppShell / NotebookHome / WelcomePage
  ├─ MarkdownEditor / Live Preview / Search / Export
  ├─ useThemeStore (hot-pluggable UX theme state)
  └─ MockFS / Tauri FS adapters
```

## 单一布局实现

- `packages/app/src/themes/paper/*` 是唯一保留的官方布局模块。
- `packages/app/src/themes/registry.ts` 仅注册 `paper`。
- `packages/app/src/stores/theme.ts` 仅负责初始化和应用羽翼布局。
- `<html>` 上保留 `data-theme-id`、`data-active-theme-id`、`data-theme-runtime`、`data-layout-preset`、`data-chrome-*`、`data-*-layout` 属性作为热插拔主题运行态观测点。

## 布局数据流

1. `NotebookHome` 在挂载时调用 `theme.init()`
2. `useThemeStore` 读取唯一内置模块 `paper`
3. `ThemeChromeState` 由 `paper.recipe` 直接推导
4. `AppShell` 将 chrome 状态拆分为 region 对象传给 TopBar、LeftWing、StatusBar、RightWing、EditorControlStrip
5. `paper.css` 与 `theme-layouts.css` 提供纸面视觉与三栏尺寸变量

## 已移除的外观扩展链路

- 额外官方外观注册
- 外观安装器
- 预览画廊、抽屉与额外视觉层
- 旧配色属性与存储迁移逻辑
