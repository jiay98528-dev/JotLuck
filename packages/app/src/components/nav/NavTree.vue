<template>
  <div class="nav-tree" :class="{ 'nav-tree--collapsed': collapsed }">
    <div class="nav-tree-header" @click="$emit('toggle-collapse')">
      <span class="nav-tree-title">大纲</span>
      <span class="nav-tree-toggle" :class="{ 'nav-tree-toggle--collapsed': collapsed }">▾</span>
    </div>
    <div v-if="!collapsed" class="nav-tree-body">
      <!-- Loading: skeleton lines -->
      <div v-if="loading" class="nav-tree-loading">
        <div
          v-for="i in 4"
          :key="i"
          class="nav-skeleton-line"
          :style="{ width: 75 - i * 12 + '%' }"
        />
      </div>
      <!-- Empty: quiet guidance -->
      <div v-else-if="headings.length === 0" class="nav-tree-empty">使用 # 创建标题</div>
      <!-- Normal: heading tree -->
      <ul v-else class="nav-tree-list">
        <NavTreeNode
          v-for="heading in headings"
          :key="heading.id"
          :heading="heading"
          :depth="1"
          :active="activeHeadingId === heading.id"
          :active-child-id="activeHeadingId"
          @navigate="(id, line) => emit('navigate-to', id, line)"
        />
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * NavTree.vue — 文档大纲导航树（纸张主题）
 *
 * Panel header style: unified with BacklinksPanel / TagCloud.
 * Skeleton loading with animated shimmer lines.
 * Clean toggle with CSS rotation animation.
 */
import NavTreeNode from './NavTreeNode.vue';
import type { HeadingItem } from '@/types';

defineProps<{
  headings: HeadingItem[];
  activeHeadingId?: string | null;
  collapsed?: boolean;
  loading?: boolean;
}>();

const emit = defineEmits<{
  'toggle-collapse': [];
  'navigate-to': [headingId: string, lineNumber: number];
}>();
</script>

<script lang="ts">
export default { name: 'NavTree' };
</script>

<style scoped>
.nav-tree {
  display: flex;
  flex-direction: column;
  flex: 0 1 auto;
  max-height: 35vh;
}

.nav-tree--collapsed {
  flex: 0 0 auto;
  max-height: none;
}

/* --- Panel header --- */
.nav-tree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px var(--space-12);
  cursor: pointer;
  user-select: none;
  min-height: var(--panel-header-height);
  transition: background var(--dur-micro) var(--ease-fade);
}

.nav-tree-header:hover {
  background: var(--surface-hover);
}

.nav-tree-title {
  font-size: var(--text-xs);
  font-weight: var(--fw-semibold);
  text-transform: uppercase;
  letter-spacing: var(--ls-wide);
  color: var(--ink-muted);
}

.nav-tree-toggle {
  font-size: 10px;
  color: var(--ink-muted);
  transition: transform var(--dur-micro) var(--ease-fade);
  display: inline-block;
}

.nav-tree-toggle--collapsed {
  transform: rotate(-90deg);
}

/* --- Body --- */
.nav-tree-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 2px 0;
}

.nav-tree-list {
  padding: 0;
  margin: 0;
}

/* --- Empty state --- */
.nav-tree-empty {
  padding: var(--space-16) var(--space-12);
  font-size: var(--text-xs);
  color: var(--ink-muted);
  text-align: center;
}

/* --- Skeleton loading --- */
.nav-tree-loading {
  padding: var(--space-12);
}

.nav-skeleton-line {
  height: 12px;
  border-radius: var(--radius);
  margin-bottom: var(--space-8);
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
