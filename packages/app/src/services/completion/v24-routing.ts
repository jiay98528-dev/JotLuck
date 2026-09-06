import type { CompletionContext } from './types';
import type { V24CompletionRoute } from './v24-completion-contract';

export type V24RouteReason =
  | 'structured-pattern'
  | 'fenced-code'
  | 'prose-boundary'
  | 'composition-active'
  | 'unsupported-block'
  | 'no-opportunity';

export interface V24RouteDecision {
  route: V24CompletionRoute;
  reason: V24RouteReason;
  language?: string;
  targetLatencyMs: number;
  hardDeadlineMs: number;
}

export function decideV24Route(context: CompletionContext): V24RouteDecision {
  if (context.contextSnapshot?.compositionStable === false) {
    return silence('composition-active');
  }
  if (context.syntax.type !== 'general') {
    return {
      route: 'format',
      reason: 'structured-pattern',
      targetLatencyMs: 20,
      hardDeadlineMs: 80,
    };
  }
  if (context.blockType === 'code') {
    return {
      route: 'code',
      reason: 'fenced-code',
      language: detectFencedLanguage(context.doc, context.localCursorPos) ?? undefined,
      targetLatencyMs: 100,
      hardDeadlineMs: 200,
    };
  }
  if (
    (context.blockType === 'paragraph' ||
      context.blockType === 'list' ||
      context.blockType === 'quote') &&
    context.atEndOfLine &&
    !context.emptyLine
  ) {
    return {
      route: 'writing',
      reason: 'prose-boundary',
      targetLatencyMs: 800,
      hardDeadlineMs: 2_000,
    };
  }
  if (
    context.blockType === 'heading' ||
    context.blockType === 'table' ||
    context.blockType === 'frontmatter'
  ) {
    return silence('unsupported-block');
  }
  return silence('no-opportunity');
}

export function detectFencedLanguage(doc: string, cursorPos: number): string | null {
  const safeCursor = Math.max(0, Math.min(cursorPos, doc.length));
  let fence: { marker: string; language: string } | null = null;
  let lineStart = 0;
  while (lineStart <= safeCursor) {
    const lineFeed = doc.indexOf('\n', lineStart);
    const rawEnd = lineFeed < 0 ? doc.length : lineFeed;
    const line = doc.slice(lineStart, rawEnd).replace(/\r$/u, '');
    if (fence) {
      if (
        new RegExp(
          `^\\s*${escapeRegExp(fence.marker.charAt(0))}{${fence.marker.length},}\\s*$`,
          'u',
        ).test(line)
      ) {
        fence = null;
      }
    } else {
      const opener = line.match(/^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)[^\S\r\n]*$/u);
      if (opener) fence = { marker: opener[1] ?? '```', language: opener[2] ?? '' };
    }
    if (lineFeed < 0 || lineFeed >= safeCursor) break;
    lineStart = lineFeed + 1;
  }
  return fence?.language.toLocaleLowerCase('en-US') || null;
}

function silence(reason: V24RouteReason): V24RouteDecision {
  return { route: 'silence', reason, targetLatencyMs: 0, hardDeadlineMs: 0 };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
