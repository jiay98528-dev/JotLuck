# MarkLuck 设计系统 (Design Tokens)

> 版本：v1.0 | 日期：2026-06-03 | 设计流派：极简主义 (Minimalist)
>
> **设计哲学**: 阅读优先 (Reading-Focused)。笔记工具的核心体验是阅读，而非炫技。每一个像素都服务于内容的可读性和长时间使用的眼部舒适度。消除一切不必要的视觉噪音。

---

## 使用规范（强制）

所有 CSS 样式必须通过引用本文档定义的 CSS 自定义属性（design tokens）实现。**禁止**在组件样式中硬编码色值、字号、间距、圆角、阴影、动效时长。

```css
/* ✅ 正确 */
.my-component {
  color: var(--color-text-primary);
  padding: var(--space-16);
  border-radius: var(--radius-medium);
}

/* ❌ 禁止 */
.my-component {
  color: #1a1a1a;
  padding: 16px;
  border-radius: 8px;
}
```

**唯一例外**：`box-shadow` 的 `inset` 变体、SVG `fill`/`stroke`、以及第三方库覆盖时，可用硬编码值，但必须在代码注释中说明原因。

---

## 1. 色彩体系 (Color Palette)

### 1.1 浅色主题 (Light Theme)

```css
:root {
  /* === 背景 === */
  --color-bg: #fafafa; /* 页面底色 — 纸张白，比纯白柔和，长时间阅读不刺眼 */
  --color-bg-elevated: #ffffff; /* 浮层 / 卡片 / 输入框底色 — 纯白，在纸色背景上自然浮现 */
  --color-bg-hover: #f5f5f5; /* 悬停态背景 — 极浅灰，几乎不可见但足以产生交互反馈 */
  --color-bg-active: #ebebeb; /* 按下/选中态背景 — 浅灰，可辨识的激活反馈 */
  --color-bg-overlay: rgba(0, 0, 0, 0.04); /* 遮罩覆盖层 — 极淡遮罩 */

  /* === 文本 === */
  --color-text-primary: #1a1a1a; /* 正文主色 — 接近纯黑但保留 10% 灰度，降低对比度疲劳 */
  --color-text-secondary: #666666; /* 辅助文本 — 描述、元信息、时间戳 */
  --color-text-tertiary: #999999; /* 占位符 / 禁用态文本 — 最低可见但仍可读 */
  --color-text-inverse: #ffffff; /* 深色背景上的反色文本 */

  /* === 边框与分割线 === */
  --color-border: #e0e0e0; /* 默认边框 — 存在但低调，不抢夺内容注意力 */
  --color-border-light: #eeeeee; /* 浅边框 — 分割线、列表项分隔 */
  --color-border-focus: #4a90d9; /* 聚焦边框 — 与主强调色一致 */

  /* === 强调色 (Accent) === */
  --color-accent: #4a90d9; /* 主强调色 — 沉稳的蓝色，传递冷静可靠感，适合长时间注视 */
  --color-accent-hover: #3a7bc8; /* 悬停态 — 加深 10% */
  --color-accent-active: #2d6ab5; /* 按下态 — 加深 20% */
  --color-accent-light: #e8f1fb; /* 浅色强调背景 — 选中项、信息条、标签底色 */
  --color-accent-muted: rgba(74, 144, 217, 0.12); /* 极淡强调 — 行内代码背景等 */

  /* === 语义色 (Semantic Colors) === */
  --color-success: #52c41a; /* 成功 — 绿色，操作确认、保存成功 */
  --color-success-light: #f0fbe8; /* 成功浅底色 */
  --color-warning: #faad14; /* 警告 — 琥珀色，未保存、格式警告 */
  --color-warning-light: #fffbe6; /* 警告浅底色 */
  --color-error: #ff4d4f; /* 错误/危险 — 红色，删除确认、渲染异常 */
  --color-error-light: #fff2f0; /* 错误浅底色 */
  --color-info: #4a90d9; /* 信息 — 与主强调色一致，提示信息 */
  --color-info-light: #e8f1fb; /* 信息浅底色 */

  /* === Block Marker 颜色 (Markdown 源码模式标记块) === */
  /* 源码模式下，编辑区左侧标记块用色条表示当前块的渲染状态 */
  --color-marker-source: #4a90d9; /* 编辑中/源码模式 — 蓝色 */
  --color-marker-render: #52c41a; /* 渲染正常 — 绿色 */
  --color-marker-invalid: #ff4d4f; /* 格式错误 — 红色（如未闭合代码块、语法错误） */

  /* === 特定场景 === */
  --color-link: #4a90d9; /* 超链接色 — 与主强调色一致 */
  --color-link-visited: #8b6bbf; /* 已访问链接 — 淡紫色区分 */
  --color-link-broken: #ff4d4f; /* Wiki-link 死链 — 红色警告 */

  --color-code-bg: #f4f4f5; /* 行内代码背景 */
  --color-code-text: #1a1a1a; /* 行内代码文字 */
  --color-code-block-bg: #f8f8f8; /* 代码块背景 */
  --color-selection: rgba(74, 144, 217, 0.25); /* 文本选中高亮 */

  --color-highlight: #fff3b0; /* 搜索高亮 / Markdown ==highlight== */
  --color-blockquote-border: #e0e0e0; /* 引用块左边框 */
  --color-table-stripe: #fafafa; /* 表格斑马条纹 */
  --color-scrollbar-thumb: #cccccc; /* 滚动条滑块 */
  --color-scrollbar-track: transparent; /* 滚动条轨道 */
}
```

