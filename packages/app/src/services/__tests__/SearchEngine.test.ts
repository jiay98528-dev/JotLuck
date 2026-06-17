/**
 * SearchEngine 单元测试
 *
 * 覆盖: 空索引构建、文档搜索、空查询边界
 */
import { describe, it, expect } from 'vitest';
import { SearchEngine } from '../SearchEngine';
import type { DocumentEntry } from '@/types';

function makeEntry(overrides: Partial<DocumentEntry> = {}): DocumentEntry {
  return {
    path: overrides.path ?? '/test.md',
    title: overrides.title ?? 'Test Note',
    tags: overrides.tags ?? [],
    ...overrides,
  };
}

describe('SearchEngine', () => {
  it('空索引构建后 docs.size === 0', () => {
    const engine = new SearchEngine();
    engine.buildIndex({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((engine as any).docs.size).toBe(0);
  });

  it('添加文档后 search 能找到结果', () => {
    const engine = new SearchEngine();
    engine.buildIndex({
      '/hello.md': makeEntry({ path: '/hello.md', title: 'Hello World' }),
    });
    const results = engine.search({ text: 'Hello' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.noteTitle).toBe('Hello World');
  });

  it('空查询返回空结果', () => {
    const engine = new SearchEngine();
    engine.buildIndex({
      '/note.md': makeEntry({ path: '/note.md', title: 'Existing Note' }),
    });
    // 搜索一个不匹配任何文档的文本，应返回空结果
    const results = engine.search({ text: 'NonexistentTerm' });
    expect(results).toHaveLength(0);
  });
});
