# MarkLuck 视觉设计规格 (DESIGN.md)

> 版本：v1.0 | 日期：2026-06-03 | 格式：Google Stitch DESIGN.md
> 关联文档：`PRODUCT.md`（品牌人格与设计哲学）、`spec/frontend/design-system.md`（CSS Token 数值）

---

## Visual Theme

### Physical Scene

> 技术写作者在安静的书房，上午十点的自然光从窗户洒入。屏幕上，文字如印刷品般清晰可读。文件树是左侧的立面结构，编辑器是中央的画布，导航树是右侧的索引线。三个功能区域构成一幅稳定的三联画。用户进入心流状态——忘记了工具的存在，只感知到自己的思考在流动。

这定义了 MarkLuck 的视觉基调：**以亮色为主，界面像建筑结构一样安静地支撑内容**。暗色模式作为夜间场景的补充。

### Color Strategy

**Restrained** — 以微染的中性色为主，强调色占比 ≤10%。强调色不为装饰存在，只为功能信号服务：选中态、语法标记、操作提示。

色调随功能区域变化，形成隐性的空间色彩导航：

| 区域           | 色调             | 心理暗示         |
| -------------- | ---------------- | ---------------- |
| 文件树（左侧） | 微冷（石板灰）   | 安静、浏览、结构 |
| 编辑器（中央） | 微暖（纸白）     | 聚焦、阅读、书写 |
| 导航树（右侧） | 微冷（鼠尾草绿） | 概览、定位、层次 |
| 搜索面板       | 蓝调             | 查询、探索、精准 |
| 工具栏         | 暖灰强调         | 行动、控制、自信 |

### Theme Architecture

MarkLuck 预装两套主题，通过 CSS 自定义属性切换。预留模块化皮肤扩展接口。

---

## Theme A: 构成主义 (Constructivism)

### 设计意图

将功能分区化为几何构成元素。文件树是垂直结构线，工具栏是水平节奏线，编辑器是中央留白。硬朗的直角、克制的阴影、暴露的结构——不掩饰界面的"建筑骨架"，因为骨架本身就是装饰。

### 色彩

```css
/* ===== 构成主义 · 亮色主题 ===== */
:root[data-theme='construct-light'] {
  /* 基础面 */
  --clr-bg: oklch(0.98 0.002 250); /* 纸白，微蓝染 */
  --clr-surface: oklch(0.995 0 0); /* 内容卡片面 */
  --clr-surface-raised: oklch(1 0 0); /* 浮层面 */
  --clr-border: oklch(0.88 0.003 250); /* 结构线 */
  --clr-border-strong: oklch(0.75 0.005 250); /* 强调结构线 */

  /* 文字 */
  --clr-text-primary: oklch(0.18 0.005 260); /* 正文，非纯黑 */
  --clr-text-secondary: oklch(0.45 0.005 260); /* 辅助文字 */
  --clr-text-muted: oklch(0.65 0.003 260); /* 占位/失效 */

  /* 功能强调色 — 仅用于功能信号 */
  --clr-accent: oklch(0.55 0.12 255); /* 选中/激活，蓝 */
  --clr-accent-soft: oklch(0.92 0.02 255); /* 选中背景 */
  --clr-success: oklch(0.58 0.14 160); /* 有效语法块 */
  --clr-warning: oklch(0.65 0.15 80); /* 警告 */
  --clr-error: oklch(0.52 0.18 25); /* 错误/死链 */

  /* 区域色调 — 空间色彩导航 */
  --clr-zone-sidebar: oklch(0.96 0.004 240); /* 文件树：微冷 */
  --clr-zone-editor: oklch(0.995 0.003 90); /* 编辑器：微暖 */
  --clr-zone-navtree: oklch(0.96 0.006 170); /* 导航树：微绿 */
  --clr-zone-toolbar: oklch(0.93 0.004 260); /* 工具栏：中性强调 */
  --clr-zone-search: oklch(0.94 0.01 250); /* 搜索：蓝调 */

  /* 几何强调 — 构成主义特有 */
  --clr-geo-accent: oklch(0.52 0.12 255); /* 几何标记色 */
  --clr-shadow-hard: oklch(0.15 0.005 260); /* 硬阴影色 */
  --clr-divider: oklch(0.82 0.005 250); /* 结构分割线 */

  /* 阴影 — 克制但明确 */
  --shadow-card: 4px 4px 0 oklch(0.15 0.005 260 / 0.08);
  --shadow-dropdown: 6px 6px 0 oklch(0.15 0.005 260 / 0.12);
  --shadow-modal: 8px 8px 0 oklch(0.15 0.005 260 / 0.16);
}
```

