/**
 * 块级 AST — 带源码 UTF-16 偏移的 Markdown 文档解析器
 *
 * 语义基准：parseLiveBlocks（cm6-live-preview）的逐行判定优先级，逐规则复刻：
 *   frontmatter(行0) → refDefinition → blank → codeFence → jsonBlock(按范围)
 *   → hr → ATX heading → setext(lookahead) → blockquote → list → table → paragraph
 *
 * 铁律：一切 range 为源码偏移（[from,to)，不含行尾换行符）。识别在归一化行上
 * 进行，但凡给范围的字段（markerRange/contentRange/cells）一律从源码行用
 * 含全角字符类的正则直接切，禁止把归一化后的下标当源码偏移。
 */

import { scanBareJsonBlockLineRanges } from './bare-json';
import { ContinuationScanner, readMarkdownListMarker, type ContinuationLine } from './continuation';
export { extractWikiLinkOccurrences } from './inline';
export type { WikiLinkOccurrence } from './inline';
import {
  headingIdFromText,
  isTableRowCandidate,
  normalizeFullwidthMarkdownSyntax,
  splitTableCells,
  tableAlignments,
} from './syntax';

/** 源码 UTF-16 偏移区间，[from,to)，不含行尾换行符 */
export interface SourceRange {
  from: number;
  to: number;
}

/** 0 基行号 → 所属块；table 行额外给出行内行下标 */
export interface LineInfo {
  blockIndex: number;
  rowIndex?: number;
  /** Source-exact editing hint; absent on ordinary prose and code. */
  continuation?: ContinuationLine;
}

interface BlockBase {
  /** 节点覆盖的源码区间（多行块含中间换行符） */
  range: SourceRange;
  /** 起始行号，0 基 */
  lineFrom: number;
  /** 结束行号，0 基闭区间 */
  lineTo: number;
}

export interface FrontmatterNode extends BlockBase {
  type: 'frontmatter';
  /** `---`  opener 与 closer 之间的源码切片 */
  rawContent: string;
  /** rawContent 的源码区间（不含 opener/closer 行） */
  contentRange: SourceRange;
  /** 是否找到闭合 `---`（未闭合则吞到 EOF） */
  closed: boolean;
}

export interface HeadingNode extends BlockBase {
  type: 'heading';
  level: 1 | 2 | 3 | 4 | 5 | 6;
  /** 归一化后的标题文本（已去尾随 `#`、已 trim） */
  text: string;
  /** 标题内容在源码中的区间 */
  contentRange: SourceRange;
  /** 是否 setext 式（跨两行） */
  setext: boolean;
  /** setext 规则线的源码区间（仅 setext 时存在） */
  setextRuleRange?: SourceRange;
  /** headingIdFromText(text, occurrence)，occurrence 按同 baseId 文档序 1 基 */
  id: string;
}

export interface CodeFenceNode extends BlockBase {
  type: 'codeFence';
  /** info string trim 后结果（可能为空串） */
  lang: string;
  /** 开围栏标记（如 ``` 或 ~~~） */
  marker: string;
  /** 开围栏前导空白长度 */
  indent: number;
  /** 开围栏行号（0 基） */
  openLine: number;
  /** 闭合围栏行号（0 基）；未闭合为 null */
  closeLine: number | null;
  /** 是否找到闭合围栏 */
  closed: boolean;
  /** 围栏内容源码区间（开围栏行尾之后 → 闭合行行首；未闭合吞到 EOF） */
  contentRange: SourceRange | null;
}

export interface JsonBlockNode extends BlockBase {
  type: 'jsonBlock';
}

export interface BlockquoteLineInfo {
  lineNumber: number;
  /** 整行源码区间 */
  range: SourceRange;
  /** 引用标记（含 `>`/＞ 及其后一个空白）源码区间 */
  markerRange: SourceRange;
  /** 去掉标记后的内容源码区间（可能为空区间） */
  contentRange: SourceRange;
  /** 内容 trim 后为空 */
  isEmpty: boolean;
  /** 引用层级（连续 `>` 数） */
  depth: number;
  /** 归一化行上匹配到的标记原文（如 `>> `） */
  normalizedMarker: string;
}

