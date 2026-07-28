import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { MockFSService } from '@/services/MockFSService';
import { useIndexStore } from '../index';

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
