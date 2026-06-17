/**
 * cm6-live-preview — CodeMirror 6 块级即时渲染
 *
 * 逐行渲染 Markdown：焦点行显示源码，其余行显示渲染 HTML。
 * TAB 固定当前 block 为源码模式，ESC 解除。
 *
 * 核心约束：Decoration.replace 不能跨越换行符（CM6 硬限制）。
 * 策略：所有 block 按行拆分，每行独立 Decoration.replace。
 *       多行 block 通过 CSS data-block-group 相邻选择器视觉连接。
 *       引用式链接/图片通过全文预收集 [ref]:url 定义解决。
 *
 * @see dual-view-spec.md
 */
import {
  Decoration,
  ViewPlugin,
  WidgetType,
  EditorView,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { StateField, StateEffect, type Range } from '@codemirror/state';
import { renderMarkdown } from '@markluck/renderer';
import DOMPurify from 'dompurify';
import { normalizeUrl } from '@/utils/urlUtils';

// ---- HTML 转义 ----

function escapeAttr(text: string): string {
  return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---- Reference Definitions ----

const REF_DEF_RE = /^\s*\[([^\]]+)\]:\s*(\S+)(?:\s+"([^"]*)")?\s*$/;

/**
 * 扫描全文收集引用式链接/图片定义。
 * 渲染每 block 时前置注入，确保 marked 能解析 [text][ref] 和 ![img][ref]。
 */
function collectRefDefs(text: string): Map<string, string> {
  const refs = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = REF_DEF_RE.exec(line);
    if (m) refs.set(m[1]!.toLowerCase(), line);
  }
  return refs;
}

/**
 * 将引用定义注入到 block 文本前，确保跨 block 引用可解析。
 */
function renderBlock(raw: string, _type: string, refDefs: Map<string, string>): string {
  if (refDefs.size === 0) return renderMarkdown(raw);
  const prefix = [...refDefs.values()].join('\n');
  return renderMarkdown(prefix + '\n\n' + raw);
}

// ---- Block Types ----

/**
 * 单行 block 类型 — 可安全使用 Decoration.replace。
 * 多行 block（codeFence/table/blockquote/list）按行拆分为多个 LiveBlock。
 */
type BlockType =
  | 'heading'
  | 'setextHeadingText'
  | 'setextHeadingRule'
  | 'paragraph'
  | 'codeFenceLine'
  | 'blockquoteLine'
  | 'unorderedListItem'
  | 'orderedListItem'
  | 'taskListItem'
  | 'horizontalRule'
  | 'tableRow'
  | 'frontmatterLine'
  | 'refDefinition'
  | 'empty';

interface LiveBlock {
  key: string;
  from: number;
  to: number;
  type: BlockType;
  raw: string;
  html: string;
  /** 多行 block 共享的分组键，CSS 用 [data-block-group] 连接 */
  groupKey?: string;
  /** 在多行 block 中的位置 */
  position?: 'first' | 'middle' | 'last' | 'single';
  /** 有序列表项在组内的序号 (1-based)，用于内联编号 */
  itemIndex?: number;
}

interface LivePreviewOptions {
  onExternalLinkClick?: (href: string) => void;
  onTagClick?: (tag: string) => void;
  onWikiLinkClick?: (note: string, anchor: null | string) => void;
}

/** 生成稳定 block ID：行号 + 内容 hash，编辑上方内容不会改变 key */
function blockKey(lineNumber: number, raw: string): string {
  let h = 0;
  const s = raw.substring(0, 32);
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `L${lineNumber}_${Math.abs(h).toString(36)}`;
}

function groupKey(lineNumber: number): string {
  return `G${lineNumber}`;
}

// ---- Block Parser ----

