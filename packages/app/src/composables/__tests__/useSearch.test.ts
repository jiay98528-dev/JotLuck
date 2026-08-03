import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { parseSearchQuery, useSearch } from '../useSearch';
import { useIndexStore } from '@/stores/index';
import { useSearchStore } from '@/stores/search';
import { MockFSService } from '@/services/MockFSService';

describe('parseSearchQuery', () => {
  it('recognizes one regex literal between filters and preserves outside text', () => {
    const query = parseSearchQuery('alpha tag:入门 /欢迎\\s+使用/im folder:docs beta');

    expect(query).toMatchObject({
      text: 'alpha beta',
      regex: '欢迎\\s+使用',
      regexFlags: 'im',
      tags: ['入门'],
      folder: 'docs',
    });
  });

  it('allows spaces and escaped slashes inside the regex literal', () => {
    const query = parseSearchQuery(String.raw`tag:web /assets\/hero image\.png/g`);

    expect(query.text).toBe('');
    expect(query.regex).toBe(String.raw`assets\/hero image\.png`);
    expect(query.regexFlags).toBe('g');
    expect(query.tags).toEqual(['web']);
  });

  it('uses case-insensitive matching when the literal has no flags', () => {
    expect(parseSearchQuery('/Welcome/')).toMatchObject({
      text: '',
      regex: 'Welcome',
      regexFlags: 'i',
    });
  });

  it('keeps an unclosed slash expression as ordinary text', () => {
    expect(parseSearchQuery('tag:入门 /欢迎 使用')).toMatchObject({
      text: '/欢迎 使用',
      tags: ['入门'],
    });
    expect(parseSearchQuery('tag:入门 /欢迎 使用')).not.toHaveProperty('regex');
  });
});

describe('useSearch workspace ordering', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps debounce timers isolated between composable instances', async () => {
    const indexStore = useIndexStore();
    await indexStore.initialize(new MockFSService(0, { persist: false }), true);
    const engine = indexStore.getEngine();
    expect(engine).not.toBeNull();
    const searchSpy = vi.spyOn(engine!, 'search');
    const first = useSearch();
    const second = useSearch();
    vi.useFakeTimers();

    first.searchWithDebounce('欢迎');
    second.searchWithDebounce('项目');
    await vi.advanceTimersByTimeAsync(250);

    expect(searchSpy).toHaveBeenCalledTimes(2);
  });

  it('invalidates delayed searches and clears visible state when the index workspace resets', async () => {
    const indexStore = useIndexStore();
    await indexStore.initialize(new MockFSService(0, { persist: false }), true);
    const engine = indexStore.getEngine();
    expect(engine).not.toBeNull();
    const searchSpy = vi.spyOn(engine!, 'search');
    const search = useSearch();
    const searchStore = useSearchStore();
    searchStore.addToHistory('保留的历史');
    searchStore.open();
    vi.useFakeTimers();

    search.searchWithDebounce('旧工作区查询');
    indexStore.reset();
    await vi.advanceTimersByTimeAsync(250);

    expect(searchSpy).not.toHaveBeenCalled();
    expect(searchStore.query).toBe('');
    expect(searchStore.results).toEqual([]);
    expect(searchStore.isVisible).toBe(false);
    expect(searchStore.searchHistory).toEqual(['保留的历史']);
  });
});
