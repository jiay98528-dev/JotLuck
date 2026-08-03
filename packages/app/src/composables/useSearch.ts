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
import { getCurrentScope, onScopeDispose } from 'vue';

const DEBOUNCE_MS = 250;

export function useSearch() {
  const searchStore = useSearchStore();
  const indexStore = useIndexStore();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let requestRevision = 0;

  function cancelPendingSearch(): void {
    requestRevision++;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  function runSearch(
    queryText: string,
    workspaceRevision: number,
    expectedRequestRevision: number,
  ): void {
    if (
      workspaceRevision !== searchStore.workspaceRevision ||
      expectedRequestRevision !== requestRevision
    ) {
      return;
    }
    const engine = indexStore.getEngine();
    if (!engine) {
      searchStore.clearResults();
      return;
    }

    const query = parseSearchQuery(queryText);
    const results = engine.search(query);
    if (
      workspaceRevision !== searchStore.workspaceRevision ||
      expectedRequestRevision !== requestRevision ||
      engine !== indexStore.getEngine()
    ) {
      return;
    }
    searchStore.setResults(results);
    if (queryText.trim()) searchStore.addToHistory(queryText);
  }

  function searchWithDebounce(queryText: string): void {
    cancelPendingSearch();
    searchStore.setQuery(queryText);

    if (!queryText.trim()) {
      searchStore.clearResults();
      return;
    }

    const workspaceRevision = searchStore.workspaceRevision;
    const expectedRequestRevision = requestRevision;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      runSearch(queryText, workspaceRevision, expectedRequestRevision);
    }, DEBOUNCE_MS);
  }

  function searchImmediately(queryText: string): void {
    cancelPendingSearch();
    searchStore.setQuery(queryText);
    if (!queryText.trim()) {
      searchStore.clearResults();
      return;
    }
    runSearch(queryText, searchStore.workspaceRevision, requestRevision);
  }

  function selectResultByQuery(tagQuery: string): void {
    openSearch(tagQuery);
    searchImmediately(tagQuery);
  }

  function openSearch(initialQuery?: string): void {
    searchStore.open(initialQuery);
  }

  function closeSearch(): void {
    cancelPendingSearch();
    searchStore.close();
  }

  function resetWorkspaceState(): void {
    cancelPendingSearch();
    searchStore.resetWorkspaceState();
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

  if (getCurrentScope()) onScopeDispose(cancelPendingSearch);

  return {
    searchWithDebounce,
    searchImmediately,
    selectResultByQuery,
    openSearch,
    closeSearch,
    resetWorkspaceState,
    navigateUp,
    navigateDown,
    getSelected,
  };
}

interface ParsedRegexLiteral {
  pattern: string;
  flags: string;
  start: number;
  end: number;
}

function findRegexLiteral(raw: string): ParsedRegexLiteral | null {
  for (let start = 0; start < raw.length; start++) {
    if (raw[start] !== '/' || (start > 0 && !/\s/.test(raw[start - 1]!))) continue;

    let escaped = false;
    for (let cursor = start + 1; cursor < raw.length; cursor++) {
      const char = raw[cursor]!;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char !== '/') continue;

      let end = cursor + 1;
      while (end < raw.length && /[a-z]/i.test(raw[end]!)) end++;
      if (end < raw.length && !/\s/.test(raw[end]!)) continue;

      const pattern = raw.slice(start + 1, cursor);
      if (!pattern) continue;
      return {
        pattern,
        flags: raw.slice(cursor + 1, end),
        start,
        end,
      };
    }
  }
  return null;
}

export function parseSearchQuery(raw: string): SearchQuery {
  const tags: string[] = [];
  let folder: string | undefined;
  let dateRange: DateRange | undefined;
  const textParts: string[] = [];

  const regexLiteral = findRegexLiteral(raw);
  const filterSource = regexLiteral
    ? `${raw.slice(0, regexLiteral.start)} ${raw.slice(regexLiteral.end)}`
    : raw;

  const parts = filterSource.split(/\s+/);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('tag:')) {
      const tag = part.slice(4);
      if (tag) tags.push(tag);
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
    ...(regexLiteral
      ? {
          regex: regexLiteral.pattern,
          regexFlags: regexLiteral.flags || 'i',
        }
      : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(folder ? { folder } : {}),
    ...(dateRange ? { dateRange } : {}),
  } as SearchQuery;
}