### 几何规则

| 属性         | 值                        | 理由                             |
| ------------ | ------------------------- | -------------------------------- |
| 主圆角       | `0px`（直角）             | 构成主义的诚实——结构线不应被柔化 |
| 功能按钮     | `2px`（微圆角）           | 交互元素需要与纯结构区分         |
| 文件树激活项 | `0px` 左侧 + `3px` 实色条 | 几何标记替代传统高亮背景         |
| 标题装饰     | 无装饰线，纯字重对比      | 字体本身就是结构                 |
| 分割线       | `1px solid` 可见结构线    | 区的边界即构成元素               |
| 标签         | `2px`，实色填充           | 小型几何色块                     |

### 构成手法

1. **暴露网格** — 编辑区可选显示 4px 辅助网格（`Ctrl+G` 切换），让用户感知到底层的数学秩序
2. **硬阴影 = 功能分层** — 浮层（对话框、下拉菜单）使用硬偏移阴影而非模糊阴影。阴影的偏移量（4px→6px→8px）对应层级深度
3. **色条标记** — 选中/激活态使用左侧 3px 实色条标记，而非填充整个背景。Gmail、Linear 同款手法，但更几何化
4. **结构线可见** — 区域之间保留 1px 可见分割线。不隐藏结构，因为结构就是装饰
5. **工具栏 = 水平色条** — 工具栏底部用 2px 强调色线收束，形成水平方向的视觉锚点

---

## Theme B: 发光磨玻璃 (Luminous Frosted Glass)

### 设计意图

同一套功能分区，换一种视觉语言：半透明面板、微妙模糊、柔和光晕。玻璃不是装饰——它让层级关系通过透明度自然呈现。背景内容透过玻璃若隐若现，创造空间深度的感知。光晕随功能区域变化色温，形成隐性的空间色彩导航。

### 色彩

```css
/* ===== 发光磨玻璃 · 亮色主题 ===== */
:root[data-theme='glass-light'] {
  /* 基础面 — 无玻璃区域 */
  --clr-bg: oklch(0.97 0.003 250); /* 画布背景 */
  --clr-bg-radial: oklch(0.94 0.02 260); /* 背景光晕中心色 */

  /* 玻璃面板 — 核心材质 */
  --glass-bg: oklch(0.995 0.001 260 / 0.72);
  --glass-blur: 12px;
  --glass-saturate: 140%;
  --glass-border: oklch(0.92 0.003 260 / 0.6);
  --glass-shadow: 0 2px 16px oklch(0.15 0.005 260 / 0.06);

  /* 玻璃浮层 — 更高层级 */
  --glass-raised-bg: oklch(0.995 0.001 260 / 0.85);
  --glass-raised-blur: 20px;
  --glass-raised-shadow: 0 4px 24px oklch(0.15 0.005 260 / 0.1);

  /* 文字 */
  --clr-text-primary: oklch(0.18 0.005 260);
  --clr-text-secondary: oklch(0.45 0.005 260);
  --clr-text-muted: oklch(0.62 0.003 260);

  /* 功能强调色 — 柔和版 */
  --clr-accent: oklch(0.55 0.1 250); /* 蓝，略降彩度 */
  --clr-accent-soft: oklch(0.9 0.03 250);
  --clr-success: oklch(0.56 0.12 158);
  --clr-warning: oklch(0.63 0.13 80);
  --clr-error: oklch(0.5 0.16 25);

  /* 光晕 — 区域功能性颜色 */
  --glow-sidebar: oklch(0.5 0.04 240 / 0.08); /* 文件树：冷蓝光 */
  --glow-editor: oklch(0.55 0.06 80 / 0.06); /* 编辑器：暖琥珀光 */
  --glow-navtree: oklch(0.48 0.06 170 / 0.06); /* 导航树：鼠尾草绿光 */
  --glow-search: oklch(0.5 0.08 250 / 0.1); /* 搜索：蓝光 */
  --glow-toolbar: oklch(0.52 0.03 260 / 0.05); /* 工具栏：微光 */

  /* 表面色 — 玻璃面板上的元素 */
  --clr-surface: oklch(0.99 0.001 260 / 0.4);
  --clr-border: oklch(0.88 0.003 250 / 0.5);
  --clr-border-strong: oklch(0.78 0.005 250 / 0.6);
}
```

