<template>
  <div class="backlink-item" @click="$emit('click', entry)">
    <div class="backlink-item-title">{{ entry.noteTitle }}</div>
    <div v-if="entry.context" class="backlink-item-context">{{ entry.context }}</div>
  </div>
</template>

<script setup lang="ts">
/**
 * BacklinkItem.vue — 单条反向链接条目（纸张主题）
 */
import type { BacklinkEntry } from '@/types';

defineProps<{
  entry: BacklinkEntry;
}>();

defineEmits<{
  click: [entry: BacklinkEntry];
}>();
</script>

<script lang="ts">
export default { name: 'BacklinkItem' };
</script>

<style scoped>
.backlink-item {
  padding: 6px var(--space-12);
  cursor: pointer;
  border-radius: var(--radius);
  margin: 2px var(--space-4);
  transition: background var(--dur-micro) var(--ease-fade);
}

.backlink-item:hover {
  background: var(--surface-hover);
}

.backlink-item-title {
  font-size: var(--text-sm);
  font-weight: var(--fw-medium);
  color: var(--ink-primary);
}

.backlink-item-context {
  margin-top: 2px;
  font-size: var(--text-xs);
  color: var(--ink-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
