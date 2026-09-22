import { prepareDocumentHtml } from './progressive-print';
import { isLargeDocument } from './document-analysis';
/**
 * Exporter — 6 格式导出服务
 *
 * PDF (window.print + rendered HTML) / DOCX (docx.js) / XLSX (write-excel-file) /
 * CSV / TXT / HTML (self-contained)
 *
 * 切片 D / WO-D3：四种手写解析（marked.lexer / 逐行扫描 / 14 条正则链）全部收口到
 * 「renderer 块级 AST（export-model.ts）+ renderer 行内词法（lexInlineTokens）」。
 * 本文件不再 import marked。
 *
 * @see TAD.md §7.2
 * @see doc/PRD.md §F-09
 */
import type { ExportOptions, ExportResult } from '@/types';
import { ExportFormat } from '@/types';
import {
  renderMarkdown,
  parseDocument,
  lexInlineTokens,
  parseWikiLinkTarget,
  stripToPlainText,
  WIKI_LINK_GLOBAL_RE,
} from '@jotluck/renderer';
import type { InlineToken, SourceRange } from '@jotluck/renderer';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  BorderStyle,
  ShadingType,
} from 'docx';
import writeXlsxFile, { type Sheet, type SheetData } from 'write-excel-file/browser';
import { getCurrentLocale, getLocaleDocumentFont, getLocaleFontStack, translate } from '@/i18n';
import { buildExportModel } from './export-model';
import type { ExportModel } from './export-model';

// ============================================================================
// Internal Options — aligned with ExportOptions type
// ============================================================================

interface InternalExportOptions {
  includeFrontmatter: boolean;
  includeWikiLinks: boolean;
  codeLineNumbers: boolean;
}

function createExportAbortError(): DOMException {
  return new DOMException(translate('export.aborted'), 'AbortError');
}

function throwIfExportAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createExportAbortError();
}

function buildInternalOpts(options?: Partial<ExportOptions>): InternalExportOptions {
  return {
    includeFrontmatter: options?.includeFrontmatter ?? true,
    includeWikiLinks: options?.includeWikiLinks ?? true,
    codeLineNumbers: options?.codeLineNumbers ?? false,
  };
}

// DOCX 颜色常量（docx 库 API 仅接受 6 位 hex 字符串，无法使用 oklch()）
// 值来源于 paper.css Light 主题 OKLCH Token 的 sRGB 近似
const DOCX_COLORS = {
  TABLE_HEADER_BG: 'E8E8E8', // ~oklch(0.93 0.002 85) — --table-stripe
  HR_BORDER: 'CCCCCC', // ~oklch(0.80 0.003 85) — --rule-mid
} as const;

// ============================================================================
// Markdown Preprocessing（AST 驱动；函数名与签名保持不变）
// ============================================================================

/**
 * 去掉文首 frontmatter 块（含其后随的一个换行）。
 * 旧实现为正则 /^---\s*\n[\s\S]*?\n---\s*\n/；现走 parseDocument 的 frontmatter 节点。
 * 未闭合（closed=false）或块后无换行（到 EOF）时不摘除——与旧正则「必须有收尾换行」
 * 的口径一致。
 */
/** @internal 切片 D 等价基线专用导出 */
export function stripFrontmatter(md: string): string {
  const { frontmatter } = parseDocument(md);
  if (!frontmatter || !frontmatter.closed) return md;
  let to = frontmatter.range.to;
  if (md.charAt(to) !== '\n') return md;
  to += 1;
  return md.slice(0, frontmatter.range.from) + md.slice(to);
}

/**
 * Convert wiki-links [[...]] to regular Markdown links or plain text.
 * Wiki-links with | alias: [[target|alias]] → [alias](target) or alias
 * Wiki-links with # anchor: [[target#section]] → [target](target#section)
 *
 * AST 驱动：wiki 命中区间在块内容切片内定位（parseWikiLinkTarget 解析），
 * 代码围栏/裸 JSON 块内的 [[...]] 是字面量不再转换（旧全局正则的误转修复）。
 */
