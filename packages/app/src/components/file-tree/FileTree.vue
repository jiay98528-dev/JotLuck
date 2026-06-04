<template>
  <div class="file-tree">
    <!-- Breadcrumb navigation -->
    <Breadcrumb
      :current-dir="rootDir ?? '/'"
      @navigate="(path: string) => $emit('navigateDir', path)"
    />

    <!-- Toolbar: search + new file -->
    <div class="file-tree__toolbar">
      <FileTreeSearch :count="filteredFiles.length" @search="(q: string) => (searchQuery = q)" />
      <button
        class="file-tree__btn-new"
        title="新建笔记"
        aria-label="新建笔记"
        @click="$emit('createFile')"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M7 2V12M2 7H12"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="square"
          />
        </svg>
      </button>
    </div>

    <!-- Loading: skeleton lines -->
    <div v-if="loading" class="file-tree__state">
      <div
        v-for="i in 5"
        :key="i"
        class="file-tree__skeleton"
        :style="{ width: 70 - i * 8 + '%' }"
      />
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="file-tree__state file-tree__state--error">
      <div class="file-tree__state-icon">!</div>
      <span>{{ error }}</span>
      <button class="file-tree__retry-btn" @click="$emit('retry')">重试</button>
    </div>

    <!-- Empty: no files -->
    <div
      v-else-if="!filteredFiles.length && !searchQuery"
      class="file-tree__state file-tree__state--empty"
    >
      <div class="file-tree__state-icon">+</div>
      <span>空文件夹</span>
      <p>新建第一篇笔记</p>
    </div>

    <!-- Empty: search no results -->
    <div
      v-else-if="!filteredFiles.length && searchQuery"
      class="file-tree__state file-tree__state--empty"
    >
      <div class="file-tree__state-icon">~</div>
      <span>无匹配文件</span>
    </div>

    <!-- File list -->
    <template v-else>
      <div class="file-tree__divider" />
      <ul class="file-tree__list">
        <FileTreeNode
          v-for="file in filteredFiles"
          :key="file.path"
          :node="file"
          :depth="0"
          :active-path="activePath"
          @select="(path: string) => $emit('selectFile', path)"
          @delete="(path: string) => $emit('deleteFile', path)"
          @rename="(oldPath: string, newName: string) => $emit('renameFile', oldPath, newName)"
        />
      </ul>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * FileTree.vue — 文件树组件（纸张主题）
 *
 * Paper aesthetic:
 *   - Skeleton loading with shimmer animation
 *   - Geometric empty state icons (monospace characters)
 *   - Hairline divider above file list
 *   - Add button: spring press + hover accent
 *
 * Four standard states: Loading / Empty / Error / Normal
 */
import { ref, computed } from 'vue';
import FileTreeNode from './FileTreeNode.vue';
import Breadcrumb from './Breadcrumb.vue';
import FileTreeSearch from './FileTreeSearch.vue';
import type { DirEntry } from '@/types';

const props = defineProps<{
  files: DirEntry[];
  rootDir?: string;
  loading?: boolean;
  error?: string;
  activePath?: string;
}>();

defineEmits<{
  selectFile: [path: string];
  deleteFile: [path: string];
  renameFile: [oldPath: string, newName: string];
  navigateDir: [path: string];
  createFile: [];
  retry: [];
}>();

const searchQuery = ref('');

const filteredFiles = computed(() => {
  if (!searchQuery.value.trim()) return props.files;
  const q = searchQuery.value.toLowerCase();
  return props.files.filter((f) => f.name.toLowerCase().includes(q));
});
</script>

<style scoped>
.file-tree {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* --- Toolbar --- */
.file-tree__toolbar {
  display: flex;
  align-items: flex-start;
}

.file-tree__toolbar > :first-child {
  flex: 1;
}

/* --- Add button: geometric + spring press --- */
.file-tree__btn-new {
  width: 28px;
  height: 28px;
  margin: 6px 8px 0 0;
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
  color: var(--ink-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition:
    background var(--dur-micro) var(--ease-fade),
    color var(--dur-micro) var(--ease-fade),
    border-color var(--dur-micro) var(--ease-fade),
    transform var(--dur-press) var(--ease-press);
}

.file-tree__btn-new:hover {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent);
}

.file-tree__btn-new:active {
  transform: scale(0.92);
}

/* --- Divider: hairline above file list --- */
.file-tree__divider {
  height: 1px;
  margin: var(--space-4) var(--space-12);
  background: var(--rule);
}

/* --- State displays --- */
.file-tree__state {
  padding: var(--space-20) var(--space-16);
  text-align: center;
  color: var(--ink-muted);
  font-size: var(--text-sm);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-8);
}

.file-tree__state p {
  font-size: var(--text-xs);
  color: var(--ink-muted);
  margin: 0;
}

.file-tree__state--error {
  color: var(--signal-error);
}

/* --- State icon: geometric monospace character --- */
.file-tree__state-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  font-size: 16px;
  color: var(--ink-muted);
  font-family: var(--ff-mono);
}

/* --- Retry button --- */
.file-tree__retry-btn {
  margin-top: var(--space-4);
  padding: var(--space-4) var(--space-12);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
  color: var(--ink-primary);
  font-size: var(--text-xs);
  cursor: pointer;
  transition: background var(--dur-micro) var(--ease-fade);
}

.file-tree__retry-btn:hover {
  background: var(--surface-hover);
}

/* --- Skeleton loading with shimmer --- */
.file-tree__skeleton {
  height: 14px;
  border-radius: var(--radius);
  margin-bottom: var(--space-8);
  animation: skeleton-shimmer var(--dur-shimmer) ease-in-out infinite;
  background: linear-gradient(90deg, var(--rule) 0%, var(--paper-surface) 40%, var(--rule) 80%);
  background-size: 200% 100%;
}

@keyframes skeleton-shimmer {
  0% {
    background-position: 200% 0;
  }

  100% {
    background-position: -200% 0;
  }
}

/* --- File list --- */
.file-tree__list {
  flex: 1;
  overflow-y: auto;
  list-style: none;
  padding: var(--space-4) 0;
  margin: 0;
}
</style>
