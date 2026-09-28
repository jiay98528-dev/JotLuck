/**
 * 41-acceptance-export.spec.ts — 统一验收 D-01 导出产物核对
 *
 * 覆盖验收手册 D-01（doc/editor-increment-acceptance.md 第 110 行）：
 *   "导出 TXT、HTML、DOCX、表格；打开核对转义管道、任务和代码。
 *    与源内容一致，无拆错单元格、漏文或代码误转链接。"
 *
 * 各格式契约来源（依据实现文件的字节级契约，不是设想）：
 *   - TXT：packages/app/src/services/Exporter.ts 第 882-977 行 markdownToTxt
 *          + packages/renderer/src/inline.ts 第 137-176 行 stripToPlainText
 *   - HTML：Exporter.ts 第 1003-1032 行 buildHtmlDocument
 *          + renderMarkdown（packages/renderer/src/index.ts 第 275 行）
 *   - DOCX：Exporter.ts 第 682-733 行 exportDocx
 *          + 第 397-474 行 buildTextRuns；第 481-680 行 buildDocxChildren
 *   - XLSX：Exporter.ts 第 781-808 行 exportXlsx
 *          + 第 754-779 行 extractMarkdownTables / tableToSheetData / buildXlsxColumns
 *   - CSV ：Exporter.ts 第 814-840 行 exportCsv
 *          + 第 843-854 行 escapeCsvCell / protectCsvFormula
 *
 * DOCX/XLSX 是 ZIP 包；e2e 端不引入新依赖（root package.json 已含 docx，
 * 但 docx 包只写不读），用 node:zlib.inflateRawSync + 手写中央目录解析。
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import {
  waitForAppReady,
  openExportDialog,
  typeInEditor,
  waitForAutoSave,
  createBlankNote,
} from '../helpers/test-utils';

// ============================================================
// 材料 S：doc/editor-increment-acceptance.md 第 31-67 行原文
// （中文与管道等元字符逐字保留；本文件复制自验收手册，未做改写）
// ============================================================
const FIXTURE_MD = `# 第一章

普通中文与 emoji 👩‍💻，**加粗**、_斜体_、~~删除~~、\`代码\`、[链接](https://example.com)。

- 普通项
- [x] 已完成

1. 第一项

> 引用
>
> - 引用里的项目

| 名称   | 数量 |
| ------ | ---: |
| 甲\\|乙 |    2 |
| 丙     |    3 |

## 重复标题

首处 [[目标]]，同一行第二处 [[目标#章节|别名]]。

＃ 全角标题

－ 全角项目

# 下划线标题

## 重复标题

末处 [[目标]]。

\`\`\`text
[[目标]] 只是一段代码
- 不应自动续为列表
\`\`\`
`;

// ============================================================
// Minimal ZIP reader（仅依赖 node:zlib，无新 npm 依赖）
// 仅用于 DOCX（word/document.xml）与 XLSX
//   （xl/sharedStrings.xml + xl/worksheets/sheet1.xml）的解包
// ============================================================

interface ZipEntry {
  filename: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function findEOCD(buf: Buffer): number {
  // EOCD 签名 0x06054b50；从文件末尾向前扫描（注释最长 65535 字节）
  const SIG = 0x06054b50;
  const start = Math.max(0, buf.length - 22 - 0xffff);
  for (let p = buf.length - 22; p >= start; p--) {
    if (buf.readUInt32LE(p) === SIG) return p;
  }
  throw new Error('EOCD signature not found');
}

function parseCentralDirectory(buf: Buffer): ZipEntry[] {
  const eocdPos = findEOCD(buf);
  const cdSize = buf.readUInt32LE(eocdPos + 12);
  const cdOffset = buf.readUInt32LE(eocdPos + 16);
  const entries: ZipEntry[] = [];
  let p = cdOffset;
  const end = cdOffset + cdSize;
  while (p < end) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const compressionMethod = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const filenameLength = buf.readUInt16LE(p + 28);
    const extraFieldLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    const filename = buf.toString('utf8', p + 46, p + 46 + filenameLength);
    entries.push({
      filename,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    p += 46 + filenameLength + extraFieldLength + commentLength;
  }
  return entries;
}

function readZipEntry(buf: Buffer, entry: ZipEntry): Buffer {
  const p = entry.localHeaderOffset;
  if (buf.readUInt32LE(p) !== 0x04034b50) {
    throw new Error(`Invalid local header at ${p}`);
  }
  const filenameLength = buf.readUInt16LE(p + 26);
  const extraFieldLength = buf.readUInt16LE(p + 28);
  const dataStart = p + 30 + filenameLength + extraFieldLength;
  const compressed = buf.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.compressionMethod === 0) return Buffer.from(compressed);
  if (entry.compressionMethod === 8) return inflateRawSync(compressed);
  throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod}`);
}

function unzipAll(buf: Buffer): Map<string, string> {
  const entries = parseCentralDirectory(buf);
  const out = new Map<string, string>();
  for (const entry of entries) {
    out.set(entry.filename, readZipEntry(buf, entry).toString('utf8'));
  }
  return out;
}

// ============================================================
// DOCX / XLSX 文本提取工具
// ============================================================

/**
 * 从 DOCX 的 word/document.xml 中按段落顺序提取所有 <w:t> 文本。
 * DOCX 表格内文本位于嵌套 <w:p>，已按出现顺序覆盖到全局序列。
 */
