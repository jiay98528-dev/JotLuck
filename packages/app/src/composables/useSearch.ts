/**
 * useSearch — 搜索逻辑组合式函数
 *
 * 封装 SearchEngine + useSearchStore + useIndexStore 的搜索交互。
 *
 * @see migration-map.md §5
 */
import { useSearchStore } from '@/stores/search';
import { useIndexStore } from '@/stores/index';
import type { SearchResult, SearchQuery, DateRange } from '@/types';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 250;

export function useSearch() {
  const searchStore = useSearchStore();
  const indexStore = useIndexStore();

  function searchWithDebounce(queryText: string): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    searchStore.setQuery(queryText);

    if (!queryText.trim()) {
      searchStore.clearResults();
      return;
    }

    debounceTimer = setTimeout(() => {
      searchImmediately(queryText);
    }, DEBOUNCE_MS);
  }

  function searchImmediately(queryText: string): void {
    const engine = indexStore.getEngine();
    if (!engine) return;

    searchStore.setQuery(queryText);
    const query = parseQuery(queryText);
    const results = engine.search(query);
    searchStore.setResults(results);
    if (queryText.trim()) {
      searchStore.addToHistory(queryText);
    }
  }

  function selectResultByQuery(tagQuery: string): void {
    openSearch(tagQuery);
    searchImmediately(tagQuery);
  }

  function openSearch(initialQuery?: string): void {
    searchStore.open(initialQuery);
  }

  function closeSearch(): void {
    searchStore.close();
  }

  function navigateUp(): void {
    searchStore.selectPrev();
  }
  function navigateDown(): void {
    searchStore.selectNext();
  }
  function getSelected(): SearchResult | null {
    return searchStore.getSelected();
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

function parseQuery(raw: string): SearchQuery {
  const tags: string[] = [];
  let folder: string | undefined;
  let dateRange: DateRange | undefined;
  const textParts: string[] = [];

  const parts = raw.split(/\s+/);
  for (const part of parts) {
    if (part.startsWith('tag:')) {
      tags.push(part.slice(4));
    } else if (part.startsWith('date:')) {
      const range = part.slice(5);
      const [from, to] = range.split('..');
      if (from || to) {
        dateRange = {
          from: from ? new Date(from) : undefined,
          to: to ? new Date(to) : undefined,
        };
      }
    } else if (part.startsWith('folder:')) {
      folder = part.slice(7);
    } else {
      textParts.push(part);
    }
  }

  return {
    text: textParts.join(' '),
    ...(tags.length > 0 ? { tags } : {}),
    ...(folder ? { folder } : {}),
    ...(dateRange ? { dateRange } : {}),
  } as SearchQuery;
}
