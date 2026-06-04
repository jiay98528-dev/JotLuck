<template>
  <div class="backlinks-panel" :class="{ 'backlinks-panel--collapsed': collapsed }">
    <div class="backlinks-header" @click="$emit('toggle-collapse')">
      <span class="backlinks-title">
        反向链接
        <span v-if="backlinks.length" class="backlinks-count">{{ backlinks.length }}</span>
      </span>
      <span class="backlinks-toggle" :class="{ 'backlinks-toggle--collapsed': collapsed }">▾</span>
    </div>
    <div v-if="!collapsed" class="backlinks-body">
      <!-- Loading: skeleton lines -->
      <div v-if="loading" class="backlinks-loading">
        <div v-for="i in 3" :key="i" class="backlinks-skeleton" />
      </div>
      <!-- Empty: quiet message -->
      <div v-else-if="backlinks.length === 0" class="backlinks-empty">
        还没有其他笔记链接到这篇笔记
      </div>
      <!-- Normal: backlink items -->
      <template v-else>
        <BacklinkItem
          v-for="entry in backlinks"
          :key="entry.notePath"
          :entry="entry"
          @click="$emit('navigate', entry)"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * BacklinksPanel.vue — 反向链接面板（纸张主题）
 *
 * Unified panel language with NavTree / TagCloud:
 *   - Uppercase title + toggle chevron
 *   - Square count badge (geometric)
 *   - Skeleton loading with shimmer
 *   - Clean empty state, no emoji
 */
import BacklinkItem from './BacklinkItem.vue';
import type { BacklinkEntry } from '@/types';

defineProps<{
  backlinks: BacklinkEntry[];
  collapsed?: boolean;
  loading?: boolean;
}>();

defineEmits<{
  'toggle-collapse': [];
  navigate: [entry: BacklinkEntry];
}>();
</script>

<script lang="ts">
export default { name: 'BacklinksPanel' };
</script>

<style scoped>
.backlinks-panel {
  border-top: var(--border-thin) solid var(--rule);
}

/* --- Panel header --- */
.backlinks-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px var(--space-12);
  cursor: pointer;
  user-select: none;
  min-height: var(--panel-header-height);
  transition: background var(--dur-micro) var(--ease-fade);
}

.backlinks-header:hover {
  background: var(--surface-hover);
}

.backlinks-title {
  font-size: var(--text-xs);
  font-weight: var(--fw-semibold);
  text-transform: uppercase;
  letter-spacing: var(--ls-wide);
  color: var(--ink-muted);
  display: flex;
  align-items: center;
  gap: 6px;
}

/* --- Count badge: geometric square --- */
.backlinks-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  font-size: 9px;
  font-weight: var(--fw-semibold);
  background: var(--accent-soft);
  color: var(--accent);
  border-radius: var(--radius);
  padding: 0 4px;
}

/* --- Toggle --- */
.backlinks-toggle {
  font-size: 10px;
  color: var(--ink-muted);
  transition: transform var(--dur-micro) var(--ease-fade);
  display: inline-block;
}

.backlinks-toggle--collapsed {
  transform: rotate(-90deg);
}

/* --- Body --- */
.backlinks-body {
  max-height: 200px;
  overflow-y: auto;
  padding: 2px 0;
}

/* --- Empty state --- */
.backlinks-empty {
  padding: var(--space-12);
  font-size: var(--text-xs);
  color: var(--ink-muted);
  text-align: center;
}

/* --- Skeleton loading --- */
.backlinks-loading {
  padding: var(--space-8) var(--space-12);
}

.backlinks-skeleton {
  height: 14px;
  border-radius: var(--radius);
  margin-bottom: var(--space-8);
  width: 70%;
  animation: skeleton-shimmer var(--dur-shimmer) ease-in-out infinite;
  background: linear-gradient(90deg, var(--rule) 0%, var(--paper-raised) 40%, var(--rule) 80%);
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
