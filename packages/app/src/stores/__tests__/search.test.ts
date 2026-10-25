import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSearchStore } from '../search';

const HISTORY_KEY = 'jotluck-search-history';

describe('useSearchStore loadHistory 损坏值防护（L11）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it('合法数组原样载入', () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(['标签查询', '正文检索']));
    const search = useSearchStore();

    search.open();

    expect(search.searchHistory).toEqual(['标签查询', '正文检索']);
  });

  it('对象/字符串/数字等非数组形态：重置为空并清除损坏持久化值', () => {
    for (const raw of ['{"a":1}', '"text"', '42', 'null']) {
      localStorage.setItem(HISTORY_KEY, raw);
      const search = useSearchStore();

      search.open();

      expect(search.searchHistory).toEqual([]);
      expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
    }
  });

  it('元素含非字符串的数组同样判损坏：重置且后续 addToHistory 不再抛 TypeError', () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(['正常', 3, null]));
    const search = useSearchStore();

    search.open();

    expect(search.searchHistory).toEqual([]);
    // 旧实现：searchHistory 落非数组/脏数组，每次 addToHistory 的 filter 抛错
    expect(() => search.addToHistory('新查询')).not.toThrow();
    expect(search.searchHistory).toEqual(['新查询']);
  });

  it('非法 JSON：重置为空并清除损坏键', () => {
    localStorage.setItem(HISTORY_KEY, '{broken json');
    const search = useSearchStore();

    search.open();

    expect(search.searchHistory).toEqual([]);
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
  });

  it('重置后重新写入历史恢复正常持久化链路', () => {
    localStorage.setItem(HISTORY_KEY, '{"a":1}');
    const search = useSearchStore();
    search.open();
    search.addToHistory('恢复后的查询');

    const persisted = localStorage.getItem(HISTORY_KEY);
    expect(persisted).not.toBeNull();
    expect(JSON.parse(persisted as string)).toEqual(['恢复后的查询']);
  });
});
