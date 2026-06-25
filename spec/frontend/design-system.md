# MarkLuck Design System

> 版本：v2.0 | 日期：2026-06-17 | 纸张隐喻 + OKLCH 色彩体系
>
> **本文档为导航文档**，指向权威 Token 来源。不复制具体 Token 值——值变更只在代码文件中发生，防止文档腐败。

---

## 1. 权威来源

| 文件                  | 路径                                                      | 内容                                                                   |
| --------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------- |
| **tokens.css**        | `packages/app/src/assets/styles/tokens.css`               | 共享 Token：字体、间距、Z-Index、动效、阴影、布局尺寸                  |
| **paper.css**         | `packages/app/src/assets/styles/themes/paper.css`         | Paper 主题：亮色（暖纸）+ 暗色（深灰卡纸），全部 OKLCH 色值            |
| **theme-layouts.css** | `packages/app/src/assets/styles/themes/theme-layouts.css` | Theme Pack 布局预设与背景/纹章 hooks                                   |
| **accessibility.css** | `packages/app/src/assets/styles/accessibility.css`        | 无障碍：focus-ring、prefers-reduced-motion、prefers-contrast、触控目标 |
| **theme-packs.md**    | `spec/frontend/theme-packs.md`                            | Theme Pack v1 包格式、运行时、安全边界、市场接口预留                   |

**设计决策以这些文件为准。** 本文档仅提供导航速查，不替代阅读代码。

---

## 2. 设计隐喻 — 摊开的书本 (Open Book Metaphor)

**核心隐喻**：一本摊开的书，UI 退后，内容浮现。

- **左页** = 彩色书签栏（目录/索引）
- **中间** = 正文（编辑器/预览）
- **右页** = 批注栏（参考/反向链接/面板）

**美学参照**：日本和纸（washi）的暖调肌理 + iA Writer 的极致专注感。暖调米白底，墨色文字，单一冷调强调色。

---

## 3. 色彩系统

### 3.1 色彩空间：纯 OKLCH

禁止使用 hex、rgb、hsl。所有颜色以 `oklch(L C H)` 或 `oklch(L C H / alpha)` 形式定义。stylelint `color-no-hex` 规则强制执行。

### 3.2 三区纸面温度

| 区域             | Light 色温偏移 | 语义               |
| ---------------- | :------------: | ------------------ |
| 左翼（书签栏）   |     +3° 暖     | 引导、索引、归属感 |
| 中央（编辑器）   |      中性      | 专注、无干扰       |
| 右翼（参考面板） |    -3° 偏绿    | 冷静、分析、参考   |

### 3.3 语义 Token 速查 — 亮色

#### 纸面层级（Paper Surfaces）

| Token             | 用途                 | 权威来源  |
| ----------------- | -------------------- | :-------: |
| `--paper-bg`      | 页面底层背景         | paper.css |
| `--paper-left`    | 左翼书签栏背景       | paper.css |
| `--paper-surface` | 主内容区/面板背景    | paper.css |
| `--paper-right`   | 右翼参考面板背景     | paper.css |
| `--paper-raised`  | 浮层/卡片/对话框背景 | paper.css |

#### 墨色层级（Ink Hierarchy）

| Token             | 用途                 | 权威来源  |
| ----------------- | -------------------- | :-------: |
| `--ink-primary`   | 正文、标题、主要内容 | paper.css |
| `--ink-secondary` | 辅助文字、描述、标签 | paper.css |
| `--ink-muted`     | 占位符、禁用态、水印 | paper.css |

#### 强调色（Accent）

| Token            | 用途                         | 权威来源  |
| ---------------- | ---------------------------- | :-------: |
| `--accent`       | 链接、按钮、选中态、焦点环   | paper.css |
| `--accent-hover` | 悬停加深                     | paper.css |
| `--accent-soft`  | 弱强调背景（选中行、标签底） | paper.css |
| `--accent-ring`  | 焦点环半透明                 | paper.css |

#### 分隔线（Rules）

| Token           | 用途                   | 权威来源  |
| --------------- | ---------------------- | :-------: |
| `--rule`        | 一般分隔线             | paper.css |
| `--rule-strong` | 强调分隔（如面板边界） | paper.css |
| `--rule-wing`   | 翼栏内部分隔           | paper.css |

