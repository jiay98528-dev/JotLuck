import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import { afterEach, describe, expect, it } from 'vitest';
import {
  detectContinuationContext,
  smartContinueKeymap,
  smartContinueOnEnter,
  smartCancelOnBackspace,
  smartCancelOnEscape,
} from '../cm6-smart-continue';

const mountedViews: EditorView[] = [];

function mountSmartEditor(doc: string, cursor = doc.length) {
  const host = document.createElement('div');
  document.body.append(host);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [history(), keymap.of(smartContinueKeymap)],
    }),
    parent: host,
  });
  mountedViews.push(view);
  view.focus();
  return view;
}

function pressKey(view: EditorView, key: string) {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
}

function startIme(view: EditorView) {
  view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
}

function endIme(view: EditorView) {
  view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
}

afterEach(() => {
  while (mountedViews.length > 0) mountedViews.pop()?.destroy();
  document.body.replaceChildren();
});

describe('detectContinuationContext', () => {
  it('detects an unordered list item at line end with marker range', () => {
    const view = mountSmartEditor('- foo');
    expect(detectContinuationContext(view.state)).toEqual({
      kind: 'unorderedListItem',
      lineFrom: 0,
      lineTo: 5,
      isEmptyBlock: false,
      atLineEnd: true,
      nextMarker: '- ',
      markerFrom: 0,
      markerTo: 2,
      tableColumnCount: 0,
      isTableSeparator: false,
      isTableHeader: false,
    });
  });

  it('reports atLineEnd false when the cursor is inside the line', () => {
    const view = mountSmartEditor('- foo', 2);
    const context = detectContinuationContext(view.state);
    expect(context?.kind).toBe('unorderedListItem');
    expect(context?.atLineEnd).toBe(false);
  });

  it('detects an empty unordered block', () => {
    const view = mountSmartEditor('- ');
    const context = detectContinuationContext(view.state);
    expect(context?.isEmptyBlock).toBe(true);
    expect(context?.nextMarker).toBe('- ');
  });

  it('detects ordered lists and advances the number with style preserved', () => {
    const dot = mountSmartEditor('12. foo');
    expect(detectContinuationContext(dot.state)).toMatchObject({
      kind: 'orderedListItem',
      nextMarker: '13. ',
      markerFrom: 0,
      markerTo: 4,
    });
    const paren = mountSmartEditor('2) foo');
    expect(detectContinuationContext(paren.state)).toMatchObject({
      kind: 'orderedListItem',
      nextMarker: '3) ',
    });
  });

  it('detects task list items and always continues unchecked', () => {
    const done = mountSmartEditor('- [x] done');
    expect(detectContinuationContext(done.state)).toMatchObject({
      kind: 'taskListItem',
      nextMarker: '- [ ] ',
      markerFrom: 0,
      markerTo: 6,
      isEmptyBlock: false,
    });
    const empty = mountSmartEditor('- [ ] ');
    expect(detectContinuationContext(empty.state)).toMatchObject({
      kind: 'taskListItem',
      isEmptyBlock: true,
      markerTo: 6,
    });
  });

  it('detects blockquotes at any depth', () => {
    const single = mountSmartEditor('> foo');
    expect(detectContinuationContext(single.state)).toMatchObject({
      kind: 'blockquoteLine',
      nextMarker: '> ',
      markerFrom: 0,
      markerTo: 2,
    });
    const nested = mountSmartEditor('>> foo');
    expect(detectContinuationContext(nested.state)).toMatchObject({
      kind: 'blockquoteLine',
      nextMarker: '>> ',
      markerTo: 3,
    });
  });

  it('detects table rows and counts columns from pipes', () => {
    const view = mountSmartEditor('| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |');
    expect(detectContinuationContext(view.state)).toMatchObject({
      kind: 'tableRow',
      tableColumnCount: 3,
      nextMarker: '',
      isTableHeader: false,
    });
  });

  it('flags a table row as header when the next line is a separator', () => {
    const doc = '| a | b |\n|---|---|';
    const view = mountSmartEditor(doc, doc.indexOf('a'));
    expect(detectContinuationContext(view.state)).toMatchObject({
      kind: 'tableRow',
      tableColumnCount: 2,
      isTableHeader: true,
    });
  });

  it('normalizes fullwidth bullets before detecting unordered lists', () => {
    const hyphen = mountSmartEditor('－ 项目');
    expect(detectContinuationContext(hyphen.state)).toMatchObject({
      kind: 'unorderedListItem',
      nextMarker: '- ',
    });
    const star = mountSmartEditor('＊ 项目');
    expect(detectContinuationContext(star.state)).toMatchObject({
      kind: 'unorderedListItem',
      nextMarker: '* ',
    });
    const plus = mountSmartEditor('＋ 项目');
    expect(detectContinuationContext(plus.state)).toMatchObject({
      kind: 'unorderedListItem',
      nextMarker: '+ ',
    });
  });

  it('normalizes a fullwidth blockquote marker', () => {
    const view = mountSmartEditor('＞ 引用');
    expect(detectContinuationContext(view.state)).toMatchObject({
      kind: 'blockquoteLine',
      nextMarker: '> ',
    });
  });

  it('normalizes fullwidth table pipes before counting columns', () => {
    const view = mountSmartEditor('｜ a ｜ b ｜\n|---|---|\n｜ 1 ｜ 2 ｜');
    expect(detectContinuationContext(view.state)).toMatchObject({
      kind: 'tableRow',
      tableColumnCount: 2,
    });
  });

  it('returns null for plain paragraphs, blank lines and separator rows', () => {
    const paragraph = mountSmartEditor('hello world');
    expect(detectContinuationContext(paragraph.state)).toBeNull();
    const blankDoc = 'foo\n\nbar';
    const blank = mountSmartEditor(blankDoc, blankDoc.indexOf('\n\n') + 1);
    expect(detectContinuationContext(blank.state)).toBeNull();
    const tableDoc = '| a |\n|---|\n| b |';
    const separator = mountSmartEditor(tableDoc, tableDoc.indexOf('---'));
    expect(detectContinuationContext(separator.state)).toBeNull();
  });

  it('returns null inside fenced code blocks and frontmatter', () => {
    const fenceDoc = '```\n- foo\n```';
    const fence = mountSmartEditor(fenceDoc, fenceDoc.indexOf('-') + 1);
    expect(detectContinuationContext(fence.state)).toBeNull();
    const fmDoc = '---\ntitle: hi\n---\nfoo';
    const frontmatter = mountSmartEditor(fmDoc, fmDoc.indexOf('title') + 2);
    expect(detectContinuationContext(frontmatter.state)).toBeNull();
  });

  it('returns null for non-empty selections', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const view = new EditorView({
      state: EditorState.create({
        doc: '- foo',
        selection: { anchor: 0, head: 3 },
      }),
      parent: host,
    });
    mountedViews.push(view);
    expect(detectContinuationContext(view.state)).toBeNull();
  });
});

