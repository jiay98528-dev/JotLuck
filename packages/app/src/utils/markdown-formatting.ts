import type { FormatAction, ParagraphPreset } from '@/types';
import { normalizeFullwidthMarkdownSyntax, stripToPlainText } from '@jotluck/renderer';

export interface FormattingEdit {
  changes: { from: number; to: number; insert: string };
  selection: { anchor: number; head: number };
}

export type InlineFormatAction = Exclude<FormatAction, ParagraphPreset | 'clear'>;

const INLINE_WRAPPERS: Record<InlineFormatAction, readonly [string, string]> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  strikethrough: ['~~', '~~'],
  inlineCode: ['`', '`'],
  link: ['[', '](url)'],
};

export function isInlineFormatAction(action: FormatAction): action is InlineFormatAction {
  return action in INLINE_WRAPPERS;
}

export function getInlineMarkers(action: InlineFormatAction): readonly [string, string] {
  return INLINE_WRAPPERS[action];
}

const BLOCK_PREFIX_RE = /^(\s{0,3})(?:[#＃]{1,6}[ \u3000]+|[>＞][ \u3000]?)/;

function edit(
  from: number,
  to: number,
  insert: string,
  selectionFrom: number,
  selectionTo: number,
): FormattingEdit {
  return {
    changes: { from, to, insert },
    selection: { anchor: selectionFrom, head: selectionTo },
  };
}

function findLinkAround(
  doc: string,
  from: number,
  to: number,
): { from: number; to: number } | null {
  if (from < 1 || doc[from - 1] !== '[' || doc[to] !== ']') return null;
  const suffix = /^\]\([^)]+\)/.exec(doc.slice(to));
  return suffix ? { from: from - 1, to: to + suffix[0].length } : null;
}

export function toggleInlineFormat(
  doc: string,
  from: number,
  to: number,
  action: InlineFormatAction,
): FormattingEdit {
  const selected = doc.slice(from, to);
  const [open, close] = INLINE_WRAPPERS[action];

  if (action === 'link') {
    const fullLink = /^\[([\s\S]*)\]\([^)]+\)$/.exec(selected);
    if (fullLink) {
      const inner = fullLink[1] ?? '';
      return edit(from, to, inner, from, from + inner.length);
    }
    const around = findLinkAround(doc, from, to);
    if (around)
      return edit(around.from, around.to, selected, around.from, around.from + selected.length);
  } else {
    if (
      selected.startsWith(open) &&
      selected.endsWith(close) &&
      selected.length >= open.length + close.length
    ) {
      const inner = selected.slice(open.length, selected.length - close.length);
      return edit(from, to, inner, from, from + inner.length);
    }
    if (
      from >= open.length &&
      doc.slice(from - open.length, from) === open &&
      doc.slice(to, to + close.length) === close
    ) {
      const replaceFrom = from - open.length;
      const replaceTo = to + close.length;
      return edit(replaceFrom, replaceTo, selected, replaceFrom, replaceFrom + selected.length);
    }
  }

  const insert = `${open}${selected}${close}`;
  return edit(from, to, insert, from + open.length, from + open.length + selected.length);
}

/**
 * 行内 Markdown → 纯文本 — 收口到 @jotluck/renderer 的 stripToPlainText。
 *
 * 与旧手写正则链相比，已知可接受收紧（在本切片范围内、用户感知为「更干净」）：
 *   1. 图片 `![alt](url)`：旧链只过链接规则 `[t](u) → t`，残留 `!alt`；
 *      stripToPlainText 先剥图片规则，产出干净的 `alt`（或 imagePlaceholder 回调产物）。
 *   2. 嵌套定界符（`**粗 *斜* 粗**`、`***x***` 等）由 stripToPlainText 的不动点循环剥净；
 *      顺带行首 heading / blockquote 前缀亦走不动点循环剥净（含多级 `>>>foo`、
 *      `## # 标题` 等）。
 *
 * 不剥列表标记（stripListMarkers: false）— 保持「清除格式」动作语义只剥行内格式，
 * 不动列表 bullet / 任务 checkbox / 有序编号。
 */
