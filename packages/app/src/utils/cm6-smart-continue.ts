import { getDocumentAst } from './cm6-document-analysis';
/**
 * cm6-smart-continue — CodeMirror 6 智能续格式
 *
 * 结构块（列表 / 任务 / 有序 / 引用 / 表格）Enter 自动延续；Backspace / Escape
 * 取消空格式块。每次操作 = 单 transaction + isolateHistory.of('full')，
 * Ctrl+Z 一步整体回退。IME 组合期间一律不拦截。
 *
 * 检测路径统一走 @jotluck/renderer 块级 AST（parseDocument + blockAtLine），
 * 标记区间全部来自源码 UTF-16 偏移，全角写法（＞foo、－　foo 等）天然精确。
 *
 * @see PRD-v0.2 §4 R1 + §6 键位仲裁
 */

import type { EditorState } from '@codemirror/state';
import type { Command, KeyBinding } from '@codemirror/view';
import { EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { blockAtLine } from '@jotluck/renderer';

export type ContinuationKind =
  | 'unorderedListItem'
  | 'orderedListItem'
  | 'taskListItem'
  | 'textListItem'
  | 'blockquoteLine'
  | 'tableRow';

export interface ContinuationContext {
  kind: ContinuationKind;
  lineFrom: number;
  lineTo: number;
  isEmptyBlock: boolean;
  atLineEnd: boolean;
  nextMarker: string;
  linePrefix?: string;
  canContinue?: boolean;
  markerFrom: number;
  markerTo: number;
  tableColumnCount: number;
  isTableSeparator: boolean;
  isTableHeader: boolean;
}

// ─── 公共 API：detectContinuationContext（只读） ──────────────────────

export function detectContinuationContext(state: EditorState): ContinuationContext | null {
  const sel = state.selection.main;
  if (state.readOnly || state.selection.ranges.length !== 1 || !sel.empty) return null;
  const cursor = sel.head;
  const line = state.doc.lineAt(cursor);
  const lineFrom = line.from;
  const lineTo = line.to;
  const lineNumber = line.number - 1;

  const docText = state.doc.toString();
  const ast = getDocumentAst(state);
  const block = blockAtLine(ast, lineNumber);
  if (!block) return null;

  const rawLine = docText.slice(lineFrom, lineTo);
  const cursorInLine = cursor - lineFrom;
  const rest = rawLine.slice(cursorInLine);
  const atLineEnd = rest.trim() === '';

  const hint = ast.lineMap[lineNumber]?.continuation;
  if (hint)
    return {
      kind: hint.kind,
      lineFrom,
      lineTo,
      isEmptyBlock: hint.isEmpty,
      atLineEnd,
      nextMarker: hint.nextMarker ?? '',
      canContinue: hint.nextMarker !== null,
      linePrefix: hint.prefix,
      markerFrom: hint.markerRange.from,
      markerTo: hint.markerRange.to,
      tableColumnCount: 0,
      isTableSeparator: false,
      isTableHeader: false,
    };

  switch (block.type) {
    case 'table': {
      const node = block;
      // 表格成立前提：组内存在分隔行（GFM 语义——无分隔行的孤管道行只是
      // 普通段落），承接旧 tableGroupHasSeparator 语义
      if (!node.hasSeparator) return null;
      const rowIndex = ast.lineMap[lineNumber]?.rowIndex;
      if (rowIndex === undefined) return null;
      const row = node.rows[rowIndex];
      if (!row || row.isSeparator) return null;
      const indentMatch = /^(\s*)/.exec(rawLine);
      return {
        kind: 'tableRow',
        lineFrom,
        lineTo,
        isEmptyBlock: row.cells.length === 0 || row.cells.every((cell) => cell.text.trim() === ''),
        atLineEnd,
        nextMarker: '',
        markerFrom: lineFrom + (indentMatch?.[1] ?? '').length,
        markerTo: lineTo,
        tableColumnCount: node.columnCount,
        isTableSeparator: false,
        isTableHeader: row.isHeader,
      };
    }

    // frontmatter / codeFence / jsonBlock / blank / heading / horizontalRule /
    // refDefinition / paragraph：一律不拦截
    default:
      return null;
  }
}

// ─── 内部：表格退出 ─────────────────────────────────────────────────

function buildEmptyTableRow(columnCount: number): string {
  if (columnCount <= 0) return '|';
  return `|${'  |'.repeat(columnCount)}`;
}

/**
 * 空表格行 → 删除整行（含其换行）。Enter (E2 on table) 与 Backspace / Escape
 * (B2) 共用此路径。
 *
 * R4-9③ 钉死语义：若被删空行后仍有同表数据行（表格中部删空行）→ 仅删除
 * 该行、不插入任何空行，光标落到下一行首个单元格，表格不断裂；若是表的
 * 最后一行 → 保持原行为（删行，表后已有空行则光标移过去，否则补一空段）。
 */
function exitEmptyTableRow(view: EditorView, context: ContinuationContext): boolean {
  const state = view.state;
  const docText = state.doc.toString();
  const lineFrom = context.lineFrom;
  const lineTo = context.lineTo;
  const hasNewline = lineTo < docText.length && docText[lineTo] === '\n';
  const deleteTo = hasNewline ? lineTo + 1 : lineTo;

  // R4-9③：查被删行之后是否仍有同表数据行
  const lineNumber = state.doc.lineAt(lineFrom).number - 1;
  const ast = getDocumentAst(state);
  const block = blockAtLine(ast, lineNumber);
  let hasFollowingDataRow = false;
  let nextRowFirstCellOffset: number | null = null;
  if (block?.type === 'table') {
    const rowIndex = ast.lineMap[lineNumber]?.rowIndex;
    if (rowIndex !== undefined) {
      const followingRows = block.rows.slice(rowIndex + 1);
      hasFollowingDataRow = followingRows.some((row) => !row.isSeparator);
      const nextRow = block.rows[rowIndex + 1];
      const firstCell = nextRow?.cells[0];
      if (nextRow && firstCell) {
        // 删除范围为「整行 + 换行符」，下一行上移后首格新偏移 =
        // lineFrom + 首格相对其行首的偏移
        nextRowFirstCellOffset = lineFrom + (firstCell.range.from - nextRow.range.from);
      }
    }
  }

  if (hasFollowingDataRow) {
    // 表格中部：仅删行，光标落到下一行首个单元格
    view.dispatch({
      changes: { from: lineFrom, to: deleteTo, insert: '' },
      selection: { anchor: nextRowFirstCellOffset ?? lineFrom },
      annotations: isolateHistory.of('full'),
    });
    return true;
  }

  const afterText = docText.slice(deleteTo);
  const nextLineMatch = /^([^\n]*)/.exec(afterText);
  const nextLine = nextLineMatch?.[1] ?? '';
  // 下一行已空 → 不补；否则补一个 \n 形成表后空段。
  const insert = nextLine.trim() === '' ? '' : '\n';
  view.dispatch({
    changes: { from: lineFrom, to: deleteTo, insert },
    selection: { anchor: lineFrom },
    annotations: isolateHistory.of('full'),
  });
  return true;
}

// ─── 公共 API：smartContinueOnEnter ─────────────────────────────────

export const smartContinueOnEnter: Command = (view) => {
  if (view.composing || view.compositionStarted) return false;
  const context = detectContinuationContext(view.state);
  if (!context) return false;
  if (context.kind !== 'tableRow' && view.state.selection.main.head < context.markerTo)
    return false;

  // E2: 空格式块 → 退出结构；内容恒为空白，随标记一并删除至行尾
  if (context.isEmptyBlock) {
    if (context.kind === 'tableRow') return exitEmptyTableRow(view, context);
    view.dispatch({
      changes: { from: context.markerFrom, to: context.lineTo, insert: '' },
      selection: { anchor: context.markerFrom },
      annotations: isolateHistory.of('full'),
    });
    return true;
  }

  if (context.canContinue === false) return false;

  // E6: 表格行 → 下方插入同列数空行
  if (context.kind === 'tableRow') {
    const state = view.state;
    const docText = state.doc.toString();
    const newRow = buildEmptyTableRow(context.tableColumnCount);
    const lineRaw = docText.slice(context.lineFrom, context.lineTo);
    const indentMatch = /^(\s*)/.exec(lineRaw);
    const indent = indentMatch?.[1] ?? '';
    const newRowWithIndent = indent + newRow;

    let insertPos: number;
    if (context.isTableHeader) {
      // 表头 Enter：插在分隔行之后（插在其行尾换行符处，与下方已有内容隔行）
      const afterRow = docText.slice(context.lineTo + 1);
      const nextLineEnd = afterRow.indexOf('\n');
      insertPos = context.lineTo + 1 + (nextLineEnd === -1 ? afterRow.length : nextLineEnd);
    } else {
      insertPos = context.lineTo;
    }

    view.dispatch({
      changes: { from: insertPos, to: insertPos, insert: '\n' + newRowWithIndent },
      // 光标落新行首单元格内容位："\n" + indent + "| " 之后
      selection: { anchor: insertPos + 1 + indent.length + 2 },
      annotations: isolateHistory.of('full'),
    });
    return true;
  }

  // E1/E3/E4/E5: 非表格结构块行尾或行中拆分
  const cursor = view.state.selection.main.head;
  // 光标落在标记内/标记前（如行首）：不拆分，走默认换行
  if (cursor < context.markerTo) return false;
  const rawLine = view.state.doc.sliceString(context.lineFrom, context.lineTo);
  const indentMatch = /^(\s*)/.exec(rawLine);
  const indent = context.linePrefix ?? indentMatch?.[1] ?? '';

  if (context.atLineEnd) {
    const insertText = `\n${indent}${context.nextMarker}`;
    const insertPos = context.lineTo;
    view.dispatch({
      changes: { from: insertPos, to: insertPos, insert: insertText },
      selection: { anchor: insertPos + insertText.length },
      annotations: isolateHistory.of('full'),
    });
    return true;
  }

  const restText = view.state.doc.sliceString(cursor, context.lineTo);
  const trimmedRest = restText.replace(/^\s+/, '');
  const insertText = `\n${indent}${context.nextMarker}${trimmedRest}`;
  view.dispatch({
    changes: { from: cursor, to: context.lineTo, insert: insertText },
    selection: { anchor: cursor + 1 + indent.length + context.nextMarker.length },
    annotations: isolateHistory.of('full'),
  });
  return true;
};

// ─── 公共 API：smartCancelOnBackspace ────────────────────────────────

export const smartCancelOnBackspace: Command = (view) => {
  if (view.composing || view.compositionStarted) return false;
  const context = detectContinuationContext(view.state);
  if (!context) return false;

  if (context.kind === 'tableRow') {
    if (context.isEmptyBlock) return exitEmptyTableRow(view, context);
    return false;
  }

  if (context.isEmptyBlock) {
    // B1: 空格式块 → 删标记转普通段（空白内容随标记一并删除）
    view.dispatch({
      changes: { from: context.markerFrom, to: context.lineTo, insert: '' },
      selection: { anchor: context.markerFrom },
      annotations: isolateHistory.of('full'),
    });
    return true;
  }

  // B3: 非空，光标恰在 markerTo（标记 / 内容边界）→ 删标记，保留内容
  const sel = view.state.selection.main;
  if (sel.head === context.markerTo && sel.anchor === context.markerTo) {
    view.dispatch({
      changes: { from: context.markerFrom, to: context.markerTo, insert: '' },
      selection: { anchor: context.markerFrom },
      annotations: isolateHistory.of('full'),
    });
    return true;
  }

  return false;
};

// ─── 公共 API：smartCancelOnEscape ──────────────────────────────────

export const smartCancelOnEscape: Command = (view) => {
  if (view.composing || view.compositionStarted) return false;
  const context = detectContinuationContext(view.state);
  if (!context) return false;

  if (context.kind === 'tableRow') {
    if (context.isEmptyBlock) return exitEmptyTableRow(view, context);
    return false;
  }

  if (context.isEmptyBlock) {
    view.dispatch({
      changes: { from: context.markerFrom, to: context.lineTo, insert: '' },
      selection: { anchor: context.markerFrom },
      annotations: isolateHistory.of('full'),
    });
    return true;
  }

  return false;
};

// ─── 公共 API：smartContinueKeymap ──────────────────────────────────

export const smartContinueKeymap: readonly KeyBinding[] = [
  { key: 'Enter', run: smartContinueOnEnter },
  { key: 'Backspace', run: smartCancelOnBackspace },
  { key: 'Escape', run: smartCancelOnEscape },
];
