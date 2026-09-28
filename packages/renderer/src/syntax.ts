/**
 * 语法规则单点模块 — 全角归一化、heading id、wiki-link / #tag 词法、表格行工具
 *
 * 本模块是以下规则的唯一权威定义，供 marked 扩展、AST 解析与编辑器侧共用：
 * - 全角 Markdown 定界符归一化（普通版 + fence 感知渲染版）
 * - heading 锚点 id 生成
 * - wiki-link `[[...]]` 与行内 `#tag` 的词法规则
 * - 表格行切分 / 分隔行判定 / 对齐与 grid 模板计算
 *
 * 从 index.ts 搬移的函数保持行为字节不变；表格工具从 cm6-live-preview 移植。
 */

/** Whether punctuation is preceded by an unmatched Markdown escape. */
export function isMarkdownEscaped(source: string, position: number): boolean {
  let slashes = 0;
  while (position > 0 && source[--position] === '\\') slashes++;
  return slashes % 2 === 1;
}

/** 将中文输入法常见全角 Markdown 定界符规范化为等长半角字符。 */
export function normalizeFullwidthMarkdownSyntax(source: string): string {
  return source
    .replace(
      /^(\s*)(＃+)[ \u3000]+/gm,
      (_match, indent: string, marks: string) => `${indent}${marks.replaceAll('＃', '#')} `,
    )
    .replace(/^(\s*)＞[ \u3000]?/gm, '$1> ')
    .replace(/^(\s*)－[ \u3000]+/gm, '$1- ')
    .replace(/＊＊([^＊\n]+)＊＊/g, '**$1**')
    .replace(/＊([^＊\n]+)＊/g, '*$1*')
    .replace(/～～([^～\n]+)～～/g, '~~$1~~')
    .replace(/｀｀｀([^｀\n]*)｀｀｀/g, '```$1```')
    .replace(/｀([^｀\n]+)｀/g, '`$1`')
    .replace(/［([^］\n]+)］（([^）\n]+)）/g, '[$1]($2)')
    .replace(/｜/g, '|');
}

