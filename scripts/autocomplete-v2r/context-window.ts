export const PUBLIC_CONTEXT_UTF8_BYTES = 192;

export interface Utf8ContextWindow {
  text: string;
  bytes: Uint8Array;
  byteLength: number;
  startUtf16Offset: number;
  cursorUtf16Offset: number;
  truncated: boolean;
}

const encoder = new TextEncoder();

/**
 * Returns the largest code-point-aligned suffix at or below the UTF-8 budget.
 * CodeMirror offsets remain UTF-16 offsets; model bytes never contain a split code point.
 */
export function encodeUtf8ContextWindow(
  document: string,
  cursorUtf16Offset: number,
  maxBytes = PUBLIC_CONTEXT_UTF8_BYTES,
): Utf8ContextWindow {
  if (
    !Number.isInteger(cursorUtf16Offset) ||
    cursorUtf16Offset < 0 ||
    cursorUtf16Offset > document.length
  ) {
    throw new Error('cursorUtf16Offset is outside the document.');
  }
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new Error('maxBytes must be positive.');
  assertCodePointBoundary(document, cursorUtf16Offset);

  const prefix = document.slice(0, cursorUtf16Offset);
  let byteLength = 0;
  let startUtf16Offset = prefix.length;
  const codePoints = Array.from(prefix);
  for (let index = codePoints.length - 1; index >= 0; index--) {
    const codePoint = codePoints[index]!;
    const bytes = encoder.encode(codePoint).byteLength;
    if (byteLength + bytes > maxBytes) break;
    byteLength += bytes;
    startUtf16Offset -= codePoint.length;
  }

  const text = prefix.slice(startUtf16Offset);
  const bytes = encoder.encode(text);
  return {
    text,
    bytes,
    byteLength: bytes.byteLength,
    startUtf16Offset,
    cursorUtf16Offset,
    truncated: startUtf16Offset > 0,
  };
}

function assertCodePointBoundary(value: string, offset: number): void {
  if (offset <= 0 || offset >= value.length) return;
  const previous = value.charCodeAt(offset - 1);
  const next = value.charCodeAt(offset);
  if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
    throw new Error('cursorUtf16Offset must not split a surrogate pair.');
  }
}
