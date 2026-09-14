/**
 * Exporter 特征化等价基线（切片 D / WO-D1）
 *
 * 本文件是「Exporter AST 化改造后行为等价」的门禁基线：
 * 所有断言均为 vitest 文件快照（toMatchSnapshot），首跑自动生成基线，
 * WO-D3 重写解析实现后重跑对比输出等价性。
 *
 * 主语料 FIXTURE 刻意避开两个已知行为分叉点（另有 edge: 专测固化现状）：
 *   - 表格单元格内不得出现转义管道 `\|`
 *   - 图片 alt 内不得出现 `#`
 *
 * 保守性说明：DOCX 摘要依赖 docx v9 内部 XML 组件树（rootKey/root）的
 * 防御性读取；任何一步拿不到稳定结构时，对该元素退回原始对象快照。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lexInlineTokens } from '@jotluck/renderer';
import { Paragraph, Table } from 'docx';
import { ExportFormat } from '@/types';
import {
  buildDocxChildren,
  buildTextRuns,
  buildXlsxColumns,
  convertWikiLinks,
  exportNote,
  extractMarkdownTables,
  preprocessMarkdown,
  stripFrontmatter,
  tableToSheetData,
} from '../Exporter';
import { buildExportModel } from '../export-model';

// ============================================================================
// 主语料 fixture（富中文 Markdown）
// ============================================================================

const FIXTURE = `---
title: 示例笔记
tags: [工作, 重点]
---
# 一级标题

## 二级标题

### 三级标题

Setext 二级标题
---

这是一个 **粗体**、*斜体*、\`行内代码\`、[链接文字](https://example.com/a) 与 ![替代文本](https://example.com/i.png) 的段落，包含 [[目标笔记|别名]] 和 [[目标笔记]] 以及 #标签 结尾。

> 单行引用内容

> 第一行引用
> 第二行引用

- 一级无序
  - 二级无序
- 另一个一级

1. 有序第一项
2. 有序第二项

- [x] 已完成任务
- [ ] 未完成任务

\`\`\`ts
const a = 1;
console.log(a);
\`\`\`

| 列一 | 列二 | 列三 |
|:---|:---:|---:|
| 甲 | 乙 | 丙 |
| 丁 | 戊 | 己 |

---

文末段落。
`;

// exportTxt / exportHtml 内部默认走 includeFrontmatter: true；
// DOCX 结构摘要使用剔除 frontmatter 后的产物（贴近真实导出管线）。
const PREPROCESS_DEFAULT_OPTS = {
  includeFrontmatter: true,
  includeWikiLinks: true,
  codeLineNumbers: false,
};

const PREPROCESS_NO_FRONTMATTER_OPTS = {
  includeFrontmatter: false,
  includeWikiLinks: true,
  codeLineNumbers: false,
};

// ============================================================================
// 下载 sink mock —— 复用 Exporter.test.ts 的成熟模式
// ============================================================================

describe('exporter characterization baseline (slice D)', () => {
  let capturedBlob: Blob | null = null;
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;

  beforeEach(() => {
    capturedBlob = null;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((blob: Blob | MediaSource) => {
        capturedBlob = blob as Blob;
        return 'blob:jotluck-test';
      }),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(() => undefined),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalCreateObjectUrl) {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: originalCreateObjectUrl,
      });
    } else {
      Reflect.deleteProperty(URL, 'createObjectURL');
    }
    if (originalRevokeObjectUrl) {
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: originalRevokeObjectUrl,
      });
    } else {
      Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
  });

  async function capturedDownloadText(): Promise<string> {
    expect(capturedBlob).not.toBeNull();
    return capturedBlob!.text();
  }

  // ==========================================================================
  // a-c) preprocessMarkdown / stripFrontmatter / convertWikiLinks
  // ==========================================================================

  it('preprocess: preprocessMarkdown keeps frontmatter and converts wiki-links (includeWikiLinks: true)', () => {
    expect(
      preprocessMarkdown(FIXTURE, { ...PREPROCESS_DEFAULT_OPTS, includeWikiLinks: true }),
    ).toMatchSnapshot();
  });

  it('preprocess: preprocessMarkdown keeps frontmatter and strips wiki-links (includeWikiLinks: false)', () => {
    expect(
      preprocessMarkdown(FIXTURE, { ...PREPROCESS_DEFAULT_OPTS, includeWikiLinks: false }),
    ).toMatchSnapshot();
  });

  it('preprocess: stripFrontmatter removes the leading frontmatter block', () => {
    expect(stripFrontmatter(FIXTURE)).toMatchSnapshot();
  });

  it('preprocess: convertWikiLinks converts alias and plain wiki-links to markdown links', () => {
    expect(convertWikiLinks(FIXTURE, true)).toMatchSnapshot();
  });

  it('preprocess: convertWikiLinks strips wiki-link syntax keeping display text', () => {
    expect(convertWikiLinks(FIXTURE, false)).toMatchSnapshot();
  });

  // ==========================================================================
  // d-e) extractMarkdownTables / tableToSheetData / buildXlsxColumns
  // ==========================================================================

  it('xlsx: extractMarkdownTables parses the fixture table', () => {
    expect(extractMarkdownTables(FIXTURE)).toMatchSnapshot();
  });

  it('xlsx: tableToSheetData and buildXlsxColumns per parsed table', () => {
    const tables = extractMarkdownTables(FIXTURE);
    const summaries = tables.map((t) => ({
      sheetData: tableToSheetData(t),
      columns: buildXlsxColumns(t),
    }));
    expect(summaries).toMatchSnapshot();
  });

  // ==========================================================================
  // f) exportTxt
  // ==========================================================================

  it('txt: exportTxt output (includeWikiLinks: true)', async () => {
    const result = await exportNote(FIXTURE, 'baseline-wiki', {
      format: ExportFormat.TXT,
      includeWikiLinks: true,
    });
    expect(result.success).toBe(true);
    expect(await capturedDownloadText()).toMatchSnapshot();
  });

  it('txt: exportTxt output (includeWikiLinks: false)', async () => {
    const result = await exportNote(FIXTURE, 'baseline-nowiki', {
      format: ExportFormat.TXT,
      includeWikiLinks: false,
    });
    expect(result.success).toBe(true);
    expect(await capturedDownloadText()).toMatchSnapshot();
  });

  // ==========================================================================
  // g) exportCsv（含公式注入防护行为）
  // ==========================================================================

  it('csv: exportCsv prefixes formula cells and keeps plain cells', async () => {
    const md = '| 公式 | 普通 |\n| --- | --- |\n| =SUM(A1) | 普通单元格 |';
    const result = await exportNote(md, 'baseline-csv', { format: ExportFormat.CSV });
    expect(result.success).toBe(true);
    expect(await capturedDownloadText()).toMatchSnapshot();
  });

  // ==========================================================================
  // h) exportHtml
  // ==========================================================================

  it('html: exportHtml self-contained output', async () => {
    const result = await exportNote(FIXTURE, 'baseline-html', { format: ExportFormat.HTML });
    expect(result.success).toBe(true);
    expect(await capturedDownloadText()).toMatchSnapshot();
  });

  // ==========================================================================
  // i) DOCX 结构摘要
  // ==========================================================================

  it('docx: buildDocxChildren structural summary over fixture blocks', () => {
    const processed = preprocessMarkdown(FIXTURE, PREPROCESS_NO_FRONTMATTER_OPTS);
    const model = buildExportModel(processed);
    const children = buildDocxChildren(model, PREPROCESS_NO_FRONTMATTER_OPTS);
    expect(children.map(summarizeBlock)).toMatchSnapshot();
  });

  it('docx: buildTextRuns summaries for representative inline blocks', () => {
    const processed = preprocessMarkdown(FIXTURE, PREPROCESS_NO_FRONTMATTER_OPTS);
    const model = buildExportModel(processed);

    const richParagraph = model.blocks.find(
      (b) => b.type === 'paragraph' && b.text.includes('粗体'),
    );
    const heading = model.blocks.find((b) => b.type === 'heading');

    expect({
      richParagraph: buildTextRuns(
        lexInlineTokens(richParagraph?.type === 'paragraph' ? richParagraph.text : ''),
      ).map(summarizeTextRun),
      heading: buildTextRuns(
        lexInlineTokens(
          heading?.type === 'heading'
            ? model.source.slice(heading.contentRange.from, heading.contentRange.to)
            : '',
        ),
      ).map(summarizeTextRun),
      // 现行 DOCX 管线对任务项不落 runs（旧 marked v18 任务项 tokens 为空的等价行为，
      // 等价于旧 buildTextRuns([]) 的空 run 回退）
      taskItem: buildTextRuns([]).map(summarizeTextRun),
    }).toMatchSnapshot();
  });

  // ==========================================================================
  // 分叉专测（WO-D3 改变这些行为时更新此处）
  // ==========================================================================

  // ==========================================================================
  // 分叉新行为（WO-D3 AST 化后的明确断言，替代旧快照）
  // ==========================================================================

  it('edge: escaped pipe inside table cell stays in one cell (2 cells)', () => {
    const md = '| a\\|b | c |\n| --- | --- |\n| 1 | 2 |';
    expect(extractMarkdownTables(md)).toEqual([{ headers: ['a\\|b', 'c'], rows: [['1', '2']] }]);
  });

  it('edge: escaped pipe stays 2 cells across csv / xlsx / docx', async () => {
    const md = '| a\\|b | c |\n| --- | --- |\n| 1 | 2 |';

    // CSV：单元格保留 `\|` 源码切片（无逗号/引号/换行故不触发转义）
    const csvResult = await exportNote(md, 'edge-pipe-csv', { format: ExportFormat.CSV });
    expect(csvResult.success).toBe(true);
    expect(await capturedDownloadText()).toBe('a\\|b,c\n1,2');

    // XLSX：表格矩阵形状
    const tables = extractMarkdownTables(md);
    expect(tables).toHaveLength(1);
    expect(tableToSheetData(tables[0]!)).toEqual([
      ['a\\|b', 'c'],
      ['1', '2'],
    ]);

    // DOCX：行内词法把 `\|` 解为转义字符 '|'
    const processed = preprocessMarkdown(md, PREPROCESS_DEFAULT_OPTS);
    const children = buildDocxChildren(buildExportModel(processed), PREPROCESS_DEFAULT_OPTS);
    const tableSummary = children
      .map(summarizeBlock)
      .find((b) => (b as { kind?: string }).kind === 'table');
    expect(tableSummary).toEqual({
      kind: 'table',
      rows: [
        ['a|b', 'c'],
        ['1', '2'],
      ],
    });
  });

  it('xlsx: fullwidth ｜ table is extracted (AST-backed)', () => {
    const md = '｜ 甲 ｜ 乙 ｜\n｜---｜---｜\n｜ 1 ｜ 2 ｜';
    expect(extractMarkdownTables(md)).toEqual([{ headers: ['甲', '乙'], rows: [['1', '2']] }]);
  });

  it('edge: image alt starting with # passes through preprocess unchanged', async () => {
    const md = '![#tag](u)';
    // AST 预处理对无 wiki-link 的图片段不做任何改动
    expect(preprocessMarkdown(md, PREPROCESS_DEFAULT_OPTS)).toBe('![#tag](u)');

    const result = await exportNote(md, 'edge-img', { format: ExportFormat.HTML });
    expect(result.success).toBe(true);
    const html = await capturedDownloadText();
    // 渲染主体（renderer 冻结）产出 <img>；alt 内 #tag 的词法归属 renderer 管。
    expect(html).toContain('<img src="u"');
    expect(html).toContain('markdown-body');
  });

  it('txt: reference definition line passes through unchanged (R1 MAJOR-2 parity)', async () => {
    // 旧 14 条正则链对 `[label]: url` 行无命中规则 → 原样透传；AST 化后同口径
    const md = '段落甲\n\n[ref-label]: https://example.com/def\n\n段落乙';
    const result = await exportNote(md, 'edge-refdef', { format: ExportFormat.TXT });
    expect(result.success).toBe(true);
    const txt = await capturedDownloadText();
    expect(txt).toContain('[ref-label]: https://example.com/def');
    expect(txt).toContain('段落甲');
    expect(txt).toContain('段落乙');
  });
});

// ============================================================================
// DOCX 摘要 helpers（写在测试文件内，锁定可读结构而非 docx 内部对象图）
// ============================================================================

/** docx XML 组件的最小可读形状（docx v9 内部为 rootKey + root 数组） */
interface XmlLike {
  rootKey?: string;
  root?: unknown;
  xmlKeys?: Record<string, string>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function childrenOf(component: unknown): unknown[] {
  return asArray((component as XmlLike | null | undefined)?.root);
}

function findChild(component: unknown, rootKey: string): unknown {
  return childrenOf(component).find((c) => (c as XmlLike | null)?.rootKey === rootKey);
}

/**
 * 读取组件第一个 _attr 子组件的全部 [XML属性名, 值] 条目。
 * docx v9 存在两种属性组件形状，均需兼容：
 * - NextAttributeComponent（BuilderElement/createSpacing/createRunFonts 产物）：
 *   root = { prop: { key: 'w:xx', value } }
 * - XmlAttributeComponent（Attributes/OnOffElement 产物）：
 *   root = { prop: value }，经 xmlKeys 把 prop 映射为 'w:xx'
 */
function attrEntries(component: unknown): Array<[string, unknown]> {
  for (const child of childrenOf(component)) {
    const c = child as XmlLike;
    if (!c || typeof c !== 'object' || c.rootKey !== '_attr') continue;
    const raw = (c.root ?? {}) as Record<string, unknown>;
    const values = Object.values(raw);
    const isNextShape =
      values.length > 0 &&
      values.every(
        (v) => !!v && typeof v === 'object' && typeof (v as { key?: unknown }).key === 'string',
      );
    if (isNextShape) {
      return (values as Array<{ key: string; value: unknown }>)
        .filter(({ value }) => value !== undefined)
        .map(({ key, value }) => [key, value]);
    }
    const keys = c.xmlKeys ?? {};
    return Object.entries(raw)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [keys[key] ?? key, value]);
  }
  return [];
}

