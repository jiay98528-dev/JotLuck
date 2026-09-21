/**
 * cm6-table-edit — CodeMirror 6 表格编辑 UI（V0.2 切片 E3）
 *
 * 行为合同：`docs/wip/specs/v0.2-E3-table-edit-ui.md` v1.0（冻结）。
 *
 * 架构要点：
 *   - 复用 @jotluck/renderer 的 AST（parseDocument + blockAtLine）做表格与行角色
 *     解析；行列区间全部来自源码 UTF-16 偏移，全角 `｜` / `\|` 转义天然保真。
 *   - 每个操作 = 单次 view.dispatch + isolateHistory.of('full')（E2 实测教训，
 *     500ms 邻组合并需用 history 隔离把表格操作与快速键入拆开）。
 *   - 不注册任何 keymap —— 纯状态驱动 UI + 按钮操作（与 E2 本质区别）。
 *   - 工具条 = CM6 内部浮层（挂 view.dom）；位置 = coordsAtPos 转换为
 *     view.dom 相对坐标，上方空间不足翻转到表尾下沿，横向夹紧编辑器视口。
 *   - IME 守卫：组合期间按钮 mousedown.prevent 返回 + 工具条隐藏。
 *   - i18n 每次工具条打开时经 translate() 解析（规避 E1 静态快照限制）。
 */
import type { EditorState, Extension } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { EditorView, ViewPlugin } from '@codemirror/view';
import type { PluginValue, ViewUpdate } from '@codemirror/view';
import { blockAtLine, parseDocument, type TableNode, type TableRowNode } from '@jotluck/renderer';
import { translate } from '@/i18n';

// ─── 公开类型 ──────────────────────────────────────────────────────────

/** 行角色（spec §2） */
export type TableRowRole = 'header' | 'separator' | 'data';

/** 光标所在表格的上下文（单测 / 工具条 DOM 渲染共用） */
export interface TableContext {
  block: TableNode;
  row: TableRowNode;
  rowIndex: number;
  rowRole: TableRowRole;
  /** 光标落入的 cell 下标（含端点相邻取前 cell 的口径） */
  columnIndex: number;
}

/** 工具条按钮标识（spec §3 共 11 项：10 操作 + 1 toolbarAria） */
export type TableActionId =
  | 'insertRowAbove'
  | 'insertRowBelow'
  | 'insertColumnLeft'
  | 'insertColumnRight'
  | 'deleteRow'
  | 'deleteColumn'
  | 'deleteTable'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight';

/** 工具条按钮静态描述 */
export interface TableToolbarItem {
  id: TableActionId;
  /** i18n key；translate() 在按钮渲染时解析 */
  labelKey: string;
  /** 行角色禁用基线（运行时还会与 columnCount=1 等特判叠加） */
  disabledForRowRole: ReadonlySet<TableRowRole>;
  /** 图标 SVG markup；14×14 currentColor 线条 */
  svg: string;
  /** 分组标签：用于 DOM 渲染分组 */
  group: 'row' | 'column' | 'table' | 'align';
}

// ─── 公共 API：resolveTableContext ──────────────────────────────────────

/**
 * 在给定光标位置求取 TableContext：
 *   - 光标必须在属于某 TableNode 的行内
 *   - hasSeparator === true（孤管道行组视为段落，不出工具条，spec §2）
 *   - rowRole 由 separatorIndex / 行号综合判定
 *   - columnIndex = cells 中第一个 to > cursor；否则取最后一格
 */
export function resolveTableContext(state: EditorState): TableContext | null {
  if (state.readOnly) return null;
  const sel = state.selection.main;
  if (!sel.empty) return null;
  const cursor = sel.head;
  const line = state.doc.lineAt(cursor);
  const lineNumber = line.number - 1;
  const ast = parseDocument(state.doc.toString());
  const block = blockAtLine(ast, lineNumber);
  if (!block || block.type !== 'table') return null;
  if (!block.hasSeparator) return null;
  const info = ast.lineMap[lineNumber];
  const rowIndex = info?.rowIndex;
  if (rowIndex === undefined) return null;
  const row = block.rows[rowIndex];
  if (!row) return null;
  const rowRole: TableRowRole = row.isHeader ? 'header' : row.isSeparator ? 'separator' : 'data';
  const columnIndex = resolveColumnIndex(row, cursor);
  return { block, row, rowIndex, rowRole, columnIndex };
}

