<script setup lang="ts">
import { useLocale } from '../composables/useLocale';
import { usePageHead } from '../composables/usePageHead';
import { EXTERNAL, RELEASE, SITE_URL } from '../release';
import { pagePath } from '../router';

const { locale, content } = useLocale();
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

    <template v-if="RELEASE.current">
      <!-- 发布状态：邮戳日期卡 + 黄书签。事实来自 public/updates/v1.json -->
      <section class="release-status" aria-labelledby="rs-title">
        <div class="status-card paper-sheet tex-2">
          <span id="rs-title" class="status-bookmark">{{ d().statusLabel }}</span>
          <p class="status-value">{{ d().statusValue }}</p>
          <p class="status-stamp" aria-hidden="true">
            <span>{{ RELEASE.current.dateISO }}</span>
          </p>
        </div>
      </section>

      <!-- 每个平台独立展示自己的发布事实：当前 preview 缺少的平台回退到 archive/0.14。 -->
      <section class="preview-dl" aria-labelledby="pv-title">
        <h2 id="pv-title">{{ d().previewTitle }}</h2>
        <p class="pv-facts tech-rail">{{ RELEASE.platform }}</p>
        <div class="platform-downloads">
          <article
            v-for="(platform, i) in RELEASE.platforms"
            :key="platform?.asset.name ?? i"
            class="platform-download"
          >
            <h3>{{ d().platforms[i]?.name }}</h3>
            <p v-if="platform" class="pv-facts tech-rail">
              v{{ platform.version }} · {{ platform.asset.arch }} · {{ platform.asset.packageType }}
            </p>
            <p v-if="platform" class="pv-sha">
              <span class="pv-sha-label">SHA-256</span>
              <code>{{ platform.asset.sha256 }}</code>
            </p>
            <div v-if="platform" class="pv-actions">
              <a class="btn btn-primary" :href="platform.asset.url" rel="noopener">
                {{ [d().downloadBtn, d().downloadBtnMac, d().downloadBtnLinux][i] }}
              </a>
              <a class="btn btn-secondary" :href="platform.releaseUrl" rel="noopener">{{
                d().releaseBtn
              }}</a>
              <a
                v-if="platform.asset.os === 'macos' && platform.isCurrent"
                class="btn btn-secondary"
                :href="`${SITE_URL}/downloads/${encodeURIComponent(platform.asset.name)}`"
                rel="noopener"
              >
                {{ d().downloadBtnMacMirror }}
              </a>
            </div>
            <p v-else class="pv-facts">{{ d().platforms[i]?.state }}</p>
            <p v-if="platform && !platform.isCurrent" class="quip">
              {{ d().previousVersionLabel }}
            </p>
          </article>
        </div>
        <div class="pv-actions">
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
        </div>
        <p class="pv-sign quip">
          {{ d().signNote }}
          <a class="pv-policy" :href="EXTERNAL.codeSigning" rel="noopener"
            >{{ d().signPolicyLink }} ↗</a
          >
        </p>
      </section>
    </template>

    <section v-else class="release-status" aria-labelledby="rs-title">
      <div class="status-card paper-sheet tex-2">
        <span id="rs-title" class="status-bookmark">{{ d().statusLabel }}</span>
        <p class="status-value">{{ d().statusValue }}</p>
      </div>
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

    <p class="quip">
      <RouterLink :to="pagePath(locale, 'changelog')">{{ d().changelogLink }} →</RouterLink>
    </p>
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
.platform-downloads {
  margin-top: 24px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}
.platform-download {
  min-width: 0;
  padding: 20px;
  border: 1px solid var(--ink-14);
  background: color-mix(in srgb, var(--paper) 78%, transparent);
}
.platform-download h3 {
  font-size: 1rem;
  font-weight: 650;
}
.platform-download .pv-sha {
  min-height: 3.5em;
}
.pv-actions {
  margin-top: 24px;
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}
/* 三平台平权：下载组统一 btn-primary 深青（GitHub/Release 保持 btn-secondary 辅助层级）。
   hover/focus-visible 变色高亮：背景以 color-mix 向炭墨压深 15%（同族深青，不引入新硬编码色），
   再叠套准橙 inset 印记呼应印刷语言——hover=底部套印色条，focus=全内框（与全局橙 outline 环同族加强）。
   变色/阴影均走 .btn 既有 130ms transition（background-color、box-shadow 已在过渡列表），无需重声明。 */
.pv-actions .btn-primary:hover,
.pv-actions .btn-primary:focus-visible {
  background-color: color-mix(in oklch, var(--teal) 85%, var(--ink));
}
.pv-actions .btn-primary:hover {
  box-shadow:
    var(--shadow-stack),
    inset 0 -3px 0 var(--orange);
}
.pv-actions .btn-primary:focus-visible {
  box-shadow:
    var(--shadow-stack),
    inset 0 0 0 2px var(--orange);
}
/* GitHub 分流按钮图标（裁决 39）：品牌 mark 随控件基线，fill=currentColor */
.gh-icon {
  width: 15px;
  height: 15px;
  flex: none;
}
/* 平台下载按钮图标：三平台品牌 mark 与 gh-icon 同尺寸同规则，fill=currentColor 继承主/次按钮文字色 */
.pf-icon {
  width: 15px;
  height: 15px;
  flex: none;
}
@media (max-width: 860px) {
  .platform-downloads {
    grid-template-columns: 1fr;
  }
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
