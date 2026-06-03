# MarkLuck CSS & 样式规范

> 版本：v1.0 | 日期：2026-06-03
> 关联文档：`DESIGN.md`（双主题视觉规格）、`spec/frontend/design-system.md`（CSS Token 数值）

---

## 一、基本原则

1. **所有样式值来自 Design Token** — 禁止在组件样式中硬编码色值、字号、间距、圆角、阴影
2. **OKLCH 色彩空间** — 禁止使用 `#hex`、`rgb()`、`hsl()`
3. **Scoped 样式** — 使用 `<style scoped>`，避免样式泄漏
4. **无 `!important`** — 除非有注释解释不可规避的原因
5. **亮色为默认** — 暗色通过 `[data-color-scheme="dark"]` 覆盖

---

## 二、CSS Custom Properties 使用

```css
/* ✅ 正确：引用 Design Token */
.note-title {
  color: var(--clr-text-primary);
  font-size: var(--text-2xl);
  margin-bottom: var(--space-16);
}

/* ✅ 带降级（可选 token） */
.glass-sidebar {
  background: var(--glass-bg, var(--clr-surface));
  backdrop-filter: var(--glass-blur, none);
}

/* ❌ 禁止：硬编码 */
.note-title {
  color: #1a1a1a; /* 应用 var(--clr-text-primary) */
  font-size: 32px; /* 应用 var(--text-2xl) */
  margin-bottom: 16px; /* 应用 var(--space-16) */
}
```

### 区域颜色使用

```css
/* ✅ 按功能区域使用对应的区域 Token */
.file-sidebar {
  background: var(--clr-zone-sidebar); /* 微冷 */
}
.editor-area {
  background: var(--clr-zone-editor); /* 微暖 */
}
.nav-tree {
  background: var(--clr-zone-navtree); /* 微绿 */
}
```

---

## 三、布局

### 3.1 Flexbox / Grid

```css
/* ✅ 一维：Flexbox */
.toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-8);
}

/* ✅ 二维：Grid */
.app-layout {
  display: grid;
  grid-template-columns: var(--sidebar-width) 1fr var(--navtree-width);
  height: 100vh;
}
```

### 3.2 间距（4px 栅格）

```css
/* ✅ 从 Token 中选择间距 */
.section {
  padding: var(--space-24);
} /* 呼吸区 */
.panel {
  padding: var(--space-16);
} /* 标准区 */
.list {
  gap: var(--space-8);
} /* 紧凑区 */

/* ❌ 禁止：非栅格间距 */
.random {
  margin-bottom: 15px;
} /* 15 不在 4px 栅格中 */
```

### 3.3 响应式断点

```css
/* 移动优先：基础样式 = 移动端 */

/* 平板及以上 */
@media (min-width: 640px) {
  /* --bp-sm */
}

/* 桌面 */
@media (min-width: 1024px) {
  /* --bp-md */
}

/* 大屏 */
@media (min-width: 1440px) {
  /* --bp-lg */
}
```

### 3.4 内容宽度

```css
/* 编辑器正文区域：最大阅读宽度 */
.editor-content {
  max-width: 75ch;
  margin-inline: auto;
}

/* 面板：无最大宽度约束 */
.file-sidebar {
  width: var(--sidebar-width); /* 260px */
}
```

---

## 四、双主题实现

### 4.1 主题切换机制

```css
/* 默认：构成主义亮色（无属性 = 默认） */
:root,
[data-theme='construct-light'] {
  --clr-bg: oklch(0.98 0.002 250);
  --clr-text-primary: oklch(0.18 0.005 260);
  /* ...完整 Token 定义见 design-system.md */
}

/* 磨玻璃亮色 */
[data-theme='glass-light'] {
  --clr-bg: oklch(0.97 0.003 250);
  --glass-bg: oklch(0.995 0.001 260 / 0.72);
  /* ... */
}

/* 暗色变体 — 仅覆盖变化的 Token */
[data-color-scheme='dark'] {
  --clr-text-primary: oklch(0.92 0.003 260);
  --clr-bg: oklch(0.16 0.005 260);
  --clr-surface: oklch(0.2 0.005 260);
  /* ... */
}
```

### 4.2 HTML 属性设置

```html
<!-- 构成主义亮色（默认） -->
<html>
  <!-- 磨玻璃亮色 -->
  <html data-theme="glass-light">
    <!-- 构成主义暗色 -->
    <html data-theme="construct-light" data-color-scheme="dark">
      <!-- 磨玻璃暗色 -->
      <html data-theme="glass-light" data-color-scheme="dark"></html>
    </html>
  </html>
</html>
```

---

## 五、玻璃效果规范

### 5.1 专用类

