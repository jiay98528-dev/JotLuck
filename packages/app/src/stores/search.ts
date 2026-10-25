/**
 * useSearchStore — 搜索状态管理
 *
 * @see migration-map.md §3
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { SearchResult } from '@/types';

const HISTORY_KEY = 'jotluck-search-history';
const MAX_HISTORY = 10;

export const useSearchStore = defineStore('search', () => {
  const query = ref('');
  const results = ref<SearchResult[]>([]);
  const isSearching = ref(false);
  const isVisible = ref(false);
  const error = ref<string | null>(null);
  const searchHistory = ref<string[]>([]);
  const selectedIndex = ref(-1);
  const workspaceRevision = ref(0);
  /** 外部预设查询（如标签点击 → tag:xxx）：面板打开时一次性消费，防误恢复旧查询。 */
  const presetQuery = ref<string | null>(null);

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
    error.value = null;
  }

  function addToHistory(q: string): void {
    if (!q.trim()) return;
    const filtered = searchHistory.value.filter((h) => h !== q);
    filtered.unshift(q);
    searchHistory.value = filtered.slice(0, MAX_HISTORY);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(searchHistory.value));
    } catch {
      /* ok */
    }
  }

  function loadHistory(): void {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) searchHistory.value = JSON.parse(raw) as string[];
    } catch {
      /* ok */
    }
  }

  /**
   * Starts a new workspace search scope while intentionally preserving the
   * user's cross-workspace query history.
   */
  function resetWorkspaceState(): void {
    workspaceRevision.value++;
    query.value = '';
    results.value = [];
    isSearching.value = false;
    isVisible.value = false;
    error.value = null;
    selectedIndex.value = -1;
    presetQuery.value = null;
  }

  function open(queryText?: string): void {
    if (queryText) {
      query.value = queryText;
      presetQuery.value = queryText;
    }
    isVisible.value = true;
    loadHistory();
  }

  /** 面板打开时一次性消费外部预设查询（消费后回落 null，防二次恢复）。 */
  function consumePresetQuery(): string | null {
    const value = presetQuery.value;
    presetQuery.value = null;
    return value;
  }

  function close(): void {
    isVisible.value = false;
  }

  function selectNext(): void {
    if (results.value.length === 0) return;
    selectedIndex.value = (selectedIndex.value + 1) % results.value.length;
  }

  function selectPrev(): void {
    if (results.value.length === 0) return;
    selectedIndex.value = (selectedIndex.value - 1 + results.value.length) % results.value.length;
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
    workspaceRevision,
    resultCount,
    hasResults,
    hasQuery,
    setQuery,
    setResults,
    clearResults,
    addToHistory,
    loadHistory,
    resetWorkspaceState,
    open,
    consumePresetQuery,
    close,
    selectNext,
    selectPrev,
    getSelected,
  };
});
