<template>
  <div class="app-layout" :class="{ 'app-layout--mobile': isMobile }">
    <!-- Left file sidebar — paper stack on the left -->
    <aside v-if="!isMobile || showMobileSidebar" class="app-layout__left">
      <slot name="left-sidebar" />
    </aside>

    <!-- Center editor — the main sheet of paper -->
    <main class="app-layout__center">
      <slot name="editor">
        <div class="app-layout__empty">
          <p>选择一条笔记开始编辑</p>
        </div>
      </slot>
    </main>

    <!-- Right navigation panel — paper stack on the right -->
    <aside v-if="!isMobile && showRightSidebar" class="app-layout__right">
      <slot name="right-sidebar">
        <div class="app-layout__empty">
          <p>导航面板</p>
        </div>
      </slot>
    </aside>

    <!-- Mobile overlay -->
    <div
      v-if="isMobile && showMobileSidebar"
      class="app-layout__overlay"
      @click="showMobileSidebar = false"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * AppLayout.vue — 纸面三栏布局容器
 *
 * Paper metaphor: three sheets side by side.
 * - Center: the main sheet (brightest, highest contrast)
 * - Left/Right: stacked sheets (slightly subdued)
 * - Zones separated by 1px hairline rules, not colored panels
 * - No zone color temperature — all paper shares the same hue
 *
 * Desktop: 260px | 1fr | 240px grid
 * Mobile: single column + drawer overlay
 */
import { ref } from 'vue';

const showRightSidebar = ref(true);
const showMobileSidebar = ref(false);
const isMobile = ref(false);

if (typeof window !== 'undefined') {
  const mq = window.matchMedia('(max-width: 767px)');
  isMobile.value = mq.matches;
  mq.addEventListener('change', (e) => {
    isMobile.value = e.matches;
  });
}
</script>

<style scoped>
.app-layout {
  display: grid;
  grid-template-columns: var(--sidebar-width) 1fr var(--navtree-width);
  height: 100vh;
  overflow: hidden;
  background: var(--paper-bg);
}

.app-layout--mobile {
  grid-template-columns: 1fr;
}

/* --- Left panel: stacked sheet --- */
.app-layout__left {
  overflow-y: auto;
  background: var(--paper-bg);
  border-right: var(--border-thin) solid var(--rule);
}

/* --- Center editor: the main sheet (brightest) --- */
.app-layout__center {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--editor-bg);
}

/* --- Right panel: stacked sheet --- */
.app-layout__right {
  overflow-y: auto;
  background: var(--paper-bg);
  border-left: var(--border-thin) solid var(--rule);
}

/* --- Empty state --- */
.app-layout__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--ink-muted);
  font-size: var(--text-base);
  font-style: italic;
}

/* --- Mobile overlay --- */
.app-layout__overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  z-index: calc(var(--z-overlay) - 1);
}
</style>
