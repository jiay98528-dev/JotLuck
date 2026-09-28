/** DOM-free render preparation. The host MUST sanitize every returned fragment. */
import { Marked, type Token, type TokensList, type Tokens } from 'marked';
import { jotluckExtensions } from './marked-extensions';
import { normalizeFullwidthMarkdownSyntaxForRender, headingIdFromText } from './syntax';
import { findBareJsonBlockLineRanges } from './bare-json';

const parser = new Marked({ gfm: true, breaks: false });
parser.use({ extensions: jotluckExtensions });

export interface PreviewFragment {
  /** Temporary source-aligned gap while a requested remote range is prepared first. */
  placeholder?: boolean;
  from: number;
  to: number;
  html: string;
  headings: string[];
  /** Approximate source lines; actual layout height is measured by the host. */
  lines: number;
  /** Inline pieces share one paragraph in the host; never insert paragraph breaks. */
  inlineParts?: string[];
}

/** Whole-document lexing preserves reference definitions and nested block semantics. */
export async function preparePreviewFragments(
  source: string,
  cancelled: () => boolean = () => false,
  onBatch?: (fragments: PreviewFragment[], complete: boolean) => void,
): Promise<PreviewFragment[]> {
  const normalized = normalizeFullwidthMarkdownSyntaxForRender(source);
  const sourceLines = source.split('\n');
  const normalizedLines = normalized.split('\n');
  const json = new Map(
    findBareJsonBlockLineRanges(normalized).map((range) => [range.startLine, range]),
  );
  const jsonEnds = new Set([...json.values()].map((range) => range.endLine));
  const pieces: string[] = [];
  const offsets: Array<{ normalized: number; source: number }> = [];
  let rawOffset = 0;
  let normalizedOffset = 0;
  for (let line = 0; line < normalizedLines.length; line++) {
    const range = json.get(line);
    if (range) {
      offsets.push({ normalized: normalizedOffset, source: rawOffset });
      pieces.push('```json');
      normalizedOffset += 8;
    }
    offsets.push({ normalized: normalizedOffset, source: rawOffset });
    const text = normalizedLines[line]!;
    pieces.push(text);
    normalizedOffset += text.length + 1;
    rawOffset += (sourceLines[line]?.length ?? 0) + 1;
    if (jsonEnds.has(line)) {
      offsets.push({ normalized: normalizedOffset, source: Math.min(rawOffset, source.length) });
      pieces.push('```');
      normalizedOffset += 4;
    }
  }
  const prepared = pieces.join('\n');
  const mapOffset = (position: number): number => {
    let low = 0;
    let high = offsets.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (offsets[mid]!.normalized <= position) low = mid;
      else high = mid - 1;
    }
    const entry = offsets[low] ?? { normalized: 0, source: 0 };
    return Math.min(source.length, entry.source + Math.max(0, position - entry.normalized));
  };
  const tokens = parser.lexer(prepared);
  const occurrences = new Map<string, number>();
  const fragments: PreviewFragment[] = [];
  let cursor = 0;
  let deadline = performance.now() + 8;
  let sent = 0;
  for (const token of tokens) {
    if (cancelled()) throw new Error('Preview cancelled');
    const start = prepared.indexOf(token.raw, cursor);
    const from = start < 0 ? cursor : start;
    cursor = from + token.raw.length;
    if (token.type === 'space' || token.type === 'def') continue;
    const parts = splitLargeToken(token);
    let partIndex = 0;
    const lineEstimate = Math.max(1, Math.ceil(token.raw.split('\n').length / parts.length));
    for (const entry of parts) {
      const part = entry.token;
      const list = [part] as TokensList;
      list.links = tokens.links;
      const headings: string[] = [];
      parser.walkTokens(list, (item) => {
        if (item.type !== 'heading') return;
        const base = headingIdFromText(item.text);
        const count = (occurrences.get(base) ?? 0) + 1;
        occurrences.set(base, count);
        headings.push(headingIdFromText(item.text, count));
      });
      let heading = 0;
      let html = parser
        .parser(list)
        .replace(
          /<h([1-6])>/g,
          (_match, level: string) => `<h${level} id="${headings[heading++]!}">`,
        );
      if (token.type === 'table' && parts.length > 1) {
        html = html.replace('<table>', '<table class="progressive-table">');
        if (partIndex > 0) html = html.replace(/<thead>[\s\S]*?<\/thead>\n?/, '');
      }
      partIndex++;
      let inlineParts: string[] | undefined;
      if (part.type === 'paragraph' && part.raw.length > 16_384 && part.tokens) {
        const inline = part.tokens as Token[];
        let containsHtml = false;
        parser.walkTokens(inline, (item) => {
          if (item.type === 'html') containsHtml = true;
        });
        if (!containsHtml)
          inlineParts = splitInline(inline).map((tokens) =>
            parser.Parser.parseInline(tokens, parser.defaults),
          );
      }
      fragments.push({
        from: mapOffset(from + entry.from),
        to: mapOffset(from + entry.to),
        html,
        headings,
        lines: lineEstimate,
        ...(inlineParts ? { inlineParts } : {}),
      });
      if (performance.now() >= deadline) {
        if (cancelled()) throw new Error('Preview cancelled');
        onBatch?.(fragments.slice(sent), false);
        sent = fragments.length;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        deadline = performance.now() + 8;
      }
    }
  }
  if (cancelled()) throw new Error('Preview cancelled');
  onBatch?.(fragments.slice(sent), true);
  return fragments;
}

