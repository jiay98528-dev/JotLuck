/**
 * useIndexStore — 索引与元数据状态管理
 *
 * 管理全文索引、标签聚合、最近笔记、反向链接图。
 *
 * @see migration-map.md §3
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { IFileSystemService } from '@/types';
import { IndexService } from '@/services/IndexService';
import type { SearchEngine } from '@/services/SearchEngine';

export type IndexStatus = 'idle' | 'building' | 'ready' | 'error';

export const useIndexStore = defineStore('index', () => {
  const status = ref<IndexStatus>('idle');
  const error = ref<string | null>(null);
  const documentCount = ref(0);

  let indexService: IndexService | null = null;
  let initializeGeneration = 0;

  const tags = ref<Array<{ name: string; count: number }>>([]);
  const recentNotes = ref<Array<{ path: string; title: string; lastOpenedAt: number }>>([]);
  const isReady = computed(() => status.value === 'ready');

  async function initialize(
    fs: IFileSystemService,
    force = false,
    options: { populateRecent?: boolean } = {},
  ): Promise<void> {
    if (!force && (status.value === 'building' || status.value === 'ready')) return;
    const generation = ++initializeGeneration;
    status.value = 'building';
    error.value = null;

    try {
      const candidate = new IndexService(fs, options);
      const idx = await candidate.buildFullIndex();
      if (generation !== initializeGeneration) return;
      indexService = candidate;
      documentCount.value = Object.keys(idx.documents).length;
      tags.value = candidate.getAllTags();
      recentNotes.value = candidate.getRecentNotes(20);
      status.value = 'ready';
    } catch (e) {
      if (generation !== initializeGeneration) return;
      // eslint-disable-next-line no-console
      console.error('[indexStore] initialize 索引构建失败:', e);
      error.value = e instanceof Error ? e.message : '索引构建失败';
      status.value = 'error';
    }
  }

  async function refreshDocument(_fs: IFileSystemService, path: string): Promise<void> {
    if (!indexService) return;
    try {
      await indexService.updateDocument(path);
      tags.value = indexService.getAllTags();
      recentNotes.value = indexService.getRecentNotes(20);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[indexStore] refreshDocument 失败', e);
    }
  }

  function removeDocument(path: string): void {
    if (!indexService) return;
    indexService.removeDocument(path);
    tags.value = indexService.getAllTags();
    recentNotes.value = indexService.getRecentNotes(20);
    documentCount.value = Object.keys(indexService.getAllDocuments()).length;
  }

  function synchronizeFromFileTree(filePaths: string[]): void {
    if (!indexService) return;
    indexService.synchronizeFromFileTree(filePaths);
    tags.value = indexService.getAllTags();
    recentNotes.value = indexService.getRecentNotes(20);
    documentCount.value = Object.keys(indexService.getAllDocuments()).length;
  }

  function getBacklinks(notePath: string) {
    return indexService?.getBacklinks(notePath) ?? [];
  }

  function getDeadLinks() {
    return indexService?.getWikiLinkGraph().deadLinks ?? [];
  }

  function getEngine(): SearchEngine | null {
    return indexService?.getEngine() ?? null;
  }

  /** 暴露 indexService 引用供外部使用 (如 MarkdownPredictor 结构化补全) */
  function getIndexService(): IndexService | null {
    return indexService;
  }

  return {
    status,
    error,
    documentCount,
    tags,
    recentNotes,
    isReady,
    initialize,
    refreshDocument,
    removeDocument,
    synchronizeFromFileTree,
    getIndexService,
    getBacklinks,
    getDeadLinks,
    getEngine,
  };
});