/** @internal 切片 D 等价基线专用导出 */
export function convertWikiLinks(md: string, include: boolean): string {
  const ast = parseDocument(md);
  const { source } = ast;

  // 收集源码区间上的替换（from/to 为源码偏移），倒序拼接保证偏移不失效。
  const replacements: Array<{ from: number; to: number; text: string }> = [];

  const scanSlice = (from: number, to: number): void => {
    const slice = source.slice(from, to);
    for (const match of slice.matchAll(WIKI_LINK_GLOBAL_RE)) {
      const parsed = parseWikiLinkTarget(match[1] ?? '');
      const text = include
        ? `[${parsed.alias ?? parsed.note}](${parsed.note}${parsed.anchor !== null ? `#${parsed.anchor}` : ''})`
        : (parsed.alias ?? parsed.note);
      replacements.push({
        from: from + match.index,
        to: from + match.index + match[0].length,
        text,
      });
    }
  };

  for (const block of ast.blocks) {
    switch (block.type) {
      case 'heading':
        scanSlice(block.contentRange.from, block.contentRange.to);
        break;
      case 'paragraph':
        scanSlice(block.range.from, block.range.to);
        break;
      case 'listItem':
        scanSlice(block.contentRange.from, block.contentRange.to);
        break;
      case 'blockquote':
        for (const line of block.lines) scanSlice(line.contentRange.from, line.contentRange.to);
        break;
      case 'table':
        for (const row of block.rows) {
          for (const cell of row.cells) scanSlice(cell.range.from, cell.range.to);
        }
        break;
      default:
        // frontmatter / codeFence / jsonBlock / refDefinition / blank / hr — 不转换
        break;
    }
  }

  if (replacements.length === 0) return md;
  let result = source;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i]!;
    result = result.slice(0, r.from) + r.text + result.slice(r.to);
  }
  return result;
}

/** @internal 切片 D 等价基线专用导出 */
export function preprocessMarkdown(md: string, opts: InternalExportOptions): string {
  let result = md;
  if (!opts.includeFrontmatter) {
    result = stripFrontmatter(result);
  }
  result = convertWikiLinks(result, opts.includeWikiLinks);
  return result;
}

// ============================================================================
// HTML Rendering (used by PDF & HTML exports)
// ============================================================================

function renderToStyledHtml(md: string, opts: InternalExportOptions): string {
  const processed = preprocessMarkdown(md, opts);
  return renderMarkdown(processed);
}

// ============================================================================
// Download Helper
// ============================================================================

function triggerDownload(
  content: string | Blob,
  fileName: string,
  mime: string,
  signal?: AbortSignal,
): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  try {
    document.body.appendChild(a);
    throwIfExportAborted(signal);
    a.click();
  } finally {
    a.remove();
    URL.revokeObjectURL(url);
  }
}

// ============================================================================
// PDF — hidden iframe + rendered HTML + window.print()
// ============================================================================

function exportPDF(
  md: string,
  fileName: string,
  options?: Partial<ExportOptions>,
): Promise<ExportResult> {
  const signal = options?.signal;
  throwIfExportAborted(signal);
  const opts = buildInternalOpts(options);
  if (isLargeDocument(md)) {
    return prepareDocumentHtml(preprocessMarkdown(md, opts), undefined, signal).then((bodyHtml) =>
      printPreparedDocument(bodyHtml, fileName, signal),
    );
  }
  return printPreparedDocument(renderToStyledHtml(md, opts), fileName, signal);
}

function printPreparedDocument(
  bodyHtml: string,
  fileName: string,
  signal?: AbortSignal,
): Promise<ExportResult> {
  throwIfExportAborted(signal);
  const printableHtml = `<!DOCTYPE html>
<html lang="${getCurrentLocale()}">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(fileName)}</title>
  <style>${embeddedCss()}</style>
  <style>
    @media print {
      @page { margin: 20mm; size: A4; }
      body { margin: 0; }
    }
    @media screen {
      body { max-width: 800px; margin: 40px auto; padding: 0 24px; }
    }
  </style>
</head>
<body>
  <article class="markdown-body">
    ${bodyHtml}
  </article>
</body>
</html>`;

  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;border:none;z-index:99999;';
    // Hidden until print dialog appears — use opacity to keep printing working
    iframe.style.opacity = '0';
    iframe.title = translate('export.pdfPreview');

    let settled = false;
    let preparationTimer: number | undefined;

    const cleanup = (): void => {
      signal?.removeEventListener('abort', abort);
      if (preparationTimer !== undefined) window.clearTimeout(preparationTimer);
      iframe.onload = null;
      iframe.onerror = null;
      iframe.remove();
    };

    const settle = (result: ExportResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const abort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(createExportAbortError());
    };

    const fail = (error: string): void => {
      settle({ success: false, format: ExportFormat.PDF, error });
    };

    iframe.onload = () => {
      if (settled) return;
      if (signal?.aborted) {
        abort();
        return;
      }
      const printWindow = iframe.contentWindow;
      if (!printWindow) {
        fail(translate('export.pdfUnavailable'));
        return;
      }

      try {
        printWindow.focus();
      } catch {
        // Some WebViews deny programmatic focus; printing can still proceed.
      }

      if (settled) return;
      if (signal?.aborted) {
        abort();
        return;
      }

      try {
        // print() blocks while the native dialog is open. Guard preparation,
        // not the time the user spends interacting with that dialog.
        printWindow.print();
      } catch {
        fail(translate('export.pdfOpenFailed'));
        return;
      }

      settle({
        success: true,
        format: ExportFormat.PDF,
        fileName: `${fileName}.pdf`,
        message: translate('export.pdfClosed'),
      });
    };

    iframe.onerror = () => fail(translate('export.pdfLoadFailed'));

    try {
      signal?.addEventListener('abort', abort, { once: true });
      throwIfExportAborted(signal);
      iframe.srcdoc = printableHtml;
      preparationTimer = window.setTimeout(() => fail(translate('export.pdfTimeout')), 5000);
      document.body.appendChild(iframe);
    } catch {
      fail(translate('export.pdfCreateFailed'));
    }
  });
}

