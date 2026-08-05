<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { pagePath } from '../router';
import PaperPreview from './themes/PaperPreview.vue';
import type { Locale } from '../content';
import type { HeroContent, ThemePreviewContent } from '../content/types';

/**
 * Hero 印刷舞台（Hero Press Stage）。
 * 契约三要素同屏：巨型双字体本地化主句 + 唯一主动作 + 四层倾斜叠纸真实仿真件。
 * 仿真件为 Paper 默认主题 1:1 重摹（PaperPreview demo 模式：逐字键入 → 保存翻牌 → 点击重播）。
 * 橘红印面仅在位图解码完成后显现（data-ink-ready），失败/打印/强制颜色回退纯炭墨。
 * emphasisHighlight（可选）：印面上反白暖白高亮子串，印面未就位时回退套准橙。
 * 字符动画「活字落版」：主句逐字 translateY+微旋转落版，ease-out-expo 强非线性，
 * 26ms 逐字阶梯跨行累计；叠纸三层自摊平状态阶梯扇出（120ms 间隔）。
 */
const props = defineProps<{ locale: Locale; hero: HeroContent; preview: ThemePreviewContent }>();

const inkReady = ref(false);
const inkImg = ref<HTMLImageElement | null>(null);

/** 把强调段按 highlight 子串切成 前/高亮/后 三段；无 highlight 或未命中时 before 为整句 */
const emphasisParts = computed(() => {
  const text = props.hero.emphasis;
  const hl = props.hero.emphasisHighlight;
  if (!hl) return { before: text, hl: '', after: '' };
  const at = text.indexOf(hl);
  if (at < 0) return { before: text, hl: '', after: '' };
  return { before: text.slice(0, at), hl, after: text.slice(at + hl.length) };
});

/** 主句逐字拆分 + 落版阶梯延迟（22ms/字，行间停顿 30ms；Array.from 防代理对拆错） */
const lineChars = computed(() => {
  let base = 60;
  return props.hero.lines.map((line) => {
    const chars = Array.from(line).map((ch, i) => ({ ch, delay: base + i * 22 }));
    base += chars.length * 22 + 30;
    return chars;
  });
});

onMounted(async () => {
  const img = inkImg.value;
  if (!img) return;
  try {
    await img.decode();
    inkReady.value = true;
  } catch {
    inkReady.value = false;
  }
});
</script>

<template>
  <section class="press-stage" :data-ink-ready="inkReady || undefined">
    <div class="stage-copy">
      <p class="eyebrow tech-rail">
        <span class="eyebrow-tick" aria-hidden="true"></span>{{ hero.eyebrow }}
      </p>
      <h1 class="statement">
        <span
          v-for="(chars, li) in lineChars"
          :key="li"
          class="display-line"
          :aria-label="hero.lines[li]"
          ><span
            v-for="(c, ci) in chars"
            :key="ci"
            class="ch"
            aria-hidden="true"
            :style="{ animationDelay: c.delay + 'ms' }"
            >{{ c.ch === ' ' ? ' ' : c.ch }}</span
          ></span
        >
        <span class="emphasis-wrap">
          <img
            ref="inkImg"
            class="ink-ground"
            src="/assets/brand/textures/hero-ink-ground-approved-v1.webp"
            alt=""
            aria-hidden="true"
            draggable="false"
          />
          <!-- 三段必须同行书写：模板空白压缩会在中文句中引入多余空格 -->
          <strong class="emphasis"
            >{{ emphasisParts.before
            }}<span v-if="emphasisParts.hl" class="hl">{{ emphasisParts.hl }}</span
            >{{ emphasisParts.after }}</strong
          >
        </span>
      </h1>
      <p class="subline">{{ hero.subline }}</p>
      <div class="action-row">
        <RouterLink :to="pagePath(locale, 'download')" class="btn btn-cta">{{
          hero.action
        }}</RouterLink>
        <p class="date-note tech-rail">
          {{ hero.dateLine }}<br />
          <span class="quip">{{ hero.dateQuip }}</span>
        </p>
      </div>
    </div>
    <div class="stage-proof">
      <div class="paper-stack">
        <div class="stack-backboard" aria-hidden="true"></div>
        <div class="stack-sheet paper-sheet tex-2 s1" aria-hidden="true"></div>
        <div class="stack-sheet paper-sheet tex-3 s2" aria-hidden="true"></div>
        <div class="stack-sheet paper-sheet tex-4 s3" aria-hidden="true"></div>
        <PaperPreview
          :ui="preview.ui"
          :note="preview.sampleNote"
          :frame="preview.haloNote"
          demo
          class="stack-front"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.press-stage {
  display: grid;
  grid-template-columns: minmax(0, 38%) minmax(0, 1fr);
  gap: clamp(24px, 3.5vw, 56px);
  align-items: center;
  min-height: min(100svh, 980px);
  padding: clamp(24px, 4vw, 72px);
  overflow: hidden;
}