#### 语义信号（Signals）

| Token                   | 用途               | 权威来源  |
| ----------------------- | ------------------ | :-------: |
| `--signal-success`      | 保存成功、操作完成 | paper.css |
| `--signal-success-soft` | 成功背景（淡色）   | paper.css |
| `--signal-warning`      | 警告、未保存       | paper.css |
| `--signal-warning-soft` | 警告背景（淡色）   | paper.css |
| `--signal-error`        | 错误、删除确认     | paper.css |
| `--signal-error-hover`  | 错误按钮悬停       | paper.css |
| `--signal-error-soft`   | 错误背景（淡色）   | paper.css |

#### 代码块（Code）

| Token             | 用途           | 权威来源  |
| ----------------- | -------------- | :-------: |
| `--code-bg`       | 行内代码背景   | paper.css |
| `--code-text`     | 行内代码文字   | paper.css |
| `--code-block-bg` | 围栏代码块背景 | paper.css |

#### 链接（Links）

| Token            | 用途                               | 权威来源  |
| ---------------- | ---------------------------------- | :-------: |
| `--link`         | 可点击链接                         | paper.css |
| `--link-visited` | 已访问链接                         | paper.css |
| `--link-broken`  | 死链（Wiki-link 指向不存在的笔记） | paper.css |

#### 编辑器（Editor）

| Token                     | 用途            | 权威来源  |
| ------------------------- | --------------- | :-------: |
| `--editor-bg`             | 编辑器画布背景  | paper.css |
| `--editor-cursor`         | 文本光标颜色    | paper.css |
| `--editor-selection`      | 文本选区背景    | paper.css |
| `--editor-gutter`         | 行号/折叠栏颜色 | paper.css |
| `--editor-line-highlight` | 当前行高亮背景  | paper.css |

#### 其他

| Token                     | 用途              | 权威来源  |
| ------------------------- | ----------------- | :-------: |
| `--highlight`             | 搜索高亮/标记背景 | paper.css |
| `--blockquote-rule`       | 引用块左边框      | paper.css |
| `--table-stripe`          | 表格斑马纹        | paper.css |
| `--scrollbar-thumb`       | 滚动条滑块        | paper.css |
| `--scrollbar-thumb-hover` | 滚动条滑块悬停    | paper.css |
| `--overlay`               | 模态/抽屉遮罩背景 | paper.css |

#### 阴影（Shadow）— 亮色

| Token            | 用途                  | 权威来源  |
| ---------------- | --------------------- | :-------: |
| `--shadow-sheet` | 单层纸（微微浮起）    | paper.css |
| `--shadow-stack` | 2-3 张纸叠放          | paper.css |
| `--shadow-float` | 浮层/下拉（明显浮起） | paper.css |

#### 书签圆点色板

| Token     | 颜色 | 权威来源  |
| --------- | ---- | :-------: |
| `--dot-0` | 红   | paper.css |
| `--dot-1` | 橙   | paper.css |
| `--dot-2` | 黄   | paper.css |
| `--dot-3` | 绿   | paper.css |
| `--dot-4` | 青   | paper.css |
| `--dot-5` | 蓝   | paper.css |
| `--dot-6` | 紫   | paper.css |
| `--dot-7` | 粉   | paper.css |

### 3.4 暗色模式

`[data-color-scheme='dark']` 选择器覆盖亮色变量。暗色所有 Token 名称与亮色一致，仅值不同。详见 `paper.css` 暗色区块。

### 3.5 表面状态（Surface States）

定义于 `tokens.css`，不随主题变化：

| Token                | 用途                |
| -------------------- | ------------------- |
| `--surface-hover`    | 悬停叠加层（3% 黑） |
| `--surface-active`   | 按下叠加层（5% 黑） |
| `--surface-selected` | 选中叠加层（6% 黑） |

### 3.6 Theme Pack v1 Hooks

当前主题系统为 Paper 默认主题 + Theme Pack v1 受控主题包。主题切换通过 `<html data-theme-id data-color-scheme data-layout-preset>` 生效。

