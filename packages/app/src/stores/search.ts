/**
 * useSearchStore — 搜索状态管理
 *
 * M2-10: 管理搜索查询、结果和过滤条件。
 * 由 SearchPanel 组件和 useSearch composable 共享状态。
 *
 * @module useSearchStore
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { SearchResult } from '@/types';

export const useSearchStore = defineStore('search', () => {
  const query = ref('');
  const results = ref<SearchResult[]>([]);
  const isSearching = ref(false);
  const isVisible = ref(false);
  const error = ref<string | null>(null);
  const searchHistory = ref<string[]>([]);
  const selectedIndex = ref(-1);

  const resultCount = computed(() => results.value.length);
  const hasResults = computed(() => results.value.length > 0);
  const hasQuery = computed(() => query.value.trim().length > 0);

  function setQuery(q: string): void {
    query.value = q;
  }

  function setResults(r: SearchResult[]): void {
    results.value = r;
    selectedIndex.value = r.length > 0 ? 0 : -1;
  }

  function clearResults(): void {
    results.value = [];
    selectedIndex.value = -1;
  }

  function addToHistory(q: string): void {
    if (!q.trim()) return;
    searchHistory.value = [q, ...searchHistory.value.filter((h) => h !== q)].slice(0, 10);
    try {
      localStorage.setItem('markluck-search-history', JSON.stringify(searchHistory.value));
    } catch {
      /* silent */
    }
  }

  function loadHistory(): void {
    try {
      const raw = localStorage.getItem('markluck-search-history');
      if (raw) searchHistory.value = JSON.parse(raw) as string[];
    } catch {
      searchHistory.value = [];
    }
  }

  function clearHistory(): void {
    searchHistory.value = [];
    try {
      localStorage.removeItem('markluck-search-history');
    } catch {
      /* silent */
    }
  }

  function open(queryText = ''): void {
    isVisible.value = true;
    if (queryText) query.value = queryText;
  }

  function close(): void {
    isVisible.value = false;
    query.value = '';
    results.value = [];
    selectedIndex.value = -1;
  }

  function selectNext(): void {
    if (results.value.length === 0) return;
    selectedIndex.value = (selectedIndex.value + 1) % results.value.length;
  }

  function selectPrev(): void {
    if (results.value.length === 0) return;
    selectedIndex.value =
      selectedIndex.value <= 0 ? results.value.length - 1 : selectedIndex.value - 1;
  }

  function getSelected(): SearchResult | null {
    if (selectedIndex.value < 0 || selectedIndex.value >= results.value.length) return null;
    return results.value[selectedIndex.value] ?? null;
  }

  return {
    query,
    results,
    isSearching,
    isVisible,
    error,
    searchHistory,
    selectedIndex,
    resultCount,
    hasResults,
    hasQuery,
    setQuery,
    setResults,
    clearResults,
    addToHistory,
    loadHistory,
    clearHistory,
    open,
    close,
    selectNext,
    selectPrev,
    getSelected,
  };
});
