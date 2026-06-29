<template>
  <ThemeRuntimeRenderer
    :slot-id="slotId"
    :theme-id="themeId"
    :recipe="recipe"
    :actions="actions"
    :status-text="statusText"
    :slot-props="slotProps"
  >
    <slot />
  </ThemeRuntimeRenderer>
</template>

<script setup lang="ts">
import ThemeRuntimeRenderer from '@/components/theme/ThemeRuntimeRenderer.vue';
import type {
  ShellAction,
  ThemeSlotId,
  ThemeSlotProps,
  UxComponentRecipe,
} from '@/types/theme-pack';

defineProps<{
  slotId: ThemeSlotId;
  themeId: string;
  recipe?: UxComponentRecipe;
  actions?: ShellAction[];
  statusText?: string;
  slotProps?: ThemeSlotProps;
}>();
</script>
