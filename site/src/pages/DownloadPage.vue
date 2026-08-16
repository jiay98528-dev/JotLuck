<script setup lang="ts">
import { useLocale } from '../composables/useLocale';
import { usePageHead } from '../composables/usePageHead';
import { EXTERNAL, RELEASE } from '../release';

const { content } = useLocale();
usePageHead('download');
const d = () => content.value.download;
</script>

<template>
  <article class="download-page page-flow">
    <header class="page-head">
      <p class="head-eyebrow tech-rail">{{ d().eyebrow }}</p>
      <h1>{{ d().title }}</h1>
      <p class="head-lead">{{ d().lead }}</p>
    </header>

    <!-- 发布状态：邮戳日期卡 + 黄书签。邮戳日期 = Preview 上架日（RELEASE.preview.dateISO 单点派生） -->
    <section class="release-status" aria-labelledby="rs-title">
      <div class="status-card paper-sheet tex-2">
        <span id="rs-title" class="status-bookmark">{{ d().statusLabel }}</span>
        <p class="status-value">{{ d().statusValue }}</p>
        <p class="status-stamp" aria-hidden="true">
          <span>{{ RELEASE.preview.dateISO }}</span>
        </p>
      </div>
    </section>

    <!-- Preview 下载区（裁决 33）：事实值引自 release.ts RELEASE.preview 单点事实源；
         SHA-256 完整显示（可换行），校验场景必须看得到全部 64 位 -->
    <section class="preview-dl" aria-labelledby="pv-title">
      <h2 id="pv-title">{{ d().previewTitle }}</h2>
      <p class="pv-facts tech-rail">
        v{{ RELEASE.preview.version }} · {{ RELEASE.preview.dateISO }} · {{ RELEASE.platform }}
      </p>
      <p class="pv-sha">
        <span class="pv-sha-label">SHA-256</span>
        <code>{{ RELEASE.preview.sha256 }}</code>
      </p>
      <div class="pv-actions">
        <a class="btn btn-primary" :href="RELEASE.preview.downloadUrl" rel="noopener">{{
          d().downloadBtn
        }}</a>
        <a class="btn btn-secondary" :href="EXTERNAL.githubReleases" rel="noopener">
          <svg
            class="gh-icon"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
            />
          </svg>
          {{ d().githubBtn }}
        </a>
        <a class="btn btn-secondary" :href="RELEASE.preview.tagUrl" rel="noopener">{{
          d().releaseBtn
        }}</a>
      </div>
      <p class="pv-sign quip">
        {{ d().signNote }}
        <a class="pv-policy" :href="EXTERNAL.codeSigning" rel="noopener"
          >{{ d().signPolicyLink }} ↗</a
        >
      </p>
    </section>

    <section class="platforms" aria-labelledby="pf-title">
      <h2 id="pf-title">{{ d().platformTitle }}</h2>
      <ul>
        <li v-for="(p, i) in d().platforms" :key="p.name" :data-first="i === 0 || undefined">
          <span class="pf-name">{{ p.name }}</span>
          <span class="pf-state tech-rail">{{ p.state }}</span>
        </li>
      </ul>
    </section>

    <!-- 诚实说明 -->
    <section class="honesty" aria-labelledby="hn-title">
      <div class="honesty-text">
        <h2 id="hn-title">{{ d().honestyTitle }}</h2>
        <p>{{ d().honestyBody }}</p>
        <a class="btn btn-secondary releases-link" :href="EXTERNAL.githubRepo" rel="noopener"
          >GitHub</a
        >
      </div>
    </section>

    <section class="notes" aria-labelledby="nt-title">
      <h2 id="nt-title">{{ d().notesTitle }}</h2>
      <ul>
        <li v-for="note in d().notes" :key="note">
          <span class="note-tick" aria-hidden="true"></span>{{ note }}
        </li>
      </ul>
    </section>
  </article>
</template>

<style scoped>
.download-page {
  padding-bottom: 120px;
}