interface TokenPart {
  token: Token;
  from: number;
  to: number;
}
function splitLargeToken(token: Token): TokenPart[] {
  const starts = [0];
  for (let i = 0; i < token.raw.length; i++) if (token.raw.charCodeAt(i) === 10) starts.push(i + 1);
  if (token.type === 'code' && token.text.length > 16_384) {
    const lines = token.text.split('\n');
    const result: TokenPart[] = [];
    const opening = token.codeBlockStyle === 'indented' ? 0 : 1;
    for (let i = 0; i < lines.length; i += 128)
      result.push({
        token: { ...(token as Tokens.Code), text: lines.slice(i, i + 128).join('\n') },
        from: i === 0 ? 0 : (starts[i + opening] ?? token.raw.length),
        to:
          i + 128 >= lines.length
            ? token.raw.length
            : (starts[i + 128 + opening] ?? token.raw.length),
      });
    return result;
  }
  if (token.type === 'table' && token.rows.length > 128) {
    const result: TokenPart[] = [];
    for (let i = 0; i < token.rows.length; i += 128)
      result.push({
        token: { ...(token as Tokens.Table), rows: token.rows.slice(i, i + 128) },
        from: i === 0 ? 0 : (starts[i + 2] ?? token.raw.length),
        to: i + 128 >= token.rows.length ? token.raw.length : (starts[i + 130] ?? token.raw.length),
      });
    return result;
  }
  if (token.type === 'list' && token.items.length > 128) {
    const result: TokenPart[] = [];
    let offset = 0;
    for (let i = 0; i < token.items.length; i += 128) {
      const items = (token as Tokens.List).items.slice(i, i + 128);
      const from = offset;
      for (const item of items) {
        const at = token.raw.indexOf(item.raw, offset);
        offset = (at < 0 ? offset : at) + item.raw.length;
      }
      result.push({
        token: {
          ...(token as Tokens.List),
          start: token.ordered ? Number(token.start || 1) + i : token.start,
          items,
        },
        from,
        to: i + 128 >= token.items.length ? token.raw.length : offset,
      });
    }
    return result;
  }
  return [{ token, from: 0, to: token.raw.length }];
}

function splitInline(tokens: Token[]): Token[][] {
  const pieces: Token[] = [];
  for (const token of tokens) {
    if ('tokens' in token && token.tokens?.length) {
      for (const children of splitInline(token.tokens)) pieces.push({ ...token, tokens: children });
    } else if (
      (token.type === 'text' || token.type === 'codespan') &&
      typeof token.text === 'string' &&
      token.text.length > 8192
    ) {
      const text = token.text as string;
      for (let start = 0; start < text.length; ) {
        let end = Math.min(text.length, start + 8192);
        if (end < text.length && /[\uD800-\uDBFF]/.test(text.charAt(end - 1))) end--;
        const amp = text.lastIndexOf('&', end - 1);
        if (amp >= start && end - amp < 32 && !text.slice(amp, end).includes(';')) {
          const semi = text.indexOf(';', end);
          if (semi >= end && semi - end < 32) end = semi + 1;
        }
        pieces.push({ ...token, text: text.slice(start, end), raw: text.slice(start, end) });
        start = end;
      }
    } else pieces.push(token);
  }
  const result: Token[][] = [];
  let chunk: Token[] = [];
  let length = 0;
  for (const token of pieces) {
    if (length >= 8192) {
      result.push(chunk);
      chunk = [];
      length = 0;
    }
    chunk.push(token);
    length += token.raw.length;
  }
  if (chunk.length) result.push(chunk);
  return result;
}