### 1.2 深色主题 (Dark Theme)

```css
[data-theme='dark'] {
  /* === 背景 === */
  --color-bg: #1e1e1e; /* 页面底色 — VS Code 风格深灰 */
  --color-bg-elevated: #262626; /* 浮层 / 卡片 / 输入框底色 */
  --color-bg-hover: #2e2e2e; /* 悬停态背景 */
  --color-bg-active: #383838; /* 按下/选中态背景 */
  --color-bg-overlay: rgba(0, 0, 0, 0.3); /* 遮罩覆盖层 */

  /* === 文本 === */
  --color-text-primary: #e0e0e0; /* 正文主色 — 白中带灰，避免 #FFF 的刺眼 */
  --color-text-secondary: #9e9e9e; /* 辅助文本 */
  --color-text-tertiary: #6e6e6e; /* 占位符 / 禁用态文本 */
  --color-text-inverse: #1a1a1a; /* 浅色背景上的反色文本 */

  /* === 边框与分割线 === */
  --color-border: #3e3e3e; /* 默认边框 */
  --color-border-light: #333333; /* 浅边框 */
  --color-border-focus: #4a90d9; /* 聚焦边框 — 与强调色一致 */

  /* === 强调色 (暗色主题微调) === */
  --color-accent: #5ca0e6; /* 主强调色 — 暗色背景下稍亮 10%，保持对比度 */
  --color-accent-hover: #6eb4f0; /* 悬停态 */
  --color-accent-active: #4a90d9; /* 按下态 */
  --color-accent-light: rgba(92, 160, 230, 0.15); /* 浅色强调背景 */
  --color-accent-muted: rgba(92, 160, 230, 0.08); /* 极淡强调 */

  /* === 语义色 (暗色主题微调) === */
  --color-success: #73d13d; /* 成功 — 暗色下稍亮 */
  --color-success-light: rgba(115, 209, 61, 0.12);
  --color-warning: #ffc53d; /* 警告 — 暗色下稍亮 */
  --color-warning-light: rgba(255, 197, 61, 0.12);
  --color-error: #ff7875; /* 错误 — 暗色下稍亮 */
  --color-error-light: rgba(255, 120, 117, 0.12);
  --color-info: #5ca0e6; /* 信息 */
  --color-info-light: rgba(92, 160, 230, 0.12);

  /* === Block Marker 颜色 === */
  --color-marker-source: #5ca0e6;
  --color-marker-render: #73d13d;
  --color-marker-invalid: #ff7875;

  /* === 特定场景 === */
  --color-link: #5ca0e6;
  --color-link-visited: #b39ddb;
  --color-link-broken: #ff7875;

  --color-code-bg: #2d2d2d;
  --color-code-text: #e0e0e0;
  --color-code-block-bg: #2a2a2a;
  --color-selection: rgba(92, 160, 230, 0.3);

  --color-highlight: rgba(255, 243, 176, 0.3); /* 暗色下高亮用半透明 */
  --color-blockquote-border: #4a4a4a;
  --color-table-stripe: #242424;
  --color-scrollbar-thumb: #555555;
  --color-scrollbar-track: transparent;
}
```