function parseLiveBlocks(text: string): LiveBlock[] {
  const lines = text.split('\n');
  const blocks: LiveBlock[] = [];
  let pos = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const lineLen = line.length;
    const startPos = pos;

    // Frontmatter opener (at document start only)
    if (i === 0 && line.trim() === '---') {
      const group = groupKey(i);
      blocks.push({
        key: blockKey(i, line),
        from: startPos,
        to: startPos + lineLen,
        type: 'frontmatterLine',
        raw: line,
        html: '',
        groupKey: group,
        position: 'first',
      });
      pos = startPos + lineLen + 1;
      i++;
      let _j = 0;
      while (i < lines.length) {
        const fl = lines[i] ?? '';
        const flLen = fl.length;
        const isLast = fl.trim() === '---';
        blocks.push({
          key: blockKey(i, fl),
          from: pos,
          to: pos + flLen,
          type: 'frontmatterLine',
          raw: fl,
          html: '',
          groupKey: group,
          position: isLast ? 'last' : 'middle',
        });
        pos = pos + flLen + 1;
        i++;
        _j++;
        if (isLast) break;
      }
      continue;
    }

    // Reference definition line
    if (REF_DEF_RE.test(line)) {
      pos = startPos + lineLen + 1;
      i++;
      continue; // skip — not rendered as a block
    }

    // Empty line
    if (line.trim() === '') {
      pos = startPos + lineLen + 1;
      i++;
      continue;
    }

    // Code fence block ``` ... ```
    if (line.startsWith('```')) {
      const group = groupKey(i);
      blocks.push({
        key: blockKey(i, line),
        from: startPos,
        to: startPos + lineLen,
        type: 'codeFenceLine',
        raw: line,
        html: '',
        groupKey: group,
        position: 'first',
      });
      pos = startPos + lineLen + 1;
      i++;
      while (i < lines.length) {
        const cl = lines[i] ?? '';
        const clLen = cl.length;
        const isLast = cl.startsWith('```');
        blocks.push({
          key: blockKey(i, cl),
          from: pos,
          to: pos + clLen,
          type: 'codeFenceLine',
          raw: cl,
          html: '',
          groupKey: group,
          position: isLast ? 'last' : 'middle',
        });
        pos = pos + clLen + 1;
        i++;
        if (isLast) {
          break;
        }
      }
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      blocks.push({
        key: blockKey(i, line),
        from: startPos,
        to: startPos + lineLen,
        type: 'horizontalRule',
        raw: line,
        html: '',
      });
      pos = startPos + lineLen + 1;
      i++;
      continue;
    }

    // ATX Heading
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      blocks.push({
        key: blockKey(i, line),
        from: startPos,
        to: startPos + lineLen,
        type: 'heading',
        raw: line,
        html: '',
      });
      pos = startPos + lineLen + 1;
      i++;
      continue;
    }

    // Setext Heading (needs lookahead to next line)
    if (i + 1 < lines.length) {
      const nextLine = lines[i + 1] ?? '';
      if (/^=+\s*$/.test(nextLine) || /^-+\s*$/.test(nextLine)) {
        // Text line
        blocks.push({
          key: blockKey(i, line),
          from: startPos,
          to: startPos + lineLen,
          type: 'setextHeadingText',
          raw: line,
          html: '',
        });
        // Rule line
        const ruleLen = nextLine.length;
        const rulePos = startPos + lineLen + 1;
        blocks.push({
          key: blockKey(i + 1, nextLine),
          from: rulePos,
          to: rulePos + ruleLen,
          type: 'setextHeadingRule',
          raw: nextLine,
          html: '',
        });
        pos = rulePos + ruleLen + 1;
        i += 2;
        continue;
      }
    }

    // Blockquote
    if (line.startsWith('>')) {
      const group = groupKey(i);
      let firstInGroup = true;
      while (i < lines.length && (lines[i] ?? '').startsWith('>')) {
        const bl = lines[i] ?? '';
        const blLen = bl.length;
        const blPos = pos;
        blocks.push({
          key: blockKey(i, bl),
          from: blPos,
          to: blPos + blLen,
          type: 'blockquoteLine',
          raw: bl,
          html: '',
          groupKey: group,
          position: firstInGroup ? 'first' : 'middle',
        });
        firstInGroup = false;
        pos = blPos + blLen + 1;
        i++;
      }
      // Mark last as 'last' if group has >1 lines
      const bqBlocks = blocks.filter((b) => b.groupKey === group);
      if (bqBlocks.length > 1) {
        bqBlocks[bqBlocks.length - 1]!.position = 'last';
        bqBlocks[0]!.position = 'first';
      } else if (bqBlocks.length === 1) {
        bqBlocks[0]!.position = 'single';
      }
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s/.test(line)) {
      const group = groupKey(i);
      while (i < lines.length && /^\s*[-*+]\s/.test(lines[i] ?? '')) {
        const ll = lines[i] ?? '';
        const llLen = ll.length;
        const lp = pos;
        // Check for task list
        const isTask = /^\s*- \[[ x]\]\s/.test(ll);
        blocks.push({
          key: blockKey(i, ll),
          from: lp,
          to: lp + llLen,
          type: isTask ? 'taskListItem' : 'unorderedListItem',
          raw: ll,
          html: '',
          groupKey: group,
        });
        pos = lp + llLen + 1;
        i++;
      }
      const groupBlocks = blocks.filter((b) => b.groupKey === group);
      if (groupBlocks.length === 1) groupBlocks[0]!.position = 'single';
      else {
        groupBlocks[0]!.position = 'first';
        groupBlocks[groupBlocks.length - 1]!.position = 'last';
        for (let gi = 1; gi < groupBlocks.length - 1; gi++) groupBlocks[gi]!.position = 'middle';
      }
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s/.test(line)) {
      const group = groupKey(i);
      let oi = 0;
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i] ?? '')) {
        const ll = lines[i] ?? '';
        const llLen = ll.length;
        const lp = pos;
        oi++;
        blocks.push({
          key: blockKey(i, ll),
          from: lp,
          to: lp + llLen,
          type: 'orderedListItem',
          raw: ll,
          html: '',
          groupKey: group,
          itemIndex: oi,
        });
        pos = lp + llLen + 1;
        i++;
      }
      const groupBlocks = blocks.filter((b) => b.groupKey === group);
      if (groupBlocks.length === 1) groupBlocks[0]!.position = 'single';
      else {
        groupBlocks[0]!.position = 'first';
        groupBlocks[groupBlocks.length - 1]!.position = 'last';
        for (let gi = 1; gi < groupBlocks.length - 1; gi++) groupBlocks[gi]!.position = 'middle';
      }
      continue;
    }

    // Table row
    if (line.includes('|') && line.trim().startsWith('|')) {
      const group = groupKey(i);
      while (i < lines.length && (lines[i] ?? '').includes('|')) {
        const tl = lines[i] ?? '';
        const tlLen = tl.length;
        const tp = pos;
        blocks.push({
          key: blockKey(i, tl),
          from: tp,
          to: tp + tlLen,
          type: 'tableRow',
          raw: tl,
          html: '',
          groupKey: group,
        });
        pos = tp + tlLen + 1;
        i++;
      }
      const tblBlocks = blocks.filter((b) => b.groupKey === group);
      if (tblBlocks.length === 1) tblBlocks[0]!.position = 'single';
      else {
        tblBlocks[0]!.position = 'first';
        // Mark separator row
        if (tblBlocks.length > 1 && /^\|[\s\-:|]+\|$/.test(tblBlocks[1]?.raw ?? '')) {
          tblBlocks[1]!.type = 'tableRow'; // keep as tableRow, CSS handles styling
        }
        tblBlocks[tblBlocks.length - 1]!.position = 'last';
        for (let gi = 1; gi < tblBlocks.length - 1; gi++) tblBlocks[gi]!.position = 'middle';
      }
      continue;
    }

    // Default paragraph
    blocks.push({
      key: blockKey(i, line),
      from: startPos,
      to: startPos + lineLen,
      type: 'paragraph',
      raw: line,
      html: '',
    });
    pos = startPos + lineLen + 1;
    i++;
  }

  // Compute HTML for each block
  const refDefsForRender = collectRefDefs(text);
  for (const block of blocks) {
    block.html = renderBlockHtml(block, refDefsForRender);
  }

  return blocks;
}

