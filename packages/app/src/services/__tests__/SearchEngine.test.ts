/**
 * SearchEngine 单元测试
 *
 * 覆盖: 文本搜索、正则搜索、标签过滤、日期范围、文件夹过滤、
 *       多条件组合、空边界、CRUD、destroy、结果形状验证
 */
import { describe, it, expect } from 'vitest';
import { SearchEngine } from '../SearchEngine';
import type { DocumentEntry } from '@/types';

// ---- helpers ----

function makeEntry(overrides: Partial<DocumentEntry> = {}): DocumentEntry {
  return {
    path: overrides.path ?? '/test.md',
    title: overrides.title ?? 'Test Note',
    tags: overrides.tags ?? [],
    created: overrides.created,
    folder: overrides.folder,
  };
}

function makeDocs(
  entries: Array<Partial<DocumentEntry> & { path: string }>,
): Record<string, DocumentEntry> {
  const docs: Record<string, DocumentEntry> = {};
  for (const e of entries) {
    docs[e.path] = makeEntry(e);
  }
  return docs;
}

/** Populate engine with docs AND preload content (mocked) */
async function buildEngine(
  engine: SearchEngine,
  docs: Record<string, DocumentEntry>,
  contents: Record<string, string> = {},
): Promise<void> {
  engine.buildIndex(docs);
  await engine.preloadContent(docs, async (path) => contents[path] ?? '');
}

// ---- tests ----