/** 读取组件第一个 _attr 子组件中指定 XML 属性名的值 */
function readAttr(component: unknown, attrName: string): unknown {
  for (const [key, value] of attrEntries(component)) {
    if (key === attrName) return value;
  }
  return undefined;
}

/** 读取组件第一个 _attr 子组件的全部映射后属性 */
function readAttrs(component: unknown): Record<string, unknown> {
  return Object.fromEntries(attrEntries(component));
}

/** OnOff 元素（w:b / w:i / w:strike…）：无 w:val 属性视为 true */
function readOnOff(component: unknown, rootKey: string): boolean | undefined {
  const child = findChild(component, rootKey);
  if (child === undefined) return undefined;
  const val = readAttr(child, 'w:val');
  if (val === undefined) return true;
  return val !== false && val !== 0 && val !== '0' && val !== 'false';
}

interface TextRunSummary {
  text?: string;
  break?: number;
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  font?: unknown;
  size?: unknown;
  color?: unknown;
  underline?: unknown;
}

/**
 * TextRun 摘要，两种做法：
 * 1. 若实例上保留 `options`（旧版/未来 docx 直接可读路径），提取其可读属性；
 * 2. docx v9 不保留 options —— 从内部 XML 组件树（w:rPr / w:t / w:br）提取等价摘要；
 * 拿不到稳定结构时退回对原始 run 的整体快照（pretty-format 打印可枚举属性）。
 */
