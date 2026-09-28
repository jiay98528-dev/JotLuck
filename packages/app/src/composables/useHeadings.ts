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
import { ref, getCurrentScope, onScopeDispose } from 'vue';
import type { ChangeDesc, Text } from '@codemirror/state';
import type { DocumentAnalysis } from '@/services/document-analysis';
import type { HeadingItem } from '@/types';
import { parseDocument, type DocumentAst, type HeadingNode } from '@jotluck/renderer';

export function useHeadings(analysis?: DocumentAnalysis) {
  const headings = ref<HeadingItem[]>([]);
  const ordered = ref<HeadingItem[]>([]);
  let revision = -1;

  /**
   * 把 parseDocument 的 heading 节点映射为树形 HeadingItem。
   * 节点已天然剔除 frontmatter/codeFence/jsonBlock 内部 `## 形似标题`；
   * ATX level 与 setext 规则线判定走 AST 一致口径，
   * setext 行号 = lineFrom + 1（AST 的 lineFrom 是 0 基闭区间 lineTo 指向规则线），
   * 而 ATX 直接是 lineFrom + 1。
   */
  function buildTree(content: string, ast: DocumentAst = parseDocument(content)): HeadingItem[] {
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
        from: node.range.from,
        to: node.range.to,
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
    if (analysis) {
      analysis.update(content);
      return;
    }
    headings.value = buildTree(content);
    ordered.value = flatten(headings.value);
  }

  if (analysis) {
    const unsubscribe = analysis.subscribe(({ ast, revision: version }) => {
      revision = version;
      headings.value = buildTree(ast.source, ast);
      ordered.value = flatten(headings.value);
    });
    if (getCurrentScope()) onScopeDispose(unsubscribe);
  }

  function flatten(items: HeadingItem[]): HeadingItem[] {
    return items.flatMap((item) => [item, ...flatten(item.children)]);
  }
  function atPosition(position: number): HeadingItem | null {
    const items = ordered.value;
    let low = 0,
      high = items.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((items[mid]!.from ?? 0) <= position) low = mid + 1;
      else high = mid;
    }
    return items[low - 1] ?? null;
  }
  function getActiveHeadingId(cursorLine: number): string | null {
    const items = ordered.value.length ? ordered.value : flatten(headings.value);
    let low = 0,
      high = items.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (items[mid]!.lineNumber <= cursorLine) low = mid + 1;
      else high = mid;
    }
    return items[low - 1]?.id ?? null;
  }
  function mapChanges(changes: ChangeDesc, doc: Text, version: number): void {
    if (revision !== version - 1) return;
    for (const item of ordered.value) {
      item.from = changes.mapPos(item.from ?? 0, 1);
      item.to = Math.max(item.from, changes.mapPos(item.to ?? item.from, -1));
      item.lineNumber = doc.lineAt(Math.min(doc.length, item.from)).number;
    }
    revision = version;
  }
  function clear(): void {
    headings.value = [];
    ordered.value = [];
    revision = -1;
  }
  return {
    headings,
    ordered,
    parseHeadings,
    update,
    getActiveHeadingId,
    atPosition,
    mapChanges,
    clear,
  };
}