### 1.3 色彩使用原则

1. **背景层次最多三层**: `--color-bg` (底层) → `--color-bg-elevated` (卡片) → `--color-bg-hover`/`--color-bg-active` (交互反馈)。禁止引入第四层背景色。
2. **文本层次最多三层**: `--color-text-primary` (正文) → `--color-text-secondary` (辅助) → `--color-text-tertiary` (禁用/占位符)。同一视图中不应同时出现超过三种文本色。
3. **强调色只用于交互元素**: 链接、按钮、选中态、聚焦环。禁止将强调色用于纯装饰性目的。
4. **语义色传达状态**: 成功/警告/错误/信息四种语义色各有明确用途，禁止混用（如禁止用红色表示成功）。
5. **所有颜色必须通过 `prefers-contrast` 和 `prefers-reduced-transparency` 媒体查询测试**，确保无障碍合规。

---

## 2. 字体系统 (Typography)

### 2.1 字体族 (Font Family)

```css
:root {
  /* === 正文字体栈 (系统字体，零网络加载) === */
  --font-family-base:
    -apple-system, /* macOS / iOS — San Francisco */ BlinkMacSystemFont,
    /* macOS Chrome — San Francisco */ 'Segoe UI',
    /* Windows 10/11 — Segoe UI Variable */ 'PingFang SC',
    /* macOS 中文 — 苹方 */ 'Microsoft YaHei', /* Windows 中文 — 微软雅黑 */ 'Noto Sans SC',
    /* Linux 中文 — 思源黑体（如安装） */ 'Helvetica Neue', Arial, sans-serif; /* 系统兜底 */

  /* === 等宽字体栈 (代码块 / 编辑器) === */
  --font-family-mono:
    'Cascadia Code', /* Windows Terminal 默认等宽 — 连字支持 */ 'Fira Code',
    /* 开源等宽 — 广泛使用，连字丰富 */ 'JetBrains Mono',
    /* JetBrains IDE 默认等宽 — 字形优雅 */ 'SF Mono', /* macOS — Xcode 默认等宽 */ 'Consolas',
    /* Windows 经典等宽 */ 'Courier New', monospace; /* 系统兜底 */

  /* === 字体粗细 === */
  --font-weight-light: 300;
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
}
```

### 2.2 字号阶梯 (Type Scale)

基于 **4px 递增** + 语义化命名，覆盖笔记工具全场景。

```css
:root {
  /* === 阅读正文层级 === */
  --font-size-body: 16px; /* 正文字号 — 阅读舒适区，不放大不缩小 */
  --font-size-body-lg: 18px; /* 大正文 — 用户可选"大字体模式" */
  --font-size-body-sm: 14px; /* 小正文 — 用于侧边栏、目录树等辅助区域 */

  /* === 标题层级 (Markdown H1-H6) === */
  --font-size-h1: 32px; /* 一级标题 */
  --font-size-h2: 28px; /* 二级标题 */
  --font-size-h3: 24px; /* 三级标题 */
  --font-size-h4: 20px; /* 四级标题 */
  --font-size-h5: 18px; /* 五级标题 */
  --font-size-h6: 16px; /* 六级标题 — 与正文同号但加粗 */

  /* === UI 辅助字号 === */
  --font-size-caption: 12px; /* 说明文字 — 时间戳、字数统计、面包屑 */
  --font-size-label: 14px; /* 标签/徽标 — 标签云、状态徽标 */
  --font-size-button: 14px; /* 按钮文字 */
  --font-size-input: 16px; /* 输入框文字 — 不小于 16px 防止 iOS 缩放 */

  /* === 大字号 (特殊场景) === */
  --font-size-hero: 48px; /* Hero 文本 — 欢迎页/空白状态大标题 */
  --font-size-display: 36px; /* 展示文本 — 设置页面标题等 */
}
```

