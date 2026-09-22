import {
  getDocumentAst,
  peekDocumentAst,
  documentAnalysisFacet,
  documentAnalysisReady,
} from './cm6-document-analysis';
import { isLargeDocument } from '@/services/document-analysis';
import type { DocumentAst, BlockNode } from '@jotluck/renderer';
/**
 * cm6-live-preview — CodeMirror 6 块级即时渲染
 *
 * 逐行渲染 Markdown：焦点行显示源码，其余行显示渲染 HTML。
 * TAB 固定当前 block 为源码模式，ESC 解除。
 *
 * 核心约束：Decoration.replace 不能跨越换行符（CM6 硬限制）。
 * 策略：所有 block 按行拆分，每行独立 Decoration.replace。
 *       多行 block 通过 CSS data-block-group 相邻选择器视觉连接。
 *       引用式链接/图片通过全文预收集 [ref]:url 定义解决。
 *
 * @see dual-view-spec.md
 */
import {
  Decoration,
  ViewPlugin,
  WidgetType,
  EditorView,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { StateField, StateEffect, type Range, type Text } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { getSearchQuery, searchPanelOpen, setSearchQuery } from '@codemirror/search';
// 表格行工具统一从 @jotluck/renderer 单点导入（本地副本已删除，唯一权威）。
// 说明：tableAlignments / isTableRowCandidate 不再需要——对齐取自 AST 节点、
// 表格结构由 parseDocument 负责（noUnusedLocals 不允许导入未用符号）。
import {
  isTableSeparatorLine,
  normalizeFullwidthMarkdownSyntax,
  parseDocument,
  renderMarkdown,
  splitTableCells,
  tableGridTemplate,
  TAG_GLOBAL_RE,
  WIKI_LINK_GLOBAL_RE,
} from '@jotluck/renderer';
import type { RendererOptions } from '@jotluck/renderer';
import DOMPurify from 'dompurify';
import { translate } from '@/i18n';
import { openExternalUrl } from '@/utils/urlUtils';

// ---- HTML 转义 ----

function escapeAttr(text: string): string {
  return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---- Reference Definitions ----

/**
 * 扫描全文收集引用式链接/图片定义。
 * 渲染每 block 时前置注入，确保 marked 能解析 [text][ref] 和 ![img][ref]。
 */
function collectRefDefs(ast: DocumentAst): Map<string, string> {
  const refs = new Map<string, string>();
  for (const block of ast.blocks) {
    if (block.type === 'refDefinition')
      refs.set(block.label.toLowerCase(), ast.source.slice(block.range.from, block.range.to));
  }
  return refs;
}

/**
 * 将引用定义注入到 block 文本前，确保跨 block 引用可解析。
 */
function renderBlock(
  raw: string,
  _type: string,
  refDefs: Map<string, string>,
  options: LivePreviewOptions,
): string {
  const renderOptions = {
    wikiLinkExists: options.wikiLinkExists,
    resolveImageSrc: options.resolveImageSrc,
    remoteImages: options.remoteImages,
  };
  if (refDefs.size === 0) return renderMarkdown(raw, renderOptions);
  const prefix = [...refDefs.values()].join('\n');
  return renderMarkdown(prefix + '\n\n' + raw, renderOptions);
}

// ---- Block Types ----

/**
 * 单行 block 类型 — 可安全使用 Decoration.replace。
 * 多行 block（codeFence/table/blockquote/list）按行拆分为多个 LiveBlock。
 */
type BlockType =
  | 'heading'
  | 'setextHeadingText'
  | 'setextHeadingRule'
  | 'jsonBlockLine'
  | 'paragraph'
  | 'codeFenceLine'
  | 'blockquoteLine'
  | 'unorderedListItem'
  | 'orderedListItem'
  | 'taskListItem'
  | 'horizontalRule'
  | 'tableRow'
  | 'frontmatterLine'
  | 'refDefinition'
  | 'empty';

interface LiveBlock {
  key: string;
  from: number;
  to: number;
  type: BlockType;
  raw: string;
  html: string;
  /** 多行 block 共享的分组键，CSS 用 [data-block-group] 连接 */
  groupKey?: string;
  /** 在多行 block 中的位置 */
  position?: 'first' | 'middle' | 'last' | 'single' | 'separator';
  /** 有序列表项在组内的序号 (1-based)，用于内联编号 */
  itemIndex?: number;
  /** 多行闭合块未找到闭合定界符（如代码围栏缺少 ```） */
  unclosed?: boolean;
  tableGridTemplate?: string;
  tableAlignments?: Array<'left' | 'center' | 'right'>;
  tableHeader?: boolean;
  tableColumnCount?: number;
  headingLevel?: 1 | 2;
  /** 结构标记源码区间（如 `- `、`> `、`---`、围栏定界行；源码 UTF-16 偏移，与 from/to 同空间） */
  markerRange?: { from: number; to: number };
}

interface LivePreviewOptions {
  onExternalLinkClick?: (href: string) => void;
  onTagClick?: (tag: string) => void;
  onWikiLinkClick?: (note: string, anchor: null | string) => void;
  wikiLinkExists?: (note: string) => boolean;
  resolveImageSrc?: RendererOptions['resolveImageSrc'];
  remoteImages?: RendererOptions['remoteImages'];
  onRemoteImageClick?: (event: MouseEvent) => boolean;
  onRemoteImageLoad?: (event: Event) => boolean;
  onRemoteImageError?: (event: Event) => boolean;
}

const SOURCE_PRESERVING_BLOCK_TYPES = new Set<BlockType>([
  'heading',
  'setextHeadingText',
  'paragraph',
  'tableRow',
  'jsonBlockLine',
]);
const SOURCE_MARK_NODE_NAMES = new Set([
  'HeaderMark',
  'EmphasisMark',
  'CodeMark',
  'LinkMark',
  'URL',
  'LinkLabel',
]);

/** 内容型块：表格管线符 / wiki-link / #tag 的行内扫描只对这些类型执行 */
const GHOST_INLINE_SCAN_BLOCK_TYPES = new Set<BlockType>([
  'paragraph',
  'heading',
  'setextHeadingText',
  'blockquoteLine',
  'unorderedListItem',
  'orderedListItem',
  'taskListItem',
  'tableRow',
]);

/** ATX 标题前缀识别（适配器自用，不引入对 renderer 内部的依赖）：
 *  捕获组 1=井号（半角 # 或全角 ＃），2=后随空白（半角空格/Tab 或全角 \u3000）。 */
const SRC_ATX_HEADING_RE = /^(\s{0,3})([＃#]{1,6})([ \t\u3000]+)/;

/** 命中点前连续反斜杠数为奇 → 该字符被转义（如 `\|`） */
function isEscaped(slice: string, index: number): boolean {
  let backslashes = 0;
  let i = index - 1;
  while (i >= 0 && slice.charAt(i) === '\\') {
    backslashes++;
    i--;
  }
  return backslashes % 2 === 1;
}

/**
 * 把 [from,to) 按行边界拆成多段（Decoration.mark 不允许跨行边界；
 * 宁可多段也要覆盖完整，对跨行 mark 节点做防御性拆分）。
 */
function splitRangeByLine(
  doc: Text,
  from: number,
  to: number,
): Array<{ from: number; to: number }> {
  const parts: Array<{ from: number; to: number }> = [];
  let pos = from;
  while (pos < to) {
    const line = doc.lineAt(pos);
    const end = Math.min(to, line.to);
    parts.push({ from: pos, to: end });
    pos = end === line.to ? end + 1 : end;
  }
  return parts;
}

/**
 * 收集切片中的成对反引号段（行内 code 的内容不是 Lezer mark 节点，
 * wiki-link / #tag 扫描前用这些区间剔除 `` `[[x]]` `` 之类的误染）。
 */
function findInlineCodeSpans(slice: string): Array<{ from: number; to: number }> {
  const spans: Array<{ from: number; to: number }> = [];
  let i = 0;
  while (i < slice.length) {
    if (slice.charAt(i) !== '`') {
      i++;
      continue;
    }
    let runEnd = i;
    while (runEnd < slice.length && slice.charAt(runEnd) === '`') runEnd++;
    const run = runEnd - i;
    const close = slice.indexOf('`'.repeat(run), runEnd);
    if (close === -1) {
      i = runEnd;
      continue;
    }
    spans.push({ from: i, to: close + run });
    i = close + run;
  }
  return spans;
}

function rangesOverlap(
  from: number,
  to: number,
  ranges: Array<{ from: number; to: number }>,
): boolean {
  return ranges.some((r) => from < r.to && to > r.from);
}

/**
 * 查找激活时的按块揭示匹配器：返回 null（无查询/面板未开/无 search 扩展）或
 * 「块文本是否命中查询」谓词。字面量走 includes（按大小写开关），正则用同一
 * 查询串构造 RegExp——不是第二套解析，语义与面板一致。已知偏差（有意）：
 * 不处理 wholeWord 与 CM6 的 NFKD 折叠——只影响「哪些块揭示」的粒度，
 * 不影响命中/替换本身的正确性。
 * searchPanelOpen 门：CM6 关面板不清查询（closeSearchPanel 只 toggle panel），
 * 不加此门则命中块会在关面板后永久停留源码态（互审 R1-E MAJOR-1）；
 * 关面板路径 closeSearchPanel → view.focus() → focusChanged 重建时
 * searchPanelOpen 已为 false → matcher 归 null → 恢复纯渲染。
 */
function buildSearchRevealMatcher(
  state: EditorView['state'],
): ((blockText: string) => boolean) | null {
  if (!searchPanelOpen(state)) return null;
  let query: ReturnType<typeof getSearchQuery>;
  try {
    query = getSearchQuery(state);
  } catch {
    return null; // 未装配 search 扩展（如单测挂载）
  }
  if (!query.search) return null;
  if (query.regexp) {
    try {
      const re = new RegExp(query.search, query.caseSensitive ? '' : 'i');
      return (blockText) => re.test(blockText);
    } catch {
      return () => true; // 非法正则：全揭示，交面板自身报错
    }
  }
  if (query.caseSensitive) {
    const needle = query.search;
    return (blockText) => blockText.includes(needle);
  }
  const lower = query.search.toLowerCase();
  return (blockText) => blockText.toLowerCase().includes(lower);
}

/** 生成稳定 block ID：行号 + 内容 hash，编辑上方内容不会改变 key */
function blockKey(lineNumber: number, raw: string): string {
  let h = 0;
  const s = raw.substring(0, 32);
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `L${lineNumber}_${Math.abs(h).toString(36)}`;
}

function groupKey(lineNumber: number): string {
  return `G${lineNumber}`;
}

// ---- Block Parser ----

/**
 * 检测内核：统一 AST（parseDocument）→ LiveBlock[] 适配层。
 *
 * 语义逐条复刻自旧逐行扫描器（WO-B6 现行语义钉死）：
 * - raw 一律取归一化行文本（normalizeFullwidthMarkdownSyntax 不增删行，行号与源码一一对应）；
 * - from/to 一律取源码 UTF-16 偏移（AST range 或行前缀和，与 AST 内部 lineStarts 同口径），
 *   顺带修复旧实现「归一变长时装饰范围漂移」缺陷；
 * - blockKey/groupKey 算法不变；装饰体系、renderBlockHtml、wrapBlockHtml、build() 零改动。
 *
 * 【明示收紧 1】代码围栏：AST 支持 ~~~ 围栏与「同字符且长度 ≥ 开围栏」闭合；
 * 旧实现仅 ``` 且等长闭合。围栏行渲染外壳（renderBlockHtml）未改动。
 * 【明示收紧 2】任务项降级判定在源码标记切片上进行；全角 － Bullet 仍判为任务
 * （旧实现先归一化再判定，归一化把行首 － 转为 -，语义一致）。
 * 【明示收紧 3】表格分隔行语义以 AST 为准（全角 － 格视为 -），与旧纯半角判定存在
 * 理论差异；hasSeparator_live 严格按钉死取 node.separatorIndex === 1。
 */
const liveLines = new WeakMap<
  DocumentAst,
  { lines: string[]; starts: number[]; refs: Map<string, string> }
>();
const tableWidths = new WeakMap<BlockNode, string>();

function documentLines(ast: DocumentAst) {
  const cached = liveLines.get(ast);
  if (cached) return cached;
  const lines = ast.source.split('\n');
  let offset = 0;
  const starts = lines.map((line) => {
    const from = offset;
    offset += line.length + 1;
    return from;
  });
  const result = { lines, starts, refs: collectRefDefs(ast) };
  liveLines.set(ast, result);
  return result;
}

function parseLiveBlocks(
  text: string,
  options: LivePreviewOptions = {},
  ast = parseDocument(text),
  firstLine = 0,
  lastLine = ast.lineMap.length - 1,
  render = true,
): LiveBlock[] {
  const { lines: sourceLines, starts: lineStarts } = documentLines(ast);
  const normalizedLine = (line: number): string =>
    normalizeFullwidthMarkdownSyntax(sourceLines[line] ?? '');
  const lineRange = (lineNumber: number) => ({
    from: lineStarts[lineNumber]!,
    to: lineStarts[lineNumber]! + sourceLines[lineNumber]!.length,
  });
  const blocks: LiveBlock[] = [];
  const nodes = ast.blocks;

  /** 把队列尾部同组块全部标记为 unclosed（组块总是连续入队） */
  const markGroupUnclosed = (group: string): void => {
    for (let k = blocks.length - 1; k >= 0; k--) {
      if (blocks[k]!.groupKey === group) blocks[k]!.unclosed = true;
      else break;
    }
  };

  for (let idx = ast.lineMap[firstLine]?.blockIndex ?? 0; idx < nodes.length; idx++) {
    const node = nodes[idx]!;
    if (node.lineFrom > lastLine) break;
    if (node.lineTo < firstLine) continue;

    // ── Frontmatter：逐行 frontmatterLine，首 first / 闭合末行 last / 其余 middle ──
    if (node.type === 'frontmatter') {
      const group = groupKey(node.lineFrom);
      for (let k = Math.max(node.lineFrom, firstLine); k <= Math.min(node.lineTo, lastLine); k++) {
        const raw = normalizedLine(k);
        const range = lineRange(k);
        const block: LiveBlock = {
          key: blockKey(k, raw),
          from: range.from,
          to: range.to,
          type: 'frontmatterLine',
          raw,
          html: '',
          groupKey: group,
          position:
            k === node.lineFrom ? 'first' : k === node.lineTo && node.closed ? 'last' : 'middle',
        };
        // 仅 `---` 定界行幽灵化；YAML 内容行保持全对比度
        if (k === node.lineFrom || (node.closed && k === node.lineTo)) {
          block.markerRange = range;
        }
        blocks.push(block);
      }
      if (!node.closed) markGroupUnclosed(group);
      continue;
    }

    // ── 引用定义 / 空行：不出块（现行：跳过） ──
    if (node.type === 'refDefinition' || node.type === 'blank') continue;

    // ── 代码围栏：逐行 codeFenceLine，位置规则同 frontmatter ──
    if (node.type === 'codeFence') {
      const group = groupKey(node.lineFrom);
      for (let k = Math.max(node.lineFrom, firstLine); k <= Math.min(node.lineTo, lastLine); k++) {
        const raw = normalizedLine(k);
        const range = lineRange(k);
        const block: LiveBlock = {
          key: blockKey(k, raw),
          from: range.from,
          to: range.to,
          type: 'codeFenceLine',
          raw,
          html: '',
          groupKey: group,
          position:
            k === node.lineFrom ? 'first' : k === node.lineTo && node.closed ? 'last' : 'middle',
        };
        // 仅围栏定界行（含语言标签）幽灵化；代码内容行保持全对比度
        if (k === node.openLine || (node.closed && k === node.closeLine)) {
          block.markerRange = range;
        }
        blocks.push(block);
      }
      if (!node.closed) markGroupUnclosed(group);
      continue;
    }

    // ── 裸 JSON 块：逐行 jsonBlockLine，1 行 single / 否则 first/middle/last ──
    if (node.type === 'jsonBlock') {
      const group = groupKey(node.lineFrom);
      const count = node.lineTo - node.lineFrom + 1;
      for (let k = Math.max(node.lineFrom, firstLine); k <= Math.min(node.lineTo, lastLine); k++) {
        const raw = normalizedLine(k);
        const range = lineRange(k);
        blocks.push({
          key: blockKey(k, raw),
          from: range.from,
          to: range.to,
          type: 'jsonBlockLine',
          raw,
          html: '',
          groupKey: group,
          position:
            count === 1
              ? 'single'
              : k === node.lineFrom
                ? 'first'
                : k === node.lineTo
                  ? 'last'
                  : 'middle',
        });
      }
      continue;
    }

    // ── 水平线：单行 horizontalRule ──
    if (node.type === 'horizontalRule') {
      const raw = normalizedLine(node.lineFrom);
      const range = lineRange(node.lineFrom);
      blocks.push({
        key: blockKey(node.lineFrom, raw),
        from: range.from,
        to: range.to,
        type: 'horizontalRule',
        raw,
        html: '',
        markerRange: range,
      });
      continue;
    }

    // ── 标题：ATX 单行 heading；setext 拆 setextHeadingText + setextHeadingRule 两块 ──
    if (node.type === 'heading') {
      if (node.setext) {
        // setext 规则线只会是 1/2 级
        const level = node.level as 1 | 2;
        const textRaw = normalizedLine(node.lineFrom);
        const textRange = lineRange(node.lineFrom);
        blocks.push({
          key: blockKey(node.lineFrom, textRaw),
          from: textRange.from,
          to: textRange.to,
          type: 'setextHeadingText',
          raw: textRaw,
          html: '',
          headingLevel: level,
        });
        const ruleRaw = normalizedLine(node.lineTo);
        const ruleRange = lineRange(node.lineTo);
        blocks.push({
          key: blockKey(node.lineTo, ruleRaw),
          from: ruleRange.from,
          to: ruleRange.to,
          type: 'setextHeadingRule',
          raw: ruleRaw,
          html: '',
          headingLevel: level,
          markerRange: ruleRange,
        });
      } else {
        const raw = normalizedLine(node.lineFrom);
        const range = lineRange(node.lineFrom);
        const block: LiveBlock = {
          key: blockKey(node.lineFrom, raw),
          from: range.from,
          to: range.to,
          type: 'heading',
          raw,
          html: '',
        };
        // ATX 标题井号前缀（含后随空白）作为 markerRange：覆盖全角 `＃` —— Lezer 不识全角井号
        const atxMatch = SRC_ATX_HEADING_RE.exec(raw);
        if (atxMatch) {
          const hashLen = (atxMatch[2] ?? '').length;
          const wsLen = (atxMatch[3] ?? '').length;
          block.markerRange = { from: range.from, to: range.from + hashLen + wsLen };
        }
        blocks.push(block);
      }
      continue;
    }

    // ── 引用块：逐行 blockquoteLine，单行 single / 否则 first/middle/last ──
    if (node.type === 'blockquote') {
      const group = groupKey(node.lineFrom);
      const count = node.lines.length;
      for (
        let k = Math.max(0, firstLine - node.lineFrom);
        k < Math.min(count, lastLine - node.lineFrom + 1);
        k++
      ) {
        const line = node.lines[k]!;
        const raw = normalizedLine(line.lineNumber);
        blocks.push({
          key: blockKey(line.lineNumber, raw),
          from: line.range.from,
          to: line.range.to,
          type: 'blockquoteLine',
          raw,
          html: '',
          groupKey: group,
          position:
            count === 1 ? 'single' : k === 0 ? 'first' : k === count - 1 ? 'last' : 'middle',
          // AST 在源码空间切出 `>`/＞ 及其后一个空白，全角标记同样被幽灵化
          markerRange: line.markerRange,
        });
      }
      continue;
    }

    // ── 列表：连续同 family 行成组，逐行展开 ──
    if (node.type === 'listItem' && !render) {
      const raw = normalizedLine(node.lineFrom);
      const markerSlice = ast.source.slice(node.markerRange.from, node.markerRange.to);
      const type: BlockType =
        node.kind === 'ordered'
          ? node.delimiter === ')'
            ? 'paragraph'
            : 'orderedListItem'
          : node.kind === 'task' && /^[-－] \[[ x]\]$/.test(markerSlice)
            ? 'taskListItem'
            : 'unorderedListItem';
      blocks.push({
        key: blockKey(node.lineFrom, raw),
        from: node.range.from,
        to: node.range.to,
        raw,
        html: '',
        type,
        markerRange: node.markerRange,
        itemIndex: node.itemIndex,
        groupKey: `G${node.groupRange.from}`,
        position:
          node.range.from === node.groupRange.from
            ? node.range.to === node.groupRange.to
              ? 'single'
              : 'first'
            : node.range.to === node.groupRange.to
              ? 'last'
              : 'middle',
      });
      continue;
    }
    if (node.type === 'listItem') {
      const family = node.kind === 'ordered' ? 'ordered' : 'unordered';
      let end = idx + 1;
      while (end < nodes.length) {
        const next = nodes[end]!;
        if (next.type !== 'listItem') break;
        if ((next.kind === 'ordered' ? 'ordered' : 'unordered') !== family) break;
        end++;
      }
      // 降级为 paragraph 的行会把组截断为「段」；段为最终组，
      // 有序序号在段内 1 基重排（复刻旧逐行扫描：')' 行不属于有序组）。
      let run: LiveBlock[] = [];
      let runGroup = '';
      let itemIndex = 0;
      const flushRun = (): void => {
        if (run.length === 0) return;
        if (run.length === 1) run[0]!.position = 'single';
        else {
          run[0]!.position = 'first';
          run[run.length - 1]!.position = 'last';
          for (let gi = 1; gi < run.length - 1; gi++) run[gi]!.position = 'middle';
        }
        run = [];
      };
      for (let k = idx; k < end; k++) {
        const item = nodes[k];
        if (!item || item.type !== 'listItem') continue; // 理论不可达，守卫用
        const raw = normalizedLine(item.lineFrom);
        const range = item.range; // 列表项恒为单行节点
        // 现行奇偶：旧有序列表正则只认 '.' 定界，')' 行降级为 paragraph
        if (family === 'ordered' && item.delimiter === ')') {
          flushRun();
          blocks.push({
            key: blockKey(item.lineFrom, raw),
            from: range.from,
            to: range.to,
            type: 'paragraph',
            raw,
            html: '',
          });
          continue;
        }
        if (run.length === 0) {
          runGroup = groupKey(item.lineFrom);
          itemIndex = 0;
        }
        itemIndex++;
        let blockType: BlockType = 'unorderedListItem';
        if (family === 'ordered') {
          blockType = 'orderedListItem';
        } else if (item.kind === 'task') {
          // 现行奇偶：仅「- [ ] / - [x]」（dash Bullet + 小写 x/空格）为任务项；
          // 其余 task（[X] 或 * / + Bullet）降级为无序项。全角 － 与旧归一化行为一致仍判任务。
          const markerSlice = ast.source.slice(item.markerRange.from, item.markerRange.to);
          if (/^[-－] \[[ x]\]$/.test(markerSlice)) blockType = 'taskListItem';
        }
        const liveBlock: LiveBlock = {
          key: blockKey(item.lineFrom, raw),
          from: range.from,
          to: range.to,
          type: blockType,
          raw,
          html: '',
          groupKey: runGroup,
          // AST markerRange 源码空间切分：无序为 bullet、有序为 `1.`，
          // 任务含 `[ ]`/`[x]`（全角 bullet 同样被幽灵化）
          markerRange: item.markerRange,
        };
        if (family === 'ordered') liveBlock.itemIndex = itemIndex;
        run.push(liveBlock);
        blocks.push(liveBlock);
      }
      flushRun();
      idx = end - 1;
      continue;
    }

    // ── 表格：逐行 tableRow ──
    if (node.type === 'table') {
      const group = groupKey(node.lineFrom);
      // 钉死：hasSeparator_live 仅当首个分隔行恰在第 1 行（表头行之下）
      const hasSeparator = node.separatorIndex === 1;
      const columnCount = node.columnCount;
      let gridTemplate = tableWidths.get(node);
      if (!gridTemplate) {
        // All rows influence width; this is computed once per table snapshot.
        gridTemplate = tableGridTemplate(
          node.rows.filter((row) => !row.isSeparator).map((row) => normalizedLine(row.lineNumber)),
          columnCount,
        );
        tableWidths.set(node, gridTemplate);
      }
      const alignments = hasSeparator
        ? node.alignments
        : Array.from({ length: columnCount }, () => 'left' as const);
      for (let ri = Math.max(0, firstLine - node.lineFrom); ri < node.rows.length; ri++) {
        const row = node.rows[ri]!;
        if (row.lineNumber > lastLine) break;
        const raw = normalizedLine(row.lineNumber);
        blocks.push({
          key: blockKey(row.lineNumber, raw),
          from: row.range.from,
          to: row.range.to,
          type: 'tableRow',
          raw,
          html: '',
          groupKey: group,
          position:
            node.rows.length === 1
              ? 'single'
              : ri === 0
                ? 'first'
                : hasSeparator && ri === 1
                  ? 'separator'
                  : ri === node.rows.length - 1
                    ? 'last'
                    : 'middle',
          tableColumnCount: columnCount,
          tableGridTemplate: gridTemplate,
          tableAlignments: alignments,
          tableHeader: hasSeparator && ri === 0,
        });
      }
      // 缺少分隔行 → 全组 unclosed（现行）
      if (!hasSeparator) markGroupUnclosed(group);
      continue;
    }

    // ── 段落：AST 多行聚合，适配器按行展开为逐行 paragraph（现行语义） ──
    if (node.type === 'paragraph') {
      for (let k = Math.max(node.lineFrom, firstLine); k <= Math.min(node.lineTo, lastLine); k++) {
        const raw = normalizedLine(k);
        const range = lineRange(k);
        blocks.push({
          key: blockKey(k, raw),
          from: range.from,
          to: range.to,
          type: 'paragraph',
          raw,
          html: '',
        });
      }
      continue;
    }
  }

  // Compute HTML for each block
  if (render)
    for (const block of blocks) {
      block.html = renderBlockHtml(block, documentLines(ast).refs, options);
    }

  return blocks;
}

export function __parseLiveBlocksForTest(text: string): Array<{
  type: string;
  raw: string;
  html: string;
  position?: string;
  tableGridTemplate?: string;
  tableColumnCount?: number;
  tableHeader?: boolean;
  unclosed?: boolean;
  headingLevel?: 1 | 2;
  markerRange?: { from: number; to: number };
}> {
  return parseLiveBlocks(text).map((block) => ({
    type: block.type,
    raw: block.raw,
    html: block.html,
    position: block.position,
    tableGridTemplate: block.tableGridTemplate,
    tableColumnCount: block.tableColumnCount,
    tableHeader: block.tableHeader,
    unclosed: block.unclosed,
    headingLevel: block.headingLevel,
    markerRange: block.markerRange,
  }));
}

function renderBlockHtml(
  block: LiveBlock,
  refDefs: Map<string, string>,
  options: LivePreviewOptions,
): string {
  try {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
        return wrapBlockHtml(renderBlock(block.raw, block.type, refDefs, options), block);

      case 'unorderedListItem':
      case 'taskListItem': {
        // Strip outer <ul> wrapper — each item is independently rendered,
        // CSS ::before pseudo-elements + adjacent selectors connect them visually.
        const raw = renderBlock(block.raw, block.type, refDefs, options);
        const checked = /^\s*[-*+]\s+\[[xX]\]\s/.test(block.raw);
        const toggleLabel = checked
          ? translate('program.taskIncomplete')
          : translate('program.taskComplete');
        const toggle = `<input type="checkbox" class="cm-task-toggle" aria-label="${escapeAttr(toggleLabel)}" ${checked ? 'checked ' : ''}/>`;
        const inner = raw
          .replace(/<\/?ul>\n?/g, '')
          .replace(/<\/?li>/g, '')
          .replace(/<input[^>]*>/i, '')
          .trim();
        const marker =
          block.type === 'taskListItem'
            ? toggle
            : '<span class="cm-list-marker" aria-hidden="true">•</span>';
        return wrapBlockHtml(
          `<span class="cm-list-marker-slot">${marker}</span><span class="cm-list-content">${inner || '&nbsp;'}</span>`,
          block,
        );
      }

      case 'orderedListItem': {
        // Inline numbering: strip <ol> + <li> wrappers, prepend itemIndex.
        // Marked produces <ol><li>content</li></ol>, we want "N. content".
        const raw = renderBlock(block.raw, 'paragraph', refDefs, options);
        const text = raw
          .replace(/<\/?ol>\n?/g, '')
          .replace(/<\/?li>/g, '')
          .replace(/^<p>/, '')
          .replace(/<\/p>\n?$/, '');
        const num = block.itemIndex ?? 1;
        return wrapBlockHtml(
          `<span class="cm-list-marker-slot"><span class="cm-list-marker">${num}.</span></span><span class="cm-list-content">${text || '&nbsp;'}</span>`,
          block,
        );
      }

      case 'horizontalRule':
        return wrapBlockHtml('<hr>', block);

      case 'codeFenceLine': {
        const fenceTest = /^\s{0,3}`{3,}/.test(block.raw);
        if (fenceTest && block.position !== 'first') {
          // Closing fence — show it styled as empty
          return wrapBlockHtml('', block);
        }
        if (fenceTest) {
          // Opening fence — show language label if present
          const lang = block.raw
            .trim()
            .replace(/^`{3,}/, '')
            .trim();
          return wrapBlockHtml(
            lang ? `<span class="cm-code-lang">${escapeAttr(lang)}</span>` : '',
            block,
          );
        }
        // Code content line — HTML-escape to prevent rendering
        const escaped = block.raw
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        return wrapBlockHtml(escaped, block);
      }

      case 'blockquoteLine': {
        // Strip outer <blockquote> — each line independently rendered,
        // CSS border-left connects them visually.
        const content = block.raw.replace(/^>\s?/, '');
        const raw = renderBlock(content, 'paragraph', refDefs, options);
        const inner = raw
          .replace(/<\/?blockquote>\n?/g, '')
          .replace(/^<p>/, '')
          .replace(/<\/p>\n?$/, '');
        return wrapBlockHtml(inner, block);
      }

      case 'setextHeadingText': {
        const level = block.headingLevel ?? 2;
        const html = renderBlock(`${'#'.repeat(level)} ${block.raw}`, 'heading', refDefs, options);
        return wrapBlockHtml(html, block);
      }

      case 'setextHeadingRule':
        // 规则线无 widget HTML：早退前已给聚焦旁路，非聚焦态留空字符串
        return '';

      case 'tableRow': {
        // Render each table row as a grid with a table-group-level column
        // template. CM6 cannot replace a multi-line table as one widget, so
        // this keeps per-line widgets while preserving stable columns.
        const isSeparator = isTableSeparatorLine(block.raw);
        if (isSeparator) {
          return wrapBlockHtml('', block);
        }
        const columnCount = block.tableColumnCount ?? splitTableCells(block.raw).length;
        const cells = splitTableCells(block.raw);
        const alignments = block.tableAlignments ?? [];
        const cellHtml = Array.from({ length: columnCount }, (_, index) => cells[index] ?? '')
          .map((cell, index) => {
            const trimmed = cell.trim();
            const rendered = renderBlock(trimmed, 'paragraph', refDefs, options)
              .replace(/^<p>/, '')
              .replace(/<\/p>\n?$/, '');
            const align = alignments[index] ?? 'left';
            const role = block.tableHeader ? 'columnheader' : 'cell';
            return `<span class="ml-table-cell ml-table-cell--align-${align}${block.tableHeader ? ' ml-table-cell--header' : ''}" role="${role}">${rendered || '&nbsp;'}</span>`;
          })
          .join('');
        return wrapBlockHtml(cellHtml, block);
      }

      case 'jsonBlockLine': {
        const escaped = block.raw
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/ /g, '&nbsp;')
          .replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;');
        return wrapBlockHtml(`<code class="cm-json-line">${escaped}</code>`, block);
      }

      case 'frontmatterLine':
        // Dim the frontmatter lines
        return wrapBlockHtml(
          `<span style="opacity:0.5">${block.raw.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>`,
          block,
        );

      default:
        return wrapBlockHtml(block.raw, block);
    }
  } catch {
    return wrapBlockHtml(block.raw, block);
  }
}

