<template>
  <div
    class="search-result-item"
    :class="{ 'search-result-item--selected': selected }"
    @click="$emit('click', result)"
  >
    <div class="result-title">
      <span class="result-name">{{ result.noteTitle || result.notePath }}</span>
    </div>
    <div v-if="result.matches[0]?.context" class="result-context">
      {{ result.matches[0].context }}
    </div>
    <div class="result-path">{{ result.notePath }}</div>
  </div>
</template>

<script setup lang="ts">
/**
 * SearchResultItem.vue — 单条搜索结果
 *
 * M2-11: 显示搜索结果条目，含匹配上下文。
 *
 * @see components.md §21
 */
import type { SearchResult } from '@/types';

defineProps<{
  result: SearchResult;
  selected?: boolean;
}>();

defineEmits<{
  click: [result: SearchResult];
}>();
</script>

<style scoped>
.search-result-item {
  padding: 10px 16px;
  cursor: pointer;
  border-bottom: 1px solid var(--rule, oklch(0.88 0.003 85));
}

.search-result-item:hover {
  background: var(--accent-soft, oklch(0.92 0.03 250 / 0.55));
}

.search-result-item--selected {
  background: var(--accent-soft, oklch(0.92 0.03 250 / 0.55));
  border-left: 3px solid var(--accent, oklch(0.52 0.12 250));
}

.result-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 500;
  color: var(--ink-primary, oklch(0.15 0.003 85));
}

.result-context {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ink-secondary, oklch(0.42 0.003 85));
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.result-path {
  margin-top: 2px;
  font-size: 11px;
  color: var(--ink-muted, oklch(0.6 0.002 85));
  font-family: var(--ff-mono, monospace);
}
</style>
