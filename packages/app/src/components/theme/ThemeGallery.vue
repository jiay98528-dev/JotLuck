<template>
  <div class="theme-gallery" :class="`theme-gallery--${variant}`">
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      class="theme-card"
      :class="{ 'theme-card--active': item.active }"
      :aria-pressed="item.active"
      @click="$emit('preview', item)"
    >
      <span class="theme-card-preview" :data-theme-preview="item.id">
        <img
          v-if="item.officialProfile?.previewImage"
          :src="item.officialProfile.previewImage"
          :alt="`${item.name} 主题预览`"
          loading="lazy"
        />
        <span v-else class="theme-card-preview-fallback">
          <span></span>
          <span></span>
          <span></span>
        </span>
      </span>

      <span class="theme-card-body">
        <span class="theme-card-titleline">
          <strong>{{ item.name }}</strong>
          <span
            v-if="item.performanceBadge"
            class="theme-performance"
            :data-performance-color="item.performanceBadge.color"
          >
            {{ item.performanceBadge.level }} {{ item.performanceBadge.name }}
          </span>
        </span>
        <span class="theme-card-headline">
          {{ item.officialProfile?.headline || item.description }}
        </span>
        <span v-if="showRole && item.officialProfile" class="theme-card-role">
          {{ roleLabel(item.officialProfile.role) }}
        </span>
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { OfficialThemeRole } from '@/types/theme-pack';
import type { ThemeViewModel } from '@/stores/theme';

withDefaults(
  defineProps<{
    items: ThemeViewModel[];
    variant?: 'settings' | 'welcome' | 'home';
    showRole?: boolean;
  }>(),
  {
    variant: 'settings',
    showRole: true,
  },
);

defineEmits<{
  preview: [ThemeViewModel];
}>();

function roleLabel(role: OfficialThemeRole): string {
  if (role === 'collectible') return '视觉收藏';
  if (role === 'workflow') return '工作流';
  return '默认基线';
}
</script>

<style scoped>
.theme-gallery {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-10);
}

.theme-gallery--settings {
  grid-template-columns: 1fr;
}

.theme-gallery--welcome,
.theme-gallery--home {
  grid-template-columns: repeat(auto-fit, minmax(164px, 1fr));
}

.theme-card {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: var(--space-10);
  min-width: 0;
  padding: var(--space-10);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
  color: var(--ink-secondary);
  text-align: left;
  cursor: pointer;
  transition:
    background var(--dur-press) var(--ease-press),
    border-color var(--dur-press) var(--ease-press),
    transform var(--dur-press) var(--ease-press);
}

.theme-gallery--settings .theme-card {
  grid-template-columns: 104px minmax(0, 1fr);
  grid-template-rows: auto;
  align-items: center;
}

.theme-card:hover {
  border-color: var(--accent);
  background: var(--surface-hover);
  transform: translateY(-1px);
}

.theme-card:focus-visible {
  outline: var(--focus-ring-width) solid var(--accent);
  outline-offset: var(--focus-ring-offset);
}

.theme-card--active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.theme-card-preview {
  position: relative;
  display: block;
  min-height: 78px;
  overflow: hidden;
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius-sm);
  background: var(--paper-bg);
}

.theme-card-preview img {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 78px;
  object-fit: cover;
}

.theme-card-preview-fallback {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) 22px;
  gap: 5px;
  height: 78px;
  padding: 8px;
}

.theme-card-preview-fallback span {
  border-radius: 2px;
  background: var(--rule);
}

.theme-card-preview-fallback span:nth-child(2) {
  background: var(--paper-raised);
}

.theme-card-preview-fallback span:nth-child(3) {
  background: var(--accent-soft);
}

.theme-card-preview[data-theme-preview='markluck.archive'] {
  background:
    linear-gradient(90deg, oklch(0.72 0.035 95 / 0.32), transparent 34%),
    repeating-linear-gradient(0deg, transparent 0 14px, oklch(0.64 0.018 90 / 0.22) 14px 15px),
    oklch(0.93 0.015 82);
}

.theme-card-preview[data-theme-preview='markluck.studio'] {
  background:
    linear-gradient(90deg, oklch(0.78 0.08 28 / 0.32) 0 24px, transparent 24px),
    repeating-linear-gradient(90deg, transparent 0 42px, oklch(0.62 0.035 28 / 0.22) 42px 43px),
    oklch(0.9 0.01 220);
}

.theme-card-preview[data-theme-preview='paper'] {
  background:
    linear-gradient(90deg, oklch(0.88 0.01 86) 0 22px, transparent 22px),
    linear-gradient(90deg, transparent 0 calc(100% - 28px), oklch(0.91 0.007 88) calc(100% - 28px)),
    oklch(0.97 0.004 86);
}

.theme-card-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.theme-card-titleline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-8);
  min-width: 0;
}

.theme-card-titleline strong {
  min-width: 0;
  overflow: hidden;
  color: var(--ink-primary);
  font-size: var(--text-sm);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-ui);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.theme-card-headline,
.theme-card-role {
  color: var(--ink-muted);
  font-size: var(--text-xs);
  line-height: var(--lh-ui);
}

.theme-performance {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: var(--radius-full);
  background: var(--performance-bg, var(--paper-raised));
  color: var(--performance-fg, var(--ink-secondary));
  font-size: 11px;
  font-weight: var(--fw-medium);
  line-height: 18px;
}

.theme-performance[data-performance-color='green'] {
  --performance-bg: oklch(0.91 0.05 145 / 0.72);
  --performance-fg: oklch(0.38 0.08 145);
}

.theme-performance[data-performance-color='cyan'] {
  --performance-bg: oklch(0.91 0.045 205 / 0.72);
  --performance-fg: oklch(0.38 0.08 205);
}

.theme-performance[data-performance-color='blue'] {
  --performance-bg: oklch(0.9 0.045 255 / 0.72);
  --performance-fg: oklch(0.38 0.09 255);
}

.theme-performance[data-performance-color='purple'] {
  --performance-bg: oklch(0.9 0.05 305 / 0.72);
  --performance-fg: oklch(0.42 0.09 305);
}

.theme-performance[data-performance-color='orange'] {
  --performance-bg: oklch(0.9 0.065 45 / 0.72);
  --performance-fg: oklch(0.45 0.11 45);
}

@media (prefers-reduced-motion: reduce) {
  .theme-card {
    transition:
      background var(--dur-press) var(--ease-press),
      border-color var(--dur-press) var(--ease-press);
  }

  .theme-card:hover {
    transform: none;
  }
}
</style>