/**
 * 包裹渲染 HTML，添加 data 属性供 CSS 选择器使用。
 */
function wrapBlockHtml(html: string, block: LiveBlock): string {
  const attrs: string[] = [
    `data-block-key="${escapeAttr(block.key)}"`,
    `data-block-from="${block.from}"`,
    `data-block-type="${escapeAttr(block.type)}"`,
  ];
  if (block.groupKey) attrs.push(`data-block-group="${escapeAttr(block.groupKey)}"`);
  if (block.position) attrs.push(`data-block-position="${escapeAttr(block.position)}"`);
  if (block.tableColumnCount) {
    attrs.push(`data-table-column-count="${block.tableColumnCount}"`);
  }
  if (block.tableGridTemplate) {
    attrs.push(`style="--ml-table-template:${escapeAttr(block.tableGridTemplate)}"`);
  }

  return `<span class="cm-live-block" ${attrs.join(' ')}>${html}</span>`;
}

// ---- Widgets ----

/**
 * 渲染块 Widget：将安全 HTML 插入 CM6 editor DOM。
 * XSS 防护：通过 DOMPurify.sanitize + RETURN_DOM_FRAGMENT 创建 DOM。
 */
class RenderedBlockWidget extends WidgetType {
  private html: string;
  private key: string;