function resolveColumnIndex(row: TableRowNode, cursor: number): number {
  if (row.cells.length === 0) return 0;
  for (let i = 0; i < row.cells.length; i++) {
    const cell = row.cells[i]!;
    // TableCell 偏移在 cell.range 下（renderer ast.ts:140-143）；
    // `cursor <= to` 使端点（cell 边界）取前格（spec §2「含端点相邻取前 cell」）
    if (cursor <= cell.range.to) return i;
  }
  return row.cells.length - 1;
}

// ─── 工具条按钮描述（spec §3） ─────────────────────────────────────────

const SVG_ROW_UP =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 3v8M5 7l3-3 3 3M3 13h10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_ROW_DOWN =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 13V5M5 9l3 3 3-3M3 13h10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_COL_LEFT =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8h8M7 5 4 8l3 3M3 3v10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_COL_RIGHT =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M13 8H5M9 5l3 3-3 3M3 3v10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_DEL_ROW =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 4h10M6 4V2h4v2M5 4l1 9h4l1-9M7 7v4M9 7v4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_DEL_COL =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 3v10M7 5l3 3-3 3M7 11l3-3 3 3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_DEL_TABLE =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 5h10v8H3zM3 8h10M6 5v8M10 5v8M2 3l12 10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_ALIGN_L =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 4h12M2 8h8M2 12h10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
const SVG_ALIGN_C =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 4h12M4 8h8M3 12h10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
const SVG_ALIGN_R =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 4h12M6 8h8M4 12h10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

const ROW_OPERATIONS = new Set<TableRowRole>(['separator']);
const ROW_DELETE_FORBIDDEN = new Set<TableRowRole>(['header', 'separator']);
const NO_ROW_RESTRICTION = new Set<TableRowRole>();

const TOOLBAR_ITEMS: readonly TableToolbarItem[] = [
  {
    id: 'insertRowAbove',
    labelKey: 'editor.table.insertRowAbove',
    disabledForRowRole: ROW_OPERATIONS,
    svg: SVG_ROW_UP,
    group: 'row',
  },
  {
    id: 'insertRowBelow',
    labelKey: 'editor.table.insertRowBelow',
    disabledForRowRole: ROW_OPERATIONS,
    svg: SVG_ROW_DOWN,
    group: 'row',
  },
  {
    id: 'insertColumnLeft',
    labelKey: 'editor.table.insertColumnLeft',
    disabledForRowRole: new Set(),
    svg: SVG_COL_LEFT,
    group: 'column',
  },
  {
    id: 'insertColumnRight',
    labelKey: 'editor.table.insertColumnRight',
    disabledForRowRole: new Set(),
    svg: SVG_COL_RIGHT,
    group: 'column',
  },
  {
    id: 'deleteRow',
    labelKey: 'editor.table.deleteRow',
    disabledForRowRole: ROW_DELETE_FORBIDDEN,
    svg: SVG_DEL_ROW,
    group: 'row',
  },
  {
    id: 'deleteColumn',
    labelKey: 'editor.table.deleteColumn',
    disabledForRowRole: new Set(),
    svg: SVG_DEL_COL,
    group: 'column',
  },
  {
    id: 'deleteTable',
    labelKey: 'editor.table.deleteTable',
    disabledForRowRole: new Set(),
    svg: SVG_DEL_TABLE,
    group: 'table',
  },
  {
    id: 'alignLeft',
    labelKey: 'editor.table.alignLeft',
    disabledForRowRole: NO_ROW_RESTRICTION,
    svg: SVG_ALIGN_L,
    group: 'align',
  },
  {
    id: 'alignCenter',
    labelKey: 'editor.table.alignCenter',
    disabledForRowRole: NO_ROW_RESTRICTION,
    svg: SVG_ALIGN_C,
    group: 'align',
  },
  {
    id: 'alignRight',
    labelKey: 'editor.table.alignRight',
    disabledForRowRole: NO_ROW_RESTRICTION,
    svg: SVG_ALIGN_R,
    group: 'align',
  },
];

/** 渲染前的工具条条目集（单测 / 内部均使用）。 */
export function buildTableToolbarItems(): readonly TableToolbarItem[] {
  return TOOLBAR_ITEMS;
}

// ─── 公共 API：applyTableAction ─────────────────────────────────────────

/**
 * 给定 view 与 actionId，按 spec §3 执行；返回是否修改了文档。
 * 每个分支前先做 IME / readOnly / 上下文守卫。
 */
