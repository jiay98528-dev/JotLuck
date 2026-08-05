<script setup lang="ts">
/**
 * 叙事段配图：四幅手绘印刷感 inline SVG（契约色、无渐变、确定性角度）。
 * 每幅一个入场微动画，由父级 .act.is-in 触发（IntersectionObserver，一次性）：
 *  file=字行生长 / link=弧线描画 / flow=提示签浮起 / export=三支路径描画。
 * 纯装饰：文案已完整表达事实，整图 aria-hidden。
 */
defineProps<{ id: string }>();
</script>

<template>
  <figure class="act-fig" aria-hidden="true">
    <!-- 01 一份文件：单页 + 折角 + 字行 -->
    <svg v-if="id === 'file'" viewBox="0 0 240 180" fill="none">
      <g transform="rotate(2.5 120 90)">
        <rect
          x="62"
          y="30"
          width="126"
          height="138"
          rx="10"
          fill="var(--paper)"
          stroke="var(--ink-14)"
          stroke-width="1.5"
        />
      </g>
      <g transform="rotate(-2 120 90)">
        <rect
          x="56"
          y="24"
          width="126"
          height="138"
          rx="10"
          fill="var(--paper)"
          stroke="var(--ink-30)"
          stroke-width="1.5"
        />
        <path d="M156 24 l26 0 0 26 z" fill="var(--bookmark)" />
        <rect class="fig-line" x="74" y="56" width="10" height="10" rx="2" fill="var(--orange)" />
        <rect class="fig-line l1" x="92" y="58" width="72" height="6" rx="3" fill="var(--ink-14)" />
        <rect class="fig-line l2" x="74" y="82" width="92" height="6" rx="3" fill="var(--ink-14)" />
        <rect
          class="fig-line l3"
          x="74"
          y="104"
          width="80"
          height="6"
          rx="3"
          fill="var(--ink-14)"
        />
        <rect
          class="fig-line l4"
          x="74"
          y="126"
          width="52"
          height="6"
          rx="3"
          fill="var(--ink-14)"
        />
      </g>
    </svg>

    <!-- 02 彼此相连：两页 + 双向弧 -->
    <svg v-else-if="id === 'link'" viewBox="0 0 240 180" fill="none">
      <g transform="rotate(-3 70 95)">
        <rect
          x="28"
          y="40"
          width="84"
          height="110"
          rx="8"
          fill="var(--paper)"
          stroke="var(--ink-30)"
          stroke-width="1.5"
        />
        <rect x="42" y="62" width="56" height="5" rx="2.5" fill="var(--ink-14)" />
        <rect x="42" y="80" width="48" height="5" rx="2.5" fill="var(--ink-14)" />
        <rect x="42" y="98" width="52" height="5" rx="2.5" fill="var(--ink-14)" />
      </g>
      <g transform="rotate(2 170 85)">
        <rect
          x="128"
          y="30"
          width="84"
          height="110"
          rx="8"
          fill="var(--paper)"
          stroke="var(--ink-30)"
          stroke-width="1.5"
        />
        <rect x="142" y="52" width="56" height="5" rx="2.5" fill="var(--ink-14)" />
        <rect x="142" y="70" width="44" height="5" rx="2.5" fill="var(--ink-14)" />
      </g>
      <path
        class="fig-arc"
        d="M112 78 C 122 52, 126 50, 132 62"
        pathLength="1"
        stroke="var(--teal)"
        stroke-width="2"
        stroke-linecap="round"
        stroke-dasharray="1"
      />
      <path
        class="fig-arc a2"
        d="M128 108 C 122 128, 116 128, 110 116"
        pathLength="1"
        stroke="var(--teal)"
        stroke-width="2"
        stroke-linecap="round"
        stroke-dasharray="1"
      />
      <circle cx="112" cy="78" r="4" fill="var(--orange)" />
      <circle cx="128" cy="108" r="4" fill="var(--orange)" />
    </svg>

    <!-- 03 不打断下一句：字行 + 光标 + 浮起提示签 -->
    <svg v-else-if="id === 'flow'" viewBox="0 0 240 180" fill="none">
      <rect x="30" y="56" width="180" height="6" rx="3" fill="var(--ink-14)" />
      <rect x="30" y="80" width="148" height="6" rx="3" fill="var(--ink-14)" />
      <rect x="30" y="104" width="96" height="6" rx="3" fill="var(--ink-14)" />
      <rect x="132" y="98" width="3" height="18" rx="1.5" fill="var(--teal)" />
      <g class="fig-chip" transform="rotate(-1.5 160 34)">
        <rect x="112" y="20" width="88" height="26" rx="7" fill="var(--bookmark)" />
        <rect x="122" y="30" width="44" height="5" rx="2.5" fill="var(--ink-30)" />
        <rect x="172" y="30" width="16" height="5" rx="2.5" fill="var(--orange)" />
        <path d="M142 46 l8 10 4 -10 z" fill="var(--bookmark)" />
      </g>
    </svg>

    <!-- 04 路还很长：一页分叉三条路径 -->
    <svg v-else-if="id === 'export'" viewBox="0 0 240 180" fill="none">
      <g transform="rotate(-2 65 95)">
        <rect
          x="26"
          y="45"
          width="78"
          height="100"
          rx="8"
          fill="var(--paper)"
          stroke="var(--ink-30)"
          stroke-width="1.5"
        />
        <rect x="38" y="66" width="52" height="5" rx="2.5" fill="var(--ink-14)" />
        <rect x="38" y="84" width="44" height="5" rx="2.5" fill="var(--ink-14)" />
        <rect x="38" y="102" width="48" height="5" rx="2.5" fill="var(--ink-14)" />
      </g>
      <path
        class="fig-arc"
        d="M106 72 C 130 72, 132 46, 154 46"
        pathLength="1"
        stroke="var(--ink-50)"
        stroke-width="1.5"
        stroke-dasharray="1"
        stroke-linecap="round"
      />
      <path
        class="fig-arc a2"
        d="M106 95 L 154 95"
        pathLength="1"
        stroke="var(--ink-50)"
        stroke-width="1.5"
        stroke-dasharray="1"
        stroke-linecap="round"
      />
      <path
        class="fig-arc a3"
        d="M106 118 C 130 118, 132 144, 154 144"
        pathLength="1"
        stroke="var(--ink-50)"
        stroke-width="1.5"
        stroke-dasharray="1"
        stroke-linecap="round"
      />
      <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-70)">
        <rect
          x="156"
          y="34"
          width="58"
          height="24"
          rx="6"
          fill="var(--paper)"
          stroke="var(--ink-30)"
          stroke-width="1.5"
        />
        <text x="185" y="50" text-anchor="middle">PDF</text>
        <rect
          x="156"
          y="83"
          width="58"
          height="24"
          rx="6"
          fill="var(--paper)"
          stroke="var(--ink-30)"
          stroke-width="1.5"
        />
        <text x="185" y="99" text-anchor="middle">DOCX</text>
        <rect
          x="156"
          y="132"
          width="58"
          height="24"
          rx="6"
          fill="var(--paper)"
          stroke="var(--ink-30)"
          stroke-width="1.5"
        />
        <text x="185" y="148" text-anchor="middle">HTML</text>
      </g>
    </svg>
  </figure>
