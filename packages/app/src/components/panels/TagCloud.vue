<template>
  <div class="tag-panel" :class="{ 'tag-panel--collapsed': collapsed }">
    <div class="tag-panel-header" @click="$emit('toggle-collapse')">
      <span class="tag-panel-title">
        标签
        <span v-if="tags.length" class="tag-panel-count">{{ tags.length }}</span>
      </span>
      <span class="tag-panel-toggle" :class="{ 'tag-panel-toggle--collapsed': collapsed }">▾</span>
    </div>
    <div v-if="!collapsed" class="tag-panel-body">
      <!-- Loading: tag skeletons -->
      <div v-if="loading" class="tag-panel-loading">
        <span v-for="i in 6" :key="i" class="tag-skeleton" :style="{ width: 30 + i * 10 + 'px' }" />
      </div>
      <!-- Empty: quiet guidance -->
      <div v-else-if="tags.length === 0" class="tag-panel-empty">
        使用 #tag 或 YAML frontmatter 添加标签
      </div>
      <!-- Tag cloud -->
      <div v-else class="tag-cloud">
        <span
          v-for="tag in displayTags"
          :key="tag.name"
          class="tag-item"
          :style="{ fontSize: getTagSize(tag.count) + 'px' }"
          @click="$emit('select-tag', tag.name)"
        >
          #{{ tag.name }}
          <sup class="tag-count">{{ tag.count }}</sup>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * TagCloud.vue — 标签云面板（纸张主题）
 *
 * Unified panel language with NavTree / BacklinksPanel.
 * Tags on paper: subtle accent color, border on hover.
 * Size hierarchy by frequency (cloud layout).
 * Hover: micro-lift with border reveal.
 */
import { computed } from 'vue';
import type { TagEntry } from '@/types';

const props = withDefaults(
  defineProps<{
    tags: TagEntry[];
    collapsed?: boolean;
    loading?: boolean;
    maxDisplay?: number;
  }>(),
  { collapsed: false, loading: false, maxDisplay: 50 },
);

defineEmits<{
  'select-tag': [tagName: string];
  'toggle-collapse': [];
}>();

const displayTags = computed(() => {
  return [...props.tags].sort((a, b) => b.count - a.count).slice(0, props.maxDisplay);
});

function getTagSize(count: number): number {
  const maxCount = displayTags.value[0]?.count ?? 1;
  const ratio = count / maxCount;
  if (ratio >= 0.8) return 16;
  if (ratio >= 0.6) return 14;
  if (ratio >= 0.4) return 13;
  if (ratio >= 0.2) return 12;
  return 11;
}
</script>

<script lang="ts">
export default { name: 'TagCloud' };
</script>

<style scoped>
.tag-panel {
  border-top: var(--border-thin) solid var(--rule);
}

/* --- Panel header --- */
.tag-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px var(--space-12);
  cursor: pointer;
  user-select: none;
  min-height: var(--panel-header-height);
  transition: background var(--dur-micro) var(--ease-fade);
}

.tag-panel-header:hover {
  background: var(--surface-hover);
}

.tag-panel-title {
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
.tag-panel-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  font-size: 9px;
  font-weight: var(--fw-semibold);
  background: var(--signal-success-soft);
  color: var(--signal-success);
  border-radius: var(--radius);
  padding: 0 4px;
}

/* --- Toggle --- */
.tag-panel-toggle {
  font-size: 10px;
  color: var(--ink-muted);
  transition: transform var(--dur-micro) var(--ease-fade);
  display: inline-block;
}

.tag-panel-toggle--collapsed {
  transform: rotate(-90deg);
}

/* --- Body --- */
.tag-panel-body {
  padding: 6px var(--space-12) var(--space-12);
}

/* --- Tag cloud --- */
.tag-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  align-items: baseline;
}

/* --- Tag item --- */
.tag-item {
  cursor: pointer;
  color: var(--accent);
  padding: 1px 6px;
  border-radius: var(--radius);
  line-height: 1.6;
  white-space: nowrap;
  border: var(--border-thin) solid transparent;
  transform: translateY(0);
  transition:
    background var(--dur-micro) var(--ease-fade),
    border-color var(--dur-micro) var(--ease-fade),
    transform var(--dur-micro) var(--ease-fade);
}

.tag-item:hover {
  background: var(--accent-soft);
  border-color: var(--accent);
  transform: translateY(-1px);
}

/* --- Tag count superscript --- */
.tag-count {
  font-size: 0.7em;
  color: var(--ink-muted);
  margin-left: 1px;
}

/* --- Empty state --- */
.tag-panel-empty {
  padding: var(--space-12) 0;
  font-size: var(--text-xs);
  color: var(--ink-muted);
  text-align: center;
  line-height: 1.6;
}

/* --- Loading skeletons --- */
.tag-panel-loading {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag-skeleton {
  height: 20px;
  border-radius: var(--radius);
  width: 48px;
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