// ============================================================================
// DOCX — ExportModel 块模型 + lexInlineTokens 行内词法 → docx.js elements
// ============================================================================

/** Map markdown heading depth (1-6) to docx HeadingLevel */
function mapHeadingLevel(depth: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  const levels: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
    4: HeadingLevel.HEADING_4,
    5: HeadingLevel.HEADING_5,
    6: HeadingLevel.HEADING_6,
  };
  return levels[depth] ?? HeadingLevel.HEADING_1;
}

// ── Inline formatting context (stacked by recursive descent) ──
interface InlineFormat {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  font?: string;
  size?: number;
  color?: string;
  underline?: { type: 'single' };
}

/** Heading format by depth: size in half-points, universal black, bold */
function headingFormat(depth: number): InlineFormat {
  const sizes: Record<number, number> = { 1: 36, 2: 32, 3: 28, 4: 24, 5: 24, 6: 24 };
  return {
    size: sizes[depth] ?? sizes[1],
    bold: true,
    color: '000000',
    font: getLocaleDocumentFont(),
  };
}

/**
 * Build docx TextRun array from renderer InlineToken 序列，with cascading format context。
 *
 * 接缝变化（WO-D3）：入参由 marked Token[] 换成 renderer InlineToken[]；
 * 各 token 分支语义与旧 buildTextRuns 对齐（快照锁定）：
 *   - link 递归 children 加下划线；image 恒 `[Image]`（InlineToken 无 title 字段，
 *     旧实现仅在 title 存在时输出 `[Image: title]`，语料未覆盖）；
 *   - tag 用 token.tag（不含 `#`）；wikiLink 用 alias ?? target；
 *   - 空/缺 token 序列保底一个空 run（沿用旧回退，DOCX 任务项空 runs 工件依赖它）。
 */
/** @internal 切片 D 等价基线专用导出 */
export function buildTextRuns(
  tokens: InlineToken[] | undefined,
  fmt: InlineFormat = {},
): TextRun[] {
  if (!tokens || tokens.length === 0) {
    return [new TextRun({ text: '', ...fmt })];
  }

  const runs: TextRun[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'text': {
        if (token.text) runs.push(new TextRun({ text: token.text, ...fmt }));
        break;
      }
      case 'strong': {
        runs.push(...buildTextRuns(token.children, { ...fmt, bold: true }));
        break;
      }
      case 'em': {
        runs.push(...buildTextRuns(token.children, { ...fmt, italics: true }));
        break;
      }
      case 'codespan': {
        runs.push(new TextRun({ text: token.text, font: 'Consolas', size: 20, ...fmt }));
        break;
      }
      case 'del': {
        runs.push(...buildTextRuns(token.children, { ...fmt, strike: true }));
        break;
      }
      case 'link': {
        // Word default style — no custom color, underline only
        const children =
          token.children && token.children.length > 0
            ? token.children
            : [{ type: 'text' as const, text: token.text }];
        runs.push(
          ...buildTextRuns(children, {
            ...fmt,
            underline: { type: 'single' as const },
          }),
        );
        break;
      }
      case 'image': {
        const img = token as Extract<InlineToken, { type: 'image' }>;
        runs.push(
          new TextRun({
            text: `[Image${img.title ? ': ' + img.title : ''}]`,
            italics: true,
            color: '999999',
          }),
        );
        break;
      }
      case 'wikiLink': {
        runs.push(new TextRun({ text: token.alias ?? token.target, ...fmt }));
        break;
      }
      case 'tag': {
        runs.push(new TextRun({ text: token.tag, ...fmt }));
        break;
      }
      case 'escape': {
        runs.push(new TextRun({ text: token.text, ...fmt }));
        break;
      }
      case 'br': {
        runs.push(new TextRun({ break: 1 }));
        break;
      }
    }
  }

  return runs.length > 0 ? runs : [new TextRun({ text: '', ...fmt })];
}

/** 块内容切片 → 行内词法 → TextRun[] */
function buildSliceRuns(slice: string, fmt: InlineFormat = {}): TextRun[] {
  return buildTextRuns(lexInlineTokens(slice), fmt);
}

