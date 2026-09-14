/**
 * 导出模型层 — renderer 块级 AST → 导出适配器消费的规范化块序列
 *
 * 切片 D / WO-D3：四种导出手写解析的收口点。parseDocument 产出块级 AST，
 * 本模块做导出语义上的归一：
 *   - blank 丢弃；jsonBlock 降级为段落；refDefinition 保留为独立块（适配器决定去留）；
 *   - table 归一为「表头 + 数据行」矩阵，行按 columnCount 补齐空格串、
 *     附带 alignments（`\|` 转义由 renderer splitTableCells 口径保证不切格）；
 *   - listItem 保留扁平序列并附 groupId（同源 groupRange）与嵌套 level
 *     （indent 栈重组），嵌套树由适配器自行决定如何降级；
 *   - blockquote 保留逐行 depth，适配器按需按 depth 分组；
 *   - 一切文本一律记源码切片（range），行内结构留给适配器走 lexInlineTokens。
 *
 * @see packages/renderer/src/ast.ts — 块级 AST 语义基准
 */

import { parseDocument } from '@jotluck/renderer';
import type { SourceRange } from '@jotluck/renderer';

/** 模型层列表项（扁平，嵌套由 level 表达） */
export interface ExportListItemBlock {
  type: 'listItem';
  kind: 'unordered' | 'ordered' | 'task';
  /** 半角规范形：无序/任务为 bullet 字符，有序为数字串 */
  marker: string;
  /** 有序项数字；其余 undefined */
  number?: number;
  /** 任务项勾选态；仅 task */
  checked?: boolean;
  /** 行首缩进长度（源码空格数） */
  indent: number;
  /** 组内嵌套层级（组首项为 0，indent 栈深度） */
  level: number;
  /** 组内序号，1 基（连续 listItem 块共享 groupId 视为同组） */
  itemIndex: number;
  /** 同组标识（同源 groupRange.from） */
  groupId: number;
  /** 列表标记源码区间（任务含 `[x]`，不含尾随空白） */
  markerRange: SourceRange;
  /** 列表项内容源码区间 */
  contentRange: SourceRange;
  range: SourceRange;
}

export interface ExportBlockquoteLine {
  /** 去掉引用标记后的内容源码区间 */
  contentRange: SourceRange;
  /** 引用层级（连续 `>` 数） */
  depth: number;
}

export interface ExportBlockquoteBlock {
  type: 'blockquote';
  /** 组内最大引用层级 */
  depth: number;
  lines: ExportBlockquoteLine[];
  range: SourceRange;
}

export interface ExportTableBlock {
  type: 'table';
  /** 表头格（trim 后源码切片，保留 `\|` 反斜杠；按 columnCount 补齐） */
  headers: string[];
  /** 数据行（分隔行之后的非分隔行；同样补齐到 columnCount） */
  rows: string[][];
  columnCount: number;
  alignments: Array<'left' | 'center' | 'right'>;
  range: SourceRange;
}

export type ExportBlock =
  | {
      type: 'heading';
      level: 1 | 2 | 3 | 4 | 5 | 6;
      text: string;
      contentRange: SourceRange;
      range: SourceRange;
    }
  | { type: 'paragraph'; text: string; range: SourceRange }
  | {
      type: 'codeFence';
      lang: string;
      contentRange: SourceRange | null;
      closed: boolean;
      range: SourceRange;
    }
  | ExportBlockquoteBlock
  | ExportListItemBlock
  | ExportTableBlock
  | { type: 'horizontalRule'; range: SourceRange }
  | { type: 'refDefinition'; text: string; range: SourceRange }
  | { type: 'frontmatter'; rawContent: string; range: SourceRange };

export interface ExportModel {
  source: string;
  blocks: ExportBlock[];
}

export interface BuildExportModelOptions {
  /** false 时丢弃 frontmatter 块（默认 true，即保留给适配器决定） */
  includeFrontmatter?: boolean;
}

/**
 * Markdown 源码 → 导出块模型。
 *
 * 只做块级归一，不做行内解析；文本一律源码切片。
 */
