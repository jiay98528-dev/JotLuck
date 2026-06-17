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

  const tags = ref<Array<{ name: string; count: number }>>([]);
  const recentNotes = ref<Array<{ path: string; title: string; lastOpenedAt: number }>>([]);
  const isReady = computed(() => status.value === 'ready');

  async function initialize(fs: IFileSystemService): Promise<void> {
    if (status.value === 'building' || status.value === 'ready') return;
    status.value = 'building';
    error.value = null;

    try {
      indexService = new IndexService(fs);
      const idx = await indexService.buildFullIndex();
      documentCount.value = Object.keys(idx.documents).length;
      tags.value = indexService.getAllTags();
      recentNotes.value = indexService.getRecentNotes(20);
      status.value = 'ready';
    } catch (e) {
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
    getIndexService,
    getBacklinks,
    getDeadLinks,
    getEngine,
  };
});
