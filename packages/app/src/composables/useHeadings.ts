/**
 * useHeadings — 标题提取组合式函数
 *
 * M2-14: 从 Markdown 内容中提取标题层级结构 (H1-H6)
 * 用于 NavTree 组件渲染。
 *
 * @module useHeadings
 */

import { ref } from 'vue';
import type { HeadingItem } from '@/types';

/** 标题正则：匹配 # H1 到 ###### H6 */
const HEADING_RE = /^(#{1,6})\s+(.+)$/gm;

export function useHeadings() {
  const headings = ref<HeadingItem[]>([]);

  /** 从 Markdown 内容解析标题树 */
  function parseHeadings(content: string): HeadingItem[] {
    const result: HeadingItem[] = [];
    const stack: HeadingItem[] = [];
    let lineNumber = 0;

    let match: RegExpExecArray | null;
    HEADING_RE.lastIndex = 0;

    while ((match = HEADING_RE.exec(content)) !== null) {
      const level = match[1]?.length ?? 1;
      const text = match[2]?.trim() ?? '';
      lineNumber = content.slice(0, match.index).split('\n').length;

      const item: HeadingItem = {
        id: `h-${lineNumber}`,
        level,
        text,
        lineNumber,
        children: [],
      };

      // 出栈：所有 level >= 当前 level 的节点
      while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) {
        stack.pop();
      }

      if (stack.length === 0) {
        result.push(item);
      } else {
        const parent = stack[stack.length - 1];
        if (parent) {
          parent.children.push(item);
        }
      }

      stack.push(item);
    }

    return result;
  }

  /** 更新内容时重新解析 */
  function update(content: string): void {
    headings.value = parseHeadings(content);
  }

  /** 获取当前光标行对应的标题 ID */
  function getActiveHeadingId(cursorLine: number): string | null {
    let active: string | null = null;
    const walk = (items: HeadingItem[]): void => {
      for (const item of items) {
        if (item.lineNumber <= cursorLine) {
          active = item.id;
        }
        walk(item.children);
      }
    };
    walk(headings.value);
    return active;
  }

  return {
    headings,
    parseHeadings,
    update,
    getActiveHeadingId,
  };
}
