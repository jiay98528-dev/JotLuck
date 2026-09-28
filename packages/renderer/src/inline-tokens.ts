/**
 * 行内 token 导出 — 对任意切片做确定性行内词法，产出 renderer 统一 InlineToken 联合
 *
 * 为「Exporter 全走 AST」铺路：AST 块级节点内的行内切片经本模块得到结构化 token 树。
 *
 * 实现走分段法（确定性，不赌 marked v18 扩展 tokenizer 是否在 lexInline 生效）：
 *   1. 本地反引号配对扫描（CommonMark「等长 run 配对」规则，见 findCodeSpans）
 *      得到行内代码区间；
 *   2. 用与 syntax.ts 同一份 WIKI_LINK_GLOBAL_RE / TAG_GLOBAL_RE 扫 wiki/tag 命中：
 *      落在代码区间内的丢弃（代码优先）；tag 命中与 wiki 命中重叠的丢弃（wiki 优先，
 *      如 `[[a#b]]` 内部的 `#b` 是 wiki 锚点不是标签）；
 *   3. 每个保留下来的 wiki/tag 命中替换为私有区占位符（`\uE000{i}\uE001`，
 *      marked 词法不会吞并/转义私用区字符），其余文本原样保留，整体交给 marked 的
 *      `Lexer.lexInline` 做行内词法（粗/斜/删/链接/图片/转义/br），产物递归映射；
 *   4. 映射时把 text token 按占位符回切，替换为合成 wikiLink / tag token。
 *
 * wiki 锚点口径：`[[目标#锚点]]` 的锚点**单列**为可选字段 `anchor`，`target` 只放
 * note 名（与 extractIndexFacts 索引侧口径一致，按 note 建索引）；Exporter 需要
 * 完整定位时自行拼 `target#anchor`。
 */

import { Lexer } from 'marked';
import type { Token } from 'marked';
import {
  TAG_GLOBAL_RE,
  WIKI_LINK_GLOBAL_RE,
  parseWikiLinkTarget,
  isMarkdownEscaped,
} from './syntax';

/** renderer 统一行内 token 联合（Exporter 消费面）。 */
export type InlineToken =
  | { type: 'text'; text: string }
  | { type: 'strong' | 'em' | 'del'; children: InlineToken[] }
  | { type: 'codespan'; text: string }
  /** text = 链接文字纯文本（marked 已剥净行内标记）；children 为链接内行内结构 */
  | { type: 'link'; text: string; href: string; children?: InlineToken[] }
  | { type: 'image'; alt: string; href: string; title?: string }
  /**
   * wiki-link。target = note 名（不含锚点）；alias 仅 `[[目标|别名]]` 时存在；
   * anchor 单列（见文件头注释）；raw = 命中原文。
   */
  | { type: 'wikiLink'; target: string; alias?: string; anchor?: string; raw: string }
  /** 行内 #tag；tag 不含 `#`；raw = 命中原文 */
  | { type: 'tag'; tag: string; raw: string }
  /** 反斜杠转义（如 `\*`），text 为转义后的字符 */
  | { type: 'escape'; text: string }
  | { type: 'br' };

// ─── 行内代码区间（CommonMark 等长反引号 run 配对） ────────────────

interface CodeSpanRange {
  /** 开 run 起始下标（含） */
  start: number;
  /** 闭 run 结束下标（不含） */
  end: number;
}

/**
 * 扫 slice 中的行内代码区间。规则：按 run（连续反引号串）从左到右，
 * 每个未配对的 run 找其后最近的等长未配对 run 配对成 span；配不上的是字面量。
 * 与 CommonMark code span 规则同口径（内容规范化不归本函数管，codespan token
 * 的 text 由 marked 产出行内代码时给出）。
 */
export function findCodeSpans(src: string): CodeSpanRange[] {
  interface Run {
    pos: number;
    len: number;
    marker: string;
  }
  const runs: Run[] = [];
  let i = 0;
  while (i < src.length) {
    if (src.charAt(i) === '`' || src.charAt(i) === '｀') {
      const marker = src.charAt(i);
      let j = i;
      while (j < src.length && src.charAt(j) === marker) j++;
      runs.push({ pos: i, len: j - i, marker });
      i = j;
    } else {
      i++;
    }
  }
  const spans: CodeSpanRange[] = [];
  const consumed = new Array<boolean>(runs.length).fill(false);
  for (let a = 0; a < runs.length; a++) {
    if (consumed[a] || isMarkdownEscaped(src, runs[a]!.pos)) continue;
    for (let b = a + 1; b < runs.length; b++) {
      if (consumed[b]) continue;
      if (runs[b]!.len === runs[a]!.len && runs[b]!.marker === runs[a]!.marker) {
        spans.push({ start: runs[a]!.pos, end: runs[b]!.pos + runs[b]!.len });
        consumed[a] = true;
        consumed[b] = true;
        break;
      }
    }
  }
  return spans;
}

// ─── 占位符回切 ───────────────────────────────────────────────────

// 纯 ASCII 字母数字占位符：marked 视作普通单词字符，不会吞并/转义，也不影响
// 强调闭合的 flanking 判定（PUA 私用区字符实测会被当标点处理、打断 `**` 配对）。
const PLACEHOLDER_OPEN = 'jLxWqZ';
const PLACEHOLDER_CLOSE = 'zQwXlJ';
const PLACEHOLDER_RE = /jLxWqZ(\d+)zQwXlJ/g;