/* ---------- 邮戳日期卡 ---------- */
.status-card {
  position: relative;
  padding: clamp(28px, 4vw, 48px);
  padding-top: clamp(40px, 5vw, 64px);
}
.status-bookmark {
  position: absolute;
  top: -10px;
  left: clamp(24px, 3vw, 40px);
  padding: 4px 14px;
  background: var(--bookmark);
  color: var(--ink);
  font-size: 0.8125rem;
  font-weight: 700;
  border-radius: 6px 6px 2px 2px;
  box-shadow: 0 1px 0 var(--ink-14);
}
.status-value {
  font-size: clamp(1.25rem, 2vw, 1.625rem);
  font-weight: 700;
  letter-spacing: -0.01em;
}
.status-stamp {
  margin-top: 20px;
  display: inline-block;
  padding: 10px 22px;
  border: 2px solid var(--ink-30);
  border-radius: var(--r-compact);
  transform: rotate(-1.2deg);
  font-family: var(--font-mono);
  font-size: clamp(1.75rem, 4.5vw, 3rem);
  letter-spacing: 0.04em;
  line-height: 1.1;
}

/* ---------- Preview 下载区（裁决 33）：事实行 + 双按钮 + 签名提示 ---------- */
.preview-dl {
  margin-top: clamp(56px, 7vw, 88px);
  padding: clamp(28px, 4vw, 44px) 0;
  border-top: 1px solid var(--ink-14);
  border-bottom: 1px solid var(--ink-14);
}
.pv-facts {
  margin-top: 14px;
  color: var(--ink-70);
}
.pv-sha {
  margin-top: 10px;
  display: flex;
  gap: 12px;
  align-items: baseline;
  font-size: 0.8125rem;
  color: var(--ink-70);
}
.pv-sha code {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  word-break: break-all;
}
.pv-actions {
  margin-top: 24px;
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}
/* GitHub 分流按钮图标（裁决 39）：品牌 mark 随控件基线，fill=currentColor */
.gh-icon {
  width: 15px;
  height: 15px;
  flex: none;
}
.pv-sign {
  margin-top: 20px;
}
/* 代码签名政策链接（裁决 35）：与未签名提示同行，低注意力功能链 */
.pv-policy {
  color: var(--ink-70);
  text-decoration: underline;
  text-underline-offset: 3px;
  white-space: nowrap;
}
.pv-policy:hover {
  color: var(--orange);
}

/* ---------- 平台表：发丝分隔，状态用等宽栏 ---------- */
.platforms {
  margin-top: clamp(56px, 7vw, 88px);
}
.platforms h2,
.notes h2,
.honesty h2,
.preview-dl h2 {
  font-size: clamp(1.375rem, 2.2vw, 1.75rem);
  font-weight: 600;
  letter-spacing: -0.015em;
}
.platforms ul {
  margin-top: 20px;
}
.platforms li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 24px;
  padding: 16px 0;
  border-top: 1px solid var(--ink-14);
}
.platforms li:last-child {
  border-bottom: 1px solid var(--ink-14);
}
.pf-name {
  font-weight: 600;
}
.platforms li[data-first] .pf-name::before {
  content: '';
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 10px;
  background: var(--orange);
  border-radius: 2px;
  transform: translateY(-1px);
}
.pf-state {
  color: var(--ink-70);
  text-align: right;
}

/* ---------- 诚实说明 ---------- */
.honesty {
  margin-top: clamp(56px, 7vw, 88px);
  padding: clamp(28px, 4vw, 44px) 0;
  border-top: 1px solid var(--ink-14);
  border-bottom: 1px solid var(--ink-14);
}
.honesty-text p {
  margin-top: 14px;
  max-width: 38em;
  color: var(--ink-70);
}
.releases-link {
  margin-top: 24px;
}

/* ---------- 值得知道 ---------- */
.notes {
  margin-top: clamp(56px, 7vw, 88px);
}
.notes ul {
  margin-top: 20px;
  display: grid;
  gap: 14px;
}
.notes li {
  display: flex;
  align-items: baseline;
  gap: 12px;
  color: var(--ink-70);
}
.note-tick {
  flex: none;
  width: 7px;
  height: 7px;
  background: var(--orange);
  border-radius: 1.5px;
  transform: translateY(-1px);
}
</style>
