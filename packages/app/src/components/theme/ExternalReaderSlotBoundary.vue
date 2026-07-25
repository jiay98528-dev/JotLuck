<template>
  <div
    data-theme-runtime-slot="external-reader"
    data-theme-runtime="builtin-reader"
    :data-theme-id="themeId"
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
import type { ThemeSlotProps } from '@/types/theme-pack';

defineProps<{
  themeId: string;
  slotProps: ThemeSlotProps;
}>();
</script>
