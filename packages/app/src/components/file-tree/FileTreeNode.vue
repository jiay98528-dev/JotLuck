<template>
  <li class="file-tree-node">
    <div
      class="node-item"
      :class="{
        'node-item--folder': node.isDirectory,
        'node-item--file': node.isFile,
        'node-item--active': isActive,
        'node-item--open': isOpen,
      }"
      :style="{ paddingLeft: (depth ?? 0) * 20 + 8 + 'px' }"
      :draggable="node.isFile"
      @click="onClick"
      @dragstart="onDragStart"
    >
      <!-- Selection indicator: 2px left stripe (paper metaphor: bookmark ribbon) -->
      <span class="node-selection-bar" aria-hidden="true" />

      <!-- Icon: geometric SVG system -->
      <FileIcon :node="node" :is-open="isOpen" />

      <!-- Inline rename or display -->
      <input
        v-if="isRenaming"
        ref="renameInput"
        v-model="renameValue"
        class="node-rename-input"
        @keydown.enter="commitRename"
        @keydown.escape="cancelRename"
        @blur="commitRename"
      />
      <span v-else class="node-name" @dblclick="startRename">{{ node.name }}</span>

      <!-- Delete button: visible on hover (files only) -->
      <button
        v-if="node.isFile && !isRenaming"
        class="node-delete"
        title="删除笔记"
        aria-label="删除笔记"
        @click.stop="onDelete"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path
            d="M3 3.5L9 8.5M9 3.5L3 8.5"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="square"
          />
        </svg>
      </button>
    </div>
  </li>
</template>

<script setup lang="ts">
/**
 * FileTreeNode.vue — 单个文件树节点（纸张主题）
 *
 * Paper aesthetic:
 *   - Selection: 2px left indicator stripe (like a bookmark ribbon)
 *   - Hover: subtle surface tint (3%)
 *   - Active: weight boost (400→500) + indicator color
 *   - No background color blocks — content hierarchy through type, not paint
 *
 * Luxury motion:
 *   - Expand/collapse stagger via parent FileTree
 *   - Delete button: opacity fade in/out 120ms
 *   - Rename input: border color transition 150ms
 */
import { ref, computed, nextTick } from 'vue';
import FileIcon from './FileIcon.vue';
import type { DirEntry } from '@/types';

const props = withDefaults(
  defineProps<{
    node: DirEntry;
    depth?: number;
    activePath?: string;
    isOpen?: boolean;
  }>(),
  { depth: 0, activePath: '', isOpen: false },
);

const emit = defineEmits<{
  select: [path: string];
  delete: [path: string];
  rename: [oldPath: string, newName: string];
}>();

const isActive = computed(() => props.activePath === props.node.path);

// --- Inline rename ---
const isRenaming = ref(false);
const renameValue = ref('');
const renameInput = ref<HTMLInputElement | null>(null);

function startRename(): void {
  if (!props.node.isFile) return;
  renameValue.value = props.node.name;
  isRenaming.value = true;
  nextTick(() => renameInput.value?.focus());
}

function commitRename(): void {
  if (!isRenaming.value) return;
  isRenaming.value = false;
  const newName = renameValue.value.trim();
  if (newName && newName !== props.node.name) {
    const dir = props.node.path.substring(0, props.node.path.lastIndexOf('/') + 1);
    emit('rename', props.node.path, dir + newName);
  }
}

function cancelRename(): void {
  isRenaming.value = false;
}

// --- Interaction ---
function onClick(): void {
  if (isRenaming.value) return;
  emit('select', props.node.path);
}

function onDragStart(event: DragEvent): void {
  if (!event.dataTransfer || !props.node.isFile) return;
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData('text/plain', props.node.path);
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
  padding: 4px 8px 4px 0;
  cursor: pointer;
  user-select: none;
  font-size: var(--text-sm);
  color: var(--ink-secondary);
  position: relative;
  transition:
    background var(--dur-micro) var(--ease-fade),
    color var(--dur-micro) var(--ease-fade),
    font-weight var(--dur-micro) var(--ease-fade);
}

/* --- Selection indicator: 2px left stripe (bookmark ribbon) --- */
.node-selection-bar {
  position: absolute;
  left: 0;
  top: 3px;
  bottom: 3px;
  width: var(--selection-indicator-width);
  background: transparent;
  transition: background var(--dur-micro) var(--ease-fade);
}

/* --- Hover: subtle surface tint --- */
.node-item:hover {
  background: var(--surface-hover);
  color: var(--ink-primary);
}

/* --- Active/selected: weight boost + indicator --- */
.node-item--active {
  color: var(--ink-primary);
  font-weight: var(--fw-medium);
}

.node-item--active .node-selection-bar {
  background: var(--selection-indicator);
}

/* --- Folder: slightly heavier --- */
.node-item--folder {
  font-weight: var(--fw-medium);
}

.node-item--open {
  color: var(--ink-primary);
}

/* --- Node name --- */
.node-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: var(--lh-ui);
}

/* --- Inline rename input --- */
.node-rename-input {
  flex: 1;
  padding: 1px 4px;
  border: var(--border-thin) solid var(--accent);
  border-radius: var(--radius);
  font-size: var(--text-sm);
  background: var(--paper-surface);
  color: var(--ink-primary);
  outline: none;
  min-width: 0;
  line-height: var(--lh-ui);
  transition: border-color var(--dur-micro) var(--ease-fade);
}

/* --- Delete button: hidden until hover --- */
.node-delete {
  display: flex;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border: none;
  background: none;
  color: transparent;
  cursor: pointer;
  border-radius: var(--radius);
  padding: 2px;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition:
    opacity var(--dur-micro) var(--ease-fade),
    background var(--dur-micro) var(--ease-fade),
    color var(--dur-micro) var(--ease-fade);
}

.node-delete:hover {
  background: var(--signal-error-soft);
  color: var(--signal-error);
}

.node-item:hover .node-delete {
  opacity: 1;
  color: var(--ink-muted);
}
</style>