/* ---------- 入场：press-in 阶梯（fonts-ready 门控放行；无 JS 静态可见） ----------
   跨组件/祖先选择器（html.js / html.fonts-ready）必须放在下方非 scoped 块：
   scoped 块内 :global(祖先) 后代 的写法会丢弃后代选择器（2026-08-04 实测回归） */
.stack-front {
  animation: press-in var(--dur-narrative) var(--ease-press) 280ms both;
}

/* ---------- 主句：展示体语气段 + 正文粗体强调段 ---------- */
.eyebrow {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ink-50);
}
.eyebrow-tick {
  width: 14px;
  height: 2px;
  background: var(--orange);
  flex: none;
}
.statement {
  margin-top: 18px;
  font-weight: 400;
}
.display-line {
  display: block;
  font-family: var(--font-display);
  /* 各语言展示体步进不同：拉丁词长、日韩假名/谚文密度高，按 --display-size 逐语言标定 */
  font-size: clamp(3.25rem, var(--display-size, 6vw), 5.5rem);
  line-height: 1.04;
  letter-spacing: -0.02em;
}
html[lang='en'] .press-stage {
  --display-size: 5vw;
}
html[lang='ja'] .press-stage {
  --display-size: 4.6vw;
}
html[lang='ko'] .press-stage {
  --display-size: 4.2vw;
}
html[lang='en'] .display-line,
html[lang='fr'] .display-line {
  line-height: 0.92;
  letter-spacing: -0.045em;
}
.emphasis-wrap {
  position: relative;
  display: inline-block;
  margin-top: 0.4em;
}
.emphasis {
  position: relative;
  z-index: 1;
  font-family: var(--font-body);
  font-weight: 700;
  font-size: clamp(1.55rem, var(--emphasis-size, 2.6vw), 2.35rem);
  line-height: 1.22;
  letter-spacing: -0.02em;
}
/* 日语强调句 15 字最长，收一档保持单行；下限同步收紧防窄屏孤字折行 */
html[lang='ja'] .emphasis {
  --emphasis-size: 2vw;
  font-size: clamp(1.15rem, var(--emphasis-size), 2.35rem);
}
/* 反白高亮子串：印面未就位/打印/强制颜色时呈套准橙（保持可辨），印面就位后反白暖白 */
.emphasis .hl {
  color: var(--orange);
}
.press-stage[data-ink-ready] .emphasis .hl {
  color: var(--paper);
}
/* 批准的橘红印面：位图解码完成才显现，始终位于炭墨文字之后；
   object-fit: cover 裁出横向墨带，只罩住强调行、不侵入上方展示行；
   显现时自左向右「印刷」展开（scaleX），1.2 轻微过冲刺压印回弹（非 bounce） */
.ink-ground {
  position: absolute;
  left: -18px;
  top: 50%;
  width: calc(100% + 36px);
  height: calc(100% + 1.8em);
  transform: translateY(-50%) scaleX(0.55);
  transform-origin: left center;
  object-fit: cover;
  object-position: 50% 55%;
  opacity: 0;
  transition:
    opacity var(--dur-release) ease-out,
    transform var(--dur-release) cubic-bezier(0.34, 1.2, 0.64, 1);
  pointer-events: none;
  user-select: none;
}
.press-stage[data-ink-ready] .ink-ground {
  opacity: 1;
  transform: translateY(-50%) scaleX(1);
}
.subline {
  margin-top: 26px;
  max-width: 36em;
  color: var(--ink-70);
}
.action-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 18px 28px;
  margin-top: 34px;
}
.date-note {
  line-height: 1.6;
}

/* ---------- 四层倾斜叠纸：确定性角度与露边，禁运行时随机 ---------- */
.stage-proof {
  min-width: 0;
}
.paper-stack {
  position: relative;
}
.stack-backboard {
  position: absolute;
  inset: 0;
  transform: translate(18px, 18px);
  background: var(--teal);
  border-radius: var(--r-sheet);
}
.stack-sheet {
  position: absolute;
  inset: 0;
  border-radius: var(--r-proof);
}
.s1 {
  transform: rotate(-4.2deg) translate(18px, 14px);
}
.s2 {
  transform: rotate(2.6deg) translate(-14px, 26px);
}
.s3 {
  transform: rotate(-1.6deg) translate(12px, 38px);
}
.stack-front {
  position: relative;
  transform: rotate(0.8deg);
  border-radius: var(--r-proof);
  overflow: hidden;
  transition: transform var(--dur-release) var(--ease-press);
}
/* 顶层纸 hover 微抬：邀请点击的手势暗示（transform 属性，reduced-motion 由全局规则静态化） */
.paper-stack:hover .stack-front {
  transform: rotate(0.8deg) translateY(-5px);
}

