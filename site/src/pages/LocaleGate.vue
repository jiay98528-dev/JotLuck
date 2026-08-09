<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useHead } from '@unhead/vue';
import { LOCALES, LOCALE_TAGS, getContent, type Locale } from '../content';
import { SITE_URL, SOCIAL_CARD, SOCIAL_CARD_ALT } from '../release';
import { JSON_LD } from '../composables/usePageHead';

/**
 * 语言门页（`/`）：客户端按浏览器语言重定向到五语之一；
 * 无 JS / SSG 静态态呈现五语入口（真实链接，SEO 可达）。
 * SEO：canonical 指自身；hreflang 指向五语首页，x-default 指自身（语言选择器模式）。
 * 裁决 32：补 WebSite+Organization JSON-LD；description 改为门页专属（与 /en/ 首页差异化）。
 */
const router = useRouter();

/** 门页专属 description：说明产品类别 + 语言选择器职能 */
const GATE_DESCRIPTION =
  'JotLuck — a lightweight, local-first Markdown note tool. Choose your language: 中文 / 日本語 / 한국어 / English / Français.';

useHead({
  htmlAttrs: { lang: 'en' },
  title: 'JotLuck',
  meta: [
    { name: 'description', content: GATE_DESCRIPTION },
    { property: 'og:title', content: 'JotLuck' },
    { property: 'og:description', content: GATE_DESCRIPTION },
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: 'JotLuck' },
    { property: 'og:url', content: `${SITE_URL}/` },
    { property: 'og:image', content: `${SITE_URL}${SOCIAL_CARD}` },
    { property: 'og:image:width', content: '1280' },
    { property: 'og:image:height', content: '640' },
    { property: 'og:image:alt', content: SOCIAL_CARD_ALT },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: 'JotLuck' },
    { name: 'twitter:description', content: GATE_DESCRIPTION },
    { name: 'twitter:image', content: `${SITE_URL}${SOCIAL_CARD}` },
  ],
  script: [{ type: 'application/ld+json', innerHTML: JSON_LD }],
  link: [
    { rel: 'canonical', href: `${SITE_URL}/` },
    ...LOCALES.map((l) => ({
      rel: 'alternate',
      hreflang: LOCALE_TAGS[l],
      href: `${SITE_URL}/${l}/`,
    })),
    { rel: 'alternate', hreflang: 'x-default', href: `${SITE_URL}/` },
  ],
});

function detect(): Locale {
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const raw of langs) {
    const tag = raw.toLowerCase();
    if (tag.startsWith('zh')) return 'zh';
    if (tag.startsWith('ja')) return 'ja';
    if (tag.startsWith('ko')) return 'ko';
    if (tag.startsWith('fr')) return 'fr';
    if (tag.startsWith('en')) return 'en';
  }
  return 'en';
}

onMounted(() => {
  // 自动跳转只做一次性：sessionStorage 记忆后访客可稳定停留在语言门页
  //（Google 多语言指南：避免基于推测语言的强制重定向妨碍查看其他语言版本）
  try {
    if (sessionStorage.getItem('jl-gate-redirected')) return;
    sessionStorage.setItem('jl-gate-redirected', '1');
  } catch {
    /* 隐私模式下 storage 不可写：照常跳转一次 */
  }
  router.replace(`/${detect()}/`);
});
</script>

<template>
  <div class="locale-gate">
    <header class="gate-brand">
      <img src="/assets/brand/jotluck-icon.png" alt="JotLuck" width="72" height="72" />
      <h1>JotLuck</h1>
    </header>
    <nav class="gate-index" aria-label="languages">
      <ul>
        <li v-for="l in LOCALES" :key="l">
          <a :href="`/${l}/`" :hreflang="LOCALE_TAGS[l]" :lang="LOCALE_TAGS[l]">
            <span class="gate-name">{{ getContent(l).localeName }}</span>
            <span class="gate-tag">{{ LOCALE_TAGS[l] }}</span>
          </a>
        </li>
      </ul>
    </nav>
  </div>
</template>

<style scoped>
.locale-gate {
  min-height: 100svh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 56px;
  padding: 48px 24px;
}
.gate-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
}
.gate-brand h1 {
  font-family: 'JL Display EN', Georgia, serif;
  font-size: 2rem;
  font-weight: 500;
  letter-spacing: -0.02em;
}
/* 五语索引：每种语言用它自己的展示字体现身（同首页五语声明区块的字族） */
.gate-index {
  width: min(420px, 100%);
}
.gate-index ul {
  border-top: 1px solid var(--ink-14);
  border-bottom: 1px solid var(--ink-14);
}
.gate-index li + li {
  border-top: 1px solid var(--ink-14);
}
.gate-index a {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 24px;
  min-height: 52px;
  padding: 12px 4px;
  color: var(--ink);
  text-decoration: none;
  transition: color var(--dur-press) var(--ease-press);
}
.gate-index a:hover {
  color: var(--teal);
}
.gate-name {
  font-size: 1.25rem;
}
.gate-index a[lang='zh-CN'] .gate-name {
  font-family: 'JL Display ZH', 'Songti SC', serif;
}
.gate-index a[lang='en'] .gate-name {
  font-family: 'JL Display EN', Georgia, serif;
  letter-spacing: -0.02em;
}
.gate-index a[lang='fr'] .gate-name {
  font-family: 'JL Display FR', Georgia, serif;
}
.gate-index a[lang='ja'] .gate-name {
  font-family: 'JL Display JA', 'Yu Mincho', serif;
}
.gate-index a[lang='ko'] .gate-name {
  font-family: 'JL Display KO', 'Batang', serif;
}
.gate-tag {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--ink-70);
}
</style>
