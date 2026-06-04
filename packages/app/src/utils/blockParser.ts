/**
 * Markdown Block Parser — 将 Markdown 文本解析为语法块列表
 *
 * M1-08: BlockWidget/BlockDecorator 的解析后端。
 * 每条块携带类型、位置、有效性标志，供 CodeMirror 装饰器渲染色条标记。
 *
 * @module blockParser
 * @see editor.ts MarkdownBlock
 */

import type { MarkdownBlock, BlockType } from '@/types';

/** 块正则匹配器 */
interface BlockMatcher {
  type: BlockType;
  pattern: RegExp;
  /** 是否是多行块（需要配对闭合检测） */
  multiline?: { open: RegExp; close: RegExp };
}

/** 单行块匹配器优先级列表 */
const LINE_MATCHERS: BlockMatcher[] = [
  { type: 'heading', pattern: /^(#{1,6})\s+(.+)/ },
  { type: 'horizontalRule', pattern: /^[-*_]{3,}\s*$/ },
  { type: 'blockquote', pattern: /^>\s?/ },
  { type: 'unorderedList', pattern: /^\s*[-*+]\s/ },
  { type: 'orderedList', pattern: /^\s*\d+\.\s/ },
  { type: 'taskList', pattern: /^\s*- \[[ x]\]\s/ },
  { type: 'table', pattern: /^\|.+\|/ },
];

/**
 * 解析 Markdown 文本为 MarkdownBlock 列表
 */
export function parseBlocks(content: string, notePath = ''): MarkdownBlock[] {
  if (!content.trim()) return [];

  const blocks: MarkdownBlock[] = [];
  const lines = content.split('\n');
  let index = 0;
  let offset = 0;
  let inCodeFence = false;
  let codeFenceStart = 0;
  let codeFenceLang = '';
  let inFrontmatter = false;
  let frontmatterStart = 0;

  for (const rawLine of lines) {
    const line = rawLine;
    const lineLen = line.length + 1; // +1 for \n
    const trimmed = line.trim();

    // Frontmatter handling
    if (trimmed === '---' && offset === 0 && !inFrontmatter && !inCodeFence) {
      inFrontmatter = true;
      frontmatterStart = offset;
      offset += lineLen;
      continue;
    }
    if (inFrontmatter && trimmed === '---') {
      inFrontmatter = false;
      blocks.push(
        createBlock(
          index++,
          'frontmatter',
          content.slice(frontmatterStart, offset + line.length),
          frontmatterStart,
          offset + line.length,
          true,
          notePath,
        ),
      );
      offset += lineLen;
      continue;
    }
    if (inFrontmatter) {
      offset += lineLen;
      continue;
    }

    // Code fence handling
    const fenceMatch = trimmed.match(/^```(\w*)/);
    if (fenceMatch && !inCodeFence) {
      inCodeFence = true;
      codeFenceStart = offset;
      codeFenceLang = fenceMatch[1] ?? '';
      offset += lineLen;
      continue;
    }
    if (trimmed === '```' && inCodeFence) {
      inCodeFence = false;
      blocks.push(
        createBlock(
          index++,
          'codeBlock',
          content.slice(codeFenceStart, offset + line.length),
          codeFenceStart,
          offset + line.length,
          true,
          notePath,
          { language: codeFenceLang },
        ),
      );
      offset += lineLen;
      continue;
    }
    if (inCodeFence) {
      offset += lineLen;
      continue;
    }

    // Empty line
    if (!trimmed) {
      offset += lineLen;
      continue;
    }

    // Try line matchers
    let matched = false;
    for (const matcher of LINE_MATCHERS) {
      if (matcher.pattern.test(line)) {
        blocks.push(
          createBlock(index++, matcher.type, line, offset, offset + line.length, true, notePath),
        );
        offset += lineLen;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Fallback: paragraph
    blocks.push(
      createBlock(index++, 'paragraph', line, offset, offset + line.length, true, notePath),
    );
    offset += lineLen;
  }

  // Unclosed code fence = invalid block
  if (inCodeFence) {
    blocks.push(
      createBlock(
        index++,
        'codeBlock',
        content.slice(codeFenceStart),
        codeFenceStart,
        offset,
        false,
        notePath,
        { language: codeFenceLang },
      ),
    );
  }

  return blocks;
}

/** 创建 MarkdownBlock 辅助 */
function createBlock(
  index: number,
  type: BlockType,
  raw: string,
  from: number,
  to: number,
  isValid: boolean,
  notePath: string,
  meta?: Record<string, unknown>,
): MarkdownBlock {
  return {
    id: `${notePath}::${from}`,
    index,
    type,
    raw,
    from,
    to,
    isValid,
    mode: 'source',
    meta,
  };
}
