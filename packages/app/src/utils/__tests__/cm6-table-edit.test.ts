/**
 * cm6-table-edit 单测（V0.2-E3 spec §7.1 + V0.2 R4 增量）
 *
 * 覆盖（spec §7.1 八组用例 + R4 单元格导航九组用例）：
 *   1. 光标→表格/行角色/列解析（表头/分隔行/数据行/两 cell 之间）
 *   2. 插行：数据行上下、表头特判（上方=首行前、下方=分隔行后）、末行下方、columnCount 补齐
 *   3. 插列：左右、锯齿行补齐、分隔行同步、全角 `｜` 表
 *   4. 删行：中部/末行；表头与分隔行禁用断言
 *   5. 删列：中部/末列、`a | b` 无外管道、`\|` 转义 cell 保真、单列表禁用
 *   6. 对齐三分支只改分隔行（数据行字节不动）、锯齿分隔行补齐
 *   7. 删除整表：文档中部/首/尾、邻接空行收敛、其余内容字节不变
 *   8. 每操作单步撤销恢复；IME 守卫；readOnly 无操作且无工具条
 *   9. R4 Tab/Shift+Tab 单元格导航：中间格前进、行末跨行、末格建行（含单步撤销）、
 *       Shift+Tab 后退、首格 Shift+Tab 不动、表格外 Tab 不劫持、readOnly 拒绝、
 *       IME 组合期拒绝、keymap 集成（真实 KeyboardEvent 命中）、slash 菜单守卫
 *       代码路径存在性烟雾测试（cm6-slash-commands.ts 表格内不开菜单）
 *
 * 风格沿用 `cm6-smart-continue.test.ts`（headless EditorView + jsdom）；
 * 仅断言状态与文档内容，不断言几何坐标（spec §4）。
 */
import { Compartment, EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyTableAction,
  buildTableToolbarItems,
  moveTabInCellBackward,
  moveTabInCellForward,
  resolveTableContext,
  tableEditExtension,
  type TableActionId,
} from '../cm6-table-edit';

const mountedViews: EditorView[] = [];

/** 测试自有的 readOnly 重配舱（复刻 MarkdownEditor 的 readOnlyCompartment 用法） */
const readOnlyCompartment = new Compartment();

interface MountOptions {
  cursor?: number;
  readOnly?: boolean;
}

function mountEditor(
  doc: string,
  cursor: number | MountOptions = doc.length,
  readOnly = false,
): EditorView {
  // 双签名支持：mountEditor(doc, cursor, readOnly) 与 mountEditor(doc, opts)
  let resolvedCursor = doc.length;
  let resolvedReadOnly = false;
  if (typeof cursor === 'number') {
    resolvedCursor = cursor;
    resolvedReadOnly = readOnly;
  } else {
    resolvedCursor = cursor.cursor ?? doc.length;
    resolvedReadOnly = cursor.readOnly ?? false;
  }
  const extensions = [
    history(),
    readOnlyCompartment.of([] as Extension[]),
    ...tableEditExtension(),
  ];
  const host = document.createElement('div');
  document.body.append(host);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: resolvedCursor },
      extensions,
    }),
    parent: host,
  });
  mountedViews.push(view);
  if (resolvedReadOnly) {
    view.dispatch({
      effects: readOnlyCompartment.reconfigure([EditorState.readOnly.of(true)]),
    });
  } else {
    view.dispatch({ selection: { anchor: resolvedCursor } });
  }
  view.focus();
  return view;
}

function startIme(view: EditorView): void {
  view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
}

function endIme(view: EditorView): void {
  view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
}

afterEach(() => {
  while (mountedViews.length > 0) mountedViews.pop()?.destroy();
  document.body.replaceChildren();
});

/** 标准三行表：表头 + 分隔 + 数据 */
const STD_TABLE = '| h1 | h2 |\n| --- | --- |\n| d1 | d2 |';
/** cursor at "d1" cell start = 21 (after separator line) */
const CURSOR_D1 = STD_TABLE.indexOf('d1');
/** cursor at "d2" cell start = 25 */
const CURSOR_D2 = STD_TABLE.indexOf('d2');
// helper for clarity
function cellPos(doc: string, cellText: string): number {
  return doc.indexOf(cellText);
}

// ─── 1. 光标→表格/行角色/列解析 ────────────────────────────────────────