export interface BlockquoteNode extends BlockBase {
  type: 'blockquote';
  /** 组内最大引用层级 */
  depth: number;
  lines: BlockquoteLineInfo[];
}

export type ListItemKind = 'unordered' | 'ordered' | 'task';

export interface ListItemNode extends BlockBase {
  type: 'listItem';
  kind: ListItemKind;
  /** 半角规范形：无序/任务为 bullet（`-`、`*`、`+`），有序为数字串（如 `12`） */
  marker: string;
  /** 有序列表定界符（`.` 或 `)`）；其余 kind 为 undefined */
  delimiter?: string;
  /** 有序列表数字（number(marker)）；其余 kind 为 undefined */
  number?: number;
  /** 任务列表勾选态；仅 task */
  checked?: boolean;
  /** 行首缩进长度 */
  indent: number;
  /** 列表标记源码区间（任务含 `[ ]`/`[x]`，不含标记后空白） */
  markerRange: SourceRange;
  /** 列表项内容源码区间 */
  contentRange: SourceRange;
  /** 源码内容 trim 后为空 */
  isEmpty: boolean;
  /** 组内序号，1 基 */
  itemIndex: number;
  /** 整个列表组的源码区间 */
  groupRange: SourceRange;
}

export interface TableCell {
  text: string;
  range: SourceRange;
}

export interface TableRowNode {
  lineNumber: number;
  /** 整行源码区间 */
  range: SourceRange;
  /** 按 `[|｜]` 切出的源码格（text 为 trim 后源码切片） */
  cells: TableCell[];
  /** 是否分隔行（用归一化行判定，全角 `－` 格视为 `-`） */
  isSeparator: boolean;
  /** 仅当 separatorIndex===1 且为第 0 行时为 true */
  isHeader: boolean;
}

export interface TableNode extends BlockBase {
  type: 'table';
  rows: TableRowNode[];
  /** 首个分隔行下标；无分隔行为 null */
  separatorIndex: number | null;
  hasSeparator: boolean;
  /** 非分隔行最大格数（≥1） */
  columnCount: number;
  alignments: Array<'left' | 'center' | 'right'>;
}

export interface HorizontalRuleNode extends BlockBase {
  type: 'horizontalRule';
}

export interface RefDefinitionNode extends BlockBase {
  type: 'refDefinition';
  label: string;
  url: string;
  title?: string;
}

export interface ParagraphNode extends BlockBase {
  type: 'paragraph';
  /** 连续非空行的源码切片（含中间换行符） */
  text: string;
}

export interface BlankNode extends BlockBase {
  type: 'blank';
}

export type BlockNode =
  | FrontmatterNode
  | HeadingNode
  | CodeFenceNode
  | JsonBlockNode
  | BlockquoteNode
  | ListItemNode
  | TableNode
  | HorizontalRuleNode
  | RefDefinitionNode
  | ParagraphNode
  | BlankNode;

export interface DocumentAst {
  source: string;
  blocks: BlockNode[];
  /** 0 基行号 → 所属块；空行也映射到各自的 blank 块 */
  lineMap: LineInfo[];
  frontmatter: FrontmatterNode | null;
}

// ─── 行内识别辅助 ──────────────────────────────────────────────────

/**
 * 单行识别归一化：renderer 归一 + 行首全角补充
 * （`＋→+`、行首 `＊`/`－` 列表符）。全部规则等长替换仅限行首，
 * 归一不改行数、行内偏移语义由源码空间正则重新切分保证。
 */
function normalizeLineForDetect(line: string): string {
  // renderer 归一覆盖 －（带尾随空白）、＞、成对 ＊、｜ 等。
  // 此处额外处理：＋ → +、无尾随空白的 － → -、行首单发 ＊ → *（renderer 只转成对 ＊）。
  return normalizeFullwidthMarkdownSyntax(line)
    .replace(/\uFF0B/g, '+')
    .replace(/^(\s*)\uFF0D/gm, '$1-')
    .replace(/^(\s*)\uFF0A(?=\s|$)/gm, '$1*');
}

