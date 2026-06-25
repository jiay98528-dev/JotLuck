# 三态视图系统规格 — 编辑 / 分栏 / 预览

> 版本：v1.0 | 日期：2026-06-05 | 状态：待实现

## 1. 概述

将当前的二元切换（编辑 ↔ 预览）扩展为三态循环：

```
编辑 (Edit)  →  分栏 (Split)  →  预览 (Preview)  →  编辑 ...
```

三种模式共存，用户通过顶栏按钮或快捷键单键循环切换。

## 2. 用户故事

- **技术写作者** — 在分栏模式下写 Markdown，左手侧实时看到渲染效果，无需来回切换
- **学生** — 编辑模式下专注写作，预览模式下阅读排版，分栏模式下对照语法和效果
- **开发者** — 分栏左侧显示带行号的源码，右侧显示语法高亮的代码块渲染

## 3. 三态定义

### 3.1 编辑模式 (Edit)

| 属性     | 值                                      |
| -------- | --------------------------------------- |
| 左侧     | —                                       |
| 中央     | CodeMirror 6 编辑器，**无行号**，无渲染 |
| 右侧     | —                                       |
| 顶栏按钮 | 显示 "分栏"                             |

**行为**: 与当前编辑模式一致。Markdown 源码直接编辑。FormatBubble 选中文字浮现。

### 3.2 分栏模式 (Split) `← 新增`

| 属性     | 值                                                            |
| -------- | ------------------------------------------------------------- |
| 左侧     | CodeMirror 6 编辑器，**显示行号**，等宽字体，min-width 400px  |
| 分隔     | 1px `var(--rule)` 竖线，可拖拽调整比例（默认 50:50）          |
| 右侧     | 渲染预览 (`.markdown-body`)，实时同步（300ms 防抖），独立滚动 |
| 顶栏按钮 | 显示 "预览"                                                   |

**编辑器 (左侧)**:

- 行号可见（`lineNumbers()` 扩展仅在分栏模式启用）
- 光标同步：左侧滚动时，右侧预览不联动（独立滚动）
- 内容变更 → 300ms 防抖 → 右侧更新渲染

**预览 (右侧)**:

- 完整的 Markdown 渲染（`renderMarkdown()` + `highlightCodeBlocks()`）
- 代码块显示语法高亮 + 行号（highlight.js 内置）
- 独立滚动，不受左侧光标位置影响
- 点击 Wiki-link 在编辑器中打开目标笔记

### 3.3 预览模式 (Preview)

| 属性     | 值                                                      |
| -------- | ------------------------------------------------------- |
| 左侧     | —                                                       |
| 中央     | 渲染预览 (`.markdown-body`)，居中 680px，120px 顶部留白 |
| 右侧     | —                                                       |
| 顶栏按钮 | 显示 "编辑"                                             |

**行为**: 与当前预览模式一致。

## 4. 状态管理

```typescript
// NotebookHome.vue
type ViewMode = 'edit' | 'split' | 'preview';
const viewMode = ref<ViewMode>('edit');

// 循环切换
function cycleViewMode(): void {
  const modes: ViewMode[] = ['edit', 'split', 'preview'];
  const idx = modes.indexOf(viewMode.value);
  viewMode.value = modes[(idx + 1) % 3];
}

// 按钮文案
const viewModeLabel = computed(() => {
  const labels: Record<ViewMode, string> = {
    edit: '分栏',
    split: '预览',
    preview: '编辑',
  };
  return labels[viewMode.value];
});
```

## 5. 编辑器扩展动态切换

分栏模式需要 `lineNumbers()` 扩展，编辑/预览模式不需要。

```typescript
// 使用 CodeMirror Compartment 动态切换
import { lineNumbers } from '@codemirror/view';
import { Compartment } from '@codemirror/state';

const lineNumberCompartment = new Compartment();

// 在 MarkdownEditor 中暴露方法：
function setLineNumbers(visible: boolean): void {
  view.dispatch({
    effects: lineNumberCompartment.reconfigure(visible ? lineNumbers() : []),
  });
}
```

## 6. 分栏布局

```
┌─────────────────────────────────────────────────────┐
│ [三] MarkLuck                [分栏] [↑] [↗] [☀]   │ ← TopBar 44px
│─────────────────────────────────────────────────────│
│                     │                               │
│   CodeMirror 6      │   Markdown Preview            │
│   1  # Heading      │   <h1>Heading</h1>            │
│   2                  │                               │
│   3  **bold** text   │   <strong>bold</strong> text  │
│   4                  │                               │
│   5  - list item     │   • list item                 │
│                     │                               │
│   ← 50% →      1px  │   ← 50% →                    │
│   (min: 300px)  分隔 │   (min: 300px)               │
│                     │                               │
│─────────────────────────────────────────────────────│
│ Ln 5, Col 12 · 247 字 · 选中文字以格式化 · ✓ 已保存 │ ← StatusBar
└─────────────────────────────────────────────────────┘
```

**拖拽调整**: 分隔线可拖拽，比例范围 30:70 ~ 70:30。
**最小宽度**: 左右各 300px。低于 600px 总宽自动切换为编辑模式。

## 7. 快捷键

| 快捷键         | 行为                                                      |
| -------------- | --------------------------------------------------------- |
| `Ctrl+Shift+P` | 命令面板 (不变)                                           |
| `Ctrl+Shift+V` | 循环切换视图模式 (新增)                                   |
| Tab            | Ghost text 可见时接受补全；无 ghost text 时插入制表符缩进 |

## 8. 与现有功能的交互

| 功能           |    编辑模式     |      分栏模式       |       预览模式       |
| -------------- | :-------------: | :-----------------: | :------------------: |
| FormatBubble   | ✅ 选中文字浮现 | ✅ 仅在左栏选中浮现 |          —           |
| 自动保存       |       ✅        |         ✅          |          —           |
| 大纲面板       |       ✅        |         ✅          |          ✅          |
| Wiki-link 点击 |  — 在编辑器中   |    — 在编辑器中     |     ✅ 跳转笔记      |
| 代码行号       |     ❌ 隐藏     |       ✅ 显示       | ✅ highlight.js 内置 |
| 命令面板       |       ✅        |         ✅          |          ✅          |
| 导出/分享      |       ✅        |         ✅          |          ✅          |

## 9. 验收标准

- [ ] 点击顶栏按钮 → 编辑 → 分栏 → 预览 → 编辑 循环正常
- [ ] Ctrl+Shift+V 循环切换
- [ ] 分栏模式：左右各占 50%，分隔线可拖拽
- [ ] 分栏模式：左侧显示行号，右侧实时预览
- [ ] 分栏模式：左侧输入 `# Hello` → 300ms 内右侧渲染 `<h1>Hello</h1>`
- [ ] 分栏模式：左侧输入 `**bold**` → 右侧渲染 `<strong>bold</strong>`
- [ ] 分栏模式：左右独立滚动
- [ ] 视口 < 600px → 自动切换编辑模式
- [ ] 编辑模式：行号隐藏
- [ ] 预览模式：居中 680px，120px 顶部留白
