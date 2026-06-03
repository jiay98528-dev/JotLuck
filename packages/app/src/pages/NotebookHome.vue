<template>
  <AppLayout>
    <template #left-sidebar>
      <div class="sidebar-content">
        <div class="sidebar-header">MarkLuck</div>
        <FileTree
          :files="files"
          :loading="loading"
          :error="errorMessage"
          :active-path="activePath"
          @select-file="onSelectFile"
          @delete-file="onDeleteFile"
          @retry="initNotebook"
        />
      </div>
    </template>

    <template #editor>
      <div v-if="!activePath" class="editor-empty">
        <h1>MarkLuck</h1>
        <p>选择左侧一条笔记开始编辑</p>
      </div>
      <MarkdownEditor
        v-else
        :key="activePath"
        :model-value="currentContent"
        @update:model-value="onContentUpdate"
      />
    </template>
  </AppLayout>
</template>

<script setup lang="ts">
/**
 * NotebookHome.vue — 笔记本主页
 *
 * M1: 集成 FileTree + MarkdownEditor + MockFSService。
 *
 * @see pages.md §2
 */
import { ref, onMounted } from 'vue';
import AppLayout from '@/components/layout/AppLayout.vue';
import FileTree from '@/components/file-tree/FileTree.vue';
import MarkdownEditor from '@/components/editor/MarkdownEditor.vue';
import { MockFSService } from '@/services/MockFSService';
import type { DirEntry, IFileSystemService } from '@/types';

const fs: IFileSystemService = new MockFSService(50);

const files = ref<DirEntry[]>([]);
const currentContent = ref('');
const activePath = ref('');
const loading = ref(false);
const errorMessage = ref('');

async function initNotebook(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    const entries = await fs.listDirectory('/');
    files.value = entries;
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : '加载笔记本失败';
  } finally {
    loading.value = false;
  }
}

async function onSelectFile(path: string): Promise<void> {
  activePath.value = path;
  loading.value = true;
  try {
    currentContent.value = await fs.readFile(path);
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : '读取文件失败';
  } finally {
    loading.value = false;
  }
}

async function onDeleteFile(path: string): Promise<void> {
  try {
    await fs.deleteFile(path);
    if (activePath.value === path) {
      activePath.value = '';
      currentContent.value = '';
    }
    // Refresh file list
    const entries = await fs.listDirectory('/');
    files.value = entries;
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : '删除失败';
  }
}

function onContentUpdate(content: string): void {
  currentContent.value = content;
  // Auto-save with debounce (M1-18)
  if (activePath.value) {
    fs.writeFile(activePath.value, content).catch(() => {
      // Silent fail in M1 — console-free per ESLint rules
    });
  }
}

onMounted(() => {
  initNotebook();
});
</script>

<style scoped>
.sidebar-content {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.sidebar-header {
  padding: 12px 16px;
  font-weight: 700;
  font-size: 14px;
  border-bottom: 1px solid var(--clr-border, #e0e0e0);
}

.editor-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--clr-text-secondary, #999);
}

.editor-empty h1 {
  font-size: 24px;
  margin-bottom: 8px;
  color: var(--clr-text-primary, #333);
}
</style>
