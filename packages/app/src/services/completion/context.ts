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
  const inFencedCode = isInFencedCode(args.cursorPos, args.doc);
  const inFrontmatter = isInFrontmatter(args.cursorPos, args.doc);
  const disabled = inFencedCode || inFrontmatter;
  const emptyLine = line ? line.text.trim() === '' : args.doc.length === 0;
  const atEndOfLine = args.cursorPos === args.doc.length || args.doc[args.cursorPos] === '\n';
  const languageHint = detectLanguageHint(line?.beforeCursor ?? args.doc.slice(0, args.cursorPos));
  const blockType = detectBlockType(
    args.cursorPos,
    args.doc,
    line,
    disabled,
    inFencedCode,
    inFrontmatter,
  );
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

/**
 * Resolve the language immediately around the cursor without treating an
 * English glue word as a technical-language switch inside Chinese prose.
 */
export function getLocalLanguageHint(context: CompletionContext): CompletionLanguageHint {
  if (context.languageHint !== 'mixed') return context.languageHint;

  const beforeCursor = context.line?.beforeCursor ?? context.doc.slice(0, context.cursorPos);
  const fragments = beforeCursor.match(/[\u3400-\u9fff]+|[A-Za-z][A-Za-z'-]*/gu) ?? [];
  const nearest = fragments[fragments.length - 1];
  if (!nearest) return 'unknown';
  if (/[\u3400-\u9fff]/u.test(nearest)) return 'zh';
  if (/^(?:a|an|the|and|or|but|to|of|in|on|for|with|is|are|was|were)$/iu.test(nearest)) {
    return 'unknown';
  }
  return 'en';
}

export function detectSyntaxContext(cursorPos: number, doc: string): SyntaxContext {
  const line = getLineAt(cursorPos, doc);
  if (!line) return { type: 'general', prefix: '' };
  const beforeCursor = line.beforeCursor;
  const markdownPrefix = beforeCursor.match(/^ {0,3}(.*)$/u)?.[1] ?? '';

  if (/^[-*+]\s?$/u.test(markdownPrefix)) {
    return { type: 'markdown-structure', prefix: markdownPrefix };
  }
  if (/^\d{1,9}[.)、．]$/u.test(markdownPrefix)) {
    return { type: 'markdown-structure', prefix: markdownPrefix };
  }
  if (/^#{1,6}\s?$/u.test(markdownPrefix)) {
    return { type: 'markdown-structure', prefix: markdownPrefix };
  }
  if (/^>\s?$/u.test(markdownPrefix)) {
    return { type: 'markdown-structure', prefix: markdownPrefix };
  }

  const wikiMatch = beforeCursor.match(/\[\[([^\]]*)$/);
  if (wikiMatch && !isEscapedAt(beforeCursor, wikiMatch.index ?? 0)) {
    return { type: 'wiki-link', prefix: wikiMatch[1] || '' };
  }

  const tagMatch = beforeCursor.match(/(?:^|\s)#(\S*)$/);
  const tagIndex = tagMatch ? (tagMatch.index ?? 0) + (tagMatch[0]?.lastIndexOf('#') ?? 0) : -1;
  if (
    tagMatch &&
    tagIndex >= 0 &&
    !isEscapedAt(beforeCursor, tagIndex) &&
    !/^ {0,3}#{1,6}\s/u.test(line.text)
  ) {
    return { type: 'tag', prefix: tagMatch[1] || '' };
  }

  const pathMatch = beforeCursor.match(/(?:!\[.*?\]|\[.*?\])\(([^)]*)$/);
  const pathBracketIndex = pathMatch
    ? (pathMatch.index ?? 0) + (pathMatch[0]?.indexOf('[') ?? 0)
    : -1;
  if (pathMatch && pathBracketIndex >= 0 && !isEscapedAt(beforeCursor, pathBracketIndex)) {
    return { type: 'file-path', prefix: pathMatch[1] || '' };
  }

  const openFormat = findOpenFormat(line.text, line.cursorColumn);
  if (openFormat) {
    return {
      type: 'markdown-format',
      prefix: beforeCursor.slice(openFormat.index + openFormat.marker.length),
      openMarker: openFormat.marker,
    };
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

  const safePos = Math.max(0, Math.min(pos, doc.length));
  const previousBreak = doc.lastIndexOf('\n', Math.max(0, safePos - 1));
  const lineStart = previousBreak < 0 ? 0 : previousBreak + 1;
  const nextBreak = doc.indexOf('\n', safePos);
  const rawEnd = nextBreak < 0 ? doc.length : nextBreak;
  const contentEnd = rawEnd > lineStart && doc[rawEnd - 1] === '\r' ? rawEnd - 1 : rawEnd;
  const text = doc.slice(lineStart, contentEnd);
  const cursorColumn = Math.max(0, Math.min(safePos - lineStart, text.length));
  return {
    text,
    from: lineStart,
    to: contentEnd,
    cursorColumn,
    beforeCursor: text.slice(0, cursorColumn),
  };
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
  inFencedCode = isInFencedCode(cursorPos, doc),
  inFrontmatter = isInFrontmatter(cursorPos, doc),
): CompletionBlockType {
  if (inFencedCode) return 'code';
  if (inFrontmatter) return 'frontmatter';
  if (disabled) return 'paragraph';
  const trimmed = line?.text.trimStart() ?? '';
  if (/^#{1,6}\s/u.test(trimmed)) return 'heading';
  if (/^(?:[-*+]\s|\d{1,9}[.)、．]\s)/u.test(trimmed)) return 'list';
  if (/^>\s?/u.test(trimmed)) return 'quote';
  if (/^\|.*\|?\s*$/u.test(trimmed)) return 'table';
  return 'paragraph';
}

export function isInFencedCode(cursorPos: number, doc: string): boolean {
  const cursor = Math.max(0, Math.min(cursorPos, doc.length));
  let fence: { marker: '`' | '~'; length: number } | null = null;
  let lineStart = 0;

  while (lineStart <= doc.length) {
    const lineFeed = doc.indexOf('\n', lineStart);
    const rawEnd = lineFeed < 0 ? doc.length : lineFeed;
    const contentEnd = rawEnd > lineStart && doc[rawEnd - 1] === '\r' ? rawEnd - 1 : rawEnd;
    const line = doc.slice(lineStart, contentEnd);
    const cursorOnLine = cursor >= lineStart && cursor <= rawEnd;

    if (fence) {
      if (cursorOnLine) return true;
      if (isFenceCloser(line, fence)) fence = null;
    } else {
      const opener = parseFenceOpener(line);
      if (opener) {
        if (cursorOnLine) return true;
        fence = opener;
      } else if (cursorOnLine) {
        return false;
      }
    }

    if (lineFeed < 0) break;
    lineStart = lineFeed + 1;
  }
  return false;
}

export function isInFrontmatter(cursorPos: number, doc: string): boolean {
  const firstLineFeed = doc.indexOf('\n');
  const firstRawEnd = firstLineFeed < 0 ? doc.length : firstLineFeed;
  const firstContentEnd =
    firstRawEnd > 0 && doc[firstRawEnd - 1] === '\r' ? firstRawEnd - 1 : firstRawEnd;
  const firstLine = doc.slice(0, firstContentEnd).replace(/^\uFEFF/u, '');
  if (!/^---[ \t]*$/u.test(firstLine)) return false;

  const cursor = Math.max(0, Math.min(cursorPos, doc.length));
  if (cursor <= firstRawEnd) return true;

  let lineStart = firstLineFeed < 0 ? doc.length + 1 : firstLineFeed + 1;
  while (lineStart <= doc.length) {
    const lineFeed = doc.indexOf('\n', lineStart);
    const rawEnd = lineFeed < 0 ? doc.length : lineFeed;
    const contentEnd = rawEnd > lineStart && doc[rawEnd - 1] === '\r' ? rawEnd - 1 : rawEnd;
    const line = doc.slice(lineStart, contentEnd);
    if (/^---[ \t]*$/u.test(line)) return cursor <= rawEnd;
    if (lineFeed < 0) break;
    lineStart = lineFeed + 1;
  }

  // An opening frontmatter delimiter without a matching close disables the rest of the file.
  return true;
}

export function detectOpenFormat(line: string, col: number): string | null {
  return findOpenFormat(line, col)?.marker ?? null;
}

export function extractContext(cursorPos: number, doc: string, n: number): string {
  return Array.from(doc.slice(0, cursorPos)).slice(-n).join('');
}

function getParagraphStart(cursorPos: number, doc: string): number {
  const beforeCursor = doc.slice(0, cursorPos);
  const lfStart = beforeCursor.lastIndexOf('\n\n');
  const crlfStart = beforeCursor.lastIndexOf('\r\n\r\n');
  if (crlfStart >= lfStart && crlfStart >= 0) return crlfStart + 4;
  return lfStart >= 0 ? lfStart + 2 : 0;
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

function findOpenFormat(line: string, col: number): { marker: string; index: number } | null {
  const before = line.slice(0, col);
  const markers = ['**', '__', '`', '*'] as const;
  for (const marker of markers) {
    const positions: number[] = [];
    let index = 0;
    while ((index = before.indexOf(marker, index)) >= 0) {
      const isSingleAsteriskInsideRun =
        marker === '*' && (before[index - 1] === '*' || before[index + 1] === '*');
      if (!isSingleAsteriskInsideRun && !isEscapedAt(before, index)) positions.push(index);
      index += marker.length;
    }
    if (positions.length % 2 === 1) {
      return { marker, index: positions[positions.length - 1]! };
    }
  }
  return null;
}

function isEscapedAt(text: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor--) slashes++;
  return slashes % 2 === 1;
}

function parseFenceOpener(line: string): { marker: '`' | '~'; length: number } | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
  const run = match?.[1];
  if (!run) return null;
  const marker = run[0] as '`' | '~';
  if (marker === '`' && (match?.[2] ?? '').includes('`')) return null;
  return { marker, length: run.length };
}

function isFenceCloser(line: string, fence: { marker: '`' | '~'; length: number }): boolean {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u.exec(line);
  const run = match?.[1];
  return !!run && run[0] === fence.marker && run.length >= fence.length;
}
