<template>
  <div
    v-if="region.layout !== 'hidden' && region.layout !== 'studio-rail'"
    class="editor-control-strip editor-control-bar"
    :class="`editor-control-strip--${region.layout}`"
    :data-layout="region.layout"
    :data-toolbar-density="region.density"
  >
    <FormatToolbar
      :preset="preset"
      :active-action="activeAction"
      :density="region.density"
      @format="$emit('format', $event)"
    />
    <div v-if="actions.length > 0" class="editor-control-strip__actions">
      <ShellActionButton
        v-for="action in actions"
        :key="action.id"
        :action="action"
        :label-mode="region.layout === 'writing-strip' ? 'icon' : 'short'"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import FormatToolbar from './FormatToolbar.vue';
import ShellActionButton from '@/components/layout/ShellActionButton.vue';
import type { FormatAction, ParagraphPreset } from '@/types';
import type { ShellAction, EditorControlRegion } from '@/types/theme-pack';

withDefaults(
  defineProps<{
    region?: EditorControlRegion;
    actions?: ShellAction[];
    preset?: ParagraphPreset;
    activeAction?: FormatAction | null;
  }>(),
  {
    region: () => ({ layout: 'toolbar' as const, density: 'calm' as const }),
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
.editor-control-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-8);
  min-height: 38px;
  padding: var(--space-4) var(--space-12);
  border-bottom: var(--border-thin) solid var(--rule);
  background: var(--paper-surface);
}

.editor-control-strip--writing-strip {
  justify-content: center;
  max-width: 760px;
  margin: var(--space-8) auto 0;
  border: var(--border-thin) solid color-mix(in oklch, var(--rule) 72%, transparent);
  border-radius: var(--radius-md);
  background: color-mix(in oklch, var(--paper-surface) 84%, transparent);
}

.editor-control-strip__actions {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-width: 0;
}

.editor-control-strip--writing-strip .editor-control-strip__actions {
  opacity: 0.72;
}

@media (width <= 760px) {
  .editor-control-strip {
    flex-wrap: wrap;
    align-items: stretch;
  }
}
</style>
