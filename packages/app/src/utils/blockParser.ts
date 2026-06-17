/** blockParser — 行级正则 Markdown 块解析器 @see migration-map.md §6 */
import type { MarkdownBlock } from '@/types';

let idCounter = 0;

const BLOCK_PATTERNS: Array<{ type: MarkdownBlock['type']; regex: RegExp }> = [
  { type: 'heading', regex: /^(#{1,6})\s+(.+)$/ },
  { type: 'horizontalRule', regex: /^_{3,}$|^\*{3,}$|^-{3,}$/ },
  { type: 'codeBlock', regex: /^```/ },
  { type: 'blockquote', regex: /^>\s/ },
  { type: 'unorderedList', regex: /^[\s]*[-*+]\s/ },
  { type: 'orderedList', regex: /^[\s]*\d+\.\s/ },
  { type: 'taskList', regex: /^[\s]*- \[[ x]\]\s/ },
  { type: 'frontmatter', regex: /^---$/ },
];

export function parseBlocks(content: string, _notePath?: string): MarkdownBlock[] {
  const lines = content.split('\n');
  const blocks: MarkdownBlock[] = [];

  let inCodeBlock = false;
  let codeBlockStart = -1;
  let inFrontmatter = false;
  let fmCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // Frontmatter tracking
    if (line === '---' && i === 0) {
      inFrontmatter = true;
      fmCount = 1;
      continue;
    }
    if (inFrontmatter && line === '---') {
      fmCount++;
      if (fmCount >= 2) {
        inFrontmatter = false;
        blocks.push({
          id: `b-${idCounter++}`,
          index: blocks.length,
          type: 'frontmatter',
          raw: content.slice(0, content.indexOf('---', 4) + 3),
          from: 0,
          to: content.indexOf('---', 4) + 3,
          isValid: true,
          mode: 'source',
        });
      }
      continue;
    }
    if (inFrontmatter) continue;

    // Code block tracking
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockStart = i;
      } else {
        inCodeBlock = false;
        const startIdx =
          lines.slice(0, codeBlockStart).join('\n').length + (codeBlockStart > 0 ? 1 : 0);
        const endIdx = lines.slice(0, i + 1).join('\n').length;
        blocks.push({
          id: `b-${idCounter++}`,
          index: blocks.length,
          type: 'codeBlock',
          raw: content.slice(startIdx, endIdx),
          from: startIdx,
          to: endIdx,
          isValid: true,
          mode: 'source',
        });
      }
      continue;
    }
    if (inCodeBlock) continue;

    // Block patterns
    for (const { type, regex } of BLOCK_PATTERNS) {
      if (
        regex.test(line) &&
        type !== 'codeBlock' &&
        type !== 'frontmatter' &&
        type !== 'horizontalRule'
      ) {
        const startIdx = lines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
        const endIdx = startIdx + line.length;
        blocks.push({
          id: `b-${idCounter++}`,
          index: blocks.length,
          type,
          raw: line,
          from: startIdx,
          to: endIdx,
          isValid: true,
          mode: 'source',
        });
        break;
      }
    }
  }

  return blocks;
}