function extractDocxParagraphs(documentXml: string): string[] {
  // 段落切分：以 <w:p ...> / </w:p> 边界为段落；表格内段落自然被包在 <w:tbl> 里
  const paragraphs: string[] = [];
  const paraRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let match: RegExpExecArray | null;
  while ((match = paraRe.exec(documentXml)) !== null) {
    const inner = match[1] ?? '';
    const runs: string[] = [];
    const textRe = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
    let tmatch: RegExpExecArray | null;
    while ((tmatch = textRe.exec(inner)) !== null) {
      runs.push(tmatch[1] ?? '');
    }
    paragraphs.push(runs.join(''));
  }
  return paragraphs;
}

/**
 * 从 DOCX 的 <w:tbl> 内提取所有单元格文本，组成二维矩阵。
 */
function extractDocxTables(documentXml: string): string[][][] {
  const tables: string[][][] = [];
  const tblRe = /<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/g;
  let tmatch: RegExpExecArray | null;
  while ((tmatch = tblRe.exec(documentXml)) !== null) {
    const tblInner = tmatch[1] ?? '';
    const rows: string[][] = [];
    const rowRe = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g;
    let rmatch: RegExpExecArray | null;
    while ((rmatch = rowRe.exec(tblInner)) !== null) {
      const rowInner = rmatch[1] ?? '';
      const cells: string[] = [];
      const cellRe = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g;
      let cmatch: RegExpExecArray | null;
      while ((cmatch = cellRe.exec(rowInner)) !== null) {
        const cellInner = cmatch[1] ?? '';
        const runs: string[] = [];
        const textRe = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
        let xmatch: RegExpExecArray | null;
        while ((xmatch = textRe.exec(cellInner)) !== null) {
          runs.push(xmatch[1] ?? '');
        }
        cells.push(runs.join(''));
      }
      rows.push(cells);
    }
    tables.push(rows);
  }
  return tables;
}

/**
 * 从 XLSX 的 xl/sharedStrings.xml 提取共享字符串序列。
 * XLSX 可能同时存在 inline 字符串（<is><t>...</t></is>）与共享字符串。
 */
function extractXlsxSharedStrings(sharedXml: string | undefined): string[] {
  if (!sharedXml) return [];
  const strings: string[] = [];
  // 支持 <si><t>x</t></si> 与 <si><r><t>x</t></r></si> 两种形态
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let simatch: RegExpExecArray | null;
  while ((simatch = siRe.exec(sharedXml)) !== null) {
    const inner = simatch[1] ?? '';
    const parts: string[] = [];
    const tRe = /<t(?:\s[^>]*)?>([^<]*)<\/t>/g;
    let tmatch: RegExpExecArray | null;
    while ((tmatch = tRe.exec(inner)) !== null) {
      parts.push(tmatch[1] ?? '');
    }
    strings.push(parts.join(''));
  }
  return strings;
}

/**
 * 从 XLSX 的 xl/worksheets/sheet1.xml 提取每个 sheet 的二维字符串矩阵。
 * 同时支持共享字符串 (t="s")、内联字符串 (t="inlineStr") 与数字 (t="n")。
 */
