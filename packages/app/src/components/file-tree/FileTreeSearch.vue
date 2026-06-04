<template>
  <div class="file-tree-search">
    <input
      v-model="query"
      type="text"
      class="file-tree-search__input"
      placeholder="搜索文件名..."
      @input="onInput"
    />
    <span v-if="query" class="file-tree-search__count">{{ count }} 个结果</span>
  </div>
</template>

<script setup lang="ts">
/**
 * FileTreeSearch.vue — 文件名搜索组件
 *
 * P2-2: 独立于 MD 内容搜索的文件名过滤输入。
 * 客户端即时过滤，无需建立索引。
 *
 * @see milestones.md M1-14 (FileTree 增强)
 */
import { ref } from 'vue';

defineProps<{
  count?: number;
}>();

const emit = defineEmits<{
  search: [query: string];
}>();

const query = ref('');

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function onInput(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    emit('search', query.value);
  }, 150);
}
</script>

<style scoped>
.file-tree-search {
  padding: 6px 8px;
  border-bottom: 1px solid var(--rule, oklch(0.88 0.003 85));
}

.file-tree-search__input {
  width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--rule, oklch(0.88 0.003 85));
  border-radius: var(--radius, 2px);
  font-size: var(--text-xs, 12px);
  background: var(--paper-surface, oklch(0.985 0.002 85));
  color: var(--ink-primary, oklch(0.15 0.003 85));
  outline: none;
  transition: border-color 150ms var(--ease-fade, cubic-bezier(0.4, 0, 0.2, 1));
}

.file-tree-search__input:focus {
  border-color: var(--accent, oklch(0.52 0.12 250));
}

.file-tree-search__input::placeholder {
  color: var(--ink-muted, oklch(0.6 0.002 85));
}

.file-tree-search__count {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--ink-muted, oklch(0.6 0.002 85));
}
</style>
