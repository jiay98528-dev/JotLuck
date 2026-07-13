# CSS Standards

版本：2026-07-11

## 基本原则

1. 使用 `tokens.css`、官方主题 CSS、`theme-layouts.css` 或主题包 manifest 声明的 scoped token。
2. 默认视觉体系为 `paper` / 暖纸方案，但主题包可以通过 `[data-theme-id="<id>"]` 覆盖 token。
3. 不得新增未加主题 scope 的全局配色覆盖；不得用宿主层硬编码 theme id 分支替代 manifest、recipe 或 slot。
4. `.mltheme` 样式通过 ThemeRegistry/ThemePackInstaller 注入，主题作者必须把 CSS 限定在主题作用域内。

## 推荐做法

- 优先使用语义 token：`--paper-*`、`--ink-*`、`--accent-*`、`--rule-*`。
- 布局尺寸使用 `--wing-left-width`、`--wing-right-width`、`--editor-max-width` 等变量。
- 通过 `data-layout-preset` 和 `data-*-layout` 驱动局部布局差异。
- 代码主题需要额外样式时，使用 `[data-theme-id="<id>"] .theme-class` 形式。

## 间距 token 与主题静态样式

- 布局优先使用 4px 主栅格：`--space-0/4/8/12/16/20/24/32/40/48/64/80/96/120`；仅紧凑控件、图标和描边对齐可使用 2px 微调档：`--space-2/6/10/14/18/22/28/36`。
- 不得引用未定义的 `var(--space-*)`。`--space-3` 与 `--space-9` 已废止，分别使用 `--space-4` 与 `--space-8`。未定义 custom property 会让整个 CSS 声明在计算期失效，不能依赖浏览器“部分生效”。
- 修改 token 或新增 spacing 引用后必须运行 `pnpm.cmd lint:tokens`。该检查覆盖 `.css`、`.vue` 和 TypeScript 中的主题 CSS 字符串。
- 官方代码主题的静态 CSS 应放入受 scope 限制的 `.css` 资产，再经 `OfficialThemeModule.css` 注入；不要把大段静态 CSS 隐藏在 TypeScript 模板字符串中，避免脱离 Stylelint 覆盖。
- 主题玻璃材质必须有不支持 `backdrop-filter` 的不透明降级，并为 `prefers-reduced-motion` 和 `forced-colors` 明确关闭或降低特效。
- 液态玻璃主题必须定义环境、chrome、工具组、正文画布的材质高度；不得用多层全屏彩色渐变或“每行一张卡”代替层级。仅使用伪层进行低幅度、低频率的折射动效，不移动控件本体。
- 若宿主内联尺寸需要响应式变体，优先以自定义 property 作为内联值的回退；不得以 `!important` 长期覆盖宿主的桌面尺寸所有权。

## 禁止做法

- 写入宿主级明暗切换。
- 写入未加 scope 的主题全局覆盖。
- 直接引用已删除的旧外观资产。
- 用商业状态改变编辑器、保存、搜索、导出等核心功能的可用性。
- 用无效 spacing token 让 padding、gap、inset 或圆角声明悄然回退。

## 变更记录

- 2026-07-11：新增液态玻璃的材质高度、局部折射与宿主尺寸所有权规则。
- 2026-07-10：新增 4px 布局节奏 + 2px 控件微调规则、token 静态检查与官方主题 CSS 资产化要求。
