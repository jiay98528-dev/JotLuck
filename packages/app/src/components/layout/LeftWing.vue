<template>
  <aside class="left-wing" aria-label="笔记本导航">
    <!-- Logo Mark -->
    <button class="wing-logo" title="MarkLuck — 回到首页" @click="$emit('select-note', '')">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
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

    <!-- New Note Button -->
    <Button
      variant="ghost"
      size="icon"
      class="wing-new-btn"
      title="新建笔记 (Ctrl+N)"
      @click="$emit('create-note')"
    >
      <template #icon-left>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <line x1="12" y1="5" x2="12" y2="19" stroke-linecap="round" />
          <line x1="5" y1="12" x2="19" y2="12" stroke-linecap="round" />
        </svg>
      </template>
    </Button>

    <!-- Divider -->
    <div class="wing-rule" />

    <!-- Bookmark Dots -->
    <nav ref="bookmarkList" class="wing-bookmarks">
      <button
        v-for="(note, i) in notes"
        :key="note.path"
        class="wing-bookmark-dot"
        :class="{ active: note.path === activePath }"
        :style="{ '--dot-color': dotPalette[note.colorIndex % 8], '--dot-delay': `${i * 30}ms` }"
        :title="note.title"
        :data-tooltip="note.title"
        :aria-label="note.title"
        @click="$emit('select-note', note.path)"
      >
        <span class="dot-core" />
        <span v-if="note.path === activePath" class="dot-ring" />
      </button>

      <!-- Empty State -->
      <div v-if="notes.length === 0" class="wing-empty">
        <span class="wing-empty-dot" />
        <span class="wing-empty-dot" />
        <span class="wing-empty-dot" />
      </div>
    </nav>

    <!-- Spacer -->
    <div class="wing-spacer" />

    <!-- Bottom Settings -->
    <Button
      variant="ghost"
      size="icon-sm"
      class="wing-settings-btn"
      title="设置"
      @click="$emit('open-settings')"
    >
      <template #icon-left>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
          />
        </svg>
      </template>
    </Button>
  </aside>
</template>

<script setup lang="ts">
import Button from '@/components/common/Button.vue';
/**
 * LeftWing.vue — 56px 书签栏
 *
 * 彩色圆点 = 最近笔记。每个圆点颜色从 8 色色板自动分配。
 * 当前笔记圆点带 accent ring。
 *
 * @see migration-map.md §1 新建组件
 */

defineProps<{
  notes: Array<{ path: string; title: string; colorIndex: number }>;
  activePath: string;
}>();

defineEmits<{
  'select-note': [path: string];
  'create-note': [];
  'open-settings': [];
}>();

const dotPalette = Array.from({ length: 8 }, (_, i) => `var(--dot-${i})`);
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

.wing-logo {
  border: none;
  background: none;
  cursor: pointer;
  padding: 0;
  color: var(--ink-secondary);
  opacity: 0.7;
  margin-bottom: var(--space-12);
  transition: opacity var(--dur-micro) var(--ease-fade);
  display: flex;
  align-items: center;
  justify-content: center;
}

.wing-logo:hover {
  opacity: 1;
}

.wing-new-btn {
  width: 32px;
  height: 32px;
  border: var(--border-thin) dashed var(--rule-strong);
  border-radius: var(--radius);
  background: none;
  color: var(--ink-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    border-color var(--dur-micro) var(--ease-fade),
    color var(--dur-micro) var(--ease-fade),
    background var(--dur-press) var(--ease-press);
}

.wing-new-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  border-style: solid;
}

.wing-new-btn:active {
  background: var(--accent-soft);
  transform: scale(0.93);
  transition: transform var(--dur-press) var(--ease-press);
}

.wing-rule {
  width: 24px;
  height: var(--border-thin);
  background: var(--rule-wing);
  margin: var(--space-12) 0;
}

/* === Bookmark Dots === */
.wing-bookmarks {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-8);
  overflow-y: auto;

  /* overflow-x left as visible — dots are centered, no horizontal overflow. Tooltip ::after escapes to the right;
    native title is the reliable fallback. */
  padding: 0 var(--space-4);
  scrollbar-width: none;
}

.wing-bookmarks::-webkit-scrollbar {
  display: none;
}

.wing-bookmark-dot {
  position: relative;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  cursor: pointer;
  border-radius: var(--radius-full);
  opacity: 0;
  animation: dot-enter var(--dur-expand) var(--ease-enter) forwards;
  animation-delay: var(--dot-delay, 0ms);
  animation-fill-mode: forwards;
  transition: transform var(--dur-release) var(--ease-back);
}

@keyframes dot-enter {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.wing-bookmark-dot:hover {
  transform: scale(1.15);
}

.wing-bookmark-dot:active {
  transform: scale(0.85);
  transition: transform var(--dur-press) var(--ease-press);
}

/* Custom tooltip — 0.5s delay, appears on hover */
.wing-bookmark-dot::after {
  content: attr(data-tooltip);
  position: absolute;
  left: calc(100% + 10px);
  top: 50%;
  transform: translateY(-50%);
  white-space: nowrap;
  padding: 4px 10px;
  font-size: var(--text-xs);
  font-family: var(--ff-body);
  color: var(--ink-primary);
  background: var(--paper-raised);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  box-shadow: var(--shadow-stack);
  opacity: 0;
  pointer-events: none;
  transition: opacity 100ms var(--ease-fade);
  transition-delay: 500ms;
  z-index: var(--z-overlay);
}

.wing-bookmark-dot:hover::after {
  opacity: 1;
  transition-delay: 500ms;
}

.wing-bookmark-dot:not(:hover)::after {
  transition-delay: 0ms;
}

.dot-core {
  width: 12px;
  height: 12px;
  border-radius: var(--radius-full);
  background: var(--dot-color, oklch(0.55 0.12 250));
  transition:
    width var(--dur-micro) var(--ease-fade),
    height var(--dur-micro) var(--ease-fade),
    box-shadow var(--dur-micro) var(--ease-fade);
}

.wing-bookmark-dot.active .dot-core {
  width: 16px;
  height: 16px;
  box-shadow: 0 0 0 var(--border-medium) var(--accent-ring);
}

.dot-ring {
  position: absolute;
  inset: 0;
  border-radius: var(--radius-full);
  border: var(--border-medium) solid var(--accent);
  animation: ring-breathe var(--dur-breathe) var(--ease-fade) infinite alternate;
}

@keyframes ring-breathe {
  from {
    opacity: 0.3;
    transform: scale(0.9);
  }

  to {
    opacity: 1;
    transform: scale(1.05);
  }
}

/* === Empty State === */
.wing-empty {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  align-items: center;
  padding-top: var(--space-8);
}

.wing-empty-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--rule);
}

/* === Spacer & Settings === */
.wing-spacer {
  flex: 0 0 auto;
}

.wing-settings-btn {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius);
  background: none;
  color: var(--ink-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color var(--dur-micro) var(--ease-fade);
  margin-top: var(--space-4);
}

.wing-settings-btn:hover {
  color: var(--ink-secondary);
}
</style>