function placeholderFor(index: number): string {
  return `${PLACEHOLDER_OPEN}${index}${PLACEHOLDER_CLOSE}`;
}

/**
 * 把含占位符的纯文本切回 InlineToken 序列：占位符替换为对应合成 token，
 * 其余部分产出 text token。空文本保底产出一个空 text token（保结构可拼接）。
 */
function splitOnPlaceholders(text: string, synthetics: InlineToken[]): InlineToken[] {
  const out: InlineToken[] = [];
  let last = 0;
  for (const match of text.matchAll(PLACEHOLDER_RE)) {
    if (match.index > last) out.push({ type: 'text', text: text.slice(last, match.index) });
    const synthetic = synthetics[Number(match[1])];
    if (synthetic) out.push(synthetic);
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  if (out.length === 0) out.push({ type: 'text', text: '' });
  return out;
}

// ─── marked token 递归映射 ────────────────────────────────────────

function mapMarkedTokens(tokens: Token[], synthetics: InlineToken[]): InlineToken[] {
  const out: InlineToken[] = [];
  for (const token of tokens) out.push(...mapMarkedToken(token, synthetics));
  return out;
}

function mapMarkedToken(token: Token, synthetics: InlineToken[]): InlineToken[] {
  switch (token.type) {
    case 'text': {
      // marked 的 text token 在个别形态下带未展平的子 token（如 loose text），
      // 有子 token 就递归；否则按占位符回切。
      const children = (token as { tokens?: Token[] }).tokens;
      if (children && children.length > 0) return mapMarkedTokens(children, synthetics);
      return splitOnPlaceholders(token.text, synthetics);
    }
    case 'strong':
    case 'em':
    case 'del':
      return [{ type: token.type, children: mapMarkedTokens(token.tokens ?? [], synthetics) }];
    case 'codespan':
      return [{ type: 'codespan', text: token.text }];
    case 'link':
      return [
        {
          type: 'link',
          text: token.text,
          href: token.href,
          children: mapMarkedTokens(token.tokens ?? [], synthetics),
        },
      ];
    case 'image':
      return [
        {
          type: 'image',
          alt: token.text,
          href: token.href,
          ...(token.title ? { title: token.title } : {}),
        },
      ];
    case 'escape':
      return [{ type: 'escape', text: token.text }];
    case 'br':
      return [{ type: 'br' }];
    case 'html': {
      // 行内 HTML 剥标签只留文字（与旧导出链 buildTextRuns 的 html case 同口径）
      const stripped = (token.text ?? token.raw).replace(/<[^>]*>/g, '');
      return stripped === '' ? [] : [{ type: 'text', text: stripped }];
    }
    default:
      // 其余 marked token（jotluck 扩展 tokenizer 侥幸产出的形态）
      // 一律退化为 text（raw 原文），保证联合类型封闭。
      return [{ type: 'text', text: token.raw }];
  }
}

// ─── 入口 ─────────────────────────────────────────────────────────

/**
 * 对任意行内切片做确定性行内词法，产出 InlineToken 联合序列。
 *
 * wiki/tag 由本模块按 syntax.ts 规则识别（不受 marked 扩展内部行为影响），
 * 行内代码优先于 wiki/tag；其余结构（强调/链接/图片/转义/br）交给 marked
 * `Lexer.lexInline`。空切片返回空数组。
 */
export function lexInlineTokens(slice: string): InlineToken[] {
  if (slice === '') return [];

  const codeSpans = findCodeSpans(slice);
  const insideCode = (from: number, to: number): boolean =>
    codeSpans.some((span) => from >= span.start && to <= span.end);

  const wikiMatches = Array.from(slice.matchAll(WIKI_LINK_GLOBAL_RE)).filter(
    (m) => !insideCode(m.index, m.index + m[0].length) && !isMarkdownEscaped(slice, m.index),
  );
  const wikiRanges = wikiMatches.map((m) => ({ from: m.index, to: m.index + m[0].length }));
  const tagMatches = Array.from(slice.matchAll(TAG_GLOBAL_RE)).filter((m) => {
    const from = m.index;
    const to = from + m[0].length;
    if (insideCode(from, to)) return false;
    return !wikiRanges.some((r) => from < r.to && to > r.from);
  });

  const synthetics: InlineToken[] = [];
  const parts = [
    ...wikiMatches.map((m) => ({ index: m.index, match: m, wiki: true })),
    ...tagMatches.map((m) => ({ index: m.index, match: m, wiki: false })),
  ].sort((a, b) => a.index - b.index);

  let rewritten = '';
  let cursor = 0;
  for (const { index, match, wiki } of parts) {
    const raw = match[0];
    if (wiki) {
      const parsed = parseWikiLinkTarget(match[1] ?? '');
      synthetics.push({
        type: 'wikiLink',
        target: parsed.note,
        ...(parsed.alias !== null ? { alias: parsed.alias } : {}),
        ...(parsed.anchor !== null ? { anchor: parsed.anchor } : {}),
        raw,
      });
    } else {
      synthetics.push({ type: 'tag', tag: match[1] ?? '', raw });
    }
    rewritten += slice.slice(cursor, index) + placeholderFor(synthetics.length - 1);
    cursor = index + raw.length;
  }
  rewritten += slice.slice(cursor);

  return mapMarkedTokens(Lexer.lexInline(rewritten), synthetics);
}