function stripInlineMarkdown(value: string): string {
  return stripToPlainText(value, { stripListMarkers: false });
}

export function clearMarkdownFormatting(doc: string, from: number, to: number): FormattingEdit {
  let replaceFrom = from;
  let replaceTo = to;
  let expanded = true;

  while (expanded) {
    expanded = false;
    for (const [open, close] of Object.values(INLINE_WRAPPERS).filter(
      ([candidateOpen]) => candidateOpen !== '[',
    )) {
      if (
        replaceFrom >= open.length &&
        doc.slice(replaceFrom - open.length, replaceFrom) === open &&
        doc.slice(replaceTo, replaceTo + close.length) === close
      ) {
        replaceFrom -= open.length;
        replaceTo += close.length;
        expanded = true;
        break;
      }
    }
    const linkAround = findLinkAround(doc, replaceFrom, replaceTo);
    if (linkAround) {
      replaceFrom = linkAround.from;
      replaceTo = linkAround.to;
      expanded = true;
    }
  }

  const cleaned = stripInlineMarkdown(doc.slice(replaceFrom, replaceTo));
  return edit(replaceFrom, replaceTo, cleaned, replaceFrom, replaceFrom + cleaned.length);
}

export function detectParagraphPreset(doc: string, position: number): ParagraphPreset {
  const lineStart = doc.lastIndexOf('\n', Math.max(0, position - 1)) + 1;
  const lineEndIndex = doc.indexOf('\n', position);
  const line = normalizeFullwidthMarkdownSyntax(
    doc.slice(lineStart, lineEndIndex === -1 ? doc.length : lineEndIndex),
  );
  if (/^\s{0,3}#\s+/.test(line)) return 'heading1';
  if (/^\s{0,3}##\s+/.test(line)) return 'heading2';
  if (/^\s{0,3}###\s+/.test(line)) return 'heading3';
  if (/^\s{0,3}>\s?/.test(line)) return 'blockquote';
  return 'paragraph';
}

export function applyParagraphPreset(
  doc: string,
  from: number,
  to: number,
  preset: ParagraphPreset,
  formatEmptyLine = false,
): FormattingEdit {
  const selectionEnd = to > from && doc[to - 1] === '\n' ? to - 1 : to;
  const lineFrom = doc.lastIndexOf('\n', Math.max(0, from - 1)) + 1;
  const nextBreak = doc.indexOf('\n', selectionEnd);
  const lineTo = nextBreak === -1 ? doc.length : nextBreak;
  const source = doc.slice(lineFrom, lineTo);
  const lines = source.split('\n');
  const prefixes: Record<ParagraphPreset, string> = {
    paragraph: '',
    heading1: '# ',
    heading2: '## ',
    heading3: '### ',
    blockquote: '> ',
  };
  const prefix = prefixes[preset];
  const transformed = lines
    .map((line) => {
      const match = BLOCK_PREFIX_RE.exec(line);
      const indent = match?.[1] ?? /^\s{0,3}/.exec(line)?.[0] ?? '';
      const content = match ? line.slice(match[0].length) : line.slice(indent.length);
      return content.length === 0 && !formatEmptyLine ? indent : `${indent}${prefix}${content}`;
    })
    .join('\n');

  if (from === to) {
    const firstLine = lines[0] ?? '';
    const oldPrefixLength = BLOCK_PREFIX_RE.exec(firstLine)?.[0].length ?? 0;
    const contentOffset = Math.max(0, from - lineFrom - oldPrefixLength);
    const caret = lineFrom + prefix.length + contentOffset;
    return edit(lineFrom, lineTo, transformed, caret, caret);
  }

  return edit(lineFrom, lineTo, transformed, lineFrom, lineFrom + transformed.length);
}
