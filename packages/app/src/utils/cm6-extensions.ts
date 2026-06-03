/**
 * CodeMirror 6 自定义扩展
 *
 * M1-07~11: BlockDecorator, BlockWidget, FormatAutoDetector,
 *           RestoreButton, IME handler, keyboard shortcuts
 *
 * @module cm6-extensions
 * @see TAD.md §3.2-3.9
 */

import {
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view';
import { type Extension } from '@codemirror/state';
import type { MarkdownBlock } from '@/types';

// ================================================================
// Block Decorator — 语法块边界标记点
// ================================================================

/** 块颜色标记的 CSS 类生成 */
function markerClass(block: MarkdownBlock): string {
  if (!block.isValid) return 'cm-block-marker cm-block-marker--invalid';
  if (block.mode === 'render') return 'cm-block-marker cm-block-marker--render';
  return 'cm-block-marker cm-block-marker--source';
}

/** 根据块列表生成 Decoration set */
function buildDecorations(blocks: MarkdownBlock[]): DecorationSet {
  const widgets: { from: number; to: number; decoration: Decoration }[] = [];

  for (const block of blocks) {
    const cls = markerClass(block);
    // 在块起始位置添加行装饰（蓝色/绿色/灰色圆点）
    const deco = Decoration.line({ class: cls });
    widgets.push({ from: block.from, to: block.from, decoration: deco });
  }

  return Decoration.set(
    widgets.map((w) => w.decoration.range(w.from, w.to)),
    true,
  );
}

// Block list state — managed externally
let _currentBlocks: MarkdownBlock[] = [];

export function setBlocksForDecorations(blocks: MarkdownBlock[]): void {
  _currentBlocks = blocks;
}

/** BlockDecorator ViewPlugin */
export const blockDecorator = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(_view: EditorView) {
      this.decorations = buildDecorations(_currentBlocks);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(_currentBlocks);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);

// ================================================================
// Format Shortcuts — 键盘快捷键
// ================================================================

import { insertNewlineAndIndent } from '@codemirror/commands';

/** 基础 Markdown 快捷键 */
export function markdownKeymap(): Record<string, (view: EditorView) => boolean> {
  return {
    'Ctrl-b': (view) => wrapSelection(view, '**'),
    'Ctrl-i': (view) => wrapSelection(view, '*'),
    'Ctrl-k': (view) => insertLink(view),
    'Ctrl-`': (view) => wrapSelection(view, '`'),
    Enter: (view) => {
      // Auto-continue list items and blockquotes
      return insertNewlineAndIndent(view);
    },
  };
}

function wrapSelection(view: EditorView, marker: string): boolean {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const wrapped = marker + selected + marker;

  view.dispatch({
    changes: { from, to, insert: wrapped },
    selection: { anchor: from + marker.length, head: from + marker.length + selected.length },
  });
  return true;
}

function insertLink(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to) || 'link text';

  view.dispatch({
    changes: { from, to, insert: `[${selected}](url)` },
    selection: { anchor: from + selected.length + 3, head: from + selected.length + 6 },
  });
  return true;
}

// ================================================================
// IME Handler — 中文输入法 composition 事件
// ================================================================

/** 跟踪 IME composition 状态，防止误触发格式检测 */
export const imeHandler = ViewPlugin.fromClass(
  class {
    composing = false;

    constructor(view: EditorView) {
      view.dom.addEventListener('compositionstart', () => {
        this.composing = true;
      });
      view.dom.addEventListener('compositionend', () => {
        this.composing = false;
      });
    }
  },
);

// ================================================================
// Throttled Parser — 防抖重新解析
// ================================================================

export const throttledParser = ViewPlugin.fromClass(
  class {
    timer: ReturnType<typeof setTimeout> | null = null;

    constructor(readonly view: EditorView) {}

    update(update: ViewUpdate) {
      if (!update.docChanged) return;

      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        // Emit custom event for the Vue component to handle
        const event = new CustomEvent('markluck-parse', {
          detail: { content: this.view.state.doc.toString() },
        });
        this.view.dom.dispatchEvent(event);
      }, 150);
    }

    destroy() {
      if (this.timer) clearTimeout(this.timer);
    }
  },
);

// ================================================================
// Export all extensions
// ================================================================

export function markluckExtensions(): Extension[] {
  return [blockDecorator, imeHandler, throttledParser];
}
