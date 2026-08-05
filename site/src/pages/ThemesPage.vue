<script setup lang="ts">
import { useLocale } from '../composables/useLocale';
import { usePageHead } from '../composables/usePageHead';
import PaperPreview from '../components/themes/PaperPreview.vue';
import HaloCanvasPreview from '../components/themes/HaloCanvasPreview.vue';
import LumenFieldPreview from '../components/themes/LumenFieldPreview.vue';

const { content } = useLocale();
usePageHead('themes');
const t = () => content.value.themes;
const preview = () => content.value.themePreview;
</script>

<template>
  <article class="themes-page page-flow">
    <header class="page-head">
      <p class="head-eyebrow tech-rail">{{ t().eyebrow }}</p>
      <h1>{{ t().title }}</h1>
      <p class="head-lead">{{ t().lead }}</p>
    </header>

    <!-- 三款主题的 1:1 SVG 重绘：界面词与示例笔记内容随页面语言 -->
    <section class="theme-gallery" aria-label="themes">
      <figure v-for="(item, i) in t().items" :key="item.id" :data-theme="item.id">
        <span class="annotation-num" aria-hidden="true">{{ String(i + 1).padStart(2, '0') }}</span>
        <div class="theme-frame">
          <PaperPreview
            v-if="item.id === 'paper'"
            :ui="preview().ui"
            :note="preview().sampleNote"
          />
          <HaloCanvasPreview
            v-else-if="item.id === 'halo-canvas'"
            :ui="preview().ui"
            :note="preview().sampleNote"
            :frame="preview().haloNote"
          />
          <LumenFieldPreview v-else :ui="preview().ui" :note="preview().sampleNote" />
        </div>
        <figcaption>
          <h2>{{ item.name }}</h2>
          <p>{{ item.blurb }}</p>
        </figcaption>
      </figure>
    </section>

    <section class="blueprint" aria-labelledby="bp-title">
      <h2 id="bp-title">{{ t().blueprintTitle }}</h2>
      <p>{{ t().blueprintBody }}</p>
      <p class="marketplace-note quip">{{ t().marketplaceNote }}</p>
    </section>
  </article>
</template>

<style scoped>
.themes-page {
  padding-bottom: 120px;
}

/* ---------- 编号画廊：交错偏移的连续展墙，不是网格卡片 ---------- */
.theme-gallery {
  display: grid;
  gap: clamp(64px, 9vw, 120px);
}
figure {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
figure:nth-child(even) {
  margin-left: clamp(0px, 5vw, 72px);
}
figure:nth-child(odd) {
  margin-right: clamp(0px, 5vw, 72px);
}
.annotation-num {
  margin-top: clamp(60px, 10vw, 150px);
}
.theme-frame {
  border: 1px solid var(--ink-14);
  border-radius: var(--r-sheet, 10px);
  overflow: hidden;
  box-shadow: var(--shadow-sheet, 0 2px 6px rgb(0 0 0 / 0.05));
}
figcaption {
  grid-column: 2;
  display: flex;
  align-items: baseline;
  gap: 18px;
  flex-wrap: wrap;
  margin-top: 18px;
}
figcaption h2 {
  font-size: clamp(1.25rem, 2vw, 1.625rem);
  font-weight: 600;
  letter-spacing: -0.015em;
}
figcaption p {
  color: var(--ink-70);
  max-width: 34em;
}

/* ---------- 主题系统说明 ---------- */
.blueprint {
  margin-top: clamp(72px, 10vw, 128px);
  padding-top: clamp(32px, 4vw, 48px);
  border-top: 1px solid var(--ink-14);
}
.blueprint h2 {
  font-size: clamp(1.375rem, 2.2vw, 1.75rem);
  font-weight: 600;
  letter-spacing: -0.015em;
}
.blueprint > p {
  margin-top: 14px;
  max-width: 42em;
  color: var(--ink-70);
}
.marketplace-note {
  margin-top: 20px;
}

@media (max-width: 720px) {
  figure {
    grid-template-columns: minmax(0, 1fr);
  }
  .annotation-num {
    margin-top: 0;
  }
  figcaption {
    grid-column: 1;
  }
}
</style>
