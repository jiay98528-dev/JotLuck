/**
 * useSearch — 搜索功能组合式函数
 *
 * M2-08~11: 封装搜索逻辑，连接 useSearchStore 和 SearchEngine。
 * 提供防抖搜索、高级查询解析、搜索结果导航。
 *
 * @module useSearch
 */

import { ref } from 'vue';
import { useSearchStore } from '@/stores/search';
import { useIndexStore } from '@/stores/index';
import type { SearchQuery } from '@/types';

export function useSearch() {
  const searchStore = useSearchStore();
  const indexStore = useIndexStore();

  const debounceTimer = ref<ReturnType<typeof setTimeout> | null>(null);
  const DEBOUNCE_MS = 300;

  /** 执行搜索（带防抖） */
  function searchWithDebounce(queryText: string): void {
    searchStore.setQuery(queryText);

    if (debounceTimer.value) {
      clearTimeout(debounceTimer.value);
    }

    if (!queryText.trim()) {
      searchStore.clearResults();
      return;
    }

    debounceTimer.value = setTimeout(() => {
      executeSearch(queryText);
    }, DEBOUNCE_MS);
  }

  /** 立即搜索（Enter 触发） */
  function searchImmediately(queryText: string): void {
    if (debounceTimer.value) {
      clearTimeout(debounceTimer.value);
    }
    searchStore.setQuery(queryText);
    if (!queryText.trim()) {
      searchStore.clearResults();
      return;
    }
    executeSearch(queryText);
  }

  /** 通过搜索词选择结果 */
  function selectResultByQuery(tagQuery: string): void {
    searchStore.open(tagQuery);
    searchImmediately(tagQuery);
  }

  /** 打开搜索面板 */
  function openSearch(initialQuery = ''): void {
    searchStore.loadHistory();
    searchStore.open(initialQuery);
  }

  /** 关闭搜索面板 */
  function closeSearch(): void {
    searchStore.close();
    searchStore.clearResults();
  }

  /** 键盘导航 */
  function navigateUp(): void {
    searchStore.selectPrev();
  }

  function navigateDown(): void {
    searchStore.selectNext();
  }

  function getSelected() {
    return searchStore.getSelected();
  }

  // ---- Private ----

  function executeSearch(queryText: string): void {
    const engine = indexStore.getEngine();
    if (!engine) {
      searchStore.setResults([]);
      return;
    }

    searchStore.isSearching = true;

    try {
      const query: SearchQuery = { text: queryText, limit: 50 };
      const results = engine.search(query);
      searchStore.setResults(results);

      if (queryText.trim()) {
        searchStore.addToHistory(queryText);
      }
    } catch (e) {
      searchStore.error = e instanceof Error ? e.message : '搜索出错';
      searchStore.setResults([]);
    } finally {
      searchStore.isSearching = false;
    }
  }

  return {
    searchWithDebounce,
    searchImmediately,
    selectResultByQuery,
    openSearch,
    closeSearch,
    navigateUp,
    navigateDown,
    getSelected,
  };
}
