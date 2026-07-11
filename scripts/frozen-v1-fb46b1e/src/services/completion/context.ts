import type {
  CompletionBlockType,
  CompletionContext,
  CompletionLanguageHint,
  CompletionLine,
  PredictorIndexData,
  SyntaxContext,
} from './types';
import type { CompletionSettings } from '../CompletionSettings';

export function buildCompletionContext(args: {
  doc: string;
  cursorPos: number;
  settings: CompletionSettings;
  indexData: PredictorIndexData | null;
  n: number;
}): CompletionContext {
  const line = getLineAt(args.cursorPos, args.doc);
  const syntax = detectSyntaxContext(args.cursorPos, args.doc);
  const disabled =
    isInFencedCode(args.cursorPos, args.doc) || isInFrontmatter(args.cursorPos, args.doc);
  const emptyLine = line ? line.text.trim() === '' : args.doc.length === 0;
  const atEndOfLine = args.cursorPos === args.doc.length || args.doc[args.cursorPos] === '\n';
  const languageHint = detectLanguageHint(line?.beforeCursor ?? args.doc.slice(0, args.cursorPos));
  const blockType = detectBlockType(args.cursorPos, args.doc, line, disabled);
  const paragraphStart = getParagraphStart(args.cursorPos, args.doc);
  const paragraphBeforeCursor = args.doc.slice(paragraphStart, args.cursorPos);
  const sentencePrefix = getSentencePrefix(line?.beforeCursor ?? '');
  const recentTokens = extractRecentTokens(paragraphBeforeCursor || line?.beforeCursor || '');

  return {
    doc: args.doc,
    cursorPos: args.cursorPos,
    line,
    syntax,
    settings: args.settings,
    indexData: args.indexData,
    n: args.n,
    disabled,
    emptyLine,
    atEndOfLine,
    languageHint,
    blockType,
    paragraphBeforeCursor,
    paragraphStart,
    sentencePrefix,
    recentTokens,
  };
}

export function detectLanguageHint(text: string): CompletionLanguageHint {
  const tail = text.slice(-48);
  const cjkCount = (tail.match(/[\u3400-\u9fff]/gu) ?? []).length;
  const asciiWords = tail.match(/[A-Za-z]{2,}/g) ?? [];
  const asciiCount = asciiWords.join('').length;

  if (cjkCount >= 2 && asciiCount >= 3) return 'mixed';
  if (cjkCount > 0) return 'zh';
  if (asciiWords.length > 0) return 'en';
  return 'unknown';
}