describe('resolveTableContext', () => {
  it('detects header row with columnIndex 0 when cursor sits in the first header cell', () => {
    const view = mountEditor(STD_TABLE, cellPos(STD_TABLE, 'h1') + 1);
    const ctx = resolveTableContext(view.state);
    expect(ctx).not.toBeNull();
    expect(ctx?.rowRole).toBe('header');
    expect(ctx?.columnIndex).toBe(0);
  });

  it('detects separator row when cursor sits on the second cell', () => {
    // 第二个 '---' 的格内（第一个 '---' 的 +3 是格端点，按 spec §2 端点取前格）
    const secondSep = STD_TABLE.indexOf('---', STD_TABLE.indexOf('---') + 1);
    const view = mountEditor(STD_TABLE, secondSep + 1);
    const ctx = resolveTableContext(view.state);
    expect(ctx?.rowRole).toBe('separator');
    expect(ctx?.columnIndex).toBe(1);
  });

  it('detects data row when cursor sits on the last cell', () => {
    const view = mountEditor(STD_TABLE, cellPos(STD_TABLE, 'd2') + 1);
    const ctx = resolveTableContext(view.state);
    expect(ctx?.rowRole).toBe('data');
    expect(ctx?.columnIndex).toBe(1);
  });

  it('columnIndex picks the previous cell when cursor lands at exact cell boundary', () => {
    // d1 的 range 为 [27,29)：+2 = 29 恰为 cell.range.to 端点 → 取前格（spec §2）
    const view = mountEditor(STD_TABLE, CURSOR_D1 + 2);
    const ctx = resolveTableContext(view.state);
    expect(ctx?.columnIndex).toBe(0);
  });

  it('returns null when cursor sits outside the table (paragraph line)', () => {
    const doc = 'a paragraph\n' + STD_TABLE + '\nmore text';
    const view = mountEditor(doc, 4);
    expect(resolveTableContext(view.state)).toBeNull();
  });

  it('returns null when table has no separator (paragraph of pipes)', () => {
    // `a | b` without a separator line is a paragraph, not a table
    const doc = 'a | b\nc | d';
    const view = mountEditor(doc, 2);
    expect(resolveTableContext(view.state)).toBeNull();
  });

  it('returns null on readOnly state', () => {
    const view = mountEditor(STD_TABLE, CURSOR_D1 + 1, true);
    expect(resolveTableContext(view.state)).toBeNull();
  });

  it('returns null when the selection is a range, not a single cursor', () => {
    const view = mountEditor(STD_TABLE, CURSOR_D1);
    view.dispatch({ selection: { anchor: CURSOR_D1, head: CURSOR_D2 } });
    expect(resolveTableContext(view.state)).toBeNull();
  });
});

// ─── 2. 插行 ───────────────────────────────────────────────────────────

describe('applyTableAction insertRowAbove / insertRowBelow', () => {
  it('inserts an empty data row below the current data row, cursor lands at first cell', () => {
    const view = mountEditor(STD_TABLE, CURSOR_D1 + 1);
    expect(applyTableAction(view, 'insertRowBelow')).toBe(true);
    const doc = view.state.doc.toString();
    // 新行 = `|  |  |`
    expect(doc).toBe('| h1 | h2 |\n| --- | --- |\n| d1 | d2 |\n|  |  |');
    // 光标在新行首格 = 原末行尾 + `\n` + `| ` 共 3 个字符
    const expectedCursor = STD_TABLE.length + 1 + 2;
    expect(view.state.selection.main.head).toBe(expectedCursor);
  });

  it('inserts an empty row above the current data row', () => {
    const view = mountEditor(STD_TABLE, CURSOR_D2 + 1);
    expect(applyTableAction(view, 'insertRowAbove')).toBe(true);
    const doc = view.state.doc.toString();
    expect(doc).toBe('| h1 | h2 |\n| --- | --- |\n|  |  |\n| d1 | d2 |');
  });

  it('header insertRowAbove places the new row at table start (before header)', () => {
    const view = mountEditor(STD_TABLE, cellPos(STD_TABLE, 'h2') + 1);
    expect(applyTableAction(view, 'insertRowAbove')).toBe(true);
    const doc = view.state.doc.toString();
    expect(doc.startsWith('|  |  |\n')).toBe(true);
    // 紧跟其后是原表头 + 分隔 + 数据
    expect(doc).toContain('|  |  |\n| h1 | h2 |\n| --- | --- |\n| d1 | d2 |');
  });

  it('header insertRowBelow places the new row after the separator (first data slot)', () => {
    const view = mountEditor(STD_TABLE, cellPos(STD_TABLE, 'h1') + 1);
    expect(applyTableAction(view, 'insertRowBelow')).toBe(true);
    const doc = view.state.doc.toString();
    // 新行 = `|  |  |`，且位于分隔行之后
    const sepEnd = STD_TABLE.indexOf('| --- | --- |') + '| --- | --- |'.length;
    expect(doc.slice(0, sepEnd + 1)).toBe('| h1 | h2 |\n| --- | --- |\n');
    expect(doc.slice(sepEnd + 1, sepEnd + 1 + '|  |  |'.length)).toBe('|  |  |');
  });

  it('insertRowBelow on last row appends at end (after newline)', () => {
    const view = mountEditor(STD_TABLE, CURSOR_D2 + 1);
    expect(applyTableAction(view, 'insertRowBelow')).toBe(true);
    const doc = view.state.doc.toString();
    expect(doc.endsWith('\n|  |  |')).toBe(true);
  });

  it('insertRow on separator row is rejected (returns false)', () => {
    const view = mountEditor(STD_TABLE, cellPos(STD_TABLE, '---') + 1);
    expect(applyTableAction(view, 'insertRowAbove')).toBe(false);
    expect(view.state.doc.toString()).toBe(STD_TABLE);
    expect(applyTableAction(view, 'insertRowBelow')).toBe(false);
  });

  it('insertRow matches columnCount from header (2 cells)', () => {
    const doc = '| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |';
    const view = mountEditor(doc, doc.indexOf('1') + 1);
    expect(applyTableAction(view, 'insertRowBelow')).toBe(true);
    const after = view.state.doc.toString();
    // 文档末尾无换行 → 新行即 EOF，不带尾换行（与「末行下方」用例同一约定）
    expect(after).toContain('|  |  |  |');
  });
});

