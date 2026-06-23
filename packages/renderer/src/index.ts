/**
 * @markluck/renderer — Markdown 渲染管线入口
 *
 * Markdown text → marked parse (with extensions) → DOMPurify sanitize → safe HTML
 *                                                                    ↓
 *                                              highlight.js ← DOM insert ←
 *
 * Shared by @markluck/app (main editor) and @markluck/vscode-ext (VS Code webview).
 *
 * @see TAD.md §4
 */

import { marked } from 'marked';
import { markluckExtensions, setWikiLinkExistsResolver } from './marked-extensions';
import { sanitize } from './sanitize';
import { highlightCodeBlocks } from './highlight';
import type { RendererOptions } from './types';

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

// 配置 marked 使用 MarkLuck 自定义扩展
marked.use({ extensions: markluckExtensions });

// 启用 GFM (GitHub Flavored Markdown: 表格、任务列表、删除线等)
marked.setOptions({ gfm: true, breaks: false });

/**
 * 渲染 Markdown 字符串为安全 HTML。
 *
 * 管线流程：
 *   1. marked.parse(source) — Markdown → HTML（含 Wiki-link + #tag 扩展）
 *   2. sanitize(html)       — DOMPurify 清洗 → 安全 HTML
 *   3. (DOM insert)         — 由调用方插入 DOM
 *   4. highlightCodeBlocks  — 对 <pre><code> 执行语法高亮
 *
 * @param source - Raw Markdown source text
 * @param _options - Renderer options (reserved for future use)
 * @returns Rendered safe HTML string
 */
export function renderMarkdown(source: string, options?: RendererOptions): string {
  // Step 1: Parse Markdown with custom extensions
  setWikiLinkExistsResolver(options?.wikiLinkExists ?? null);
  let rawHtml: string;
  try {
    rawHtml = marked.parse(normalizeFullwidthMarkdownSyntax(source), {
      async: false,
    }) as string;
  } finally {
    setWikiLinkExistsResolver(null);
  }

  // Step 2: Sanitize against XSS
  const cleanHtml = sanitize(rawHtml);

  return cleanHtml;
}

/**
 * 对已插入 DOM 的 HTML 容器执行代码高亮。
 * 必须在 mounted/updated 生命周期中调用。
 */
export { highlightCodeBlocks };

export type { RendererOptions, RenderResult } from './types';
