<template>
  <nav class="breadcrumb" aria-label="文件路径导航">
    <button
      v-for="(seg, i) in segments"
      :key="seg.path"
      class="breadcrumb__item"
      :class="{ 'breadcrumb__item--current': i === segments.length - 1 }"
      :disabled="i === segments.length - 1"
      @click="navigateTo(seg.path)"
    >
      {{ seg.label }}
    </button>
  </nav>
</template>

<script setup lang="ts">
/**
 * Breadcrumb.vue — 文件路径面包屑导航
 *
 * P2-2: 显示当前目录路径，支持逐级点击导航。
 *
 * @see milestones.md M1-14 (FileTree 增强)
 */
import { computed } from 'vue';

const props = defineProps<{
  currentDir: string;
  rootLabel?: string;
}>();

const emit = defineEmits<{
  navigate: [path: string];
}>();

interface Segment {
  label: string;
  path: string;
}

const segments = computed<Segment[]>((): Segment[] => {
  const parts = props.currentDir.replace(/^\//, '').split('/').filter(Boolean);
  const result: Segment[] = [{ label: props.rootLabel ?? 'Home', path: '/' }];

  let built = '';
  for (const part of parts) {
    built += '/' + part;
    result.push({ label: part, path: built + '/' });
  }

  return result;
});

function navigateTo(path: string): void {
  emit('navigate', path);
}
</script>

<style scoped>
.breadcrumb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0;
  padding: 6px 8px;
  font-size: var(--text-xs, 12px);
  border-bottom: 1px solid var(--rule, oklch(0.88 0.003 85));
  background: var(--paper-bg, oklch(0.975 0.003 85));
  user-select: none;
}

.breadcrumb__item {
  background: none;
  border: none;
  color: var(--ink-secondary, oklch(0.42 0.003 85));
  cursor: pointer;
  padding: 2px 4px;
  border-radius: var(--radius, 2px);
  font-size: inherit;
  transition:
    background 150ms var(--ease-fade, cubic-bezier(0.4, 0, 0.2, 1)),
    color 150ms var(--ease-fade, cubic-bezier(0.4, 0, 0.2, 1));
}

.breadcrumb__item:not(:last-child)::after {
  content: '/';
  margin-left: 4px;
  color: var(--ink-muted, oklch(0.6 0.002 85));
}

.breadcrumb__item:disabled {
  cursor: default;
}

.breadcrumb__item--current {
  color: var(--ink-primary, oklch(0.15 0.003 85));
  font-weight: 600;
  cursor: default;
}

.breadcrumb__item:hover:not(:disabled) {
  background: var(--accent-soft, oklch(0.92 0.03 250 / 0.55));
  color: var(--ink-primary, oklch(0.15 0.003 85));
}
</style>