/** Build docx Paragraph / Table children from 导出块模型 */
/** @internal 切片 D 等价基线专用导出 */
export function buildDocxChildren(
  model: ExportModel,
  _opts: InternalExportOptions,
): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = [];
  const { source } = model;
  const slice = (range: SourceRange): string => source.slice(range.from, range.to);

  for (const block of model.blocks) {
    switch (block.type) {
      // ── Heading ──
      case 'heading': {
        const fmt = headingFormat(block.level);
        children.push(
          new Paragraph({
            heading: mapHeadingLevel(block.level),
            spacing: { before: 240, after: 120 },
            children: buildSliceRuns(slice(block.contentRange), { ...fmt }),
          }),
        );
        break;
      }

      // ── Paragraph ──
      case 'paragraph': {
        children.push(
          new Paragraph({
            spacing: { after: 120 },
            children: buildSliceRuns(block.text),
          }),
        );
        break;
      }

      // ── Frontmatter：rawContent 按行输出为纯文本段落 ──
      case 'frontmatter': {
        for (const line of block.rawContent.split('\n')) {
          children.push(
            new Paragraph({
              spacing: { after: 120 },
              children: buildSliceRuns(line),
            }),
          );
        }
        break;
      }

      // ── Code Block ──
      case 'codeFence': {
        const content = block.contentRange ? slice(block.contentRange) : '';
        const lines = content === '' ? [] : content.split('\n');
        for (let li = 0; li < lines.length; li++) {
          const lineText = _opts.codeLineNumbers
            ? `${String(li + 1).padStart(3, ' ')} │ ${lines[li]}`
            : lines[li]!;
          children.push(
            new Paragraph({
              spacing: { before: 0, after: 0 },
              indent: { left: 240 },
              shading: { type: ShadingType.SOLID, color: 'F0F0F0', fill: 'F0F0F0' },
              children: [
                new TextRun({
                  text: lineText,
                  font: 'Consolas',
                  size: 20, // 10pt = 20 half-points
                }),
              ],
            }),
          );
        }
        break;
      }

      // ── Blockquote ──
      case 'blockquote': {
        // 现行行为固化（等价快照）：引用块段落 runs 恒为空 run（旧实现从 docx v9
        // 内部取不到 children 回退 [TextRun({text:''})] 的工件）。多行按连续同
        // depth 分组，每组一个带左边框段落。
        const border = {
          left: { style: BorderStyle.SINGLE, size: 6, color: '999999' },
        };
        let groupStart = 0;
        for (let li = 1; li <= block.lines.length; li++) {
          if (
            li === block.lines.length ||
            block.lines[li]!.depth !== block.lines[groupStart]!.depth
          ) {
            children.push(
              new Paragraph({
                spacing: { after: 120 },
                indent: { left: 480 },
                border,
                children: [new TextRun({ text: '' })],
              }),
            );
            groupStart = li;
          }
        }
        break;
      }

      // ── List ──
      case 'listItem': {
        // 现行行为固化（等价快照）：
        //   - 任务项整体不落 DOCX（旧 marked v18 任务项 tokens 为空的等价行为）；
        //   - 嵌套项随父项内层 list token 被忽略而丢弃（level > 0 跳过）。
        if (block.kind === 'task' || block.level > 0) break;

        const itemRuns: TextRun[] = [];
        if (block.kind === 'ordered') {
          // 旧实现使用组内序数而非源码数字
          itemRuns.push(new TextRun({ text: `${block.itemIndex}. ` }));
        }
        itemRuns.push(...buildSliceRuns(slice(block.contentRange)));

        children.push(
          new Paragraph({
            spacing: { before: 40, after: 40 },
            indent: { left: 480, hanging: 240 },
            bullet: block.kind === 'unordered' ? { level: 0 } : undefined,
            children: itemRuns,
          }),
        );
        break;
      }

      // ── Table ──
      case 'table': {
        const rows: TableRow[] = [];

        // Header row
        const headerCells: TableCell[] = [];
        for (const header of block.headers) {
          headerCells.push(
            new TableCell({
              // OKLCH equivalent: oklch(0.93 0.002 85) — ~ --table-stripe in paper.css
              shading: {
                type: ShadingType.SOLID,
                color: DOCX_COLORS.TABLE_HEADER_BG,
                fill: DOCX_COLORS.TABLE_HEADER_BG,
              },
              children: [
                new Paragraph({
                  children: buildSliceRuns(header),
                }),
              ],
            }),
          );
        }
        rows.push(new TableRow({ children: headerCells }));

        // Data rows
        for (const row of block.rows) {
          const dataCells: TableCell[] = [];
          for (const cell of row) {
            dataCells.push(
              new TableCell({
                children: [
                  new Paragraph({
                    children: buildSliceRuns(cell),
                  }),
                ],
              }),
            );
          }
          rows.push(new TableRow({ children: dataCells }));
        }

        children.push(
          new Table({
            rows,
            width: { size: 100, type: 'pct' as const },
          }),
        );
        // Add spacing after tables
        children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
        break;
      }

      // ── Horizontal Rule ──
      case 'horizontalRule': {
        children.push(
          new Paragraph({
            spacing: { before: 240, after: 240 },
            // OKLCH equivalent: oklch(0.80 0.003 85) — ~ --rule-mid in paper.css
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 2, color: DOCX_COLORS.HR_BORDER },
            },
            children: [],
          }),
        );
        break;
      }
    }
  }

  return children;
}