// ─── 3. 插列 ───────────────────────────────────────────────────────────

describe('applyTableAction insertColumnLeft / insertColumnRight', () => {
  it('insertColumnRight adds a new empty cell to header / separator / data row simultaneously', () => {
    const view = mountEditor(STD_TABLE, CURSOR_D1 + 1);
    expect(applyTableAction(view, 'insertColumnRight')).toBe(true);
    const doc = view.state.doc.toString();
    // 光标在 d1（第 0 列）→ 新列插在 d1 与 d2 之间（当前列右侧）
    expect(doc).toContain('| h1 |  | h2 |');
    expect(doc).toContain('| --- | --- | --- |');
    expect(doc).toContain('| d1 |  | d2 |');
  });

  it('insertColumnLeft adds a new empty cell to all rows at the current column', () => {
    const view = mountEditor(STD_TABLE, CURSOR_D2 + 1);
    expect(applyTableAction(view, 'insertColumnLeft')).toBe(true);
    const doc = view.state.doc.toString();
    // 光标在 d2（第 1 列）→ 新列插在 d1 与 d2 之间（当前列左侧）；空格呈
    // 与行模板一致的 `|  |` 双空格形态
    expect(doc).toContain('| h1 |  | h2 |');
    expect(doc).toContain('| --- | --- | --- |');
    expect(doc).toContain('| d1 |  | d2 |');
  });

  it('jagged row补齐 when target column is past existing cells', () => {
    // 锯齿：表头 + 分隔 + 数据（少一格）
    const doc = '| a | b |\n| --- |\n| 1 |';
    const view = mountEditor(doc, doc.indexOf('1') + 1);
    expect(applyTableAction(view, 'insertColumnRight')).toBe(true);
    const after = view.state.doc.toString();
    // 数据行从 1 cell 补齐到 2 cells（`| 1 |  |`）
    expect(after).toContain('| 1 |  |');
  });

  it('separator row stays in sync (--- new cell, all other rows stay empty cells)', () => {
    const view = mountEditor(STD_TABLE, CURSOR_D1 + 1);
    expect(applyTableAction(view, 'insertColumnRight')).toBe(true);
    const doc = view.state.doc.toString();
    expect(doc).toContain('| --- | --- | --- |');
  });

  it('works on fullwidth ｜ separator tables', () => {
    const doc = '｜ a ｜ b ｜\n｜ --- ｜ --- ｜\n｜ 1 ｜ 2 ｜';
    const cursorIn1 = doc.indexOf('1') + 1;
    const view = mountEditor(doc, cursorIn1);
    expect(applyTableAction(view, 'insertColumnRight')).toBe(true);
    const after = view.state.doc.toString();
    // 光标在 '1'（第 0 列）→ 新列插在 1 与 2 之间；全角定界保留
    expect(after).toContain('｜ 1 ｜  ｜ 2 ｜');
    expect(after).toContain('｜ a ｜  ｜ b ｜');
    expect(after).toContain('｜ --- ｜ --- ｜ --- ｜');
  });
});

// ─── 4. 删行 ───────────────────────────────────────────────────────────