export function applyTableAction(view: EditorView, id: TableActionId): boolean {
  if (view.state.readOnly) return false;
  if (view.composing || view.compositionStarted) return false;
  const ctx = resolveTableContext(view.state);
  if (!ctx) return false;
  if (computeDisabled(id, ctx)) return false;
  switch (id) {
    case 'insertRowAbove':
      return doInsertRow(view, ctx, 'above');
    case 'insertRowBelow':
      return doInsertRow(view, ctx, 'below');
    case 'insertColumnLeft':
      return doInsertColumn(view, ctx, 'left');
    case 'insertColumnRight':
      return doInsertColumn(view, ctx, 'right');
    case 'deleteRow':
      return doDeleteRow(view, ctx);
    case 'deleteColumn':
      return doDeleteColumn(view, ctx);
    case 'deleteTable':
      return doDeleteTable(view, ctx);
    case 'alignLeft':
      return doSetAlignment(view, ctx, 'left');
    case 'alignCenter':
      return doSetAlignment(view, ctx, 'center');
    case 'alignRight':
      return doSetAlignment(view, ctx, 'right');
    default:
      return false;
  }
}

// ─── 内部：插行 ────────────────────────────────────────────────────────

function doInsertRow(view: EditorView, ctx: TableContext, where: 'above' | 'below'): boolean {
  if (ctx.rowRole === 'separator') return false;
  const { block, rowIndex, rowRole } = ctx;
  let targetRowIndex: number;
  if (rowRole === 'header') {
    // 表头特判：上方=首行前；下方=分隔行后
    targetRowIndex = where === 'above' ? 0 : (block.separatorIndex ?? 1) + 1;
  } else {
    targetRowIndex = where === 'above' ? rowIndex : rowIndex + 1;
  }
  const columnCount = block.columnCount;
  // 定界样式按表头行探测：全角 ｜ 表的空行用全角定界（spec §3「全角语义保真」）
  const doc = view.state.doc;
  const headerSource = doc.sliceString(block.rows[0]!.range.from, block.rows[0]!.range.to);
  const delim = headerSource.includes('｜') ? '｜' : '|';
  // 构造 columnCount 格空行（与 smart-continue/slash 模板同款 `|  |  |`）：
  // `'<delim> ' + ' <delim> '.repeat(n-1) + ' <delim>'`
  let insertText = `${delim} ${` ${delim} `.repeat(Math.max(0, columnCount - 1))} ${delim}\n`;
  let anchor: number;
  if (targetRowIndex <= 0) {
    const firstRow = block.rows[0]!;
    anchor = firstRow.range.from;
  } else if (targetRowIndex >= block.rows.length) {
    const lastRow = block.rows[block.rows.length - 1]!;
    const hasTrailingNewline =
      lastRow.range.to < doc.length &&
      doc.sliceString(lastRow.range.to, lastRow.range.to + 1) === '\n';
    if (hasTrailingNewline) {
      // 末行下沿：插在末行换行之后
      anchor = lastRow.range.to + 1;
    } else {
      // 末行就是文档末尾且无换行：先补换行再插，新行不带尾换行
      anchor = lastRow.range.to;
      insertText = `\n${insertText.slice(0, -1)}`;
    }
  } else {
    anchor = block.rows[targetRowIndex]!.range.from;
  }
  view.dispatch({
    changes: { from: anchor, to: anchor, insert: insertText },
    // 光标 = 新行 `<delim> ` 之后（首格）；insertText 可能带 '\n' 前缀（文档
    // 末尾无换行先补行的分支），用 indexOf 定位不受前缀影响
    selection: { anchor: anchor + insertText.indexOf(`${delim} `) + 2 },
    annotations: isolateHistory.of('full'),
  });
  return true;
}

// ─── 内部：行重建（列操作的字节保真基座，spec §3） ────────────────────

interface RowLineMeta {
  /** 前导缩进（缩进行的表行重建后保持缩进，互审 F5） */
  indent: string;
  /** join 定界符：原行含全角 ｜ 用全角（互审 F4：外管道存在性独立判定） */
  delim: string;
  hasLeading: boolean;
}

function rowLineMeta(originalLine: string): RowLineMeta {
  const indentMatch = /^[ \t]*/.exec(originalLine);
  const trimmed = originalLine.trim();
  return {
    indent: indentMatch ? indentMatch[0] : '',
    delim: trimmed.includes('｜') ? '｜' : '|',
    hasLeading: trimmed.startsWith('|') || trimmed.startsWith('｜'),
  };
}

/**
 * 行尾定界探测：半角管道需排除被转义的形态（`| a \|` 的尾管道是内容，
 * 互审 F3）；全角 ｜ 无转义概念。
 */
