<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useLocale } from '../composables/useLocale';
import { usePageHead } from '../composables/usePageHead';

const { content } = useLocale();
usePageHead('studio');
const s = () => content.value.studio;

/** 明信片入场：滚动到视口一次性触发；reduced-motion/无 JS 由全局与 html.js 门控兜底 */
const cardEl = ref<HTMLElement | null>(null);
onMounted(() => {
  const el = cardEl.value;
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
    { threshold: 0.2 },
  );
  io.observe(el);
});
</script>

<template>
  <article class="studio-page page-flow">
    <header class="page-head">
      <p class="head-eyebrow tech-rail">{{ s().eyebrow }}</p>
      <h1>{{ s().title }}</h1>
      <p class="head-lead">{{ s().lead }}</p>
    </header>

    <!-- 明信片：左信文右地址，Logo 作邮票，邮戳压角 -->
    <section ref="cardEl" class="postcard paper-sheet tex-2" :aria-label="s().eyebrow">
      <div class="pc-message">
        <p class="pc-quote">{{ s().quote }}</p>
        <p class="pc-body">{{ s().body }}</p>
      </div>
      <div class="pc-address">
        <div class="stamp-wrap" aria-hidden="true">
          <svg class="postmark" viewBox="0 0 96 96" fill="none">
            <circle cx="48" cy="48" r="36" stroke="var(--orange)" stroke-width="2" />
            <circle
              cx="48"
              cy="48"
              r="28"
              stroke="var(--ink-30)"
              stroke-width="1"
              stroke-dasharray="3 4"
            />
          </svg>
          <span class="stamp">
            <img
              src="/assets/brand/studio-leankom-mark.png"
              alt=""
              width="96"
              height="96"
              loading="lazy"
              decoding="async"
            />
          </span>
        </div>
        <p class="addr-lines" aria-hidden="true"><i></i><i></i><i></i></p>
        <a class="addr-mail" :href="`mailto:${s().action}`">{{ s().action }}</a>
      </div>
    </section>

    <div class="studio-cta">
      <a class="btn btn-primary studio-mail" :href="`mailto:${s().action}`">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" width="16" height="16">
          <rect
            x="2.5"
            y="5"
            width="19"
            height="14"
            rx="2"
            stroke="currentColor"
            stroke-width="1.8"
          />
          <path
            d="M3.5 6.5 L12 13 L20.5 6.5"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        {{ s().action }}
      </a>
    </div>
  </article>
</template>

<style scoped>
.studio-page {
  padding-bottom: 140px;
}
.studio-page h1 {
  max-width: 14em;
}