const FENCE_DELIMITER_RE = /^(\s*)([`~｀～]{3,})(.*)$/;
const FENCE_CLOSE_REST_RE = /^\s*$/;

/**
 * 渲染入口专用的 fence 感知全角 Markdown 归一化。
 *
 * 与 {@link normalizeFullwidthMarkdownSyntax} 的关键差异：
 * - 识别 fenced code block（``` 或 ~~~ 围栏）的内容行并跳过归一化，
 *   避免把 code 内的 `＃` `＊` 等误转成 Markdown 定界符。
 * - fence 起始/结束行仍归一定界符字符，使 `｀｀｀js ... ｀｀｀` 这种
 *   全角围栏能被 marked 识别为代码块；info string 保持原样。
 *
 * 用于渲染管线；其它调用方（live preview 行内编辑、格式化工具）继续使用
 * 不感知 fence 的 {@link normalizeFullwidthMarkdownSyntax}，行为不变。
 */
export function normalizeFullwidthMarkdownSyntaxForRender(source: string): string {
  const lines = source.split('\n');
  const output: string[] = [];
  const pending: string[] = [];
  let inFence = false;
  let fenceChar = '';
  let fenceMinLength = 0;

  const flushPending = () => {
    if (pending.length === 0) return;
    for (const line of normalizeFullwidthMarkdownSyntax(pending.join('\n')).split('\n'))
      output.push(line);
    pending.length = 0;
  };

  for (const line of lines) {
    const fenceMatch = FENCE_DELIMITER_RE.exec(line);

    if (inFence) {
      if (fenceMatch) {
        const [, closeIndent = '', closeMarks = '', closeRest = ''] = fenceMatch;
        const closingMarker = closeMarks.replace(/｀/g, '`').replace(/～/g, '~');
        if (
          closingMarker.charAt(0) === fenceChar &&
          closingMarker.length >= fenceMinLength &&
          FENCE_CLOSE_REST_RE.test(closeRest)
        ) {
          flushPending();
          output.push(closeIndent + closingMarker);
          inFence = false;
          fenceChar = '';
          fenceMinLength = 0;
          continue;
        }
      }
      output.push(line);
      continue;
    }

    if (fenceMatch) {
      const [, openIndent = '', openMarks = '', openRest = ''] = fenceMatch;
      const normalizedMarker = openMarks.replace(/｀/g, '`').replace(/～/g, '~');
      if (/^(`+|~+)$/.test(normalizedMarker) && normalizedMarker.length >= 3) {
        flushPending();
        output.push(openIndent + normalizedMarker + openRest);
        inFence = true;
        fenceChar = normalizedMarker.charAt(0);
        fenceMinLength = normalizedMarker.length;
        continue;
      }
    }

    pending.push(line);
  }

  flushPending();
  return output.join('\n');
}

/** Convert a heading's inline source into the stable anchor used by previews. */
export function headingIdFromText(text: string, occurrence = 1): string {
  const base = text
    .normalize('NFKC')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
  const normalized = base || 'heading';
  const anchor = `heading-${normalized}`;
  return occurrence > 1 ? `${anchor}-${occurrence}` : anchor;
}

// ================================================================
// Wiki-link 词法（[[...]]）
// ================================================================

/** marked tokenizer 用：锚定行的 wiki-link 规则。 */
export const WIKI_LINK_TOKEN_RE = /^\[\[([^\]]+)\]\]/;

/** 扫描用：全文 wiki-link 规则。 */
export const WIKI_LINK_GLOBAL_RE = /\[\[([^\]]+)\]\]/g;

export interface WikiLinkTarget {
  note: string;
  anchor: string | null;
  alias: string | null;
}

/**
 * 解析 wiki-link 内部文本（`[[]]` 之间的内容）。
 *
 * 规则：inner 按第一个 `|` 切 alias；目标段按第一个 `#` 切 anchor；
 * note = trim；anchor trim 后空串 → null；alias 原样（null 表示无）。
 */
export function parseWikiLinkTarget(inner: string): WikiLinkTarget {
  const barIndex = inner.indexOf('|');
  const targetPart = barIndex === -1 ? inner : inner.slice(0, barIndex);
  const alias: string | null = barIndex === -1 ? null : inner.slice(barIndex + 1);
  const hashIndex = targetPart.indexOf('#');
  const note = (hashIndex === -1 ? targetPart : targetPart.slice(0, hashIndex)).trim();
  let anchor: string | null = hashIndex === -1 ? null : targetPart.slice(hashIndex + 1).trim();
  if (anchor === '') anchor = null;
  return { note, anchor, alias };
}

// ================================================================
// 行内 #tag 词法
// ================================================================

/** marked tokenizer 用：锚定行的 tag 规则。 */
export const TAG_TOKEN_RE = /^#([^\s#]+)/;

/** 扫描用：全文 tag 规则（统一 `(?<!\w)` 边界）。 */
export const TAG_GLOBAL_RE = /(?<!\w)#([^\s#]+)/g;

/**
 * 返回 src 中第一个可能成为标签的 `#` 下标；无则 undefined。
 * 供 marked extension 的 start() 使用。词边界采用两层分工（R1-C2 复审定论）：
 * 本函数过滤「i>0 且前字符是 \w」的无效候选；i===0 的候选直接放行，因为 marked 18
 * 的调用约定是 `start(e.slice(1))`——下标 0 的真实前字符不可见，边界由 tag tokenizer
 * 通过已产出 token 序列的尾字符最终裁决（见 marked-extensions.ts）。
 */
export function findTagStart(src: string): number | undefined {
  for (let i = 0; i < src.length; i++) {
    if (src.charAt(i) !== '#') continue;
    if (i === 0) return i;
    const prev = src.charAt(i - 1);
    if (!/\w/.test(prev)) return i;
  }
  return undefined;
}

// ================================================================
// 表格行工具（输入一律为「归一化后」的行文本）
// ================================================================

/**
 * 命中点前连续反斜杠数为奇 → 该 `|` 被 `\` 转义，不是切分点。
 * 全角 `｜` 无转义概念。GFM 同口径。
 */
function isEscapedTablePipe(text: string, pipeIndex: number): boolean {
  let backslashes = 0;
  for (let k = pipeIndex - 1; k >= 0 && text.charAt(k) === '\\'; k--) backslashes++;
  return backslashes % 2 === 1;
}

/**
 * 按未转义的 `|` / 任意 `｜` 切表格行并 trim 每格。
 *
 * 单元格文本保留原始切片（含反斜杠），转义显示交给下游（live preview 行内渲染 /
 * 导出纯文本化）处理。行首/行尾分隔符仅在未被转义时剥离（GFM 同口径：
 * 行首 `\|` 是内容、行尾 `\|` 不切）。全角 `｜` 保持总切，行首/行尾 `｜` 同样剥离。
 */
export function splitTableCells(normalizedRow: string): string[] {
  const trimmed = normalizedRow.trim();
  let body = trimmed;
  if ((body.startsWith('|') && !isEscapedTablePipe(body, 0)) || body.startsWith('｜')) {
    body = body.slice(1);
  }
  if ((body.endsWith('|') && !isEscapedTablePipe(body, body.length - 1)) || body.endsWith('｜')) {
    body = body.slice(0, -1);
  }
  const cells: string[] = [];
  let segStart = 0;
  for (let k = 0; k < body.length; k++) {
    const ch = body.charAt(k);
    if (ch === '｜' || (ch === '|' && !isEscapedTablePipe(body, k))) {
      cells.push(body.slice(segStart, k).trim());
      segStart = k + 1;
    }
  }
  cells.push(body.slice(segStart).trim());
  return cells;
}

export function isTableSeparatorLine(normalizedRow: string): boolean {
  if (!normalizedRow.includes('|')) return false;
  const cells = splitTableCells(normalizedRow);
  return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell));
}

export function isTableRowCandidate(normalizedRow: string): boolean {
  return normalizedRow.includes('|') && normalizedRow.trim() !== '';
}

export function tableAlignments(
  separatorRow: string,
  columnCount: number,
): Array<'left' | 'center' | 'right'> {
  const cells = splitTableCells(separatorRow);
  return Array.from({ length: columnCount }, (_, index) => {
    const cell = cells[index] ?? '';
    const starts = cell.startsWith(':');
    const ends = cell.endsWith(':');
    if (starts && ends) return 'center';
    if (ends) return 'right';
    return 'left';
  });
}

export function tableGridTemplate(rows: string[], columnCount: number): string {
  const widths = Array.from({ length: columnCount }, () => 4);
  for (const row of rows) {
    splitTableCells(row).forEach((cell, index) => {
      if (index >= columnCount) return;
      widths[index] = Math.max(widths[index]!, Math.min(cell.length + 2, 32));
    });
  }
  return widths
    .map((width) => `minmax(${Math.max(6, width)}ch, ${Math.max(4, width)}fr)`)
    .join(' ');
}
