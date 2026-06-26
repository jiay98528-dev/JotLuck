# M2 Shell Recipe 驱动 — 变更记录

> 日期: 2026-06-26
> Commit: `a9911c0`
> 变更范围: +131 / -105 行（`a9911c0`），8 文件；+238 / -105 行（含 `M2 docs` commit），10 文件

## 变更概述

将 AppShell 和所有子组件的布局 Props 从"散字段"统一为"Region 对象"。AppShell 从 ThemeChromeState 计算 Region 对象后传递给子组件，每个区域组件接收单一的 `:region` prop 而非多个独立的 `variant`/`layout`/`mode`/`density` props。

## 变更明细

### 类型层 (`types/theme-pack.ts`)

- 新增 5 个 Region 接口：`TopBarRegion`, `LeftWingRegion`, `EditorControlRegion`, `StatusBarRegion`, `RightWingRegion`
- `ShellRecipe.rightWing` 改为使用 `RightWingRegion`（字段内联 → 引用独立类型）

### 组件层

| 组件                   | 旧 Props                                                               | 新 Props                                                                                              |
| ---------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **AppShell**           | 传递散字段给子组件                                                     | 计算 `topBarRegion`/`leftWingRegion`/`statusBarRegion`/`rightWingRegion` computed，统一传递 `:region` |
| **TopBar**             | `:variant="..." :layout="..."`                                         | `:region="{ variant, layout }"` (TopBarRegion)                                                        |
| **LeftWing**           | `:mode="..." :layout="..."`                                            | `:region="{ mode, layout }"` (LeftWingRegion)                                                         |
| **StatusBar**          | `:density="..." :layout="..."`                                         | `:region="{ layout, density }"` (StatusBarRegion)                                                     |
| **RightWing**          | `:mode="..." :policy="..." :sections="..." :defaultOpenSections="..."` | `:region="{ mode, policy, sections, defaultOpenSections }"` (RightWingRegion)                         |
| **EditorControlStrip** | `:layout="..." :density="..."`                                         | `:region="{ layout, density }"` (EditorControlRegion)                                                 |

### NotebookHome

- 新增 `chrome` computed（`theme.activeChromeState` 别名），减少模板中 `theme.activeChromeState.*` 的冗长链式访问
- `EditorControlStrip` 改为传递 `:region` 对象
- 移除 `applyThemeWorkflowDefaults()` 中的过期 self-assign

## L1+L2 验证

| 检查项             |           结果           |
| ------------------ | :----------------------: |
| `vue-tsc --noEmit` |         ✅ PASS          |
| `eslint`           |         ✅ PASS          |
| `prettier --check` |         ✅ PASS          |
| `vitest run`       | ✅ 167 passed / 11 files |
