<template>
  <li class="file-tree-node">
    <div
      class="node-item"
      :class="{
        'node-item--folder': node.isDirectory,
        'node-item--file': node.isFile,
        'node-item--active': isActive,
      }"
      :style="{ paddingLeft: (depth ?? 0) * 16 + 8 + 'px' }"
      @click="onClick"
    >
      <span class="node-icon">{{ node.isDirectory ? (isOpen ? '📂' : '📁') : '📄' }}</span>
      <span class="node-name">{{ node.name }}</span>
    </div>
  </li>
</template>

<script setup lang="ts">
/**
 * FileTreeNode.vue — 单个文件树节点
 *
 * M1-15: 递归树节点，区分文件夹/文件图标。
 *
 * @see components.md §7
 */
import type { DirEntry } from '@/types';

const props = withDefaults(
  defineProps<{
    node: DirEntry;
    depth?: number;
    activePath?: string;
    isOpen?: boolean;
  }>(),
  { depth: 0, isOpen: false },
);

const isActive = props.activePath === props.node.path;

function onClick(): void {
  // M1 basic: just emit select for files
}
</script>

<script lang="ts">
export default { name: 'FileTreeNode' };
</script>

<style scoped>
.file-tree-node {
  list-style: none;
}

.node-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  cursor: pointer;
  user-select: none;
  font-size: 13px;
}

.node-item:hover {
  background: var(--clr-surface-hover, rgba(0, 0, 0, 0.04));
}

.node-item--active {
  background: var(--clr-accent-light, rgba(0, 100, 200, 0.1));
}

.node-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.node-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