/* ---------- 明信片 ---------- */
.postcard {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  gap: clamp(28px, 4vw, 52px);
  padding: clamp(28px, 4.5vw, 56px);
  margin-top: clamp(8px, 2vw, 24px);
}
.pc-message {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 22px;
}
.pc-quote {
  font-family: var(--font-display);
  font-size: clamp(1.5rem, 3vw, 2.375rem);
  line-height: 1.3;
  letter-spacing: -0.01em;
  max-width: 20em;
}
.pc-body {
  color: var(--ink-70);
}
/* 地址半栏：虚线分隔是明信片的中缝 */
.pc-address {
  border-left: 1px dashed var(--ink-30);
  padding-left: clamp(28px, 4vw, 52px);
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.stamp-wrap {
  position: relative;
  align-self: flex-end;
  width: 96px;
  height: 96px;
}
/* 邮票：纸色衬底 + 真齿孔穿孔（hard-stop alpha mask，非视觉渐变），确定性的 1.5deg 倾斜 */
.stamp {
  --perf: 4.5px;
  display: block;
  padding: calc(var(--perf) + 5px);
  background: var(--paper);
  transform: rotate(1.5deg);
  box-shadow: 0 1px 0 var(--ink-14);
  transition: transform var(--dur-release) var(--ease-press);
  -webkit-mask:
    radial-gradient(circle var(--perf) at var(--perf) var(--perf), transparent 96%, #000 100%)
      calc(-1 * var(--perf)) calc(-1 * var(--perf)) / calc(var(--perf) * 2) calc(var(--perf) * 2),
    linear-gradient(#000 0 0) 50% 50% / calc(100% - var(--perf) * 2) calc(100% - var(--perf) * 2)
      no-repeat;
  mask:
    radial-gradient(circle var(--perf) at var(--perf) var(--perf), transparent 96%, #000 100%)
      calc(-1 * var(--perf)) calc(-1 * var(--perf)) / calc(var(--perf) * 2) calc(var(--perf) * 2),
    linear-gradient(#000 0 0) 50% 50% / calc(100% - var(--perf) * 2) calc(100% - var(--perf) * 2)
      no-repeat;
}
/* hover：邮票轻抬回正，邀请端详（transform 属性，reduced-motion 由全局规则静态化）；
   选择器提特以确保压过入场块的 transition（含 180ms delay），hover 不滞后 */
.studio-page .stamp-wrap:hover .stamp {
  transform: rotate(0deg) translateY(-3px);
  transition: transform var(--dur-release) var(--ease-press) 0ms;
}
.stamp img {
  width: 100%;
  height: auto;
  border-radius: 1px;
  outline: 1px dashed var(--ink-30);
  outline-offset: 3px;
}
/* 邮戳：压住邮票左上角，与下载页同一盖章语汇 */
.postmark {
  position: absolute;
  left: -34px;
  top: -24px;
  width: 72px;
  height: 72px;
  transform: rotate(-10deg);
  opacity: 0.85;
}
.addr-lines {
  display: grid;
  gap: 16px;
  margin-top: 6px;
}
.addr-lines i {
  display: block;
  border-top: 1px dashed var(--ink-30);
}
.addr-lines i:nth-child(2) {
  width: 82%;
}
.addr-lines i:nth-child(3) {
  width: 64%;
}
.addr-mail {
  font-family: var(--font-mono);
  font-size: 0.9rem;
  color: var(--teal);
  align-self: flex-start;
}

.studio-cta {
  margin-top: clamp(40px, 6vw, 72px);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px 28px;
}
.studio-mail {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  font-family: var(--font-mono);
  font-size: 0.9rem;
}

/* ---------- 入场基态（is-in 触发见下方非 scoped 块） ---------- */
@media (max-width: 720px) {
  .postcard {
    grid-template-columns: minmax(0, 1fr);
  }
  .pc-address {
    border-left: 0;
    border-top: 1px dashed var(--ink-30);
    padding-left: 0;
    padding-top: 26px;
  }
  .stamp-wrap {
    align-self: flex-start;
  }
}
</style>

<!-- 入场门控与 is-in 触发：html.js 祖先 / 跨元素选择器必须非 scoped -->
<style>
/* 工作室页背景已与全站统一为 --paper（2026-08-04 深夜用户批注，撤销 --paper-deep 覆盖） */
/* 明信片浮入 → 邮票盖章 → 邮戳落印（均 <400ms）；无 JS 静态可见 */
html.js .studio-page .postcard {
  opacity: 0;
  transform: translateY(14px);
  transition:
    opacity var(--dur-narrative) ease-out,
    transform var(--dur-narrative) var(--ease-press);
}
html.js .studio-page .postcard.is-in {
  opacity: 1;
  transform: none;
}
html.js .studio-page .stamp {
  opacity: 0;
  transform: rotate(1.5deg) scale(1.15);
  transition:
    opacity var(--dur-release) ease-out 180ms,
    transform var(--dur-release) var(--ease-press) 180ms;
}
html.js .studio-page .postcard.is-in .stamp {
  opacity: 1;
  transform: rotate(1.5deg) scale(1);
}
html.js .studio-page .postmark {
  opacity: 0;
  transition: opacity var(--dur-spatial) ease-out 320ms;
}
html.js .studio-page .postcard.is-in .postmark {
  opacity: 0.85;
}
/* reduced-motion：直接静态呈现（邮票保留 1.5deg 倾斜） */
@media (prefers-reduced-motion: reduce) {
  html.js .studio-page .postcard,
  html.js .studio-page .stamp,
  html.js .studio-page .postmark {
    opacity: 1;
  }
  html.js .studio-page .postcard {
    transform: none;
  }
  html.js .studio-page .stamp {
    transform: rotate(1.5deg);
  }
  html.js .studio-page .postmark {
    opacity: 0.85;
  }
}
</style>
