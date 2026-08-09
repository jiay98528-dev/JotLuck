<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { parseInlineMarks } from '../../lib/inline-marks';

/**
 * SVG 行内混排文本：[[wikilink]] 与 #tag 渲染为着色 tspan（语法符号 [[]]/# 隐藏）。
 * 着色由本组件 scoped 样式 + CSS 变量驱动：宿主主题组件在自己的根类上定义
 * --mk-body-fill / --mk-body-size / --mk-wiki-fill / --mk-wiki-deco-color /
 * --mk-tag-fill（自定义属性可跨组件边界继承，scoped CSS 无法穿透子组件；
 * 本组件为多根节点，外部传入的 class 不会落到内部 <text>，正文 fill/字号必须走变量）。
 * wikilink 下划线为实测手画 <line>：Chrome 对 SVG tspan 的 text-decoration
 * 会泄漏渲染到无关文本行且位置错位（2026-08-05 探针实证），不可用。
 */
const props = defineProps<{
  x: number;
  y: number;
  src: string;
}>();

const segments = computed(() => parseInlineMarks(props.src));

const textEl = ref<SVGTextElement>();
const wikiLines = ref<{ x1: number; x2: number }[]>([]);

/** 逐 tspan 实测宽度，给 wiki 段生成下划线几何；SSG/jsdom 无测量 API 时跳过（降级为纯着色） */
function measure() {
  const el = textEl.value;
  if (!el || typeof el.getComputedTextLength !== 'function') return;
  const tspans = Array.from(el.querySelectorAll('tspan'));
  const lines: { x1: number; x2: number }[] = [];
  let offset = 0;
  tspans.forEach((s, i) => {
    const len = s.getComputedTextLength();
    if (segments.value[i]?.kind === 'wiki') {
      lines.push({ x1: props.x + offset, x2: props.x + offset + len });
    }
    offset += len;
  });
  wikiLines.value = lines;
}

onMounted(() => {
  measure();
  // webfont 就绪后字宽会变，复测一次
  document.fonts?.ready.then(measure);
});
</script>

<template>
  <text ref="textEl" :x="x" :y="y" class="mk-body">
    <template v-for="(seg, i) in segments" :key="i">
      <tspan v-if="seg.kind === 'text'">{{ seg.text }}</tspan>
      <tspan v-else :class="seg.kind === 'wiki' ? 'mk-wiki' : 'mk-tag'">{{ seg.text }}</tspan>
    </template>
  </text>
  <line
    v-for="(l, i) in wikiLines"
    :key="`u${i}`"
    :x1="l.x1"
    :y1="y + 2.5"
    :x2="l.x2"
    :y2="y + 2.5"
    class="mk-wiki-line"
  />
</template>

<style scoped>
/* 颜色/字号来自宿主根类上的 --mk-* 变量（见头注）；!important 覆盖宿主 text 通配 fill */
.mk-body {
  fill: var(--mk-body-fill, #333);
  font-size: var(--mk-body-size, 14px);
}
.mk-wiki {
  fill: var(--mk-wiki-fill, #6379a0) !important;
}
.mk-tag {
  fill: var(--mk-tag-fill, #6379a0) !important;
}
.mk-wiki-line {
  stroke: var(--mk-wiki-deco-color, #b8c6e8);
  stroke-width: 1;
}
</style>
