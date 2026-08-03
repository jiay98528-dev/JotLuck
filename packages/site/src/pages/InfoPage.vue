<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { releaseState } from '../release';
import type { SiteContent, SiteRouteId } from '../types';

const props = defineProps<{ content: SiteContent }>();
const route = useRoute();
const id = computed(() => route.meta.routeId as Exclude<SiteRouteId, 'home'>);
const page = computed(() => props.content.pages[id.value]);
const releasePlatform = computed(() =>
  releaseState.kind === 'prelaunch' ? releaseState.targetPlatform : releaseState.platform,
);
</script>

<template>
  <article class="info-page">
    <header class="info-hero">
      <p>{{ page.eyebrow }}</p>
      <h1>{{ page.title }}</h1>
      <p>{{ page.lead }}</p>
    </header>
    <section class="status-sheet">
      <span class="annotation">01</span>
      <div>
        <strong>{{ id === 'download' ? releasePlatform : page.eyebrow }}</strong>
        <p>{{ page.note ?? content.common.notAvailable }}</p>
      </div>
    </section>
    <div class="info-actions">
      <a v-if="id === 'support'" class="primary-action" href="mailto:official@leankom.com"
        >official@leankom.com</a
      >
      <a v-else-if="id === 'studio'" class="primary-action" href="mailto:carrie@leankom.com"
        >carrie@leankom.com</a
      >
      <a v-else class="secondary-action" href="https://github.com/jiay98528-dev/JotLuck">{{
        content.common.sourceCode
      }}</a>
    </div>
  </article>
</template>