// ─── 识别用正则（归一化行） ────────────────────────────────────────

const REF_DEF_RE = /^\s*\[([^\]]+)\]:\s*(\S+)(?:\s+"([^"]*)")?\s*$/;
const FENCE_OPEN_RE = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE_RE = /^(\s{0,3})(`{3,}|~{3,})\s*$/;
const HR_RE = /^(-{3,}|\*{3,}|_{3,})\s*$/;
const ATX_RE = /^(#{1,6})\s+(.+)$/;
const SETEXT_RULE_RE = /^(=+|-+)\s*$/;

// ─── 源码空间切分正则（字符类含全角等价物） ──────────────────────

const SRC_ATX_RE = /^(\s{0,3})([＃#]{1,6})([ \t\u3000]+)([\s\S]*)$/;
const SRC_BLOCKQUOTE_RE = /^(\s*)((?:[>＞][ \u3000]?)+)([\s\S]*)$/;

/** 分隔行判定（归一化行）：全角 `－` 格归一后按 `-` 判定，修复既有缺陷。 */
function isSeparatorDetectLine(detectLine: string): boolean {
  if (!detectLine.includes('|')) return false;
  const cells = splitTableCells(detectLine);
  return cells.length > 0 && cells.every((cell) => /^:?[-－]{1,}:?$/.test(cell));
}

/**
 * 命中点前连续反斜杠数为奇 → 该 `|` 被 `\` 转义，不是切分点（全角 `｜` 无转义概念）。
 * 与 syntax.ts 的 isEscapedTablePipe 同口径，分置两处是因本模块不导出 syntax 私有 helper。
 */
function isEscapedSourcePipe(text: string, pipeIndex: number): boolean {
  let backslashes = 0;
  for (let k = pipeIndex - 1; k >= 0 && text.charAt(k) === '\\'; k--) backslashes++;
  return backslashes % 2 === 1;
}

/**
 * 按未转义的 `|` / 任意 `｜` 切源码行并给出每格源码区间（口径与 splitTableCells 一致）。
 * 单元格 text 为 trim 后源码切片（保留反斜杠）；行首/行尾分隔符仅在未被转义时剥离。
 */
function splitTableCellsWithRanges(
  sourceLine: string,
  lineFrom: number,
): Array<{ text: string; range: SourceRange }> {
  const leading = sourceLine.length - sourceLine.trimStart().length;
  const trimmed = sourceLine.trim();
  let body = trimmed;
  let bodyOffset = 0;
  if ((body.startsWith('|') && !isEscapedSourcePipe(body, 0)) || body.startsWith('｜')) {
    body = body.slice(1);
    bodyOffset = 1;
  }
  if ((body.endsWith('|') && !isEscapedSourcePipe(body, body.length - 1)) || body.endsWith('｜')) {
    body = body.slice(0, -1);
  }
  const segments: Array<{ start: number; text: string }> = [];
  let segStart = 0;
  for (let k = 0; k < body.length; k++) {
    const ch = body.charAt(k);
    if (ch === '｜' || (ch === '|' && !isEscapedSourcePipe(body, k))) {
      segments.push({ start: bodyOffset + segStart, text: body.slice(segStart, k) });
      segStart = k + 1;
    }
  }
  segments.push({ start: bodyOffset + segStart, text: body.slice(segStart) });
  return segments.map((seg) => {
    const inner = seg.text.trim();
    const innerStart = seg.start + (seg.text.length - seg.text.trimStart().length);
    return {
      text: inner,
      range: {
        from: lineFrom + leading + innerStart,
        to: lineFrom + leading + innerStart + inner.length,
      },
    };
  });
}

interface ListDetect {
  kind: ListItemKind;
  family: 'unordered' | 'ordered';
}

/** 行是否匹配某种列表项（用归一化行判定）。 */
function detectListItem(detectLine: string): ListDetect | null {
  return readMarkdownListMarker(detectLine);
}

/**
 * 解析 Markdown 源码为块级 AST。
 *
 * @param source - 原始 Markdown 源码（未归一化）
 */
/** Same scanner for synchronous commands and cooperative background analysis. */
export function parseDocument(source: string): DocumentAst {
  const scanner = scanDocument(source);
  let result = scanner.next();
  while (!result.done) result = scanner.next();
  return result.value;
}

export async function parseDocumentAsync(
  source: string,
  cancelled: () => boolean = () => false,
): Promise<DocumentAst> {
  const scanner = scanDocument(source);
  let deadline = performance.now() + 8;
  for (;;) {
    if (cancelled()) throw new Error('Document analysis cancelled');
    const result = scanner.next();
    if (result.done) return result.value;
    if (performance.now() >= deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      deadline = performance.now() + 8;
    }
  }
}

/** Safe fast path for ordinary prose edits; structural edits use the same full scanner. */
export async function updateDocumentAsync(
  previous: DocumentAst | null,
  source: string,
  cancelled: () => boolean = () => false,
): Promise<DocumentAst> {
  if (!previous) return parseDocumentAsync(source, cancelled);
  if (previous.source === source) return previous;
  const before = previous.source;
  let from = 0;
  const limit = Math.min(source.length, before.length);
  while (from < limit && source.charCodeAt(from) === before.charCodeAt(from)) from++;
  let oldEnd = before.length;
  let newEnd = source.length;
  while (
    oldEnd > from &&
    newEnd > from &&
    before.charCodeAt(oldEnd - 1) === source.charCodeAt(newEnd - 1)
  ) {
    oldEnd--;
    newEnd--;
  }
  const removed = before.slice(from, oldEnd);
  const inserted = source.slice(from, newEnd);
  // No line boundary, punctuation, indentation, or Markdown marker may change here.
  const safe = /^[\p{L}\p{N} ]*$/u;
  if (!safe.test(removed) || !safe.test(inserted) || /\n/.test(removed + inserted))
    return parseDocumentAsync(source, cancelled);
  const index = previous.blocks.findIndex(
    (block) => block.range.from < from && block.range.to > oldEnd,
  );
  const changed = previous.blocks[index];
  if (
    !changed ||
    changed.type !== 'paragraph' ||
    changed.lineFrom !== changed.lineTo ||
    previous.lineMap[changed.lineFrom]?.continuation
  )
    return parseDocumentAsync(source, cancelled);
  const delta = source.length - before.length;
  const local = source.slice(changed.range.from, changed.range.to + delta);
  const localAst = parseDocument(local);
  if (localAst.blocks.length !== 1 || localAst.blocks[0]?.type !== 'paragraph')
    return parseDocumentAsync(source, cancelled);
  const blocks: BlockNode[] = [];
  let deadline = performance.now() + 8;
  // Offsets change, source-derived text and row numbers do not. Never mutate old snapshots.
  const shift = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(shift);
    if (!value || typeof value !== 'object') return value;
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value))
      result[key] =
        (key === 'from' || key === 'to') && typeof entry === 'number'
          ? entry + delta
          : shift(entry);
    return result;
  };
  for (let i = 0; i < previous.blocks.length; i++) {
    if (cancelled()) throw new Error('Document analysis cancelled');
    const block = previous.blocks[i]!;
    if (i < index) blocks.push(block);
    else if (i === index)
      blocks.push({
        ...changed,
        range: { from: changed.range.from, to: changed.range.to + delta },
        text: source.slice(changed.range.from, changed.range.to + delta),
      });
    else blocks.push(shift(block) as BlockNode);
    if (performance.now() >= deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      deadline = performance.now() + 8;
    }
  }
  const lineMap = previous.lineMap.map((info, line) =>
    line > changed.lineTo && info.continuation
      ? { ...info, continuation: shift(info.continuation) as ContinuationLine }
      : info,
  );
  return { source, blocks, lineMap, frontmatter: previous.frontmatter };
}

function* scanDocument(source: string): Generator<void, DocumentAst> {
  const sourceLines = source.split('\n');
  const lineCount = sourceLines.length;
  const detectLines: string[] = [];
  for (let line = 0; line < lineCount; line++) {
    detectLines.push(normalizeLineForDetect(sourceLines[line]!));
    if (line % 128 === 0) yield;
  }

  // 行首源码偏移（前缀和）
  const lineStarts: number[] = new Array<number>(lineCount);
  let offset = 0;
  for (let i = 0; i < lineCount; i++) {
    if (i % 256 === 0) yield;
    lineStarts[i] = offset;
    offset += sourceLines[i]!.length + 1;
  }
  const lineRange = (i: number): SourceRange => ({
    from: lineStarts[i]!,
    to: lineStarts[i]! + sourceLines[i]!.length,
  });

  // 裸 JSON 范围（归一化全文，行号直接对应源码行）
  const jsonRangesByStart = new Map(
    (yield* scanBareJsonBlockLineRanges(detectLines.join('\n'))).map((range) => [
      range.startLine,
      range,
    ]),
  );

  const blocks: BlockNode[] = [];
  const lineMap: LineInfo[] = new Array<LineInfo>(lineCount);
  const headingOccurrences = new Map<string, number>();
  const continuationScanner = new ContinuationScanner();
  let frontmatter: FrontmatterNode | null = null;

  /** 登记块并把其覆盖行写入 lineMap。 */
  const pushBlock = (block: BlockNode, rowIndexByLine?: Map<number, number>): void => {
    const blockIndex = blocks.length;
    blocks.push(block);
    for (let k = block.lineFrom; k <= block.lineTo && k < lineCount; k++) {
      const rowIndex = rowIndexByLine?.get(k);
      const continuation = continuationScanner.scan(sourceLines[k]!, lineStarts[k]!, block.type);
      lineMap[k] = {
        blockIndex,
        ...(rowIndex === undefined ? {} : { rowIndex }),
        ...(continuation ? { continuation } : {}),
      };
    }
  };

  /** 分配 heading id：同 baseId 按文档序 1 基递增。 */
  const nextHeadingId = (text: string): string => {
    const base = headingIdFromText(text);
    const occurrence = (headingOccurrences.get(base) ?? 0) + 1;
    headingOccurrences.set(base, occurrence);
    return headingIdFromText(text, occurrence);
  };

  let i = 0;
  while (i < lineCount) {
    yield;
    const detectLine = detectLines[i] ?? '';

    // ── Frontmatter（仅文档第 0 行 `---` 开启） ──
    if (i === 0 && detectLine.trim() === '---') {
      let j = 1;
      while (j < lineCount && (detectLines[j] ?? '').trim() !== '---') {
        if (j % 128 === 0) yield;
        j++;
      }
      const closed = j < lineCount;
      const lineTo = closed ? j : lineCount - 1;
      const contentFrom = lineStarts[0]! + sourceLines[0]!.length + 1;
      const contentTo = Math.max(contentFrom, closed ? lineStarts[j]! - 1 : source.length);
      const node: FrontmatterNode = {
        type: 'frontmatter',
        range: { from: 0, to: lineRange(lineTo).to },
        lineFrom: 0,
        lineTo,
        rawContent: source.slice(contentFrom, contentTo),
        contentRange: { from: contentFrom, to: contentTo },
        closed,
      };
      frontmatter = node;
      pushBlock(node);
      i = lineTo + 1;
      continue;
    }

    // ── Reference definition ──
    const refMatch = REF_DEF_RE.exec(detectLine);
    if (refMatch) {
      const node: RefDefinitionNode = {
        type: 'refDefinition',
        range: lineRange(i),
        lineFrom: i,
        lineTo: i,
        label: refMatch[1] ?? '',
        url: refMatch[2] ?? '',
        ...(refMatch[3] !== undefined ? { title: refMatch[3] } : {}),
      };
      pushBlock(node);
      i++;
      continue;
    }

    // ── Blank ──
    if (detectLine.trim() === '') {
      pushBlock({ type: 'blank', range: lineRange(i), lineFrom: i, lineTo: i });
      i++;
      continue;
    }

    // ── Code fence（``` 与 ~~~ 两种，≤3 缩进） ──
    const fenceOpen = FENCE_OPEN_RE.exec(detectLine);
    if (fenceOpen) {
      const indent = fenceOpen[1] ?? '';
      const marker = fenceOpen[2] ?? '```';
      const fenceChar = marker.charAt(0);
      let j = i + 1;
      let closed = false;
      while (j < lineCount) {
        if (j % 128 === 0) yield;
        const closeMatch = FENCE_CLOSE_RE.exec(detectLines[j] ?? '');
        if (
          closeMatch &&
          (closeMatch[2] ?? '').charAt(0) === fenceChar &&
          (closeMatch[2] ?? '').length >= marker.length
        ) {
          closed = true;
          break;
        }
        j++;
      }
      const closeLine = closed ? j : null;
      const lineTo = closed ? j : lineCount - 1;
      // 末行开围栏时内容起点不得越过 EOF（R1-C6 修复）
      const contentFrom = Math.min(lineStarts[i]! + sourceLines[i]!.length + 1, source.length);
      const contentTo = Math.max(contentFrom, closed ? lineStarts[j]! - 1 : source.length);
      const node: CodeFenceNode = {
        type: 'codeFence',
        range: { from: lineStarts[i]!, to: lineRange(lineTo).to },
        lineFrom: i,
        lineTo,
        lang: (fenceOpen[3] ?? '').trim(),
        marker,
        indent: indent.length,
        openLine: i,
        closeLine,
        closed,
        contentRange: { from: contentFrom, to: contentTo },
      };
      pushBlock(node);
      i = lineTo + 1;
      continue;
    }

    // ── 裸 JSON 块（按范围整体消费） ──
    const jsonRange = jsonRangesByStart.get(i);
    if (jsonRange) {
      const node: JsonBlockNode = {
        type: 'jsonBlock',
        range: { from: lineStarts[i]!, to: lineRange(jsonRange.endLine).to },
        lineFrom: i,
        lineTo: jsonRange.endLine,
      };
      pushBlock(node);
      i = jsonRange.endLine + 1;
      continue;
    }

    // ── Horizontal rule ──
    if (HR_RE.test(detectLine.trim())) {
      pushBlock({ type: 'horizontalRule', range: lineRange(i), lineFrom: i, lineTo: i });
      i++;
      continue;
    }

    // ── ATX Heading（不允许前导缩进） ──
    const atxMatch = ATX_RE.exec(detectLine);
    if (atxMatch) {
      const level = (atxMatch[1] ?? '#').length as 1 | 2 | 3 | 4 | 5 | 6;
      const rawText = (atxMatch[2] ?? '').replace(/\s+#+\s*$/, '').trim();
      // contentRange 用源码空间正则直接切
      let contentRange = lineRange(i);
      const srcMatch = SRC_ATX_RE.exec(sourceLines[i] ?? '');
      if (srcMatch) {
        const content = (srcMatch[4] ?? '').replace(/\s+#+\s*$/, '').trim();
        const contentStart =
          (srcMatch[1] ?? '').length + (srcMatch[2] ?? '').length + (srcMatch[3] ?? '').length;
        const leading = (srcMatch[4] ?? '').length - (srcMatch[4] ?? '').trimStart().length;
        const from = lineStarts[i]! + contentStart + leading;
        contentRange = { from, to: from + content.length };
      }
      const node: HeadingNode = {
        type: 'heading',
        range: lineRange(i),
        lineFrom: i,
        lineTo: i,
        level,
        text: rawText,
        contentRange,
        setext: false,
        id: nextHeadingId(rawText),
      };
      pushBlock(node);
      i++;
      continue;
    }

    // ── Setext Heading（lookahead 下一行 =+ 或 -+ 规则线） ──
    // 文本行必须是普通文本行：结构性行（列表/引用/表格）不做 setext 文本——
    // GFM 对齐；旧行扫描器不拦截，会把 `- foo\n- `（列表+空项）误判成 H2。
    const setextTextBlocked =
      detectListItem(detectLine) !== null ||
      detectLine.startsWith('>') ||
      isTableRowCandidate(detectLine);
    if (!setextTextBlocked && i + 1 < lineCount && SETEXT_RULE_RE.test(detectLines[i + 1] ?? '')) {
      const ruleLine = detectLines[i + 1] ?? '';
      const level = (ruleLine.trim().startsWith('=') ? 1 : 2) as 1 | 2;
      const text = detectLine.trim();
      const srcLine = sourceLines[i] ?? '';
      const leading = srcLine.length - srcLine.trimStart().length;
      const contentFrom = lineStarts[i]! + leading;
      const node: HeadingNode = {
        type: 'heading',
        range: { from: lineStarts[i]!, to: lineRange(i + 1).to },
        lineFrom: i,
        lineTo: i + 1,
        level,
        text,
        contentRange: { from: contentFrom, to: contentFrom + srcLine.trim().length },
        setext: true,
        setextRuleRange: lineRange(i + 1),
        id: nextHeadingId(text),
      };
      pushBlock(node);
      i += 2;
      continue;
    }

    // ── Blockquote（不允许缩进；连续行成组） ──
    if (detectLine.startsWith('>')) {
      const lines: BlockquoteLineInfo[] = [];
      let j = i;
      while (j < lineCount && (detectLines[j] ?? '').startsWith('>')) {
        if (j % 128 === 0) yield;
        const srcLine = sourceLines[j] ?? '';
        const detLine = detectLines[j] ?? '';
        const srcMatch = SRC_BLOCKQUOTE_RE.exec(srcLine);
        const detMatch = SRC_BLOCKQUOTE_RE.exec(detLine);
        const indentLen = srcMatch ? (srcMatch[1] ?? '').length : 0;
        const marker = srcMatch ? (srcMatch[2] ?? '') : '';
        const markerRange: SourceRange = {
          from: lineStarts[j]! + indentLen,
          to: lineStarts[j]! + indentLen + marker.length,
        };
        const contentRange: SourceRange = { from: markerRange.to, to: lineRange(j).to };
        const content = srcLine.slice(indentLen + marker.length);
        lines.push({
          lineNumber: j,
          range: lineRange(j),
          markerRange,
          contentRange,
          isEmpty: content.trim() === '',
          depth: marker.replace(/[^>＞]/g, '').length,
          normalizedMarker: detMatch ? (detMatch[2] ?? '') : marker,
        });
        j++;
      }
      const node: BlockquoteNode = {
        type: 'blockquote',
        range: { from: lineStarts[i]!, to: lineRange(j - 1).to },
        lineFrom: i,
        lineTo: j - 1,
        depth: lines.reduce((max, line) => Math.max(max, line.depth), 0),
        lines,
      };
      pushBlock(node);
      i = j;
      continue;
    }

    // ── 列表（task → ordered → unordered；连续同类行成组） ──
    const listDetect = detectListItem(detectLine);
    if (listDetect) {
      const groupFrom = i;
      let j = i;
      while (j < lineCount) {
        if (j % 128 === 0) yield;
        const itemDetect = detectListItem(detectLines[j] ?? '');
        if (!itemDetect || itemDetect.family !== listDetect.family) break;
        j++;
      }
      const groupRange: SourceRange = { from: lineStarts[groupFrom]!, to: lineRange(j - 1).to };
      for (let k = groupFrom; k < j; k++) {
        if (k % 128 === 0) yield;
        const srcLine = sourceLines[k] ?? '';
        const base = lineRange(k);
        const parsed = readMarkdownListMarker(srcLine)!;
        const { kind, marker, delimiter, number, checked } = parsed;
        const indent = parsed.indent.length;
        const markerRange = { from: base.from + indent, to: base.from + parsed.markerEnd };
        const contentRange = { from: base.from + parsed.contentStart, to: base.to };

        const node: ListItemNode = {
          type: 'listItem',
          kind,
          marker,
          ...(delimiter !== undefined ? { delimiter } : {}),
          ...(number !== undefined ? { number } : {}),
          ...(checked !== undefined ? { checked } : {}),
          indent,
          markerRange,
          contentRange,
          isEmpty: source.slice(contentRange.from, contentRange.to).trim() === '',
          itemIndex: k - groupFrom + 1,
          groupRange,
          range: base,
          lineFrom: k,
          lineTo: k,
        };
        pushBlock(node);
      }
      i = j;
      continue;
    }

    // ── 表格（组首：含 | 且 leading | 或下一行分隔；扩展为连续候选行） ──
    if (
      isTableRowCandidate(detectLine) &&
      (detectLine.trim().startsWith('|') ||
        (i + 1 < lineCount && isSeparatorDetectLine(detectLines[i + 1] ?? '')))
    ) {
      let j = i;
      while (j < lineCount && isTableRowCandidate(detectLines[j] ?? '')) {
        if (j % 128 === 0) yield;
        j++;
      }
      const rows: TableRowNode[] = [];
      let separatorIndex: number | null = null;
      for (let k = i; k < j; k++) {
        if (k % 128 === 0) yield;
        const isSeparator = isSeparatorDetectLine(detectLines[k] ?? '');
        if (isSeparator && separatorIndex === null) separatorIndex = k - i;
        rows.push({
          lineNumber: k,
          range: lineRange(k),
          cells: splitTableCellsWithRanges(sourceLines[k] ?? '', lineStarts[k]!),
          isSeparator,
          isHeader: false,
        });
      }
      const hasSeparator = separatorIndex !== null;
      const columnCount = rows.reduce(
        (max, row) => (row.isSeparator ? max : Math.max(max, row.cells.length)),
        1,
      );
      for (let r = 0; r < rows.length; r++) {
        rows[r]!.isHeader = separatorIndex === 1 && r === 0;
      }
      const alignments = hasSeparator
        ? tableAlignments(detectLines[i + separatorIndex!] ?? '', columnCount)
        : Array.from({ length: columnCount }, () => 'left' as const);
      const rowIndexByLine = new Map(rows.map((row, index) => [row.lineNumber, index]));
      const node: TableNode = {
        type: 'table',
        range: { from: lineStarts[i]!, to: lineRange(j - 1).to },
        lineFrom: i,
        lineTo: j - 1,
        rows,
        separatorIndex,
        hasSeparator,
        columnCount,
        alignments,
      };
      pushBlock(node, rowIndexByLine);
      i = j;
      continue;
    }

    // ── Paragraph（其余非空连续行聚合为一段） ──
    const paraFrom = i;
    let j = i;
    while (j < lineCount) {
      if (j % 128 === 0) yield;
      const nextDetect = detectLines[j] ?? '';
      if (nextDetect.trim() === '') break;
      if (j !== paraFrom) {
        // 后续行若可开启其它块类型（含 setext lookahead），则段落在此截断
        if (REF_DEF_RE.test(nextDetect)) break;
        if (FENCE_OPEN_RE.test(nextDetect)) break;
        if (jsonRangesByStart.has(j)) break;
        if (HR_RE.test(nextDetect.trim())) break;
        if (ATX_RE.test(nextDetect)) break;
        if (j + 1 < lineCount && SETEXT_RULE_RE.test(detectLines[j + 1] ?? '')) break;
        if (nextDetect.startsWith('>')) break;
        if (detectListItem(nextDetect)) break;
        if (
          isTableRowCandidate(nextDetect) &&
          (nextDetect.trim().startsWith('|') ||
            (j + 1 < lineCount && isSeparatorDetectLine(detectLines[j + 1] ?? '')))
        ) {
          break;
        }
      }
      j++;
    }
    const node: ParagraphNode = {
      type: 'paragraph',
      range: { from: lineStarts[paraFrom]!, to: lineRange(j - 1).to },
      lineFrom: paraFrom,
      lineTo: j - 1,
      text: source.slice(lineStarts[paraFrom]!, lineRange(j - 1).to),
    };
    pushBlock(node);
    i = j;
  }

  return { source, blocks, lineMap, frontmatter };
}

/** 按 0 基行号查所属块；越界返回 null。 */
export function blockAtLine(ast: DocumentAst, lineNumber: number): BlockNode | null {
  if (lineNumber < 0 || lineNumber >= ast.lineMap.length) return null;
  const info = ast.lineMap[lineNumber];
  if (!info) return null;
  return ast.blocks[info.blockIndex] ?? null;
}
