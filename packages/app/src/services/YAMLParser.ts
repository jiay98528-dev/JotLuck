/**
 * YAMLParser — YAML frontmatter 解析器
 *
 * 边界判定改由 @jotluck/renderer 的 parseDocument 提供，确保 frontmatter
 * 与代码块 / 裸 JSON 等其它块级结构使用同一套解析语义。
 */
import { parseDocument } from '@jotluck/renderer';

export interface FrontmatterData {
  title?: string;
  tags?: string | string[];
  created?: string;
  updated?: string;
  [key: string]: unknown;
}

export interface FrontmatterResult {
  data: FrontmatterData;
  raw: string;
  contentStart: number;
  hasFrontmatter: boolean;
}

export function parseFrontmatter(content: string): FrontmatterResult {
  const node = parseDocument(content).frontmatter;
  // 等价规则（与旧正则 `^---\s*\n[\s\S]*?\n---\s*\n` 对齐）：
  // 节点存在 且 已闭合 且 闭合行后紧跟 '\n'。
  if (!node || !node.closed || content[node.range.to] !== '\n') {
    return { data: {}, raw: '', contentStart: 0, hasFrontmatter: false };
  }

  const raw = node.rawContent;
  const data: FrontmatterData = {};
  const lines = raw.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: string | string[] = line.slice(colonIdx + 1).trim();

    if (key === 'tags') {
      if (value.startsWith('[') && value.endsWith(']')) {
        value = value
          .slice(1, -1)
          .split(',')
          .map((t) => t.trim().replace(/^["']|["']$/g, ''));
      } else if (!value) {
        const tags: string[] = [];
        while (index + 1 < lines.length) {
          const item = /^\s*-\s+(.+?)\s*$/.exec(lines[index + 1] ?? '');
          if (!item) break;
          const tag = item[1]?.trim().replace(/^["']|["']$/g, '');
          if (tag) tags.push(tag);
          index++;
        }
        value = tags;
      }
    }
    (data as Record<string, unknown>)[key] = value;
  }

  return { data, raw, contentStart: node.range.to + 1, hasFrontmatter: true };
}

export function stripFrontmatter(content: string): string {
  const result = parseFrontmatter(content);
  return result.hasFrontmatter ? content.slice(result.contentStart) : content;
}

export function extractTitle(content: string): string {
  const ast = parseDocument(content);
  // 与旧实现 `/^#\s+(.+)$/m` 的明示收紧：fence 内的 `# x` 不再被当作标题。
  const firstH1 = ast.blocks.find((b) => b.type === 'heading' && b.level === 1);
  return firstH1?.type === 'heading' ? firstH1.text : '';
}
