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
});
