/**
 * useHeadings — Markdown 标题解析 composable
 *
 * 解析 # H1 ~ ###### H6 → 递归树结构
 *
 * @see migration-map.md §5
 */
import { ref } from 'vue';
import type { HeadingItem } from '@/types';

let idCounter = 0;

export function useHeadings() {
  const headings = ref<HeadingItem[]>([]);

  function parseHeadings(content: string): HeadingItem[] {
    const lines = content.split('\n');
    const root: HeadingItem[] = [];
    const stack: HeadingItem[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (!match) continue;

      const level = match[1]!.length;
      const text = match[2]!.trim();
      const item: HeadingItem = {
        id: `h-${idCounter++}`,
        level,
        text,
        lineNumber: i + 1,
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