### 2.3 行高 (Line Height)

```css
:root {
  /* === 阅读行高 === */
  --line-height-reading: 1.6; /* 正文/笔记内容 — 宽松舒适，适合长文阅读 */

  /* === UI 行高 === */
  --line-height-ui: 1.4; /* 按钮/标签/输入框 — 紧凑但保持可点击区域 */

  /* === 标题行高 === */
  --line-height-heading: 1.3; /* 标题 — 标题通常较短，稍紧凑 */

  /* === 代码行高 === */
  --line-height-code: 1.5; /* 代码块 — 行间距保证语法元素对齐可读 */

  /* === 特殊行高 === */
  --line-height-none: 1; /* 单行场景 — 图标、徽标、小标签 */
}
```

### 2.4 字体排版细节

```css
:root {
  /* === 字母间距 === */
  --letter-spacing-tight: -0.02em; /* 大标题 — 轻微收紧提升紧凑感 */
  --letter-spacing-normal: 0; /* 正文 — 默认间距 */
  --letter-spacing-wide: 0.04em; /* 全大写标签/徽标 — 展开提升可读性 */

  /* === 文本修饰 === */
  --text-underline-offset: 0.2em; /* 下划线偏移 — 不覆盖降部 */
  --text-decoration-thickness: 1px; /* 删除线/下划线粗细 */
}
```

---

## 3. 间距系统 (Spacing)

基于 **4px 基础栅格**。所有内边距、外边距、间隙必须取自以下 Token，禁止任意值。

```css
:root {
  --space-0: 0;
  --space-4: 4px;
  --space-8: 8px;
  --space-12: 12px;
  --space-16: 16px;
  --space-20: 20px;
  --space-24: 24px;
  --space-32: 32px;
  --space-40: 40px;
  --space-48: 48px;
  --space-64: 64px;
}
```

### 间距使用约定

| Token        | 典型用途                                             |
| ------------ | ---------------------------------------------------- |
| `--space-4`  | 图标与文字间距、标签内边距、紧凑型徽标内边距         |
| `--space-8`  | 列表项内间距、表单行间距、按钮左右内边距             |
| `--space-12` | 卡片内边距（紧凑）、小组件内边距、按钮上下内边距     |
| `--space-16` | 卡片内边距（标准）、模态内容内边距、表格单元格内边距 |
| `--space-20` | 分段标题上下间距、侧边栏导航项间距                   |
| `--space-24` | 页面内容区内边距、面板内边距                         |
| `--space-32` | 页面外边距、大区段间距                               |
| `--space-40` | Hero 区域上下间距                                    |
| `--space-48` | 首页大标题与内容间距                                 |
| `--space-64` | 顶级板块间距                                         |

---

## 4. 圆角 (Border Radius)

```css
:root {
  --radius-none: 0; /* 无圆角 — 表格、分割线、直角面板 */
  --radius-small: 4px; /* 小圆角 — 标签、徽标、小按钮、行内代码 */
  --radius-medium: 8px; /* 中圆角 — 卡片、输入框、按钮、下拉菜单 */
  --radius-large: 12px; /* 大圆角 — 模态框、面板、大卡片 */
  --radius-full: 9999px; /* 全圆角 — 头像、药丸标签、圆形按钮 */
}
```

### 圆角使用原则

