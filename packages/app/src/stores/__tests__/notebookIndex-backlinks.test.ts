import { it, expect } from 'vitest';
import { computed } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { useIndexStore } from '../index';
import { MockFSService } from '@/services/MockFSService';

it('invalidates an already observed backlink list when files change without changing the active note', async () => {
  setActivePinia(createPinia());
  const fs = new MockFSService(0, { persist: false });
  await fs.writeFile('/target.md', '# UniqueTarget');
  await fs.writeFile('/source.md', '[[UniqueTarget]]');
  const store = useIndexStore();
  await store.initialize(fs);
  const incoming = computed(() => store.getBacklinks('/target.md'));
  expect(incoming.value).toHaveLength(1);
  await fs.writeFile('/source.md', '[[UniqueTarget]] [[UniqueTarget]]');
  await store.refreshDocument(fs, '/source.md');
  expect(incoming.value).toHaveLength(2);
  store.removeDocument('/source.md');
  expect(incoming.value).toEqual([]);
  store.reset();
  expect(incoming.value).toEqual([]);
});
