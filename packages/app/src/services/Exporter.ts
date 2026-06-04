/**
 * Exporter — 多格式导出服务
 *
 * M3-01~05: PDF / DOCX / XLSX+CSV / TXT / HTML 导出。
 *
 * @module Exporter
 * @see milestones.md M3-01~05
 * @see TAD.md — PDF 使用 window.print()，零依赖库
 */

import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import * as XLSX from 'xlsx';
import { renderMarkdown } from '@markluck/renderer';
import { ExportFormat, type ExportOptions, type ExportResult } from '@/types';

/** 导出选项默认值 */
const DEFAULT_OPTIONS: ExportOptions = {
  format: ExportFormat.PDF,
  includeFrontmatter: true,
  includeWikiLinks: true,
  codeLineNumbers: true,
  imageHandling: 'omit',
};

/**
 * 执行导出
 *
 * @param markdown - Markdown 原始内容
 * @param fileName - 文件名（不含扩展名）
 * @param options - 导出选项
 */
export async function exportNote(
  markdown: string,
  fileName: string,
  options: Partial<ExportOptions> = {},
): Promise<ExportResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let content = preprocessMarkdown(markdown, opts);

  // P2-1: 图片嵌入 — 将本地路径替换为 base64 data URI
  if (opts.imageHandling === 'embed' && opts.readBinary) {
    content = await resolveImages(content, opts.readBinary);
  } else if (opts.imageHandling === 'omit') {
    content = content.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');
  }

  switch (opts.format) {
    case ExportFormat.PDF:
      return await exportPDF(content, fileName);
    case ExportFormat.DOCX:
      return await exportDocx(content, fileName);
    case ExportFormat.XLSX:
      return await exportXlsx(content, fileName);
    case ExportFormat.CSV:
      return await exportCsv(content, fileName);
    case ExportFormat.TXT:
      return await exportTxt(content, fileName);
    case ExportFormat.HTML:
      return await exportHtml(content, fileName);
    default:
      throw new Error(`不支持的导出格式: ${opts.format}`);
  }
}

/**
 * PDF 导出 — 使用 window.print()，依赖打印 CSS
 */
async function exportPDF(content: string, fileName: string): Promise<ExportResult> {
  // 创建隐藏 iframe 用于打印
  const html = buildHtmlWrapper(content, fileName);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);

  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = url;
    document.body.appendChild(iframe);

    iframe.onload = () => {
      try {
        iframe.contentWindow?.print();
        resolve({
          success: true,
          format: ExportFormat.PDF,
          fileName: `${fileName}.pdf`,
          message: '已发送到打印机',
        });
      } catch (e) {
        resolve({
          success: false,
          format: ExportFormat.PDF,
          fileName: `${fileName}.pdf`,
          error: e instanceof Error ? e.message : '打印失败',
        });
      } finally {
        setTimeout(() => {
          document.body.removeChild(iframe);
          URL.revokeObjectURL(url);
        }, 1000);
      }
    };
  });
}

/**
 * DOCX 导出 — 使用 docx.js
 */
async function exportDocx(markdown: string, fileName: string): Promise<ExportResult> {
  const paragraphs = markdownToDocxParagraphs(markdown);

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: paragraphs,
      },
    ],
  });

  try {
    const blob = await Packer.toBlob(doc);
    downloadBlob(blob, `${fileName}.docx`);
    return { success: true, format: ExportFormat.DOCX, fileName: `${fileName}.docx` };
  } catch (e) {
    return {
      success: false,
      format: ExportFormat.DOCX,
      fileName: `${fileName}.docx`,
      error: e instanceof Error ? e.message : 'DOCX 导出失败',
    };
  }
}

/**
 * XLSX 导出 — 使用 sheetjs（仅导出表格内容）
 */
async function exportXlsx(markdown: string, fileName: string): Promise<ExportResult> {
  try {
    const tables = extractTables(markdown);
    if (tables.length === 0) {
      // 无表格时导出全文为单 sheet
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([['内容'], [markdown]]);
      XLSX.utils.book_append_sheet(wb, ws, '笔记内容');
      XLSX.writeFile(wb, `${fileName}.xlsx`);
    } else {
      const wb = XLSX.utils.book_new();
      tables.forEach((table, idx) => {
        const ws = XLSX.utils.aoa_to_sheet(table);
        XLSX.utils.book_append_sheet(wb, ws, `表格${idx + 1}`);
      });
      XLSX.writeFile(wb, `${fileName}.xlsx`);
    }
    return { success: true, format: ExportFormat.XLSX, fileName: `${fileName}.xlsx` };
  } catch (e) {
    return {
      success: false,
      format: ExportFormat.XLSX,
      fileName: `${fileName}.xlsx`,
      error: e instanceof Error ? e.message : 'XLSX 导出失败',
    };
  }
}