function summarizeTextRun(run: unknown): unknown {
  const options = (run as { options?: unknown } | null | undefined)?.options;
  if (options && typeof options === 'object') {
    const o = options as Record<string, unknown>;
    const summary: TextRunSummary = {};
    if (typeof o.text === 'string') summary.text = o.text;
    if (o.break !== undefined) summary.break = o.break as number;
    if (o.bold !== undefined) summary.bold = o.bold as boolean;
    if (o.italics !== undefined) summary.italics = o.italics as boolean;
    if (o.strike !== undefined) summary.strike = o.strike as boolean;
    if (o.font !== undefined) summary.font = o.font;
    if (o.size !== undefined) summary.size = o.size;
    if (o.color !== undefined) summary.color = o.color;
    if (o.underline !== undefined) summary.underline = o.underline;
    return summary;
  }

  try {
    const runChildren = childrenOf(run);
    if (runChildren.length === 0) return run; // 非预期结构 → 退回整体快照

    const properties = findChild(run, 'w:rPr');
    const textParts: string[] = [];
    let breakCount = 0;
    for (const child of runChildren) {
      const c = child as XmlLike;
      if (!c || typeof c !== 'object') continue;
      if (c.rootKey === 'w:t') {
        for (const part of asArray(c.root)) {
          if (typeof part === 'string') textParts.push(part);
        }
      } else if (c.rootKey === 'w:br') {
        breakCount += 1;
      }
    }

    const summary: TextRunSummary = {};
    if (textParts.length > 0) summary.text = textParts.join('');
    if (breakCount > 0) summary.break = breakCount;
    const bold = readOnOff(properties, 'w:b');
    if (bold !== undefined) summary.bold = bold;
    const italics = readOnOff(properties, 'w:i');
    if (italics !== undefined) summary.italics = italics;
    const strike = readOnOff(properties, 'w:strike');
    if (strike !== undefined) summary.strike = strike;
    const fonts = findChild(properties, 'w:rFonts');
    if (fonts !== undefined) summary.font = readAttr(fonts, 'w:ascii');
    const size = findChild(properties, 'w:sz');
    if (size !== undefined) summary.size = readAttr(size, 'w:val');
    const color = findChild(properties, 'w:color');
    if (color !== undefined) summary.color = readAttr(color, 'w:val');
    const underline = findChild(properties, 'w:u');
    if (underline !== undefined) summary.underline = readAttr(underline, 'w:val');
    return summary;
  } catch {
    return run; // 防御：任何异常退回整体快照
  }
}