  constructor(html: string, key: string) {
    super();
    this.html = html;
    this.key = key;
  }

  override eq(other: RenderedBlockWidget): boolean {
    return this.html === other.html && this.key === other.key;
  }

  toDOM(): HTMLElement {
    const frag = DOMPurify.sanitize(this.html, { RETURN_DOM_FRAGMENT: true }) as DocumentFragment;
    // If sanitization produced a fragment, wrap it; otherwise return the existing span
    if (frag.childNodes.length === 1) {
      const child = frag.firstChild as HTMLElement;
      if (child.classList?.contains('cm-live-block')) {
        child.tabIndex = -1;
        this.attachTaskToggleBridge(child);
        return child;
      }
    }
    const span = document.createElement('span');
    span.className = 'cm-live-block';
    span.tabIndex = -1;
    span.setAttribute('data-block-key', this.key);
    // Get attributes from the HTML string (parse them)
    const m = /<span class="cm-live-block"([^>]*)>/.exec(this.html);
    if (m?.[1]) {
      const attrStr = m[1];
      // Copy data attributes
      for (const attr of [
        'data-block-from',
        'data-block-type',
        'data-block-group',
        'data-block-position',
      ]) {
        const am = new RegExp(`${attr}="([^"]*)"`).exec(attrStr);
        if (am?.[1]) span.setAttribute(attr, am[1]);
      }
    }
    span.appendChild(frag);
    this.attachTaskToggleBridge(span);
    return span;
  }

