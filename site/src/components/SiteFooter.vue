<script setup lang="ts">
import { useLocale } from '../composables/useLocale';
import { EXTERNAL } from '../release';

const { content } = useLocale();
</script>

<template>
  <footer class="site-footer">
    <div class="footer-brand">
      <strong>{{ content.footer.studio }}</strong>
      <span>{{ content.footer.tagline }}</span>
    </div>
    <nav class="footer-links" aria-label="footer">
      <a :href="EXTERNAL.githubIssues" rel="noopener">{{ content.footer.links.support }}</a>
      <a :href="`mailto:${EXTERNAL.supportMail}`">{{ content.footer.links.privacy }}</a>
      <a :href="EXTERNAL.githubRepo" rel="noopener">{{ content.footer.links.github }}</a>
    </nav>
    <p class="footer-copyright">{{ content.footer.copyright }}</p>
  </footer>
</template>

<style scoped>
.site-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 16px 32px;
  padding: 24px;
  border-top: 1px solid var(--ink-14);
  font-size: 0.75rem;
}
.footer-brand {
  display: flex;
  gap: 12px;
  align-items: baseline;
}
.footer-links {
  display: flex;
  gap: 20px;
  margin-left: auto;
}
.footer-copyright {
  width: 100%;
  color: var(--ink-50);
}
</style>