interface ParagraphSummary {
  kind: 'paragraph';
  style?: unknown;
  bulletLevel?: unknown;
  spacing?: Record<string, unknown>;
  indent?: Record<string, unknown>;
  border?: Array<Record<string, unknown> & { side?: unknown }>;
  shadingFill?: unknown;
  runs: unknown[];
}

function summarizeParagraph(paragraph: unknown): unknown {
  try {
    const properties = findChild(paragraph, 'w:pPr');
    const summary: ParagraphSummary = { kind: 'paragraph', runs: [] };

    const style = findChild(properties, 'w:pStyle');
    if (style !== undefined) summary.style = readAttr(style, 'w:val');
    const numPr = findChild(properties, 'w:numPr');
    if (numPr !== undefined) {
      summary.bulletLevel = readAttr(findChild(numPr, 'w:ilvl'), 'w:val');
    }
    const spacing = findChild(properties, 'w:spacing');
    if (spacing !== undefined) summary.spacing = readAttrs(spacing);
    const indent = findChild(properties, 'w:ind');
    if (indent !== undefined) summary.indent = readAttrs(indent);
    const border = findChild(properties, 'w:pBdr');
    if (border !== undefined) {
      summary.border = childrenOf(border).map((side) => ({
        side: (side as XmlLike | null)?.rootKey,
        ...readAttrs(side),
      }));
    }
    const shading = findChild(properties, 'w:shd');
    if (shading !== undefined) summary.shadingFill = readAttr(shading, 'w:fill');

    summary.runs = childrenOf(paragraph)
      .filter((c) => (c as XmlLike | null)?.rootKey === 'w:r')
      .map(summarizeTextRun);
    return summary;
  } catch {
    return paragraph; // 防御：退回整体快照
  }
}