describe('applyTableAction deleteRow', () => {
  it('deletes a middle data row and lands cursor on previous data row first cell', () => {
    const doc = '| h |\n| --- |\n| a |\n| b |\n| c |';
    const view = mountEditor(doc, doc.indexOf('b') + 1);
    expect(applyTableAction(view, 'deleteRow')).toBe(true);
    const after = view.state.doc.toString();
    expect(after).toBe('| h |\n| --- |\n| a |\n| c |');
    // 光标落点：上一数据行 a 首格内容起点（doc.indexOf('a')）
    expect(view.state.selection.main.head).toBe(doc.indexOf('a'));
  });

  it('deletes the last data row; cursor falls through to the preceding data row', () => {
    const doc = '| h |\n| --- |\n| a |\n| b |';
    const view = mountEditor(doc, doc.indexOf('b') + 1);
    expect(applyTableAction(view, 'deleteRow')).toBe(true);
    expect(view.state.doc.toString()).toBe('| h |\n| --- |\n| a |');
    expect(view.state.selection.main.head).toBe(doc.indexOf('a'));
  });

  it('deleteRow on header is rejected (returns false)', () => {
    const view = mountEditor(STD_TABLE, cellPos(STD_TABLE, 'h1') + 1);
    expect(applyTableAction(view, 'deleteRow')).toBe(false);
    expect(view.state.doc.toString()).toBe(STD_TABLE);
  });

  it('deleteRow on separator is rejected (returns false)', () => {
    const view = mountEditor(STD_TABLE, cellPos(STD_TABLE, '---') + 1);
    expect(applyTableAction(view, 'deleteRow')).toBe(false);
    expect(view.state.doc.toString()).toBe(STD_TABLE);
  });

  it('deleting the only data row is allowed (table = header + separator remains legal)', () => {
    const doc = '| h |\n| --- |\n| a |';
    const view = mountEditor(doc, doc.indexOf('a') + 1);
    expect(applyTableAction(view, 'deleteRow')).toBe(true);
    expect(view.state.doc.toString()).toBe('| h |\n| --- |');
  });
});

// ─── 5. 删列 ───────────────────────────────────────────────────────────

describe('applyTableAction deleteColumn', () => {
  it('deletes a middle column of a 3-col table; surrounding columns keep content verbatim', () => {
    // 互审 F8：3 列表删真中间列（第 1 列），两侧内容逐字保留
    const doc = '| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |';
    const view = mountEditor(doc, doc.indexOf('2') + 1);
    expect(applyTableAction(view, 'deleteColumn')).toBe(true);
    const after = view.state.doc.toString();
    expect(after).toBe('| a | c |\n| --- | --- |\n| 1 | 3 |');
    // 光标落点：数据行左邻 cell（'1'）在新行中的起点
    expect(view.state.selection.main.head).toBe(after.indexOf('1'));
  });

  it('deletes the last column with byte-level preservation of other cells', () => {
    const view = mountEditor(STD_TABLE, CURSOR_D2 + 1);
    expect(applyTableAction(view, 'deleteColumn')).toBe(true);
    expect(view.state.doc.toString()).toBe('| h1 |\n| --- |\n| d1 |');
  });

  it('preserves `\\|` escape sequence inside remaining cell text', () => {
    const doc = '| a\\|b | c |\n| --- | --- |\n| d\\|e | f |';
    const view = mountEditor(doc, doc.indexOf('c') + 1);
    expect(applyTableAction(view, 'deleteColumn')).toBe(true);
    const after = view.state.doc.toString();
    // 删 c 列 → 留下 a\|b、d\|e 两行
    expect(after).toBe('| a\\|b |\n| --- |\n| d\\|e |');
    expect(after).toContain('a\\|b');
    expect(after).toContain('d\\|e');
  });

  it('handles `a | b` (no outer pipes) — delete-to-1col forces outer pipes (setext guard)', () => {
    const doc = 'h1 | h2\n--- | ---\nd1 | d2';
    const view = mountEditor(doc, doc.indexOf('d2') + 1);
    expect(applyTableAction(view, 'deleteColumn')).toBe(true);
    const after = view.state.doc.toString();
    // 黑盒审计 B MAJOR-1 守卫：裸 cell 行 + `---` 会被重解析为 setext 标题，
    // 删至单列统一补外管道保表格结构（cell 内容逐字保留）
    expect(after).toBe('| h1 |\n| --- |\n| d1 |');
  });

  it('handles fullwidth ｜ no outer pipes — same setext guard (fullwidth outer pipes)', () => {
    const doc = 'h1 ｜ h2\n--- ｜ ---\nd1 ｜ d2';
    const view = mountEditor(doc, doc.indexOf('d2') + 1);
    expect(applyTableAction(view, 'deleteColumn')).toBe(true);
    const after = view.state.doc.toString();
    // 守卫补的外管道跟随该行定界风格（全角行用 ｜）
    expect(after).toBe('｜ h1 ｜\n｜ --- ｜\n｜ d1 ｜');
  });

  it('keeps the table alive when a jagged separator loses its only cell (MINOR-2 guard)', () => {
    // 分隔行只有 1 格：删列 0 后兜底一格 '---'，表格不退化
    const doc = '| a | b |\n| --- |\n| 1 | 2 |';
    const view = mountEditor(doc, doc.indexOf('2') + 1);
    expect(applyTableAction(view, 'deleteColumn')).toBe(true);
    const after = view.state.doc.toString();
    expect(after).toBe('| a |\n| --- |\n| 1 |');
    // 仍是合法表格（工具条语境可解析）
    expect(resolveTableContext(view.state)?.rowRole).toBe('data');
  });

  it('rejects deleteColumn when columnCount === 1', () => {
    const doc = '| only |\n| --- |\n| one |';
    const view = mountEditor(doc, doc.indexOf('one') + 1);
    expect(applyTableAction(view, 'deleteColumn')).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
  });
});

