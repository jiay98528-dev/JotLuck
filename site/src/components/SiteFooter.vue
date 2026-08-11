<script setup lang="ts">
import { useLocale } from '../composables/useLocale';
import { pagePath } from '../router';
import { EXTERNAL } from '../release';

const { locale, content } = useLocale();
</script>

<template>
  <footer class="site-footer">
    <div class="footer-brand">
      <strong>{{ content.footer.studio }}</strong>
      <span>{{ content.footer.tagline }}</span>
    </div>
    <nav class="footer-links" aria-label="footer">
      <a :href="EXTERNAL.githubIssues" rel="noopener">{{ content.footer.links.support }}</a>
      <RouterLink :to="pagePath(locale, 'privacy')">{{ content.footer.links.privacy }}</RouterLink>
      <a :href="EXTERNAL.codeSigning" rel="noopener">{{ content.footer.links.signing }}</a>
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
  flex-wrap: wrap;
  gap: 20px;
  margin-left: auto;
}
/* 触控契约 44×44（裁决 32）：页脚链接扩命中区 */
.footer-links a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
}
.footer-copyright {
  width: 100%;
  color: var(--ink-70);
}
</style>
