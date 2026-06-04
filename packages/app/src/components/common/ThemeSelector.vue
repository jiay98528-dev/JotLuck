<template>
  <div class="theme-selector" :class="{ 'theme-selector--compact': compact }">
    <div class="theme-row">
      <div class="theme-toggle">
        <button
          class="theme-btn"
          :class="{ active: store.colorScheme === 'light' }"
          title="亮色模式"
          @click="store.setColorScheme('light')"
        >
          {{ compact ? '☀' : '☀ 亮' }}
        </button>
        <button
          class="theme-btn"
          :class="{ active: store.colorScheme === 'dark' }"
          title="暗色模式"
          @click="store.setColorScheme('dark')"
        >
          {{ compact ? '☾' : '☾ 暗' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * ThemeSelector.vue — 主题切换控件（单纸张主题：仅亮/暗色方案）
 *
 * M5-06: 亮/暗 色方案选择器。
 * 单主题体系下仅保留 colorScheme 切换，移除构成/玻璃主题选择。
 *
 * @see components.md
 * @see milestones.md M5-06
 */
import { onMounted } from 'vue';
import { useThemeStore } from '@/stores/theme';

withDefaults(
  defineProps<{
    compact?: boolean;
  }>(),
  { compact: false },
);

const store = useThemeStore();

// M5-05: Initialize theme on mount (sets data-color-scheme on <html>)
onMounted(() => {
  store.init();
});
</script>

<style scoped>
.theme-selector {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  border-top: var(--border-thin) solid var(--rule, oklch(0.88 0.003 85));
}

/* Compact mode — inline toolbar display in sidebar header */
.theme-selector--compact {
  flex-direction: row;
  gap: 3px;
  padding: 0;
  border-top: none;
}

.theme-row {
  display: flex;
  align-items: center;
}

.theme-toggle {
  display: flex;
  gap: 0;
  border: var(--border-thin) solid var(--rule, oklch(0.88 0.003 85));
  border-radius: var(--radius, 2px);
  overflow: hidden;
}

.theme-selector--compact .theme-toggle {
  border-radius: var(--radius, 2px);
}

.theme-btn {
  padding: 2px 7px;
  border: none;
  border-right: var(--border-thin) solid var(--rule, oklch(0.88 0.003 85));
  background: var(--paper-surface, oklch(0.985 0.002 85));
  color: var(--ink-muted, oklch(0.6 0.002 85));
  font-size: 11px;
  font-family: var(--ff-body);
  cursor: pointer;
  transition:
    background var(--dur-micro, 80ms) var(--ease-fade, cubic-bezier(0.4, 0, 0.2, 1)),
    color var(--dur-micro, 80ms) var(--ease-fade, cubic-bezier(0.4, 0, 0.2, 1));
  line-height: 1.3;
}

.theme-btn:last-child {
  border-right: none;
}

.theme-btn:hover {
  background: var(--accent-soft, oklch(0.92 0.03 250 / 0.55));
  color: var(--ink-primary, oklch(0.15 0.003 85));
}

.theme-btn:active {
  background: var(--accent, oklch(0.52 0.12 250));
  color: oklch(1 0 0);
  transition: background var(--dur-press, 120ms) var(--ease-fade, cubic-bezier(0.4, 0, 0.2, 1));
}

.theme-btn.active {
  background: var(--accent, oklch(0.52 0.12 250));
  color: oklch(1 0 0);
}

.theme-selector--compact .theme-btn {
  padding: 1px 5px;
  font-size: 10px;
}
</style>
