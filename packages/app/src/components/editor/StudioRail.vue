<template>
  <aside class="studio-rail" data-testid="studio-rail" aria-label="生产工具轨">
    <div class="studio-rail__label">生产</div>
    <div class="studio-rail__actions">
      <ShellActionButton
        v-for="action in actions"
        :key="action.id"
        :action="action"
        label-mode="short"
        size="sm"
      />
    </div>
    <div class="studio-rail__format">
      <FormatToolbar
        :preset="preset"
        :active-action="activeAction"
        density="compact"
        @format="$emit('format', $event)"
      />
    </div>
  </aside>
</template>

<script setup lang="ts">
import FormatToolbar from './FormatToolbar.vue';
import ShellActionButton from '@/components/layout/ShellActionButton.vue';
import type { FormatAction, ParagraphPreset } from '@/types';
import type { ShellAction } from '@/types/theme-pack';

withDefaults(
  defineProps<{
    actions?: ShellAction[];
    preset?: ParagraphPreset;
    activeAction?: FormatAction | null;
  }>(),
  {
    actions: () => [],
    preset: 'paragraph',
    activeAction: null,
  },
);

defineEmits<{
  format: [action: FormatAction];
}>();
</script>

<style scoped>
.studio-rail {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-10);
  width: 124px;
  min-width: 124px;
  min-height: 100%;
  padding: var(--space-12) var(--space-8);
  border-right: var(--border-thin) solid var(--rule-strong);
  background: var(--paper-raised);
  box-shadow: inset -1px 0 0 color-mix(in oklch, var(--accent-soft) 52%, transparent);
}

.studio-rail__label {
  color: var(--ink-muted);
  font-size: 10px;
  font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-wide);
  line-height: var(--lh-ui);
  text-align: center;
  text-transform: uppercase;
}

.studio-rail__actions {
  display: grid;
  grid-template-columns: 1fr;
  align-items: center;
  gap: var(--space-6);
  flex: 0 0 auto;
}

.studio-rail__actions :deep(.shell-action) {
  justify-content: flex-start;
  width: 100%;
}

.studio-rail__format {
  min-width: 0;
  flex: 1;
  overflow: hidden auto;
  border-top: var(--border-thin) solid var(--rule);
  padding-top: var(--space-8);
}

.studio-rail__format :deep(.format-toolbar) {
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-6);
  overflow: visible;
}

.studio-rail__format :deep(.format-toolbar__preset select),
.studio-rail__format :deep(.format-toolbar__clear) {
  width: 100%;
}

.studio-rail__format :deep(.format-toolbar__divider) {
  width: 100%;
  height: var(--border-thin);
}

.studio-rail__format :deep(.format-toolbar__button) {
  width: 100%;
  justify-content: center;
}

@media (width <= 860px) {
  .studio-rail {
    width: 104px;
    min-width: 104px;
  }

  .studio-rail__actions :deep(.shell-action__label) {
    display: none;
  }
}
</style>
