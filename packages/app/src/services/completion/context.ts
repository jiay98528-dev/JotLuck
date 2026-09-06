import type {
  CompletionBlockType,
  CompletionCodeLexicalContext,
  CompletionContext,
  CompletionLanguageHint,
  CompletionLine,
  CompletionDocumentContextSnapshot,
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
  const codeContext =
    blockType === 'code'
      ? detectFencedCodeContext(args.cursorPos, args.doc)
      : { language: undefined, lexicalContext: undefined };
  const paragraphStart = getParagraphStart(args.cursorPos, args.doc);
  const paragraphBeforeCursor = args.doc.slice(paragraphStart, args.cursorPos);
  const sentencePrefix = getSentencePrefix(line?.beforeCursor ?? '');
  const recentTokens = extractRecentTokens(paragraphBeforeCursor || line?.beforeCursor || '');

  return {
    doc: args.doc,
    documentFrom: 0,
    documentRevision: 0,
    cursorPos: args.cursorPos,
    localCursorPos: args.cursorPos,
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
    codeLanguage: codeContext.language,
    codeLexicalContext: codeContext.lexicalContext,
    paragraphBeforeCursor,
    paragraphStart,
    sentencePrefix,
    recentTokens,
  };
}

/**
 * Build the provider context from the bounded CM6 state-field snapshot. This
 * path never needs the complete document string and keeps absolute UTF-16
 * edit coordinates separate from local window offsets.
 */