  private attachTaskToggleBridge(block: HTMLElement): void {
    if (block.getAttribute('data-block-type') !== 'taskListItem') return;
    const preventEditorFocus = (event: Event) => {
      const target = event.target as HTMLElement;
      if (!target.closest('input[type="checkbox"], .cm-task-toggle')) return;
      event.preventDefault();
      event.stopPropagation();
    };
    block.addEventListener('mousedown', preventEditorFocus);
    block.addEventListener('click', preventEditorFocus);
  }

  /** 允许点击穿透 → CM6 将光标移到此处 → 源码切换 */
  override ignoreEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null;
    if (
      target?.closest(
        'input[type="checkbox"], .cm-task-toggle, a, [data-remote-image-action], .remote-image',
      )
    )
      return true;
    return false;
  }
}

/**
 * 未闭合多行格式提醒 Widget：当代码围栏或 frontmatter 缺少闭合定界符时
 * 在 block 末尾显示持久提示，避免用户困惑"为什么没有渲染"。
 */
class UnclosedBlockWidget extends WidgetType {
  private label: string;

  constructor(label: string) {
    super();
    this.label = label;
  }

  override eq(other: UnclosedBlockWidget): boolean {
    return this.label === other.label;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-live-unclosed-hint';
    span.setAttribute('aria-label', this.label);
    span.textContent = this.label;
    return span;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

// ---- Pin State (block-key based, survives edits) ----

const pinSourceEffect = StateEffect.define<{ key: string }>();
const unpinSourceEffect = StateEffect.define<{ key: string }>();
const revealSourceAtPositionEffect = StateEffect.define<number>();

const pendingRestoredBlockFocusCleanup = new WeakMap<EditorView, () => void>();

const pinnedSourceField = StateField.define<Set<string>>({
  create() {
    return new Set();
  },
  update(set, tr) {
    const result = new Set(set);
    for (const e of tr.effects) {
      if (e.is(pinSourceEffect)) result.add(e.value.key);
      else if (e.is(unpinSourceEffect)) result.delete(e.value.key);
    }
    return result;
  },
});

// ---- ViewPlugin ----

function toggleTaskListItemAtWidget(view: EditorView, widget: Element): boolean {
  const docText = view.state.doc.toString();
  const blockFrom = view.posAtDOM(widget);
  const blockKey = widget.getAttribute('data-block-key');
  const block = blockKey
    ? parseLiveBlocks(
        docText,
        {},
        getDocumentAst(view.state),
        view.state.doc.lineAt(
          Number.isFinite(blockFrom) ? blockFrom : view.state.selection.main.head,
        ).number - 1,
        view.state.doc.lineAt(
          Number.isFinite(blockFrom) ? blockFrom : view.state.selection.main.head,
        ).number - 1,
        false,
      ).find((candidate) => candidate.key === blockKey)
    : null;
  const line = Number.isFinite(blockFrom)
    ? view.state.doc.lineAt(blockFrom)
    : block
      ? view.state.doc.lineAt(block.from)
      : view.state.doc.lineAt(view.posAtDOM(widget));
  const lineText = line.text;
  const uncheckedRe = /^(\s*[-*+]\s+)\[ \]\s?/;
  const checkedRe = /^(\s*[-*+]\s+)\[x\]\s?/;

  let newText = lineText;
  if (uncheckedRe.test(lineText)) {
    newText = lineText.replace(uncheckedRe, '$1[x] ');
  } else if (checkedRe.test(lineText)) {
    newText = lineText.replace(checkedRe, '$1[ ] ');
  }

  if (newText === lineText) return false;
  view.dispatch({ changes: { from: line.from, to: line.to, insert: newText } });
  return true;
}

function handleLiveAnchorClick(anchor: HTMLAnchorElement, options: LivePreviewOptions): boolean {
  const tag = anchor.getAttribute('data-tag');
  if (tag) {
    options.onTagClick?.(tag);
    return true;
  }

  const note = anchor.getAttribute('data-note');
  if (note) {
    options.onWikiLinkClick?.(note, anchor.getAttribute('data-anchor'));
    return true;
  }

  const href = anchor.getAttribute('href');
  if (href) {
    if (options.onExternalLinkClick) {
      options.onExternalLinkClick(href);
    } else {
      void openExternalUrl(href);
    }
    return true;
  }

  return false;
}

function createLivePreviewPlugin(options: LivePreviewOptions = {}) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      renderFrame: number | null = null;
      renderCache = new Map<string, string>();
      renderBytes = 0;
      lastAst: DocumentAst | null = null;
      currentBlocks: LiveBlock[] = [];
      renderMore(view: EditorView): void {
        if (this.renderFrame !== null) return;
        this.renderFrame = requestAnimationFrame(() => {
          this.renderFrame = null;
          if (!this.destroyed) view.dispatch({ effects: documentAnalysisReady.of() });
        });
      }

      /** True while an IME composition is in progress — skip decoration rebuilds */
      isComposing = false;
      /** Set to true in destroy() — prevents rAF callbacks on destroyed views */
      destroyed = false;
      editorView: EditorView | null = null;
      // Stored listener refs for cleanup
      onClick: ((e: MouseEvent) => void) | null = null;
      onRemoteImageLoad: ((e: Event) => void) | null = null;
      onRemoteImageError: ((e: Event) => void) | null = null;
      onPointerDownCapture: ((e: PointerEvent) => void) | null = null;
      onChangeCapture: ((e: Event) => void) | null = null;
      onKeydown: ((e: KeyboardEvent) => void) | null = null;
      onCompStart: (() => void) | null = null;
      onCompEnd: (() => void) | null = null;
      compositionRebuildTimer: ReturnType<typeof setTimeout> | null = null;
      compositionRebuildFrame: number | null = null;
      // rAF handle for deferred initialization
      __initRAF: number | null = null;
      // Guarantees decorations are built on the first update() call, even
      // if the rAF callback's empty dispatch was optimised away by CM6.
      decorationsBuilt = false;

      constructor(view: EditorView) {
        this.editorView = view;
        // Delay to next frame so EditorView is fully initialized before building decorations
        this.decorations = Decoration.none;
        const rAFId = requestAnimationFrame(() => {
          if (this.destroyed || this.isImeActive(view)) return;
          this.decorations = this.build(view);
          this.decorationsBuilt = true;
          view.dispatch({});
        });
        this.__initRAF = rAFId;

        // ── IME composition guard ──────────────────────────────
        // During IME composition, CM6 fires docChanged on every
        // intermediate compositionupdate. We MUST NOT rebuild
        // decorations during this window — Decoration.replace
        // corrupts the IME preview (duplicate lines, cursor jumps,
        // swallowed characters).
        //
        // KEY: Do NOT clear decorations on compositionstart.
        // Clearing causes ALL rendered blocks to flash back to raw
        // source, which is visually jarring. Instead, just pause
        // rebuilds — existing decorations stay in place.
        const onCompStart = () => {
          this.isComposing = true;
          this.clearPendingCompositionRebuild();
        };
        const onCompEnd = () => {
          this.isComposing = false;
          if (this.destroyed) return;
          this.scheduleCompositionRebuild(view);
        };
        this.onCompStart = onCompStart;
        this.onCompEnd = onCompEnd;
        view.contentDOM.addEventListener('compositionstart', onCompStart, { passive: true });
        view.contentDOM.addEventListener('compositionend', onCompEnd, { passive: true });

        // Click handler — map rendered widget clicks back to source positions.
        // Relying on CM6's default DOM mapping for replaced widgets can move the
        // cursor to a wrong line, which is especially disruptive for IME input.
        const onClick = (e: MouseEvent) => {
          const target = e.target as HTMLElement;
          if (target.closest('[data-remote-image-action]') && options.onRemoteImageClick?.(e)) {
            return;
          }
          const checkbox = target.closest('input[type="checkbox"], .cm-task-toggle');
          if (checkbox) {
            const widget = checkbox.closest('.cm-live-block[data-block-type="taskListItem"]');
            if (!widget) return;
            e.stopPropagation();
            e.preventDefault();
            view.focus();
            return;
          }

          const anchor = target.closest('a') as HTMLAnchorElement | null;
          if (anchor && handleLiveAnchorClick(anchor, options)) {
            e.stopPropagation();
            e.preventDefault();
            return;
          }

          const widget = target.closest('.cm-live-block') as HTMLElement | null;
          if (!widget) return;
          const block = this.findBlockForWidget(view, widget);
          if (!block) return;

          e.stopPropagation();
          e.preventDefault();

          if (!e.ctrlKey && !e.metaKey) {
            view.dispatch({ selection: { anchor: block.from }, scrollIntoView: true });
            view.focus();
            return;
          }

          const pinned = view.state.field(pinnedSourceField, false) ?? new Set<string>();
          const isPinned = pinned.has(block.key);

          view.dispatch({
            effects: isPinned
              ? unpinSourceEffect.of({ key: block.key })
              : pinSourceEffect.of({ key: block.key }),
            selection: { anchor: block.from },
            scrollIntoView: true,
          });
          view.focus();
        };
        this.onClick = onClick;
        view.dom.addEventListener('click', onClick);
        const onRemoteImageLoad = (event: Event) => {
          options.onRemoteImageLoad?.(event);
        };
        const onRemoteImageError = (event: Event) => {
          options.onRemoteImageError?.(event);
        };
        this.onRemoteImageLoad = onRemoteImageLoad;
        this.onRemoteImageError = onRemoteImageError;
        view.dom.addEventListener('load', onRemoteImageLoad, true);
        view.dom.addEventListener('error', onRemoteImageError, true);

        // A block restored by Escape owns focus without exposing the hidden
        // source selection. Enter explicitly maps it back to its source range.
        const onKeydown = (e: KeyboardEvent) => {
          if (e.key !== 'Enter') return;
          const target = e.target as HTMLElement;

          if (target.closest('[data-remote-image-action]')) {
            e.stopPropagation();
            return;
          }
          if (target.closest('a, button, input, select, textarea')) return;
          const widget = target.closest('.cm-live-block') as HTMLElement | null;
          if (!widget) return;
          const block = this.findBlockForWidget(view, widget);
          if (!block) return;

          e.preventDefault();
          e.stopPropagation();
          view.dispatch({ selection: { anchor: block.from } });
          view.focus();
        };
        this.onKeydown = onKeydown;
        view.dom.addEventListener('keydown', onKeydown, true);

        // ── Pointer-down capture: intercept checkbox/link clicks BEFORE CM6 ─
        // CM6's internal mousedown handler fires during the bubbling phase and
        // dispatches a selection change that moves the cursor to the widget's
        // position. This triggers update() → the block becomes focused → the
        // widget is replaced with source text → by the time 'click' fires, the
        // <a> and <input> have been removed from the DOM.
        //
        // By listening on pointerdown in the CAPTURE phase, we run BEFORE CM6
        // and can prevent the cursor move for checkbox/link interactions.
        const onPointerDownCapture = (e: PointerEvent) => {
          if (this.destroyed) return;
          const target = e.target as HTMLElement;

          if (target.closest('[data-remote-image-action]')) {
            e.stopPropagation();
            return;
          }

          // Block CM6 from moving the cursor before the checkbox can mutate source.
          const checkbox = target.closest('input[type="checkbox"], .cm-task-toggle');
          if (checkbox) {
            const widget = checkbox.closest('.cm-live-block[data-block-type="taskListItem"]');
            if (!widget) return;
            e.stopPropagation();
            e.preventDefault();
            toggleTaskListItemAtWidget(view, widget);
            view.focus();
            return;
          }

          // Block CM6 from handling clicks on links (Wiki-link, #tag, external)
          const anchor = target.closest('a') as HTMLAnchorElement | null;
          if (anchor) {
            const hasTag = anchor.getAttribute('data-tag');
            const hasNote = anchor.getAttribute('data-note');
            const hasHref = anchor.getAttribute('href');
            if (hasTag || hasNote || hasHref) {
              e.stopPropagation();
              e.preventDefault();
              return;
            }
          }
        };
        this.onPointerDownCapture = onPointerDownCapture;
        view.dom.addEventListener('pointerdown', onPointerDownCapture, true);

        const onChangeCapture = (e: Event) => {
          if (this.destroyed) return;
          const target = e.target as HTMLElement;
          const checkbox = target.closest('input[type="checkbox"], .cm-task-toggle');
          if (!checkbox) return;
          const widget = checkbox.closest('.cm-live-block[data-block-type="taskListItem"]');
          if (!widget) return;
          e.stopPropagation();
          e.preventDefault();
          toggleTaskListItemAtWidget(view, widget);
          view.focus();
        };
        this.onChangeCapture = onChangeCapture;
        view.dom.addEventListener('change', onChangeCapture, true);
      }

      update(update: ViewUpdate) {
        let revealedPosition: number | null = null;
        for (const transaction of update.transactions) {
          for (const effect of transaction.effects) {
            if (effect.is(revealSourceAtPositionEffect)) revealedPosition = effect.value;
          }
        }
        // 查询变化（面板输入/清除/关闭）也要重建：按块揭示随查询实时增减
        const searchQueryChanged = update.transactions.some((tr) =>
          tr.effects.some((e) => e.is(setSearchQuery)),
        );
        const hasComposeTransaction = update.transactions.some((tr) =>
          tr.isUserEvent('input.type.compose'),
        );
        if (
          this.isComposing &&
          update.docChanged &&
          !update.view.composing &&
          !update.view.compositionStarted &&
          !hasComposeTransaction
        ) {
          this.isComposing = false;
        }

        // Skip decoration rebuild during IME composition to avoid corrupting
        // the composition preview (duplicate lines, cursor jumps, swallowed chars).
        // Two-layer detection: DOM compositionstart flag + CM6 transaction annotation.
        // IME guard: pause rebuilds during composition, but keep existing
        // decorations — clearing them removes all rendered blocks (BUG-036).
        if (this.isImeActive(update.view, update)) {
          // Keep existing widgets aligned with the changing document while IME
          // owns the DOM. Leaving an old DecorationSet unmapped makes replace
          // widgets reappear on unrelated lower lines after Backspace/commit.
          if (update.docChanged) {
            this.decorations = this.decorations.map(update.changes);
            this.scheduleCompositionRebuild(update.view);
          } else {
            this.clearPendingCompositionRebuild();
          }
          return;
        }

        // compositionend schedules a delayed rebuild. Any edits arriving in
        // that settling window (notably Backspace) must map the existing set and
        // push the rebuild back, rather than rebuilding twice around one input.
        if (this.compositionRebuildTimer) {
          if (update.docChanged) {
            this.decorations = this.decorations.map(update.changes);
          }
          this.scheduleCompositionRebuild(update.view);
          return;
        }

        if (update.docChanged) {
          this.decorations = this.decorations.map(update.changes);
          this.currentBlocks = this.currentBlocks.map((block) => ({
            ...block,
            from: update.changes.mapPos(block.from, 1),
            to: update.changes.mapPos(block.to, -1),
          }));
        }
        if (
          update.docChanged ||
          update.selectionSet ||
          update.focusChanged ||
          update.viewportChanged ||
          revealedPosition !== null ||
          searchQueryChanged ||
          update.transactions.some((tr) => tr.effects.some((e) => e.is(documentAnalysisReady))) ||
          !this.decorationsBuilt
        ) {
          this.decorations = this.build(update.view, revealedPosition);
          this.decorationsBuilt = true;
        }
      }

      isImeActive(view: EditorView, update?: ViewUpdate): boolean {
        return (
          this.isComposing ||
          view.composing ||
          view.compositionStarted ||
          !!update?.transactions.some((tr) => tr.isUserEvent('input.type.compose'))
        );
      }

      findBlockForWidget(_view: EditorView, widget: HTMLElement): LiveBlock | null {
        const blockKey = widget.getAttribute('data-block-key');
        if (!blockKey) return null;
        return this.currentBlocks.find((block) => block.key === blockKey) ?? null;
      }

      clearPendingCompositionRebuild(): void {
        if (this.compositionRebuildTimer) {
          clearTimeout(this.compositionRebuildTimer);
          this.compositionRebuildTimer = null;
        }
        if (this.compositionRebuildFrame !== null) {
          cancelAnimationFrame(this.compositionRebuildFrame);
          this.compositionRebuildFrame = null;
        }
      }

      scheduleCompositionRebuild(view: EditorView): void {
        this.clearPendingCompositionRebuild();
        this.compositionRebuildTimer = setTimeout(() => {
          this.compositionRebuildTimer = null;
          this.compositionRebuildFrame = requestAnimationFrame(() => {
            this.compositionRebuildFrame = null;
            if (this.destroyed) return;
            if (this.isComposing || view.composing || view.compositionStarted) {
              this.scheduleCompositionRebuild(view);
              return;
            }
            this.decorations = this.build(view);
            this.decorationsBuilt = true;
            view.dispatch({});
          });
        }, 0);
      }

      build(view: EditorView, revealedPosition: number | null = null): DecorationSet {
        const ast = view.state.facet(documentAnalysisFacet)
          ? peekDocumentAst(view.state)
          : getDocumentAst(view.state);
        if (!ast) {
          // Existing, mapped widgets stay visible. No stale result may edit the source.
          return this.decorations;
        }
        if (ast !== this.lastAst) {
          const oldRefs = this.lastAst ? [...documentLines(this.lastAst).refs] : [];
          if (JSON.stringify(oldRefs) !== JSON.stringify([...documentLines(ast).refs])) {
            this.renderCache.clear();
            this.renderBytes = 0;
          }
          this.lastAst = ast;
        }
        const large = isLargeDocument(ast.source, view.state.doc.lines);
        const first = large
          ? Math.max(0, view.state.doc.lineAt(view.viewport.from).number - 1 - 60)
          : 0;
        const last = large
          ? Math.min(
              view.state.doc.lines - 1,
              view.state.doc.lineAt(view.viewport.to).number - 1 + 60,
            )
          : view.state.doc.lines - 1;
        const blocks = parseLiveBlocks(ast.source, options, ast, first, last, false);
        const cursor = view.state.selection.main.head;
        this.currentBlocks = blocks;
        const deadline = performance.now() + 8;
        const cursorLine = view.state.doc.lineAt(cursor);
        const pinned = view.state.field(pinnedSourceField, false) ?? new Set<string>();
        const searchMatcher = buildSearchRevealMatcher(view.state);
        const decos: Range<Decoration>[] = [];
        const unclosedWarnings = new Map<string, { end: number; type: BlockType }>();

        for (const block of blocks) {
          // Track unclosed groups for warning decoration
          if (block.unclosed && block.groupKey) {
            const existing = unclosedWarnings.get(block.groupKey);
            if (!existing || block.to > existing.end) {
              unclosedWarnings.set(block.groupKey, { end: block.to, type: block.type });
            }
          }

          // Very long source lines stay native so CM6 can virtualize horizontal content.
          if (block.raw.length > 16_384) continue;
          const cacheKey = JSON.stringify([
            block.key,
            block.raw,
            block.type,
            block.from,
            block.to,
            block.position,
            block.itemIndex,
            block.tableGridTemplate,
            block.tableAlignments,
          ]);
          const cached = this.renderCache.get(cacheKey);
          if (cached !== undefined) {
            block.html = cached;
            this.renderCache.delete(cacheKey);
            this.renderCache.set(cacheKey, cached);
          } else if (large && performance.now() >= deadline) {
            this.renderMore(view);
            continue;
          } else {
            block.html = renderBlockHtml(block, documentLines(ast).refs, options);
            const cost = (cacheKey.length + block.html.length) * 2;
            if (cost <= 24 * 1024 * 1024) {
              while (this.renderBytes + cost > 24 * 1024 * 1024 && this.renderCache.size) {
                const oldest = this.renderCache.keys().next().value!;
                this.renderBytes -= (oldest.length + this.renderCache.get(oldest)!.length) * 2;
                this.renderCache.delete(oldest);
              }
              this.renderCache.set(cacheKey, block.html);
              this.renderBytes += cost;
            }
          }
          if (!block.html) {
            // 唯一例外：setext 规则线虽无 widget HTML，但聚焦态应显示规则线源码（markerRange 整行幽灵化）。
            // 早退前给 setext 标题的两块一道旁路：setextHeadingText 聚焦时显示文字本身
            // （全视图 HighlightStyle 已给字重/字号），setextHeadingRule 聚焦时
            // 由 markerRange 幽灵化规则线。其他 html='' 块（如 YAML 内容行）仍跳过。
            if (block.type !== 'setextHeadingRule' && block.type !== 'setextHeadingText') {
              continue;
            }
          }

          const containsCursor = cursor >= block.from && cursor <= block.to;
          const isProgrammaticallyRevealed =
            revealedPosition !== null &&
            revealedPosition >= block.from &&
            revealedPosition <= block.to;
          const isFocused = (view.hasFocus && containsCursor) || isProgrammaticallyRevealed;
          // 查找激活时的按块揭示：搜索面板聚焦会夺走编辑器焦点（所有块回退渲染
          // widget、源文本被替换隐藏，.cm-searchMatch 无处附着）——命中查询的块
          // 临时转源码显形，匹配高亮与替换才可见。查询清空或面板关闭
          // （searchPanelOpen 门，见 buildSearchRevealMatcher）即恢复纯渲染。
          const isSearchRevealed =
            searchMatcher !== null &&
            searchMatcher(view.state.doc.sliceString(block.from, block.to));
          const isPinned = pinned.has(block.key);
          // Keep the block immediately above a new empty cursor line as source.
          // Replacing that line before Windows IME establishes composition on
          // the empty line makes Chrome move the preedit anchor back into the
          // previous block. This is state-based rather than timer-based: once
          // the user commits text or moves away, the block renders normally.
          const touchesEmptyCursorLine =
            cursorLine.length === 0 && block.to === cursorLine.from - 1;

          if (isPinned) continue; // pinned source stays full-contrast by explicit intent

          if (isFocused || isSearchRevealed) {
            decos.push(...this.buildFocusedGhostDecorations(view, block));
            continue;
          }

          if (touchesEmptyCursorLine) {
            // 与聚焦块同一机制：cm-live-focused-source 统一表示
            // 「源码显形 + 幽灵符号」（聚焦块与 IME 保护块共用）
            if (SOURCE_PRESERVING_BLOCK_TYPES.has(block.type)) {
              decos.push(...this.buildFocusedGhostDecorations(view, block));
            }
            continue;
          }

          // Only decorate if the range is within a single line (no newline chars)
          if (block.raw.includes('\n')) continue; // safety: never decorate multi-line ranges

          // Empty lines inside fenced code blocks have a valid visual widget but no
          // replaceable document range. CodeMirror rejects replace(from === to), so
          // keep the line styling with a zero-width widget instead.
          if (block.from === block.to) {
            decos.push(
              Decoration.widget({
                widget: new RenderedBlockWidget(block.html, block.key),
                side: 1,
              }).range(block.from),
            );
            continue;
          }

          if (block.type === 'setextHeadingRule') {
            // 非聚焦态下规则线无 widget HTML → 不输出任何装饰（CM6 显示原文档行）
            continue;
          }
          decos.push(
            Decoration.replace({
              widget: new RenderedBlockWidget(block.html, block.key),
            }).range(block.from, block.to),
          );
        }

        // Unclosed multi-line block warnings
        for (const [, warn] of unclosedWarnings) {
          const label =
            warn.type === 'codeFenceLine'
              ? ` ${translate('program.unclosedCode')}`
              : warn.type === 'frontmatterLine'
                ? ` ${translate('program.unclosedFrontmatter')}`
                : warn.type === 'tableRow'
                  ? ` ${translate('program.tableSeparator')}`
                  : '';
          if (!label) continue;
          decos.push(
            Decoration.widget({
              widget: new UnclosedBlockWidget(label),
              side: 1,
            }).range(warn.end),
          );
        }

        return Decoration.set(decos, true);
      }

      buildFocusedGhostDecorations(view: EditorView, block: LiveBlock): Range<Decoration>[] {
        const decos: Range<Decoration>[] = [
          Decoration.line({
            attributes: {
              class: 'cm-live-focused-source',
              'data-live-source-type': block.type,
            },
          }).range(block.from),
        ];

        // Decoration.mark 不允许跨行边界：所有 mark 一律按行拆分后入队
        const pushGhostMark = (from: number, to: number, cls = 'cm-live-ghost-mark'): void => {
          if (from >= to) return;
          for (const part of splitRangeByLine(view.state.doc, from, to)) {
            decos.push(Decoration.mark({ class: cls }).range(part.from, part.to));
          }
        };

        const slice = view.state.doc.sliceString(block.from, block.to);
        const scanInline = slice.length > 0 && GHOST_INLINE_SCAN_BLOCK_TYPES.has(block.type);

        // 行内 code 配对段（绝对坐标）：code 内容不参与 wiki/tag/管线扫描
        const codeSpans = scanInline
          ? findInlineCodeSpans(slice).map((s) => ({
              from: block.from + s.from,
              to: block.from + s.to,
            }))
          : [];

        // wiki-link 全域（绝对坐标）：域内归 wiki 正则专属。commonmark 不认识 [[..]]，
        // 会产出单字符 LinkMark 误判括号——这些 Lezer 范围在域内一律豁免。
        const wikiSpans: Array<{ from: number; to: number }> = [];
        if (scanInline) {
          const wikiRe = new RegExp(WIKI_LINK_GLOBAL_RE.source, 'g');
          let wikiMatch: RegExpExecArray | null;
          while ((wikiMatch = wikiRe.exec(slice)) !== null) {
            const span = {
              from: block.from + wikiMatch.index,
              to: block.from + wikiMatch.index + wikiMatch[0].length,
            };
            if (rangesOverlap(span.from, span.to, codeSpans)) continue;
            wikiSpans.push(span);
          }
        }

        // 结构标记整域：markerRange 为权威（如围栏定界行的 CodeMark 被 markerRange 包含，去重）
        const markerSpan =
          block.markerRange &&
          block.markerRange.from >= block.from &&
          block.markerRange.to <= block.to
            ? block.markerRange
            : null;
        const lezerExempt: Array<{ from: number; to: number }> = [...wikiSpans];
        if (markerSpan) lezerExempt.push(markerSpan);

        // A: Lezer 行内符号全集（HeaderMark / EmphasisMark / CodeMark / LinkMark / URL / LinkLabel）
        syntaxTree(view.state).iterate({
          from: block.from,
          to: block.to,
          enter: (node) => {
            if (!SOURCE_MARK_NODE_NAMES.has(node.name)) return;

            let markerTo = node.to;
            if (node.name === 'HeaderMark') {
              while (
                markerTo < block.to &&
                view.state.doc.sliceString(markerTo, markerTo + 1) === ' '
              ) {
                markerTo++;
              }
            }

            if (rangesOverlap(node.from, markerTo, lezerExempt)) return;
            pushGhostMark(node.from, markerTo);
          },
        });

        // B: 结构标记走 AST markerRange（覆盖 Lezer 不认识的源码空间全角符号）
        if (markerSpan) pushGhostMark(markerSpan.from, markerSpan.to);

        if (!scanInline) return decos;

        // code/wiki 双豁免（与 C3 tag 路径一致，避免聚焦行 `| [[a|b]] |` 中别名 `|` 被管线与 wiki 双重上色）
        const inlineSkipRanges: Array<{ from: number; to: number }> = [...codeSpans, ...wikiSpans];

        // C1: 表格管线符——半角 `|`（未转义）或全角 `｜` 各一条单字符幽灵；code/wiki 段内的管道不幽灵
        if (block.type === 'tableRow') {
          for (let i = 0; i < slice.length; i++) {
            const ch = slice.charAt(i);
            if (ch !== '｜' && !(ch === '|' && !isEscaped(slice, i))) continue;
            const from = block.from + i;
            if (inlineSkipRanges.some((s) => from >= s.from && from < s.to)) continue;
            pushGhostMark(from, from + 1);
          }
        }

        // C2: wiki-link 定界符幽灵 + 内容着色（内容取两定界符之间的完整内部文本）
        for (const span of wikiSpans) {
          pushGhostMark(span.from, span.from + 2); // [[
          pushGhostMark(span.to - 2, span.to); // ]]
          pushGhostMark(span.from + 2, span.to - 2, 'cm-live-ghost-wikilink');
        }

        // C3: #tag 前缀幽灵 + 内容着色；code 段与 wiki 域内的 # 不是标签，豁免
        const tagRe = new RegExp(TAG_GLOBAL_RE.source, 'g');
        let tagMatch: RegExpExecArray | null;
        while ((tagMatch = tagRe.exec(slice)) !== null) {
          const inner = tagMatch[1] ?? '';
          const abs = block.from + tagMatch.index;
          const innerFrom = abs + 1;
          const innerTo = innerFrom + inner.length;
          if (!rangesOverlap(abs, abs + 1, inlineSkipRanges)) pushGhostMark(abs, abs + 1);
          if (!rangesOverlap(innerFrom, innerTo, inlineSkipRanges)) {
            pushGhostMark(innerFrom, innerTo, 'cm-live-ghost-tag');
          }
        }

        return decos;
      }

      destroy() {
        this.destroyed = true;
        if (this.renderFrame !== null) cancelAnimationFrame(this.renderFrame);
        this.renderCache.clear();
        this.currentBlocks = [];
        this.lastAst = null;
        if (this.editorView) {
          pendingRestoredBlockFocusCleanup.get(this.editorView)?.();
          pendingRestoredBlockFocusCleanup.delete(this.editorView);
          // Cancel pending rAF callback
          if (this.__initRAF) cancelAnimationFrame(this.__initRAF);
          this.clearPendingCompositionRebuild();
          // Remove IME listeners from contentDOM
          const cd = this.editorView.contentDOM;
          if (this.onCompStart) cd.removeEventListener('compositionstart', this.onCompStart);
          if (this.onCompEnd) cd.removeEventListener('compositionend', this.onCompEnd);
          // Remove click/pointerdown listeners from dom
          const dom = this.editorView.dom;
          if (this.onClick) dom.removeEventListener('click', this.onClick);
          if (this.onRemoteImageLoad) dom.removeEventListener('load', this.onRemoteImageLoad, true);
          if (this.onRemoteImageError)
            dom.removeEventListener('error', this.onRemoteImageError, true);
          if (this.onKeydown) dom.removeEventListener('keydown', this.onKeydown, true);
          if (this.onPointerDownCapture)
            dom.removeEventListener('pointerdown', this.onPointerDownCapture, true);
          if (this.onChangeCapture) dom.removeEventListener('change', this.onChangeCapture, true);
          this.editorView = null;
        }
        this.onCompStart = null;
        this.onCompEnd = null;
        this.onClick = null;
        this.onRemoteImageLoad = null;
        this.onRemoteImageError = null;
        this.onKeydown = null;
        this.onPointerDownCapture = null;
        this.onChangeCapture = null;
      }
    },
    { decorations: (v) => v.decorations },
  );
}

