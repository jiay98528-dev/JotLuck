<template>
  <header
    class="topbar"
    :class="[`topbar--${region.variant}`, `topbar--layout-${region.layout}`]"
    :data-variant="region.variant"
    :data-layout="region.layout"
    role="banner"
    aria-label="编辑器工具栏"
  >
    <div v-if="region.layout === 'search-first'" class="topbar-inner topbar-inner--search-first">
      <div class="topbar-left">
        <ShellActionButton
          v-for="action in leftActions"
          :key="action.id"
          :action="action"
          label-mode="icon"
        />
        <span class="topbar-notebook" :title="notebookName">{{ notebookName }}</span>
      </div>
      <div class="topbar-command-zone">
        <ShellActionButton
          v-for="action in centerActions"
          :key="action.id"
          :action="action"
          label-mode="full"
          size="sm"
        />
      </div>
      <div class="topbar-right">
        <span class="topbar-title topbar-title--archive" :title="titleText">{{ titleText }}</span>
        <ShellActionButton
          v-for="action in rightActions"
          :key="action.id"
          :action="action"
          label-mode="icon"
        />
      </div>
    </div>

    <div v-else-if="region.layout === 'reader'" class="topbar-inner topbar-inner--reader">
      <div class="topbar-left">
        <ShellActionButton
          v-for="action in leftActions"
          :key="action.id"
          :action="action"
          label-mode="icon"
        />
      </div>
      <div class="topbar-center topbar-center--reader">
        <span class="topbar-title" :title="titleText">{{ titleText }}</span>
      </div>
      <div class="topbar-right">
        <ShellActionButton
          v-for="action in rightActions"
          :key="action.id"
          :action="action"
          label-mode="icon"
        />
      </div>
    </div>

    <div v-else-if="region.layout === 'compact'" class="topbar-inner topbar-inner--compact">
      <div class="topbar-left topbar-left--compact">
        <span class="topbar-title" :title="titleText">{{ titleText }}</span>
      </div>
      <div class="topbar-right">
        <ShellActionButton
          v-for="action in [...centerActions, ...rightActions]"
          :key="action.id"
          :action="action"
          :label-mode="action.id === 'search' ? 'short' : 'icon'"
        />
      </div>
    </div>

    <div v-else-if="region.layout === 'workbench'" class="topbar-inner topbar-inner--workbench">
      <div class="topbar-identity">
        <div class="topbar-identity-actions">
          <ShellActionButton
            v-for="action in leftActions"
            :key="action.id"
            :action="action"
            label-mode="icon"
          />
        </div>
        <div class="topbar-identity-copy">
          <span class="topbar-notebook topbar-notebook--caps" :title="notebookName">
            {{ notebookName }}
          </span>
          <span class="topbar-title topbar-title--workbench" :title="titleText">
            {{ titleText }}
          </span>
        </div>
      </div>
      <div class="topbar-command-zone topbar-command-zone--workbench">
        <ShellActionButton
          v-for="action in centerActions"
          :key="action.id"
          :action="action"
          :label-mode="action.id === 'search' ? 'full' : 'short'"
          size="sm"
        />
      </div>
      <div class="topbar-right topbar-right--workbench">
        <ShellActionButton
          v-for="action in rightActions"
          :key="action.id"
          :action="action"
          label-mode="icon"
        />
      </div>
    </div>

    <div
      v-else
      class="topbar-inner"
      :class="{ 'topbar-inner--title-first': region.layout === 'title-first' }"
    >
      <div class="topbar-left">
        <ShellActionButton
          v-for="action in leftActions"
          :key="action.id"
          :action="action"
          label-mode="icon"
        />
        <span class="topbar-notebook" :title="notebookName">{{ notebookName }}</span>
      </div>
      <div class="topbar-center">
        <span class="topbar-title" :title="titleText">{{ titleText }}</span>
      </div>
      <div class="topbar-right">
        <ShellActionButton
          v-for="action in [...centerActions, ...rightActions]"
          :key="action.id"
          :action="action"
          :label-mode="action.id === 'search' ? 'short' : 'icon'"
        />
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import ShellActionButton from '@/components/layout/ShellActionButton.vue';
import type { ShellAction, TopBarRegion } from '@/types/theme-pack';

