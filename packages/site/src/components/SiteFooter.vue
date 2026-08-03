<script setup lang="ts">
import type { SiteContent } from '../types';

defineProps<{ content: SiteContent }>();
</script>

<template>
  <footer class="site-footer">
    <p>
      <strong>LeankomStudio</strong><span>{{ content.common.footerTruth }}</span>
    </p>
    <nav aria-label="Footer">
      <RouterLink to="/services/">Services</RouterLink>
      <RouterLink to="/studio/">Studio</RouterLink>
      <RouterLink to="/privacy/">Privacy</RouterLink>
      <a href="https://github.com/jiay98528-dev/JotLuck">GitHub</a>
    </nav>
    <small>© 2026 灵狐科技（深圳）有限公司</small>
  </footer>
</template>
