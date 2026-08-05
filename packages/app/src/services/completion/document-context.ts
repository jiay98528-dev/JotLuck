import { syntaxTree } from '@codemirror/language';
import { StateField, type ChangeSet, type EditorState, type Text } from '@codemirror/state';
import { detectLanguageHint, detectSyntaxContext } from './context';
import type {
  BoundedTextSlice,
  CompletionBlockType,
  CompletionDocumentContextSnapshot,
  CompletionLine,
} from './types';

const DOCUMENT_WINDOW_BEFORE = 32 * 1024;
const DOCUMENT_WINDOW_AFTER = 1024;
const LINE_WINDOW_BEFORE = 8 * 1024;
const CURRENT_PARAGRAPH_LIMIT = 8 * 1024;
const PREVIOUS_PARAGRAPH_LIMIT = 4 * 1024;
const L1_PARAGRAPH_SAMPLE_LIMIT = 16 * 1024;

interface HeadingEntry {
  from: number;
  level: number;
  text: string;
}

interface CompletionDocumentContextState {
  revision: number;
  frontmatterEnd: number | null;
  headings: readonly HeadingEntry[];
  snapshot: CompletionDocumentContextSnapshot;
}

export interface OpenedDocumentParagraphSlice {
  from: number;
  to: number;
  /** Bounded sample used by the L1 contribution builder. */
  text: string;
}

export interface OpenedDocumentParagraphChange {
  oldFrom: number;
  oldTo: number;
  newFrom: number;
  newTo: number;
  documentDelta: number;
  paragraphs: readonly OpenedDocumentParagraphSlice[];
}

export const completionDocumentContextField = StateField.define<CompletionDocumentContextState>({
  create(state) {
    const frontmatterEnd = findFrontmatterEnd(state.doc);
    const headings = scanHeadings(state.doc, 1, state.doc.lines);
    return {
      revision: 0,
      frontmatterEnd,
      headings,
      snapshot: buildSnapshot(state, 0, frontmatterEnd, headings),
    };
  },
  update(value, transaction) {
    const revision = value.revision + (transaction.docChanged ? 1 : 0);
    let frontmatterEnd = value.frontmatterEnd;
    let headings = value.headings;
    if (transaction.docChanged) {
      const changed = getChangedLineBounds(
        transaction.startState.doc,
        transaction.newDoc,
        transaction.changes,
      );
      if (changed) {
        frontmatterEnd = updateFrontmatterEnd(
          value.frontmatterEnd,
          transaction.startState.doc,
          transaction.newDoc,
          transaction.changes,
          changed,
        );
        headings = updateHeadings(value.headings, transaction.newDoc, transaction.changes, changed);
      }
    }
    return {
      revision,
      frontmatterEnd,
      headings,
      snapshot: buildSnapshot(transaction.state, revision, frontmatterEnd, headings),
    };
  },
});

export function getCompletionDocumentContext(
  state: EditorState,
): CompletionDocumentContextSnapshot {
  return state.field(completionDocumentContextField).snapshot;
}

export function createOpenedDocumentParagraphChange(
  oldDoc: Text,
  newDoc: Text,
  changes: ChangeSet,
): OpenedDocumentParagraphChange | null {
  const bounds = getChangedLineBounds(oldDoc, newDoc, changes);
  if (!bounds) return null;
  const oldEnvelope = getParagraphEnvelope(oldDoc, bounds.oldStartLine, bounds.oldEndLine);
  const newEnvelope = getParagraphEnvelope(newDoc, bounds.newStartLine, bounds.newEndLine);
  return {
    oldFrom: oldEnvelope.from,
    oldTo: oldEnvelope.to,
    newFrom: newEnvelope.from,
    newTo: newEnvelope.to,
    documentDelta: newDoc.length - oldDoc.length,
    paragraphs: collectParagraphSlices(newDoc, newEnvelope.startLine, newEnvelope.endLine),
  };
}

interface ParagraphEnvelope {
  from: number;
  to: number;
  startLine: number;
  endLine: number;
}

function getParagraphEnvelope(
  doc: Text,
  changedStartLine: number,
  changedEndLine: number,
): ParagraphEnvelope {
  let startLine = Math.max(1, changedStartLine - 1);
  let endLine = Math.min(doc.lines, changedEndLine + 1);
  while (startLine > 1 && !isBlankLine(doc, startLine - 1)) startLine -= 1;
  while (endLine < doc.lines && !isBlankLine(doc, endLine + 1)) endLine += 1;
  const first = doc.line(startLine);
  const last = doc.line(endLine);
  return {
    from: first.from,
    to: last.to + (endLine < doc.lines ? 1 : 0),
    startLine,
    endLine,
  };
}

