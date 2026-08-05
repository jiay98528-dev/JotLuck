/**
 * Exporter — 6 格式导出服务
 *
 * PDF (window.print + rendered HTML) / DOCX (docx.js) / XLSX (write-excel-file) /
 * CSV / TXT / HTML (self-contained)
 *
 * @see TAD.md §7.2
 * @see doc/PRD.md §F-09
 */
import type { ExportOptions, ExportResult } from '@/types';
import { ExportFormat } from '@/types';
import { renderMarkdown } from '@jotluck/renderer';
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
import { marked } from 'marked';
import type { Token, Tokens } from 'marked';
import writeXlsxFile, { type Sheet, type SheetData } from 'write-excel-file/browser';
import { getCurrentLocale, getLocaleDocumentFont, getLocaleFontStack, translate } from '@/i18n';

// ============================================================================
// Internal Options — aligned with ExportOptions type
// ============================================================================

interface InternalExportOptions {
  includeFrontmatter: boolean;
  includeWikiLinks: boolean;
  codeLineNumbers: boolean;
  imageHandling: 'embed' | 'attach' | 'link' | 'omit';
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
    imageHandling: options?.imageHandling ?? 'link',
  };
}

// DOCX 颜色常量（docx 库 API 仅接受 6 位 hex 字符串，无法使用 oklch()）
// 值来源于 paper.css Light 主题 OKLCH Token 的 sRGB 近似
const DOCX_COLORS = {
  TABLE_HEADER_BG: 'E8E8E8', // ~oklch(0.93 0.002 85) — --table-stripe
  HR_BORDER: 'CCCCCC', // ~oklch(0.80 0.003 85) — --rule-mid
} as const;

// ============================================================================
// Markdown Preprocessing
// ============================================================================

const FRONTMATTER_RE = /^---\s*\n[\s\S]*?\n---\s*\n/;

function stripFrontmatter(md: string): string {
  return md.replace(FRONTMATTER_RE, '');
}

/**
 * Convert wiki-links [[...]] to regular Markdown links or plain text.
 * Wiki-links with | alias: [[target|alias]] → [alias](target) or alias
 * Wiki-links with # anchor: [[target#section]] → [target > section](target)
 */
function convertWikiLinks(md: string, include: boolean): string {
  if (include) {
    // Convert [[target]] → [target](target) for proper link rendering in exports
    return md.replace(/\[\[([^\]]+)\]\]/g, (_m: string, inner: string) => {
      const parts = inner.split('|');
      const target = parts[0]!.split('#');
      const note = target[0]!;
      const anchor = target[1] ? `#${target[1]}` : '';
      const text = parts[1] || target[0];
      return `[${text}](${note}${anchor})`;
    });
  }
  // Strip wiki-link syntax, keep text
  return md.replace(/\[\[([^\]]+)\]\]/g, (_m: string, inner: string) => {
    const parts = inner.split('|');
    return parts[1] || parts[0]!.split('#')[0]!;
  });
}

function preprocessMarkdown(md: string, opts: InternalExportOptions): string {
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
  const bodyHtml = renderToStyledHtml(md, opts);
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
// DOCX — marked.lexer() → docx.js elements
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

/** Build docx TextRun array from marked inline tokens, with cascading format context */
function buildTextRuns(tokens: Token[] | undefined, fmt: InlineFormat = {}): TextRun[] {
  if (!tokens || tokens.length === 0) {
    return [new TextRun({ text: '', ...fmt })];
  }

  const runs: TextRun[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'text': {
        const t = token as Tokens.Text;
        if (t.text) runs.push(new TextRun({ text: t.text, ...fmt }));
        break;
      }
      case 'strong': {
        const t = token as Tokens.Strong;
        runs.push(...buildTextRuns(t.tokens, { ...fmt, bold: true }));
        break;
      }
      case 'em': {
        const t = token as Tokens.Em;
        runs.push(...buildTextRuns(t.tokens, { ...fmt, italics: true }));
        break;
      }
      case 'codespan': {
        const t = token as Tokens.Codespan;
        runs.push(new TextRun({ text: t.text, font: 'Consolas', size: 20, ...fmt }));
        break;
      }
      case 'del': {
        const t = token as Tokens.Del;
        runs.push(...buildTextRuns(t.tokens, { ...fmt, strike: true }));
        break;
      }
      case 'link': {
        const t = token as Tokens.Link;
        // Word default style — no custom color, underline only
        runs.push(
          ...buildTextRuns(t.tokens, {
            ...fmt,
            underline: { type: 'single' as const },
          }),
        );
        break;
      }
      case 'image': {
        const t = token as Tokens.Image;
        runs.push(
          new TextRun({
            text: `[Image${t.title ? ': ' + t.title : ''}]`,
            italics: true,
            color: '999999',
          }),
        );
        break;
      }
      case 'html': {
        const t = token as Tokens.HTML;
        const stripped = t.text.replace(/<[^>]*>/g, '');
        if (stripped) runs.push(new TextRun({ text: stripped, ...fmt }));
        break;
      }
      case 'br': {
        runs.push(new TextRun({ break: 1 }));
        break;
      }
      case 'escape': {
        const t = token as Tokens.Escape;
        runs.push(new TextRun({ text: t.text, ...fmt }));
        break;
      }
      // Custom JotLuck inline token types — render as plain text
      case 'wikiLink':
      case 'tag': {
        const t = token as { raw?: string; text?: string };
        runs.push(new TextRun({ text: t.text || t.raw || '', ...fmt }));
        break;
      }
      default:
        break;
    }
  }

  return runs.length > 0 ? runs : [new TextRun({ text: '', ...fmt })];
}