/* ---------- 线性回退：≤1120px 单列，只留一层轻量后纸 ---------- */
@media (max-width: 1120px) {
  .press-stage {
    grid-template-columns: minmax(0, 1fr);
    min-height: 0;
    gap: 48px;
  }
  .subline {
    max-width: 46em;
  }
  .s2,
  .s3 {
    display: none;
  }
  .s1 {
    transform: rotate(-1.5deg) translate(8px, 10px);
  }
  .stack-front {
    transform: none;
  }
  .paper-stack:hover .stack-front {
    transform: translateY(-4px);
  }
}
@media (max-width: 720px) {
  .display-line {
    font-size: clamp(2.25rem, calc(var(--display-size, 6vw) * 2), 4rem);
  }
  .stack-backboard {
    transform: translate(10px, 10px);
  }
}
</style>

<!-- 入场门控：祖先选择器（html.js / html.fonts-ready）必须非 scoped -->
<style>
@keyframes press-in {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
/* 活字落版：逐字 translateY+微旋转落位，ease-out-expo 强非线性（无回弹），阶梯延迟内联于元素 */
@keyframes ch-stamp {
  from {
    opacity: 0;
    transform: translateY(0.45em) rotate(-8deg);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
html.fonts-ready .press-stage .display-line .ch {
  display: inline-block;
  animation: ch-stamp 340ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
/* 叠纸阶梯扇出：自摊平状态到各自确定性角度（120ms 间隔，ease-out-expo） */
@keyframes sheet-fan-back {
  from {
    opacity: 0;
    transform: translate(0, 0);
  }
  to {
    opacity: 1;
    transform: translate(18px, 18px);
  }
}
@keyframes sheet-fan-s1 {
  from {
    opacity: 0;
    transform: rotate(0deg) translate(0, 0);
  }
  to {
    opacity: 1;
    transform: rotate(-4.2deg) translate(18px, 14px);
  }
}
@keyframes sheet-fan-s2 {
  from {
    opacity: 0;
    transform: rotate(0deg) translate(0, 0);
  }
  to {
    opacity: 1;
    transform: rotate(2.6deg) translate(-14px, 26px);
  }
}
@keyframes sheet-fan-s3 {
  from {
    opacity: 0;
    transform: rotate(0deg) translate(0, 0);
  }
  to {
    opacity: 1;
    transform: rotate(-1.6deg) translate(12px, 38px);
  }
}
html.js .press-stage .stack-backboard {
  animation: sheet-fan-back 380ms cubic-bezier(0.16, 1, 0.3, 1) 300ms both;
}
html.js .press-stage .stack-sheet.s1 {
  animation: sheet-fan-s1 380ms cubic-bezier(0.16, 1, 0.3, 1) 420ms both;
}
html.js .press-stage .stack-sheet.s2 {
  animation: sheet-fan-s2 380ms cubic-bezier(0.16, 1, 0.3, 1) 540ms both;
}
html.js .press-stage .stack-sheet.s3 {
  animation: sheet-fan-s3 380ms cubic-bezier(0.16, 1, 0.3, 1) 660ms both;
}
/* ≤1120px 单层回退：扇出动画的角度终值与媒体查询变换冲突，此档关闭扇出保留静态变换 */
@media (max-width: 1120px) {
  html.js .press-stage .stack-backboard,
  html.js .press-stage .stack-sheet {
    animation: none;
  }
}
/* 弱网门控：JS 在而字体未就位时先隐去文案区，fonts-ready 后一次到位，杜绝入场中途 FOUT 错位 */
html.js:not(.fonts-ready) .press-stage .stage-copy > * {
  opacity: 0;
}
/* 文案区逐段抬起（主句容器自身不动：字符级落版在 .ch 上） */
html.fonts-ready .press-stage .stage-copy > *:not(.statement) {
  animation: press-in var(--dur-narrative) var(--ease-press) both;
}
html.fonts-ready .press-stage .emphasis-wrap {
  animation: press-in var(--dur-narrative) var(--ease-press) 380ms both;
}
html.fonts-ready .press-stage .stage-copy > .subline {
  animation-delay: 440ms;
}
html.fonts-ready .press-stage .stage-copy > .action-row {
  animation-delay: 500ms;
}
/* reduced-motion：全部动画静态化，直接呈终态（截图链路即 reducedMotion 环境） */
@media (prefers-reduced-motion: reduce) {
  html.js .press-stage .stack-backboard,
  html.js .press-stage .stack-sheet,
  html.js .press-stage .stack-front,
  html.fonts-ready .press-stage .display-line .ch,
  html.fonts-ready .press-stage .stage-copy > * {
    animation: none !important;
  }
  html.js .press-stage .ink-ground {
    transition: none;
  }
}
</style>
