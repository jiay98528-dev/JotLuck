<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { LOCALES, getContent, type Locale } from '../content';
import { pagePath, type SitePage } from '../router';
import { useLocale } from '../composables/useLocale';

const { locale, content } = useLocale();
const route = useRoute();
const router = useRouter();
const open = ref(false);

function switchTo(target: Locale) {
  open.value = false;
  if (target === locale.value) return;
  const page = (route.meta.page as SitePage | undefined) ?? 'home';
  router.push(pagePath(target, page));
}

function nameOf(l: Locale): string {
  return getContent(l).localeName;
}
</script>

<template>
  <div class="lang-selector">
    <button
      type="button"
      class="lang-trigger"
      :aria-expanded="open"
      :aria-label="content.header.langSelectorLabel"
      @click="open = !open"
    >
      {{ content.localeName }}
    </button>
    <ul v-if="open" class="lang-list" role="listbox">
      <li v-for="l in LOCALES" :key="l">
        <button
          type="button"
          class="lang-option"
          role="option"
          :aria-selected="l === locale"
          @click="switchTo(l)"
        >
          {{ nameOf(l) }}
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.lang-selector {
  position: relative;
}
.lang-trigger {
  min-height: 44px;
  min-width: 44px;
  padding: 0 12px;
  border-radius: var(--r-control);
  border: 1px solid var(--ink-30);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.06em;
}
.lang-list {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  background: var(--paper);
  border-radius: var(--r-compact);
  box-shadow: var(--shadow-float);
  padding: 6px;
  min-width: 140px;
  z-index: 20;
}
.lang-option {
  width: 100%;
  min-height: 44px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  border-radius: var(--r-compact);
  text-align: left;
}
.lang-option[aria-selected='true'] {
  color: var(--teal);
  font-weight: 700;
}
</style>
