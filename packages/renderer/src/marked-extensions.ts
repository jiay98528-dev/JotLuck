/**
 * marked 自定义扩展：Wiki-link [[...]] 和行内 #tag
 *
 * @module marked-extensions
 * @see TAD.md §4.2
 */

import type { TokenizerAndRendererExtension } from 'marked';

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
    const rule = /^\[\[([^\]]+)\]\]/;
    const match = rule.exec(src);
    if (match) {
      const raw = match[1]!;
      const parts = raw.split('|');
      const target = parts[0]!.split('#');
      return {
        type: 'wikiLink',
        raw: match[0],
        text: parts[1] || target[0],
        note: target[0]!,
        anchor: target[1] || null,
        exists: false, // resolved at render time
      };
    }
    return undefined;
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
    return src.indexOf('#');
  },
  tokenizer(src: string) {
    const rule = /^#([^\s#]+)/;
    const match = rule.exec(src);
    if (match) {
      return {
        type: 'tag',
        raw: match[0],
        text: match[1],
      };
    }
    return undefined;
  },
  renderer(token) {
    const t = token as unknown as TagToken;
    return `<a class="md-tag" data-tag="${escapeAttr(t.text)}">#${escapeHtml(t.text)}</a>`;
  },
};

/** All JotLuck custom marked extensions */
export const jotluckExtensions: TokenizerAndRendererExtension[] = [wikiLinkExtension, tagExtension];