/**
 * Check if a list item's tokens are inline (tight list) or block (loose list).
 * In tight lists, tokens[0] is text/strong/em/etc.
 * In loose lists, tokens[0] is paragraph.
 */
function isInlineToken(token: Token | undefined): boolean {
  if (!token) return true;
  const inlineTypes = new Set([
    'text',
    'strong',
    'em',
    'codespan',
    'link',
    'image',
    'del',
    'html',
    'br',
    'escape',
    'wikiLink',
    'tag',
  ]);
  return inlineTypes.has(token.type);
}

/** Build docx Paragraph / Table children from marked block tokens */
function buildDocxChildren(blocks: Token[], _opts: InternalExportOptions): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = [];

  for (const token of blocks) {
    switch (token.type) {
      // ── Heading ──
      case 'heading': {
        const t = token as Tokens.Heading;
        const fmt = headingFormat(t.depth);
        children.push(
          new Paragraph({
            heading: mapHeadingLevel(t.depth),
            spacing: { before: 240, after: 120 },
            children: buildTextRuns(t.tokens, { ...fmt }),
          }),
        );
        break;
      }

      // ── Paragraph ──
      case 'paragraph': {
        const t = token as Tokens.Paragraph;
        children.push(
          new Paragraph({
            spacing: { after: 120 },
            children: buildTextRuns(t.tokens),
          }),
        );
        break;
      }

      // ── Code Block ──
      case 'code': {
        const t = token as Tokens.Code;
        const lines = t.text.split('\n');
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
        const t = token as Tokens.Blockquote;
        const innerChildren = buildDocxChildren(t.tokens, _opts);
        // Add left border indent to indicate blockquote
        for (const child of innerChildren) {
          if (child instanceof Paragraph) {
            // Create a new paragraph with indent
            const existingSpacing = (child as { spacing?: { before?: number; after?: number } })
              .spacing;
            children.push(
              new Paragraph({
                spacing: existingSpacing || { after: 120 },
                indent: { left: 480 },
                border: { left: { style: BorderStyle.SINGLE, size: 6, color: '999999' } },
                children: (child as { children?: TextRun[] }).children || [
                  new TextRun({ text: '' }),
                ],
              }),
            );
          } else {
            children.push(child);
          }
        }
        break;
      }

      // ── List ──
      case 'list': {
        const t = token as Tokens.List;
        let itemIndex = 0;
        for (const item of t.items) {
          itemIndex++;
          const useInline = item.tokens.length > 0 && isInlineToken(item.tokens[0]);

          if (useInline) {
            // Tight list — single paragraph with bullet/number
            const prefix = t.ordered ? `${itemIndex}. ` : '';
            const itemRuns: TextRun[] = [];

            if (prefix) {
              itemRuns.push(new TextRun({ text: prefix }));
            }
            itemRuns.push(...buildTextRuns(item.tokens));

            children.push(
              new Paragraph({
                spacing: { before: 40, after: 40 },
                indent: { left: 480, hanging: 240 },
                bullet: t.ordered ? undefined : { level: 0 },
                children: itemRuns,
              }),
            );
          } else {
            // Loose list — item contains block tokens
            const innerBlocks = buildDocxChildren(item.tokens, _opts);
            for (let bi = 0; bi < innerBlocks.length; bi++) {
              const block = innerBlocks[bi]!;
              if (block instanceof Paragraph) {
                const prefix = bi === 0 && t.ordered ? `${itemIndex}. ` : '';
                const existingChildren = (block as { children?: TextRun[] }).children;
                const runs: TextRun[] = prefix
                  ? [new TextRun({ text: prefix }), ...(existingChildren || [])]
                  : existingChildren || [new TextRun({ text: '' })];

                children.push(
                  new Paragraph({
                    spacing: { before: 40, after: 40 },
                    indent: { left: 480, hanging: 240 },
                    bullet: t.ordered ? undefined : { level: 0 },
                    children: runs,
                  }),
                );
              } else {
                children.push(block);
              }
            }
          }
        }
        break;
      }

      // ── Table ──
      case 'table': {
        const t = token as Tokens.Table;
        const rows: TableRow[] = [];

        // Header row
        const headerCells: TableCell[] = [];
        for (const cell of t.header) {
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
                  children: buildTextRuns(cell.tokens),
                }),
              ],
            }),
          );
        }
        rows.push(new TableRow({ children: headerCells }));

        // Data rows
        for (const row of t.rows) {
          const dataCells: TableCell[] = [];
          for (const cell of row) {
            dataCells.push(
              new TableCell({
                children: [
                  new Paragraph({
                    children: buildTextRuns(cell.tokens),
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
      case 'hr': {
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

      // ── Space / HTML / custom — skip ──
      case 'space':
      default:
        break;
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

  // Use marked.lexer() to parse into block tokens
  const tokens = marked.lexer(processed);
  const children = buildDocxChildren(tokens, opts);

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
// XLSX — write-excel-file table extraction
// ============================================================================

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

function extractMarkdownTables(md: string): ParsedTable[] {
  const tables: ParsedTable[] = [];
  const lines = md.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    // Detect table header: starts/ends with | and contains at least one |
    if (line.includes('|') && line.trim().startsWith('|')) {
      const headerCells = parseTableRow(line);
      const nextLine = lines[i + 1];

      // Must have separator line (|---|---|)
      if (nextLine && /^\|[\s\-:|]+\|$/.test(nextLine.trim())) {
        const headers = headerCells;
        const rows: string[][] = [];
        i += 2; // Skip header + separator

        // Collect data rows
        while (i < lines.length && lines[i]!.includes('|')) {
          rows.push(parseTableRow(lines[i]!));
          i++;
        }

        tables.push({ headers, rows });
        continue;
      }
    }
    i++;
  }

  return tables;
}

function parseTableRow(line: string): string[] {
  return line
    .split('|')
    .slice(1, -1) // Remove leading/trailing empty from pipe-split
    .map((cell) => cell.trim());
}

function tableToSheetData(table: ParsedTable): SheetData {
  return [table.headers, ...table.rows];
}

function buildXlsxColumns(table: ParsedTable): { width: number }[] {
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

function escapeCsvCell(cell: string): string {
  const safeCell = protectCsvFormula(cell);
  if (safeCell.includes(',') || safeCell.includes('"') || safeCell.includes('\n')) {
    return `"${safeCell.replace(/"/g, '""')}"`;
  }
  return safeCell;
}

function protectCsvFormula(cell: string): string {
  return /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
}

// ============================================================================
// TXT — strip Markdown syntax
// ============================================================================

function exportTxt(md: string, fileName: string, options?: Partial<ExportOptions>): ExportResult {
  const opts = buildInternalOpts(options);
  let processed = preprocessMarkdown(md, opts);

  // Strip common Markdown syntax markers
  processed = processed
    // Headings: remove # markers, keep text
    .replace(/^#{1,6}\s+/gm, '')
    // Setext headings
    .replace(/^[=\-]{3,}$/gm, '')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '$1')
    // Italic
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1')
    // Inline code
    .replace(/`(.+?)`/g, '$1')
    // Links: [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Images: ![alt](url) → [Image: alt]
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, (_m, alt: string) =>
      alt ? translate('export.imageWithAlt', { alt }) : translate('export.image'),
    )
    // Blockquote prefix
    .replace(/^>\s?/gm, '')
    // Unordered list markers
    .replace(/^[-*+]\s/gm, '')
    // Ordered list markers
    .replace(/^\d+\.\s/gm, '')
    // Task list markers
    .replace(/^- \[[ x]\] /gm, '')
    // Code fences (strip opening/closing, keep content)
    .replace(/^```[\s\S]*?^```/gm, (_m: string) => {
      return _m.replace(/^```.*\n?/gm, '').replace(/^```$/gm, '');
    })
    // Horizontal rules
    .replace(/^[-*_]{3,}$/gm, '')
    // Compress excessive blank lines
    .replace(/\n{3,}/g, '\n\n')
    // Trim leading/trailing whitespace
    .trim();

  triggerDownload(processed, `${fileName}.txt`, 'text/plain;charset=UTF-8', options?.signal);
  return { success: true, format: ExportFormat.TXT, fileName: `${fileName}.txt` };
}

// ============================================================================
// HTML — self-contained with embedded CSS
// ============================================================================

function exportHtml(md: string, fileName: string, options?: Partial<ExportOptions>): ExportResult {
  const opts = buildInternalOpts(options);
  const bodyHtml = renderToStyledHtml(md, opts);

  const html = `<!DOCTYPE html>
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