async function exportDocx(
  md: string,
  fileName: string,
  options?: Partial<ExportOptions>,
): Promise<ExportResult> {
  const opts = buildInternalOpts(options);
  const processed = preprocessMarkdown(md, opts);

  const model = buildExportModel(processed);
  const children = buildDocxChildren(model, opts);

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: getLocaleDocumentFont(),
            size: 24, // 12pt = 24 half-points
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440, // 1 inch in twips
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        children:
          children.length > 0
            ? children
            : [new Paragraph({ children: [new TextRun({ text: '' })] })],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  throwIfExportAborted(options?.signal);
  triggerDownload(
    blob,
    `${fileName}.docx`,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    options?.signal,
  );
  return { success: true, format: ExportFormat.DOCX, fileName: `${fileName}.docx` };
}

// ============================================================================
// XLSX — write-excel-file table extraction（AST-backed）
// ============================================================================

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

/**
 * AST-backed 包装：parseDocument 的 table 节点 → ParsedTable 形状。
 *
 * 行为变化点（WO-D3，edge 分叉固化）：
 *   - `\|` 转义单元格不再裸切（renderer splitTableCells 同口径，保留反斜杠切片）；
 *   - 全角 ｜ 表格现在能被抽取（旧逐行扫描只认半角）。
 * 语义对齐旧实现：仅接受「表头紧邻分隔行」（separatorIndex === 1）的表格；
 * 行列按 table.columnCount 补齐空串。
 */
/** @internal 切片 D 等价基线专用导出 */
export function extractMarkdownTables(md: string): ParsedTable[] {
  const model = buildExportModel(md);
  const tables: ParsedTable[] = [];
  for (const block of model.blocks) {
    if (block.type === 'table') {
      tables.push({ headers: block.headers, rows: block.rows });
    }
  }
  return tables;
}

/** @internal 切片 D 等价基线专用导出 */
export function tableToSheetData(table: ParsedTable): SheetData {
  return [table.headers, ...table.rows];
}

/** @internal 切片 D 等价基线专用导出 */
export function buildXlsxColumns(table: ParsedTable): { width: number }[] {
  return table.headers.map((header, ci) => {
    let maxLen = header.length;
    for (const row of table.rows) {
      maxLen = Math.max(maxLen, (row[ci] || '').length);
    }
    return { width: Math.min(Math.max(maxLen + 4, 10), 60) };
  });
}

async function exportXlsx(
  md: string,
  fileName: string,
  options?: Partial<ExportOptions>,
): Promise<ExportResult> {
  const opts = buildInternalOpts(options);
  const processed = preprocessMarkdown(md, opts);
  const tables = extractMarkdownTables(processed);

  const sheets: Sheet<Blob>[] =
    tables.length === 0
      ? [{ sheet: 'Sheet1', data: [[processed || '']] }]
      : tables.map((table, idx) => ({
          sheet: tables.length === 1 ? 'Sheet1' : `Table_${idx + 1}`,
          data: tableToSheetData(table),
          columns: buildXlsxColumns(table),
        }));

  const blob = await writeXlsxFile(sheets).toBlob();
  throwIfExportAborted(options?.signal);
  triggerDownload(
    blob,
    `${fileName}.xlsx`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    options?.signal,
  );
  return { success: true, format: ExportFormat.XLSX, fileName: `${fileName}.xlsx` };
}

// ============================================================================
// CSV — table extraction to CSV
// ============================================================================

function exportCsv(md: string, fileName: string, options?: Partial<ExportOptions>): ExportResult {
  const opts = buildInternalOpts(options);
  const processed = preprocessMarkdown(md, opts);
  const tables = extractMarkdownTables(processed);

  if (tables.length === 0) {
    // No tables — export the whole content as a single-cell CSV
    triggerDownload(
      escapeCsvCell(processed),
      `${fileName}.csv`,
      'text/csv;charset=UTF-8',
      options?.signal,
    );
    return { success: true, format: ExportFormat.CSV, fileName: `${fileName}.csv` };
  }

  const csvContent = tables
    .map((table) => {
      const headerRow = table.headers.map((c) => escapeCsvCell(c)).join(',');
      const dataRows = table.rows.map((row) => row.map((c) => escapeCsvCell(c)).join(','));
      return [headerRow, ...dataRows].join('\n');
    })
    .join('\n\n');

  triggerDownload(csvContent, `${fileName}.csv`, 'text/csv;charset=UTF-8', options?.signal);
  return { success: true, format: ExportFormat.CSV, fileName: `${fileName}.csv` };
}

