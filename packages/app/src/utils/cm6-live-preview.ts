/**
 * CM6 Live Preview — 块级混合编辑器渲染扩展
 *
 * M1-08: 隐藏 Markdown 语法标记 + 应用视觉样式，实现"所见即所得"编辑。
 *
 * 原理:
 *   - 默认所有块进入 Live Preview（隐藏标记、应用样式）
 *   - Tab 切换当前块 → 源码模式（显示标记、蓝色行标记）
 *   - 再次 Tab → 回到 Live Preview（绿色行标记）
 *   - 2 秒无输入后自动将源代码块切换为 Live Preview
 *
 * @see spec/frontend/components.md §12 (MarkdownEditor)
 * @see doc/TAD.md §3.2-3.9
 */

import {
  ViewPlugin,
  Decoration,
  WidgetType,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';
import { parseBlocks } from './blockParser';
import type { MarkdownBlock } from '@/types';

// ================================================================
// State: 追踪源码模式的块（默认全部 Live Preview）
// ================================================================

const toggleBlockEffect = StateEffect.define<{ blockId: string }>();
const clearSourceBlocksEffect = StateEffect.define<null>();

const sourceBlocksField = StateField.define<Set<string>>({
  create: () => new Set(),
  update(set, tr) {
    for (const e of tr.effects) {
      if (e.is(toggleBlockEffect)) {
        const next = new Set(set);
        if (next.has(e.value.blockId)) {
          next.delete(e.value.blockId);
        } else {
          next.add(e.value.blockId);
        }
        return next;
      }
      if (e.is(clearSourceBlocksEffect)) {
        return new Set();
      }
    }
    return set;
  },
});

// ================================================================
// Decoration Helpers
// ================================================================

/** 隐藏语法标记的 mark decoration */
const hiddenMark = Decoration.mark({ class: 'cm-live-hidden' });

/** 行级装饰: Live Preview 模式标记线（绿色） */
function liveLineMarker(pos: number): { from: number; to: number; decoration: Decoration } {
  return { from: pos, to: pos, decoration: Decoration.line({ class: 'cm-live-marker--live' }) };
}

/** 行级装饰: Source 模式标记线（蓝色） */
function sourceLineMarker(pos: number): { from: number; to: number; decoration: Decoration } {
  return { from: pos, to: pos, decoration: Decoration.line({ class: 'cm-live-marker--source' }) };
}

/**
 * 安全添加 decoration — 忽略 CM6 的位置校验错误
 * (某些边界情况下 block.from/to 可能溢出)
 */
function safeAdd(
  decos: { from: number; to: number; decoration: Decoration }[],
  from: number,
  to: number,
  decoration: Decoration,
): void {
  if (from >= 0 && to >= from) {
    decos.push({ from, to, decoration });
  }
}

// ================================================================
// HR Widget — 替换 `---` 为视觉分割线
// ================================================================

class HRWidget extends WidgetType {
  override eq(_other: HRWidget): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'cm-live-hr';
    el.setAttribute('contenteditable', 'false');
    return el;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

// ================================================================
// Task Checkbox Widget — 替换 `- [ ]` / `- [x]` 为可点击 checkbox
// ================================================================

class TaskCheckboxWidget extends WidgetType {
  private checked: boolean;
  private markerFrom: number;
  private markerTo: number;
  private view: EditorView;

  constructor(view: EditorView, markerFrom: number, markerTo: number, checked: boolean) {
    super();
    this.view = view;
    this.markerFrom = markerFrom;
    this.markerTo = markerTo;
    this.checked = checked;
  }

  override eq(other: TaskCheckboxWidget): boolean {
    return this.checked === other.checked && this.markerFrom === other.markerFrom;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'cm-live-checkbox-wrap';
    wrap.setAttribute('contenteditable', 'false');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'cm-live-checkbox';
    cb.checked = this.checked;
    cb.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const newMarker = this.checked ? '- [ ]' : '- [x]';
      this.view.dispatch({
        changes: { from: this.markerFrom, to: this.markerTo, insert: newMarker },
      });
    });

    wrap.appendChild(cb);
    return wrap;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

// ================================================================
// Image Widget — 替换 `![](path)` 为实际图片
// ================================================================

/** 全局图片解析器：将图片路径转换为可显示的 data URI 或 null */
let imageResolver: ((path: string) => Promise<string | null>) | null = null;

/** 注册图片解析器（NotebookHome onMounted 中调用） */
export function setImageResolver(fn: (path: string) => Promise<string | null>): void {
  imageResolver = fn;
}

/** 从文件扩展名推断 MIME 类型 */
function detectImageMime(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
  };
  return map[ext ?? ''] ?? 'image/png';
}

class ImageWidget extends WidgetType {
  private path: string;

  constructor(path: string) {
    super();
    this.path = path;
  }

  override eq(other: ImageWidget): boolean {
    return this.path === other.path;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'cm-live-image-wrap';
    wrap.setAttribute('contenteditable', 'false');

    const img = document.createElement('img');
    img.className = 'cm-live-image';
    img.alt =
      this.path
        .split('/')
        .pop()
        ?.replace(/\.[^.]+$/, '') ?? 'image';
    img.src = ''; // 占位
    img.style.display = 'none'; // 初始隐藏，加载后显示

    wrap.appendChild(img);

    // 异步加载图片
    if (imageResolver) {
      setTimeout(async () => {
        try {
          const base64 = await imageResolver!(this.path);
          if (base64 && img.isConnected) {
            const mime = detectImageMime(this.path);
            img.src = base64.startsWith('data:') ? base64 : `data:${mime};base64,${base64}`;
            img.style.display = '';
            img.onerror = () => {
              img.style.display = 'none';
              wrap.textContent = `[图片: ${img.alt}]`;
            };
          } else if (img.isConnected) {
            // 图片不存在 — 显示占位文本
            wrap.textContent = `[图片: ${img.alt}]`;
          }
        } catch {
          if (img.isConnected) {
            wrap.textContent = `[图片: ${img.alt}]`;
          }
        }
      }, 0);
    }

    return wrap;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

// ================================================================
// Live Preview ViewPlugin
// ================================================================

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    view: EditorView;

    constructor(view: EditorView) {
      this.view = view;
      this.decorations = this.build(view);
    }

    update(update: ViewUpdate) {
      const sourceChanged =
        update.startState.field(sourceBlocksField) !== update.state.field(sourceBlocksField);
      if (update.docChanged || update.viewportChanged || sourceChanged) {
        this.decorations = this.build(update.view);
      }
    }

    build(view: EditorView): DecorationSet {
      const sourceBlocks = view.state.field(sourceBlocksField);
      const doc = view.state.doc.toString();
      const blocks = parseBlocks(doc, '');
      const decos: { from: number; to: number; decoration: Decoration }[] = [];
      const vp = view.viewport;

      for (const block of blocks) {
        // 跳过视口外的块（性能优化）
        if (block.to < vp.from - 200 || block.from > vp.to + 200) continue;

        const isSource = sourceBlocks.has(block.id);

        if (isSource) {
          decos.push(sourceLineMarker(block.from));
          continue;
        }

        // Live Preview — 总是添加绿色行标记
        decos.push(liveLineMarker(block.from));

        // 类型特定的装饰（块级 + 行内格式）
        switch (block.type) {
          case 'heading':
            this.decoHeading(block, decos);
            this.decoInline(block, decos);
            break;
          case 'blockquote':
            this.decoBlockquote(block, decos);
            this.decoInline(block, decos);
            break;
          case 'unorderedList':
          case 'orderedList':
            this.decoList(block, decos);
            this.decoInline(block, decos);
            break;
          case 'taskList':
            this.decoTaskCheckbox(block, decos);
            this.decoInline(block, decos);
            break;
          case 'codeBlock':
            this.decoCodeBlock(block, decos);
            // 代码块内不应用行内格式
            break;
          case 'horizontalRule':
            this.decoHR(block, decos);
            break;
          default:
            // paragraph / table / frontmatter
            this.decoInline(block, decos);
        }
      }

      // 构建 DecorationSet — 过滤掉无效 range
      const ranges = decos
        .filter((d) => d.from >= 0 && d.to >= d.from)
        .map((d) => d.decoration.range(d.from, d.to));

      return Decoration.set(ranges, true);
    }

    // ---- Heading ----
    decoHeading(
      block: MarkdownBlock,
      decos: { from: number; to: number; decoration: Decoration }[],
    ): void {
      const match = block.raw.match(/^(#{1,6})\s/);
      if (!match) return;

      const prefixLen = match[0].length;
      safeAdd(decos, block.from, block.from + prefixLen, hiddenMark);

      // 标题层级样式
      const level = Math.min(match[1]!.length, 6);
      decos.push({
        from: block.from,
        to: block.from,
        decoration: Decoration.line({ class: `cm-live-heading cm-live-h${level}` }),
      });
    }

    // ---- Blockquote ----
    decoBlockquote(
      block: MarkdownBlock,
      decos: { from: number; to: number; decoration: Decoration }[],
    ): void {
      const match = block.raw.match(/^>\s?/);
      if (!match) return;
      safeAdd(decos, block.from, block.from + match[0].length, hiddenMark);
      decos.push({
        from: block.from,
        to: block.from,
        decoration: Decoration.line({ class: 'cm-live-blockquote' }),
      });
    }

    // ---- List ----
    decoList(
      block: MarkdownBlock,
      decos: { from: number; to: number; decoration: Decoration }[],
    ): void {
      const patterns: Record<string, RegExp> = {
        unorderedList: /^(\s*)[-*+]\s/,
        orderedList: /^(\s*)\d+\.\s/,
      };
      const pattern = patterns[block.type];
      if (!pattern) return;

      const match = block.raw.match(pattern);
      if (!match) return;
      safeAdd(decos, block.from, block.from + match[0].length, hiddenMark);
    }

    // ---- Task Checkbox ----
    decoTaskCheckbox(
      block: MarkdownBlock,
      decos: { from: number; to: number; decoration: Decoration }[],
    ): void {
      const match = block.raw.match(/^(\s*)- \[([ x])\]\s/);
      if (!match) return;
      const checked = match[2] === 'x';
      const leadingWs = match[1]?.length ?? 0;
      const markerFrom = block.from + leadingWs; // `- [` 的实际位置
      const markerTo = markerFrom + 5; // `- [ ]` 或 `- [x]` (5字符)
      safeAdd(
        decos,
        block.from,
        block.from + match[0].length,
        Decoration.replace({
          widget: new TaskCheckboxWidget(this.view, markerFrom, markerTo, checked),
        }),
      );
    }

    // ---- Code Block ----
    decoCodeBlock(
      block: MarkdownBlock,
      decos: { from: number; to: number; decoration: Decoration }[],
    ): void {
      const lines = block.raw.split('\n');

      // 隐藏 opening fence
      if (lines[0]) {
        safeAdd(decos, block.from, block.from + lines[0].length + 1, hiddenMark);
      }

      // 隐藏 closing fence
      if (lines.length > 1 && lines[lines.length - 1]?.trim() === '```') {
        const closeStart = block.to - lines[lines.length - 1]!.length - 1;
        safeAdd(decos, closeStart, block.to, hiddenMark);
      }

      // 代码块背景
      for (let i = 1; i < lines.length - 1; i++) {
        const lineStart = block.from + lines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
        safeAdd(decos, lineStart, lineStart, Decoration.line({ class: 'cm-live-codeblock' }));
      }
    }

    // ---- Horizontal Rule ----
    decoHR(
      block: MarkdownBlock,
      decos: { from: number; to: number; decoration: Decoration }[],
    ): void {
      safeAdd(decos, block.from, block.to, Decoration.replace({ widget: new HRWidget() }));
    }

    // ---- Inline formatting ----
    decoInline(
      block: MarkdownBlock,
      decos: { from: number; to: number; decoration: Decoration }[],
    ): void {
      const text = block.raw;
      const base = block.from;

      // Bold: **text** 或 __text__
      for (const m of text.matchAll(/\*\*(.+?)\*\*|__(.+?)__/g)) {
        const content = m[1] || m[2] || '';
        safeAdd(decos, base + m.index!, base + m.index! + 2, hiddenMark);
        safeAdd(
          decos,
          base + m.index! + 2,
          base + m.index! + 2 + content.length,
          Decoration.mark({ class: 'cm-live-bold' }),
        );
        safeAdd(
          decos,
          base + m.index! + 2 + content.length,
          base + m.index! + 2 + content.length + 2,
          hiddenMark,
        );
      }

      // Italic: *text* (但不匹配 **)
      for (const m of text.matchAll(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g)) {
        const content = m[1] || '';
        safeAdd(decos, base + m.index!, base + m.index! + 1, hiddenMark);
        safeAdd(
          decos,
          base + m.index! + 1,
          base + m.index! + 1 + content.length,
          Decoration.mark({ class: 'cm-live-italic' }),
        );
        safeAdd(
          decos,
          base + m.index! + 1 + content.length,
          base + m.index! + 2 + content.length,
          hiddenMark,
        );
      }

      // Inline code: `text`
      for (const m of text.matchAll(/`([^`]+)`/g)) {
        const content = m[1] || '';
        safeAdd(decos, base + m.index!, base + m.index! + 1, hiddenMark);
        safeAdd(
          decos,
          base + m.index! + 1,
          base + m.index! + 1 + content.length,
          Decoration.mark({ class: 'cm-live-code' }),
        );
        safeAdd(
          decos,
          base + m.index! + 1 + content.length,
          base + m.index! + 2 + content.length,
          hiddenMark,
        );
      }

      // Strikethrough: ~~text~~
      for (const m of text.matchAll(/~~(.+?)~~/g)) {
        const content = m[1] || '';
        safeAdd(decos, base + m.index!, base + m.index! + 2, hiddenMark);
        safeAdd(
          decos,
          base + m.index! + 2,
          base + m.index! + 2 + content.length,
          Decoration.mark({ class: 'cm-live-strikethrough' }),
        );
        safeAdd(
          decos,
          base + m.index! + 2 + content.length,
          base + m.index! + 4 + content.length,
          hiddenMark,
        );
      }

      // Wiki-link: [[target]] 或 [[target|alias]]
      for (const m of text.matchAll(/\[\[(.+?)\]\]/g)) {
        safeAdd(
          decos,
          base + m.index!,
          base + m.index! + m[0].length,
          Decoration.mark({ class: 'cm-live-wikilink' }),
        );
      }

      // Inline tag: #tag
      for (const m of text.matchAll(/#([\w一-鿿-]+)/g)) {
        safeAdd(
          decos,
          base + m.index!,
          base + m.index! + m[0].length,
          Decoration.mark({ class: 'cm-live-tag' }),
        );
      }

      // Markdown link: [text](url) — hide syntax, style text
      for (const m of text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
        const linkText = m[1] || '';
        const linkUrl = m[2] || '';
        // Hide opening bracket [
        safeAdd(decos, base + m.index!, base + m.index! + 1, hiddenMark);
        // Style display text
        safeAdd(
          decos,
          base + m.index! + 1,
          base + m.index! + 1 + linkText.length,
          Decoration.mark({ class: 'cm-live-link-text' }),
        );
        // Hide ][ between text and url
        safeAdd(
          decos,
          base + m.index! + 1 + linkText.length,
          base + m.index! + 1 + linkText.length + 2,
          hiddenMark,
        );
        // Style URL portion (dimmed)
        safeAdd(
          decos,
          base + m.index! + 1 + linkText.length + 2,
          base + m.index! + 1 + linkText.length + 2 + linkUrl.length,
          Decoration.mark({ class: 'cm-live-link-url' }),
        );
        // Hide closing )
        safeAdd(
          decos,
          base + m.index! + m[0].length - 1,
          base + m.index! + m[0].length,
          hiddenMark,
        );
      }

      // Naked URL: https://... — style as clickable link
      for (const m of text.matchAll(/https?:\/\/[^\s<>"{}|\\^`[\]]+/g)) {
        safeAdd(
          decos,
          base + m.index!,
          base + m.index! + m[0].length,
          Decoration.mark({ class: 'cm-live-url' }),
        );
      }

      // Image: ![alt](path) — replace with actual image widget
      for (const m of text.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
        const imgPath = m[2] || '';
        safeAdd(
          decos,
          base + m.index!,
          base + m.index! + m[0].length,
          Decoration.replace({ widget: new ImageWidget(imgPath) }),
        );
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);

// ================================================================
// Auto-Render Timer — 停止输入 2 秒后切回 Live Preview
// ================================================================

let autoRenderTimer: ReturnType<typeof setTimeout> | null = null;

const autoRenderPlugin = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {}

    update(update: ViewUpdate) {
      if (!update.docChanged) return;

      if (autoRenderTimer) clearTimeout(autoRenderTimer);
      autoRenderTimer = setTimeout(() => {
        // 将所有源码模式块切回 Live Preview
        const sourceBlocks = this.view.state.field(sourceBlocksField);
        if (sourceBlocks.size > 0) {
          const effects = [...sourceBlocks].map((id) => toggleBlockEffect.of({ blockId: id }));
          this.view.dispatch({ effects });
        }
      }, 2000);
    }

    destroy() {
      if (autoRenderTimer) clearTimeout(autoRenderTimer);
    }
  },
);

// ================================================================
// Commands
// ================================================================

/** Tab 切换当前块的源码/Live Preview 模式（非段落块） */
export function toggleBlockRender(view: EditorView): boolean {
  const pos = view.state.selection.main.head;
  const doc = view.state.doc.toString();
  const blocks = parseBlocks(doc, '');
  const block = blocks.find((b) => pos >= b.from && pos <= b.to);

  if (block && block.type !== 'paragraph') {
    view.dispatch({
      effects: toggleBlockEffect.of({ blockId: block.id }),
    });
    return true;
  }
  return false;
}

/** 强制将所有块设为 Live Preview */
export function enableLivePreviewAll(view: EditorView): void {
  view.dispatch({ effects: clearSourceBlocksEffect.of(null) });
}

// ================================================================
// Export
// ================================================================

export function livePreviewExtension() {
  return [sourceBlocksField, livePreviewPlugin, autoRenderPlugin];
}
