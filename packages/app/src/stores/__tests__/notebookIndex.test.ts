import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { MockFSService } from '@/services/MockFSService';
import { translate } from '@/i18n';
import { IndexService } from '@/services/IndexService';
import { useIndexStore } from '../notebookIndex';

describe('useIndexStore initialization races', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('keeps only the newest forced initialization result', async () => {
    const slow = new MockFSService(40);
    const fast = new MockFSService(0);
    await slow.writeFile('/slow-only.md', '# Slow');
    await fast.writeFile('/fast-only.md', '# Fast');

    const store = useIndexStore();
    const slowBuild = store.initialize(slow, true);
    const fastBuild = store.initialize(fast, true);
    await Promise.all([slowBuild, fastBuild]);

    expect(store.status).toBe('ready');
    expect(store.getIndexService()?.getAllNoteTitles()).toContain('Fast');
    expect(store.getIndexService()?.getAllNoteTitles()).not.toContain('Slow');
  });

  it('clears derived workspace state and invalidates an in-flight initialization', async () => {
    const ready = new MockFSService(0);
    const slow = new MockFSService(40);
    await ready.writeFile('/ready.md', '# Ready #tag');
    await slow.writeFile('/late.md', '# Late #other');

    const store = useIndexStore();
    await store.initialize(ready, true);
    expect(store.status).toBe('ready');
    expect(store.documentCount).toBeGreaterThan(0);

    const lateBuild = store.initialize(slow, true);
    store.reset();
    await lateBuild;

    expect(store.status).toBe('idle');
    expect(store.documentCount).toBe(0);
    expect(store.tags).toEqual([]);
    expect(store.recentNotes).toEqual([]);
    expect(store.getIndexService()).toBeNull();
  });
});

describe('useIndexStore 失败态呈现（IX：超限与异常两路）', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('超限异常：error 透出 program.indexTooLarge 译文，status 落 error', async () => {
    // 与 IndexService 抛出形态一致：marker 前缀 + 抛出点已翻译的超限文案
    const limitMessage = translate('program.indexTooLarge', { limit: 2000 });
    const buildSpy = vi
      .spyOn(IndexService.prototype, 'buildFullIndex')
      .mockRejectedValue(new Error(`JOTLUCK_INDEX_LIMIT_EXCEEDED: ${limitMessage}`));
    try {
      const store = useIndexStore();
      await store.initialize(new MockFSService(0), true);

      expect(store.status).toBe('error');
      // 超限标记后的译文原样透出，不被 errors.indexUnavailable 兜底抹平
      expect(store.error).toBe(limitMessage);
      // 失败后不残留半截索引服务
      expect(store.getIndexService()).toBeNull();
    } finally {
      buildSpy.mockRestore();
    }
  });

  it('非上限异常：error 落 errors.indexUnavailable 本地化兜底，status 落 error', async () => {
    const buildSpy = vi
      .spyOn(IndexService.prototype, 'buildFullIndex')
      .mockRejectedValue(new Error('boom'));
    try {
      const store = useIndexStore();
      await store.initialize(new MockFSService(0), true);

      expect(store.status).toBe('error');
      expect(store.error).toBe(translate('errors.indexUnavailable'));
      expect(store.getIndexService()).toBeNull();
    } finally {
      buildSpy.mockRestore();
    }
  });
});
