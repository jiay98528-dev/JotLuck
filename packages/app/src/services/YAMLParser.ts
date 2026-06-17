/** YAMLParser — YAML frontmatter 解析器 @see migration-map.md §4 */
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
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!match) return { data: {}, raw: '', contentStart: 0, hasFrontmatter: false };

  const raw = match[1] ?? '';
  const data: FrontmatterData = {};

  for (const line of raw.split('\n')) {
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
      }
    }
    (data as Record<string, unknown>)[key] = value;
  }

  return { data, raw, contentStart: match[0].length, hasFrontmatter: true };
}

export function stripFrontmatter(content: string): string {
  const result = parseFrontmatter(content);
  return result.hasFrontmatter ? content.slice(result.contentStart) : content;
}

export function extractTitle(content: string): string {
  const body = stripFrontmatter(content);
  const h1 = body.match(/^#\s+(.+)$/m);
  return h1?.[1]?.trim() ?? '';
}