公开 hooks：

| Token / Attribute       | 用途                                                 |      权威来源       |
| ----------------------- | ---------------------------------------------------- | :-----------------: |
| `data-theme-id`         | 当前主题包 ID                                        |  `stores/theme.ts`  |
| `data-color-scheme`     | `light` / `dark` 色彩方案                            |  `stores/theme.ts`  |
| `data-layout-preset`    | `winged` / `focus` / `archive` / `reader` / `studio` | `theme-layouts.css` |
| `--theme-bg-image`      | 主题背景图或纹理                                     |    `tokens.css`     |
| `--theme-bg-opacity`    | 背景透明度                                           |    `tokens.css`     |
| `--theme-crest-image`   | 纹章/标识背景                                        |    `tokens.css`     |
| `--theme-crest-opacity` | 纹章透明度                                           |    `tokens.css`     |

Theme Pack v1 只接受 `runtime: "css-v1"`，不执行第三方 JS。主题包不得隐藏核心控件、移除焦点环、引用远程资源或通过 CSS 覆盖保存/删除/权限提示。完整规则见 `spec/frontend/theme-packs.md`。

---

## 4. 排版体系

### 4.1 字体栈

| Token       | 栈                                                           | 用途          |
| ----------- | ------------------------------------------------------------ | ------------- |
| `--ff-body` | system-ui → PingFang SC → Microsoft YaHei → Noto Sans CJK SC | 正文、UI 全局 |
| `--ff-mono` | Cascadia Code → Fira Code → JetBrains Mono → Consolas        | 代码、等宽    |

### 4.2 字号层级 (Type Scale — 1.25 Major Third)

| Token         | 用途                    |
| ------------- | ----------------------- |
| `--text-xs`   | 按键提示、快捷键        |
| `--text-sm`   | 右翼面板、工具提示      |
| `--text-base` | 编辑器正文（基准 1rem） |
| `--text-lg`   | 面板标题                |
| `--text-xl`   | 对话框标题              |
| `--text-2xl`  | 页面标题                |
| `--text-hero` | 空状态大标题            |

### 4.3 字重

| Token           | 用途       |
| --------------- | ---------- |
| `--fw-normal`   | 正文       |
| `--fw-medium`   | 标签、按钮 |
| `--fw-semibold` | 小标题     |
| `--fw-bold`     | 标题       |

### 4.4 行高

| Token          | 用途           |
| -------------- | -------------- |
| `--lh-body`    | 正文阅读行高   |
| `--lh-ui`      | 面板列表、按钮 |
| `--lh-heading` | 标题           |
| `--lh-code`    | 代码块         |
| `--lh-none`    | 图标、单行     |

### 4.5 字间距

| Token         | 用途          |
| ------------- | ------------- |
| `--ls-tight`  | 标题紧凑      |
| `--ls-normal` | 正文          |
| `--ls-wide`   | 标签/小写扩展 |

---

## 5. 间距体系 — 4px 栅格

所有间距为 4 的整数倍，Token 命名即像素值。

| Token         | px  | 典型用途           |
| ------------- | :-: | ------------------ |
| `--space-0`   |  0  | 无间距             |
| `--space-4`   |  4  | 图标与文字间距     |
| `--space-8`   |  8  | 紧凑内边距         |
| `--space-12`  | 12  | 列表项间距         |
| `--space-16`  | 16  | 标准内边距         |
| `--space-20`  | 20  | 面板内边距         |
| `--space-24`  | 24  | 区块间距           |
| `--space-32`  | 32  | 大区块间距         |
| `--space-40`  | 40  | 页面级间距         |
| `--space-48`  | 48  | 对话框内边距       |
| `--space-64`  | 64  | 页面顶部留白       |
| `--space-96`  | 96  | 空状态留白         |
| `--space-120` | 120 | 编辑器顶部呼吸空间 |

---

## 6. 布局尺寸

