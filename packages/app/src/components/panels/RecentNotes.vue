<template>
  <div class="recent-notes">
    <div class="recent-notes-header">
      <span class="recent-notes-title">最近编辑</span>
    </div>
    <!-- Loading -->
    <div v-if="loading" class="recent-notes-loading">
      <div v-for="i in 3" :key="i" class="recent-skeleton" />
    </div>
    <!-- Empty -->
    <div v-else-if="notes.length === 0" class="recent-notes-empty">还没有编辑过笔记</div>
    <!-- Normal -->
    <div v-else class="recent-notes-list">
      <div
        v-for="note in notes.slice(0, maxDisplay)"
        :key="note.path"
        class="recent-note-item"
        @click="$emit('select-note', note.path)"
      >
        <span class="recent-note-title">{{ note.title || note.path }}</span>
        <span class="recent-note-time">{{ formatTime(note.lastOpenedAt) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * RecentNotes.vue — 最近编辑列表（纸张主题）
 */
withDefaults(
  defineProps<{
    notes: Array<{ path: string; title: string; lastOpenedAt: number }>;
    maxDisplay?: number;
    loading?: boolean;
  }>(),
  { maxDisplay: 10, loading: false },
);

defineEmits<{
  'select-note': [path: string];
}>();

function formatTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 7) return `${days} 天前`;
  return new Date(ts).toISOString().slice(0, 10);
}
</script>

<script lang="ts">
export default { name: 'RecentNotes' };
</script>

<style scoped>
.recent-notes {
  border-top: var(--border-thin) solid var(--rule);
}

.recent-notes-header {
  padding: 10px var(--space-12) 6px;
}

.recent-notes-title {
  font-size: var(--text-xs);
  font-weight: var(--fw-semibold);
  text-transform: uppercase;
  letter-spacing: var(--ls-wide);
  color: var(--ink-muted);
}

.recent-notes-list {
  padding: 0 var(--space-4) var(--space-8);
}

.recent-note-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px var(--space-8);
  cursor: pointer;
  border-radius: var(--radius);
  font-size: var(--text-sm);
  transition: background var(--dur-micro) var(--ease-fade);
}

.recent-note-item:hover {
  background: var(--surface-hover);
}

.recent-note-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  color: var(--ink-primary);
}

.recent-note-time {
  font-size: var(--text-xs);
  color: var(--ink-muted);
  flex-shrink: 0;
  margin-left: var(--space-8);
}

.recent-notes-empty {
  padding: var(--space-8) var(--space-12);
  font-size: var(--text-xs);
  color: var(--ink-muted);
  text-align: center;
}

.recent-notes-loading {
  padding: var(--space-8);
}

.recent-skeleton {
  height: 14px;
  border-radius: var(--radius);
  margin-bottom: var(--space-8);
  width: 60%;
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
</style>