### 玻璃层级

```
┌──────────────────────────────┐
│  Modal / Dialog              │  glass-raised: blur 20px, bg 0.85
│  ┌────────────────────────┐  │
│  │ Dropdown / Popover     │  │  glass-raised: blur 16px, bg 0.80
│  │  ┌──────────────────┐  │  │
│  │  │ Sidebar / Panel   │  │  │  glass: blur 12px, bg 0.72
│  │  │  ┌─────────────┐  │  │  │
│  │  │  │ Content Area │  │  │  │  no glass (solid bg)
│  │  │  └─────────────┘  │  │  │
│  │  └──────────────────┘  │  │
│  └────────────────────────┘  │
└──────────────────────────────┘
```

### 光晕系统

光晕不是叠加的装饰层——它是区域功能的自然延伸。每个功能区域在背景上投射与其色温匹配的柔和光晕：

```css
/* 光晕通过 radial-gradient 在区域边缘实现 */
.glow-zone-sidebar {
  background:
    radial-gradient(ellipse at 0% 50%, var(--glow-sidebar), transparent 70%), var(--clr-bg);
}

.glow-zone-editor {
  background:
    radial-gradient(ellipse at 50% 50%, var(--glow-editor), transparent 60%), var(--clr-bg);
}
```

**光晕规则**：

- 光晕是静态的（不脉冲、不呼吸），维持安静氛围
- 光晕从不覆盖文字区域（通过 z-index 确保文字在光晕之上）
- 光晕强度在暗色模式下可适当提高 20%（暗背景下光晕更可见）
- 尊重 `prefers-reduced-transparency`

---

## 双主题共享设计规范

以下规范跨主题适用。

### Typography

```css
--ff-body:
  -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei',
  'Hiragino Sans GB', 'Noto Sans CJK SC', sans-serif;
--ff-mono:
  'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'SF Mono', 'Source Code Pro', 'Consolas',
  monospace;
--ff-display: var(--ff-body); /* 无 Display 字体，保持轻量 */
```

**字阶**（≥1.25 比例递进）：

| Token       | Size | Line Height | Usage                    |
| ----------- | ---- | :---------: | ------------------------ |
| `text-xs`   | 12px |     1.4     | 标注、状态栏、快捷键提示 |
| `text-sm`   | 14px |     1.5     | 文件树、辅助信息         |
| `text-base` | 16px |     1.6     | 正文（编辑器内容）       |
| `text-lg`   | 20px |     1.5     | 小标题 H4-H6、面板标题   |
| `text-xl`   | 25px |     1.4     | 标题 H3                  |
| `text-2xl`  | 32px |     1.3     | 标题 H2                  |
| `text-3xl`  | 40px |     1.2     | 标题 H1                  |

**字重**：400（正文）、500（强调）、600（标题）、700（H1）。仅两级字重差异（regular + bold），避免多余变体。

**行长**：编辑器正文 ≤ 75ch，阅读舒适。

### Layout & Composition

#### 三联画结构（桌面端）

```
┌──────────┬──────────────────────┬──────────┐
│          │                      │          │
│ 文件树    │      编辑器           │  导航树   │
│ 260px    │      flex 1          │  240px   │
│ 微冷区   │      微暖区           │  微绿区   │
│          │                      │          │
│  ┌────┐  │  ┌────────────────┐  │  ┌────┐  │
│  │结构│  │  │    画布        │  │  │索引│  │
│  │立面│  │  │                │  │  │线条│  │
│  └────┘  │  └────────────────┘  │  └────┘  │
└──────────┴──────────────────────┴──────────┘
```

**设计意图**：三联画（triptych）是经典构图形式。三个面板不是平等的——编辑器是主角，文件树和导航树是左右配衬。宽度比 260:flex:240 形成微妙的不对称，避免呆板的对称均分。

#### 功能即装饰的布局规则