describe('SearchEngine', () => {
  // -- basic (existing) --

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
    const results = engine.search({ text: 'NonexistentTerm' });
    expect(results).toHaveLength(0);
  });

  // -- regex search --

  it('正则搜索匹配文本内容', () => {
    const engine = new SearchEngine();
    const docs = makeDocs([{ path: '/a.md', title: 'Alpha' }]);
    engine.buildIndex(docs);
    engine.updateDocument('/a.md', docs['/a.md']!, 'const foo = 42;\nconst bar = 99;');
    const results = engine.search({ text: '', regex: 'const\\s+\\w+' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.notePath).toBe('/a.md');
  });

  it('正则搜索不匹配时返回空', () => {
    const engine = new SearchEngine();
    const docs = makeDocs([{ path: '/a.md', title: 'No numbers' }]);
    engine.buildIndex(docs);
    engine.updateDocument('/a.md', docs['/a.md']!, 'hello world');
    const results = engine.search({ text: '', regex: '\\d{5}' });
    expect(results).toHaveLength(0);
  });

  it('无效正则表达式不会抛出异常', () => {
    const engine = new SearchEngine();
    const docs = makeDocs([{ path: '/a.md', title: 'Test' }]);
    engine.buildIndex(docs);
    engine.updateDocument('/a.md', docs['/a.md']!, 'some content');
    // Should not throw
    expect(() => engine.search({ text: '', regex: '[unclosed' })).not.toThrow();
  });

  // -- tag filter --

  it('标签过滤仅返回包含指定标签的文档', () => {
    const engine = new SearchEngine();
    const docs = makeDocs([
      { path: '/a.md', title: 'React Guide', tags: ['react', 'frontend'] },
      { path: '/b.md', title: 'Rust Notes', tags: ['rust', 'backend'] },
      { path: '/c.md', title: 'Mixed', tags: ['react', 'rust'] },
    ]);
    engine.buildIndex(docs);
    const results = engine.search({ text: '', tags: ['react'] });
    expect(results).toHaveLength(2);
    const titles = results.map((r) => r.noteTitle).sort();
    expect(titles).toEqual(['Mixed', 'React Guide']);
  });

  it('多标签 OR 过滤', () => {
    const engine = new SearchEngine();
    const docs = makeDocs([
      { path: '/a.md', title: 'React', tags: ['react'] },
      { path: '/b.md', title: 'Rust', tags: ['rust'] },
      { path: '/c.md', title: 'Python', tags: ['python'] },
    ]);
    engine.buildIndex(docs);
    const results = engine.search({ text: '', tags: ['react', 'rust'] });
    expect(results).toHaveLength(2);
  });

  it('无匹配标签返回空结果', () => {
    const engine = new SearchEngine();
    const docs = makeDocs([{ path: '/a.md', title: 'Note', tags: ['js'] }]);
    engine.buildIndex(docs);
    const results = engine.search({ text: '', tags: ['nonexistent'] });
    expect(results).toHaveLength(0);
  });

  // -- date range filter --

  it('日期范围过滤 (from)', () => {
    const engine = new SearchEngine();
    const docs = makeDocs([
      { path: '/old.md', title: 'Old', created: new Date('2024-01-01').getTime() },
      { path: '/new.md', title: 'New', created: new Date('2025-06-01').getTime() },
    ]);
    engine.buildIndex(docs);
    const results = engine.search({ text: '', dateRange: { from: new Date('2025-01-01') } });
    expect(results).toHaveLength(1);
    expect(results[0]!.noteTitle).toBe('New');
  });

  it('日期范围过滤 (to)', () => {
    const engine = new SearchEngine();
    const docs = makeDocs([
      { path: '/old.md', title: 'Old', created: new Date('2024-01-01').getTime() },
      { path: '/new.md', title: 'New', created: new Date('2025-06-01').getTime() },
    ]);
    engine.buildIndex(docs);
    const results = engine.search({ text: '', dateRange: { to: new Date('2024-06-01') } });
    expect(results).toHaveLength(1);
    expect(results[0]!.noteTitle).toBe('Old');
  });

  it('日期范围过滤 (from + to)', () => {
    const engine = new SearchEngine();
    const docs = makeDocs([
      { path: '/a.md', title: 'Jan', created: new Date('2025-01-15').getTime() },
      { path: '/b.md', title: 'Mar', created: new Date('2025-03-15').getTime() },
      { path: '/c.md', title: 'Jun', created: new Date('2025-06-15').getTime() },
    ]);
    engine.buildIndex(docs);
    const results = engine.search({
      text: '',
      dateRange: { from: new Date('2025-02-01'), to: new Date('2025-05-01') },
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.noteTitle).toBe('Mar');
  });

  // -- folder filter --

  it('文件夹过滤仅返回指定文件夹下的文档', () => {
    const engine = new SearchEngine();
    const docs = makeDocs([
      { path: '/tech/js.md', title: 'JS', folder: '/tech' },
      { path: '/tech/ts.md', title: 'TS', folder: '/tech' },
      { path: '/life/cooking.md', title: 'Cooking', folder: '/life' },
    ]);
    engine.buildIndex(docs);
    const results = engine.search({ text: '', folder: '/tech' });
    expect(results).toHaveLength(2);
    const titles = results.map((r) => r.noteTitle).sort();
    expect(titles).toEqual(['JS', 'TS']);
  });

  it('文件夹过滤不匹配时返回空', () => {
    const engine = new SearchEngine();
    const docs = makeDocs([{ path: '/a.md', title: 'A', folder: '/notes' }]);
    engine.buildIndex(docs);
    const results = engine.search({ text: '', folder: '/nonexistent' });
    expect(results).toHaveLength(0);
  });

  // -- combined filters --

  it('标签 + 文件夹组合过滤', () => {
    const engine = new SearchEngine();
    const docs = makeDocs([
      { path: '/tech/react.md', title: 'React', tags: ['react'], folder: '/tech' },
      { path: '/tech/rust.md', title: 'Rust', tags: ['rust'], folder: '/tech' },
      { path: '/life/react-life.md', title: 'React Life', tags: ['react'], folder: '/life' },
    ]);
    engine.buildIndex(docs);
    const results = engine.search({ text: '', tags: ['react'], folder: '/tech' });
    expect(results).toHaveLength(1);
    expect(results[0]!.noteTitle).toBe('React');
  });

  it('标签 + 日期 + 文件夹三条件组合', () => {
    const engine = new SearchEngine();
    const docs = makeDocs([
      {
        path: '/a.md',
        title: 'A',
        tags: ['js'],
        folder: '/tech',
        created: new Date('2025-06-01').getTime(),
      },
      {
        path: '/b.md',
        title: 'B',
        tags: ['js'],
        folder: '/tech',
        created: new Date('2024-01-01').getTime(),
      },
      {
        path: '/c.md',
        title: 'C',
        tags: ['js'],
        folder: '/life',
        created: new Date('2025-06-01').getTime(),
      },
    ]);
    engine.buildIndex(docs);
    const results = engine.search({
      text: '',
      tags: ['js'],
      folder: '/tech',
      dateRange: { from: new Date('2025-01-01') },
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.noteTitle).toBe('A');
  });

  it('正则 + 标签组合过滤', () => {
    const engine = new SearchEngine();
    const docs = makeDocs([
      { path: '/a.md', title: 'React Hooks', tags: ['react'] },
      { path: '/b.md', title: 'Vue Composition', tags: ['vue'] },
    ]);
    engine.buildIndex(docs);
    engine.updateDocument('/a.md', docs['/a.md']!, 'useState and useEffect');
    engine.updateDocument('/b.md', docs['/b.md']!, 'ref and reactive');
    const results = engine.search({ text: '', regex: 'use\\w+', tags: ['react'] });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.noteTitle).toBe('React Hooks');
  });

  // -- CRUD operations --

  it('updateDocument 后搜索结果反映新内容', () => {
    const engine = new SearchEngine();
    const docs = makeDocs([{ path: '/a.md', title: 'Alpha' }]);
    engine.buildIndex(docs);
    engine.updateDocument('/a.md', docs['/a.md']!, 'before update');
    let results = engine.search({ text: 'before' });
    expect(results.length).toBe(1);
    // Update content
    engine.updateDocument('/a.md', docs['/a.md']!, 'after modification');
    results = engine.search({ text: 'after' });
    expect(results.length).toBe(1);
    results = engine.search({ text: 'before' });
    expect(results).toHaveLength(0);
  });

  it('removeDocument 后搜索结果不包含已删除文档', () => {
    const engine = new SearchEngine();
    const docs = makeDocs([
      { path: '/a.md', title: 'A' },
      { path: '/b.md', title: 'B' },
    ]);
    engine.buildIndex(docs);
    engine.removeDocument('/a.md');
    const results = engine.search({ text: '' });
    expect(results).toHaveLength(1);
    expect(results[0]!.notePath).toBe('/b.md');
  });

  // -- destroy --

  it('destroy 后 search 返回空数组', () => {
    const engine = new SearchEngine();
    const docs = makeDocs([{ path: '/a.md', title: 'A' }]);
    engine.buildIndex(docs);
    engine.destroy();
    const results = engine.search({ text: 'A' });
    expect(results).toHaveLength(0);
  });

  // -- result shape --

  it('toResult 返回正确的 SearchResult 形状', () => {
    const engine = new SearchEngine();
    const docs = makeDocs([{ path: '/readme.md', title: 'README' }]);
    engine.buildIndex(docs);
    engine.updateDocument('/readme.md', docs['/readme.md']!, '# README\n\nWelcome to MarkLuck!');
    const results = engine.search({ text: 'MarkLuck' });
    expect(results).toHaveLength(1);
    const r = results[0]!;
    expect(r).toHaveProperty('notePath');
    expect(r).toHaveProperty('noteTitle');
    expect(r).toHaveProperty('matches');
    expect(r).toHaveProperty('score');
    expect(r.notePath).toBe('/readme.md');
    expect(r.noteTitle).toBe('README');
    expect(r.score).toBeGreaterThan(0);
    expect(Array.isArray(r.matches)).toBe(true);
  });

  it('搜索结果包含上下文片段', () => {
    const engine = new SearchEngine();
    const docs = makeDocs([{ path: '/test.md', title: 'Test' }]);
    engine.buildIndex(docs);
    engine.updateDocument(
      '/test.md',
      docs['/test.md']!,
      'The quick brown fox jumps over the lazy dog',
    );
    const results = engine.search({ text: 'brown' });
    expect(results).toHaveLength(1);
    expect(results[0]!.matches.length).toBeGreaterThan(0);
    expect(results[0]!.matches[0]!.text).toBe('brown');
    expect(results[0]!.matches[0]!.context).toContain('brown');
  });

  // -- edge: tags only (no text query) returns all matching docs --

  it('仅标签过滤无文本查询时返回所有匹配文档', () => {
    const engine = new SearchEngine();
    const docs = makeDocs([
      { path: '/a.md', title: 'A', tags: ['shared'] },
      { path: '/b.md', title: 'B', tags: ['shared'] },
      { path: '/c.md', title: 'C', tags: ['other'] },
    ]);
    engine.buildIndex(docs);
    const results = engine.search({ text: '', tags: ['shared'] });
    expect(results).toHaveLength(2);
  });

  // -- edge: empty docs index --

  it('空索引上任何查询返回空', () => {
    const engine = new SearchEngine();
    engine.buildIndex({});
    expect(engine.search({ text: 'anything' })).toHaveLength(0);
    expect(engine.search({ text: '', tags: ['a'] })).toHaveLength(0);
    expect(engine.search({ text: '', regex: '.' })).toHaveLength(0);
  });

  // -- preloadContent --

  it('preloadContent 加载内容后可搜索', async () => {
    const engine = new SearchEngine();
    await buildEngine(
      engine,
      { '/x.md': makeEntry({ path: '/x.md', title: 'X File' }) },
      { '/x.md': 'Content with keyword alpha' },
    );
    const results = engine.search({ text: 'alpha' });
    expect(results).toHaveLength(1);
    expect(results[0]!.noteTitle).toBe('X File');
  });
});
