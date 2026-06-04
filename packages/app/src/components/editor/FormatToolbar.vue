<template>
  <div
    class="format-toolbar"
    :class="{ 'format-toolbar--compact': compact, 'format-toolbar--vertical': vertical }"
  >
    <slot name="before" />
    <template v-for="item in toolbarItems" :key="item.type">
      <!-- Separator: thin vertical rule -->
      <span v-if="item.kind === 'separator'" class="format-toolbar__sep" />
      <!-- Button -->
      <slot v-else name="button" :item="item">
        <ToolbarButton
          :icon="item.icon"
          :label="item.label"
          :shortcut="item.shortcut"
          :disabled="disabled"
          :compact="compact"
          @click="$emit('format', item.type)"
        />
      </slot>
    </template>
    <slot name="after" />
  </div>
</template>

<script setup lang="ts">
/**
 * FormatToolbar.vue — 格式工具栏（纸张主题）
 *
 * Stationery metaphor: buttons are writing tools laid out on the paper surface.
 * - Floats above the editor with a subtle bottom rule
 * - Button groups separated by thin vertical rules
 * - No heavy accent border — the tools are quiet, not commanding
 */
import { computed } from 'vue';
import ToolbarButton from './ToolbarButton.vue';
import { DEFAULT_TOOLBAR_ITEMS, type ToolbarItemConfig } from '@/utils/toolbarConfig';

const props = withDefaults(
  defineProps<{
    items?: ToolbarItemConfig[];
    disabled?: boolean;
    compact?: boolean;
    vertical?: boolean;
  }>(),
  {
    items: () => DEFAULT_TOOLBAR_ITEMS,
    disabled: false,
    compact: false,
    vertical: false,
  },
);

defineEmits<{
  format: [type: string];
}>();

const toolbarItems = computed(() => props.items);
</script>

<script lang="ts">
export default { name: 'FormatToolbar' };
</script>

<style scoped>
.format-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  padding: 4px var(--space-8);
  border-bottom: var(--border-thin) solid var(--rule);
  background: var(--paper-surface);
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar-thumb) transparent;
  min-height: var(--toolbar-height);
}

.format-toolbar--compact {
  gap: 0;
  padding: 4px;
}

.format-toolbar--vertical {
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  overflow: hidden auto;
}

/* --- Separator: thin vertical rule between button groups --- */
.format-toolbar__sep {
  width: 1px;
  height: 20px;
  background: var(--rule);
  margin: 0 4px;
  flex-shrink: 0;
}

.format-toolbar--vertical .format-toolbar__sep {
  width: auto;
  height: 1px;
  margin: 2px 0;
}
</style>