| 原则                     | 应用                                                                  |
| ------------------------ | --------------------------------------------------------------------- |
| **结构线可见**           | 面板之间保留 1px 边框或玻璃边界。这是构图的线，不是应该隐藏的缝       |
| **区域色温区分**         | 三个面板的底色微差。不是"一眼可见的区别"，而是"潜意识感知的差异"      |
| **工具栏 = 水平锚线**    | 工具栏下方 2px 色条是水平方向的唯一强调，形成视觉水平线               |
| **留白 = 呼吸**          | 编辑器两侧保留充足的留白（不少于 40px）。留白不是浪费，是构图的负空间 |
| **不对称为主，对称为辅** | 三联画整体不对称（260 vs 240），但每个面板内部严格对齐                |

#### 间距节奏

基于 4px 栅格，但避免"每处间距都相同"的单调：

```
紧凑区（文件树、面板内）：4px / 8px / 12px
标准区（编辑器内边距）：16px / 20px / 24px
呼吸区（面板之间、留白）：32px / 40px / 48px / 64px
```

#### 移动端适配

```
┌───────────────┐
│ ☰  工具栏  🔍 │  ← 顶栏（44px 触控高度）
├───────────────┤
│  编辑器区域    │
│  (全宽)       │
│               │
└───────────────┘

文件树 → 左侧滑出抽屉
导航树 → 右侧滑出抽屉
```

### Component Design Language

#### 按钮

```
构成主义：
  [ 按钮文字 ]          ← 直角，1px 边框，hover 时硬阴影偏移
  ┌──────────┐
  │ 按钮文字 │          ← 主要操作：实色填充 + 2px 直角
  └──────────┘

磨玻璃：
  [ 按钮文字 ]          ← 微圆角(4px)，半透明背景，hover 时模糊增强
  ( 按钮文字 )          ← 主要操作：玻璃填充 + 光晕边框
```

- 所有按钮有明确的 hover / active / disabled / focus 四态
- Focus ring：`2px solid` 强调色，偏移 `2px`。不使用浏览器默认 outline

#### 选中态

```
构成主义：左 3px 色条 + 微背景染
  ▐ 选中项                               ← 几何标记

磨玻璃：玻璃加深 + 光晕增强
  ┌──────────────────────────┐
  │ 选中项                     │           ← 玻璃不透明度加深
  └──────────────────────────┘
```

#### 语法块标记（编辑器内）

这是"功能即装饰"的典范应用。不引入装饰元素——标记就是语法块状态的直接表达：

```
蓝色圆点 ●  = 源码模式（可编辑语法）
绿色圆点 ●  = 渲染模式（显示富文本）
红色圆点 ●  = 语法失效（需要修复）
灰色圆点 ●  = 纯文本（无格式）
```

标记点不是装饰——它是语法状态的实时仪表盘。颜色+位置的组合使色觉障碍用户也能区分（左侧=源码、右侧=渲染、闪烁=失效）。

### Motion

| 类型     | 时长  | 缓动                           | 用途                     |
| -------- | :---: | ------------------------------ | ------------------------ |
| Micro    | 150ms | `cubic-bezier(0.4, 0, 0.2, 1)` | hover 状态切换、图标变换 |
| Standard | 250ms | `cubic-bezier(0.4, 0, 0.2, 1)` | 面板开关、标签切换       |
| Reveal   | 400ms | `cubic-bezier(0.4, 0, 0.2, 1)` | 模态框进出、页面切换     |
| Press    | 50ms  | `cubic-bezier(0.4, 0, 0.2, 1)` | 按钮按下反馈             |

**动效约束**：

- 不动画 CSS 布局属性（width/height/top/left）。使用 `transform` + `opacity`
- 无弹性（bounce）、无弹跳（spring）。工具不是玩具
- 玻璃主题的模糊值可以微动（面板 hover 时 blur 从 12px → 14px），但控制在 150ms 内
- 所有动效遵循 `prefers-reduced-motion`

### 暗色模式

暗色模式是两个主题的变体，而非独立主题。遵循 impeccable 的暗色规则：

```css
/* 暗色模式通用规则 */
[data-color-scheme='dark'] {
  /* 文字：白色染微冷，非纯白 */
  --clr-text-primary: oklch(0.92 0.003 260);
  --clr-text-secondary: oklch(0.68 0.003 260);

  /* 背景：深灰染微蓝，非纯黑 */
  --clr-bg: oklch(0.16 0.005 260);
  --clr-surface: oklch(0.2 0.005 260);

  /* 强调色：提高明度补偿暗背景 */
  --clr-accent: oklch(0.68 0.14 255);
}
```

