# M3 布局深层差异化 — 验证记录

> 日期: 2026-06-26
> 验证范围: 5 个官方主题的 CSS/动效/动作路由/背景资产的端到端一致性
> 变更范围: 0 行代码变更（纯审计 + 构建验证）

## 审计结论

M3 是验证里程碑——确认 M1（声明式模块）+ M2（Shell Recipe 驱动）的架构重组后，5 个主题在所有维度上产生真实可见的 UX 差异。

## 审计维度

### 1. CSS 变量链完整性

| 变量来源                            | 选择器                               | 消费方                                                                                                                                                                                       |
| ----------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tokens.css`                        | 默认值                               | 全局 fallback                                                                                                                                                                                |
| `theme-layouts.css`                 | `[data-layout-preset]` 在 `<html>`   | LeftWing (`--wing-left-width`), RightWing (`--wing-right-width`), TopBar (`--topbar-height`), StatusBar (`--statusbar-height`), FileDrawer (`--drawer-width`), editor (`--editor-max-width`) |
| 主题 token 集（builtThemeCss 注入） | `[data-theme-id][data-color-scheme]` | 全局 `--paper-*`, `--ink-*`, `--accent`, `--radius` 等                                                                                                                                       |

✅ 三层变量的级联链完整，未被 M1/M2 重组织影响。

### 2. 布局预设 CSS

`theme-layouts.css` 5 个 `[data-layout-preset]` 选择器：

- `winged`: 56px/240px/680px — 羽翼布局默认 ✅
- `focus`: 44px/0px/720px — 墨线书房居中写作 ✅
- `archive`: 88px/360px/740px — 档案馆宽面板 ✅
- `reader`: 48px/220px/780px — 夜读星幕宽阅读 ✅
- `studio`: 48px/320px/640px — 工坊轨道紧凑 ✅

### 3. 背景纹理

| 主题     | 纹理类型                                       | 来源                                                       |
| -------- | ---------------------------------------------- | ---------------------------------------------------------- |
| 墨线书房 | 本地 `.webp` 纸纹 + `mix-blend-mode: multiply` | `theme-layouts.css` `[data-theme-id]` → `--theme-bg-image` |
| 夜读星幕 | 本地 `.webp` 星幕 + `mix-blend-mode: screen`   | 同上                                                       |
| 档案馆   | CSS 渐变（横线 + 淡入）                        | 同上                                                       |
| 工坊轨道 | CSS 渐变（竖线网格）                           | 同上                                                       |

✅ 生产构建 (`npm run build`) 中所有背景资产正确内联到输出 CSS。

### 4. NotebookHome Canvas CSS

工作流画布的 `[data-workspace-intent]` 选择器（scoped）：

- `writing`: 居中卡片 + 淡色背景渐变 + 羽翼阴影 ✅
- `archive`: 左侧 accent 渐变背景 ✅
- `studio`: 横向布局 + 左侧边框 + accent 渐变 ✅
- `reader`: 淡化背景透明 ✅

### 5. ThemeEffectLayer

- 脉冲线: `subtle`(0.18), `ambient`(0.34), `immersive`(0.44) ✅
- 粒子: `subtle`(0.08), `ambient`(0.16), `immersive`(0.24) ✅
- 呼吸光晕: `ambient` 和 `immersive` 级别可见 ✅
- `prefers-reduced-motion`: 全局关闭动效 ✅

### 6. actionPlacements

9 个动作在 5 个主题中的路由（通过 ShellRecipe.actionPlacements → ThemeChromeState.actionPlacements → actionRegion() → actionsForRegion()）：

| 主题     | 特色路由                                                                            |
| -------- | ----------------------------------------------------------------------------------- |
| 羽翼布局 | 搜索→topbar-right, 模板→editor-control, 导出→topbar-right                           |
| 墨线书房 | 分享→hidden, 导出→topbar-right, 模板→editor-control                                 |
| 档案馆   | 搜索→topbar-center(居中), 模板→hidden, 新笔记→left-wing                             |
| 夜读星幕 | 新笔记→hidden, 模板→hidden, 设置→topbar-right, 主题切换→hidden, 视图切换→reader-bar |
| 工坊轨道 | 新笔记/文件抽屉/模板/导出/分享→studio-rail, 视图切换→studio-rail                    |

✅ 全部路由由 recipe 声明，无硬编码分支。

## L1+L2 验证

| 检查项             |           结果           |
| ------------------ | :----------------------: |
| `vue-tsc --noEmit` |         ✅ PASS          |
| `eslint`           |         ✅ PASS          |
| `prettier --check` |         ✅ PASS          |
| `npm run build`    |     ✅ 成功 (3.28s)      |
| `vitest run`       | ✅ 167 passed / 11 files |
