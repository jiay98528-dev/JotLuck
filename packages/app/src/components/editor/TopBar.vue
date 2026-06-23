<template>
  <header class="topbar" role="banner" aria-label="编辑器工具栏">
    <div class="topbar-inner">
      <!-- ===== Left Zone: Hamburger + Notebook Name ===== -->
      <div class="topbar-left">
        <Button
          variant="ghost"
          size="icon-sm"
          class="topbar-btn--menu"
          title="切换左侧书签栏"
          aria-label="切换左侧书签栏"
          @click="$emit('toggle-left-wing')"
        >
          <template #icon-left>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <line x1="3" y1="5" x2="21" y2="5" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="19" x2="21" y2="19" />
            </svg>
          </template>
        </Button>
        <span class="topbar-notebook" :title="notebookName">{{ notebookName }}</span>
      </div>

      <!-- ===== Center Zone: Note Title ===== -->
      <div class="topbar-center">
        <span v-if="noteTitle" class="topbar-title">{{ noteTitle }}</span>
        <span v-else class="topbar-title topbar-title--untitled">无标题</span>
      </div>

      <!-- ===== Right Zone: Search Hint + Actions + Theme Toggle ===== -->
      <div class="topbar-right">
        <Button
          variant="ghost"
          size="sm"
          class="topbar-search-hint"
          title="搜索笔记 (Ctrl+K)"
          aria-label="打开搜索面板"
          @click="$emit('open-palette')"
        >
          <template #icon-left>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </template>
          <span class="topbar-kbd">Ctrl+K</span>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          class="topbar-btn--export"
          title="导出笔记"
          aria-label="导出笔记"
          @click="$emit('open-export')"
        >
          <template #icon-left>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </template>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          class="topbar-btn--share"
          title="分享笔记"
          aria-label="分享笔记"
          @click="$emit('open-share')"
        >
          <template #icon-left>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
          </template>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          class="topbar-btn--theme"
          title="切换明暗主题"
          aria-label="切换明暗主题"
          @click="$emit('toggle-theme')"
        >
          <template #icon-left>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          </template>
        </Button>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import Button from '@/components/common/Button.vue';

defineProps<{
  noteTitle: string;
  notebookName: string;
}>();

defineEmits<{
  'toggle-left-wing': [];
  'open-palette': [];
  'open-export': [];
  'open-share': [];
  'toggle-theme': [];
}>();
</script>

<style scoped>
/* ============================================================
 * Root — Sticky Container with Frosted Glass
 * ============================================================ */
.topbar {
  position: sticky;
  top: 0;
  z-index: var(--z-overlay);
  height: var(--topbar-height);
  flex-shrink: 0;
  backdrop-filter: blur(12px);
  animation: topbar-enter var(--dur-palette) var(--ease-fold) forwards;
}

.topbar::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  background: color-mix(in oklch, var(--paper-surface) 88%, transparent);
}

.topbar::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: var(--border-thin);
  background: var(--rule);
  z-index: 0;
}

@keyframes topbar-enter {
  from {
    transform: translateY(-100%);
    opacity: 0;
  }

  to {
    transform: translateY(0);
    opacity: 1;
  }
}

/* ============================================================
 * Inner — 680px Centered Content Area
 * ============================================================ */
.topbar-inner {
  position: relative;
  z-index: 1;
  max-width: var(--editor-max-width);
  margin: 0 auto;
  height: 100%;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 0 var(--space-16);
}

/* ============================================================
 * Left Zone
 * ============================================================ */
.topbar-left {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  min-width: 0;
}

.topbar-notebook {
  font-size: var(--text-xs);
  color: var(--ink-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
  user-select: none;
}

/* ============================================================
 * Center Zone
 * ============================================================ */
.topbar-center {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  padding: 0 var(--space-12);
}

.topbar-title {
  font-size: var(--text-sm);
  font-weight: var(--fw-medium);
  color: var(--ink-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 320px;
}

.topbar-title--untitled {
  color: var(--ink-muted);
  font-style: italic;
}

/* ============================================================
 * Right Zone
 * ============================================================ */
.topbar-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-4);
  min-width: 0;
}

/* ============================================================
 * Search Hint — inline kbd label
 * ============================================================ */
.topbar-search-hint {
  width: auto;
  padding: 0 var(--space-8);
}

.topbar-kbd {
  font-family: var(--ff-mono);
  font-size: var(--text-xs);
  color: var(--ink-muted);
  line-height: var(--lh-none);
  white-space: nowrap;
}

.topbar-search-hint:hover .topbar-kbd {
  color: var(--ink-secondary);
}

/* ============================================================
 * Touch — Larger tap targets on coarse pointers
 * ============================================================ */
@media (pointer: coarse) {
  .topbar-btn--menu,
  .topbar-btn--export,
  .topbar-btn--share,
  .topbar-btn--theme {
    width: 36px !important;
    height: 36px !important;
  }

  .topbar-search-hint {
    padding: 0 var(--space-12);
  }
}

@media (width <= 560px) {
  .topbar-inner {
    grid-template-columns: auto minmax(0, 1fr) auto;
    padding: 0 var(--space-8);
  }

  .topbar-notebook,
  .topbar-kbd {
    display: none;
  }

  .topbar-center {
    padding: 0 var(--space-6);
  }

  .topbar-title {
    max-width: 100%;
  }

  .topbar-right {
    gap: 0;
  }

  .topbar-search-hint {
    width: 32px !important;
    padding: 0 !important;
  }
}

/* ============================================================
 * Reduced Motion
 * ============================================================ */
@media (prefers-reduced-motion: reduce) {
  .topbar {
    animation: none;
  }
}
</style>
