/**
 * 块解析引擎 — marked.lexer → MarkdownBlock[]
 *
 * M1-06: 将 Markdown 源码解析为语法块列表，供 CM6 扩展使用。
 *
 * @module block-parser
 * @see TAD.md §3.4
 */

import { marked } from 'marked';
import type { MarkdownBlock, BlockType } from '@/types';

/**
 * 将 marked Token 类型映射到 MarkLuck BlockType。
 */
function mapTokenType(token: { type: string }): BlockType {
  switch (token.type) {
    case 'heading':
      return 'heading';
    case 'paragraph':
      return 'paragraph';
    case 'code':
      return 'codeBlock';
    case 'blockquote':
      return 'blockquote';
    case 'list':
      return 'unorderedList';
    case 'table':
      return 'table';
    case 'hr':
      return 'horizontalRule';
    case 'space':
      return 'paragraph'; // blank lines → paragraph
    default:
      return 'paragraph';
  }
}

/**
 * 解析 Markdown 源码为语法块列表。
 *
 * 使用 marked.lexer() 进行词法分析（不生成 HTML），
 * 然后将 Token 列表组装为 MarkdownBlock 数组。
 *
 * @param source - Raw Markdown source text
 * @param notePath - Note path for generating block IDs
 * @returns Array of parsed MarkdownBlock
 */
export function parseBlocks(source: string, notePath: string): MarkdownBlock[] {
  const tokens = marked.lexer(source);
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  // Track position in source text
  let currentOffset = 0;
  // Skip frontmatter token if present
  const startToken = tokens[0]?.type === 'frontmatter' || tokens[0]?.type === 'yaml' ? 1 : 0;

  for (let i = startToken; i < tokens.length; i++) {
    const token = tokens[i]!;

    // Skip hidden tokens
    if (token.type === 'space' && (!token.raw || token.raw.trim() === '')) {
      continue;
    }

    const raw = token.raw || '';
    const blockType = mapTokenType(token);
    const from = currentOffset;
    const to = currentOffset + raw.length;

    const block: MarkdownBlock = {
      id: `${notePath}::${from}`,
      index,
      type: blockType,
      raw,
      from,
      to,
      isValid: true, // marked lexer validates syntax
      mode: 'source',
    };

    blocks.push(block);
    currentOffset = to;
    index++;
  }

  return blocks;
}