function endsWithRowDelimiter(originalLine: string): boolean {
  const trimmed = originalLine.trim();
  const last = trimmed.charAt(trimmed.length - 1);
  if (last === '｜') return true;
  if (last !== '|') return false;
  let backslashes = 0;
  for (let i = trimmed.length - 2; i >= 0 && trimmed.charAt(i) === '\\'; i--) {
    backslashes++;
  }
  return backslashes % 2 === 0;
}

/**
 * 由 cell 文本数组重建表格行源码。`\|` 转义与全角 `｜` 内容都在 cell.text
 * 内原样保留（AST 切格时已按转义规则归属格内容）；定界样式按原行探测——
 * 含全角定界用 ｜、有外管道保留外管道（`a | b` 无外管道形态维持）、
 * 缩进维持。
 */
function rebuildRowLine(originalLine: string, texts: string[]): string {
  const { indent, delim, hasLeading } = rowLineMeta(originalLine);
  const hasTrailing = endsWithRowDelimiter(originalLine);
  const core = texts.join(` ${delim} `);
  return `${indent}${hasLeading ? `${delim} ` : ''}${core}${hasTrailing ? ` ${delim}` : ''}`;
}

/** 行内（不含缩进）第 index 格文本起点的偏移；hasLeading 的 `<delim> ` 占 2 字符，格间 ` <delim> ` 占 3 字符。 */
function cellStartOffset(texts: readonly string[], index: number, hasLeading: boolean): number {
  let offset = hasLeading ? 2 : 0;
  for (let i = 0; i < index && i < texts.length; i++) {
    offset += (texts[i] ?? '').length + 3;
  }
  return offset;
}

// ─── 内部：插列 ────────────────────────────────────────────────────────

function doInsertColumn(view: EditorView, ctx: TableContext, where: 'left' | 'right'): boolean {
  const { block, columnIndex } = ctx;
  const targetColumn = where === 'right' ? columnIndex + 1 : columnIndex;
  const doc = view.state.doc;
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  for (const row of block.rows) {
    const original = doc.sliceString(row.range.from, row.range.to);
    const texts = row.cells.map((cell) => cell.text);
    // 锯齿行先补齐到插入位（spec §3；分隔行补 '---'，数据/表头补空，互审 F6）
    while (texts.length < targetColumn) {
      texts.push(row.isSeparator ? '---' : '');
    }
    // 空数据/表头格用 ''（join 后呈 `|  |` 双空格形态，与行模板一致）；分隔行 '---'
    texts.splice(targetColumn, 0, row.isSeparator ? '---' : '');
    changes.push({
      from: row.range.from,
      to: row.range.to,
      insert: rebuildRowLine(original, texts),
    });
  }
  if (changes.length === 0) return false;
  // 光标落点（互审 F1）：原光标 cell 在新行中的等效起点——左插原 cell 右移
  // 一格，右插原 cell 位置不变。前方行的变长/变短需叠加 delta 校正坐标系。
  const deltaBefore = changes
    .filter((c) => c.from < ctx.row.range.from)
    .reduce((sum, c) => sum + c.insert.length - (c.to - c.from), 0);
  const cursorOriginal = doc.sliceString(ctx.row.range.from, ctx.row.range.to);
  const cursorTexts = ctx.row.cells.map((cell) => cell.text);
  while (cursorTexts.length < targetColumn) {
    cursorTexts.push(ctx.row.isSeparator ? '---' : '');
  }
  cursorTexts.splice(targetColumn, 0, ctx.row.isSeparator ? '---' : '');
  const cursorMeta = rowLineMeta(cursorOriginal);
  const newCellIndex = where === 'left' ? columnIndex + 1 : columnIndex;
  const selection = {
    anchor:
      ctx.row.range.from +
      deltaBefore +
      cursorMeta.indent.length +
      cellStartOffset(cursorTexts, newCellIndex, cursorMeta.hasLeading),
  };
  // 从大到小排序（CM6 多区间变更需求）
  changes.sort((a, b) => b.from - a.from);
  view.dispatch({
    changes,
    selection,
    annotations: isolateHistory.of('full'),
  });
  return true;
}

// ─── 内部：删行 ────────────────────────────────────────────────────────

function doDeleteRow(view: EditorView, ctx: TableContext): boolean {
  if (ctx.rowRole === 'header' || ctx.rowRole === 'separator') return false;
  const { row } = ctx;
  // 删整行源码 + 行尾换行；末行无尾换行时改吃前置换行（避免文档尾悬挂 \n）
  let from = row.range.from;
  let to = row.range.to;
  const docText = view.state.doc.toString();
  if (to < docText.length && docText.charAt(to) === '\n') {
    to++;
  } else if (from > 0 && docText.charAt(from - 1) === '\n') {
    from--;
  }
  const fallbackRow = findFallbackRow(ctx.block, ctx.rowIndex);
  // 光标落点：上一数据行（表内首行则下一行）首格内容起点
  let cursor: number;
  if (fallbackRow) {
    const firstCell = fallbackRow.cells[0];
    cursor = firstCell ? firstCell.range.from : fallbackRow.range.from + 2;
  } else {
    cursor = from;
  }
  view.dispatch({
    changes: { from, to, insert: '' },
    selection: { anchor: cursor },
    annotations: isolateHistory.of('full'),
  });
  return true;
}