/**
 * CSV 导出 — 使用 sheetjs
 */
async function exportCsv(markdown: string, fileName: string): Promise<ExportResult> {
  try {
    const tables = extractTables(markdown);
    if (tables.length === 0) {
      const ws = XLSX.utils.aoa_to_sheet([['内容'], [markdown]]);
      const csv = XLSX.utils.sheet_to_csv(ws);
      downloadText(csv, `${fileName}.csv`, 'text/csv');
    } else {
      const ws = XLSX.utils.aoa_to_sheet(tables[0] ?? [['无数据']]);
      const csv = XLSX.utils.sheet_to_csv(ws);
      downloadText(csv, `${fileName}.csv`, 'text/csv');
    }
    return { success: true, format: ExportFormat.CSV, fileName: `${fileName}.csv` };
  } catch (e) {
    return {
      success: false,
      format: ExportFormat.CSV,
      fileName: `${fileName}.csv`,
      error: e instanceof Error ? e.message : 'CSV 导出失败',
    };
  }
}

/**
 * TXT 导出 — 去除 Markdown 语法标记
 */
async function exportTxt(markdown: string, fileName: string): Promise<ExportResult> {
  const text = stripMarkdownSyntax(markdown);
  downloadText(text, `${fileName}.txt`, 'text/plain');
  return { success: true, format: ExportFormat.TXT, fileName: `${fileName}.txt` };
}

/**
 * HTML 导出 — 自包含 HTML（内嵌 CSS）
 */
async function exportHtml(markdown: string, fileName: string): Promise<ExportResult> {
  const html = buildHtmlWrapper(markdown, fileName);
  downloadText(html, `${fileName}.html`, 'text/html');
  return { success: true, format: ExportFormat.HTML, fileName: `${fileName}.html` };
}

// ---- Private Helpers ----

/** 预处理 Markdown：根据选项处理 frontmatter 等 */
/** 将 Markdown 中的本地图片路径转换为 base64 data URI */
async function resolveImages(
  md: string,
  readBinary: (path: string) => Promise<string>,
): Promise<string> {
  const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const matches = [...md.matchAll(imgRegex)];
  if (matches.length === 0) return md;

  let result = md;
  for (const m of matches.reverse()) {
    // 从后往前替换，保持位置正确
    const path = m[2] || '';
    // 跳过已经是 data URI 或 http(s) 的路径
    if (path.startsWith('data:') || path.startsWith('http')) continue;

    try {
      const base64 = await readBinary(path);
      if (base64) {
        const ext = path.split('.').pop()?.toLowerCase() ?? 'png';
        const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
        const dataUri = base64.startsWith('data:') ? base64 : `data:${mime};base64,${base64}`;
        result =
          result.slice(0, m.index!) +
          `![${m[1] || ''}](${dataUri})` +
          result.slice(m.index! + m[0].length);
      }
    } catch {
      // 图片不可用 — 保留原始语法
    }
  }
  return result;
}

function preprocessMarkdown(md: string, opts: ExportOptions): string {
  let content = md;
  if (!opts.includeFrontmatter) {
    content = content.replace(/^---[\s\S]*?---\s*\n/, '');
  }
  return content;
}

/** 渲染 Markdown 为 HTML */
function markdownToHtml(md: string): string {
  return renderMarkdown(md);
}