describe('smartContinueOnEnter', () => {
  it('continues an unordered list at line end and undoes in one step', () => {
    const view = mountSmartEditor('- foo');
    expect(smartContinueOnEnter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('- foo\n- ');
    expect(view.state.selection.main.head).toBe(8);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('- foo');
  });

  it('continues through the keymap binding', () => {
    const view = mountSmartEditor('- foo');
    pressKey(view, 'Enter');
    expect(view.state.doc.toString()).toBe('- foo\n- ');
    expect(view.state.selection.main.head).toBe(8);
  });

  it('splits a list item in the middle of the line', () => {
    const view = mountSmartEditor('- foo  bar', 6);
    expect(smartContinueOnEnter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('- foo \n- bar');
    expect(view.state.selection.main.head).toBe(9);
  });

  it('exits the structure on an empty block (E2) and undoes in one step', () => {
    const view = mountSmartEditor('- foo\n- ');
    expect(smartContinueOnEnter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('- foo\n');
    expect(view.state.selection.main.head).toBe(6);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('- foo\n- ');
  });

  it('clears trailing whitespace when exiting an empty block', () => {
    const view = mountSmartEditor('-   ');
    expect(smartContinueOnEnter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('');
    expect(view.state.selection.main.head).toBe(0);
  });

  it('advances ordered numbers and preserves the delimiter style', () => {
    const dot = mountSmartEditor('1. foo');
    expect(smartContinueOnEnter(dot)).toBe(true);
    expect(dot.state.doc.toString()).toBe('1. foo\n2. ');
    const paren = mountSmartEditor('2) foo');
    expect(smartContinueOnEnter(paren)).toBe(true);
    expect(paren.state.doc.toString()).toBe('2) foo\n3) ');
  });

  it('does not renumber the following ordered items', () => {
    const view = mountSmartEditor('1. foo\n2. bar', 6);
    expect(smartContinueOnEnter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('1. foo\n2. \n2. bar');
  });

  it('continues a task item as unchecked with the same bullet', () => {
    const view = mountSmartEditor('- [x] done');
    expect(smartContinueOnEnter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('- [x] done\n- [ ] ');
    expect(view.state.selection.main.head).toBe(17);
  });

  it('continues blockquotes at the same depth', () => {
    const single = mountSmartEditor('> foo');
    expect(smartContinueOnEnter(single)).toBe(true);
    expect(single.state.doc.toString()).toBe('> foo\n> ');
    const nested = mountSmartEditor('>> foo');
    expect(smartContinueOnEnter(nested)).toBe(true);
    expect(nested.state.doc.toString()).toBe('>> foo\n>> ');
  });

  it('splits a blockquote line in the middle', () => {
    const view = mountSmartEditor('> foo bar', 2);
    expect(smartContinueOnEnter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('> \n> foo bar');
    expect(view.state.selection.main.head).toBe(5);
  });

  it('inserts an empty row below a table row and lands in the first cell', () => {
    const doc = '| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |';
    const view = mountSmartEditor(doc);
    expect(smartContinueOnEnter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(`${doc}\n|  |  |  |`);
    expect(view.state.selection.main.head).toBe(doc.length + 3);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it('inserts below the separator row when Enter fires on the header', () => {
    const doc = '| a | b |\n|---|---|\n| c | d |';
    const view = mountSmartEditor(doc, doc.indexOf('a'));
    expect(smartContinueOnEnter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('| a | b |\n|---|---|\n|  |  |\n| c | d |');
    expect(view.state.selection.main.head).toBe(22);
  });

  it('keeps the same column count for a table row Enter at any cursor position', () => {
    const doc = '| a | b |\n|---|---|\n| 1 | 2 |';
    const view = mountSmartEditor(doc, doc.indexOf('1'));
    expect(smartContinueOnEnter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(`${doc}\n|  |  |`);
  });

  it('does not intercept Enter inside fences or frontmatter', () => {
    const fenceDoc = '```\n- foo\n```';
    const fence = mountSmartEditor(fenceDoc, fenceDoc.indexOf('-') + 1);
    expect(smartContinueOnEnter(fence)).toBe(false);
    expect(fence.state.doc.toString()).toBe(fenceDoc);
    const fmDoc = '---\ntitle: hi\n---\nfoo';
    const frontmatter = mountSmartEditor(fmDoc, fmDoc.indexOf('title') + 2);
    expect(smartContinueOnEnter(frontmatter)).toBe(false);
    expect(frontmatter.state.doc.toString()).toBe(fmDoc);
  });

  it('does not intercept Enter on plain paragraphs or blank lines', () => {
    const paragraph = mountSmartEditor('hello world');
    expect(smartContinueOnEnter(paragraph)).toBe(false);
    expect(paragraph.state.doc.toString()).toBe('hello world');
    const blankDoc = 'foo\n\nbar';
    const blank = mountSmartEditor(blankDoc, blankDoc.indexOf('\n\n') + 1);
    expect(smartContinueOnEnter(blank)).toBe(false);
    expect(blank.state.doc.toString()).toBe(blankDoc);
  });
});

describe('smartCancelOnBackspace', () => {
  it('removes the marker of an empty list block and undoes in one step', () => {
    const view = mountSmartEditor('- foo\n- ');
    expect(smartCancelOnBackspace(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('- foo\n');
    expect(view.state.selection.main.head).toBe(6);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('- foo\n- ');
  });

  it('removes the marker of an empty task block', () => {
    const view = mountSmartEditor('- [ ] ');
    expect(smartCancelOnBackspace(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('');
    expect(view.state.selection.main.head).toBe(0);
  });

  it('deletes an empty table row and leaves an empty paragraph after the table', () => {
    const doc = '| a | b |\n|---|---|\n|  |  |\ntail';
    const view = mountSmartEditor(doc, 24);
    expect(smartCancelOnBackspace(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('| a | b |\n|---|---|\n\ntail');
    expect(view.state.selection.main.head).toBe(20);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it('moves onto the existing empty line after the table when there is one', () => {
    const doc = '| a | b |\n|---|---|\n|  |  |\n\ntail';
    const view = mountSmartEditor(doc, 24);
    expect(smartCancelOnBackspace(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('| a | b |\n|---|---|\n\ntail');
    expect(view.state.selection.main.head).toBe(20);
  });

  it('deletes an empty table row at the end of the document', () => {
    const doc = '| a | b |\n|---|---|\n|  |  |';
    const view = mountSmartEditor(doc, 24);
    expect(smartCancelOnBackspace(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('| a | b |\n|---|---|\n');
    expect(view.state.selection.main.head).toBe(20);
  });

  it('removes the marker of a non-empty block when the cursor sits at markerTo', () => {
    const dash = mountSmartEditor('- foo', 2);
    expect(smartCancelOnBackspace(dash)).toBe(true);
    expect(dash.state.doc.toString()).toBe('foo');
    expect(dash.state.selection.main.head).toBe(0);

    const task = mountSmartEditor('- [x] foo', 6);
    expect(smartCancelOnBackspace(task)).toBe(true);
    expect(task.state.doc.toString()).toBe('foo');

    const ordered = mountSmartEditor('1. foo', 3);
    expect(smartCancelOnBackspace(ordered)).toBe(true);
    expect(ordered.state.doc.toString()).toBe('foo');
  });

  it('returns false for non-empty blocks away from the marker end', () => {
    const endOfLine = mountSmartEditor('- foo', 5);
    expect(smartCancelOnBackspace(endOfLine)).toBe(false);
    expect(endOfLine.state.doc.toString()).toBe('- foo');
    const inside = mountSmartEditor('- foo', 4);
    expect(smartCancelOnBackspace(inside)).toBe(false);
  });

  it('returns false on non-empty table rows', () => {
    const view = mountSmartEditor('| a | b |', 5);
    expect(smartCancelOnBackspace(view)).toBe(false);
    expect(view.state.doc.toString()).toBe('| a | b |');
  });
});

describe('smartCancelOnEscape', () => {
  it('removes the marker of an empty block', () => {
    const view = mountSmartEditor('- foo\n- ');
    expect(smartCancelOnEscape(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('- foo\n');
    expect(view.state.selection.main.head).toBe(6);
  });

  it('deletes an empty table row', () => {
    const doc = '| a | b |\n|---|---|\n|  |  |\ntail';
    const view = mountSmartEditor(doc, 24);
    expect(smartCancelOnEscape(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('| a | b |\n|---|---|\n\ntail');
    expect(view.state.selection.main.head).toBe(20);
  });

  it('returns false on non-empty blocks and non-empty table rows', () => {
    const list = mountSmartEditor('- foo');
    expect(smartCancelOnEscape(list)).toBe(false);
    const table = mountSmartEditor('| a | b |', 5);
    expect(smartCancelOnEscape(table)).toBe(false);
  });
});

describe('cursor before marker', () => {
  it('does not split when the cursor is inside or before the marker', () => {
    const atZero = mountSmartEditor('- foo', 0);
    expect(smartContinueOnEnter(atZero)).toBe(false);
    expect(atZero.state.doc.toString()).toBe('- foo');

    const insideMarker = mountSmartEditor('- foo', 1);
    expect(smartContinueOnEnter(insideMarker)).toBe(false);
    expect(insideMarker.state.doc.toString()).toBe('- foo');
  });

  it('splits at the marker/content boundary', () => {
    const view = mountSmartEditor('- foo', 2);
    expect(smartContinueOnEnter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('- \n- foo');
  });
});

describe('table group requires separator', () => {
  it('returns null for a lone pipe line without a separator (hand-building a table)', () => {
    const view = mountSmartEditor('| 列A | 列B | 列C |');
    expect(detectContinuationContext(view.state)).toBeNull();
    expect(smartContinueOnEnter(view)).toBe(false);
    expect(view.state.doc.toString()).toBe('| 列A | 列B | 列C |');
  });

  it('detects the header row once the separator exists below', () => {
    const view = mountSmartEditor('| a | b |\n|---|---|', 5);
    const context = detectContinuationContext(view.state);
    expect(context?.kind).toBe('tableRow');
    expect(context?.isTableHeader).toBe(true);
  });

  it('detects a data row when the separator sits above in the group', () => {
    const doc = '| a | b |\n|---|---|\n| c | d |';
    const view = mountSmartEditor(doc, doc.length);
    const context = detectContinuationContext(view.state);
    expect(context?.kind).toBe('tableRow');
    expect(context?.isTableHeader).toBe(false);
  });
});

describe('IME composition guard', () => {
  it('keeps all three commands inert while composing', () => {
    const view = mountSmartEditor('- foo');
    startIme(view);
    expect(view.composing || view.compositionStarted).toBe(true);

    expect(smartContinueOnEnter(view)).toBe(false);
    expect(smartCancelOnBackspace(view)).toBe(false);
    expect(smartCancelOnEscape(view)).toBe(false);
    expect(view.state.doc.toString()).toBe('- foo');

    endIme(view);
    expect(smartContinueOnEnter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('- foo\n- ');
  });

  it('keeps the keymap inert while composing', () => {
    const view = mountSmartEditor('- foo');
    startIme(view);
    pressKey(view, 'Enter');
    pressKey(view, 'Backspace');
    pressKey(view, 'Escape');
    expect(view.state.doc.toString()).toBe('- foo');
    endIme(view);
  });
});

describe('smartContinueKeymap', () => {
  it('binds Enter, Backspace and Escape in order', () => {
    expect(smartContinueKeymap.map((binding) => binding.key)).toEqual([
      'Enter',
      'Backspace',
      'Escape',
    ]);
  });

  it('drives Backspace through the keymap binding', () => {
    const view = mountSmartEditor('- ');
    pressKey(view, 'Backspace');
    expect(view.state.doc.toString()).toBe('');
    expect(view.state.selection.main.head).toBe(0);
  });
});

describe('R4-9① 全角标记源码精确区间', () => {
  it('tracks source-exact marker offsets for a fullwidth blockquote without space', () => {
    const view = mountSmartEditor('＞foo', 1);
    const context = detectContinuationContext(view.state);
    expect(context).toMatchObject({
      kind: 'blockquoteLine',
      markerFrom: 0,
      markerTo: 1,
      nextMarker: '> ',
    });
    // 源码切片恰为全角标记本身（不含后续内容）
    expect(view.state.doc.sliceString(context!.markerFrom, context!.markerTo)).toBe('＞');
    // Backspace 取消：删除区间精确，内容完整保留
    expect(smartCancelOnBackspace(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('foo');
    expect(view.state.selection.main.head).toBe(0);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('＞foo');
  });

  it('splits a fullwidth blockquote line with source-exact cursor landing', () => {
    const view = mountSmartEditor('＞foo', 2);
    expect(smartContinueOnEnter(view)).toBe(true);
    // 在光标处（f 与 o 之间）拆分：首行保留 '＞f'，续行 '> oo'
    expect(view.state.doc.toString()).toBe('＞f\n> oo');
    // 光标落在延续标记之后
    expect(view.state.selection.main.head).toBe(5);
  });

  it('tracks source-exact marker offsets for a fullwidth bullet with two fullwidth spaces', () => {
    const view = mountSmartEditor('－　　foo', 3);
    const context = detectContinuationContext(view.state);
    expect(context).toMatchObject({
      kind: 'unorderedListItem',
      markerFrom: 0,
      markerTo: 3,
      nextMarker: '- ',
    });
    // 源码切片 = 全角连字符 + 两个全角空格（各 1 个 UTF-16 码元）
    expect(view.state.doc.sliceString(context!.markerFrom, context!.markerTo)).toBe('－　　');
    // Backspace 取消：markerTo 恰为标记 + 分隔空白边界
    expect(smartCancelOnBackspace(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('foo');
    expect(view.state.selection.main.head).toBe(0);
  });
});

describe('R4-9② 全角标记延续产出半角 nextMarker', () => {
  it('continues a fullwidth bullet at line end with a halfwidth marker', () => {
    const view = mountSmartEditor('－　foo');
    expect(smartContinueOnEnter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('－　foo\n- ');
    expect(view.state.selection.main.head).toBe(8);
  });

  it('continues a fullwidth task bullet unchecked with a halfwidth marker', () => {
    const view = mountSmartEditor('－ [x] 完成');
    expect(smartContinueOnEnter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('－ [x] 完成\n- [ ] ');
  });
});

describe('R4-9③ 表格中部删空行不断表', () => {
  it('deletes a mid-table empty row and lands in the next row first cell', () => {
    const doc = '| a | b |\n|---|---|\n| 1 | 2 |\n|  |  |\n| 5 | 6 |\ntail';
    const emptyRowFrom = doc.indexOf('\n|  |  |') + 1;
    const view = mountSmartEditor(doc, emptyRowFrom + 3);
    expect(smartCancelOnBackspace(view)).toBe(true);
    // 仅删行：表不断裂、不补任何空行
    expect(view.state.doc.toString()).toBe('| a | b |\n|---|---|\n| 1 | 2 |\n| 5 | 6 |\ntail');
    // 光标落到下一行首个单元格（“5”处）
    expect(view.state.selection.main.head).toBe(emptyRowFrom + 2);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it('treats the same way via Escape on a mid-table empty row', () => {
    const doc = '| a | b |\n|---|---|\n| 1 | 2 |\n|  |  |\n| 5 | 6 |';
    const emptyRowFrom = doc.indexOf('\n|  |  |') + 1;
    const view = mountSmartEditor(doc, emptyRowFrom + 3);
    expect(smartCancelOnEscape(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('| a | b |\n|---|---|\n| 1 | 2 |\n| 5 | 6 |');
    expect(view.state.selection.main.head).toBe(emptyRowFrom + 2);
  });

  it('keeps appending the after-table empty paragraph for the last empty row', () => {
    // 表尾空行保持原行为：删行 + 表后补空段（既有 49 例语义钉死）
    const doc = '| a | b |\n|---|---|\n| 1 | 2 |\n|  |  |\ntail';
    const emptyRowFrom = doc.indexOf('\n|  |  |', doc.indexOf('| 1')) + 1;
    const view = mountSmartEditor(doc, emptyRowFrom + 3);
    expect(smartCancelOnBackspace(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('| a | b |\n|---|---|\n| 1 | 2 |\n\ntail');
    expect(view.state.selection.main.head).toBe(emptyRowFrom);
  });
});

describe('R4-9④ 全角分隔行表格', () => {
  it('detects a fullwidth-dash separator row and prefills a new row on Enter from the header', () => {
    const doc = '｜ 标题 ｜ 名称 ｜\n｜－－－｜－－－｜';
    const view = mountSmartEditor(doc, doc.indexOf('标题'));
    const context = detectContinuationContext(view.state);
    expect(context).toMatchObject({
      kind: 'tableRow',
      tableColumnCount: 2,
      isTableHeader: true,
    });
    expect(smartContinueOnEnter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(`${doc}\n|  |  |`);
  });

  it('does not intercept Enter on the fullwidth separator row itself', () => {
    const doc = '｜ 标题 ｜ 名称 ｜\n｜－－－｜－－－｜';
    const view = mountSmartEditor(doc);
    expect(detectContinuationContext(view.state)).toBeNull();
    expect(smartContinueOnEnter(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
  });
});
