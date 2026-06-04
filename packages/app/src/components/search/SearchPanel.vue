<template>
  <Teleport to="body">
    <div v-if="visible" class="search-overlay" @click.self="close">
      <div class="search-panel" @keydown="handleKeydown">
        <!-- Search Input -->
        <div class="search-input-wrapper">
          <span class="search-icon">&#x2315;</span>
          <input
            ref="inputRef"
            v-model="localQuery"
            class="search-input"
            placeholder="搜索笔记... (支持 tag:xxx /regex/ date:YYYY-MM..YYYY-MM)"
            @input="onInput"
            @keydown.enter="onEnter"
            @keydown.escape="close"
          />
          <button v-if="localQuery" class="search-clear" @click="clear">&times;</button>
        </div>

        <!-- Filter hints -->
        <div v-if="hasActiveFilters" class="search-filters">
          <span v-if="parsedTags.length" class="filter-tag"> tag:{{ parsedTags.join(', ') }} </span>
          <span v-if="parsedDateRange" class="filter-tag"> date:{{ parsedDateRange }} </span>
        </div>

        <!-- Results -->
        <div class="search-results">
          <!-- Searching: skeleton lines -->
          <div v-if="isSearching" class="search-status">
            <div
              v-for="i in 5"
              :key="i"
              class="search-skeleton-line"
              :style="{ width: 80 - i * 10 + '%' }"
            />
          </div>
          <!-- History -->
          <div v-else-if="!hasQuery && searchHistory.length > 0" class="search-history">
            <div class="search-history-header">
              <span>最近搜索</span>
              <button class="search-clear-btn" @click="clearHistory">清除</button>
            </div>
            <div
              v-for="item in searchHistory"
              :key="item"
              class="search-history-item"
              @click="selectHistory(item)"
            >
              {{ item }}
            </div>
          </div>
          <!-- Empty -->
          <div v-else-if="hasQuery && !isSearching && results.length === 0" class="search-empty">
            未找到匹配 "{{ localQuery }}" 的笔记
          </div>
          <!-- Results -->
          <div v-else-if="results.length > 0" class="search-results-list">
            <div class="search-results-header">共 {{ results.length }} 条结果</div>
            <SearchResultItem
              v-for="(result, index) in results"
              :key="result.notePath"
              :result="result"
              :selected="selectedIndex === index"
              @click="selectResult(result)"
            />
          </div>
        </div>

        <!-- Footer shortcuts -->
        <div class="search-footer">
          <span>&uarr;&darr; 导航 &middot; Enter 打开 &middot; Esc 关闭</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * SearchPanel.vue — 全局搜索浮层面板（纸张主题）
 */
import { ref, watch, computed, nextTick } from 'vue';
import { useSearchStore } from '@/stores/search';
import { useSearch } from '@/composables/useSearch';
import SearchResultItem from './SearchResultItem.vue';
import type { SearchResult } from '@/types';

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
  'select-result': [result: SearchResult];
}>();

const searchStore = useSearchStore();
const { searchWithDebounce, searchImmediately } = useSearch();

const inputRef = ref<HTMLInputElement | null>(null);
const localQuery = ref('');

const results = computed(() => searchStore.results);
const isSearching = computed(() => searchStore.isSearching);
const selectedIndex = computed(() => searchStore.selectedIndex);
const searchHistory = computed(() => searchStore.searchHistory);
const hasQuery = computed(() => localQuery.value.trim().length > 0);

const parsedTags = computed(() => {
  const matches = localQuery.value.match(/tag:(\S+)/gi);
  return matches ? matches.map((m) => m.slice(4)) : [];
});
const parsedDateRange = computed(() => {
  const m = localQuery.value.match(/date:(\S+)/i);
  return m ? m[1] : '';
});
const hasActiveFilters = computed(() => parsedTags.value.length > 0 || !!parsedDateRange.value);

watch(
  () => props.visible,
  async (v) => {
    if (v) {
      searchStore.loadHistory();
      await nextTick();
      inputRef.value?.focus();
      localQuery.value = searchStore.query || '';
    }
  },
);