// ---- Exports ----

export function livePreviewExtension(options: LivePreviewOptions = {}) {
  return [pinnedSourceField, createLivePreviewPlugin(options)];
}

/**
 * Temporarily expose the source block that contains a programmatic navigation
 * target. The effect is consumed by one decoration rebuild; normal focus rules
 * own subsequent renders, so this does not pin the block permanently.
 */
export function revealLivePreviewSourceAt(view: EditorView, position: number): void {
  const offset = Math.max(0, Math.min(position, view.state.doc.length));
  view.dispatch({
    selection: { anchor: offset },
    effects: [
      revealSourceAtPositionEffect.of(offset),
      EditorView.scrollIntoView(offset, { y: 'center' }),
    ],
  });
}

/** TAB 切换当前聚焦 block 的 pin 状态 */
export function toggleBlockRender(view: EditorView): boolean {
  const text = view.state.doc.toString();
  const line = view.state.doc.lineAt(view.state.selection.main.head).number - 1;
  const blocks = parseLiveBlocks(text, {}, getDocumentAst(view.state), line, line, false);
  const cursor = view.state.selection.main.head;
  const target = blocks.find((b) => cursor >= b.from && cursor <= b.to);
  if (!target) return false;

  const pinned = view.state.field(pinnedSourceField, false) ?? new Set<string>();
  const isPinned = pinned.has(target.key);

  view.dispatch({
    effects: isPinned
      ? unpinSourceEffect.of({ key: target.key })
      : pinSourceEffect.of({ key: target.key }),
  });

  return true;
}