function findFallbackRow(block: TableNode, deletedIndex: number): TableRowNode | null {
  // 上一行（数据行）→ 若为表内首行则下一行
  if (deletedIndex > 0) {
    for (let i = deletedIndex - 1; i >= 0; i--) {
      const r = block.rows[i]!;
      if (!r.isSeparator) return r;
    }
  }
  for (let i = deletedIndex + 1; i < block.rows.length; i++) {
    const r = block.rows[i]!;
    if (!r.isSeparator) return r;
  }
  return null;
}

// ─── 内部：删列 ────────────────────────────────────────────────────────

function doDeleteColumn(view: EditorView, ctx: TableContext): boolean {
  const { block, columnIndex } = ctx;
  if (block.columnCount <= 1) return false;
  const doc = view.state.doc;
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  for (const row of block.rows) {
    if (columnIndex >= row.cells.length) continue; // 锯齿行缺该列跳过
    const original = doc.sliceString(row.range.from, row.range.to);
    const texts = row.cells.map((cell) => cell.text);
    texts.splice(columnIndex, 1);
    changes.push({
      from: row.range.from,
      to: row.range.to,
      insert: rebuildRowLine(original, texts),
    });
  }
  if (changes.length === 0) return false;
  // 光标落点（互审 F1）：同列左邻 cell（首列则新首列 cell）在新行中的起点；
  // 前方行变短需叠加 delta 校正坐标系
  const deltaBefore = changes
    .filter((c) => c.from < ctx.row.range.from)
    .reduce((sum, c) => sum + c.insert.length - (c.to - c.from), 0);
  const cursorOriginal = doc.sliceString(ctx.row.range.from, ctx.row.range.to);
  const cursorTexts = ctx.row.cells.map((cell) => cell.text);
  if (columnIndex < cursorTexts.length) cursorTexts.splice(columnIndex, 1);
  const cursorMeta = rowLineMeta(cursorOriginal);
  const neighborIndex = columnIndex === 0 ? 0 : columnIndex - 1;
  const selection = {
    anchor:
      ctx.row.range.from +
      deltaBefore +
      cursorMeta.indent.length +
      cellStartOffset(cursorTexts, neighborIndex, cursorMeta.hasLeading),
  };
  changes.sort((a, b) => b.from - a.from);
  view.dispatch({ changes, selection, annotations: isolateHistory.of('full') });
  return true;
}

// ─── 内部：删除整表 ────────────────────────────────────────────────────

function doDeleteTable(view: EditorView, ctx: TableContext): boolean {
  const { block } = ctx;
  const firstRow = block.rows[0]!;
  const lastRow = block.rows[block.rows.length - 1]!;
  const docText = view.state.doc.toString();
  const from = firstRow.range.from;
  const to = lastRow.range.to;
  // 表前 / 表后空行计数：紧贴 table 的 `\n` 减去 1（边界换行）
  let leadingCount = 0;
  let k = from - 1;
  while (k >= 0 && docText.charAt(k) === '\n') {
    leadingCount++;
    k--;
  }
  const leadingBlanks = Math.max(0, leadingCount - 1);
  let trailingCount = 0;
  // 从 to 起数：charAt(to) 是末行的行终止符（row.range 不含换行），
  // 其后才是真正的表后空行
  k = to;
  while (k < docText.length && docText.charAt(k) === '\n') {
    trailingCount++;
    k++;
  }
  const trailingBlanks = Math.max(0, trailingCount - 1);
  // 默认删除范围：表行本身（保留两侧边界 `\n` 为「其余内容」）
  let changeFrom = from - leadingBlanks;
  let changeTo = to + trailingBlanks;
  let insertText = '';
  const isAtDocEnd = changeTo >= docText.length;
  const isAtDocStart = changeFrom <= 0;
  if (leadingBlanks > 0 && trailingBlanks > 0 && !isAtDocStart && !isAtDocEnd) {
    // 中部夹心空行 → 收敛为一个空行（保留 `before` 与 `after` 间恰好一条
    // 空行 = 两个换行）：吃掉两侧边界 + 所有空行，插入 `\n\n`
    changeFrom = from - leadingBlanks - 1;
    changeTo = to + 1 + trailingBlanks;
    insertText = '\n\n';
  } else if (leadingBlanks > 0 && trailingBlanks > 0 && isAtDocEnd) {
    // 表在文档末 + 两侧均有空行 → 保留表前空行集合，吃掉表后
    changeTo = to + 1 + trailingBlanks;
    insertText = '';
  } else if (leadingBlanks > 0 && trailingBlanks > 0 && isAtDocStart) {
    // 表在文档首 + 两侧均有空行 → 保留表后空行集合，吃掉表前
    changeFrom = from - leadingBlanks - 1;
    insertText = '';
  }
  // 光标落点：表格原位置后的首个非空内容
  const cursorTarget = computeCursorAfterDelete(docText, changeFrom, insertText);
  view.dispatch({
    changes: { from: changeFrom, to: changeTo, insert: insertText },
    selection: { anchor: cursorTarget },
    annotations: isolateHistory.of('full'),
  });
  return true;
}