1. **默认使用 `--radius-medium` (8px)** — 这是 MarkLuck 最常用的圆角值，适用于绝大多数 UI 元素。
2. **同层级元素使用相同圆角** — 同一卡片上的按钮、输入框不应混用不同圆角值。
3. **全圆角 (`--radius-full`) 仅用于圆形/药丸形状** — 头像、小型状态指示灯、药丸型标签。不应用于按钮（除非明确设计为药丸风格）。
4. **嵌套元素的圆角递进规则**: 外层 > 内层。如果父容器使用 `--radius-medium`，子元素应使用 `--radius-small` 或跟随父级。

---

## 5. 阴影 (Box Shadows)

极简主义下的阴影使用原则：**默认无阴影，仅在需要表达浮层/层级关系时使用**。

```css
:root {
  /* === 无阴影 (默认) === */
  --shadow-none: none; /* 大多数元素应使用此值 */

  /* === 卡片阴影 === */
  --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.08);
  /* 用途：卡片轻微浮起，几乎不可见。适合列表卡片、信息面板 */

  /* === 下拉阴影 === */
  --shadow-dropdown: 0 4px 12px rgba(0, 0, 0, 0.12);
  /* 用途：下拉菜单、弹出面板、Tooltip — 需要明显的层级分离 */

  /* === 模态阴影 === */
  --shadow-modal: 0 8px 24px rgba(0, 0, 0, 0.16);
  /* 用途：模态框、对话框 — 最高层级的浮层 */
}
```

### 暗色主题阴影覆盖

```css
[data-theme='dark'] {
  /* 暗色背景下阴影改为'发光'效果 — 因为深色上暗色阴影不可见 */
  --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.3);
  --shadow-dropdown: 0 4px 12px rgba(0, 0, 0, 0.4);
  --shadow-modal: 0 8px 24px rgba(0, 0, 0, 0.6);
}
```

### 阴影使用原则

1. 一个页面中同时使用阴影的元素不应超过 3 种层级。
2. 阴影是传递 Z 轴层级的主要手段，与 `--z-index-*` 配合使用（高 z-index 元素应配更深阴影）。
3. 禁止自定义阴影值（如 `box-shadow: 0 2px 5px rgba(...)`），必须使用 Token。

---

## 6. 动效 (Transitions & Animations)

极简主义的动效原则：**快、无感知、服务于交互反馈，而非吸引注意力**。

```css
:root {
  /* === 过渡时长 (Duration) === */
  --duration-micro: 150ms; /* 微交互 — hover 态切换、颜色变化、图标状态切换 */
  --duration-standard: 250ms; /* 标准过渡 — 菜单展开/收起、模态进出、选项卡切换 */
  --duration-slow: 400ms; /* 慢过渡 — 页面级切换（路由）、大面板展开 */
  --duration-press: 50ms; /* 按压反馈 — 按钮按下态，几乎瞬间 */

  /* === 缓动函数 (Easing) === */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1); /* 出现/展开 — ease-out 曲线，快速开始稳步结束 */
  --ease-in: cubic-bezier(0.4, 0, 1, 1); /* 消失/收起 — ease-in 曲线 */
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1); /* 标准进出 — 对称的 ease-in-out */
  --ease-emphasized: cubic-bezier(
    0.05,
    0.7,
    0.1,
    1
  ); /* 强调型缓动 — 弹入效果，用于重要反馈（如保存成功的打勾动画） */

  /* === 组合快捷键 (Shorthand) === */
  --transition-micro: 150ms var(--ease-out); /* 微交互过渡 */
  --transition-standard: 250ms var(--ease-in-out); /* 标准 UI 过渡 */
  --transition-modal-in: 250ms var(--ease-out); /* 模态进入 */
  --transition-modal-out: 150ms var(--ease-in); /* 模态退出 */
}
```

### 动效使用原则

1. **过渡属性应明确指定**，避免使用 `transition: all`。建议用法：
   ```css
   .my-element {
     transition:
       background-color var(--transition-micro),
       opacity var(--transition-micro);
   }
   ```
