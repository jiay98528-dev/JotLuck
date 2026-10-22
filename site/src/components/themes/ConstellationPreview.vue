<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import SvgInlineText from './SvgInlineText.vue';
import { wrapText } from '../../lib/inline-marks';
import type { ThemePreviewUi, ThemeSampleNote } from '../../content/types';

/**
 * Constellation 群星主题 1:1 SVG 重绘（参照官方预览 constellation-preview.webp，1280×800）。
 * NASA 朋克任务甲板：全宽指挥栏（顶）+ 遥测栏（底）+ 三列仪表面板，编辑区是蚀刻进
 * 甲板的屏幕井；星点为背光指示灯色（冰蓝/钢蓝灰/国际橙），大柔光斑透过磨砂面板渗出。
 * 色值与 packages/app/src/themes/constellation/tokens.ts 同源（oklch 原值）。
 * 入场一次性（is-in）：面板依次浮起（同 app constellation-panel-enter）→ 状态灯点亮；
 * reduced-motion 直接呈终态。
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

/* ---------- 星点静态重绘：固定种子 PRNG（mulberry32，与 app starfield.ts 同法），SSG 可复现 ---------- */
interface Star {
  x: number;
  y: number;
  r: number;
  opacity: number;
  fill: string;
}

/** 冰蓝 60% / 钢蓝灰 25% / 国际橙 15%（starfield.ts STAR_* 同源 rgb） */
function starColor(pick: number): string {
  if (pick < 0.6) return '#7C96CD';
  if (pick < 0.85) return '#8F98AC';
  return '#EE6028';
}

const STARS: Star[] = (() => {
  let a = 0xc057e111; // 与 app starfield buildStars 同种子，布局每次一致
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const stars: Star[] = [];
  for (let i = 0; i < 132; i++) {
    const blob = i % 12 === 7; // ≈8% 大柔光斑：磨砂面板后仍读得出「渗光」
    const pick = rng();
    stars.push({
      x: rng() * 1280,
      y: rng() * 800,
      r: blob ? 5 + rng() * 4 : 1.1 + rng() * 1.5,
      opacity: blob ? 0.14 + rng() * 0.08 : 0.45 + rng() * 0.35,
      fill: starColor(pick),
    });
  }
  return stars;
})();

/* ---------- 编辑区文档流：intro/quote 行随语言长度换行 ---------- */
const introLines = computed(() => wrapText(props.note.intro, 90));
const sectionY = computed(() => 204 + (introLines.value.length - 1) * 22);
const bulletY = (i: number) => sectionY.value + 44 + i * 24;
const quoteY = computed(() => bulletY(props.note.bullets.length - 1) + 46);

/** 左导航 ghost 文件行（激活文件之外的占位，宽度错落） */
const GHOST_ROWS: Array<[number, number]> = [
  [162, 148],
  [186, 118],
  [210, 160],
  [234, 96],
];
</script>