export function buildExportModel(md: string, opts?: BuildExportModelOptions): ExportModel {
  const ast = parseDocument(md);
  const source = ast.source;
  const includeFrontmatter = opts?.includeFrontmatter ?? true;

  const blocks: ExportBlock[] = [];

  // 列表 indent 栈：组内按 indent 递增压栈、回退弹栈，level = 栈内下标。
  let listGroupId = -1;
  let indentStack: number[] = [];

  const pushListItem = (node: {
    kind: ExportListItemBlock['kind'];
    marker: string;
    number?: number;
    checked?: boolean;
    indent: number;
    itemIndex: number;
    groupRange: SourceRange;
    markerRange: SourceRange;
    contentRange: SourceRange;
    range: SourceRange;
  }): void => {
    const groupId = node.groupRange.from;
    if (groupId !== listGroupId) {
      listGroupId = groupId;
      indentStack = [];
    }
    while (indentStack.length > 0 && indentStack[indentStack.length - 1]! > node.indent) {
      indentStack.pop();
    }
    if (indentStack.length === 0 || indentStack[indentStack.length - 1]! < node.indent) {
      indentStack.push(node.indent);
    }
    const level = indentStack.length - 1;
    blocks.push({
      type: 'listItem',
      kind: node.kind,
      marker: node.marker,
      ...(node.number !== undefined ? { number: node.number } : {}),
      ...(node.checked !== undefined ? { checked: node.checked } : {}),
      indent: node.indent,
      level,
      itemIndex: node.itemIndex,
      groupId,
      markerRange: node.markerRange,
      contentRange: node.contentRange,
      range: node.range,
    });
  };

  for (const node of ast.blocks) {
    switch (node.type) {
      case 'frontmatter':
        if (includeFrontmatter) {
          blocks.push({
            type: 'frontmatter',
            rawContent: node.rawContent,
            range: node.range,
          });
        }
        break;

      case 'refDefinition':
        // 引用式链接定义保留为独立块：TXT 适配器按旧链行为原样输出该行
        // （旧 14 条正则链无命中规则 → 透传），DOCX/HTML 侧自行跳过。
        blocks.push({
          type: 'refDefinition',
          text: source.slice(node.range.from, node.range.to),
          range: node.range,
        });
        break;

      case 'blank':
        break;

      case 'jsonBlock':
        // jsonBlock 按纯文本块整体保留更贴近旧行为，保留为段落。
        blocks.push({
          type: 'paragraph',
          text: source.slice(node.range.from, node.range.to),
          range: node.range,
        });
        break;

      case 'heading':
        blocks.push({
          type: 'heading',
          level: node.level,
          text: node.text,
          contentRange: node.contentRange,
          range: node.range,
        });
        break;

      case 'paragraph':
        blocks.push({
          type: 'paragraph',
          text: source.slice(node.range.from, node.range.to),
          range: node.range,
        });
        break;

      case 'codeFence':
        blocks.push({
          type: 'codeFence',
          lang: node.lang,
          contentRange: node.contentRange,
          closed: node.closed,
          range: node.range,
        });
        break;

      case 'blockquote':
        blocks.push({
          type: 'blockquote',
          depth: node.depth,
          lines: node.lines.map((line) => ({
            contentRange: line.contentRange,
            depth: line.depth,
          })),
          range: node.range,
        });
        break;

      case 'listItem':
        pushListItem(node);
        break;

      case 'table': {
        // 旧抽取语义：表头必须在分隔行上一行（separatorIndex === 1），
        // 且无分隔行的「表格」不抽取。
        if (node.separatorIndex !== 1) break;
        const columnCount = node.columnCount;
        const pad = (cells: string[]): string[] => {
          const out = cells.slice(0, columnCount);
          while (out.length < columnCount) out.push('');
          return out;
        };
        const headerRow = node.rows[0];
        const headers = pad((headerRow?.cells ?? []).map((cell) => cell.text));
        const rows: string[][] = [];
        for (let r = 2; r < node.rows.length; r++) {
          const row = node.rows[r]!;
          if (row.isSeparator) continue; // 旧实现会把第二分隔行当数据行——视为缺陷，跳过
          rows.push(pad(row.cells.map((cell) => cell.text)));
        }
        blocks.push({
          type: 'table',
          headers,
          rows,
          columnCount,
          alignments: node.alignments,
          range: node.range,
        });
        break;
      }

      case 'horizontalRule':
        blocks.push({ type: 'horizontalRule', range: node.range });
        break;
    }
  }

  return { source, blocks };
}
