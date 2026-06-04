/**
 * useIndexStore — 索引状态管理
 *
 * M2: 管理笔记本索引数据、标签聚合、Wiki-link 图、最近笔记。
 *
 * @module useIndexStore
 * @see milestones.md M2-01~07, M2-12~16
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { IndexService } from '@/services/IndexService';
import { SearchEngine } from '@/services/SearchEngine';
import type { IFileSystemService, SearchIndex } from '@/types';

export const useIndexStore = defineStore('index', () => {
  const status = ref<'idle' | 'building' | 'ready' | 'error'>('idle');
  const error = ref<string | null>(null);
  const index = ref<SearchIndex | null>(null);
  const tags = ref<Array<{ name: string; count: number }>>([]);
  const recentNotes = ref<Array<{ path: string; title: string; lastOpenedAt: number }>>([]);

  let indexService: IndexService | null = null;
  let searchEngine: SearchEngine | null = null;

  const documentCount = computed(() => Object.keys(index.value?.documents ?? {}).length);
  const isReady = computed(() => status.value === 'ready');

  async function initialize(fs: IFileSystemService): Promise<void> {
    if (status.value === 'building') return;
    status.value = 'building';
    error.value = null;

    try {
      indexService = new IndexService(fs);
      searchEngine = new SearchEngine();

      const built = await indexService.buildFullIndex();
      index.value = built;
      tags.value = indexService.getAllTags();
      recentNotes.value = indexService.getRecentNotes(20);

      searchEngine.buildIndex(built.documents);
      await searchEngine.preloadContent(built.documents, (path) => fs.readFile(path));

      status.value = 'ready';
    } catch (e) {
      status.value = 'error';
      error.value = e instanceof Error ? e.message : '索引构建失败';
    }
  }

  async function refreshDocument(fs: IFileSystemService, path: string): Promise<void> {
    if (!indexService || !searchEngine) return;
    try {
      await indexService.updateDocument(path);
      const updated = indexService.getIndex();
      if (updated) {
        index.value = updated;
        tags.value = indexService.getAllTags();
        recentNotes.value = indexService.getRecentNotes(20);
        const content = await fs.readFile(path);
        const doc = updated.documents[path];
        if (doc) searchEngine.updateDocument(path, doc, content);
      }
    } catch {
      /* silent */
    }
  }

  function removeDocument(path: string): void {
    if (!indexService || !searchEngine) return;
    indexService.removeDocument(path);
    searchEngine.removeDocument(path);
    const current = indexService.getIndex();
    if (current) {
      index.value = current;
      tags.value = indexService.getAllTags();
      recentNotes.value = indexService.getRecentNotes(20);
    }
  }

  function getBacklinks(notePath: string) {
    return indexService?.getBacklinks(notePath) ?? [];
  }

  function getDeadLinks() {
    return indexService?.getWikiLinkGraph().deadLinks ?? [];
  }

  function getEngine(): SearchEngine | null {
    return searchEngine;
  }

  return {
    status,
    error,
    index,
    tags,
    recentNotes,
    documentCount,
    isReady,
    initialize,
    refreshDocument,
    removeDocument,
    getBacklinks,
    getDeadLinks,
    getEngine,
  };
});
