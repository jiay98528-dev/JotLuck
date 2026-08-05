import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { MarkdownPredictor } from '../../MarkdownPredictor';
import { DEFAULT_COMPLETION_SETTINGS } from '../../CompletionSettings';
import { buildCompletionContext, buildCompletionContextFromSnapshot } from '../context';
import {
  completionDocumentContextField,
  createOpenedDocumentParagraphChange,
  getCompletionDocumentContext,
} from '../document-context';

function state(doc: string, cursor = doc.length): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown(), completionDocumentContextField],
  });
}

describe('CompletionDocumentContextField', () => {
  it.each([
    ['paragraph', 'ordinary prose', 'paragraph'],
    ['heading', '# Release', 'heading'],
    ['list', '- item', 'list'],
    ['quote', '> note', 'quote'],
    ['code', '```ts\nconst value = 1', 'code'],
  ] as const)('matches legacy block classification for %s', (_label, doc, expected) => {
    const editorState = state(doc);
    const snapshot = getCompletionDocumentContext(editorState);
    const legacy = buildCompletionContext({
      doc,
      cursorPos: doc.length,
      settings: DEFAULT_COMPLETION_SETTINGS,
      indexData: null,
      n: 4,
    });
    const bounded = buildCompletionContextFromSnapshot({
      snapshot,
      settings: DEFAULT_COMPLETION_SETTINGS,
      indexData: null,
      n: 4,
    });

    expect(snapshot.blockType).toBe(expected);
    expect(bounded.blockType).toBe(legacy.blockType);
    expect(bounded.syntax.type).toBe(legacy.syntax.type);
  });

  it('increments revision only for document changes and keeps heading trail current', () => {
    const initial = state('# One\n\n## Two\ntext');
    const selectionOnly = initial.update({ selection: { anchor: initial.doc.length - 1 } }).state;
    expect(getCompletionDocumentContext(selectionOnly).documentRevision).toBe(0);

    const changed = selectionOnly.update({
      changes: { from: selectionOnly.doc.length, insert: ' updated' },
    }).state;
    expect(getCompletionDocumentContext(changed)).toMatchObject({
      documentRevision: 1,
      headingTrail: ['One', 'Two'],
    });
  });

  it('replaces a changed heading contribution instead of retaining a duplicate', () => {
    const initial = state('# One\n\nbody');
    const changed = initial.update({
      changes: { from: 2, to: 5, insert: 'Renamed' },
    }).state;
    const internal = changed.field(completionDocumentContextField) as unknown as {
      headings: Array<{ from: number; level: number; text: string }>;
    };

    expect(internal.headings).toEqual([{ from: 0, level: 1, text: 'Renamed' }]);
    expect(getCompletionDocumentContext(changed).headingTrail).toEqual(['Renamed']);
  });

  it('keeps all hot-path text slices bounded for a 1MiB paragraph', () => {
    const editorState = state('x'.repeat(1024 * 1024));
    const snapshot = getCompletionDocumentContext(editorState);

    expect(snapshot.documentWindow.text.length).toBeLessThanOrEqual(32 * 1024);
    expect(snapshot.currentParagraph.text.length).toBeLessThanOrEqual(8 * 1024);
    expect(snapshot.line?.text.length).toBeLessThanOrEqual(8 * 1024);
  });

  it('closes an unbounded 1MiB frontmatter from only the changed line envelope', () => {
    const original = `---\n${'x'.repeat(1024 * 1024)}`;
    const initial = state(original);
    const inserted = '\n---\nbody';
    const transaction = initial.update({
      changes: { from: original.length, insert: inserted },
      selection: { anchor: original.length + inserted.length },
    });
    const snapshot = getCompletionDocumentContext(transaction.state);

    expect(snapshot.documentRevision).toBe(1);
    expect(snapshot.blockType).toBe('paragraph');
    expect(snapshot.currentParagraph.text).toBe('body');
    expect(snapshot.documentWindow.text.length).toBeLessThanOrEqual(32 * 1024);
  });

  it('keeps incremental paragraph L1 equal to a complete paragraph rebuild', () => {
    const original = 'alpha release plan\ncontinues here\n\nsecond paragraph\n';
    const initial = state(original);
    const transaction = initial.update({
      changes: {
        from: original.indexOf('\n\n'),
        to: original.indexOf('\n\n') + 2,
        insert: '\nmerged ',
      },
    });
    const change = createOpenedDocumentParagraphChange(
      initial.doc,
      transaction.state.doc,
      transaction.changes,
    );
    expect(change).not.toBeNull();

    const incremental = new MarkdownPredictor();
    incremental.scanOpenedDocument(original);
    expect(incremental.applyOpenedDocumentParagraphChange(change!)).toBe(true);
    const rebuilt = new MarkdownPredictor();
    rebuilt.scanOpenedDocument(transaction.state.doc.toString());

    const readL1 = (predictor: MarkdownPredictor) =>
      (predictor as unknown as { l1: Map<string, Map<string, number>> }).l1;
    expect(readL1(incremental)).toEqual(readL1(rebuilt));
  });
});