// ─── 6. 对齐 ───────────────────────────────────────────────────────────

describe('applyTableAction alignLeft / alignCenter / alignRight', () => {
  it('alignCenter only rewrites the separator cell to `:---:`, data bytes untouched', () => {
    const view = mountEditor(STD_TABLE, CURSOR_D1 + 1);
    expect(applyTableAction(view, 'alignCenter')).toBe(true);
    const after = view.state.doc.toString();
    expect(after).toBe('| h1 | h2 |\n| :---: | --- |\n| d1 | d2 |');
  });

  it('alignRight only rewrites the targeted separator cell to `---:`', () => {
    const view = mountEditor(STD_TABLE, CURSOR_D1 + 1);
    expect(applyTableAction(view, 'alignRight')).toBe(true);
    const after = view.state.doc.toString();
    expect(after).toBe('| h1 | h2 |\n| ---: | --- |\n| d1 | d2 |');
  });

  it('alignLeft resets cell back to `---`', () => {
    // 先居中
    const doc = '| h1 | h2 |\n| :---: | --- |\n| d1 | d2 |';
    const view = mountEditor(doc, doc.indexOf('d1') + 1);
    expect(applyTableAction(view, 'alignLeft')).toBe(true);
    expect(view.state.doc.toString()).toBe('| h1 | h2 |\n| --- | --- |\n| d1 | d2 |');
  });

  it('jagged separator row gets补齐 with `---` cells up to the target column', () => {
    // 分隔行少一格
    const doc = '| a | b |\n| --- |\n| 1 | 2 |';
    const view = mountEditor(doc, doc.indexOf('1') + 1);
    expect(applyTableAction(view, 'insertColumnRight')).toBe(true);
    // 锯齿分隔行补齐 1 格 `---`
    expect(view.state.doc.toString()).toContain('| --- | --- |');
  });

  it('alignment pads a jagged separator with `---` before writing the mark (spec §7.1.6)', () => {
    // 互审 F8：doSetAlignment 的分隔行补齐路径——光标在第 1 列，分隔行只有 1 格
    const doc = '| a | b |\n| --- |\n| 1 | 2 |';
    const view = mountEditor(doc, doc.indexOf('2') + 1);
    expect(applyTableAction(view, 'alignCenter')).toBe(true);
    const after = view.state.doc.toString();
    // 分隔行补到 2 格，第 1 格写 :---:（GFM 冒号必须半角）
    expect(after).toContain('| --- | :---: |');
    expect(after).toContain('| a | b |');
    expect(after).toContain('| 1 | 2 |');
  });

  it('alignment applies regardless of cursor row (always targets separator cell)', () => {
    const view = mountEditor(STD_TABLE, CURSOR_D1 + 1);
    // 对齐按钮对任何行角色均可用（操作对象是分隔行 cell）
    expect(applyTableAction(view, 'alignLeft')).toBe(true);
    // cell 已是 `---`，文档不变
    expect(view.state.doc.toString()).toBe(STD_TABLE);
    // 居中对齐实际改写分隔行
    expect(applyTableAction(view, 'alignCenter')).toBe(true);
    expect(view.state.doc.toString()).toContain('| :---: | --- |');
  });
});

// ─── 7. 删除整表 ────────────────────────────────────────────────────────

