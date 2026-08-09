<script setup lang="ts">
import { useLocale } from '../composables/useLocale';
import { pagePath } from '../router';
import LanguageSelector from './LanguageSelector.vue';

const { locale, content } = useLocale();
</script>

<template>
  <header class="site-header">
    <RouterLink :to="pagePath(locale, 'home')" class="site-brand">
      <img src="/assets/brand/jotluck-icon.png" alt="" width="28" height="28" />
      <span>JotLuck</span>
    </RouterLink>
    <nav class="site-nav" aria-label="primary">
      <RouterLink
        v-for="page in ['home', 'download', 'themes', 'studio'] as const"
        :key="page"
        :to="pagePath(locale, page)"
        class="site-nav-link"
        :aria-current="$route.meta.page === page ? 'page' : undefined"
      >
        {{ content.header.nav[page] }}
      </RouterLink>
    </nav>
    <LanguageSelector />
  </header>
</template>

<style scoped>
.site-header {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--ink-14);
}
.site-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  text-decoration: none;
  font-weight: 700;
}
.site-nav {
  display: flex;
  gap: 20px;
  margin-left: auto;
}
.site-nav-link {
  min-height: 44px;
  min-width: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  white-space: nowrap;
}
.site-nav-link[aria-current='page'] {
  text-decoration: underline;
  text-decoration-color: var(--orange);
  text-underline-offset: 6px;
}

/* 窄屏两行：品牌 + 语言切换第一行，导航整条第二行（可横滑） */
@media (max-width: 720px) {
  .site-header {
    flex-wrap: wrap;
    gap: 0 16px;
    padding: 8px 16px;
  }
  .site-brand {
    order: 1;
  }
  .site-header > .lang-selector {
    order: 2;
    margin-left: auto;
  }
  .site-nav {
    order: 3;
    flex-basis: 100%;
    margin-left: 0;
    gap: 18px;
    overflow-x: auto;
  }
}
</style>