| Token                | 用途                 |
| -------------------- | -------------------- |
| `--wing-left-width`  | 左翼书签栏宽度       |
| `--wing-right-width` | 右翼参考面板默认宽度 |
| `--wing-right-min`   | 右翼面板最小宽度     |
| `--wing-right-max`   | 右翼面板最大宽度     |
| `--editor-max-width` | 编辑器内容最大行宽   |
| `--editor-top-pad`   | 编辑器顶部呼吸留白   |
| `--statusbar-height` | 状态栏高度           |
| `--topbar-height`    | 顶部工具栏高度       |
| `--palette-width`    | 命令面板宽度         |
| `--drawer-width`     | 文件抽屉宽度         |

---

## 7. Z-Index 层级

| Token         | 层级 | 用途                            |
| ------------- | :--: | ------------------------------- |
| `--z-base`    |  0   | 默认内容层                      |
| `--z-wing`    | 100  | 左右翼栏（固定定位）            |
| `--z-overlay` | 400  | 局部覆盖层（tooltip、右键菜单） |
| `--z-drawer`  | 500  | 侧边抽屉                        |
| `--z-palette` | 700  | 命令面板（Ctrl+K）              |
| `--z-modal`   | 800  | 模态对话框（导出、模板）        |
| `--z-toast`   | 1000 | Toast 通知                      |

---

## 8. 圆角体系

| Token           | 用途                     |
| --------------- | ------------------------ |
| `--radius-sm`   | 紧凑控件：分段按钮、徽章 |
| `--radius`      | 通用圆角（6px）          |
| `--radius-md`   | 默认：按钮、输入框、卡片 |
| `--radius-lg`   | 面板、对话框             |
| `--radius-full` | 胶囊/圆形（头像、标签）  |

---

## 9. 边框

| Token             | 用途            |
| ----------------- | --------------- |
| `--border-thin`   | 细线分隔（1px） |
| `--border-medium` | 强调边框（2px） |

---

## 10. 动效体系 — 纸张物理 (Paper Physics)

### 10.1 缓动曲线

| Token          | 特征         | 用途          |
| -------------- | ------------ | ------------- |
| `--ease-press` | 快速减速     | 按钮按下      |
| `--ease-back`  | 微小过冲回弹 | 进入动画收尾  |
| `--ease-fold`  | 纸张折叠感   | 面板展开/折叠 |
| `--ease-enter` | 平滑到达     | 元素入场      |
| `--ease-exit`  | 加速离开     | 元素退场      |
| `--ease-fade`  | 纯透明度     | 淡入淡出      |

### 10.2 三层时长体系

#### Tier 1 — Tactile（触觉层，80-200ms）

即时反馈，无缝感知。

| Token                  | 典型用途                       |
| ---------------------- | ------------------------------ |
| `--dur-press`          | 按钮按下                       |
| `--dur-release`        | 按钮弹起                       |
| `--dur-micro`          | 微交互（hover 切换、图标变化） |
| `--dur-active-press`   | 鼠标按下压入                   |
| `--dur-active-release` | 鼠标释放弹回                   |

#### Tier 2 — Spatial（空间层，250-400ms）

面板展开、页面过渡，有意感知。

| Token                | 典型用途      |
| -------------------- | ------------- |
| `--dur-expand`       | 面板展开      |
| `--dur-collapse`     | 面板折叠      |
| `--dur-drawer`       | 抽屉滑入/滑出 |
| `--dur-palette`      | 命令面板出现  |
| `--dur-page`         | 页面切换      |
| `--dur-hover-lift`   | 悬停浮起      |
| `--dur-hover-settle` | 悬停归位      |

#### Tier 3 — Ambient（氛围层，1.5-3s）

骨架屏、呼吸灯，提供系统活性感知。

| Token           | 典型用途   |
| --------------- | ---------- |
| `--dur-shimmer` | 骨架屏闪烁 |
| `--dur-breathe` | 焦点呼吸   |
| `--dur-ripple`  | 涟漪扩散   |

### 10.3 交错延迟

| Token                | 用途                 |
| -------------------- | -------------------- |
| `--stagger-dot`      | 书签圆点逐次入场     |
| `--stagger-item`     | 列表项逐次入场       |
| `--stagger-entrance` | 面板内部元素级联入场 |

### 10.4 羽翼变换（Winged Transform）