function renderBlockHtml(block: LiveBlock, refDefs: Map<string, string>): string {
  try {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
        return wrapBlockHtml(renderBlock(block.raw, block.type, refDefs), block);

      case 'unorderedListItem':
      case 'taskListItem': {
        // Strip outer <ul> wrapper — each item is independently rendered,
        // CSS ::before pseudo-elements + adjacent selectors connect them visually.
        const raw = renderBlock(block.raw, block.type, refDefs);
        const inner = raw.replace(/<\/?ul>\n?/g, '');
        return wrapBlockHtml(inner, block);
      }

      case 'orderedListItem': {
        // Inline numbering: strip <ol> + <li> wrappers, prepend itemIndex.
        // Marked produces <ol><li>content</li></ol>, we want "N. content".
        const raw = renderBlock(block.raw, 'paragraph', refDefs);
        const text = raw
          .replace(/<\/?ol>\n?/g, '')
          .replace(/<\/?li>/g, '')
          .replace(/^<p>/, '')
          .replace(/<\/p>\n?$/, '');
        const num = block.itemIndex ?? 1;
        const prefixed = `${num}.  ${text || ' '}`;
        return wrapBlockHtml(prefixed, block);
      }

      case 'horizontalRule':
        return wrapBlockHtml('<hr>', block);

      case 'codeFenceLine': {
        const isFence = block.raw.trim().startsWith('```');
        if (isFence && block.position !== 'first') {
          // Closing fence — show it styled as empty
          return wrapBlockHtml('', block);
        }
        if (isFence) {
          // Opening fence — show language label if present
          const lang = block.raw.trim().replace(/^```/, '').trim();
          return wrapBlockHtml(
            lang ? `<span class="cm-code-lang">${escapeAttr(lang)}</span>` : '',
            block,
          );
        }
        // Code content line — HTML-escape to prevent rendering
        const escaped = block.raw
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        return wrapBlockHtml(escaped, block);
      }

      case 'blockquoteLine': {
        // Strip outer <blockquote> — each line independently rendered,
        // CSS border-left connects them visually.
        const content = block.raw.replace(/^>\s?/, '');
        const raw = renderBlock(content, 'paragraph', refDefs);
        const inner = raw
          .replace(/<\/?blockquote>\n?/g, '')
          .replace(/^<p>/, '')
          .replace(/<\/p>\n?$/, '');
        return wrapBlockHtml(inner, block);
      }

      case 'setextHeadingText': {
        // Render as heading; level depends on the rule line (not available here, default h2)
        const html = renderBlock(block.raw, 'heading', refDefs);
        return wrapBlockHtml(html, block);
      }

      case 'setextHeadingRule':
        // Empty widget — hidden by CSS
        return '';

      case 'tableRow':
        // Render each cell separately for proper table styling
        return wrapBlockHtml(renderBlock(block.raw, 'paragraph', refDefs), block);

      case 'frontmatterLine':
        // Dim the frontmatter lines
        return wrapBlockHtml(
          `<span style="opacity:0.5">${block.raw.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>`,
          block,
        );

      default:
        return wrapBlockHtml(block.raw, block);
    }
  } catch {
    return wrapBlockHtml(block.raw, block);
  }
}

/**
 * 包裹渲染 HTML，添加 data 属性供 CSS 选择器使用。
 */
function wrapBlockHtml(html: string, block: LiveBlock): string {
  const attrs: string[] = [
    `data-block-key="${escapeAttr(block.key)}"`,
    `data-block-type="${escapeAttr(block.type)}"`,
  ];
  if (block.groupKey) attrs.push(`data-block-group="${escapeAttr(block.groupKey)}"`);
  if (block.position) attrs.push(`data-block-position="${escapeAttr(block.position)}"`);

  return `<span class="cm-live-block" ${attrs.join(' ')}>${html}</span>`;
}

// ---- Widgets ----

/**
 * 渲染块 Widget：将安全 HTML 插入 CM6 editor DOM。
 * XSS 防护：通过 DOMPurify.sanitize + RETURN_DOM_FRAGMENT 创建 DOM。
 */
class RenderedBlockWidget extends WidgetType {
  private html: string;
  private key: string;

  constructor(html: string, key: string) {
    super();
    this.html = html;
    this.key = key;
  }

  override eq(other: RenderedBlockWidget): boolean {
    return this.html === other.html && this.key === other.key;
  }

  toDOM(): HTMLElement {
    const frag = DOMPurify.sanitize(this.html, { RETURN_DOM_FRAGMENT: true }) as DocumentFragment;
    // If sanitization produced a fragment, wrap it; otherwise return the existing span
    if (frag.childNodes.length === 1) {
      const child = frag.firstChild as HTMLElement;
      if (child.classList?.contains('cm-live-block')) return child;
    }
    const span = document.createElement('span');
    span.className = 'cm-live-block';
    span.setAttribute('data-block-key', this.key);
    // Get attributes from the HTML string (parse them)
    const m = /<span class="cm-live-block"([^>]*)>/.exec(this.html);
    if (m?.[1]) {
      const attrStr = m[1];
      // Copy data attributes
      for (const attr of ['data-block-type', 'data-block-group', 'data-block-position']) {
        const am = new RegExp(`${attr}="([^"]*)"`).exec(attrStr);
        if (am?.[1]) span.setAttribute(attr, am[1]);
      }
    }
    span.appendChild(frag);
    return span;
  }

  /** 允许点击穿透 → CM6 将光标移到此处 → 源码切换 */
  override ignoreEvent(): boolean {
    return false;
  }
}