<template>
  <svg
    ref="rootEl"
    class="constellation-preview"
    viewBox="0 0 1280 800"
    role="img"
    :aria-label="note.title"
    preserveAspectRatio="xMidYMid meet"
  >
    <!-- 舱体底 + 星点（背光指示灯色；大柔光斑在面板之下透出） -->
    <rect width="1280" height="800" class="cn-hull" />
    <g class="cn-stars">
      <circle
        v-for="(s, i) in STARS"
        :key="i"
        :cx="s.x"
        :cy="s.y"
        :r="s.r"
        :fill="s.fill"
        :opacity="s.opacity"
      />
    </g>

    <!-- 指挥栏：甲板条色块 + 发丝下缘；国际橙任务印记 + 搜索井 + 三枚平键 -->
    <g class="cn-panel" style="transition-delay: 0ms">
      <rect x="0" y="0" width="1280" height="56" class="cn-deck-bar" />
      <line x1="0" y1="56" x2="1280" y2="56" class="cn-deck-edge" />
      <rect x="24" y="23" width="10" height="10" rx="2" class="cn-accent-mark" />
      <text x="44" y="33" class="cn-title">{{ note.title }}</text>
      <rect x="460" y="12" width="360" height="32" rx="4" class="cn-search-well" />
      <circle cx="478" cy="24" r="4" class="cn-icon-ghost" />
      <line x1="481" y1="27" x2="484" y2="30" class="cn-icon-line" />
      <text x="492" y="33" class="cn-telemetry">{{ ui.searchShortcut }}</text>
      <rect x="1148" y="12" width="32" height="32" rx="4" class="cn-key" />
      <circle cx="1164" cy="28" r="5" class="cn-icon-ghost" />
      <rect x="1188" y="12" width="32" height="32" rx="4" class="cn-key cn-key-active" />
      <line x1="1196" y1="20" x2="1212" y2="20" class="cn-icon-line" />
      <line x1="1196" y1="26" x2="1206" y2="26" class="cn-icon-line" />
      <line x1="1188" y1="42" x2="1220" y2="42" class="cn-key-underline" />
      <rect x="1228" y="12" width="32" height="32" rx="4" class="cn-key" />
      <circle cx="1244" cy="25" r="4" class="cn-icon-ghost" />
      <circle cx="1238" cy="32" r="4" class="cn-icon-ghost" />
      <circle cx="1250" cy="32" r="4" class="cn-icon-ghost" />
    </g>

    <!-- 左导航面板：文件抽屉（激活文件带橙色 inset 下缘） -->
    <g class="cn-panel" style="transition-delay: 60ms">
      <rect x="20" y="68" width="216" height="684" rx="6" class="cn-plate" />
      <text x="36" y="98" class="cn-stencil">{{ ui.recent }}</text>
      <line x1="20" y1="112" x2="236" y2="112" class="cn-rule" />
      <text x="36" y="138" class="cn-file-active">{{ note.title }}</text>
      <rect x="28" y="146" width="22" height="2" class="cn-accent-mark" />
      <rect
        v-for="[y, w] in GHOST_ROWS"
        :key="y"
        x="36"
        :y="y"
        :width="w"
        height="8"
        rx="2"
        class="cn-ghost"
      />
    </g>

    <!-- 编辑区：屏幕井（略亮于舱体），蚀刻进甲板 -->
    <g class="cn-panel" style="transition-delay: 120ms">
      <rect x="252" y="68" width="740" height="684" rx="6" class="cn-well" />
      <text x="296" y="164" class="cn-h1">{{ note.title }}</text>
      <text v-for="(line, i) in introLines" :key="line" x="296" :y="204 + i * 22" class="cn-body">
        {{ line }}
      </text>
      <text x="296" :y="sectionY" class="cn-h2">{{ note.section }}</text>
      <g v-for="(b, i) in note.bullets" :key="b">
        <text x="296" :y="bulletY(i)" class="cn-body">·</text>
        <SvgInlineText :x="312" :y="bulletY(i)" :src="b" />
      </g>
      <rect x="296" :y="quoteY - 12" width="3" height="20" class="cn-quote-rule" />
      <text x="310" :y="quoteY" class="cn-quote">› {{ note.quoteLine }}</text>
    </g>

    <!-- 右图集面板：大纲 / 反链 / 标签三节，发丝刻线分区 -->
    <g class="cn-panel" style="transition-delay: 180ms">
      <rect x="1008" y="68" width="252" height="684" rx="6" class="cn-plate" />
      <text x="1024" y="98" class="cn-stencil">{{ ui.outline }}</text>
      <line x1="1008" y1="112" x2="1260" y2="112" class="cn-rule" />
      <text x="1024" y="138" class="cn-file-active">{{ note.title }}</text>
      <text x="1038" y="162" class="cn-ui">{{ note.section }}</text>
      <rect x="1038" y="184" width="168" height="8" rx="2" class="cn-ghost" />
      <rect x="1038" y="206" width="132" height="8" rx="2" class="cn-ghost" />
      <line x1="1008" y1="236" x2="1260" y2="236" class="cn-rule" />
      <text x="1024" y="262" class="cn-stencil">{{ ui.backlinks }}</text>
      <text x="1244" y="262" text-anchor="end" class="cn-muted">‹</text>
      <rect x="1024" y="278" width="190" height="8" rx="2" class="cn-ghost" />
      <line x1="1008" y1="308" x2="1260" y2="308" class="cn-rule" />
      <text x="1024" y="334" class="cn-stencil">{{ ui.tags }}</text>
      <text x="1134" y="368" text-anchor="middle" class="cn-muted">{{ ui.noTags }}</text>
      <!-- 语法 pill：硬朗小圆角 + 等宽微标签 -->
      <rect x="1188" y="714" width="56" height="24" rx="3" class="cn-pill" />
      <text x="1216" y="730" text-anchor="middle" class="cn-pill-text">{{ ui.syntax }}</text>
    </g>

    <!-- 遥测栏：甲板条 + 等宽读数 + 三枚状态灯（静态小圆点，不呼吸） -->
    <g>
      <rect x="0" y="764" width="1280" height="36" class="cn-deck-bar" />
      <line x1="0" y1="764" x2="1280" y2="764" class="cn-deck-edge" />
      <text x="24" y="787" class="cn-telemetry cn-telemetry-muted">{{ note.statusLeft }}</text>
      <circle
        cx="1108"
        cy="782"
        r="3"
        class="cn-led cn-led-green"
        style="transition-delay: 260ms"
      />
      <circle
        cx="1124"
        cy="782"
        r="3"
        class="cn-led cn-led-amber"
        style="transition-delay: 380ms"
      />
      <circle cx="1140" cy="782" r="3" class="cn-led cn-led-red" style="transition-delay: 500ms" />
      <text x="1156" y="787" class="cn-telemetry">{{ ui.ready }}</text>
    </g>
  </svg>
