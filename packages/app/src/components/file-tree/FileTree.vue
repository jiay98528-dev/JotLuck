<template>
  <div class="file-tree">
    <div v-if="loading" class="file-tree__state">
      <span>加载中...</span>
    </div>
    <div v-else-if="error" class="file-tree__state file-tree__state--error">
      <span>{{ error }}</span>
      <button @click="$emit('retry')">重试</button>
    </div>
    <div v-else-if="!files.length" class="file-tree__state file-tree__state--empty">
      <span>空文件夹</span>
      <p>创建你的第一条笔记开始吧</p>
    </div>
    <ul v-else class="file-tree__list">
      <FileTreeNode
        v-for="file in files"
        :key="file.path"
        :node="file"
        :depth="0"
        :active-path="activePath"
      />
    </ul>
  </div>
</template>

<script setup lang="ts">
/**
 * FileTree.vue — 文件树组件（基础版）
 *
 * M1-14: 展示文件夹结构，支持点击打开文件。
 * 四种标准状态：Loading / Empty / Error / Normal。
 *
 * @see components.md §6
 */
import FileTreeNode from './FileTreeNode.vue';
import type { DirEntry } from '@/types';

defineProps<{
  files: DirEntry[];
  loading?: boolean;
  error?: string;
  activePath?: string;
}>();

defineEmits<{
  retry: [];
}>();
</script>

<style scoped>
.file-tree {
  height: 100%;
  overflow-y: auto;
}

.file-tree__state {
  padding: var(--space-16, 16px);
  text-align: center;
  color: var(--clr-text-secondary, #666);
}

.file-tree__state--error {
  color: oklch(0.5 0.15 25);
}

.file-tree__list {
  list-style: none;
  padding: 0;
  margin: 0;
}
</style>