2. **交互反馈用 `--duration-micro` (150ms)**，超过 250ms 的过渡会让用户感到"卡顿"。
3. **页面/路由切换用 `--duration-slow` (400ms)**，给用户足够的时间感知空间位置变化。
4. **减少动画** — 尊重 `prefers-reduced-motion` 媒体查询。当用户系统设置为"减少动效"时，将所有 `transition-duration` 覆盖为 `0ms`：
   ```css
   @media (prefers-reduced-motion: reduce) {
     :root {
       --duration-micro: 0ms;
       --duration-standard: 0ms;
       --duration-slow: 0ms;
       --duration-press: 0ms;
     }
   }
   ```
5. **不引入动效库**（如 animate.css、GSAP）。MarkLuck 的动效通过 CSS transition + 少量 CSS animation (关键帧) 实现，保持零依赖。

---

## 7. 布局 (Layout Dimensions)

```css
:root {
  /* === 侧边栏 === */
  --layout-sidebar-width: 260px; /* 左侧主侧边栏宽度 */
  --layout-sidebar-collapsed: 48px; /* 折叠后宽度 — 仅显示图标 */

  /* === 导航树 === */
  --layout-navtree-width: 240px; /* 文件导航树面板宽度 */

  /* === 内容区 === */
  --layout-content-min-width: 400px; /* 编辑/预览区最小宽度 — 低于此宽度触发布局重排 */
  --layout-content-max-width: 860px; /* 阅读区最大宽度 — 阅读舒适的文本行长度（约 80 字符） */
  --layout-content-padding: var(--space-32); /* 内容区左右内边距 */

  /* === 编辑器字号 === */
  --layout-editor-font-size: 16px; /* 编辑器默认字号（= --font-size-body） */

  /* === 顶部工具栏 === */
  --layout-toolbar-height: 48px; /* 顶部工具栏高度 */
}
```

### 响应式断点

```css
/* 断点定义 — 不创建 CSS Token，通过媒体查询使用 */
/* 
  >= 1280px   桌面全功能布局（侧边栏 + 导航树 + 编辑区 + 预览）
  >= 960px    平板布局（侧边栏折叠 + 编辑区 + 可切换预览）
  >= 640px    大手机布局（单栏，底部 Tab 导航）
  < 640px     小手机布局（单栏全屏，手势主导）
*/
```

---

## 8. Z-Index 层级 (Z-Index Scale)

```css
:root {
  --z-base: 0; /* 默认层级 — 页面主体内容 */
  --z-sidebar: 100; /* 侧边栏 — 覆盖内容区上方 */
  --z-toolbar: 200; /* 固定工具栏 — 侧边栏之上 */
  --z-dropdown: 400; /* 下拉菜单/Popover/Tooltip — 工具栏之上 */
  --z-overlay: 600; /* 遮罩层 — 覆盖除模态外的所有内容 */
  --z-modal: 800; /* 模态框/对话框 — 最高交互层级 */
  --z-toast: 1000; /* Toast 通知 — 全局最高，不被任何元素遮挡 */
}
```

### 层级使用原则

1. **层级值仅用于 Z 轴定位**，不可用于其他目的（如 `opacity` 缩放、颜色变体）。
2. **同一功能模块内元素不创建独立层级**，依赖 DOM 顺序和 `--shadow-*` 表达先后关系。
3. **新增层级需求时**，先检查能否复用现有层级。若需要新层级，必须更新本文档并注明用途。
4. **禁止使用 `z-index: 99999` 等魔数**，必须使用 Token。

---

## 9. 杂项 Token (Miscellaneous)