/** 从 w:tc 单元格中提取段落纯文本（跨段落以 \n 连接） */
function summarizeTableCell(cell: unknown): string {
  const parts: string[] = [];
  for (const child of childrenOf(cell)) {
    const c = child as XmlLike;
    if (!c || typeof c !== 'object' || c.rootKey !== 'w:p') continue;
    const cellParagraph = summarizeParagraph(child) as ParagraphSummary;
    const text = asArray(cellParagraph.runs)
      .map((run) => (run as TextRunSummary).text ?? '')
      .join('');
    parts.push(text);
  }
  return parts.join('\n');
}

function summarizeTable(table: unknown): unknown {
  try {
    const rows: string[][] = [];
    for (const tr of childrenOf(table)) {
      if ((tr as XmlLike | null)?.rootKey !== 'w:tr') continue;
      const cells: string[] = [];
      for (const tc of childrenOf(tr)) {
        if ((tc as XmlLike | null)?.rootKey !== 'w:tc') continue;
        cells.push(summarizeTableCell(tc));
      }
      rows.push(cells);
    }
    return { kind: 'table', rows };
  } catch {
    return table; // 防御：退回整体快照
  }
}

/** 顶层元素分派：Paragraph → runs 摘要；Table → rows 摘要；未知类型退回整体快照 */
function summarizeBlock(element: unknown): unknown {
  if (element instanceof Paragraph) return summarizeParagraph(element);
  if (element instanceof Table) return summarizeTable(element);
  return element;
}
