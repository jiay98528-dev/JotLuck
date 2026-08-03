<script setup lang="ts">
import { ref } from 'vue';
import { routePaths } from '../router';
import { localeMeta } from '../content/locales';
import type { LocaleId, SiteContent, SiteRouteId } from '../types';

defineProps<{ content: SiteContent; routeId: SiteRouteId }>();
const open = ref(false);

function switchLocale(locale: LocaleId, currentPath: string): void {
  document.cookie = `jotluck_locale=${locale}; Max-Age=31536000; Path=/; Domain=.jotluck.com; SameSite=Lax`;
  window.location.href = `https://${localeMeta[locale].domain}${currentPath}`;
}
</script>

<template>
  <a class="skip-link" href="#main-content">Skip to content</a>
  <header class="site-header">
    <RouterLink class="brand" to="/" aria-label="JotLuck home">
      <img src="/assets/brand/jotluck-icon.png" alt="" width="32" height="32" />
      <span>JotLuck</span>
    </RouterLink>
    <button class="nav-toggle" type="button" :aria-expanded="open" @click="open = !open">
      Menu
    </button>
    <nav :class="['primary-nav', { 'is-open': open }]" aria-label="Primary">
      <RouterLink
        v-for="id in ['product', 'download', 'themes', 'support'] as const"
        :key="id"
        :to="routePaths[id]"
        :aria-current="routeId === id ? 'page' : undefined"
      >
        {{ content.nav[id] }}
      </RouterLink>
    </nav>
    <label class="language-control">
      <span>{{ content.common.language }}</span>
      <select
        :value="content.locale"
        @change="switchLocale(($event.target as HTMLSelectElement).value as LocaleId, $route.path)"
      >
        <option v-for="(meta, id) in localeMeta" :key="id" :value="id">
          {{ meta.localeLabel }}
        </option>
      </select>
    </label>
  </header>
</template>
