# M1 声明式主题模块 — 变更记录

> 日期: 2026-06-25
> Commits: `9e8f6f2`, `3bd55bd`, `3c16e05`
> 变更范围: +789 / -510 行，22 文件

## 变更概述

将 5 个官方主题从 `ThemeRegistry.ts` 内联对象提取到独立模块目录。定义 `OfficialThemeModule`/`ShellRecipe`/`ThemeTokenSet` 接口。
移除 `useThemeStore` 中 ~250 行硬编码映射函数，改为直接从声明式 recipe 读取。

## Commits

### `9e8f6f2` — 类型 + 主题模块 (19 files, +673)

**新增文件 (18):**

| 文件 | 说明 |
|------|------|
| `packages/app/src/types/theme-pack.ts` | 新增 `ShellRecipe`, `ThemeTokenSet`, `ThemeAssetMap`, `OfficialThemeModule` 接口；`InstalledThemePack` 新增 `module?` 字段 |
| `packages/app/src/themes/registry.ts` | 主题模块注册表：聚合 5 个模块，提供 `getAllThemeModules()` 和 `getThemeModuleById()` |
| `packages/app/src/themes/paper/index.ts` | 羽翼布局模块（baseline, winged, live） |
| `packages/app/src/themes/paper/recipe.ts` | 羽翼布局 ShellRecipe |
| `packages/app/src/themes/paper/tokens.ts` | 空 Token 集（使用默认 paper.css） |
| `packages/app/src/themes/ink-study/index.ts` | 墨线书房模块（collectible, focus, writing） |
| `packages/app/src/themes/ink-study/recipe.ts` | 墨线书房 ShellRecipe |
| `packages/app/src/themes/ink-study/tokens.ts` | OKLCH 色值 + 选择器级 CSS |
| `packages/app/src/themes/ink-study/assets.ts` | 背景图/预览图 import |
| `packages/app/src/themes/archive/index.ts` | 档案馆模块（workflow, archive, split） |
| `packages/app/src/themes/archive/recipe.ts` | 档案馆 ShellRecipe |
| `packages/app/src/themes/archive/tokens.ts` | OKLCH 色值 + CSS |
| `packages/app/src/themes/reader-nocturne/index.ts` | 夜读星幕模块（collectible, reader, read） |
| `packages/app/src/themes/reader-nocturne/recipe.ts` | 夜读星幕 ShellRecipe |
| `packages/app/src/themes/reader-nocturne/tokens.ts` | OKLCH 色值 + CSS |
| `packages/app/src/themes/reader-nocturne/assets.ts` | 星幕背景图/预览图 import |
| `packages/app/src/themes/studio/index.ts` | 工坊轨道模块（workflow, studio, split） |
| `packages/app/src/themes/studio/recipe.ts` | 工坊轨道 ShellRecipe |
| `packages/app/src/themes/studio/tokens.ts` | OKLCH 色值 |

### `3bd55bd` — ThemeRegistry 重构 (1 file, +88 / -318)

- 删除内联 `builtInThemes` 数组（~300 行 CSS 字符串 + `createBuiltInTheme()` 函数）
- 新增 `moduleToBuiltInPack()` — 将 `OfficialThemeModule` 转换为 `InstalledThemePack`
- 新增 `buildThemeCss()` — 将结构化 `ThemeTokenSet` 编译为 CSS 字符串
- 新增 `buildAllBuiltInPacks()` — 遍历 id 顺序，查找模块，构建 packs
- 所有持久化/查询函数（`listThemePacks`, `findThemePack`, `loadInstalledThemePacks` 等）保持不变

### `3c16e05` — Store 重构 (1 file, +28 / -192)

- 删除 14 个硬编码映射函数（~250 行）：
  `chromeStateFromOfficialProfile`, `workspaceIntentFor`, `defaultViewModeFor`,
  `topBarLayoutFor`, `leftWingLayoutFor`, `editorControlLayoutFor`, `statusLayoutFor`,
  `rightWingPolicyFor`, `actionPlacementsFor`, `topBarVariantFor`, `leftWingModeFor`,
  `rightWingModeFor`, `rightWingSectionsFor`, `defaultOpenSectionsFor`
- 替换为 `chromeStateFromPack()`：优先读取 `pack.module.recipe`，否则回退到 `SAFE_LOCAL_CHROME_STATE`
- `ThemeChromeState` 从"运行时计算值"变为"模块声明透传值"

## 关键架构变化

```
Before (M0):
  ThemeRegistry.ts (内联 CSS 字符串)
    → InstalledThemePack
    → useThemeStore.chromeStateFromOfficialProfile(layoutPreset, profile)
    → 14 个映射函数计算 ThemeChromeState
    → AppShell / NotebookHome 消费

After (M1):
  themes/paper/index.ts (OfficialThemeModule)
    ├── recipe.ts   (ShellRecipe — 直接声明所有布局参数)
    ├── tokens.ts   (ThemeTokenSet — 结构化 OKLCH 色值)
    └── assets.ts   (Vite 图片 import)
  
  ThemeRegistry.moduleToBuiltInPack(module, id)
    → InstalledThemePack (带 .module 引用)
    → useThemeStore.chromeStateFromPack(pack)
    → 直接从 pack.module.recipe 读取 → ThemeChromeState
    → AppShell / NotebookHome 消费（行为不变）
```

## L1 验证

| 检查项 | 状态 |
|--------|:---:|
| `vue-tsc --noEmit` | ✅ PASS |
| `eslint` | ✅ PASS |
| `prettier --check` | ✅ PASS |
| 主题单元测试 (11 case) | ✅ 全量 PASS |
