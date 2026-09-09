<script setup lang="ts">
/**
 * 更新日志页：渲染 sync-changelog.mjs 同步的 GitHub Releases 数据。
 * 说明正文为发行原文（英文），经 marked 在构建期渲染；事实值（版本/日期/链接）随数据文件走。
 */
import { computed } from 'vue';
import { marked } from 'marked';
import { useLocale } from '../composables/useLocale';
import { usePageHead } from '../composables/usePageHead';
import changelogData from '../content/changelog.data.json';

const { content } = useLocale();
usePageHead('changelog');
const c = () => content.value.changelog;

const entries = computed(() =>
  changelogData.releases.map((r) => ({
    ...r,
    dateLabel: new Date(r.dateISO).toISOString().slice(0, 10),
    html: marked.parse(r.bodyMD, { async: false }) as string,
  })),
);
</script>

<template>
  <article class="changelog-page page-flow">
    <header class="page-head">
      <p class="head-eyebrow tech-rail">{{ c().eyebrow }}</p>
      <h1>{{ c().title }}</h1>
      <p class="head-lead">{{ c().lead }}</p>
    </header>

    <ol class="releases">
      <li v-for="r in entries" :key="r.tag" class="release paper-sheet tex-2">
        <div class="release-head">
          <span class="release-tag">{{ r.tag }}</span>
          <time class="release-date" :datetime="r.dateISO">{{ r.dateLabel }}</time>
          <span v-if="r.prerelease" class="release-state">Preview</span>
        </div>
        <p v-if="r.name && r.name !== r.tag" class="release-name">{{ r.name }}</p>
        <!-- 发行说明为 Owner 自己发布的原文，构建期 marked 渲染 -->
        <div class="release-notes" v-html="r.html"></div>
        <a class="release-link" :href="r.url" target="_blank" rel="noopener">
          {{ c().githubLink }} ↗
        </a>
      </li>
    </ol>
  </article>
</template>

<style scoped>
.releases {
  list-style: none;
  margin: 40px 0 0;
  padding: 0;
}
.release {
  padding: clamp(20px, 3vw, 32px);
}
.release + .release {
  margin-top: 20px;
}
.release-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px clamp(14px, 2vw, 24px);
}
.release-tag {
  font-family: var(--font-mono);
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--ink);
}
.release-date {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  color: var(--ink-50);
}
.release-state {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--ink-70);
  border: 1px solid var(--ink-30);
  border-radius: var(--r-compact);
  padding: 1px 8px;
}
.release-name {
  margin-top: 6px;
  font-weight: 600;
}
.release-notes {
  margin-top: 10px;
  max-width: 46em;
  color: var(--ink-70);
}
.release-notes :deep(h3) {
  margin: 14px 0 4px;
  font-size: 0.9rem;
  font-family: var(--font-mono);
  letter-spacing: 0.02em;
  color: var(--ink);
}
.release-notes :deep(ul) {
  margin: 6px 0;
  padding-left: 1.2em;
  list-style: disc;
}
.release-notes :deep(li) {
  margin: 3px 0;
}
.release-notes :deep(p) {
  margin: 6px 0;
}
.release-notes :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.85em;
}
.release-link {
  display: inline-block;
  margin-top: 12px;
  color: var(--teal);
  text-underline-offset: 0.18em;
}
@media (max-width: 720px) {
  .release {
    padding: 18px 16px;
  }
}
</style>