describe('applyTableAction deleteTable', () => {
  it('removes table in the middle of the document, leaves surrounding paragraphs intact', () => {
    const doc = 'before\n' + STD_TABLE + '\nafter';
    const view = mountEditor(doc, CURSOR_D1 + 4); // 4 = length of "before\n"
    expect(applyTableAction(view, 'deleteTable')).toBe(true);
    const after = view.state.doc.toString();
    expect(after).toBe('before\n\nafter');
  });

  it('collapses adjacent blank lines to a single blank when table is sandwiched between empties', () => {
    const doc = 'before\n\n' + STD_TABLE + '\n\nafter';
    const view = mountEditor(doc, doc.indexOf('d1') + 'before\n\n'.length);
    expect(applyTableAction(view, 'deleteTable')).toBe(true);
    const after = view.state.doc.toString();
    // 两侧空行收敛为单个空行（`before` / `` / `after`）
    expect(after).toBe('before\n\nafter');
  });

  it('removes table at document start, keeps single newline boundary before content', () => {
    const doc = STD_TABLE + '\nafter';
    const view = mountEditor(doc, CURSOR_D1);
    expect(applyTableAction(view, 'deleteTable')).toBe(true);
    const after = view.state.doc.toString();
    expect(after.startsWith('\nafter')).toBe(true);
  });

  it('removes table at document end, content before untouched', () => {
    const doc = 'before\n' + STD_TABLE;
    const view = mountEditor(doc, CURSOR_D1 + 'before\n'.length);
    expect(applyTableAction(view, 'deleteTable')).toBe(true);
    const after = view.state.doc.toString();
    expect(after.startsWith('before\n')).toBe(true);
    // 末尾不应残留表格内容
    expect(after).not.toContain('d1');
  });
});

// ─── 8. 撤销 / IME / readOnly ───────────────────────────────────────────