| Token           | 效果                   |
| --------------- | ---------------------- |
| `--lift-hover`  | 悬停时向上浮起 1px     |
| `--lift-active` | 按下时缩回并缩放至 96% |

---

## 11. 阴影体系

### 11.1 基础阴影（Paper Stack）

定义于 `tokens.css`（亮色值在 `paper.css` 中被覆盖）：

| Token            | 隐喻     | 用途         |
| ---------------- | -------- | ------------ |
| `--shadow-none`  | 无阴影   | 平面元素     |
| `--shadow-sheet` | 单张纸   | 卡片微微浮起 |
| `--shadow-stack` | 2-3 张纸 | 下拉菜单     |
| `--shadow-float` | 一叠纸   | 模态框、浮层 |

### 11.2 羽翼多层阴影（Winged Feathered）

多层面阴影（border + 3-4 层扩散），模拟羽毛层叠的柔和感：

| Token                 | 层数 | 用途             |
| --------------------- | :--: | ---------------- |
| `--shadow-wing-sheet` | 3 层 | 翼栏卡片         |
| `--shadow-wing-stack` | 3 层 | 浮起面板         |
| `--shadow-wing-float` | 4 层 | 对话框、命令面板 |

---

## 12. 无障碍

### 12.1 焦点指示器

- 默认移除浏览器 `outline`
- `:focus-visible` 时使用 `--accent` 色焦点环
- 宽度：`--focus-ring-width`，偏移：`--focus-ring-offset`

### 12.2 减少动效

`prefers-reduced-motion: reduce` 时：所有动画时长截断为 0.01ms，保持 1 次迭代。

### 12.3 高对比度

`prefers-contrast: high` 时：墨色加深至纯黑/深灰，强调色饱和度提高。

### 12.4 触控目标

`pointer: coarse` 时：书签圆点最小触控区域扩大至 44x44px（WCAG 2.5.5 标准）。

---

## 13. 图标尺寸

| Token       | 用途               |
| ----------- | ------------------ |
| `--icon-sm` | 行内图标、状态指示 |
| `--icon-md` | 按钮图标、工具栏   |
| `--icon-lg` | 空状态图标         |
| `--icon-xl` | 大号装饰图标       |

---

## 14. 透明度

| Token                | 用途             |
| -------------------- | ---------------- |
| `--opacity-disabled` | 禁用元素透明度   |
| `--opacity-inactive` | 非活跃元素透明度 |
| `--opacity-overlay`  | 遮罩层透明度     |

---

## 15. 约束规则（强制）

1. **禁止硬编码色值** — 所有颜色必须引用 `paper.css` 或 `tokens.css` 中定义的 CSS 变量。stylelint `color-no-hex` 强制执行。
2. **禁止硬编码间距** — 所有 spacing 必须使用 `--space-*` Token。
3. **禁止硬编码字号** — 必须使用 `--text-*` Token。
4. **禁止硬编码 Z-Index** — 必须使用 `--z-*` Token，不得自创 z-index 值。
5. **动效层级匹配** — 微交互用 Tier 1，面板用 Tier 2，氛围用 Tier 3，不得混用。
6. **暗色必须与亮色使用相同 Token 名** — 主题切换完全通过 CSS 变量覆盖实现，禁止为暗色创建独立类名。
7. **`html[data-color-scheme]` 切换** — 明暗色切换通过修改 `<html>` 的 `data-color-scheme` 属性实现；完整主题包同时使用 `data-theme-id` 与 `data-layout-preset`。

---

## 16. 相关文档

| 文档             | 路径                          | 内容                                    |
| ---------------- | ----------------------------- | --------------------------------------- |
| 代码规范 — CSS   | `doc/standards-css.md`        | OKLCH 规范、动效规范、L1 stylelint 配置 |
| 品牌人格         | `PRODUCT.md`                  | 设计哲学、用户画像、反例清单            |
| 组件规格         | `spec/frontend/components.md` | 组件 Props/Events/Slots 定义            |
| 页面规格         | `spec/frontend/pages.md`      | 路由表、页面状态机                      |
| 架构决策 — Paper | `spec/decisions.md` (ADR-009) | 为什么选择纸张隐喻单主题                |
