/**
 * 行内提取与纯文本剥离 — wiki-link / #tag 索引事实、纯文本化
 *
 * 与 AST 共用 syntax.ts 的词法规则；索引提取跳过 frontmatter/codeFence/jsonBlock/refDefinition。
 */

import type { DocumentAst } from './ast';
import {
  TAG_GLOBAL_RE,
  WIKI_LINK_GLOBAL_RE,
  parseWikiLinkTarget,
  isMarkdownEscaped,
} from './syntax';
import { findCodeSpans } from './inline-tokens';

export interface WikiLinkOccurrence {
  target: string;
  alias: string | null;
  anchor: string | null;
  from: number;
  to: number;
  lineNumber: number;
  raw: string;
  before: string;
  after: string;
}

/** Preserve original offsets; never locate a reference in text with syntax stripped out. */
export function extractWikiLinkOccurrences(ast: DocumentAst): WikiLinkOccurrence[] {
  const occurrences: WikiLinkOccurrence[] = [];
  for (const block of ast.blocks) {
    if (['frontmatter', 'codeFence', 'jsonBlock', 'refDefinition'].includes(block.type)) continue;
    const source = ast.source.slice(block.range.from, block.range.to);
    if (!source.includes('[[')) continue;
    const code = findCodeSpans(source);
    let scanned = 0;
    let lineNumber = block.lineFrom + 1;
    for (const match of source.matchAll(WIKI_LINK_GLOBAL_RE)) {
      if (isMarkdownEscaped(source, match.index)) continue;
      if (code.some((range) => match.index >= range.start && match.index < range.end)) continue;
      while (scanned < match.index) {
        if (source[scanned++] === '\n') lineNumber++;
      }
      const parsed = parseWikiLinkTarget(match[1] ?? '');
      const from = block.range.from + match.index;
      const to = from + match[0].length;
      occurrences.push({
        target: parsed.note,
        alias: parsed.alias,
        anchor: parsed.anchor,
        from,
        to,
        lineNumber,
        raw: match[0],
        before: ast.source.slice(Math.max(block.range.from, from - 40), from),
        after: ast.source.slice(to, Math.min(block.range.to, to + 40)),
      });
    }
  }
  return occurrences;
}

export interface IndexFacts {
  /** wiki-link 目标 note，按出现顺序、不去重 */
  wikiLinkTargets: string[];
  /** #tag 文本（不含 `#`），按出现顺序、不去重 */
  tags: string[];
}

export interface StripToPlainTextOptions {
  /** 图片占位回调：![alt](url) → imagePlaceholder(alt)；缺省用 alt 文本 */
  imagePlaceholder?: (alt: string) => string;
  /** 为 true 时额外剥除列表 bullet / 有序编号与任务 checkbox 前缀 */
  stripListMarkers?: boolean;
}

/** 去掉行内 code（`...`）后扫描 #tag。 */
function stripInlineCode(text: string): string {
  return text.replace(/`[^`]+`/g, '');
}

export function extractTags(text: string): string[] {
  return Array.from(text.matchAll(TAG_GLOBAL_RE), (match) => match[1] ?? '');
}

/** 行首 heading / blockquote 前缀（与 stripToPlainText 同一规则）。 */
const LINE_PREFIX_RE = /(^|\n)(\s{0,3})(?:[#＃]{1,6}[ \u3000]+|[>＞][ \u3000]?)/g;

/** 去掉行首 heading / blockquote 标记，循环至不动点（与 marked 块级词法一致）。 */
function stripLinePrefixes(text: string): string {
  let result = text;
  let previous: string;
  do {
    previous = result;
    result = result.replace(LINE_PREFIX_RE, '$1');
  } while (result !== previous);
  return result;
}

/**
 * 提取文档索引事实（wiki-link 目标 + #tag）。
 *
 * 跳过 frontmatter / codeFence / jsonBlock / refDefinition 块（refDefinition 的
 * URL 里 `#frag` 是片段标识不是标签，WO-D2）；其余块取源码切片，
 * 先去行内 code，再剥行首 heading/blockquote 前缀（否则 ATX 标记 `#`
 * 会被误扫为 tag），最后扫 WIKI_LINK_GLOBAL_RE 与 TAG_GLOBAL_RE。
 */
export function extractIndexFacts(
  ast: DocumentAst,
  occurrences = extractWikiLinkOccurrences(ast),
): IndexFacts {
  const wikiLinkTargets = occurrences.map((item) => item.target);
  const tags: string[] = [];
  for (const block of ast.blocks) {
    if (
      block.type === 'frontmatter' ||
      block.type === 'codeFence' ||
      block.type === 'jsonBlock' ||
      block.type === 'refDefinition'
    ) {
      continue;
    }
    const text = stripLinePrefixes(
      stripInlineCode(ast.source.slice(block.range.from, block.range.to)),
    );
    tags.push(...extractTags(text));
  }
  return { wikiLinkTargets, tags };
}

/**
 * 把 Markdown 文本剥成纯文本。
 *
 * 规则顺序：图片 → 链接 → **粗** / *斜* / ~~删~~ / `码` 四族循环至不动点
 * （嵌套剥净）→ 剥行首 heading/blockquote 前缀 →（可选）剥列表标记。
 */
export function stripToPlainText(text: string, options?: StripToPlainTextOptions): string {
  let result = text;

  // 1. 图片 ![alt](url) → 占位或 alt
  const imagePlaceholder = options?.imagePlaceholder;
  result = result.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_match, alt: string) =>
    imagePlaceholder ? imagePlaceholder(alt) : alt,
  );

  // 2. 链接 [t](u) → t
  result = result.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  // 3. 强调四族循环至全局不动点（嵌套剥净：`**粗 *斜* 粗**`、`**x**` 等）
  const families: Array<[RegExp, string]> = [
    [/\*\*([\s\S]+?)\*\*/g, '$1'],
    [/\*([^*]+)\*/g, '$1'],
    [/~~([^~]+)~~/g, '$1'],
    [/`([^`]+)`/g, '$1'],
  ];
  let familiesChanged = true;
  while (familiesChanged) {
    familiesChanged = false;
    for (const [pattern, replacement] of families) {
      const next = result.replace(pattern, replacement);
      if (next !== result) familiesChanged = true;
      result = next;
    }
  }

  // 4. 行首 heading / blockquote 前缀（循环以剥净多级引用与全角标记）
  result = stripLinePrefixes(result);

  // 5. 可选：列表 bullet / 有序编号 / 任务 checkbox 前缀
  if (options?.stripListMarkers) {
    result = result.replace(/(^|\n)\s{0,3}[*+\-＊＋－]\s+\[[ xX]\]\s+/g, '$1');
    result = result.replace(/(^|\n)\s{0,3}(?:[-*+＊＋－]|\d+[.)])\s+/g, '$1');
  }

  return result;
}