function collectParagraphSlices(
  doc: Text,
  startLine: number,
  endLine: number,
): OpenedDocumentParagraphSlice[] {
  const paragraphs: OpenedDocumentParagraphSlice[] = [];
  let paragraphStartLine: number | null = null;
  const flush = (lastLine: number) => {
    if (paragraphStartLine === null || lastLine < paragraphStartLine) return;
    const from = doc.line(paragraphStartLine).from;
    const to = doc.line(lastLine).to;
    paragraphs.push({ from, to, text: sampleText(doc, from, to) });
    paragraphStartLine = null;
  };
  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
    if (isBlankLine(doc, lineNumber)) {
      flush(lineNumber - 1);
    } else if (paragraphStartLine === null) {
      paragraphStartLine = lineNumber;
    }
  }
  flush(endLine);
  return paragraphs;
}

function sampleText(doc: Text, from: number, to: number): string {
  const length = to - from;
  if (length <= L1_PARAGRAPH_SAMPLE_LIMIT) return doc.sliceString(from, to);
  const half = Math.floor(L1_PARAGRAPH_SAMPLE_LIMIT / 2);
  return `${doc.sliceString(from, from + half)}\n${doc.sliceString(to - half, to)}`;
}

function isBlankLine(doc: Text, lineNumber: number): boolean {
  const line = doc.line(lineNumber);
  if (line.length === 0) return true;
  // A very large whitespace-only line is safely treated as a paragraph. This
  // keeps the hot path bounded without affecting Markdown block correctness.
  if (line.length > 4 * 1024) return false;
  return doc.sliceString(line.from, line.to).trim().length === 0;
}

function getBoundedLineText(doc: Text, lineNumber: number, limit = 4 * 1024): string {
  const line = doc.line(lineNumber);
  return doc.sliceString(line.from, Math.min(line.to, line.from + limit));
}

function buildSnapshot(
  state: EditorState,
  revision: number,
  frontmatterEnd: number | null,
  headings: readonly HeadingEntry[],
): CompletionDocumentContextSnapshot {
  const cursor = state.selection.main.head;
  const lineInfo = state.doc.lineAt(cursor);
  const boundedLineFrom = Math.max(lineInfo.from, cursor - LINE_WINDOW_BEFORE);
  const boundedLineTo = Math.min(lineInfo.to, cursor + DOCUMENT_WINDOW_AFTER);
  const boundedLineText = state.doc.sliceString(boundedLineFrom, boundedLineTo);
  const line: CompletionLine = {
    text: boundedLineText,
    from: boundedLineFrom,
    to: boundedLineTo,
    cursorColumn: Math.max(0, Math.min(cursor - boundedLineFrom, boundedLineText.length)),
    beforeCursor: state.doc.sliceString(boundedLineFrom, cursor),
  };
  const nodePath = getNodePath(state, cursor);
  const inFrontmatter = frontmatterEnd !== null && cursor <= frontmatterEnd;
  const blockType = resolveBlockType(nodePath, line.text, inFrontmatter);
  const disabled = blockType === 'code' || blockType === 'frontmatter';
  const paragraphFloor =
    frontmatterEnd !== null && cursor > frontmatterEnd
      ? Math.min(state.doc.length, frontmatterEnd + 1)
      : 0;
  const currentParagraph = getCurrentParagraph(state.doc, lineInfo.number, cursor, paragraphFloor);
  const previousParagraph = getPreviousParagraph(
    state.doc,
    lineInfo.number,
    currentParagraph.from,
    paragraphFloor,
  );
  const windowFrom = Math.max(0, cursor - DOCUMENT_WINDOW_BEFORE);
  const windowTo = Math.min(state.doc.length, lineInfo.to, cursor + DOCUMENT_WINDOW_AFTER);
  const documentWindow: BoundedTextSlice = {
    from: windowFrom,
    to: windowTo,
    text: state.doc.sliceString(windowFrom, windowTo),
    truncatedBefore: windowFrom > 0,
    truncatedAfter: windowTo < state.doc.length,
  };
  return {
    documentRevision: revision,
    cursor,
    nodePath,
    blockType,
    headingTrail: getHeadingTrail(headings, cursor),
    line,
    currentParagraph,
    previousParagraph,
    documentWindow,
    syntax: detectSyntaxContext(line.cursorColumn, line.text),
    languageHint: detectLanguageHint(line.beforeCursor),
    disabled,
    emptyLine: line.text.trim().length === 0,
    atEndOfLine: cursor === lineInfo.to,
    compositionStable: true,
  };
}

function getNodePath(state: EditorState, cursor: number): readonly string[] {
  const path: string[] = [];
  let node: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(state).resolveInner(
    cursor,
    -1,
  );
  while (node) {
    path.push(node.name);
    node = node.parent;
  }
  return path;
}