/**
 * 零尺寸空 Widget：用于 Setext 标题底线等需要隐藏的行。
 */
class EmptyWidget extends WidgetType {
  override toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.style.display = 'none';
    return span;
  }
  override eq(): boolean {
    return true;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

// ---- Pin State (block-key based, survives edits) ----

const pinSourceEffect = StateEffect.define<{ key: string }>();
const unpinSourceEffect = StateEffect.define<{ key: string }>();

const pinnedSourceField = StateField.define<Set<string>>({
  create() {
    return new Set();
  },
  update(set, tr) {
    const result = new Set(set);
    for (const e of tr.effects) {
      if (e.is(pinSourceEffect)) result.add(e.value.key);
      else if (e.is(unpinSourceEffect)) result.delete(e.value.key);
    }
    return result;
  },
});

// ---- ViewPlugin ----

function toggleTaskListItemAtWidget(view: EditorView, widget: Element): boolean {
  const pos = view.posAtDOM(widget);
  const line = view.state.doc.lineAt(pos);
  const lineText = line.text;
  const uncheckedRe = /^(\s*[-*+]\s+)\[ \]\s?/;
  const checkedRe = /^(\s*[-*+]\s+)\[x\]\s?/;

  let newText = lineText;
  if (uncheckedRe.test(lineText)) {
    newText = lineText.replace(uncheckedRe, '$1[x] ');
  } else if (checkedRe.test(lineText)) {
    newText = lineText.replace(checkedRe, '$1[ ] ');
  }

  if (newText === lineText) return false;
  view.dispatch({ changes: { from: line.from, to: line.to, insert: newText } });
  return true;
}

function handleLiveAnchorClick(anchor: HTMLAnchorElement, options: LivePreviewOptions): boolean {
  const tag = anchor.getAttribute('data-tag');
  if (tag) {
    options.onTagClick?.(tag);
    return true;
  }

  const note = anchor.getAttribute('data-note');
  if (note) {
    options.onWikiLinkClick?.(note, anchor.getAttribute('data-anchor'));
    return true;
  }

  const href = anchor.getAttribute('href');
  if (href) {
    if (options.onExternalLinkClick) {
      options.onExternalLinkClick(href);
    } else {
      window.open(normalizeUrl(href), '_blank', 'noopener,noreferrer');
    }
    return true;
  }

  return false;
}

function createLivePreviewPlugin(options: LivePreviewOptions = {}) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      /** True while an IME composition is in progress — skip decoration rebuilds */
      isComposing = false;
      /** Set to true in destroy() — prevents rAF callbacks on destroyed views */
      destroyed = false;
      editorView: EditorView | null = null;
      // Stored listener refs for cleanup
      onClick: ((e: MouseEvent) => void) | null = null;
      onPointerDownCapture: ((e: PointerEvent) => void) | null = null;
      onCompStart: (() => void) | null = null;
      onCompEnd: (() => void) | null = null;
      compositionRebuildTimer: ReturnType<typeof setTimeout> | null = null;
      // rAF handle for deferred initialization
      __initRAF: number | null = null;

      constructor(view: EditorView) {
        this.editorView = view;
        // Delay to next frame so EditorView is fully initialized before building decorations
        this.decorations = Decoration.none;
        const rAFId = requestAnimationFrame(() => {
          if (this.destroyed || this.isImeActive(view)) return;
          this.decorations = this.build(view);
          view.dispatch({});
        });
        this.__initRAF = rAFId;

        // ── IME composition guard ──────────────────────────────
        // During IME composition, CM6 fires docChanged on every
        // intermediate compositionupdate. We MUST NOT rebuild
        // decorations during this window — Decoration.replace
        // corrupts the IME preview (duplicate lines, cursor jumps,
        // swallowed characters).
        //
        // KEY: Do NOT clear decorations on compositionstart.
        // Clearing causes ALL rendered blocks to flash back to raw
        // source, which is visually jarring. Instead, just pause
        // rebuilds — existing decorations stay in place.
        const onCompStart = () => {
          this.isComposing = true;
          this.clearPendingCompositionRebuild();
        };
        const onCompEnd = () => {
          this.isComposing = false;
          if (this.destroyed) return;
          this.scheduleCompositionRebuild(view);
        };
        this.onCompStart = onCompStart;
        this.onCompEnd = onCompEnd;
        view.contentDOM.addEventListener('compositionstart', onCompStart, { passive: true });
        view.contentDOM.addEventListener('compositionend', onCompEnd, { passive: true });

        // Click handler — map rendered widget clicks back to source positions.
        // Relying on CM6's default DOM mapping for replaced widgets can move the
        // cursor to a wrong line, which is especially disruptive for IME input.
        const onClick = (e: MouseEvent) => {
          const target = e.target as HTMLElement;
          const checkbox = target.closest('input[type="checkbox"]');
          if (checkbox) {
            const widget = checkbox.closest('.cm-live-block[data-block-type="taskListItem"]');
            if (!widget) return;
            e.stopPropagation();
            e.preventDefault();
            toggleTaskListItemAtWidget(view, widget);
            view.focus();
            return;
          }

          const anchor = target.closest('a') as HTMLAnchorElement | null;
          if (anchor && handleLiveAnchorClick(anchor, options)) {
            e.stopPropagation();
            e.preventDefault();
            return;
          }

          const widget = target.closest('.cm-live-block') as HTMLElement | null;
          if (!widget) return;
          const block = this.findBlockForWidget(view, widget);
          if (!block) return;

          e.stopPropagation();
          e.preventDefault();

          if (!e.ctrlKey && !e.metaKey) {
            view.dispatch({ selection: { anchor: block.from }, scrollIntoView: true });
            view.focus();
            return;
          }

          const pinned = view.state.field(pinnedSourceField, false) ?? new Set<string>();
          const isPinned = pinned.has(block.key);

          view.dispatch({
            effects: isPinned
              ? unpinSourceEffect.of({ key: block.key })
              : pinSourceEffect.of({ key: block.key }),
            selection: { anchor: block.from },
            scrollIntoView: true,
          });
          view.focus();
        };
        this.onClick = onClick;
        view.dom.addEventListener('click', onClick);

        // ── Pointer-down capture: intercept checkbox/link clicks BEFORE CM6 ─
        // CM6's internal mousedown handler fires during the bubbling phase and
        // dispatches a selection change that moves the cursor to the widget's
        // position. This triggers update() → the block becomes focused → the
        // widget is replaced with source text → by the time 'click' fires, the
        // <a> and <input> have been removed from the DOM.
        //
        // By listening on pointerdown in the CAPTURE phase, we run BEFORE CM6
        // and can prevent the cursor move for checkbox/link interactions.
        const onPointerDownCapture = (e: PointerEvent) => {
          if (this.destroyed) return;
          const target = e.target as HTMLElement;

          // Block CM6 from handling clicks on checkboxes — we toggle via onClick
          if (target.closest('input[type="checkbox"]')) {
            e.stopPropagation();
            e.preventDefault();
            return;
          }

          // Block CM6 from handling clicks on links (Wiki-link, #tag, external)
          const anchor = target.closest('a') as HTMLAnchorElement | null;
          if (anchor) {
            const hasTag = anchor.getAttribute('data-tag');
            const hasNote = anchor.getAttribute('data-note');
            const hasHref = anchor.getAttribute('href');
            if (hasTag || hasNote || hasHref) {
              e.stopPropagation();
              e.preventDefault();
              return;
            }
          }
        };
        this.onPointerDownCapture = onPointerDownCapture;
        view.dom.addEventListener('pointerdown', onPointerDownCapture, true);
      }

      update(update: ViewUpdate) {
        // Skip decoration rebuild during IME composition to avoid corrupting
        // the composition preview (duplicate lines, cursor jumps, swallowed chars).
        // Two-layer detection: DOM compositionstart flag + CM6 transaction annotation.
        // IME guard: pause rebuilds during composition, but keep existing
        // decorations — clearing them removes all rendered blocks (BUG-036).
        if (this.isImeActive(update.view, update)) {
          this.clearPendingCompositionRebuild();
          return;
        }
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = this.build(update.view);
        }
      }

      isImeActive(view: EditorView, update?: ViewUpdate): boolean {
        return (
          this.isComposing ||
          view.composing ||
          view.compositionStarted ||
          !!update?.transactions.some((tr) => tr.isUserEvent('input.type.compose'))
        );
      }

      findBlockForWidget(view: EditorView, widget: HTMLElement): LiveBlock | null {
        const blockKey = widget.getAttribute('data-block-key');
        if (!blockKey) return null;
        return (
          parseLiveBlocks(view.state.doc.toString()).find((block) => block.key === blockKey) ?? null
        );
      }

      clearPendingCompositionRebuild(): void {
        if (this.compositionRebuildTimer) {
          clearTimeout(this.compositionRebuildTimer);
          this.compositionRebuildTimer = null;
        }
      }

      scheduleCompositionRebuild(view: EditorView): void {
        this.clearPendingCompositionRebuild();
        this.compositionRebuildTimer = setTimeout(() => {
          this.compositionRebuildTimer = null;
          if (this.destroyed || this.isImeActive(view)) return;
          this.decorations = this.build(view);
          view.dispatch({});
        }, 80);
      }

      build(view: EditorView): DecorationSet {
        const text = view.state.doc.toString();
        const blocks = parseLiveBlocks(text);
        const cursor = view.state.selection.main.head;
        const pinned = view.state.field(pinnedSourceField, false) ?? new Set<string>();
        const decos: Range<Decoration>[] = [];

        for (const block of blocks) {
          if (!block.html) continue; // skip blocks with no visible HTML

          const isFocused = cursor >= block.from && cursor <= block.to;
          const isPinned = pinned.has(block.key);
          // Only show source for the exact focused block or pinned blocks.
          // Removed touchesEmptyCursorLine — it forced users to press Enter
          // twice before format symbols disappeared after line breaks.
          // The cursor-on-empty-line-below-block case is already handled by
          // isFocused (cursor is NOT on the block, so it renders normally).

          if (isFocused || isPinned) continue; // show source

          // Only decorate if the range is within a single line (no newline chars)
          if (block.raw.includes('\n')) continue; // safety: never decorate multi-line ranges

          if (block.type === 'setextHeadingRule') {
            decos.push(
              Decoration.replace({ widget: new EmptyWidget() }).range(block.from, block.to),
            );
          } else {
            decos.push(
              Decoration.replace({
                widget: new RenderedBlockWidget(block.html, block.key),
              }).range(block.from, block.to),
            );
          }
        }

        return Decoration.set(decos, true);
      }

      destroy() {
        this.destroyed = true;
        if (this.editorView) {
          // Cancel pending rAF callback
          if (this.__initRAF) cancelAnimationFrame(this.__initRAF);
          this.clearPendingCompositionRebuild();
          // Remove IME listeners from contentDOM
          const cd = this.editorView.contentDOM;
          if (this.onCompStart) cd.removeEventListener('compositionstart', this.onCompStart);
          if (this.onCompEnd) cd.removeEventListener('compositionend', this.onCompEnd);
          // Remove click/pointerdown listeners from dom
          const dom = this.editorView.dom;
          if (this.onClick) dom.removeEventListener('click', this.onClick);
          if (this.onPointerDownCapture)
            dom.removeEventListener('pointerdown', this.onPointerDownCapture, true);
          this.editorView = null;
        }
        this.onCompStart = null;
        this.onCompEnd = null;
        this.onClick = null;
        this.onPointerDownCapture = null;
      }
    },
    { decorations: (v) => v.decorations },
  );
}

