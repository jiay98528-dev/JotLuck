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
      <button v-if="node.isFile" class="node-delete" title="删除笔记" @click.stop="onDelete">
        ×
      </button>
    </div>
  </li>
</template>

<script setup lang="ts">
/**
 * FileTreeNode.vue — 单个文件树节点（含删除按钮）
 *
 * M1-15: 递归树节点。
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

const emit = defineEmits<{
  select: [path: string];
  delete: [path: string];
}>();

const isActive = props.activePath === props.node.path;

function onClick(): void {
  if (props.node.isFile) {
    emit('select', props.node.path);
  }
}

function onDelete(): void {
  emit('delete', props.node.path);
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
  position: relative;
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
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-delete {
  display: none;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border: none;
  background: none;
  color: #999;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  border-radius: 3px;
  padding: 0;
}

.node-item:hover .node-delete {
  display: block;
}

.node-delete:hover {
  background: oklch(0.6 0.15 20 / 0.2);
  color: oklch(0.5 0.15 25);
}
</style>