暗色模式下构成主义的硬阴影转为微弱亮边，磨玻璃的模糊增强到 16px（暗背景下玻璃更明显）。

---

## Theme Extension Interface

MarkLuck 预装两个主题，同时提供模块化皮肤接口供社区扩展。

### CSS 自定义属性契约

任何第三方皮肤必须提供以下 CSS 变量的完整定义：

```css
:root[data-theme="custom-{name}"] {
  /* === 必须 === */
  --clr-bg, --clr-surface, --clr-surface-raised
  --clr-text-primary, --clr-text-secondary, --clr-text-muted
  --clr-border, --clr-border-strong
  --clr-accent, --clr-accent-soft, --clr-success, --clr-warning, --clr-error
  --clr-zone-sidebar, --clr-zone-editor, --clr-zone-navtree
  --clr-zone-toolbar, --clr-zone-search
  --shadow-card, --shadow-dropdown, --shadow-modal
  --radius-sm, --radius-md, --radius-lg

  /* === 可选（不定义则退化到无效果） === */
  --glass-bg, --glass-blur, --glass-saturate, --glass-border
  --glow-sidebar, --glow-editor, --glow-navtree
  --clr-geo-accent, --clr-shadow-hard, --clr-divider
}
```

### 皮肤结构

```
themes/
├── construct/          ← 构成主义（内置）
│   └── theme.css
├── glass/              ← 发光磨玻璃（内置）
│   └── theme.css
└── community/          ← 社区皮肤目录
    └── {name}.css
```

---

## Design Constraints Checklist

设计审查时逐项对照以下清单。任何一项不满足 → 退回修改。

### 构成主义主题

- [ ] 主面板使用直角（0px radius），不出现 ≥4px 的圆角
- [ ] 硬阴影偏移量遵循 4px→6px→8px 层级
- [ ] 选中态使用左色条标记，非全背景填充
- [ ] 区域之间可见 1px 结构分割线
- [ ] 强调色仅用于功能信号，无装饰性色块
- [ ] 工具栏底部 2px 色条可见
- [ ] 无渐变（拒绝 SaaS 感）

### 磨玻璃主题

- [ ] 面板使用 `backdrop-filter: blur()` + 半透明背景
- [ ] 提供 `@supports` 降级方案（无模糊时的纯色背景）
- [ ] 光晕效果仅用 radial-gradient，不引入额外 DOM 元素
- [ ] 玻璃边框可见但不突兀（`rgba` alpha ≤ 0.6）
- [ ] 视口内玻璃面板 ≤ 3 个（性能约束）
- [ ] 无玻璃动画（不动态改变 blur 值，除 hover 微调外）

### 全局

- [ ] 无 `#000` 或 `#fff`——所有中性色染品牌色微调
- [ ] 正文对比度 ≥ 4.5:1（WCAG AA）
- [ ] 无 `border-left/right > 1px` 作为装饰色条（选中态 3px 标识条除外）
- [ ] 无渐变色文字（`background-clip: text`）
- [ ] 无弹性/弹跳动效
- [ ] 颜色信息不单独承载功能含义（形状+颜色双编码）
- [ ] 4px 栅格对齐检查通过
- [ ] 字阶比例 ≥ 1.25
- [ ] 动效全部使用 `transform` + `opacity`，无 CSS 布局属性动画

### Anti-reference 快速校验

| 如果看到                         | 属于        | 立即修正                   |
| -------------------------------- | ----------- | -------------------------- |
| 蓝白渐变背景                     | SaaS 模板感 | 替换为纯色+区域色温区分    |
| 相同大小的圆角卡片网格           | SaaS 模板感 | 拒绝卡片布局，使用结构分区 |
| 大段灰色底色                     | 企业软件感  | 减少灰色面积，用留白替代   |
| 全黑背景+绿色文字                | 终端极客感  | 暗色模式使用微染色深灰     |
| 无缘由的装饰性渐变色块           | 装饰性设计  | 色块必须有功能含义         |
| `backdrop-filter` 应用到所有面板 | 玻璃滥用    | 仅限浮层面板               |