// ---- Exports ----

export function livePreviewExtension(options: LivePreviewOptions = {}) {
  return [pinnedSourceField, createLivePreviewPlugin(options)];
}

/** TAB 切换当前聚焦 block 的 pin 状态 */
export function toggleBlockRender(view: EditorView): boolean {
  const text = view.state.doc.toString();
  const blocks = parseLiveBlocks(text);
  const cursor = view.state.selection.main.head;
  const target = blocks.find((b) => cursor >= b.from && cursor <= b.to);
  if (!target) return false;

  const pinned = view.state.field(pinnedSourceField, false) ?? new Set<string>();
  const isPinned = pinned.has(target.key);

  view.dispatch({
    effects: isPinned
      ? unpinSourceEffect.of({ key: target.key })
      : pinSourceEffect.of({ key: target.key }),
  });

  return true;
}

/** ESC 取消当前聚焦 block 的 pin 状态 */
export function unpinFocusedBlock(view: EditorView): boolean {
  const text = view.state.doc.toString();
  const blocks = parseLiveBlocks(text);
  const cursor = view.state.selection.main.head;
  const target = blocks.find((b) => cursor >= b.from && cursor <= b.to);
  if (!target) return false;

  const pinned = view.state.field(pinnedSourceField, false) ?? new Set<string>();
  if (!pinned.has(target.key)) {
    // Not pinned, just move cursor to trigger re-render
    view.dispatch({ selection: { anchor: cursor } });
    return true;
  }

  view.dispatch({
    effects: unpinSourceEffect.of({ key: target.key }),
  });
  return true;
}
