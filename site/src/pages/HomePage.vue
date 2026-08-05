<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useLocale } from '../composables/useLocale';
import { usePageHead } from '../composables/usePageHead';
import HeroPressStage from '../components/HeroPressStage.vue';
import NarrativeFigure from '../components/NarrativeFigure.vue';

const { locale, content } = useLocale();
usePageHead('home');

/** 叙事段滚动入场：IntersectionObserver 一次性加 .is-in；不支持则直接终态 */
const actsEl = ref<HTMLOListElement | null>(null);
onMounted(() => {
  const items = actsEl.value?.querySelectorAll('.act');
  if (!items?.length) return;
  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-in'));
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
  items.forEach((el) => io.observe(el));
});
</script>

<template>
  <article class="home-page">
    <HeroPressStage :locale="locale" :hero="content.hero" :preview="content.themePreview" />

    <section class="narrative page-flow" aria-label="narrative">
      <ol ref="actsEl" class="acts">
        <li v-for="(act, i) in content.narrative" :key="act.id" class="act">
          <span class="annotation-num" aria-hidden="true">{{
            String(i + 1).padStart(2, '0')
          }}</span>
          <div class="act-text">
            <h2>{{ act.title }}</h2>
            <p class="act-body">{{ act.body }}</p>
            <p class="tech-rail">{{ act.rail.join(' · ') }}</p>
          </div>
          <NarrativeFigure :id="act.id" />
        </li>
      </ol>
    </section>

    <section class="multilingual page-flow" aria-labelledby="ml-title">
      <p class="tech-rail ml-eyebrow">{{ content.multilingual.eyebrow }}</p>
      <h2 id="ml-title">{{ content.multilingual.title }}</h2>
      <p class="ml-body">{{ content.multilingual.body }}</p>
      <p class="lang-showcase" aria-label="中文 / 日本語 / 한국어 / English / Français">
        <span class="lang-row">
          <span class="lang-name zh-name">中文</span>
          <span class="lang-name ja-name">日本語</span>
          <span class="lang-name ko-name">한국어</span>
        </span>
        <span class="lang-row">
          <span class="lang-name en-name">English</span>
          <span class="lang-name fr-name">Français</span>
        </span>
      </p>
      <p class="quip">{{ content.multilingual.note }}</p>
    </section>
  </article>
</template>

<style scoped>
/* .page-flow 容器与 .page-head 页首模式已提升为全局共享（site.css） */

/* ---------- 四段叙事：编号批注 + 交错配图，连续纸页不是卡片阵列 ---------- */
.acts {
  padding: 24px 0 96px;
}
.act {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) minmax(150px, 260px);
  grid-template-areas: 'num text fig';
  align-items: center;
  gap: 24px clamp(24px, 4vw, 64px);
  padding: 48px 0;
  border-top: 1px solid var(--ink-14);
}
.act:first-child {
  border-top: 0;
}
/* 偶数段配图换到左侧，形成红框标注的交错留白 */
.act:nth-child(even) {
  grid-template-columns: minmax(150px, 260px) 32px minmax(0, 1fr);
  grid-template-areas: 'fig num text';
}
.annotation-num {
  grid-area: num;
}
.act-text {
  grid-area: text;
}
.act-fig {
  grid-area: fig;
  justify-self: center;
}
/* 滚动入场（html.js 祖先门控见下方非 scoped 块） */
.act-text h2 {
  font-size: clamp(1.5rem, 2.5vw, 2.25rem);
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -0.02em;
}
.act-body {
  margin-top: 12px;
  max-width: 36em;
  color: var(--ink-70);
}
.act-text .tech-rail {
  margin-top: 16px;
}
@media (max-width: 720px) {
  .act,
  .act:nth-child(even) {
    grid-template-columns: 32px minmax(0, 1fr);
    grid-template-areas:
      'num text'
      'num fig';
  }
  .act-fig {
    justify-self: start;
    margin-top: 8px;
    max-width: 200px;
  }
}

/* ---------- 五语声明：每种语言用它自己的展示字体现身 ---------- */
.multilingual {
  padding: 72px 0 120px;
  border-top: 1px solid var(--ink-14);
}
.ml-eyebrow {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ml-eyebrow::before {
  content: '';
  width: 14px;
  height: 2px;
  background: var(--orange);
}
.multilingual h2 {
  margin-top: 18px;
  font-size: clamp(2rem, 4vw, 3.5rem);
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -0.02em;
}
.ml-body {
  margin-top: 16px;
  max-width: 36em;
  color: var(--ink-70);
}
.lang-showcase {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 40px;
}
.lang-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px clamp(18px, 3vw, 40px);
}
.lang-name {
  font-size: clamp(2rem, 4.5vw, 3.75rem);
  line-height: 1.15;
}
.lang-name + .lang-name::before {
  content: '·';
  margin-right: clamp(18px, 3vw, 40px);
  color: var(--ink-30);
  font-family: var(--font-body);
}
/* 窄屏行内再折行时去掉行首孤点，靠留白分行 */
@media (max-width: 720px) {
  .lang-name + .lang-name::before {
    content: none;
    margin: 0;
  }
}
.zh-name {
  font-family: 'JL Display ZH', 'Songti SC', serif;
}
.ja-name {
  font-family: 'JL Display JA', 'Yu Mincho', serif;
}
.ko-name {
  font-family: 'JL Display KO', 'Batang', serif;
}
.en-name,
.fr-name {
  font-family: 'JL Display EN', Georgia, serif;
  letter-spacing: -0.03em;
}
.fr-name {
  font-family: 'JL Display FR', Georgia, serif;
}
.multilingual .quip {
  margin-top: 28px;
}
</style>

<!-- 滚动入场门控：html.js 祖先选择器必须非 scoped -->
<style>
/* JS 环境下先隐，is-in 后 300ms 到位；无 JS 静态可见 */
html.js .narrative .act {
  opacity: 0;
  transform: translateY(12px);
  transition:
    opacity var(--dur-spatial) ease-out,
    transform var(--dur-spatial) var(--ease-press);
}
html.js .narrative .act.is-in {
  opacity: 1;
  transform: none;
}
/* reduced-motion：无入场编排，直接静态呈现 */
@media (prefers-reduced-motion: reduce) {
  html.js .narrative .act {
    opacity: 1;
    transform: none;
  }
}
</style>
