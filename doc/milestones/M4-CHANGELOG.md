# M4 文档清理 + L3.5 审计 — 变更记录

> 日期: 2026-06-26
> Commits: `a427f3b`, `949f861`, `4acee45`, 审计修复
> 变更范围: +242 / -258 行，16 文件

## 变更概述

同步所有规格文档，消灭旧 construct/glass 残留。运行 L3.5 独立审计并修复所有发现。

## 文档同步

| 文件                          | 变更                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `doc/standards-css.md`        | 替换 §四（双主题实现）和 §五（玻璃效果规范）为当前 Paper 主题系统描述                        |
| `spec/milestones.md`          | M5 描述从"双主题"更新为"主题系统"                                                            |
| `spec/frontend/pages.md`      | `useThemeStore` 描述更新为 v2 模型（5 官方主题 + ShellRecipe + 声明式模块）                  |
| `spec/frontend/components.md` | TopBar/LeftWing/RightWing/StatusBar/EditorControlStrip Props 从散字段改为统一 `:region` 对象 |
| `spec/progress.md`            | M5 状态更新为已完成 + M1-M4 重构详情                                                         |
| `tool.md`                   | 主题系统说明更新 v2 重构日期                                                                 |

## L3.5 审计结果

**审查文件**: 41 | **发现**: 5（严重 0 / 一般 3 / 建议 2）

| #   | 严重度 | 描述                                           |              判定              |
| --- | :----: | ---------------------------------------------- | :----------------------------: |
| F1  |   🟡   | components.md Props 表未更新为 v2 region 模型  |           ✅ 已修复            |
| F2  |   🟡   | RightWing.vue `@ts-nocheck` 抑制类型检查       | ✅ 已移除 — 修复 HeadingTreeNode 递归类型、补回缺失 import |
| F3  |   🟡   | EditorControlStrip.vue 孤立的 `density` 默认值 |           ✅ 已删除            |
| F4  |   🟢   | 夜读星幕 light/dark token 相同                 |       已知悉（有意为之）       |
| F5  |   🟢   | buildThemeCss 无 CSS 值转义                    | 已知悉（所有值来自 TS 源文件） |

## L1+L2 验证

| 检查项             |           结果           |
| ------------------ | :----------------------: |
| `vue-tsc --noEmit` |         ✅ PASS          |
| `eslint`           |         ✅ PASS          |
| `prettier --check` |         ✅ PASS          |
| `npm run build`    |     ✅ 成功 (3.28s)      |
| `vitest run`       | ✅ 167 passed / 11 files |
