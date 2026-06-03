/**
 * useMarkdownParser — 块解析 + 渲染 composable
 *
 * M1-06: 提供块解析和 Markdown 渲染的响应式 API。
 *
 * @module useMarkdownParser
 */

import { ref, computed } from 'vue';
import { renderMarkdown, highlightCodeBlocks } from '@markluck/renderer';
import { parseBlocks } from '@/services/block-parser';
import type { MarkdownBlock } from '@/types';

export function useMarkdownParser(notePath: string) {
  const source = ref('');
  const blocks = ref<MarkdownBlock[]>([]);
  const renderedHtml = ref('');

  /** 解析源码为块列表 */
  function updateBlocks(content: string): void {
    source.value = content;
    if (content.trim() === '') {
      blocks.value = [];
      renderedHtml.value = '';
      return;
    }
    blocks.value = parseBlocks(content, notePath);
  }

  /** 渲染源码为安全 HTML */
  function updateRendered(): void {
    renderedHtml.value = renderMarkdown(source.value);
  }

  /** 对 DOM 容器执行代码高亮 */
  function applyHighlight(container: HTMLElement): void {
    highlightCodeBlocks(container);
  }

  /** 切换单个块的显示模式 */
  function toggleBlockMode(index: number): void {
    const block = blocks.value[index];
    if (!block) return;

    const newMode = block.mode === 'source' ? 'render' : 'source';
    blocks.value[index] = { ...block, mode: newMode };

    if (newMode === 'render') {
      const rendered = renderMarkdown(block.raw);
      blocks.value[index]!.renderedHtml = rendered;
    }
  }

  const blockCount = computed(() => blocks.value.length);

  return {
    source,
    blocks,
    renderedHtml,
    blockCount,
    updateBlocks,
    updateRendered,
    applyHighlight,
    toggleBlockMode,
  };
}