</template>

<style scoped>
.act-fig {
  max-width: 240px;
  width: 100%;
}
.act-fig svg {
  width: 100%;
  height: auto;
  overflow: visible;
}

/* ---------- 入场微动画基态（is-in 触发态见下方非 scoped 块） ---------- */
/* file：字行自左生长 */
.fig-line {
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform var(--dur-spatial) var(--ease-press);
}
/* link / export：路径描画 */
.fig-arc {
  stroke-dashoffset: 1;
  transition: stroke-dashoffset var(--dur-spatial) ease-out;
}
/* flow：提示签浮起 */
.fig-chip {
  opacity: 0;
  transform: translateY(8px) rotate(-1.5deg);
  transition:
    opacity var(--dur-release) ease-out 120ms,
    transform var(--dur-spatial) var(--ease-press) 120ms;
}
</style>

<!-- is-in 触发与无 JS 兜底：父级 .act 选择器必须非 scoped -->
<style>
.act.is-in .fig-line {
  transform: scaleX(1);
}
.act.is-in .fig-line.l1 {
  transition-delay: 60ms;
}
.act.is-in .fig-line.l2 {
  transition-delay: 120ms;
}
.act.is-in .fig-line.l3 {
  transition-delay: 180ms;
}
.act.is-in .fig-line.l4 {
  transition-delay: 240ms;
}
.act.is-in .fig-arc {
  stroke-dashoffset: 0;
}
.act.is-in .fig-arc.a2 {
  transition-delay: 120ms;
}
.act.is-in .fig-arc.a3 {
  transition-delay: 240ms;
}
.act.is-in .fig-chip {
  opacity: 1;
  transform: translateY(0) rotate(-1.5deg);
}
/* 无 JS：直接呈现终态（reduced-motion 由全局规则把过渡压成瞬时） */
html:not(.js) .fig-line,
html:not(.js) .fig-arc,
html:not(.js) .fig-chip {
  transform: none;
  opacity: 1;
  stroke-dashoffset: 0;
}
/* reduced-motion：不依赖滚动触发，直接终态静态呈现 */
@media (prefers-reduced-motion: reduce) {
  html.js .fig-line,
  html.js .fig-arc,
  html.js .fig-chip {
    transform: none;
    opacity: 1;
    stroke-dashoffset: 0;
  }
}
</style>