const props = withDefaults(
  defineProps<{
    noteTitle: string;
    notebookName: string;
    region?: TopBarRegion;
    leftActions?: ShellAction[];
    centerActions?: ShellAction[];
    rightActions?: ShellAction[];
  }>(),
  {
    region: () => ({ variant: 'balanced' as const, layout: 'classic' as const }),
    leftActions: () => [],
    centerActions: () => [],
    rightActions: () => [],
  },
);

const titleText = computed(() => props.noteTitle || '无标题');
</script>

<style scoped>
.topbar {
  position: sticky;
  top: 0;
  z-index: var(--z-overlay);
  height: var(--topbar-height);
  flex-shrink: 0;
  border-bottom: var(--border-thin) solid var(--rule);
  background: color-mix(in oklch, var(--paper-surface) 92%, transparent);
  backdrop-filter: blur(12px);
}

.topbar-inner {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) minmax(160px, 1.2fr) minmax(160px, 1fr);
  align-items: center;
  gap: var(--space-8);
  height: 100%;
  padding: 0 var(--space-12);
}

.topbar-inner--title-first {
  grid-template-columns: minmax(120px, 0.7fr) minmax(260px, 1.6fr) minmax(120px, 0.7fr);
}

.topbar-inner--search-first {
  grid-template-columns: minmax(140px, 0.72fr) minmax(260px, 1.45fr) minmax(180px, 0.83fr);
}

.topbar-inner--reader {
  grid-template-columns: minmax(80px, 0.4fr) minmax(280px, 1.6fr) minmax(160px, 0.8fr);
}

.topbar-inner--compact {
  grid-template-columns: minmax(180px, 1fr) auto;
}

.topbar-inner--workbench {
  grid-template-columns: minmax(220px, 1fr) minmax(240px, 1.1fr) auto;
  gap: var(--space-12);
  padding-inline: var(--space-16);
}

.topbar-left,
.topbar-center,
.topbar-right,
.topbar-command-zone {
  display: flex;
  align-items: center;
  min-width: 0;
}

.topbar-left {
  justify-content: flex-start;
  gap: var(--space-8);
}

.topbar-center,
.topbar-command-zone {
  justify-content: center;
}

.topbar-right {
  justify-content: flex-end;
  gap: var(--space-4);
}

.topbar-command-zone :deep(.shell-action--search) {
  width: min(100%, 360px);
}

.topbar-identity {
  display: flex;
  align-items: center;
  gap: var(--space-10);
  min-width: 0;
}

.topbar-identity-actions {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex: 0 0 auto;
}

.topbar-identity-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.topbar-command-zone--workbench {
  justify-content: flex-start;
  gap: var(--space-6);
  overflow: hidden;
}

.topbar-right--workbench {
  gap: var(--space-6);
}

.topbar-notebook,
.topbar-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.topbar-notebook {
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

.topbar-title {
  color: var(--ink-primary);
  font-size: var(--text-sm);
  font-weight: var(--fw-semibold);
}

.topbar-title--archive {
  max-width: 140px;
  color: var(--ink-muted);
  font-size: var(--text-xs);
  font-weight: var(--fw-regular);
}

.topbar-notebook--caps {
  letter-spacing: var(--ls-wide);
  text-transform: uppercase;
}

.topbar-title--workbench {
  font-size: var(--text-base);
}

.topbar--layout-reader {
  height: 44px;
  background: color-mix(in oklch, var(--paper-bg) 82%, transparent);
}

.topbar--layout-reader .topbar-title {
  font-size: var(--text-base);
}

.topbar--layout-compact {
  height: var(--topbar-height);
}

.topbar--layout-title-first .topbar-title {
  font-size: var(--text-base);
}

.topbar--layout-workbench {
  background:
    linear-gradient(
      90deg,
      color-mix(in oklch, var(--accent-soft) 28%, transparent),
      transparent 32%
    ),
    color-mix(in oklch, var(--paper-surface) 90%, transparent);
}

@media (width <= 760px) {
  .topbar-inner,
  .topbar-inner--title-first,
  .topbar-inner--search-first,
  .topbar-inner--reader,
  .topbar-inner--compact,
  .topbar-inner--workbench {
    grid-template-columns: auto 1fr auto;
  }

  .topbar-notebook,
  .topbar-title--archive {
    display: none;
  }

  .topbar-identity-copy .topbar-title--workbench {
    display: block;
  }

  .topbar-command-zone--workbench {
    justify-content: center;
  }
}
</style>