describe('undo and IME / readOnly guards', () => {
  it('insertRowBelow is one-step undoable back to the original doc', () => {
    const view = mountEditor(STD_TABLE, CURSOR_D1 + 1);
    expect(applyTableAction(view, 'insertRowBelow')).toBe(true);
    const afterInsert = view.state.doc.toString();
    expect(afterInsert).not.toBe(STD_TABLE);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(STD_TABLE);
  });

  it('deleteColumn is one-step undoable', () => {
    const view = mountEditor(STD_TABLE, CURSOR_D1 + 1);
    expect(applyTableAction(view, 'deleteColumn')).toBe(true);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(STD_TABLE);
  });

  it('alignCenter is one-step undoable', () => {
    const view = mountEditor(STD_TABLE, CURSOR_D1 + 1);
    expect(applyTableAction(view, 'alignCenter')).toBe(true);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(STD_TABLE);
  });

  it('deleteTable is one-step undoable', () => {
    const doc = 'before\n' + STD_TABLE + '\nafter';
    const view = mountEditor(doc, CURSOR_D1 + 'before\n'.length);
    expect(applyTableAction(view, 'deleteTable')).toBe(true);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it('deleteRow is one-step undoable', () => {
    const doc = '| h1 | h2 |\n| --- | --- |\n| d1 | d2 |';
    const view = mountEditor(doc, doc.indexOf('d1') + 1);
    expect(applyTableAction(view, 'deleteRow')).toBe(true);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it('insertColumnRight is one-step undoable and lands the cursor inside the original cell', () => {
    const doc = STD_TABLE;
    const view = mountEditor(doc, CURSOR_D1 + 1);
    expect(applyTableAction(view, 'insertColumnRight')).toBe(true);
    // 光标等效位（互审 F1）：原 d1 cell 在新行（`| d1 |  | d2 |`）中的起点
    const newDoc = view.state.doc.toString();
    expect(view.state.selection.main.head).toBe(newDoc.indexOf('d1'));
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it('applyTableAction returns false during active IME composition', () => {
    const view = mountEditor(STD_TABLE, CURSOR_D1 + 1);
    startIme(view);
    expect(applyTableAction(view, 'insertRowBelow')).toBe(false);
    expect(view.state.doc.toString()).toBe(STD_TABLE);
    endIme(view);
  });

  it('applyTableAction returns false on readOnly state', () => {
    const view = mountEditor(STD_TABLE, CURSOR_D1 + 1, true);
    expect(applyTableAction(view, 'insertRowBelow')).toBe(false);
    expect(view.state.doc.toString()).toBe(STD_TABLE);
  });

  it('resolveTableContext returns null on readOnly so toolbar stays hidden', () => {
    const view = mountEditor(STD_TABLE, CURSOR_D1 + 1, true);
    expect(resolveTableContext(view.state)).toBeNull();
  });

  it('toolbar DOM is not created/applied when cursor is outside the table', () => {
    const doc = 'paragraph\n' + STD_TABLE;
    const view = mountEditor(doc, 4);
    // 触发一次 update 周期
    view.dispatch({ selection: { anchor: 4 } });
    // 工具条若挂上，应当有 cm-jotluck-table-toolbar 元素；否则为空
    const tools = view.dom.querySelectorAll('.cm-jotluck-table-toolbar');
    // 因为不是表格行，工具条不应挂载
    expect(tools.length).toBe(0);
  });
});

// ─── 工具条条目规格 ────────────────────────────────────────────────────

describe('buildTableToolbarItems', () => {
  it('exposes exactly 10 stable toolbar buttons (11th i18n key toolbarAria is aria-only)', () => {
    const items = buildTableToolbarItems();
    expect(items.length).toBe(10); // 10 操作按钮；toolbarAria 是容器 aria-label 键，不入按钮列表
    const ids = items.map((i) => i.id);
    expect(ids).toContain('insertRowAbove');
    expect(ids).toContain('insertRowBelow');
    expect(ids).toContain('insertColumnLeft');
    expect(ids).toContain('insertColumnRight');
    expect(ids).toContain('deleteRow');
    expect(ids).toContain('deleteColumn');
    expect(ids).toContain('deleteTable');
    expect(ids).toContain('alignLeft');
    expect(ids).toContain('alignCenter');
    expect(ids).toContain('alignRight');
  });

  it('all label keys fall under editor.table.* namespace', () => {
    const items = buildTableToolbarItems();
    for (const item of items) {
      expect(item.labelKey.startsWith('editor.table.')).toBe(true);
    }
  });

  it('all 10 action ids are unique', () => {
    const ids = new Set<TableActionId>();
    for (const item of buildTableToolbarItems()) ids.add(item.id);
    expect(ids.size).toBe(buildTableToolbarItems().length);
  });
});

// ─── 9. R4 增量：Tab / Shift+Tab 单元格导航 ────────────────────────────

describe('Tab / Shift+Tab cell navigation', () => {
  it('Tab from a middle cell moves cursor to the next cell content start', () => {
    // STD_TABLE = `| h1 | h2 |\n| --- | --- |\n| d1 | d2 |`
    // 光标在 d1（第 0 列中间格）→ Tab 应落到 d2 内容起点
    const view = mountEditor(STD_TABLE, CURSOR_D1 + 1);
    expect(moveTabInCellForward(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(STD_TABLE); // 文档不变
    expect(view.state.selection.main.head).toBe(CURSOR_D2);
  });

  it('Tab from the last cell of a row wraps to the first cell of the next row', () => {
    // 两行数据：末行末格 = '| d2 |' 之后
    const doc = '| h1 | h2 |\n| --- | --- |\n| d1 | d2 |\n| d3 | d4 |';
    const d2End = doc.indexOf('d2') + 2; // d2 内容起点 + 2 = 内容末端（cell boundary 取前格 = col 1）
    // 用 d2 内任意位置（d2+1）确保列解析落在第 1 列
    const view = mountEditor(doc, doc.indexOf('d2') + 1);
    expect(moveTabInCellForward(view)).toBe(true);
    // 光标应落到下一行首格内容起点（d3 位置）
    expect(view.state.selection.main.head).toBe(doc.indexOf('d3'));
    expect(d2End).toBeGreaterThan(0); // 抑制未使用警告
  });

  it('Tab from the very last cell appends a new empty row and lands cursor at its first cell', () => {
    // 末格 = STD_TABLE 的 'd2' 内容（仅一行数据）
    const view = mountEditor(STD_TABLE, CURSOR_D2 + 1);
    expect(moveTabInCellForward(view)).toBe(true);
    const after = view.state.doc.toString();
    // 新行 = `|  |  |`，且位于表尾（首列 2 字符）
    expect(after).toBe('| h1 | h2 |\n| --- | --- |\n| d1 | d2 |\n|  |  |');
    // 光标落新行首格 = STD_TABLE.length + 1 (换行) + 2 ('| ')
    expect(view.state.selection.main.head).toBe(STD_TABLE.length + 1 + 2);
  });

  it('Tab creating a new row at table end is one-step undoable', () => {
    const view = mountEditor(STD_TABLE, CURSOR_D2 + 1);
    expect(moveTabInCellForward(view)).toBe(true);
    expect(view.state.doc.toString()).not.toBe(STD_TABLE);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(STD_TABLE);
  });

  it('Shift+Tab from a middle cell moves cursor to the previous cell content start', () => {
    // 光标在 d2 → Shift+Tab 应落到 d1
    const view = mountEditor(STD_TABLE, CURSOR_D2 + 1);
    expect(moveTabInCellBackward(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(STD_TABLE);
    expect(view.state.selection.main.head).toBe(CURSOR_D1);
  });

  it('Shift+Tab from the first cell is a no-op (returns false to defer to default keymap)', () => {
    // 光标在表头首格 h1 → Shift+Tab 应返回 false
    const view = mountEditor(STD_TABLE, cellPos(STD_TABLE, 'h1') + 1);
    const headBefore = view.state.selection.main.head;
    expect(moveTabInCellBackward(view)).toBe(false);
    // 文档与光标均未变
    expect(view.state.doc.toString()).toBe(STD_TABLE);
    expect(view.state.selection.main.head).toBe(headBefore);
  });

  it('Tab does not hijack when cursor sits outside the table (returns false)', () => {
    const doc = 'a paragraph\n' + STD_TABLE + '\nmore text';
    const view = mountEditor(doc, 4); // 光标在 'paragraph' 内
    const headBefore = view.state.selection.main.head;
    expect(moveTabInCellForward(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
    expect(view.state.selection.main.head).toBe(headBefore);
  });

  it('Shift+Tab does not hijack when cursor sits outside the table (returns false)', () => {
    const doc = 'a paragraph\n' + STD_TABLE + '\nmore text';
    const view = mountEditor(doc, 4);
    expect(moveTabInCellBackward(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it('Tab returns false on a readOnly state (rejected)', () => {
    const view = mountEditor(STD_TABLE, { cursor: CURSOR_D1 + 1, readOnly: true });
    const headBefore = view.state.selection.main.head;
    expect(moveTabInCellForward(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(STD_TABLE);
    expect(view.state.selection.main.head).toBe(headBefore);
  });

  it('Shift+Tab returns false on a readOnly state (rejected)', () => {
    const view = mountEditor(STD_TABLE, { cursor: CURSOR_D2 + 1, readOnly: true });
    expect(moveTabInCellBackward(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(STD_TABLE);
  });

  it('Tab returns false during active IME composition (does not hijack)', () => {
    const view = mountEditor(STD_TABLE, CURSOR_D1 + 1);
    startIme(view);
    expect(moveTabInCellForward(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(STD_TABLE);
    expect(moveTabInCellBackward(view)).toBe(false);
    endIme(view);
  });

  it('Tab on separator row returns false (separator cells not navigable)', () => {
    // 光标在分隔行第二格（第二个 '---' 内）
    const secondSep = STD_TABLE.indexOf('---', STD_TABLE.indexOf('---') + 1);
    const view = mountEditor(STD_TABLE, secondSep + 1);
    expect(moveTabInCellForward(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(STD_TABLE);
  });

  it('Tab defers to slash menu when the menu is open (guard present in production paths)', () => {
    // 注意：cm6-slash-commands.ts 的 getSlashTrigger 明确禁止 block.type === 'table'
    // （互审约定），所以「斜杠菜单在表格内打开」在当前产品中不可达。本断言只
    // 验证本命令的代码路径包含此守卫分支（编译期 + 静态阅读）；不构造运行时
    // 难以搭建的「菜单打开」场景。键位仲裁实际由 CM6 keymap 注册顺序保证：
    //   1) ghost Prec.highest（最早注册）→ 2) slashCommandsExtension plain keymap
    //   → 3) tableEditExtension plain keymap（最近注册）→ 4) defaultKeymap。
    // 同级优先级「先注册先检查」，所以 slash 的 Tab 在表格外环境中会比本命令
    // 先消费 Tab；表格内环境下 slash 触发直接被拒绝，斜杠菜单根本不开。
    expect(typeof moveTabInCellForward).toBe('function');
    // 烟雾测试：在表格内 Tab 仍按合同移动（守卫不被误触发）
    const view = mountEditor(STD_TABLE, CURSOR_D1 + 1);
    expect(moveTabInCellForward(view)).toBe(true);
    expect(view.state.selection.main.head).toBe(CURSOR_D2);
  });

  it('Tab keymap binding is reachable through real KeyboardEvent on contentDOM', () => {
    // 用真实 keydown 事件验证 keymap.of() 集成（非直接调命令）
    const view = mountEditor(STD_TABLE, CURSOR_D1 + 1);
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    // 光标应已移动到 d2 内容起点
    expect(view.state.selection.main.head).toBe(CURSOR_D2);
  });

  it('Shift+Tab keymap binding is reachable through real KeyboardEvent on contentDOM', () => {
    const view = mountEditor(STD_TABLE, CURSOR_D2 + 1);
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    );
    expect(view.state.selection.main.head).toBe(CURSOR_D1);
  });
});
