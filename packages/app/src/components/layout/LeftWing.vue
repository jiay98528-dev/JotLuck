<template>
  <aside
    class="left-wing"
    :class="[`left-wing--${region.mode}`, `left-wing--layout-${region.layout}`]"
    :data-mode="region.mode"
    :data-layout="region.layout"
    aria-label="笔记本导航"
  >
    <button class="wing-logo" title="JotLuck, 回到首页" @click="$emit('select-note', '')">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        aria-hidden="true"
      >
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke-linecap="round" />
        <path
          d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"
          stroke-linecap="round"
        />
        <line x1="8" y1="7" x2="16" y2="7" stroke-linecap="round" />
        <line x1="8" y1="11" x2="16" y2="11" stroke-linecap="round" />
        <line x1="8" y1="15" x2="13" y2="15" stroke-linecap="round" />
      </svg>
    </button>

    <div v-if="topActions.length > 0" class="wing-action-stack wing-action-stack--top">
      <ShellActionButton
        v-for="action in topActions"
        :key="action.id"
        :action="action"
        label-mode="icon"
        size="icon-sm"
      />
    </div>

    <div class="wing-rule" />

    <div v-if="region.layout === 'research-stack'" class="wing-index-count" aria-hidden="true">
      {{ notes.length }}
    </div>
    <div v-else-if="region.layout === 'navigator'" class="wing-panel-kicker" aria-hidden="true">
      Recent
    </div>
    <div v-else-if="region.layout === 'studio-rail'" class="wing-rail-groove" aria-hidden="true" />

    <nav ref="bookmarkList" class="wing-bookmarks" aria-label="最近笔记">
      <button
        v-for="note in notes"
        :key="note.path"
        class="wing-bookmark-dot"
        :class="{ active: note.path === activePath }"
        :style="{ '--dot-color': dotPalette[note.colorIndex % 8] }"
        :title="note.title"
        :data-tooltip="note.title"
        :aria-label="note.title"
        @click="$emit('select-note', note.path)"
      >
        <span class="dot-core" />
        <span v-if="note.path === activePath" class="dot-ring" />
        <span
          v-if="region.layout === 'research-stack' || region.layout === 'navigator'"
          class="wing-bookmark-title"
        >
          <span class="wing-bookmark-name">{{ note.title }}</span>
          <span v-if="region.layout === 'navigator'" class="wing-bookmark-path">
            {{ normalizeBookmarkPath(note.path) }}
          </span>
        </span>
      </button>

      <div v-if="notes.length === 0" class="wing-empty">
        <span class="wing-empty-dot" />
        <span class="wing-empty-dot" />
        <span class="wing-empty-dot" />
      </div>
    </nav>

    <div class="wing-spacer" />

    <div v-if="bottomActions.length > 0" class="wing-action-stack wing-action-stack--bottom">
      <ShellActionButton
        v-for="action in bottomActions"
        :key="action.id"
        :action="action"
        label-mode="icon"
        size="icon-sm"
      />
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import ShellActionButton from './ShellActionButton.vue';
import type { ShellAction, LeftWingRegion } from '@/types/theme-pack';

const props = withDefaults(
  defineProps<{
    notes: Array<{ path: string; title: string; colorIndex: number }>;
    activePath: string;
    region?: LeftWingRegion;
    actions?: ShellAction[];
  }>(),
  {
    region: () => ({ mode: 'default' as const, layout: 'bookmarks' as const }),
    actions: () => [],
  },
);

defineEmits<{
  'select-note': [path: string];
}>();

const dotPalette = Array.from({ length: 8 }, (_, i) => `var(--dot-${i})`);
const bottomActionIds = new Set(['settings']);
const topActions = computed(() =>
  props.actions.filter((action) => !bottomActionIds.has(action.id)),
);
const bottomActions = computed(() =>
  props.actions.filter((action) => bottomActionIds.has(action.id)),
);

function normalizeBookmarkPath(path: string): string {
  return path.replace(/^\/+/, '') || 'home';
}
</script>

<style scoped>
.left-wing {
  width: var(--wing-left-width);
  min-width: var(--wing-left-width);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-12) 0 var(--space-8);
  background: var(--paper-left);
  user-select: none;
}

.left-wing--layout-research-stack {
  border-right: var(--border-thin) solid var(--rule-strong);
  background:
    linear-gradient(
      180deg,
      color-mix(in oklch, var(--accent-soft) 44%, transparent),
      transparent 36%
    ),
    var(--paper-left);
}

.left-wing--layout-quiet-bookmarks {
  background: color-mix(in oklch, var(--paper-left) 82%, transparent);
}

.left-wing--layout-studio-rail {
  background:
    linear-gradient(
      90deg,
      color-mix(in oklch, var(--accent-soft) 52%, transparent) 0 4px,
      transparent 4px
    ),
    var(--paper-left);
}

