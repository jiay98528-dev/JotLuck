import { inlineSourceTokens, normalizeFullwidthMarkdownSyntax } from '@jotluck/renderer';
import type { Token } from 'marked';

export interface TextSourceMap {
  text: string;
  starts: number[];
  ends: number[];
}

/** Token ranges, not a document-wide search for the displayed word, determine offsets. */
export function inlineSourceMap(
  source: string,
  from = 0,
  literal = false,
  definitions = '',
): TextSourceMap {
  const result: TextSourceMap = { text: '', starts: [], ends: [] };
  const append = (text: string, start: number, end = start + text.length) => {
    result.text += text;
    for (let i = 0; i < text.length; i++) {
      result.starts.push(from + Math.min(start + i, end - 1));
      result.ends.push(from + Math.min(start + i + 1, end));
    }
  };
  const plain = (raw: string, offset: number, entities: boolean) => {
    for (let i = 0; i < raw.length; ) {
      const entity = entities && /^&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/i.exec(raw.slice(i));
      if (entity) {
        const textarea = document.createElement('textarea');
        textarea.innerHTML = entity[0];
        const value = textarea.value;
        const before = result.text.length;
        append(value, offset + i, offset + i + entity[0].length);
        for (let k = before; k < result.text.length; k++) {
          result.starts[k] = from + offset + i;
          result.ends[k] = from + offset + i + entity[0].length;
        }
        i += entity[0].length;
      } else {
        append(raw[i]!, offset + i);
        i++;
      }
    }
  };
  const walk = (tokens: Token[], offset: number) => {
    for (const token of tokens) {
      const raw = token.raw;
      const children = 'tokens' in token ? (token.tokens as Token[] | undefined) : undefined;
      if (children?.length) {
        const content = children.map((child) => child.raw).join('');
        const at = raw.indexOf(content);
        if (at >= 0) walk(children, offset + at);
      } else if (token.type === 'escape') plain(raw.slice(1), offset + 1, false);
      else if (token.type === 'codespan') {
        const opening = /^`+/.exec(raw)?.[0].length ?? 0;
        const content = raw.slice(opening, -opening);
        const trim =
          content.startsWith(' ') && content.endsWith(' ') && /[^ ]/.test(content) ? 1 : 0;
        plain(content.slice(trim, trim ? -trim : undefined), offset + opening + trim, false);
      } else if (token.type === 'wikiLink') {
        const text = String(token.text ?? '');
        const begin = raw.includes('|') ? raw.indexOf('|') + 1 : 2;
        const at = raw.indexOf(text, begin);
        plain(text, offset + Math.max(begin, at), false);
      } else if (token.type !== 'image' && token.type !== 'html' && token.type !== 'br') {
        plain(raw, offset, token.type !== 'tag');
      }
      offset += raw.length;
    }
  };
  if (literal) plain(source, 0, false);
  else walk(inlineSourceTokens(normalizeFullwidthMarkdownSyntax(source), definitions), 0);
  return result;
}

/** Snap UTF-16 offsets to grapheme boundaries, including ZWJ emoji and combining marks. */
export function snapSourceBoundary(source: string, offset: number): number {
  offset = Math.max(0, Math.min(source.length, offset));
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  for (const segment of segmenter.segment(source)) {
    const end = segment.index + segment.segment.length;
    if (offset <= end) return offset - segment.index < end - offset ? segment.index : end;
  }
  return source.length;
}

export function mapDomText(root: HTMLElement, map: TextSourceMap): WeakMap<Node, number[]> {
  const nodes = new WeakMap<Node, number[]>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement?.closest('.cm-list-marker-slot, button, .remote-image, .cm-task-toggle'))
      continue;
    const text = node.textContent ?? '';
    if (!text) continue;
    // Ordered consumption within a single token-derived block prevents duplicate-word jumps.
    const at = map.text.indexOf(text, consumed);
    if (at < 0) continue;
    const positions = Array.from({ length: text.length }, (_, i) => map.starts[at + i]!);
    positions.push(map.ends[at + text.length - 1]!);
    nodes.set(node, positions);
    consumed = at + text.length;
  }
  return nodes;
}

export function caretAtPoint(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position) return { node: position.offsetNode, offset: position.offset };
  const range = doc.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}