/** @internal 切片 D 等价基线专用导出 */
export function escapeCsvCell(cell: string): string {
  const safeCell = protectCsvFormula(cell);
  if (safeCell.includes(',') || safeCell.includes('"') || safeCell.includes('\n')) {
    return `"${safeCell.replace(/"/g, '""')}"`;
  }
  return safeCell;
}

/** @internal 切片 D 等价基线专用导出 */
export function protectCsvFormula(cell: string): string {
  return /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
}

// ============================================================================
// TXT — 模型遍历 + renderer stripToPlainText（内容切片）
// ============================================================================

/** markdownToTxt 的图片来源回调（导出默认走旧正则链等价行为 `!` + alt） */
export type TxtImagePlaceholder = (alt: string) => string;

export interface MarkdownToTxtOptions {
  includeFrontmatter?: boolean;
  includeWikiLinks?: boolean;
  /** 图片占位；缺省 `!` + alt（旧 14 条正则链「链接规则先于图片规则」的等价产物） */
  imagePlaceholder?: TxtImagePlaceholder;
}

/**
 * Markdown → 纯文本（exportTxt 与 ShareDialog TXT 分享共用的适配器）。
 *
 * 旧实现为 14 条全局正则链；现走 export-model 块遍历 + renderer stripToPlainText。
 * 等价快照固化的行为细节全部保留：
 *   - 图片输出 `!` + alt（旧链链接规则先于图片规则，剥掉 `[]()` 留下前导 `!`）；
 *   - 任务项残留 `[x]`（旧链先剥 bullet 后任务正则失配）；
 *   - 代码围栏内容保留无反引号、围栏行退化为单反引号行（旧链行内码正则先于
 *     围栏正则的全局副作用）；
 *   - 行首缩进的嵌套列表项标记原样保留（旧链 `^[-*+]` 不带 `^\s*` 够不到）；
 *   - 表格按源码行原样保留；hr/空行压缩/首尾 trim 不变。
 */