/**
 * 删除后光标定位：插入文本段末端向后找首个非空字符。
 */
function computeCursorAfterDelete(docText: string, changeFrom: number, insertText: string): number {
  const afterPos = changeFrom + insertText.length;
  let k = afterPos;
  while (k < docText.length && docText.charAt(k) === '\n') k++;
  // 若整个 doc 只剩空行，k === docText.length，光标落在末尾即可
  return k;
}

// ─── 内部：对齐 ────────────────────────────────────────────────────────

function doSetAlignment(
  view: EditorView,
  ctx: TableContext,
  align: 'left' | 'center' | 'right',
): boolean {
  const { block, columnIndex } = ctx;
  if (block.separatorIndex === null) return false;
  const sepRow = block.rows[block.separatorIndex]!;
  if (sepRow.cells.length === 0 && columnIndex > 0) return false;
  const cellMark = align === 'center' ? ':---:' : align === 'right' ? '---:' : '---';
  const doc = view.state.doc;
  const original = doc.sliceString(sepRow.range.from, sepRow.range.to);
  const texts = sepRow.cells.map((cell) => cell.text);
  // 锯齿分隔行：先以 '---' 补齐到 columnIndex（含）
  while (texts.length <= columnIndex) texts.push('---');
  texts[columnIndex] = cellMark;
  // 光标落点（互审 F7）：分隔行重建后回当前列 cell 起点；光标行在分隔行
  // 之后时按分隔行变长量平移（spec §3「光标不动」的等效位）
  const meta = rowLineMeta(original);
  const sepDelta = rebuildRowLine(original, texts).length - original.length;
  const anchorBase =
    ctx.row === sepRow
      ? sepRow.range.from +
        meta.indent.length +
        cellStartOffset(texts, columnIndex, meta.hasLeading)
      : view.state.selection.main.head + (ctx.row.range.from > sepRow.range.from ? sepDelta : 0);
  view.dispatch({
    changes: {
      from: sepRow.range.from,
      to: sepRow.range.to,
      insert: rebuildRowLine(original, texts),
    },
    selection: { anchor: anchorBase },
    annotations: isolateHistory.of('full'),
  });
  return true;
}

// ─── 工具条 DOM + ViewPlugin ───────────────────────────────────────────

export const TABLE_TOOLBAR_DOM_CLASS = 'cm-jotluck-table-toolbar';
const TOOLBAR_BTN_CLASS = `${TABLE_TOOLBAR_DOM_CLASS}__btn`;
const TOOLBAR_GROUP_CLASS = `${TABLE_TOOLBAR_DOM_CLASS}__group`;
const TOOLBAR_BTN_DISABLED_CLASS = `${TOOLBAR_BTN_CLASS}--disabled`;

interface ToolbarState {
  visible: boolean;
  context: TableContext | null;
  composing: boolean;
}

class TableToolbarPlugin implements PluginValue {
  private view: EditorView;
  private root: HTMLDivElement;
  private state: ToolbarState;
  private toolbarAria: string;
  private compTimer: ReturnType<typeof setTimeout> | null = null;
  private detachFns: Array<() => void> = [];

