/**
 * @jotluck/renderer — Markdown 渲染管线入口
 *
 * Markdown text → marked parse (with extensions) → DOMPurify sanitize → safe HTML
 *                                                                    ↓
 *                                              highlight.js ← DOM insert ←
 *
 * Shared by @jotluck/app (main editor) and @jotluck/vscode-ext (VS Code webview).
 *
 * @see TAD.md §4
 */

import { marked } from 'marked';
import { jotluckExtensions, setWikiLinkExistsResolver } from './marked-extensions';
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

// 配置 marked 使用 JotLuck 自定义扩展
marked.use({ extensions: jotluckExtensions });

// 启用 GFM (GitHub Flavored Markdown: 表格、任务列表、删除线等)
marked.setOptions({ gfm: true, breaks: false });

function startsBareJsonBlock(line: string): boolean {
  return /^\s*[\[{]/.test(line);
}

function updateJsonDepth(
  line: string,
  state: { depth: number; inString: boolean; escaped: boolean },
): void {
  for (const char of line) {
    if (state.escaped) {
      state.escaped = false;
      continue;
    }
    if (char === '\\' && state.inString) {
      state.escaped = true;
      continue;
    }
    if (char === '"') {
      state.inString = !state.inString;
      continue;
    }
    if (state.inString) continue;
    if (char === '{' || char === '[') state.depth++;
    else if (char === '}' || char === ']') state.depth--;
  }
}

function isJsonText(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function protectBareJsonBlocks(source: string): string {
  const lines = source.split('\n');
  const output: string[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      output.push(line);
      continue;
    }
    if (inFence || !startsBareJsonBlock(line)) {
      output.push(line);
      continue;
    }

    const candidate: string[] = [];
    const state = { depth: 0, inString: false, escaped: false };
    let end = -1;

    for (let j = i; j < lines.length; j++) {
      const current = lines[j] ?? '';
      if (j > i && /^\s*```/.test(current)) break;
      candidate.push(current);
      updateJsonDepth(current, state);
      if (state.depth < 0) break;
      if (state.depth === 0 && !state.inString) {
        const text = candidate.join('\n').trim();
        if (text && isJsonText(text)) end = j;
        break;
      }
    }

    if (end >= i) {
      output.push('```json', ...candidate, '```');
      i = end;
    } else {
      output.push(line);
    }
  }

  return output.join('\n');
}

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
  const normalizedSource = protectBareJsonBlocks(normalizeFullwidthMarkdownSyntax(source));
  setWikiLinkExistsResolver(options?.wikiLinkExists ?? null);
  let rawHtml: string;
  try {
    rawHtml = marked.parse(normalizedSource, {
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