</template>

<style scoped>
.constellation-preview {
  display: block;
  width: 100%;
  height: auto;
  font-family: var(--font-body);
  /* 行内标记着色变量：冰蓝链接（--link 同源）、钢蓝灰标签 */
  --mk-body-fill: oklch(0.298 0.014 258);
  --mk-wiki-fill: oklch(0.518 0.112 251.5);
  --mk-wiki-deco-color: oklch(0.72 0.09 251.5 / 0.65);
  --mk-tag-fill: oklch(0.552 0.05 250);
}
.constellation-preview text {
  fill: oklch(0.298 0.014 258);
}
/* ── 舱体与甲板条（tokens --paper-bg / --constellation-deck-bar 原值） ── */
.cn-hull {
  fill: oklch(0.925 0.008 95);
}
.cn-deck-bar {
  fill: oklch(0.878 0.007 250);
  fill-opacity: 0.95;
}
.cn-deck-edge {
  stroke: oklch(0.68 0.013 250 / 0.55);
  stroke-width: 1;
}
/* ── 面板：平整哑光平面，仅明暗阶梯 + 发丝刻线分区（无浮雕阴影） ── */
.cn-plate {
  fill: oklch(0.945 0.006 95);
  fill-opacity: 0.92; /* 磨砂舷窗：大柔光斑自面板后渗出 */
  stroke: oklch(0.772 0.012 252 / 0.55);
  stroke-width: 1;
}
.cn-well {
  fill: oklch(0.953 0.006 95);
  fill-opacity: 0.96;
  stroke: oklch(0.772 0.012 252 / 0.55);
  stroke-width: 1;
}
.cn-rule {
  stroke: oklch(0.772 0.012 252 / 0.55);
  stroke-width: 1;
}
/* ── 文本：冷调墨色三阶 ── */
.cn-title {
  font-size: 13px;
  font-weight: 600;
}
.cn-h1 {
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.cn-h2 {
  font-size: 18px;
  font-weight: 700;
}
.cn-body {
  font-size: 14px;
}
.cn-quote {
  font-size: 14px;
  fill: oklch(0.443 0.013 258) !important;
}
.cn-quote-rule {
  fill: oklch(0.623 0.188 46.5 / 0.62); /* tokens --blockquote-rule */
}
.cn-file-active {
  font-size: 13px;
  font-weight: 600;
}
.cn-ui {
  font-size: 13px;
  fill: oklch(0.443 0.013 258) !important;
}
.cn-muted {
  font-size: 12px;
  fill: oklch(0.588 0.011 258) !important;
}
/* 等宽微标签：模板字 letter-spacing（--constellation-stencil-tracking 0.14em） */
.cn-stencil {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.14em;
  fill: oklch(0.588 0.011 258) !important;
}
.cn-telemetry {
  font-family: var(--font-mono);
  font-size: 11px;
  fill: oklch(0.443 0.013 258) !important;
}
.cn-telemetry-muted {
  fill: oklch(0.588 0.011 258) !important;
}
/* ── 指挥栏控件 ── */
.cn-accent-mark {
  fill: oklch(0.623 0.188 46.5); /* 国际橙任务印记 */
}
.cn-search-well {
  fill: oklch(0.945 0.006 95 / 0.72);
  stroke: oklch(0.772 0.012 252 / 0.55);
  stroke-width: 1;
}
.cn-key {
  fill: none;
  stroke: oklch(0.772 0.012 252 / 0.55);
  stroke-width: 1;
}
.cn-key-active {
  stroke: oklch(0.623 0.188 46.5 / 0.42);
}
.cn-key-underline {
  stroke: oklch(0.623 0.188 46.5);
  stroke-width: 2;
}
.cn-icon-ghost {
  fill: none;
  stroke: oklch(0.588 0.011 258);
  stroke-width: 1.2;
}
.cn-icon-line {
  stroke: oklch(0.588 0.011 258);
  stroke-width: 1.2;
  fill: none;
}
.cn-ghost {
  fill: oklch(0.772 0.012 252 / 0.5);
}
/* ── 状态灯（tokens --constellation-led_* 原色，静态不呼吸） ── */
.cn-led-green {
  fill: oklch(0.62 0.15 158.5);
}
.cn-led-amber {
  fill: oklch(0.68 0.15 77.5);
}
.cn-led-red {
  fill: oklch(0.58 0.19 27.5);
}
/* ── 语法 pill：硬朗 3px 小圆角 ── */
.cn-pill {
  fill: oklch(0.955 0.005 95);
  stroke: oklch(0.772 0.012 252 / 0.55);
  stroke-width: 1;
}
.cn-pill-text {
  font-family: var(--font-mono);
  font-size: 11px;
  fill: oklch(0.588 0.011 258) !important;
}
</style>

<!-- 入场门控与 is-in 触发：html.js 祖先选择器必须非 scoped（scoped 内 :global 会丢后代选择器） -->
<style>
/* 面板依次浮起（opacity+translateY 4px→0，同 app constellation-panel-enter 180ms）；
   状态灯随后点亮；无 JS 静态可见 */
html.js .constellation-preview .cn-panel {
  opacity: 0;
  transform: translateY(4px);
  transform-box: fill-box;
  transition:
    opacity 180ms ease-out,
    transform 180ms ease-out;
}
html.js .constellation-preview.is-in .cn-panel {
  opacity: 1;
  transform: none;
}
html.js .constellation-preview .cn-led {
  opacity: 0;
  transition: opacity var(--dur-spatial) ease-out;
}
html.js .constellation-preview.is-in .cn-led {
  opacity: 1;
}
/* reduced-motion：不依赖滚动触发，直接呈终态（截图链路即 reducedMotion 环境） */
@media (prefers-reduced-motion: reduce) {
  html.js .constellation-preview .cn-panel,
  html.js .constellation-preview .cn-led {
    opacity: 1;
    transform: none;
    transition-delay: 0ms !important;
  }
}
</style>