export function buildCompletionContextFromSnapshot(args: {
  snapshot: CompletionDocumentContextSnapshot;
  settings: CompletionSettings;
  indexData: PredictorIndexData | null;
  n: number;
}): CompletionContext {
  const { snapshot } = args;
  const localCursorPos = snapshot.cursor - snapshot.documentWindow.from;
  const paragraphBeforeCursor = snapshot.currentParagraph.text.slice(
    0,
    Math.max(0, snapshot.cursor - snapshot.currentParagraph.from),
  );
  const sentencePrefix = getSentencePrefix(snapshot.line?.beforeCursor ?? '');
  return {
    doc: snapshot.documentWindow.text,
    documentFrom: snapshot.documentWindow.from,
    documentRevision: snapshot.documentRevision,
    cursorPos: snapshot.cursor,
    localCursorPos,
    line: snapshot.line,
    syntax: snapshot.syntax,
    settings: args.settings,
    indexData: args.indexData,
    n: args.n,
    disabled: snapshot.disabled,
    emptyLine: snapshot.emptyLine,
    atEndOfLine: snapshot.atEndOfLine,
    languageHint: snapshot.languageHint,
    blockType: snapshot.blockType,
    codeLanguage: snapshot.codeLanguage,
    codeLexicalContext: snapshot.codeLexicalContext,
    paragraphBeforeCursor,
    paragraphStart: snapshot.currentParagraph.from,
    sentencePrefix,
    recentTokens: extractRecentTokens(paragraphBeforeCursor || snapshot.line?.beforeCursor || ''),
    contextSnapshot: snapshot,
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

  const beforeCursor = context.line?.beforeCursor ?? context.doc.slice(0, context.localCursorPos);
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

interface FenceDescriptor {
  marker: '`' | '~';
  length: number;
  language?: string;
}

interface FencedCodeContext {
  language?: string;
  lexicalContext?: CompletionCodeLexicalContext;
}

export function detectFencedCodeContext(cursorPos: number, doc: string): FencedCodeContext {
  const cursor = Math.max(0, Math.min(cursorPos, doc.length));
  let fence: FenceDescriptor | null = null;
  let bodyStart = 0;
  let lineStart = 0;
  while (lineStart <= doc.length) {
    const lineFeed = doc.indexOf('\n', lineStart);
    const rawEnd = lineFeed < 0 ? doc.length : lineFeed;
    const contentEnd = rawEnd > lineStart && doc[rawEnd - 1] === '\r' ? rawEnd - 1 : rawEnd;
    const line = doc.slice(lineStart, contentEnd);
    const cursorOnLine = cursor >= lineStart && cursor <= rawEnd;
    if (fence) {
      if (cursorOnLine) {
        if (!fence.language) return { lexicalContext: 'unknown' };
        const body = doc.slice(bodyStart, cursor);
        return {
          language: fence.language,
          lexicalContext: scanCodeLexicalContext(body, fence.language),
        };
      }
      if (isFenceCloser(line, fence)) fence = null;
    } else {
      const opener = parseFenceOpener(line);
      if (opener) {
        if (cursorOnLine) return { language: opener.language, lexicalContext: 'unknown' };
        fence = opener;
        bodyStart = lineFeed < 0 ? rawEnd : lineFeed + 1;
      } else if (cursorOnLine) {
        return {};
      }
    }
    if (lineFeed < 0) break;
    lineStart = lineFeed + 1;
  }
  return {};
}

export function scanCodeLexicalContext(
  text: string,
  language: string,
): CompletionCodeLexicalContext {
  if (!V25_CODE_LANGUAGES.has(language)) return 'unknown';
  const supportsComments = language !== 'json';
  const supportsTemplate = language === 'typescript' || language === 'javascript';
  const supportsRegex = language === 'typescript' || language === 'javascript';
  let state: CompletionCodeLexicalContext = 'code';
  let quote: "'" | '"' | '`' | null = null;
  let blockCommentDepth = 0;
  let lineComment = false;
  let regex = false;
  let regexCharacterClass = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const current = text[index]!;
    const next = text[index + 1] ?? '';
    if (lineComment) {
      if (current === '\n') lineComment = false;
      continue;
    }
    if (blockCommentDepth > 0) {
      if (language === 'rust' && current === '/' && next === '*') {
        blockCommentDepth += 1;
        index += 1;
        continue;
      }
      if (current === '*' && next === '/') {
        blockCommentDepth -= 1;
        index += 1;
      }
      continue;
    }
    if (regex) {
      if (escaped) {
        escaped = false;
      } else if (current === '\\') {
        escaped = true;
      } else if (current === '[') {
        regexCharacterClass = true;
      } else if (current === ']' && regexCharacterClass) {
        regexCharacterClass = false;
      } else if (current === '/' && !regexCharacterClass) {
        regex = false;
        while (/[A-Za-z]/u.test(text[index + 1] ?? '')) index += 1;
      } else if (current === '\n') {
        return 'unknown';
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (current === '\\') {
        escaped = true;
      } else if (current === quote) {
        quote = null;
      } else if (current === '\n' && quote !== '`') {
        return 'unknown';
      }
      continue;
    }
    if (supportsComments && current === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (supportsComments && current === '/' && next === '*') {
      blockCommentDepth = 1;
      index += 1;
      continue;
    }
    if (language === 'rust') {
      const raw = /^(?:br|r)(#{0,255})"/u.exec(text.slice(index));
      const identifierBoundary = index === 0 || !/[A-Za-z0-9_]/u.test(text[index - 1]!);
      if (raw && identifierBoundary) {
        const delimiter = `"${raw[1] ?? ''}`;
        const contentStart = index + raw[0].length;
        const close = text.indexOf(delimiter, contentStart);
        if (close < 0) return 'string';
        index = close + delimiter.length - 1;
        continue;
      }
    }
    if (supportsRegex && current === '/' && startsJavaScriptRegex(text, index)) {
      regex = true;
      regexCharacterClass = false;
      escaped = false;
      continue;
    }
    if (language === 'rust' && current === "'") {
      const rest = text.slice(index);
      const character =
        /^'(?:\\(?:[nrt0\\'"]|x[0-9A-Fa-f]{2}|u\{[0-9A-Fa-f_]{1,6}\})|[^\\'\r\n])'/u.exec(rest);
      if (character) {
        index += character[0].length - 1;
        continue;
      }
      const lifetime = /^'[A-Za-z_][A-Za-z0-9_]*/u.exec(rest);
      if (lifetime) {
        const afterLifetime = rest[lifetime[0].length] ?? '';
        if (!afterLifetime) return 'unknown';
        index += lifetime[0].length - 1;
        continue;
      }
    }
    if (current === '"' || current === "'" || (supportsTemplate && current === '`')) {
      quote = current as "'" | '"' | '`';
    }
  }
  if (lineComment || blockCommentDepth > 0) state = 'comment';
  else if (quote || regex) state = 'string';
  return state;
}

function startsJavaScriptRegex(text: string, slashIndex: number): boolean {
  let cursor = slashIndex - 1;
  while (cursor >= 0 && /\s/u.test(text[cursor]!)) {
    if (text[cursor] === '\n' || text[cursor] === '\r') return true;
    cursor -= 1;
  }
  if (cursor < 0) return true;
  // JavaScript permits a regex expression as the body following a control
  // condition and after a completed block. A slash separated from `)`/`}` is
  // ambiguous with division; fail closed so text inside that literal never
  // receives semantic FIM privileges.
  if (cursor < slashIndex - 1 && /[)}]/u.test(text[cursor]!)) return true;
  if (/[=([{,:;!&|?+\-*%^~<>]/u.test(text[cursor]!)) return true;
  const boundedTail = text.slice(Math.max(0, cursor - 15), cursor + 1);
  return /(?:^|\b)(?:return|case|throw|yield|await)$/u.test(boundedTail);
}

const V25_CODE_LANGUAGE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  ts: 'typescript',
  typescript: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  javascript: 'javascript',
  jsx: 'javascript',
  rs: 'rust',
  rust: 'rust',
  json: 'json',
});
const V25_CODE_LANGUAGES = new Set(Object.values(V25_CODE_LANGUAGE_ALIASES));

export function normalizeFencedCodeLanguage(info: string): string | undefined {
  const first = info.trim().split(/\s+/u)[0]?.toLocaleLowerCase('en-US') ?? '';
  return V25_CODE_LANGUAGE_ALIASES[first];
}

function parseFenceOpener(line: string): FenceDescriptor | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
  const run = match?.[1];
  if (!run) return null;
  const marker = run[0] as '`' | '~';
  if (marker === '`' && (match?.[2] ?? '').includes('`')) return null;
  return {
    marker,
    length: run.length,
    language: normalizeFencedCodeLanguage(match?.[2] ?? ''),
  };
}

function isFenceCloser(line: string, fence: Pick<FenceDescriptor, 'marker' | 'length'>): boolean {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u.exec(line);
  const run = match?.[1];
  return !!run && run[0] === fence.marker && run.length >= fence.length;
}
