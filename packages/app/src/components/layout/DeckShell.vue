<template>
  <div class="deck-shell">
    <div v-if="$slots.top" class="deck-shell__top">
      <slot name="top" />
    </div>
    <div v-if="$slots.left" class="deck-shell__left">
      <slot name="left" />
    </div>
    <div class="deck-shell__main">
      <slot name="main" />
    </div>
    <div v-if="$slots.right" class="deck-shell__right">
      <slot name="right" />
    </div>
    <div v-if="$slots.bottom" class="deck-shell__bottom">
      <slot name="bottom" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * DeckShell.vue — deck 布局预设的通用壳容器
 *
 * 与 winged 的结构差异：顶栏与底栏贯通整个窗口宽度，
 * 左右翼收缩为中间行的面板区域：
 *
 *   ┌────────────── top (full width) ──────────────┐
 *   │ left │            main             │ right  │
 *   └──────────── bottom (full width) ─────────────┘
 *
 * 壳只负责几何排布与高度传递；材质与配色由主题 scoped CSS 承担。
 * 滚动合同：main 区域内部的 .editor-scroll / reader-workbench 仍归宿主所有。
 */
defineOptions({ name: 'DeckShell' });
</script>

<style scoped>
.deck-shell {
  position: relative;
  isolation: isolate;
  display: grid;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  grid-template:
    'top top top' auto
    'left main right' minmax(0, 1fr)
    'bottom bottom bottom' auto
    / auto minmax(0, 1fr) auto;
  background: var(--paper-bg);
  color: var(--ink-primary);
}

.deck-shell__top {
  grid-area: top;
  position: relative;
  z-index: 3;
  min-width: 0;
}

.deck-shell__left {
  grid-area: left;
  position: relative;
  z-index: 2;
  display: flex;
  min-width: 0;
  min-height: 0;
}

.deck-shell__main {
  grid-area: main;
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

/* 列向 flex 子项的自动最小高度会等于内容高度；必须显式归零，
   否则长文档会撑高整个中间行而不是在编辑器内部滚动。 */
.deck-shell__main > * {
  min-height: 0;
}

.deck-shell__right {
  grid-area: right;
  position: relative;
  z-index: 2;
  display: flex;
  min-width: 0;
  min-height: 0;
}

.deck-shell__bottom {
  grid-area: bottom;
  position: relative;
  z-index: 3;
  min-width: 0;
}

@media (width <= 900px) {
  .deck-shell__right {
    display: none;
  }
}

@media (width <= 480px) {
  .deck-shell__left {
    display: none;
  }
}
</style>
