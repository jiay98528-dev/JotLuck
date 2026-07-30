import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __parseLiveBlocksForTest,
  exitLivePreviewOnEscape,
  livePreviewExtension,
  toggleBlockRender,
  unpinFocusedBlock,
} from '../cm6-live-preview';

const mountedViews: EditorView[] = [];

function mountLiveEditor(doc: string, anchor: number): EditorView {
  const host = document.createElement('div');
  document.body.append(host);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [
        keymap.of([
          {
            key: 'Enter',
            run: (target) => {
              const cursor = target.state.selection.main.head;
              target.dispatch({ changes: { from: cursor, insert: '\n' } });
              return true;
            },
          },
        ]),
        livePreviewExtension(),
      ],
    }),
    parent: host,
  });
  mountedViews.push(view);
  view.focus();
  return view;
}

function findRenderedBlock(view: EditorView, text: string): HTMLElement | undefined {
  return [...view.dom.querySelectorAll<HTMLElement>('.cm-live-block')].find((block) =>
    block.textContent?.includes(text),
  );
}

afterEach(() => {
  while (mountedViews.length > 0) mountedViews.pop()?.destroy();
  document.body.replaceChildren();
});

describe('cm6 live preview table rendering', () => {
  it('renders table rows with a shared grid template instead of fake table cells', () => {
    const blocks = __parseLiveBlocksForTest(
      ['| 维度 | 评分 | 说明 |', '| :--- | ---: | :--- |', '| 前端开发 | 85 | React 主力栈 |'].join(
        '\n',
      ),
    );

    const rows = blocks.filter((block) => block.type === 'tableRow');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ tableColumnCount: 3, tableHeader: true });
    expect(rows[1]).toMatchObject({ position: 'separator' });
    expect(rows[2]?.tableGridTemplate).toBe(rows[0]?.tableGridTemplate);
    expect(rows[0]?.html).toContain('ml-table-cell--header');
    expect(rows[0]?.html).toContain('data-table-column-count="3"');
    expect(rows[2]?.html).toContain('ml-table-cell--align-right');
    expect(rows[2]?.html).not.toContain('ml-td');
  });

  it('marks table rows without a separator as unclosed', () => {
    const rows = __parseLiveBlocksForTest('| A | B |\n| C | D |').filter(
      (block) => block.type === 'tableRow',
    );

    expect(rows.every((row) => row.unclosed)).toBe(true);
  });
});

describe('cm6 live preview markdown block boundaries', () => {
  it('keeps setext heading text and rule as paired heading blocks', () => {
    const blocks = __parseLiveBlocksForTest('Release Notes\n---\n\nBody text');

    expect(blocks[0]).toMatchObject({
      type: 'setextHeadingText',
      raw: 'Release Notes',
    });
    expect(blocks[0]?.html).toContain('Release Notes');
    expect(blocks[0]?.html).toContain('<h2 id="heading-release-notes">');
    expect(blocks[1]).toMatchObject({
      type: 'setextHeadingRule',
      raw: '---',
    });
    expect(blocks[1]?.html).toBe('');
  });

  it('keeps fenced JSON as code fence lines instead of wrapping it as bare JSON', () => {
    const blocks = __parseLiveBlocksForTest(
      ['```json', '{', '  "ok": true', '}', '```'].join('\n'),
    );

    expect(blocks).toHaveLength(5);
    expect(blocks.every((block) => block.type === 'codeFenceLine')).toBe(true);
    expect(blocks[0]?.html).toContain('cm-code-lang');
    expect(blocks[2]?.html).toContain('"ok": true');
  });

  it('renders fenced code containing blank lines without crashing the view plugin', async () => {
    const doc = ['```json', '{', '', '  "ok": true', '}', '```', '', '# End'].join('\n');
    const host = document.createElement('div');
    document.body.append(host);
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: [livePreviewExtension()],
      }),
      parent: host,
    });
    mountedViews.push(view);

    await vi.waitFor(() => {
      expect(
        view.dom.querySelectorAll('.cm-live-block[data-block-type="codeFenceLine"]').length,
      ).toBeGreaterThanOrEqual(6);
    });
    expect(view.state.doc.toString()).toBe(doc);
  });

  it('renders a bare JSON block with preserved indentation', () => {
    const blocks = __parseLiveBlocksForTest(['{', '  "ok": true', '}'].join('\n'));

    expect(blocks).toHaveLength(3);
    expect(blocks.every((block) => block.type === 'jsonBlockLine')).toBe(true);
    expect(blocks[0]?.html).toContain('cm-json-line');
    expect(blocks[1]?.html).toContain('&nbsp;&nbsp;');
  });

  it('recognizes GFM tables without outer pipes', () => {
    const rows = __parseLiveBlocksForTest(
      ['Name | Score', '--- | ---:', 'JotLuck | 95'].join('\n'),
    ).filter((block) => block.type === 'tableRow');

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ tableHeader: true, tableColumnCount: 2 });
    expect(rows[2]?.html).toContain('ml-table-cell--align-right');
  });
});

