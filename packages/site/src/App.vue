<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useHead } from '@unhead/vue';
import SiteFooter from './components/SiteFooter.vue';
import SiteHeader from './components/SiteHeader.vue';
import { localeMeta, siteContent } from './content/locales';
import { routePaths } from './router';
import type { LocaleId, SiteRouteId } from './types';

const locale = (__SITE_LOCALE__ in siteContent ? __SITE_LOCALE__ : 'en') as LocaleId;
const content = siteContent[locale];
const route = useRoute();
const routeId = computed(() => (route.meta.routeId ?? 'home') as SiteRouteId);
const pageTitle = computed(() =>
  routeId.value === 'home' ? 'JotLuck' : `${content.pages[routeId.value].title} — JotLuck`,
);
const description = computed(() =>
  routeId.value === 'home'
    ? `${content.hero.voice} ${content.hero.emphasis}`
    : content.pages[routeId.value].lead,
);
const canonical = computed(() => `https://${content.domain}${routePaths[routeId.value]}`);

useHead(() => ({
  title: pageTitle.value,
  htmlAttrs: { lang: content.htmlLang },
  link: [
    { rel: 'canonical', href: canonical.value },
    ...Object.entries(localeMeta).map(([id, meta]) => ({
      rel: 'alternate' as const,
      type: 'text/html',
      hreflang: id === 'en' ? 'x-default' : meta.htmlLang,
      href: `https://${meta.domain}${routePaths[routeId.value]}`,
    })),
    {
      rel: 'alternate' as const,
      type: 'text/html',
      hreflang: 'en',
      href: `https://${localeMeta.en.domain}${routePaths[routeId.value]}`,
    },
  ],
  meta: [
    { name: 'description', content: description.value },
    { property: 'og:title', content: pageTitle.value },
    { property: 'og:description', content: description.value },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: canonical.value },
    { property: 'og:image', content: `https://${content.domain}/assets/social/${locale}.png` },
  ],
}));

onMounted(() => {
  document.documentElement.dataset.locale = locale;
});
</script>

<template>
  <div :class="['site-shell', `locale-${locale}`]">
    <SiteHeader :content="content" :route-id="routeId" />
    <main id="main-content">
      <RouterView :content="content" />
    </main>
    <SiteFooter :content="content" />
  </div>
</template>
