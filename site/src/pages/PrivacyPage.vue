<script setup lang="ts">
import { useLocale } from '../composables/useLocale';
import { usePageHead } from '../composables/usePageHead';
import { EXTERNAL } from '../release';

const { content } = useLocale();
usePageHead('privacy');
const p = () => content.value.privacy;
</script>

<template>
  <article class="privacy-page page-flow">
    <header class="page-head">
      <p class="head-eyebrow tech-rail">{{ p().eyebrow }}</p>
      <h1>{{ p().title }}</h1>
      <p class="head-lead">{{ p().lead }}</p>
    </header>

    <!-- 分节正文：离线优先产品的诚实隐私说明（不收集什么 / 数据在哪里 / 本站与下载渠道） -->
    <div class="privacy-sections">
      <section v-for="sec in p().sections" :key="sec.title" class="privacy-section">
        <h2>{{ sec.title }}</h2>
        <p>{{ sec.body }}</p>
      </section>
    </div>

    <section class="privacy-contact paper-sheet tex-3">
      <h2>{{ p().contactTitle }}</h2>
      <p>{{ p().contactBody }}</p>
      <a class="btn btn-primary privacy-mail" :href="`mailto:${EXTERNAL.supportMail}`">{{
        EXTERNAL.supportMail
      }}</a>
    </section>
  </article>
</template>

<style scoped>
.privacy-page {
  padding-bottom: 120px;
}
.privacy-sections {
  margin-top: clamp(24px, 3vw, 40px);
  display: grid;
  gap: clamp(32px, 4vw, 48px);
  max-width: 44em;
}
.privacy-section h2 {
  font-size: clamp(1.25rem, 2vw, 1.5rem);
  font-weight: 600;
  letter-spacing: -0.01em;
}
.privacy-section p {
  margin-top: 12px;
  color: var(--ink-70);
}
.privacy-contact {
  margin-top: clamp(56px, 7vw, 88px);
  padding: clamp(28px, 4vw, 44px);
  max-width: 44em;
}
.privacy-contact h2 {
  font-size: clamp(1.25rem, 2vw, 1.5rem);
  font-weight: 600;
}
.privacy-contact p {
  margin-top: 12px;
  color: var(--ink-70);
}
.privacy-mail {
  margin-top: 24px;
  font-family: var(--font-mono);
  font-size: 0.9rem;
}
</style>