function onInput(): void {
  searchWithDebounce(localQuery.value);
}
function onEnter(): void {
  searchImmediately(localQuery.value);
}
function close(): void {
  emit('update:visible', false);
}
function clear(): void {
  localQuery.value = '';
  searchStore.clearResults();
  inputRef.value?.focus();
}
function selectHistory(item: string): void {
  localQuery.value = item;
  searchImmediately(item);
}
function selectResult(result: SearchResult): void {
  searchStore.addToHistory(localQuery.value);
  emit('select-result', result);
}
function clearHistory(): void {
  searchStore.clearHistory();
}

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    searchStore.selectNext();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    searchStore.selectPrev();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const selected = searchStore.getSelected();
    if (selected) selectResult(selected);
    else searchImmediately(localQuery.value);
  }
}
</script>

<style scoped>
.search-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  z-index: var(--z-overlay);
  display: flex;
  justify-content: center;
  padding-top: 10vh;
}

.search-panel {
  width: 560px;
  max-height: 70vh;
  background: var(--paper-raised);
  border-radius: var(--radius);
  box-shadow: var(--shadow-float);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: var(--border-thin) solid var(--rule);
}

/* --- Input area --- */
.search-input-wrapper {
  display: flex;
  align-items: center;
  padding: var(--space-12) var(--space-16);
  border-bottom: var(--border-thin) solid var(--rule);
  gap: var(--space-8);
  background: var(--paper-surface);
}

.search-icon {
  font-size: 16px;
  flex-shrink: 0;
  color: var(--ink-muted);
  font-family: var(--ff-mono);
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: var(--text-base);
  font-family: var(--ff-mono);
  color: var(--ink-primary);
  background: transparent;
}

.search-input::placeholder {
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

.search-clear {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  font-size: 18px;
  color: var(--ink-muted);
  cursor: pointer;
  border-radius: var(--radius);
  transition:
    background var(--dur-micro) var(--ease-fade),
    color var(--dur-micro) var(--ease-fade);
}

.search-clear:hover {
  background: var(--surface-hover);
  color: var(--ink-primary);
}

/* --- Filters --- */
.search-filters {
  display: flex;
  gap: 6px;
  padding: 6px var(--space-16);
  border-bottom: var(--border-thin) solid var(--rule);
}

.filter-tag {
  font-size: var(--text-xs);
  padding: 2px var(--space-8);
  border-radius: var(--radius);
  background: var(--accent-soft);
  color: var(--accent);
  font-family: var(--ff-mono);
}

/* --- Results area --- */
.search-results {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.search-status,
.search-history,
.search-empty {
  padding: var(--space-24) var(--space-16);
  text-align: center;
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

.search-skeleton-line {
  height: 36px;
  border-radius: var(--radius);
  margin: 0 auto var(--space-8);
  animation: skeleton-shimmer var(--dur-shimmer) ease-in-out infinite;
  background: linear-gradient(90deg, var(--rule) 0%, var(--paper-surface) 40%, var(--rule) 80%);
  background-size: 200% 100%;
}

@keyframes skeleton-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

/* --- Search history --- */
.search-history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-12);
  font-size: var(--text-xs);
  color: var(--ink-muted);
}

.search-clear-btn {
  border: none;
  background: none;
  color: var(--accent);
  cursor: pointer;
  font-size: var(--text-xs);
}

.search-history-item {
  padding: var(--space-8) var(--space-16);
  cursor: pointer;
  font-size: var(--text-sm);
  color: var(--ink-secondary);
  text-align: left;
  border-radius: var(--radius);
  margin: 2px var(--space-8);
  transition: background var(--dur-micro) var(--ease-fade);
}

.search-history-item:hover {
  background: var(--surface-hover);
  color: var(--ink-primary);
}

.search-results-header {
  padding: var(--space-8) var(--space-16);
  font-size: var(--text-xs);
  color: var(--ink-muted);
  border-bottom: var(--border-thin) solid var(--rule);
}

/* --- Footer --- */
.search-footer {
  padding: var(--space-8) var(--space-16);
  border-top: var(--border-thin) solid var(--rule);
  font-size: var(--text-xs);
  color: var(--ink-muted);
  text-align: center;
}
</style>
