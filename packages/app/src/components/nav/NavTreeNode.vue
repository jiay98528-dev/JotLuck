<template>
  <li class="nav-tree-node">
    <div
      class="nav-node-item"
      :class="{ 'nav-node-item--active': active }"
      :style="{ paddingLeft: (depth - 1) * 16 + 8 + 'px' }"
      @click="onClick"
    >
      <span v-if="hasChildren" class="nav-node-toggle" @click.stop="toggleExpand">
        {{ expanded ? '▾' : '▸' }}
      </span>
      <span v-else class="nav-node-toggle nav-node-toggle--leaf" />
      <span class="nav-node-text" :title="heading.text">{{ heading.text }}</span>
    </div>
    <ul v-if="expanded && hasChildren" class="nav-node-children">
      <NavTreeNode
        v-for="child in heading.children"
        :key="child.id"
        :heading="child"
        :depth="depth + 1"
        :active="activeChildId === child.id"
        :active-child-id="activeChildId"
        @navigate="(id, line) => emit('navigate', id, line)"
      />
    </ul>
  </li>
</template>

<script setup lang="ts">
/**
 * NavTreeNode.vue — 导航树标题节点（纸张主题）
 *
 * Paper aesthetic:
 *   - Hierarchy through indentation + weight, not color zones
 *   - Active: 2px left border accent + weight boost + subtle background tint
 *   - Expand/collapse with character toggle (▸/▾)
 *   - Children auto-expand at depth ≤ 3
 */
import { ref, computed } from 'vue';
import type { HeadingItem } from '@/types';

const props = withDefaults(
  defineProps<{
    heading: HeadingItem;
    depth?: number;
    active?: boolean;
    activeChildId?: string | null;
  }>(),
  { depth: 1, active: false, activeChildId: null },
);

const emit = defineEmits<{
  navigate: [headingId: string, lineNumber: number];
}>();

const expanded = ref(props.depth <= 3);
const hasChildren = computed(() => props.heading.children.length > 0);

function toggleExpand(): void {
  expanded.value = !expanded.value;
}

function onClick(): void {
  emit('navigate', props.heading.id, props.heading.lineNumber);
}
</script>

<script lang="ts">
export default { name: 'NavTreeNode' };
</script>

<style scoped>
.nav-tree-node {
  list-style: none;
}

.nav-node-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  cursor: pointer;
  user-select: none;
  font-size: var(--text-xs);
  line-height: 1.7;
  color: var(--ink-secondary);
  position: relative;
  border-left: 2px solid transparent;
  transition:
    background var(--dur-micro) var(--ease-fade),
    color var(--dur-micro) var(--ease-fade),
    border-color var(--dur-micro) var(--ease-fade);
}

/* --- Hover --- */
.nav-node-item:hover {
  background: var(--surface-hover);
  color: var(--ink-primary);
}

/* --- Active: accent indicator + weight --- */
.nav-node-item--active {
  color: var(--accent);
  font-weight: var(--fw-semibold);
  background: var(--accent-soft);
  border-left-color: var(--accent);
}

/* --- Toggle --- */
.nav-node-toggle {
  flex-shrink: 0;
  width: 14px;
  font-size: 9px;
  color: var(--ink-muted);
  text-align: center;
  transition: transform var(--dur-micro) var(--ease-fade);
}

.nav-node-toggle--leaf {
  visibility: hidden;
}

/* --- Text --- */
.nav-node-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* --- Children list --- */
.nav-node-children {
  padding: 0;
}
</style>
