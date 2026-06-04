<template>
  <div class="search-result-list">
    <!-- Loading -->
    <div v-if="loading" class="result-loading">
      <div
        v-for="i in 5"
        :key="i"
        class="result-skeleton-line"
        :style="{ width: 80 - i * 10 + '%' }"
      />
    </div>
    <!-- Empty -->
    <div v-else-if="results.length === 0" class="result-empty">
      <slot name="empty">未找到匹配结果</slot>
    </div>
    <!-- Normal -->
    <template v-else>
      <div class="result-header">
        <slot name="header">共 {{ totalCount }} 条结果</slot>
      </div>
      <slot
        v-for="(result, index) in results"
        :key="result.notePath"
        name="item"
        :result="result"
        :selected="selectedIndex === index"
        :index="index"
      >
        <SearchResultItem
          :result="result"
          :selected="selectedIndex === index"
          @click="$emit('select', result)"
        />
      </slot>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * SearchResultList.vue — 搜索结果列表
 *
 * M2-10: 搜索结果列表容器，支持加载/空状态。
 *
 * @see components.md §20
 */
import type { SearchResult } from '@/types';
import SearchResultItem from './SearchResultItem.vue';

defineProps<{
  results: SearchResult[];
  selectedIndex?: number;
  loading?: boolean;
  totalCount?: number;
}>();

defineEmits<{
  select: [result: SearchResult];
}>();
</script>

<style scoped>
.search-result-list {
  flex: 1;
  overflow-y: auto;
}

.result-loading,
.result-empty {
  padding: 24px 16px;
  text-align: center;
  color: var(--ink-muted, oklch(0.6 0.002 85));
}

.result-skeleton-line {
  height: 36px;
  background: var(--rule, oklch(0.88 0.003 85));
  border-radius: var(--radius, 2px);
  margin: 0 auto 8px;
}

.result-header {
  padding: 8px 16px;
  font-size: 12px;
  color: var(--ink-muted, oklch(0.6 0.002 85));
  border-bottom: 1px solid var(--rule, oklch(0.88 0.003 85));
}
</style>