  constructor(view: EditorView) {
    this.view = view;
    this.toolbarAria = translate('editor.table.toolbarAria');
    this.root = this.buildRoot();
    this.state = { visible: false, context: null, composing: false };
    view.dom.appendChild(this.root);

    const onCompStart = () => {
      this.state.composing = true;
      this.recomputeFromState();
    };
    const onCompEnd = () => {
      this.state.composing = false;
      this.compTimer = setTimeout(() => {
        this.recomputeFromState();
      }, 0);
    };
    view.contentDOM.addEventListener('compositionstart', onCompStart);
    view.contentDOM.addEventListener('compositionend', onCompEnd);
    this.detachFns.push(() => {
      view.contentDOM.removeEventListener('compositionstart', onCompStart);
      view.contentDOM.removeEventListener('compositionend', onCompEnd);
    });
  }

  update(update: ViewUpdate): void {
    if (update.state.readOnly) {
      this.closeToolbar();
      return;
    }
    if (update.focusChanged && !update.view.hasFocus) {
      this.closeToolbar();
      return;
    }
    if (update.selectionSet || update.docChanged || update.focusChanged) {
      this.recomputeFromState();
    }
  }

  destroy(): void {
    if (this.compTimer !== null) {
      clearTimeout(this.compTimer);
      this.compTimer = null;
    }
    this.detachFns.forEach((fn) => fn());
    if (this.root.parentElement) this.root.parentElement.removeChild(this.root);
  }

  private buildRoot(): HTMLDivElement {
    const root = document.createElement('div');
    root.className = TABLE_TOOLBAR_DOM_CLASS;
    root.setAttribute('role', 'toolbar');
    root.setAttribute('aria-label', this.toolbarAria);
    root.dataset.cmJotluck = 'table-toolbar';
    root.style.position = 'absolute';
    root.style.visibility = 'hidden';
    return root;
  }

  private recomputeFromState(): void {
    if (this.state.composing || this.view.composing || this.view.compositionStarted) {
      this.hide();
      return;
    }
    const ctx = resolveTableContext(this.view.state);
    if (!ctx) {
      this.closeToolbar();
      return;
    }
    if (
      !this.state.visible ||
      this.state.context === null ||
      this.state.context.block !== ctx.block
    ) {
      this.toolbarAria = translate('editor.table.toolbarAria');
      this.root.setAttribute('aria-label', this.toolbarAria);
      if (!this.root.parentElement) this.view.dom.appendChild(this.root);
      this.state.context = ctx;
      this.render(ctx);
      this.state.visible = true;
    } else {
      // 同一表格内光标移动：仅重渲染（可能改 columnIndex / 禁用态）
      this.state.context = ctx;
      this.render(ctx);
    }
    this.schedulePosition();
  }

  private closeToolbar(): void {
    if (!this.state.visible && !this.root.parentElement) return;
    this.state.visible = false;
    this.state.context = null;
    this.root.replaceChildren();
    this.root.style.visibility = 'hidden';
    if (this.root.parentElement) this.root.parentElement.removeChild(this.root);
  }

  private hide(): void {
    // 组合期 = 完全关闭（沿用「关闭即从 DOM 摘除」合同，spec §4；
    // compositionend 落定后由 recomputeFromState 重新求值恢复）
    this.closeToolbar();
  }

  private render(ctx: TableContext): void {
    this.root.replaceChildren();
    const groups: Record<TableToolbarItem['group'], TableToolbarItem[]> = {
      row: [],
      column: [],
      table: [],
      align: [],
    };
    for (const item of TOOLBAR_ITEMS) {
      groups[item.group]!.push(item);
    }
    const groupOrder: TableToolbarItem['group'][] = ['row', 'column', 'table', 'align'];
    for (const g of groupOrder) {
      const wrap = document.createElement('div');
      wrap.className = TOOLBAR_GROUP_CLASS;
      for (const item of groups[g]!) {
        const wrapBtn = this.makeButton(item, ctx);
        wrap.appendChild(wrapBtn);
      }
      this.root.appendChild(wrap);
    }
  }

  private makeButton(item: TableToolbarItem, ctx: TableContext): HTMLButtonElement {
    // i18n-dynamic-key — 键全部为 TOOLBAR_ITEMS 静态 11 项，已在 locales/editor.table.* 注册
    const label = translate(item.labelKey);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = TOOLBAR_BTN_CLASS;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.dataset.tableAction = item.id;
    btn.dataset.cmJotluck = 'table-action';
    btn.innerHTML = item.svg;
    const disabled = computeDisabled(item.id, ctx);
    if (disabled) {
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
      btn.classList.add(TOOLBAR_BTN_DISABLED_CLASS);
    } else {
      btn.setAttribute('aria-disabled', 'false');
    }
    btn.addEventListener('mousedown', (event) => {
      // @mousedown.prevent 保焦点（BUG-052 纪律，spec §4）
      event.preventDefault();
      if (this.view.composing || this.view.compositionStarted) return;
      const ctxNow = resolveTableContext(this.view.state);
      if (!ctxNow) return;
      if (computeDisabled(item.id, ctxNow)) return;
      const ok = applyTableAction(this.view, item.id);
      if (ok) this.recomputeFromState();
    });
    return btn;
  }