```css
:root {
  /* === 边框 === */
  --border-width-thin: 1px; /* 默认边框宽度 */
  --border-width-medium: 2px; /* 聚焦环 / 强调边框 */
  --border-width-thick: 3px; /* Block Marker 色条宽度 */

  /* === 不透明度 === */
  --opacity-disabled: 0.4; /* 禁用态不透明度 */
  --opacity-hover: 0.8; /* 图标悬停不透明度 */
  --opacity-overlay: 0.5; /* 模态遮罩不透明度 */

  /* === 聚焦环 (Focus Ring) === */
  --focus-ring-width: 2px; /* 聚焦环宽度 */
  --focus-ring-offset: 2px; /* 聚焦环与元素的间距 */
  --focus-ring-style: solid; /* 聚焦环样式 */
  --focus-ring:
    0 0 0 var(--focus-ring-offset) var(--color-bg-elevated),
    0 0 0 calc(var(--focus-ring-offset) + var(--focus-ring-width)) var(--color-accent);
  /* 用法: box-shadow: var(--focus-ring); */
  /* 仅在 :focus-visible 时应用，避免鼠标点击时显示聚焦环 */

  /* === 图标尺寸 === */
  --icon-size-sm: 14px; /* 小图标 — 行内图标、列表项图标 */
  --icon-size-md: 18px; /* 中图标 — 默认图标尺寸 */
  --icon-size-lg: 24px; /* 大图标 — 导航图标、页面标题图标 */
  --icon-size-xl: 32px; /* 特大图标 — Hero / 空白状态插图 */

  /* === 头像尺寸 === */
  --avatar-size-sm: 24px;
  --avatar-size-md: 32px;
  --avatar-size-lg: 48px;
}
```

---

## 10. 无障碍 (Accessibility) Token 覆盖

```css
/* === 高对比度模式 === */
@media (prefers-contrast: high) {
  :root {
    --color-text-primary: #000000;
    --color-text-secondary: #333333;
    --color-border: #888888;
    --color-accent: #0055cc;
    --color-link: #0055cc;
  }
}

/* === 减少动效 === */
@media (prefers-reduced-motion: reduce) {
  :root {
    --duration-micro: 0ms;
    --duration-standard: 0ms;
    --duration-slow: 0ms;
    --duration-press: 0ms;
  }
}

/* === 减少透明度（改善可读性） === */
@media (prefers-reduced-transparency: reduce) {
  :root {
    --color-bg-overlay: rgba(0, 0, 0, 0.5);
    --opacity-overlay: 0.8;
    --color-selection: rgba(74, 144, 217, 0.5);
    --color-accent-muted: rgba(74, 144, 217, 0.25);
  }
}
```

---

## 11. 设计约束总结 (Design Constraints Checklist)

编码和设计审查时，逐项对照以下清单：

- [ ] 未使用 `design-system.md` 之外的色值、字号、间距、圆角、阴影
- [ ] 背景层次不超过三层（`--color-bg` → `--color-bg-elevated` → `--color-bg-hover`）
- [ ] 文本色层次不超过三层（`--color-text-primary` → `--color-text-secondary` → `--color-text-tertiary`）
- [ ] 强调色仅用于交互元素，非装饰
- [ ] 语义色使用正确（success/warning/error/info 各归其位）
- [ ] 间距全部来自 4px 栅格体系
- [ ] 圆角遵循递进规则（外层 ≥ 内层）
- [ ] 阴影仅用于浮层/层叠关系表达，非装饰
- [ ] 动效使用 Token 时长 + 明确指定过渡属性，非 `transition: all`
- [ ] `z-index` 使用 Token，无魔数
- [ ] `:focus-visible` 聚焦样式使用 `--focus-ring` Token
- [ ] 暗色主题变量已覆盖（`[data-theme="dark"]`）
- [ ] 无障碍媒体查询已覆盖（prefers-contrast / prefers-reduced-motion / prefers-reduced-transparency）
- [ ] 字号不小于 12px（无障碍最小可读尺寸）

---

## 12. 版本记录

| 版本 | 日期       | 变更                                                                                                                                           |
| ---- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| v1.0 | 2026-06-03 | 初始版本：色彩体系（浅色/深色/语义/Block Marker）、字体系统、间距栅格、圆角、阴影、动效、布局尺寸、Z-Index 层级、杂项 Token、无障碍 Token 覆盖 |

---

> **维护规则**: 样式的 Token 级别变更（新增颜色、修改间距基值、调整动效曲线）必须更新本文档。组件级别的样式微调（如某个组件的内边距从 `--space-12` 改为 `--space-16`）不需要更新本文档，但需在 `components.md` 中记录。