describe('cm6 live preview Escape focus contract', () => {
  it('restores the exact edited block and lets Enter return to source editing', async () => {
    const doc = ['# First', '', 'Unique edited paragraph'].join('\n');
    const anchor = doc.indexOf('Unique') + 3;
    const view = mountLiveEditor(doc, anchor);

    await vi.waitFor(() => {
      expect(findRenderedBlock(view, 'First')).toBeDefined();
      expect(findRenderedBlock(view, 'Unique edited paragraph')).toBeUndefined();
    });

    expect(unpinFocusedBlock(view)).toBe(true);
    await vi.waitFor(() => {
      const restored = findRenderedBlock(view, 'Unique edited paragraph');
      expect(restored).toBeDefined();
      expect(document.activeElement).toBe(restored);
    });
    expect(view.state.doc.toString()).toBe(doc);

    const restored = findRenderedBlock(view, 'Unique edited paragraph')!;
    restored.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() => {
      expect(view.hasFocus).toBe(true);
      expect(findRenderedBlock(view, 'Unique edited paragraph')).toBeUndefined();
    });
    expect(view.state.selection.main.head).toBe(doc.indexOf('Unique'));
    expect(view.state.doc.toString()).toBe(doc);
  });

  it('unpins a pinned block before restoring and focusing that same rendered block', async () => {
    const doc = ['Rendered sibling', '', 'Pinned unique paragraph'].join('\n');
    const anchor = doc.indexOf('Pinned') + 2;
    const view = mountLiveEditor(doc, anchor);

    expect(toggleBlockRender(view)).toBe(true);
    expect(unpinFocusedBlock(view)).toBe(true);

    await vi.waitFor(() => {
      const restored = findRenderedBlock(view, 'Pinned unique paragraph');
      expect(restored).toBeDefined();
      expect(document.activeElement).toBe(restored);
    });
    expect(view.state.doc.toString()).toBe(doc);
  });

  it('restores by document position when editing changes the block type and key', async () => {
    const doc = ['## Mutable heading', '', 'Rendered sibling'].join('\n');
    const view = mountLiveEditor(doc, doc.indexOf('Mutable') + 2);

    view.dispatch({
      changes: { from: 0, to: 3, insert: 'GUI ' },
      selection: { anchor: 4 },
    });
    expect(unpinFocusedBlock(view)).toBe(true);

    await vi.waitFor(() => {
      const restored = findRenderedBlock(view, 'GUI Mutable heading');
      expect(restored).toBeDefined();
      expect(document.activeElement).toBe(restored);
    });
    expect(view.state.doc.toString()).toBe(
      ['GUI Mutable heading', '', 'Rendered sibling'].join('\n'),
    );
  });

  it('does not consume Escape or restore the block while IME composition is active', async () => {
    const doc = ['Rendered sibling', '', '正在输入的段落'].join('\n');
    const anchor = doc.indexOf('正在输入') + 2;
    const view = mountLiveEditor(doc, anchor);
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));

    expect(view.composing || view.compositionStarted).toBe(true);
    expect(exitLivePreviewOnEscape(view)).toBe(false);
    expect(view.hasFocus).toBe(true);
    expect(findRenderedBlock(view, '正在输入的段落')).toBeUndefined();
    expect(view.state.doc.toString()).toBe(doc);

    view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  });
});

describe('cm6 live preview list rendering', () => {
  it('renders ordered list numbers in a dedicated marker column', () => {
    const rows = __parseLiveBlocksForTest('1. Alpha\n1. Beta').filter(
      (block) => block.type === 'orderedListItem',
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]?.html).toContain('cm-list-marker-slot');
    expect(rows[0]?.html).toContain('cm-list-content');
    expect(rows[0]?.html).toContain('>1.</span>');
    expect(rows[1]?.html).toContain('>2.</span>');
  });

  it('renders unordered list bullets in the same stable list structure', () => {
    const [row] = __parseLiveBlocksForTest('- Alpha').filter(
      (block) => block.type === 'unorderedListItem',
    );

    expect(row?.html).toContain('cm-list-marker-slot');
    expect(row?.html).toContain('cm-list-content');
    expect(row?.html).toContain('Alpha');
  });
});
