<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import SvgInlineText from './SvgInlineText.vue';
import { wrapText } from '../../lib/inline-marks';
import type { ThemePreviewUi, ThemeSampleNote } from '../../content/types';

/**
 * Lumen Field 主题 1:1 SVG 重绘（参照官方预览 lumen-field-preview.webp，1280×800）。
 * 暗色专注场域：居中文字列 + 三向发光手柄 + 单引文条，无 chrome。
 * 入场一次性（is-in）：三向手柄辉光依次点亮 → 引文条滑入；reduced-motion 直接呈终态。
 */
const props = defineProps<{ ui: ThemePreviewUi; note: ThemeSampleNote }>();

/** 入视口一次性触发 is-in；无 IO 时立即呈终态 */
const rootEl = ref<SVGSVGElement | null>(null);
onMounted(() => {
  const el = rootEl.value;
  if (!el) return;
  if (!('IntersectionObserver' in window)) {
    el.classList.add('is-in');
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.35 },
  );
  io.observe(el);
});

const introLines = computed(() => wrapText(props.note.intro, 100));
const sectionY = computed(() => 258 + (introLines.value.length - 1) * 20);
const bulletY = (i: number) => sectionY.value + 58 + i * 22;
const quoteBarY = computed(() => bulletY(props.note.bullets.length - 1) + 22);
</script>

<template>
  <svg
    ref="rootEl"
    class="lumen-preview"
    viewBox="0 0 1280 800"
    role="img"
    :aria-label="note.title"
    preserveAspectRatio="xMidYMid meet"
  >
    <defs>
      <radialGradient id="lumen-vignette" cx="50%" cy="45%" r="78%">
        <stop offset="0%" stop-color="#171423" />
        <stop offset="100%" stop-color="#0d0b14" />
      </radialGradient>
    </defs>

    <rect width="1280" height="800" fill="url(#lumen-vignette)" />

    <!-- 文字列 -->
    <text x="305" y="158" class="lf-h1">{{ note.title }}</text>
    <text v-for="(line, i) in introLines" :key="line" x="305" :y="197 + i * 20" class="lf-body">
      {{ line }}
    </text>
    <text x="305" :y="sectionY" class="lf-h2">{{ note.section }}</text>
    <g v-for="(b, i) in note.bullets" :key="b">
      <text x="305" :y="bulletY(i)" class="lf-body">·</text>
      <SvgInlineText :x="320" :y="bulletY(i)" :src="b" class="lf-body" />
    </g>

    <!-- 引文条 -->
    <rect
      x="300"
      :y="quoteBarY"
      width="680"
      height="26"
      rx="2"
      class="lf-quote-bar"
      style="transition-delay: 620ms"
    />
    <text x="314" :y="quoteBarY + 18" class="lf-quote" style="transition-delay: 700ms">
      › {{ note.quoteLine }}
    </text>

    <!-- 三向发光手柄（辉光依次点亮：左 → 右 → 下） -->
    <rect x="8" y="360" width="10" height="80" rx="5" class="lf-handle" />
    <rect
      x="12"
      y="382"
      width="2"
      height="36"
      rx="1"
      class="lf-handle-glow"
      style="transition-delay: 200ms"
    />
    <rect x="1262" y="360" width="10" height="80" rx="5" class="lf-handle" />
    <rect
      x="1266"
      y="382"
      width="2"
      height="36"
      rx="1"
      class="lf-handle-glow"
      style="transition-delay: 350ms"
    />
    <rect x="595" y="766" width="90" height="26" rx="12" class="lf-handle" />
    <rect
      x="622"
      y="778"
      width="36"
      height="2"
      rx="1"
      class="lf-handle-glow"
      style="transition-delay: 500ms"
    />

    <!-- 语法 pill -->
    <rect x="1196" y="712" width="62" height="26" rx="10" class="lf-pill" />
    <text x="1227" y="729" text-anchor="middle" class="lf-pill-text">{{ ui.syntax }}</text>
  </svg>
</template>

<style scoped>
.lumen-preview {
  display: block;
  width: 100%;
  height: auto;
  font-family: var(--font-body);
  /* 行内标记着色变量：暗场哑红链、赭橙标签 */
  --mk-wiki-fill: #b65156;
  --mk-wiki-deco-color: #7c3a3e;
  --mk-tag-fill: #c07a3a;
}
.lumen-preview text {
  fill: #c8bfb6;
}
.lf-h1 {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.01em;
  fill: #e6d9bd !important;
}
.lf-h2 {
  font-size: 18px;
  font-weight: 700;
  fill: #ddd0b8 !important;
}
.lf-body {
  font-size: 14px;
}
.lf-quote-bar {
  fill: #1a1c2b;
}
.lf-quote {
  font-size: 13px;
  fill: #9a93a8 !important;
}
.lf-handle {
  fill: #141925;
  stroke: #232a3d;
}
.lf-handle-glow {
  fill: #54bfcf;
}
.lf-pill {
  fill: #0d1420;
  stroke: #1c2433;
}
.lf-pill-text {
  font-size: 12px;
  fill: #5f7c8a !important;
}
</style>

<!-- 入场门控与 is-in 触发：html.js 祖先选择器必须非 scoped（scoped 内 :global 会丢后代选择器） -->
<style>
/* 三向辉光依次点亮 → 引文条自左滑入（opacity+transform，单项 <400ms）；无 JS 静态可见 */
html.js .lumen-preview .lf-handle-glow {
  opacity: 0;
  transition: opacity var(--dur-spatial) ease-out;
}
html.js .lumen-preview.is-in .lf-handle-glow {
  opacity: 1;
}
html.js .lumen-preview .lf-quote-bar {
  opacity: 0;
  transform: translateX(-10px);
  transform-box: fill-box;
  transition:
    opacity var(--dur-narrative) ease-out,
    transform var(--dur-narrative) var(--ease-press);
}
html.js .lumen-preview .lf-quote {
  opacity: 0;
  transition: opacity var(--dur-narrative) ease-out;
}
html.js .lumen-preview.is-in .lf-quote-bar,
html.js .lumen-preview.is-in .lf-quote {
  opacity: 1;
  transform: none;
}
/* reduced-motion：不依赖滚动触发，直接呈终态（截图链路即 reducedMotion 环境） */
@media (prefers-reduced-motion: reduce) {
  html.js .lumen-preview .lf-handle-glow,
  html.js .lumen-preview .lf-quote-bar,
  html.js .lumen-preview .lf-quote {
    opacity: 1;
    transform: none;
    transition-delay: 0ms !important;
  }
}
</style>