  private schedulePosition(): void {
    const ctx = this.state.context;
    if (!ctx) return;
    const anchorPos = ctx.block.range.from;
    requestAnimationFrame(() => this.position(anchorPos));
  }

  private position(anchorPos: number): void {
    if (!this.state.visible) return;
    let coords: ReturnType<EditorView['coordsAtPos']> = null;
    try {
      coords = this.view.coordsAtPos(anchorPos);
    } catch {
      coords = null;
    }
    if (!coords) {
      this.root.style.visibility = 'hidden';
      return;
    }
    const viewRect = this.view.dom.getBoundingClientRect();
    const rootRect = this.root.getBoundingClientRect();
    const height = rootRect.height || 32;
    const width = rootRect.width || 280;
    let left = coords.left - viewRect.left;
    if (left + width > viewRect.width) left = Math.max(0, viewRect.width - width);
    if (left < 0) left = 0;
    const anchorTop = coords.top - viewRect.top;
    const spaceAbove = anchorTop;
    const spaceBelow = viewRect.height - (coords.bottom - viewRect.top);
    const lastRow = this.state.context?.block.rows[this.state.context.block.rows.length - 1];
    let top: number;
    if (spaceAbove >= height + 4 || lastRow === undefined) {
      top = Math.max(0, anchorTop - height - 2);
    } else {
      const lastCoords = (() => {
        try {
          return this.view.coordsAtPos(lastRow.range.to);
        } catch {
          return null;
        }
      })();
      const lastBottom = lastCoords ? lastCoords.bottom - viewRect.top : anchorTop;
      top = spaceBelow >= height + 4 ? lastBottom : Math.max(0, anchorTop - height - 2);
    }
    this.root.style.left = `${left}px`;
    this.root.style.top = `${top}px`;
    this.root.style.visibility = 'visible';
  }
}

const tableToolbarPlugin = ViewPlugin.fromClass(TableToolbarPlugin);

function computeDisabled(id: TableActionId, ctx: TableContext): boolean {
  const item = TOOLBAR_ITEMS.find((i) => i.id === id);
  if (!item) return true;
  if (item.disabledForRowRole.has(ctx.rowRole)) return true;
  if (id === 'deleteColumn' && ctx.block.columnCount <= 1) return true;
  if (
    (id === 'insertColumnLeft' || id === 'insertColumnRight' || id === 'deleteColumn') &&
    ctx.row.cells.length === 0
  ) {
    return true;
  }
  return false;
}

const tableEditTheme = EditorView.theme(
  {
    [`& .${TABLE_TOOLBAR_DOM_CLASS}`]: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--space-8)',
      fontFamily: 'var(--ff-body)',
      fontSize: 'var(--text-sm)',
      color: 'var(--ink-primary)',
      background: 'var(--paper-raised)',
      border: 'var(--border-thin) solid var(--rule-strong)',
      borderRadius: 'var(--radius)',
      boxShadow: 'var(--shadow-float)',
      padding: 'var(--space-4) var(--space-6)',
      zIndex: '10',
      maxWidth: 'calc(100% - 8px)',
    },
    [`& .${TOOLBAR_GROUP_CLASS}`]: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--space-4)',
    },
    [`& .${TOOLBAR_BTN_CLASS}`]: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 'var(--space-28)',
      height: 'var(--space-28)',
      padding: 0,
      border: 'none',
      background: 'transparent',
      color: 'var(--ink-secondary)',
      borderRadius: 'var(--radius)',
      cursor: 'pointer',
    },
    [`& .${TOOLBAR_BTN_CLASS}:hover`]: {
      background: 'var(--accent-soft)',
      color: 'var(--ink-primary)',
    },
    [`& .${TOOLBAR_BTN_CLASS}.${TOOLBAR_BTN_DISABLED_CLASS}`]: {
      color: 'var(--ink-muted)',
      cursor: 'not-allowed',
      opacity: '0.5',
    },
  },
  { dark: false },
);

// ─── 公共 API：tableEditExtension ───────────────────────────────────────

/**
 * 装配用扩展。MarkdownEditor.vue 把数组展开插入到 readOnlyCompartment 之后、
 * slashCommandsExtension() 之后。本扩展不注册 keymap（spec §6）。
 */
export function tableEditExtension(): Extension[] {
  return [tableEditTheme, tableToolbarPlugin];
}