```css
/* ✅ 通过语义类应用玻璃 */
.glass-panel {
  background: var(--glass-bg, var(--clr-surface));
  backdrop-filter: blur(var(--glass-blur, 12px)) saturate(var(--glass-saturate, 140%));
  border: 1px solid var(--glass-border, transparent);
}

.glass-raised {
  background: var(--glass-raised-bg, var(--clr-surface));
  backdrop-filter: blur(var(--glass-raised-blur, 20px)) saturate(var(--glass-saturate, 140%));
  box-shadow: var(--glass-raised-shadow, none);
}

/* ✅ 必须提供降级 */
@supports not (backdrop-filter: blur(1px)) {
  .glass-panel {
    background: var(--clr-surface);
    /* 无模糊时退化到纯色面板 */
  }
}

/* ❌ 禁止：到处用玻璃 */
.note-card {
  backdrop-filter: blur(10px); /* 应该用 .glass-panel 类 */
}
```

### 5.2 性能约束

- 视口内玻璃面板 ≤ 3 个
- 不在滚动容器内使用 `backdrop-filter`（每帧重绘开销大）
- 玻璃面板不动画（不改变 blur 值）
- 给玻璃面板加 `will-change: backdrop-filter` 提示浏览器

### 5.3 Z-Index 层级

```
0    — 根背景
10   — 玻璃面板 (.glass-panel)
20   — 浮层面板 (.glass-raised, dropdown)
30   — 模态框
1000 — Toast 通知
```

---

## 六、动效

```css
/* ✅ 仅动画 transform + opacity */
.panel-enter {
  opacity: 0;
  transform: translateX(-8px);
  transition:
    opacity var(--duration-standard),
    transform var(--duration-standard);
}
.panel-enter-active {
  opacity: 1;
  transform: translateX(0);
}

/* ❌ 禁止：动画布局属性 */
.bad-animation {
  transition: width 0.3s; /* 触发布局重排 */
}

/* ✅ 尊重用户偏好 */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

**动效时长 Token**：`--duration-micro: 150ms` / `--duration-standard: 250ms` / `--duration-reveal: 400ms`

**缓动函数**：`cubic-bezier(0.4, 0, 0.2, 1)`（ease-out，无弹跳）

---

## 七、暗色模式

```css
[data-color-scheme='dark'] {
  /* 文字：白色染微冷，非纯白 */
  --clr-text-primary: oklch(0.92 0.003 260);
  --clr-text-secondary: oklch(0.68 0.003 260);

  /* 背景：深灰染微蓝，非纯黑 */
  --clr-bg: oklch(0.16 0.005 260);
  --clr-surface: oklch(0.2 0.005 260);

  /* 强调色：提高明度补偿暗背景 */
  --clr-accent: oklch(0.68 0.14 255);

  /* 光晕：暗背景下可提高 20% 强度 */
  --glow-sidebar: oklch(0.5 0.04 240 / 0.12);
  /* 暗色玻璃：增加模糊强度 */
  --glass-blur: 16px;
}
```

---

## 八、可及性

```css
/* 焦点环：替换浏览器默认 outline */
:focus-visible {
  outline: 2px solid var(--clr-accent);
  outline-offset: 2px;
}

/* 触控区域（移动端） */
@media (max-width: 1023px) {
  .clickable {
    min-height: 44px;
    min-width: 44px;
  }
}
```

---

## 九、性能

```css
/* ✅ 离屏面板：contain 减少重绘范围 */
.off-screen-panel {
  contain: layout style paint;
}

/* ✅ 即将动画的元素 */
.animated-panel {
  will-change: transform, opacity;
}
/* 动画结束后清理 */
.animated-panel.animation-done {
  will-change: auto;
}

/* ❌ 禁止 */
.deeply-nested-selector > div > div > div > span {
} /* >3 层级 */
* {
  box-sizing: border-box;
} /* 全局通配符仅在 reset 中使用 */
@import url('other.css'); /* 使用 JS import 替代 CSS @import */
```

---

## 十、禁止事项完整清单

| 禁止                                        | 替代方案                             |
| ------------------------------------------- | ------------------------------------ |
| `#hex` / `rgb()` / `hsl()` 颜色             | `oklch()`                            |
| 硬编码数值                                  | `var(--token)`                       |
| `!important`                                | 提升选择器特异性或重构               |
| `background-clip: text` 渐变文字            | 纯色 + 字重/大小对比                 |
| `border-left` / `border-right` > 1px 装饰条 | 全边框 / 背景色块 / 色条使用其他元素 |
| 视口内 > 3 个玻璃元素                       | 精简玻璃使用                         |
| `backdrop-filter` 动画                      | 无动画或在 `opacity` 上做淡入淡出    |
| CSS `@import`                               | JS `import './styles.css'`           |
| 行内 `style` 属性                           | 仅在动态计算值时用 `:style` 绑定     |
| `z-index` 不在 0/10/20/30/1000 范围         | 使用定义好的层级                     |
| 动画 `width`/`height`/`top`/`left`          | `transform` + `opacity`              |
| 相同尺寸的卡片网格                          | 拒绝卡片布局，使用功能分区           |