/** 构建自包含 HTML 包装器 */
function buildHtmlWrapper(content: string, title: string): string {
  const bodyHtml = markdownToHtml(content);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 16px;
      line-height: 1.8;
      color: #333;
    }
    h1 { font-size: 2em; margin-top: 1em; }
    h2 { font-size: 1.5em; margin-top: 1em; }
    h3 { font-size: 1.25em; margin-top: 0.8em; }
    h4, h5, h6 { font-size: 1.1em; margin-top: 0.6em; }
    pre { background: #f5f5f5; padding: 1em; border-radius: 4px; overflow-x: auto; }
    code { font-family: 'Fira Code', 'Cascadia Code', monospace; font-size: 0.9em; }
    blockquote { border-left: 3px solid #ddd; margin-left: 0; padding-left: 1em; color: #666; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f5f5f5; }
    img { max-width: 100%; }
    .wiki-link { color: oklch(0.5 0.13 255); }
    .wiki-link--dead { color: oklch(0.5 0.15 25); text-decoration: line-through; }
    .inline-tag { color: oklch(0.5 0.13 145); background: oklch(0.5 0.13 145 / 0.1); padding: 1px 6px; border-radius: 3px; }
    @media print {
      body { max-width: none; padding: 0; }
      pre, blockquote { break-inside: avoid; }
    }
  </style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

// ---- Markdown → DOCX 转换 ----

function markdownToDocxParagraphs(md: string): Paragraph[] {
  const lines = md.split('\n');
  const paragraphs: Paragraph[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      paragraphs.push(new Paragraph({ spacing: { after: 120 } }));
      continue;
    }

    // 标题
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1]?.length ?? 1;
      const headingMap: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3,
        4: HeadingLevel.HEADING_4,
        5: HeadingLevel.HEADING_5,
        6: HeadingLevel.HEADING_6,
      };
      paragraphs.push(
        new Paragraph({
          heading: headingMap[level] ?? HeadingLevel.HEADING_1,
          children: [new TextRun({ text: headingMatch[2] ?? '', bold: true, color: '000000' })],
        }),
      );
      continue;
    }

    // 代码块
    if (line.startsWith('```')) {
      continue; // 代码块简化处理：跳过标记
    }

    // 无序列表
    if (/^[\s]*[-*+]\s/.test(line)) {
      const text = line.replace(/^[\s]*[-*+]\s/, '');
      paragraphs.push(
        new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun({ text })],
        }),
      );
      continue;
    }

    // 有序列表
    const olMatch = line.match(/^[\s]*\d+\.\s(.+)$/);
    if (olMatch) {
      paragraphs.push(
        new Paragraph({
          numbering: { reference: 'default', level: 0 },
          children: [new TextRun({ text: olMatch[1] ?? '' })],
        }),
      );
      continue;
    }

    // 引用
    if (line.startsWith('>')) {
      const text = line.replace(/^>\s*/, '');
      paragraphs.push(
        new Paragraph({
          indent: { left: 720 },
          children: [new TextRun({ text, italics: true, color: '666666' })],
        }),
      );
      continue;
    }

    // 分割线
    if (/^[-*_]{3,}$/.test(line.trim())) {
      paragraphs.push(
        new Paragraph({
          border: { bottom: { style: 'single', size: 1, color: 'CCCCCC' } },
          spacing: { before: 240, after: 240 },
          children: [],
        }),
      );
      continue;
    }

    // 普通段落
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: line })],
      }),
    );
  }

  return paragraphs;
}

// ---- Markdown → 纯文本 ----

function stripMarkdownSyntax(md: string): string {
  return (
    md
      // 去除 frontmatter
      .replace(/^---[\s\S]*?---\s*\n/, '')
      // 标题
      .replace(/^#{1,6}\s+/gm, '')
      // 粗体/斜体
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      // 删除线
      .replace(/~~([^~]+)~~/g, '$1')
      // 代码
      .replace(/`([^`]+)`/g, '$1')
      // 代码块标记
      .replace(/```[\s\S]*?```/g, '')
      // 链接 [text](url)
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // 图片 ![alt](url)
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '[图片: $1]')
      // Wiki-link
      .replace(/\[\[([^\]|#]+)(?:#[^\]]*)?(?:\|[^\]]+)?\]\]/g, '$1')
      // 标签
      .replace(/#([\w一-鿿]+)/g, '$1')
      // 引用
      .replace(/^>\s?/gm, '')
      // 列表标记
      .replace(/^[\s]*[-*+]\s/gm, '• ')
      .replace(/^[\s]*\d+\.\s/gm, '')
      // 分割线
      .replace(/^[-*_]{3,}\s*$/gm, '')
      // 多余空行
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

// 提取 Markdown 中的表格为二维数组
function extractTables(md: string): string[][][] {
  const tables: string[][][] = [];
  const tableRe = /\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)*)/g;
  let match: RegExpExecArray | null;

  while ((match = tableRe.exec(md)) !== null) {
    const headerRow =
      match[1]
        ?.split('|')
        .map((c) => c.trim())
        .filter(Boolean) ?? [];
    const bodyRows = (match[2] ?? '')
      .split('\n')
      .filter(Boolean)
      .map((row) =>
        row
          .split('|')
          .map((c) => c.trim())
          .filter(Boolean),
      );
    tables.push([headerRow, ...bodyRows]);
  }

  return tables;
}

// 工具函数
function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadText(content: string, fileName: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  downloadBlob(blob, fileName);
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (ch) => map[ch] ?? ch);
}