function resolveBlockType(
  nodePath: readonly string[],
  lineText: string,
  inFrontmatter: boolean,
): CompletionBlockType {
  if (inFrontmatter) return 'frontmatter';
  const nodes = nodePath.join('|').toLocaleLowerCase('en-US');
  if (/fencedcode|codeblock|inlinecode|codeText/iu.test(nodes)) return 'code';
  if (/atxheading|setextheading|heading/iu.test(nodes) || /^\s{0,3}#{1,6}\s/u.test(lineText)) {
    return 'heading';
  }
  if (/blockquote/iu.test(nodes) || /^\s{0,3}>/u.test(lineText)) return 'quote';
  if (
    /bulletlist|orderedlist|listitem/iu.test(nodes) ||
    /^\s{0,3}(?:[-*+]\s|\d+[.)、．]\s)/u.test(lineText)
  ) {
    return 'list';
  }
  if (/table/iu.test(nodes) || /^\s*\|.*\|?\s*$/u.test(lineText)) return 'table';
  return 'paragraph';
}

function getCurrentParagraph(
  doc: Text,
  lineNumber: number,
  cursor: number,
  paragraphFloor: number,
): BoundedTextSlice {
  let startLine = lineNumber;
  let scanned = 0;
  while (startLine > 1) {
    const previous = doc.line(startLine - 1);
    if (previous.from < paragraphFloor) break;
    if (isBlankLine(doc, startLine - 1)) break;
    scanned += previous.length + 1;
    if (scanned > CURRENT_PARAGRAPH_LIMIT) break;
    startLine -= 1;
  }
  const naturalFrom = Math.max(paragraphFloor, doc.line(startLine).from);
  const from = Math.max(naturalFrom, cursor - CURRENT_PARAGRAPH_LIMIT);
  return {
    from,
    to: cursor,
    text: doc.sliceString(from, cursor),
    truncatedBefore: from > naturalFrom,
    truncatedAfter: cursor < doc.line(lineNumber).to,
  };
}

function getPreviousParagraph(
  doc: Text,
  currentLineNumber: number,
  currentParagraphFrom: number,
  paragraphFloor: number,
): BoundedTextSlice | null {
  let lineNumber = doc.lineAt(currentParagraphFrom).number - 1;
  while (lineNumber > 0 && isBlankLine(doc, lineNumber)) lineNumber -= 1;
  if (lineNumber <= 0) return null;
  if (doc.line(lineNumber).to < paragraphFloor) return null;
  const naturalTo = doc.line(lineNumber).to;
  let startLine = lineNumber;
  let scanned = 0;
  while (startLine > 1) {
    const previous = doc.line(startLine - 1);
    if (previous.from < paragraphFloor) break;
    if (isBlankLine(doc, startLine - 1)) break;
    scanned += previous.length + 1;
    if (scanned > PREVIOUS_PARAGRAPH_LIMIT) break;
    startLine -= 1;
  }
  const naturalFrom = Math.max(paragraphFloor, doc.line(startLine).from);
  const from = Math.max(naturalFrom, naturalTo - PREVIOUS_PARAGRAPH_LIMIT);
  void currentLineNumber;
  return {
    from,
    to: naturalTo,
    text: doc.sliceString(from, naturalTo),
    truncatedBefore: from > naturalFrom,
    truncatedAfter: false,
  };
}

function findFrontmatterEnd(doc: Text): number | null {
  if (!/^\uFEFF?---[ \t]*$/u.test(getBoundedLineText(doc, 1))) return null;
  for (let lineNumber = 2; lineNumber <= doc.lines; lineNumber++) {
    const line = doc.line(lineNumber);
    if (/^---[ \t]*$/u.test(getBoundedLineText(doc, lineNumber))) return line.to;
  }
  return doc.length;
}

function scanHeadings(doc: Text, fromLine: number, toLine: number): HeadingEntry[] {
  const headings: HeadingEntry[] = [];
  for (let lineNumber = fromLine; lineNumber <= toLine; lineNumber++) {
    const line = doc.line(lineNumber);
    const match = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(getBoundedLineText(doc, lineNumber));
    if (!match?.[1] || !match[2]) continue;
    headings.push({ from: line.from, level: match[1].length, text: match[2].trim() });
  }
  return headings;
}

function getHeadingTrail(headings: readonly HeadingEntry[], cursor: number): readonly string[] {
  const trail: Array<string | undefined> = [];
  for (const heading of headings) {
    if (heading.from > cursor) break;
    trail[heading.level - 1] = heading.text;
    trail.length = heading.level;
  }
  return trail.filter((item): item is string => typeof item === 'string');
}

interface ChangedLineBounds {
  oldFrom: number;
  oldTo: number;
  newFrom: number;
  newTo: number;
  oldStartLine: number;
  oldEndLine: number;
  newStartLine: number;
  newEndLine: number;
  oldLineFrom: number;
  oldLineTo: number;
  newLineFrom: number;
  newLineTo: number;
}

