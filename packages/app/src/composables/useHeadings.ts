/**
 * useHeadings — Markdown 标题解析 composable
 *
 * 解析 # H1 ~ ###### H6 → 递归树结构
 *
 * @see migration-map.md §5
 */
import { ref } from 'vue';
import type { HeadingItem } from '@/types';
import { headingIdFromText } from '@jotluck/renderer';

export function useHeadings() {
  const headings = ref<HeadingItem[]>([]);

  function parseHeadings(content: string): HeadingItem[] {
    const lines = content.split('\n');
    const root: HeadingItem[] = [];
    const stack: HeadingItem[] = [];
    const occurrences = new Map<string, number>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const atxMatch = line.match(/^(#{1,6})\s+(.+)$/);
      const setextMatch =
        i > 0 && /^(=+|-+)\s*$/.test(line)
          ? { text: lines[i - 1] ?? '', level: line[0] === '=' ? 1 : 2 }
          : null;
      if (!atxMatch && !setextMatch) continue;

      const level = atxMatch ? atxMatch[1]!.length : setextMatch!.level;
      const text = (atxMatch ? atxMatch[2]! : setextMatch!.text).replace(/\s+#+\s*$/, '').trim();
      const baseId = headingIdFromText(text);
      const occurrence = (occurrences.get(baseId) ?? 0) + 1;
      occurrences.set(baseId, occurrence);
      const item: HeadingItem = {
        id: headingIdFromText(text, occurrence),
        level,
        text,
        lineNumber: setextMatch ? i : i + 1,
        children: [],
      };

      // Pop stack until we find a parent with lower level
      while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 7) >= level) {
        stack.pop();
      }

      if (stack.length === 0) {
        root.push(item);
      } else {
        stack[stack.length - 1]!.children.push(item);
      }

      stack.push(item);
    }

    return root;
  }

  function update(content: string): void {
    headings.value = parseHeadings(content);
  }

  function getActiveHeadingId(cursorLine: number): string | null {
    function findClosest(items: HeadingItem[], best: HeadingItem | null): HeadingItem | null {
      for (const item of items) {
        if (item.lineNumber <= cursorLine) {
          if (!best || item.lineNumber > best.lineNumber) best = item;
        }
        best = findClosest(item.children, best);
      }
      return best;
    }
    return findClosest(headings.value, null)?.id ?? null;
  }

  return { headings, parseHeadings, update, getActiveHeadingId };
}
