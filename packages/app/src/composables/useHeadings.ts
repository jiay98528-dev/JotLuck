/**
 * useHeadings — Markdown 标题解析 composable
 *
 * 解析 # H1 ~ ###### H6 → 递归树结构
 *
 * 解析源由原 ATX/setext 正则改为消费 renderer 块级 AST（parseDocument），
 * 天然支持 frontmatter / codeFence / jsonBlock 块内 `# 注释` 过滤，
 * id occurrence 由 AST 的 headingIdFromText 同名递增保证。
 *
 * @see migration-map.md §5
 */
import { ref } from 'vue';
import type { HeadingItem } from '@/types';
import { parseDocument, type HeadingNode } from '@jotluck/renderer';

export function useHeadings() {
  const headings = ref<HeadingItem[]>([]);

  /**
   * 把 parseDocument 的 heading 节点映射为树形 HeadingItem。
   * 节点已天然剔除 frontmatter/codeFence/jsonBlock 内部 `## 形似标题`；
   * ATX level 与 setext 规则线判定走 AST 一致口径，
   * setext 行号 = lineFrom + 1（AST 的 lineFrom 是 0 基闭区间 lineTo 指向规则线），
   * 而 ATX 直接是 lineFrom + 1。
   */
  function buildTree(content: string): HeadingItem[] {
    const ast = parseDocument(content);
    const flat: HeadingItem[] = [];
    for (const block of ast.blocks) {
      if (block.type !== 'heading') continue;
      const node = block as HeadingNode;
      const item: HeadingItem = {
        id: node.id,
        level: node.level,
        text: node.text,
        // ATX 与 setext 都用文本行的 1 基行号；AST 的 lineFrom 即文本行 0 基
        lineNumber: node.lineFrom + 1,
        children: [],
      };
      flat.push(item);
    }

    // 栈式组树：level >= 父级则出栈，直到栈顶 level 严格更浅
    const root: HeadingItem[] = [];
    const stack: HeadingItem[] = [];
    for (const item of flat) {
      while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 7) >= item.level) {
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

  function parseHeadings(content: string): HeadingItem[] {
    return buildTree(content);
  }

  function update(content: string): void {
    headings.value = buildTree(content);
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