export function markdownToTxt(md: string, options?: MarkdownToTxtOptions): string {
  const processed = preprocessMarkdown(md, {
    includeFrontmatter: options?.includeFrontmatter ?? true,
    includeWikiLinks: options?.includeWikiLinks ?? true,
    codeLineNumbers: false,
  });
  const model = buildExportModel(processed);
  const { source } = model;
  const slice = (range: SourceRange): string => source.slice(range.from, range.to);
  const imagePlaceholder = options?.imagePlaceholder ?? ((alt: string) => `!${alt}`);

  // 段：块 → 文本段；同列表组相邻项以 '\n' 并入同段（对齐旧链的原始换行）。
  const segments: string[] = [];
  let lastListGroup: number | null = null;

  const pushSegment = (text: string): void => {
    if (text === '') return;
    segments.push(text);
    lastListGroup = null;
  };

  for (const block of model.blocks) {
    switch (block.type) {
      case 'frontmatter':
        pushSegment(stripToPlainTextForTxt(block.rawContent, imagePlaceholder));
        break;

      case 'heading':
        pushSegment(stripToPlainTextForTxt(slice(block.contentRange), imagePlaceholder));
        break;

      case 'paragraph':
        pushSegment(stripToPlainTextForTxt(block.text, imagePlaceholder));
        break;

      case 'blockquote':
        pushSegment(
          block.lines
            .map((line) => stripToPlainTextForTxt(slice(line.contentRange), imagePlaceholder))
            .join('\n'),
        );
        break;

      case 'codeFence': {
        // 旧链固化行为：开围栏行退化为 '`' + lang，闭围栏行退化为 '`'，
        // 内容原样保留。
        const openLine = block.lang ? `\`${block.lang}` : '`';
        const content = block.contentRange ? slice(block.contentRange) : '';
        const closeLine = '`';
        pushSegment(
          content === '' ? `${openLine}\n${closeLine}` : `${openLine}\n${content}\n${closeLine}`,
        );
        break;
      }

      case 'listItem': {
        const text = stripToPlainTextForTxt(slice(block.contentRange), imagePlaceholder);
        let lineText: string;
        if (block.indent > 0) {
          // 嵌套项：旧链行首正则表示够不到缩进行，标记与缩进原样保留
          lineText = `${' '.repeat(block.indent)}${slice(block.markerRange)} ${text}`;
        } else {
          // 顶层项：bullet / 有序编号剥除；任务复选标记一并清涂（明示变化⑥，
          // 旧链残留 [x] 为正则事故产物，Leader 裁决为改进型漂移）
          lineText = text;
        }
        if (block.groupId === lastListGroup && segments.length > 0) {
          segments[segments.length - 1] += `\n${lineText}`;
        } else {
          segments.push(lineText);
        }
        lastListGroup = block.groupId;
        break;
      }

      case 'table':
        // 旧链对表格行不做块级处理（行内规则全局作用）——源码切片 + 行内剥净
        pushSegment(stripToPlainTextForTxt(slice(block.range), imagePlaceholder));
        break;

      case 'horizontalRule':
        // 旧链删除整行 hr
        break;

      case 'refDefinition':
        // 旧 14 条正则链对 `[label]: url` 行无命中规则 → 原样透传（R1 MAJOR-2 修复）
        pushSegment(block.text);
        break;
    }
  }

  return segments
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** stripToPlainText 的本文件别名（集中 import 面，便于审计无 marked 依赖） */
function stripToPlainTextForTxt(text: string, imagePlaceholder: TxtImagePlaceholder): string {
  return stripToPlainText(text, { imagePlaceholder });
}

function exportTxt(md: string, fileName: string, options?: Partial<ExportOptions>): ExportResult {
  const opts = buildInternalOpts(options);
  const processed = markdownToTxt(md, {
    includeFrontmatter: opts.includeFrontmatter,
    includeWikiLinks: opts.includeWikiLinks,
  });

  triggerDownload(processed, `${fileName}.txt`, 'text/plain;charset=UTF-8', options?.signal);
  return { success: true, format: ExportFormat.TXT, fileName: `${fileName}.txt` };
}

// ============================================================================
// HTML — self-contained with embedded CSS
// ============================================================================

/**
 * 与 exportHtml 同源的完整 HTML 文档产物。
 * ShareDialog 的 HTML 分享复用本函数（WO-D3 收敛：删除其本地 CSS/escapeHtml 副本）。
 */
export function buildHtmlDocument(
  md: string,
  fileName: string,
  options?: Partial<ExportOptions>,
): string {
  const opts = buildInternalOpts(options);
  const bodyHtml = renderToStyledHtml(md, opts);

  return `<!DOCTYPE html>
<html lang="${getCurrentLocale()}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(fileName)}</title>
  <style>${embeddedCss()}</style>
</head>
<body>
  <article class="markdown-body">
    ${bodyHtml}
  </article>
</body>
</html>`;
}

function exportHtml(md: string, fileName: string, options?: Partial<ExportOptions>): ExportResult {
  const html = buildHtmlDocument(md, fileName, options);

  triggerDownload(html, `${fileName}.html`, 'text/html;charset=UTF-8', options?.signal);
  return { success: true, format: ExportFormat.HTML, fileName: `${fileName}.html` };
}

// ============================================================================
// Embedded CSS for HTML / PDF exports (Paper theme, light mode, self-contained)
// ============================================================================

/**
 * EMBEDDED_CSS — 导出 HTML/PDF 的自包含样式表。
 *
 * 所有色值引用 Paper 主题 OKLCH Token（权威来源：paper.css Light 模式）。
 * 由于导出 HTML 无外部依赖，Token 值在 :root 中内联定义。
 * 修改 paper.css 时需同步更新此处的 :root 值。
 *
 * @see packages/app/src/assets/styles/themes/paper.css — OKLCH Token 权威定义
 */
function embeddedCss(): string {
  return EMBEDDED_CSS.replace('__JOTLUCK_FONT_STACK__', getLocaleFontStack());
}

const EMBEDDED_CSS = /* css */ `
/* ── Paper Token (self-contained, synced with paper.css light) ── */
:root {
  --ink-primary: oklch(0.15 0.003 85);
  --ink-secondary: oklch(0.42 0.003 85);
  --ink-muted: oklch(0.6 0.002 85);
  --paper-bg: oklch(0.975 0.003 85);
  --paper-surface: oklch(0.985 0.002 85);
  --paper-raised: oklch(1 0 0);
  --accent: oklch(0.52 0.12 250);
  --accent-soft: oklch(0.92 0.03 250 / 0.55);
  --rule: oklch(0.88 0.003 85);
  --code-bg: oklch(0.96 0.002 85);
  --code-block-bg: oklch(0.97 0.002 85);
  --code-text: oklch(0.18 0.005 85);
  --table-stripe: oklch(0.97 0.002 85);
}

/* ── Reset & Base ── */
*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  padding: 40px 24px;
  font-family: __JOTLUCK_FONT_STACK__;
  font-size: 16px;
  line-height: 1.8;
  color: var(--ink-primary);
  background: var(--paper-bg);
  -webkit-font-smoothing: antialiased;
}

.markdown-body {
  max-width: 720px;
  margin: 0 auto;
}

/* ── Headings ── */
.markdown-body h1 { font-size: 1.8em; font-weight: 700; margin: 1.2em 0 0.4em; line-height: 1.3; color: var(--ink-primary); border-bottom: 2px solid var(--rule); padding-bottom: 0.3em; }
.markdown-body h2 { font-size: 1.45em; font-weight: 700; margin: 1em 0 0.3em; line-height: 1.3; color: var(--ink-primary); }
.markdown-body h3 { font-size: 1.2em; font-weight: 600; margin: 0.8em 0 0.2em; line-height: 1.35; color: var(--ink-primary); }
.markdown-body h4 { font-size: 1.05em; font-weight: 600; margin: 0.7em 0 0.2em; line-height: 1.35; color: var(--ink-primary); }
.markdown-body h5 { font-size: 0.95em; font-weight: 600; margin: 0.6em 0 0.2em; color: var(--ink-secondary); }
.markdown-body h6 { font-size: 0.85em; font-weight: 600; margin: 0.5em 0 0.2em; color: var(--ink-muted); }

/* ── Paragraph ── */
.markdown-body p { margin: 0 0 0.8em; }

/* ── Links ── */
.markdown-body a { color: var(--accent); text-decoration: none; }
.markdown-body a:hover { text-decoration: underline; }
.markdown-body a.wikilink { text-decoration: underline dotted; }
.markdown-body a.wikilink--dead { color: var(--ink-muted); text-decoration: underline wavy; }
.markdown-body a.md-tag { color: var(--accent); background: var(--accent-soft); padding: 0 0.35em; border-radius: 3px; font-size: 0.9em; text-decoration: none; }

/* ── Code ── */
.markdown-body code {
  font-family: 'Fira Code', 'Cascadia Code', Consolas, monospace;
  font-size: 0.88em;
  background: var(--code-bg);
  padding: 2px 6px;
  border-radius: 3px;
  color: var(--code-text);
}
.markdown-body pre {
  background: var(--code-block-bg);
  border: 1px solid var(--rule);
  border-radius: 4px;
  padding: 16px;
  overflow-x: auto;
  margin: 1em 0;
  line-height: 1.55;
}
.markdown-body pre code {
  background: none;
  padding: 0;
  color: var(--ink-primary);
  font-size: 0.88em;
}

/* ── Blockquote ── */
.markdown-body blockquote {
  border: 1px solid var(--rule);
  border-radius: 4px;
  margin: 1em 0;
  padding: 0.5em 1em;
  color: var(--ink-muted);
  background: var(--paper-surface);
}
.markdown-body blockquote p { margin: 0.4em 0; }

/* ── Lists ── */
.markdown-body ul, .markdown-body ol { margin: 0.6em 0; padding-left: 1.8em; }
.markdown-body li { margin: 0.2em 0; }
.markdown-body input[type="checkbox"] { margin-right: 0.4em; accent-color: var(--accent); pointer-events: none; }

/* ── Tables ── */
.markdown-body table { border-collapse: collapse; width: 100%; margin: 1em 0; }
.markdown-body th, .markdown-body td { border: 1px solid var(--rule); padding: 8px 12px; text-align: left; }
.markdown-body th { background: var(--table-stripe); font-weight: 600; }
.markdown-body tr:nth-child(even) { background: var(--paper-bg); }

/* ── Horizontal Rule ── */
.markdown-body hr { border: none; border-top: 2px solid var(--rule); margin: 2em 0; }

/* ── Images ── */
.markdown-body img { max-width: 100%; height: auto; border-radius: 4px; }

/* ── Strong / Emphasis ── */
.markdown-body strong { font-weight: 700; }
.markdown-body em { font-style: italic; }
.markdown-body del { text-decoration: line-through; color: var(--ink-muted); }

/* ── Print Overrides ── */
@media print {
  body { background: var(--paper-raised); padding: 0; }
  .markdown-body { max-width: none; }
  .markdown-body pre { background: var(--code-block-bg); border: 1px solid var(--rule); }
  .markdown-body blockquote { background: none; }
}
`;

// ============================================================================
// HTML Escape Helper
// ============================================================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================================
// Main Export Dispatcher
// ============================================================================

export async function exportNote(
  markdown: string,
  fileName: string,
  options?: Partial<ExportOptions>,
): Promise<ExportResult> {
  throwIfExportAborted(options?.signal);
  if (!markdown && markdown !== '') {
    return {
      success: false,
      format: options?.format ?? ExportFormat.PDF,
      error: translate('export.empty'),
    };
  }

  const fmt = options?.format ?? ExportFormat.PDF;

  switch (fmt) {
    case ExportFormat.PDF:
      return exportPDF(markdown, fileName, options);
    case ExportFormat.DOCX:
      return exportDocx(markdown, fileName, options);
    case ExportFormat.XLSX:
      return exportXlsx(markdown, fileName, options);
    case ExportFormat.CSV:
      return exportCsv(markdown, fileName, options);
    case ExportFormat.TXT:
      return exportTxt(markdown, fileName, options);
    case ExportFormat.HTML:
      return exportHtml(markdown, fileName, options);
    default:
      return {
        success: false,
        format: fmt,
        error: translate('export.unsupported', { format: fmt }),
      };
  }
}