function focusRenderedBlock(block: HTMLElement): boolean {
  const ownerDocument = block.ownerDocument;
  try {
    block.focus({ preventScroll: true });
  } catch {
    block.focus();
  }
  if (ownerDocument.activeElement === block) return true;

  // WebKit can decline programmatic focus for a tabindex=-1 replacement
  // widget nested inside contenteditable. Make only the restored block a
  // temporary tab stop, then return it to the normal roving-focus contract.
  block.tabIndex = 0;
  try {
    block.focus({ preventScroll: true });
  } catch {
    block.focus();
  }
  if (ownerDocument.activeElement !== block) {
    block.tabIndex = -1;
    return false;
  }

  block.addEventListener(
    'blur',
    () => {
      block.tabIndex = -1;
    },
    { once: true },
  );
  return true;
}

/** ESC 取消当前聚焦 block 的 pin 状态 */
export function unpinFocusedBlock(view: EditorView): boolean {
  pendingRestoredBlockFocusCleanup.get(view)?.();
  const text = view.state.doc.toString();
  const line = view.state.doc.lineAt(view.state.selection.main.head).number - 1;
  const blocks = parseLiveBlocks(text, {}, getDocumentAst(view.state), line, line, false);
  const cursor = view.state.selection.main.head;
  const target = blocks.find((b) => cursor >= b.from && cursor <= b.to);
  if (!target) return false;

  const pinned = view.state.field(pinnedSourceField, false) ?? new Set<string>();
  if (pinned.has(target.key)) {
    view.dispatch({
      effects: unpinSourceEffect.of({ key: target.key }),
    });
  }

  // Leaving contentDOM is the actual edit-state transition. focusChanged
  // rebuilds the decorations, after which focus is handed to the exact block
  // that was restored. This keeps keyboard position without leaving a hidden
  // source cursor active behind the preview.
  view.contentDOM.blur();
  const ownerDocument = view.dom.ownerDocument;
  let focusFrame: number | null = null;
  let focusedBlock: HTMLElement | null = null;
  let cancelled = false;
  const cleanupFocusTransfer = (): void => {
    if (focusFrame !== null) {
      cancelAnimationFrame(focusFrame);
      focusFrame = null;
    }
    ownerDocument.removeEventListener('pointerdown', cancelFocusTransfer, true);
    ownerDocument.removeEventListener('keydown', cancelFocusTransfer, true);
    ownerDocument.removeEventListener('beforeinput', cancelFocusTransfer, true);
    ownerDocument.removeEventListener('compositionstart', cancelFocusTransfer, true);
    if (pendingRestoredBlockFocusCleanup.get(view) === cleanupFocusTransfer) {
      pendingRestoredBlockFocusCleanup.delete(view);
    }
  };
  const cancelFocusTransfer = (): void => {
    cancelled = true;
    cleanupFocusTransfer();
  };
  const focusRestoredBlock = (attempt: number): void => {
    focusFrame = null;
    if (cancelled || !view.dom.isConnected) {
      cleanupFocusTransfer();
      return;
    }
    const renderedBlocks = [...view.dom.querySelectorAll<HTMLElement>('.cm-live-block')];
    const rendered =
      renderedBlocks.find((element) => element.getAttribute('data-block-key') === target.key) ??
      renderedBlocks.find(
        (element) => Number(element.getAttribute('data-block-from')) === target.from,
      );
    if (rendered) {
      if (ownerDocument.activeElement === rendered && focusedBlock === rendered) {
        cleanupFocusTransfer();
        return;
      }
      focusedBlock = focusRenderedBlock(rendered) ? rendered : null;
    } else {
      focusedBlock = null;
    }
    // WebKit may attach or replace the widget after the first focus attempt.
    // Verify ownership across a frame and retry for a bounded settling window.
    if (attempt < 30) {
      focusFrame = requestAnimationFrame(() => focusRestoredBlock(attempt + 1));
      return;
    }
    cleanupFocusTransfer();
  };
  ownerDocument.addEventListener('pointerdown', cancelFocusTransfer, true);
  ownerDocument.addEventListener('keydown', cancelFocusTransfer, true);
  ownerDocument.addEventListener('beforeinput', cancelFocusTransfer, true);
  ownerDocument.addEventListener('compositionstart', cancelFocusTransfer, true);
  pendingRestoredBlockFocusCleanup.set(view, cleanupFocusTransfer);
  focusFrame = requestAnimationFrame(() => focusRestoredBlock(0));
  return true;
}

/** Escape exits live source editing unless an IME owns the key. */
export function exitLivePreviewOnEscape(view: EditorView): boolean {
  if (view.composing || view.compositionStarted) return false;
  return unpinFocusedBlock(view);
}