function extractXlsxSheet(
  sheetXml: string,
  sharedStrings: string[],
): { name: string; rows: string[][] }[] {
  const sheets: { name: string; rows: string[][] }[] = [];
  // 单 sheet 通常只有 sheet1；多 sheet 时按 worksheet 顺序遍历
  const sheetRe = /<worksheet\b[^>]*>([\s\S]*?)<\/worksheet>/g;
  let smatch: RegExpExecArray | null;
  while ((smatch = sheetRe.exec(sheetXml)) !== null) {
    const inner = smatch[1] ?? '';
    const rows: string[][] = [];
    const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    let rmatch: RegExpExecArray | null;
    while ((rmatch = rowRe.exec(inner)) !== null) {
      const rowInner = rmatch[1] ?? '';
      const cells: string[] = [];
      // 列顺序：按出现的 <c> 顺序即为其在 row 中的列位置（XLSX 不写空 cell）
      const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
      let cmatch: RegExpExecArray | null;
      while ((cmatch = cellRe.exec(rowInner)) !== null) {
        const attrs = cmatch[1] ?? cmatch[3] ?? '';
        const cellInner = cmatch[2] ?? '';
        const tMatch = /\bt="([^"]+)"/.exec(attrs);
        const cellType = tMatch ? tMatch[1] : 'n';
        let value = '';
        if (cellType === 's') {
          const vMatch = /<v>([^<]*)<\/v>/.exec(cellInner);
          const idx = vMatch ? Number.parseInt(vMatch[1] ?? '', 10) : NaN;
          value = Number.isFinite(idx) ? (sharedStrings[idx] ?? '') : '';
        } else if (cellType === 'inlineStr') {
          const tMatchInner = /<is\b[^>]*>([\s\S]*?)<\/is>|<t(?:\s[^>]*)?>([^<]*)<\/t>/.exec(
            cellInner,
          );
          value = tMatchInner ? (tMatchInner[2] ?? tMatchInner[1] ?? '') : '';
        } else {
          // number / shared number / 未指定
          const vMatch = /<v>([^<]*)<\/v>/.exec(cellInner);
          value = vMatch ? (vMatch[1] ?? '') : '';
        }
        cells.push(value);
      }
      rows.push(cells);
    }
    sheets.push({ name: 'Sheet1', rows });
  }
  return sheets;
}

// ============================================================
// 共用：执行导出并捕获下载
// ============================================================

