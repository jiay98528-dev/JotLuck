# M0 基准提交 — 变更记录

> 日期: 2026-06-25
> Commit: `cef5965 feat: add official workflow theme chrome`
> 基线: 39 文件, +5057 / -1236 行

## 变更概述

提交 tool (tool 5.5) 已完成的所有主题系统代码，作为重构基线。

## 文件清单

### 新增文件 (17)

| 文件                                                                | 说明                                                                          |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `packages/app/src/types/theme-pack.ts`                              | 主题包类型定义 (ThemePackManifest, ThemeChromeState, ShellAction 等 30+ 类型) |
| `packages/app/src/services/ThemePackInstaller.ts`                   | 主题包安装器 (ZIP 解析, 校验, CSS 安全检查)                                   |
| `packages/app/src/stores/theme.ts`                                  | 主题 Store (useThemeStore: 主题切换, 布局预设, 持久化)                        |
| `packages/app/src/components/theme/ThemeGallery.vue`                | 主题画廊 (设置/欢迎/首页三种变体)                                             |
| `packages/app/src/components/theme/ThemePreviewDrawer.vue`          | 主题预览抽屉 (滑入式侧面板, 展示主题详情)                                     |
| `packages/app/src/components/theme/ThemeEffectLayer.vue`            | 主题特效层 (脉冲线/粒子/呼吸光晕, 四级强度)                                   |
| `packages/app/src/components/editor/EditorControlStrip.vue`         | 编辑器控件条 (toolbar/writing-strip/hidden 三种布局)                          |
| `packages/app/src/components/editor/StudioRail.vue`                 | 生产工具轨 (工坊布局专用侧轨)                                                 |
| `packages/app/src/components/layout/ShellActionButton.vue`          | Shell 动作按钮 (9 种动作 × 多种区域渲染)                                      |
| `packages/app/src/assets/styles/themes/theme-layouts.css`           | 布局预设 CSS (5 种预设的 CSS 变量 + 背景纹理)                                 |
| `packages/app/src/assets/theme-assets/archive-preview.webp`         | 档案馆主题预览图                                                              |
| `packages/app/src/assets/theme-assets/ink-study-bg.webp`            | 墨线书房背景纹理                                                              |
| `packages/app/src/assets/theme-assets/ink-study-preview.webp`       | 墨线书房预览图                                                                |
| `packages/app/src/assets/theme-assets/nocturne-reader-bg.webp`      | 夜读星幕背景纹理                                                              |
| `packages/app/src/assets/theme-assets/nocturne-reader-preview.webp` | 夜读星幕预览图                                                                |
| `packages/app/src/assets/theme-assets/paper-preview.webp`           | 羽翼布局预览图                                                                |
| `packages/app/src/assets/theme-assets/studio-preview.webp`          | 工坊轨道预览图                                                                |
| `packages/app/src/services/__tests__/ThemePackInstaller.test.ts`    | 主题包安装器单元测试 (7 case)                                                 |
| `packages/app/src/stores/__tests__/theme.test.ts`                   | 主题 Store 单元测试 (4 case)                                                  |

### 修改文件 (21)

| 文件                                                    | 变更说明                                                  |
| ------------------------------------------------------- | --------------------------------------------------------- |
| `packages/app/src/services/ThemeRegistry.ts`            | 新增 5 个内置主题定义 + 主题注册表 API                    |
| `packages/app/src/components/layout/AppShell.vue`       | 接收 ThemeChromeState props，驱动区域组件变体             |
| `packages/app/src/components/layout/LeftWing.vue`       | 新增 mode/layout props，支持 4 种左翼变体                 |
| `packages/app/src/components/layout/RightWing.vue`      | 新增 policy/sections props                                |
| `packages/app/src/components/editor/TopBar.vue`         | 新增 layout prop，支持 5 种顶栏变体                       |
| `packages/app/src/components/editor/StatusBar.vue`      | 新增 layout/density props，支持 4 种状态栏变体            |
| `packages/app/src/components/editor/FormatToolbar.vue`  | 适配 density prop                                         |
| `packages/app/src/components/modals/SettingsDialog.vue` | 新增"主题"tab (画廊 + 导入 + 市场占位)                    |
| `packages/app/src/pages/NotebookHome.vue`               | 集成主题系统 (ShellAction[], StudioRail, workflow canvas) |
| `packages/app/src/pages/WelcomePage.vue`                | 新增 Step 3 主题选择步骤                                  |
| `packages/app/src/types/index.ts`                       | 导出主题类型                                              |
| `packages/app/src/assets/styles/editor.css`             | 适配主题变量                                              |
| `e2e/tests/18-theme-packs.spec.ts`                      | 主题包 E2E 测试                                           |
| `spec/frontend/components.md`                           | 更新组件 Props 定义                                       |
| `spec/frontend/design-system.md`                        | 更新设计 Token 定义                                       |
| `spec/frontend/theme-packs.md`                          | 主题包架构规格                                            |
| `doc/PRD.md`                                            | 更新 PRD 主题相关内容                                     |
| `doc/TAD.md`                                            | 更新架构文档                                              |

## L1 验证状态

| 检查项                     |  状态   |
| -------------------------- | :-----: |
| `vue-tsc --noEmit`         | ✅ PASS |
| `eslint`                   | ✅ PASS |
| `prettier --check`         | ✅ PASS |
| 主题相关单元测试 (11 case) | ✅ PASS |

## 已知问题

1. 26 个非主题测试文件失败 (DOMPurify mock + renderer 路径问题，预先存在)
2. stylelint 缺少 `stylelint-config-standard` 依赖 (配置问题，非代码问题)
3. 主题导入入口在 release 构建中被 `import.meta.env.DEV` 隐藏 (符合当前规格)