export function detectSyntaxContext(cursorPos: number, doc: string): SyntaxContext {
  const line = getLineAt(cursorPos, doc);
  if (!line) return { type: 'general', prefix: '' };
  const beforeCursor = line.beforeCursor;
  const trimmed = beforeCursor.trimStart();

  if (/^[-*+]\s?$/.test(trimmed)) return { type: 'markdown-structure', prefix: trimmed };
  if (/^#{1,6}\s?$/.test(trimmed)) return { type: 'markdown-structure', prefix: trimmed };
  if (/^>\s?$/.test(trimmed)) return { type: 'markdown-structure', prefix: trimmed };

  const wikiMatch = beforeCursor.match(/\[\[([^\]]*)$/);
  if (wikiMatch) return { type: 'wiki-link', prefix: wikiMatch[1] || '' };

  const tagMatch = beforeCursor.match(/(?:^|\s)#(\S*)$/);
  if (tagMatch && !/^#{1,6}\s/.test(line.text.trimStart())) {
    return { type: 'tag', prefix: tagMatch[1] || '' };
  }

  const pathMatch = beforeCursor.match(/(?:!\[.*?\]|\[.*?\])\(([^)]*)$/);
  if (pathMatch) return { type: 'file-path', prefix: pathMatch[1] || '' };

  const openMarker = detectOpenFormat(line.text, line.cursorColumn);
  if (openMarker) {
    const markerStart = beforeCursor.lastIndexOf(openMarker);
    const prefix = markerStart >= 0 ? beforeCursor.slice(markerStart + openMarker.length) : '';
    return { type: 'markdown-format', prefix, openMarker };
  }

  return { type: 'general', prefix: '' };
}

export function getLineAt(pos: number, doc: string): CompletionLine | null {
  if (pos === doc.length && doc.endsWith('\n')) {
    return {
      text: '',
      from: pos,
      to: pos,
      cursorColumn: 0,
      beforeCursor: '',
    };
  }

  let lineStart = 0;
  for (let i = 0; i < doc.length; i++) {
    if (doc[i] === '\n') {
      if (pos >= lineStart && pos <= i) {
        const text = doc.slice(lineStart, i);
        const cursorColumn = Math.max(0, Math.min(pos - lineStart, text.length));
        return {
          text,
          from: lineStart,
          to: i,
          cursorColumn,
          beforeCursor: text.slice(0, cursorColumn),
        };
      }
      lineStart = i + 1;
    }
  }
  if (pos >= lineStart) {
    const text = doc.slice(lineStart);
    const cursorColumn = Math.max(0, Math.min(pos - lineStart, text.length));
    return {
      text,
      from: lineStart,
      to: doc.length,
      cursorColumn,
      beforeCursor: text.slice(0, cursorColumn),
    };
  }
  return null;
}

export function isDisabledContext(cursorPos: number, doc: string): boolean {
  if (isInFencedCode(cursorPos, doc) || isInFrontmatter(cursorPos, doc)) return true;
  const line = getLineAt(cursorPos, doc);
  return !!line && line.text.trim() === '';
}

export function detectBlockType(
  cursorPos: number,
  doc: string,
  line: CompletionLine | null = getLineAt(cursorPos, doc),
  disabled = false,
): CompletionBlockType {
  if (isInFencedCode(cursorPos, doc)) return 'code';
  if (isInFrontmatter(cursorPos, doc)) return 'frontmatter';
  if (disabled) return 'paragraph';
  const trimmed = line?.text.trimStart() ?? '';
  if (/^#{1,6}\s/u.test(trimmed)) return 'heading';
  if (/^(?:[-*+]\s|\d+[.)、]\s)/u.test(trimmed)) return 'list';
  if (/^>\s?/u.test(trimmed)) return 'quote';
  if (/^\|.*\|?\s*$/u.test(trimmed)) return 'table';
  return 'paragraph';
}

export function isInFencedCode(cursorPos: number, doc: string): boolean {
  let inFence = false;
  let pos = 0;
  for (const line of doc.split('\n')) {
    const lineEnd = pos + line.length;
    if (line.startsWith('```')) {
      if (cursorPos >= pos && cursorPos <= lineEnd) return true;
      inFence = !inFence;
    } else if (inFence && cursorPos >= pos && cursorPos <= lineEnd) {
      return true;
    }
    pos = lineEnd + 1;
  }
  return false;
}

export function isInFrontmatter(cursorPos: number, doc: string): boolean {
  const firstLineEnd = doc.search(/\r?\n/);
  const firstLine = firstLineEnd === -1 ? doc : doc.slice(0, firstLineEnd);
  if (firstLine.trim() !== '---') return false;

  const delimiter = /\r?\n---[ \t]*(?=\r?\n|$)/g;
  delimiter.lastIndex = Math.max(0, firstLineEnd);
  const match = delimiter.exec(doc);
  if (!match) return false;

  const end = match.index + match[0].length;
  return cursorPos < end;
}

export function detectOpenFormat(line: string, col: number): string | null {
  const before = line.slice(0, col);
  const markers = ['**', '__', '`', '*'];
  for (const marker of markers) {
    const count = countOccurrences(before, marker);
    if (count % 2 === 1) return marker;
  }
  return null;
}

export function extractContext(cursorPos: number, doc: string, n: number): string {
  return doc.slice(Math.max(0, cursorPos - n), cursorPos);
}

function getParagraphStart(cursorPos: number, doc: string): number {
  const beforeCursor = doc.slice(0, cursorPos);
  const paragraphStart = Math.max(
    beforeCursor.lastIndexOf('\n\n'),
    beforeCursor.lastIndexOf('\r\n\r\n'),
  );
  return paragraphStart >= 0 ? paragraphStart + 2 : 0;
}

function getSentencePrefix(beforeCursor: string): string {
  const match = beforeCursor.match(/[^。！？!?；;：:\n]*$/u);
  return (match?.[0] ?? beforeCursor).trimStart();
}

function extractRecentTokens(text: string): string[] {
  const tokens = new Set<string>();
  for (const match of text.matchAll(/[\u3400-\u9fff]{2,8}/gu)) {
    const token = match[0];
    if (!isMostlyLowValueChinese(token)) tokens.add(token);
  }
  for (const match of text.matchAll(/[A-Za-z][A-Za-z0-9_-]{2,24}/g)) {
    tokens.add(match[0]);
  }
  return [...tokens].slice(-24);
}

function isMostlyLowValueChinese(text: string): boolean {
  return /^[的是了在和与及或而但并就都很更再也还又把被对为以中上下一个可以]+$/u.test(text);
}

function countOccurrences(text: string, marker: string): number {
  if (marker === '*') {
    return [...text.matchAll(/(?<!\*)\*(?!\*)/g)].length;
  }
  let count = 0;
  let idx = 0;
  while ((idx = text.indexOf(marker, idx)) !== -1) {
    count++;
    idx += marker.length;
  }
  return count;
}