async function exportAs(
  page: Page,
  format: 'TXT' | 'HTML' | 'DOCX' | 'XLSX' | 'CSV',
): Promise<string> {
  await openExportDialog(page);
  await expect(page.locator('.modal-overlay')).toBeVisible();
  await page.locator('.format-card', { hasText: format }).click();
  await expect(page.locator('.format-card.selected')).toContainText(format);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('.modal-footer button', { hasText: '导出' }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  return downloadPath!;
}

// ============================================================
// 测试套件
// ============================================================

test.describe('41 统一验收 导出产物核对', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
    // 用空白笔记装载材料 S，避免污染既有示例笔记
    await createBlankNote(page);
    // insertText: 单次注入，规避逐键路径对围栏/转义管道的影响
    await typeInEditor(page, FIXTURE_MD, { insertText: true });
    await waitForAutoSave(page);
  });

  // ─── 01 TXT ───────────────────────────────────────────────

  test('01-导出 TXT 文本保真核对（标题/段落/任务/代码/表格/管道）', async ({ page }) => {
    const downloadPath = await exportAs(page, 'TXT');
    const txt = await readFile(downloadPath, 'utf8');

    // markdownToTxt（Exporter.ts:882-977）按块输出，相邻 segment 用 '\n\n'，
    // 开头 trim()，因此首段不应有空行。
    // 标题：经 stripLinePrefixes 去掉 # 前缀，保留正文
    expect(txt).toContain('第一章');
    // 段落：stripToPlainText 剥掉 ** / * / ~~ / ` / []()
    expect(txt).toContain('加粗');
    expect(txt).toContain('斜体');
    expect(txt).toContain('删除');
    expect(txt).toContain('代码');
    expect(txt).toContain('链接');
    // 注意：stripToPlainText（inline.ts:147）会把 `[t](u)` 整段剥成 `t`，
    // URL 不进入 TXT 产物（与等价基线 Exporter.equivalence.test.ts 行 868 一致）。
    // 任务项：Exporter.ts:944 任务复选标记清涂（[x] 整段被剥），仅剩正文
    expect(txt).toContain('已完成');
    expect(txt).not.toContain('[x] 已完成');
    // 普通项 / 有序项：顶层级 marker 剥除（Exporter.ts:941）
    expect(txt).toContain('普通项');
    expect(txt).toContain('第一项');
    // 引用块：行间用 '\n' 连接
    expect(txt).toContain('引用');
    expect(txt).toContain('引用里的项目');
    // 围栏代码：Exporter.ts:928-934 旧链固化行为 → 开围栏退化为 '`lang' + 内容 + '`' 收尾
    expect(txt).toContain('`text');
    expect(txt).toContain('[[目标]] 只是一段代码');
    expect(txt).toContain('- 不应自动续为列表');
    // 表格保留为原始源码切片（Exporter.ts:957-960 走 stripToPlainTextForTxt(slice(block.range))
    // 而 stripToPlainText 不处理转义，故 `\|` 保留为字面 `\|`，且结构分隔符 | / 对齐行原样保留）
    expect(txt).toContain('| 名称');
    expect(txt).toContain('| ---:');
    // XLSX/CSV 上 `\|` 是单格保留；TXT 上表格同样按源码切片保留转义（stripToPlainText 不动 \|）
    expect(txt).toContain('甲\\|乙');
    expect(txt).toContain('丙');
    expect(txt).toContain('2');
    expect(txt).toContain('3');
    // wiki-link：默认 includeWikiLinks=true 走 convertWikiLinks → markdown link，
    // 再被 stripToPlainText 剥链为显示文本（Exporter.ts:106-160 / inline.ts:147）
    expect(txt).toContain('首处 目标');
    expect(txt).toContain('别名');
    expect(txt).toContain('末处 目标');
    // 全角标题/列表：normalizeFullwidthMarkdownSyntax 归一为半角 → strip 去掉前缀
    expect(txt).toContain('全角标题');
    expect(txt).toContain('全角项目');
    expect(txt).toContain('下划线标题');
    // 末行不带尾换行（segments.join('\n\n').trim()）
    expect(txt.endsWith('\n')).toBe(false);
    // 首段不应有前置空行
    expect(txt.startsWith('\n')).toBe(false);
  });

  // ─── 02 HTML ──────────────────────────────────────────────

  test('02-导出 HTML 渲染与净化核对（链接/任务复选框/代码块/表格管道）', async ({ page }) => {
    const downloadPath = await exportAs(page, 'HTML');
    const html = await readFile(downloadPath, 'utf8');

    // buildHtmlDocument（Exporter.ts:1003-1025）容器结构
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<article class="markdown-body">');
    expect(html).toContain('</html>');
    // 标题渲染为 h1
    expect(html).toMatch(/<h1[^>]*>第一章<\/h1>/);
    // 行内格式
    expect(html).toMatch(/<strong>加粗<\/strong>/);
    expect(html).toMatch(/<em>斜体<\/em>/);
    expect(html).toMatch(/<del>删除<\/del>/);
    expect(html).toMatch(/<code>代码<\/code>/);
    // 普通链接：HTML 输出 <a href="...">（marked 默认渲染 markdown link）
    expect(html).toMatch(/<a href="https:\/\/example\.com">链接<\/a>/);
    // 任务项渲染为带 checkbox 的 <li>（marked 18 默认产出 input + checked）
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*>\s*已完成/);
    // 列表：numbered 1.
    expect(html).toMatch(/<ol>[\s\S]*<li>第一项<\/li>[\s\S]*<\/ol>/);
    // 引用块
    expect(html).toContain('<blockquote>');
    // 代码块：marked 渲染为 <pre><code class="language-xxx">...</code></pre>，
    // 围栏内 [[目标]] / - 不应自动续为列表 保留为字面文本（不渲染为链接或新列表项）
    expect(html).toMatch(/<pre><code class="language-text">/);
    expect(html).toContain('[[目标]] 只是一段代码');
    expect(html).toContain('- 不应自动续为列表');
    // 表格：marked 把 \| 解为字面 |（escape token），单元格内容为 "甲|乙"
    expect(html).toMatch(/<table>[\s\S]*<th[^>]*>名称<\/th>[\s\S]*<th[^>]*>数量<\/th>/);
    expect(html).toMatch(/<td[^>]*>甲\|乙<\/td>/);
    expect(html).toMatch(/<td[^>]*>2<\/td>/);
    expect(html).toMatch(/<td[^>]*>丙<\/td>/);
    expect(html).toMatch(/<td[^>]*>3<\/td>/);
    // wiki-link：Exporter.convertWikiLinks 把 [[目标]] / [[目标#章节|别名]]
    // 替换为 markdown link [目标](目标) / [别名](目标#章节)；
    // 经 marked 渲染为 <a href="...">text</a>，目标中文通常被 URL 编码
    // （等价基线 snapshot 行 572：<a href="%E7%9B%AE%E6%A0%87%E7%AC%94%E8%AE%B0">）。
    // 这里宽松匹配 —— href 内含「目标」的两种编码形态均可
    expect(html).toMatch(/<a href="(?:%E7%9B%AE%E6%A0%87|目标)[^"]*">目标<\/a>/);
    // 带锚点的别名链接：href 必含 # 与编码后的 章节 (%E7%AB%A0%E8%8A%82)
    expect(html).toMatch(/<a href="[^"]*(?:%E7%AB%A0%E8%8A%82|章节)[^"]*">别名<\/a>/);
    // 代码块内 [[目标]] 不应变成 <a>（围栏内容不进入 link 渲染）
    expect(html).not.toMatch(/<a [^>]*data-note="[^"]*"[^>]*>\[\[目标\]\] 只是一段代码<\/a>/);
    // 全角标题/列表归一为半角标记
    expect(html).toMatch(/<h1[^>]*>全角标题<\/h1>/);
    expect(html).toMatch(/<li>全角项目<\/li>/);
  });

  // ─── 03 DOCX ──────────────────────────────────────────────

  test('03-导出 DOCX 文档结构核对（标题/代码/表格管道/链接 URL）', async ({ page }) => {
    const downloadPath = await exportAs(page, 'DOCX');
    const buf = await readFile(downloadPath);
    // 容器有效性：ZIP magic + 最小体积
    expect(buf.subarray(0, 2).toString('utf8')).toBe('PK');
    expect(buf.byteLength).toBeGreaterThan(2000);

    const files = unzipAll(buf);
    expect(files.has('word/document.xml')).toBe(true);
    const documentXml = files.get('word/document.xml')!;

    const paragraphs = extractDocxParagraphs(documentXml);
    const allText = paragraphs.join('\n');
    const tables = extractDocxTables(documentXml);

    // ── 段落契约 ──
    // 标题：HeadingLevel 映射，paragraph.children runs 含 '第一章' / '下划线标题' / '全角标题'
    expect(allText).toContain('第一章');
    expect(allText).toContain('下划线标题');
    // 全角标题归一为半角，DOCX 走 block 模型识别 → 同样进 heading
    expect(allText).toContain('全角标题');
    // 段落：粗体等行内 token 走 buildTextRuns，文字仍保留
    expect(allText).toContain('加粗');
    expect(allText).toContain('斜体');
    expect(allText).toContain('删除');
    expect(allText).toContain('代码');
    // 普通链接 → Docx TextRun 输出 text + underline；URL 不写入 document.xml
    // （buildTextRuns 仅递归 children，href 不落产物——实现契约见 Exporter.ts buildTextRuns）
    expect(allText).toContain('链接');
    expect(documentXml).toContain('<w:u w:val="single"/>');
    expect(documentXml).not.toContain('https://example.com');
    // ── 任务项（验收 D-01 无漏文：2026-09-28 修复后任务项必须落 DOCX）──
    // `- [x] 已完成` 为勾选态 → ☑ 前缀 + 正文。
    expect(allText).toContain('已完成');
    expect(allText).toContain('☑ 已完成');
    // 普通项 / 第一项（顶级有序项保留 `1. ` 前缀）
    expect(allText).toContain('普通项');
    expect(allText).toContain('1. 第一项');
    // ── 引用块（验收 D-01 无漏文：2026-09-28 修复后引用文字必须落 DOCX）──
    expect(allText).toContain('引用');
    expect(allText).toContain('引用里的项目');
    // 但围栏代码不受此影响（不走 buildTextRuns，直接 slice + 单 TextRun）
    // 围栏代码：Exporter.ts:531-553 按行拆为独立 paragraph，每行一个 TextRun，
    // 文字走 `lines[li]` 原始切片，无 lexInlineTokens 调用 → 保留 [[目标]] 字面
    expect(allText).toContain('[[目标]] 只是一段代码');
    expect(allText).toContain('- 不应自动续为列表');
    // wiki-link：Exporter.convertWikiLinks 替换为 markdown link，再走 buildSliceRuns
    // （Exporter.ts:118 形态 `[别名](目标#章节)`）；docx TextRun 输出 alias 文本 + 下划线。
    // 验收预期（D-01 无残缺文本）：带别名的双链必须输出为可读文本 `别名`，
    // 不得残留半截 markdown 字面（如 `[别名](目标` + `章节)`）。
    expect(allText).toContain('首处 目标');
    expect(allText).toContain('末处 目标');
    expect(allText).toContain('别名');
    expect(allText).not.toMatch(/\[别名\]\(目标?$/m);
    expect(allText).not.toContain('[别名](目标');
    expect(allText).not.toContain('章节)');
    // 全角项目：归一为 - 全角项目 后作为 unordered listItem 进 DOCX
    expect(allText).toContain('全角项目');

    // ── 表格契约（Exporter.ts:610-660 + Exporter.equivalence.test.ts:308）──
    // DOCX 表格内 \| 被 lexInlineTokens 解析为 escape token → 单元文本为单 `|`（与 CSV/XLSX 不同）
    expect(tables.length).toBeGreaterThan(0);
    const tableRows = tables[0]!;
    // 表头
    expect(tableRows[0]).toEqual(['名称', '数量']);
    // 数据行：甲|乙（单管道，转义已解）/ 2 / 丙 / 3
    expect(tableRows[1]).toEqual(['甲|乙', '2']);
    expect(tableRows[2]).toEqual(['丙', '3']);
    // 整篇段落流不重复出现被表格隔离的内容（仅在 table 内出现甲|乙）
    const outsideTableText = documentXml
      .replace(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/g, '')
      .replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g, '$1');
    expect(outsideTableText).not.toContain('甲|乙');
  });

  // ─── 04 XLSX ──────────────────────────────────────────────

  test('04-导出 XLSX 表格矩阵核对（表头/数据/管道单元格保留转义）', async ({ page }) => {
    const downloadPath = await exportAs(page, 'XLSX');
    const buf = await readFile(downloadPath);
    expect(buf.subarray(0, 2).toString('utf8')).toBe('PK');
    expect(buf.byteLength).toBeGreaterThan(1000);

    const files = unzipAll(buf);
    expect(files.has('xl/worksheets/sheet1.xml')).toBe(true);

    const sharedXml = files.get('xl/sharedStrings.xml') ?? files.get('xl/sharedStrings.xml.xml');
    const sharedStrings = extractXlsxSharedStrings(sharedXml);
    const sheets = extractXlsxSheet(files.get('xl/worksheets/sheet1.xml')!, sharedStrings);

    // Exporter.ts:790-797 fixture 里有 1 个表 → 输出 1 个 sheet「Sheet1」
    expect(sheets.length).toBeGreaterThan(0);
    const sheet = sheets[0]!;
    expect(sheet.rows.length).toBeGreaterThanOrEqual(3);
    // 表头：名称 | 数量（与源表格一致）
    expect(sheet.rows[0]).toEqual(['名称', '数量']);
    // XLSX 表格单元格保留转义管道源码（Exporter.equivalence.test.ts:280
    // headers: ['a\\|b', 'c']）—— 同样 fixture 甲\|乙 在 XLSX 里是单格，文字含 \|
    expect(sheet.rows[1]).toEqual(['甲\\|乙', '2']);
    expect(sheet.rows[2]).toEqual(['丙', '3']);
  });

  // ─── 05 CSV ───────────────────────────────────────────────

  test('05-导出 CSV 表格矩阵与转义核对（管道保留为字面、值精确）', async ({ page }) => {
    const downloadPath = await exportAs(page, 'CSV');
    const csv = await readFile(downloadPath, 'utf8');

    // Exporter.exportCsv（Exporter.ts:814-840）走与 XLSX 同源 extractMarkdownTables
    // → escapeCsvCell（Exporter.ts:843-849）。fixture 单元格均不含 , " \n，
    // 故不触发引号包裹；protectCsvFormula 也不命中（无 = + - @ \t \r 前缀）。
    // 行分隔符 '\n'，表之间 '\n\n'（Exporter.ts:836）。
    const lines = csv.split('\n');
    // 首行：表头
    expect(lines[0]).toBe('名称,数量');
    // 数据行：甲\|乙 在 CSV 里保留为字面（Exporter.equivalence.test.ts:289
    // 等价基线 fixture 'a\|b' → 'a\\|b'，与此处同口径）；2 / 丙 / 3 紧随其后
    expect(lines[1]).toBe('甲\\|乙,2');
    expect(lines[2]).toBe('丙,3');
    // 末尾无多余空行（trim 在 CSV 分支未调用但 join('\n') 自然边界）
    expect(csv.endsWith('\n')).toBe(false);
    // CSV 不应混入表格外的散文（Exporter.ts:819 表格数为 0 才走整段导出分支）
    expect(csv).not.toContain('第一章');
    expect(csv).not.toContain('[[目标]]');
  });
});
