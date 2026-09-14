/**
 * marked 自定义扩展：Wiki-link [[...]] 和行内 #tag
 *
 * 词法规则（wiki-link / tag 的行内正则与边界）已单点化到 syntax.ts，本文件
 * 仅消费单点规则 + 决定 token 形状 + 渲染 HTML；不再持有规则副本。
 *
 * @module marked-extensions
 * @see TAD.md §4.2
 */

import type { TokenizerAndRendererExtension } from 'marked';
import { findTagStart, parseWikiLinkTarget, TAG_TOKEN_RE, WIKI_LINK_TOKEN_RE } from './syntax';

let wikiLinkExistsResolver: ((note: string) => boolean) | null = null;

export function setWikiLinkExistsResolver(resolver: ((note: string) => boolean) | null): void {
  wikiLinkExistsResolver = resolver;
}

// --- Wiki-link Token 类型 ---

interface WikiLinkToken {
  type: 'wikiLink';
  raw: string;
  text: string;
  note: string;
  anchor: string | null;
  exists: boolean;
}

// --- Tag Token 类型 ---

interface TagToken {
  type: 'tag';
  raw: string;
  text: string;
}

// --- HTML 工具函数 ---

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeAttr(text: string): string {
  return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ================================================================
// Extension 1: Wiki-link [[...]]
// ================================================================

export const wikiLinkExtension: TokenizerAndRendererExtension = {
  name: 'wikiLink',
  level: 'inline',
  start(src: string) {
    return src.indexOf('[[');
  },
  tokenizer(src: string) {
    const match = WIKI_LINK_TOKEN_RE.exec(src);
    if (!match) return undefined;
    const inner = match[1] ?? '';
    const { note, anchor, alias } = parseWikiLinkTarget(inner);
    return {
      type: 'wikiLink',
      raw: match[0],
      // 渲染文本 = alias ?? note（note 已 trim；alias 原样）
      text: alias ?? note,
      note,
      anchor,
      exists: false, // resolved at render time
    };
  },
  renderer(token) {
    const t = token as unknown as WikiLinkToken;
    const exists = wikiLinkExistsResolver?.(t.note) ?? t.exists;
    const cls = exists ? 'wikilink' : 'wikilink wikilink--dead';
    return `<a class="${cls}" data-note="${escapeAttr(t.note)}" data-anchor="${escapeAttr(t.anchor || '')}">${escapeHtml(t.text)}</a>`;
  },
};

// ================================================================
// Extension 2: 行内 #tag
// ================================================================

export const tagExtension: TokenizerAndRendererExtension = {
  name: 'tag',
  level: 'inline',
  start(src: string) {
    // 第一层边界：过滤「i>0 且前字符为 \w」的无效候选；i=0 候选放行，交给 tokenizer 裁决。
    return findTagStart(src);
  },
  tokenizer(src: string, tokens) {
    const match = TAG_TOKEN_RE.exec(src);
    if (!match) return undefined;
    // 第二层边界（R1-C2 复审定论）：marked 18 的 start 约定是 start(e.slice(1))，
    // tokenizer 从 src 看不到前字符；从已产出 token 序列的尾字符还原真实前字符——
    // 段首（无前驱 token）或前字符非 \w 才算词边界。如此 `a#b` 不误判（前驱 text 以 a 结尾），
    // 而 `#t1 #t2`、`[[x]] #tag` 等相邻/尾随形态不丢标签。
    const lastRaw = tokens.length > 0 ? (tokens[tokens.length - 1]?.raw ?? '') : '';
    const prev = lastRaw.charAt(lastRaw.length - 1);
    if (prev !== '' && /\w/.test(prev)) return undefined;
    return {
      type: 'tag',
      raw: match[0],
      text: match[1],
    };
  },
  renderer(token) {
    const t = token as unknown as TagToken;
    return `<a class="md-tag" data-tag="${escapeAttr(t.text)}">#${escapeHtml(t.text)}</a>`;
  },
};

/** All JotLuck custom marked extensions */
export const jotluckExtensions: TokenizerAndRendererExtension[] = [wikiLinkExtension, tagExtension];