function getChangedLineBounds(
  oldDoc: Text,
  newDoc: Text,
  changes: ChangeSet,
): ChangedLineBounds | null {
  let oldFrom = Number.POSITIVE_INFINITY;
  let oldTo = 0;
  let newFrom = Number.POSITIVE_INFINITY;
  let newTo = 0;
  changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    oldFrom = Math.min(oldFrom, fromA);
    oldTo = Math.max(oldTo, toA);
    newFrom = Math.min(newFrom, fromB);
    newTo = Math.max(newTo, toB);
  });
  if (!Number.isFinite(oldFrom) || !Number.isFinite(newFrom)) return null;
  const safeOldTo = Math.min(oldDoc.length, Math.max(oldFrom, oldTo));
  const safeNewTo = Math.min(newDoc.length, Math.max(newFrom, newTo));
  const oldStartLine = oldDoc.lineAt(oldFrom).number;
  const oldEndLine = oldDoc.lineAt(safeOldTo).number;
  const newStartLine = newDoc.lineAt(newFrom).number;
  const newEndLine = newDoc.lineAt(safeNewTo).number;
  return {
    oldFrom,
    oldTo: safeOldTo,
    newFrom,
    newTo: safeNewTo,
    oldStartLine,
    oldEndLine,
    newStartLine,
    newEndLine,
    oldLineFrom: oldDoc.line(oldStartLine).from,
    oldLineTo: oldDoc.line(oldEndLine).to,
    newLineFrom: newDoc.line(newStartLine).from,
    newLineTo: newDoc.line(newEndLine).to,
  };
}

function updateHeadings(
  headings: readonly HeadingEntry[],
  newDoc: Text,
  changes: ChangeSet,
  bounds: ChangedLineBounds,
): readonly HeadingEntry[] {
  const retained = headings
    .filter((heading) => heading.from < bounds.oldLineFrom || heading.from > bounds.oldLineTo)
    .map((heading) => ({ ...heading, from: changes.mapPos(heading.from, 1) }))
    .filter((heading) => heading.from < bounds.newLineFrom || heading.from > bounds.newLineTo);
  const rescanned = scanHeadings(newDoc, bounds.newStartLine, bounds.newEndLine);
  return [...retained, ...rescanned].sort((a, b) => a.from - b.from);
}

function updateFrontmatterEnd(
  previousEnd: number | null,
  oldDoc: Text,
  newDoc: Text,
  changes: ChangeSet,
  bounds: ChangedLineBounds,
): number | null {
  if (!/^\uFEFF?---[ \t]*$/u.test(getBoundedLineText(newDoc, 1))) return null;
  if (previousEnd === null) return findFrontmatterEndBounded(newDoc, 2);

  const mappedEnd = changes.mapPos(previousEnd, 1);
  const changedDelimiter = findFrontmatterDelimiter(
    newDoc,
    Math.max(2, bounds.newStartLine),
    bounds.newEndLine,
  );
  if (previousEnd === oldDoc.length) return changedDelimiter ?? newDoc.length;

  const oldClosingLine = oldDoc.lineAt(previousEnd);
  const touchesClosingLine =
    bounds.oldLineFrom <= oldClosingLine.to && bounds.oldLineTo >= oldClosingLine.from;
  if (!touchesClosingLine) {
    return changedDelimiter !== null && changedDelimiter < mappedEnd ? changedDelimiter : mappedEnd;
  }

  return findFrontmatterEndBounded(newDoc, Math.max(2, bounds.newStartLine - 1));
}

function findFrontmatterEndBounded(doc: Text, fromLine: number): number {
  if (doc.lines < 2) return doc.length;
  const safeFromLine = Math.max(2, Math.min(fromLine, doc.lines));
  const maximumLine = Math.min(doc.lines, safeFromLine + 512);
  const maximumPosition = Math.min(doc.length, doc.line(safeFromLine).from + 64 * 1024);
  for (let lineNumber = safeFromLine; lineNumber <= maximumLine; lineNumber++) {
    const line = doc.line(lineNumber);
    if (line.from > maximumPosition) break;
    if (/^---[ \t]*$/u.test(getBoundedLineText(doc, lineNumber))) return line.to;
  }
  return doc.length;
}

function findFrontmatterDelimiter(doc: Text, fromLine: number, toLine: number): number | null {
  for (let lineNumber = fromLine; lineNumber <= Math.min(doc.lines, toLine); lineNumber++) {
    const line = doc.line(lineNumber);
    if (/^---[ \t]*$/u.test(getBoundedLineText(doc, lineNumber))) return line.to;
  }
  return null;
}