.left-wing--layout-navigator {
  align-items: stretch;
  padding-inline: var(--space-10);
  border-right: var(--border-thin) solid color-mix(in oklch, var(--rule) 82%, transparent);
  background:
    linear-gradient(
      180deg,
      color-mix(in oklch, var(--accent-soft) 34%, transparent),
      transparent 30%
    ),
    var(--paper-left);
}

.wing-logo {
  border: none;
  background: none;
  cursor: pointer;
  padding: 0;
  color: var(--ink-secondary);
  opacity: 0.75;
  margin-bottom: var(--space-10);
  transition: opacity var(--dur-micro) var(--ease-fade);
  display: flex;
  align-items: center;
  justify-content: center;
}

.wing-logo:hover {
  opacity: 1;
}

.wing-action-stack {
  display: grid;
  gap: var(--space-4);
  place-items: center;
}

.wing-action-stack--top {
  margin-bottom: var(--space-8);
}

.wing-action-stack--bottom {
  margin-top: var(--space-8);
}

.wing-rule {
  width: 24px;
  height: var(--border-thin);
  background: var(--rule-wing);
  margin: var(--space-8) 0 var(--space-12);
}

.wing-index-count {
  display: grid;
  width: 26px;
  height: 20px;
  margin-bottom: var(--space-10);
  place-items: center;
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius-full);
  background: var(--paper-raised);
  color: var(--ink-muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.wing-panel-kicker {
  margin-bottom: var(--space-10);
  color: var(--ink-muted);
  font-size: 10px;
  font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-wide);
  text-transform: uppercase;
}

.wing-rail-groove {
  width: 4px;
  min-height: 36px;
  margin-bottom: var(--space-10);
  border-radius: var(--radius-full);
  background: var(--accent);
  opacity: 0.64;
}

.wing-bookmarks {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-10);
  width: 100%;
  min-height: 0;
  overflow: hidden auto;
  padding: var(--space-2) 0;
  scrollbar-width: none;
}

.wing-bookmark-dot {
  position: relative;
  width: 26px;
  height: 26px;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  color: var(--dot-color);
}

.left-wing--layout-research-stack .wing-bookmarks {
  gap: var(--space-6);
  align-items: stretch;
  padding-inline: var(--space-6);
}

.left-wing--layout-navigator .wing-bookmarks {
  align-items: stretch;
  gap: var(--space-6);
  padding-inline: 0;
}

.left-wing--layout-research-stack .wing-bookmark-dot {
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr);
  align-items: center;
  gap: var(--space-6);
  width: 100%;
  height: 30px;
  padding-inline: var(--space-6);
  border: var(--border-thin) solid transparent;
  border-radius: var(--radius);
}

.left-wing--layout-navigator .wing-bookmark-dot {
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr);
  align-items: center;
  gap: var(--space-8);
  width: 100%;
  height: auto;
  min-height: 42px;
  padding: var(--space-6) var(--space-8);
  border: var(--border-thin) solid color-mix(in oklch, var(--rule) 88%, transparent);
  border-radius: var(--radius-md);
  background: color-mix(in oklch, var(--paper-raised) 86%, transparent);
  color: var(--dot-color);
}

.left-wing--layout-research-stack .wing-bookmark-dot.active {
  border-color: color-mix(in oklch, var(--accent) 42%, transparent);
  background: color-mix(in oklch, var(--accent-soft) 48%, transparent);
}

.left-wing--layout-navigator .wing-bookmark-dot.active {
  border-color: color-mix(in oklch, var(--accent) 44%, transparent);
  background: color-mix(in oklch, var(--accent-soft) 54%, transparent);
}

.left-wing--layout-quiet-bookmarks .wing-bookmark-dot:not(.active) {
  opacity: 0.54;
}

.dot-core {
  position: absolute;
  inset: 8px;
  border-radius: var(--radius-full);
  background: currentcolor;
  box-shadow: 0 0 0 1px color-mix(in oklch, currentcolor 44%, transparent);
}

.left-wing--layout-research-stack .dot-core {
  position: static;
  width: 8px;
  height: 8px;
}

.left-wing--layout-navigator .dot-core {
  position: static;
  width: 8px;
  height: 8px;
}

.wing-bookmark-dot:hover .dot-core {
  inset: 6px;
}

.dot-ring {
  position: absolute;
  inset: 3px;
  border: var(--border-thin) solid currentcolor;
  border-radius: var(--radius-full);
}

.left-wing--layout-research-stack .dot-ring {
  display: none;
}

.wing-bookmark-title {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
  color: var(--ink-secondary);
  text-align: left;
}

.wing-bookmark-name,
.wing-bookmark-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wing-bookmark-name {
  color: var(--ink-primary);
  font-size: var(--text-xs);
  line-height: var(--lh-ui);
}

.wing-bookmark-path {
  color: var(--ink-muted);
  font-size: 10px;
  line-height: var(--lh-ui);
}

.wing-empty {
  display: grid;
  gap: var(--space-8);
  padding-top: var(--space-8);
}

.wing-empty-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--rule-wing);
  opacity: 0.62;
}

.wing-spacer {
  flex: 1;
}
</style>
