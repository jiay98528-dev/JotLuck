<script setup lang="ts">
import { useLocale } from '../composables/useLocale';
import { usePageHead } from '../composables/usePageHead';
import { EXTERNAL, RELEASE } from '../release';
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
      <p class="pv-facts tech-rail">v{{ RELEASE.preview.version }} · Linux x86_64 (.deb)</p>
      <p class="pv-sha">
        <span class="pv-sha-label">SHA-256</span>
        <code>{{ RELEASE.preview.linuxDeb.sha256 }}</code>
      </p>
      <p class="pv-facts tech-rail">v{{ RELEASE.preview.version }} · macOS Apple Silicon (.dmg)</p>
      <p class="pv-sha">
        <span class="pv-sha-label">SHA-256</span>
        <code>{{ RELEASE.preview.macosDmg.sha256 }}</code>
      </p>
      <div class="pv-actions">
        <a class="btn btn-primary" :href="RELEASE.preview.downloadUrl" rel="noopener">
          <svg
            class="pf-icon"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M0,0H11.377V11.372H0ZM12.623,0H24V11.372H12.623ZM0,12.623H11.377V24H0Zm12.623,0H24V24H12.623"
            />
          </svg>
          {{ d().downloadBtn }}
        </a>
        <a class="btn btn-primary" :href="RELEASE.preview.linuxDeb.downloadUrl" rel="noopener">
          <svg
            class="pf-icon"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071.771-.06 1.592-.536 2.257-1.306.631-.765 1.683-1.084 2.378-1.503.348-.199.629-.469.649-.853.023-.4-.2-.811-.714-1.376v-.097l-.003-.003c-.17-.2-.25-.535-.338-.926-.085-.401-.182-.786-.492-1.046h-.003c-.059-.054-.123-.067-.188-.135a.357.357 0 00-.19-.064c.431-1.278.264-2.55-.173-3.694-.533-1.41-1.465-2.638-2.175-3.483-.796-1.005-1.576-1.957-1.56-3.368.026-2.152.236-6.133-3.544-6.139zm.529 3.405h.013c.213 0 .396.062.584.198.19.135.33.332.438.533.105.259.158.459.166.724 0-.02.006-.04.006-.06v.105a.086.086 0 01-.004-.021l-.004-.024a1.807 1.807 0 01-.15.706.953.953 0 01-.213.335.71.71 0 00-.088-.042c-.104-.045-.198-.064-.284-.133a1.312 1.312 0 00-.22-.066c.05-.06.146-.133.183-.198.053-.128.082-.264.088-.402v-.02a1.21 1.21 0 00-.061-.4c-.045-.134-.101-.2-.183-.333-.084-.066-.167-.132-.267-.132h-.016c-.093 0-.176.03-.262.132a.8.8 0 00-.205.334 1.18 1.18 0 00-.09.4v.019c.002.089.008.179.02.267-.193-.067-.438-.135-.607-.202a1.635 1.635 0 01-.018-.2v-.02a1.772 1.772 0 01.15-.768c.082-.22.232-.406.43-.533a.985.985 0 01.594-.2zm-2.962.059h.036c.142 0 .27.048.399.135.146.129.264.288.344.465.09.199.14.4.153.667v.004c.007.134.006.2-.002.266v.08c-.03.007-.056.018-.083.024-.152.055-.274.135-.393.2.012-.09.013-.18.003-.267v-.015c-.012-.133-.04-.2-.082-.333a.613.613 0 00-.166-.267.248.248 0 00-.183-.064h-.021c-.071.006-.13.04-.186.132a.552.552 0 00-.12.27.944.944 0 00-.023.33v.015c.012.135.037.2.08.334.046.134.098.2.166.268.01.009.02.018.034.024-.07.057-.117.07-.176.136a.304.304 0 01-.131.068 2.62 2.62 0 01-.275-.402 1.772 1.772 0 01-.155-.667 1.759 1.759 0 01.08-.668 1.43 1.43 0 01.283-.535c.128-.133.26-.2.418-.2zm1.37 1.706c.332 0 .733.065 1.216.399.293.2.523.269 1.052.468h.003c.255.136.405.266.478.399v-.131a.571.571 0 01.016.47c-.123.31-.516.643-1.063.842v.002c-.268.135-.501.333-.775.465-.276.135-.588.292-1.012.267a1.139 1.139 0 01-.448-.067 3.566 3.566 0 01-.322-.198c-.195-.135-.363-.332-.612-.465v-.005h-.005c-.4-.246-.616-.512-.686-.71-.07-.268-.005-.47.193-.6.224-.135.38-.271.483-.336.104-.074.143-.102.176-.131h.002v-.003c.169-.202.436-.47.839-.601.139-.036.294-.065.466-.065zm2.8 2.142c.358 1.417 1.196 3.475 1.735 4.473.286.534.855 1.659 1.102 3.024.156-.005.33.018.513.064.646-1.671-.546-3.467-1.089-3.966-.22-.2-.232-.335-.123-.335.59.534 1.365 1.572 1.646 2.757.13.535.16 1.104.021 1.67.067.028.135.06.205.067 1.032.534 1.413.938 1.23 1.537v-.043c-.06-.003-.12 0-.18 0h-.016c.151-.467-.182-.825-1.065-1.224-.915-.4-1.646-.336-1.77.465-.008.043-.013.066-.018.135-.068.023-.139.053-.209.064-.43.268-.662.669-.793 1.187-.13.533-.17 1.156-.205 1.869v.003c-.02.334-.17.838-.319 1.35-1.5 1.072-3.58 1.538-5.348.334a2.645 2.645 0 00-.402-.533 1.45 1.45 0 00-.275-.333c.182 0 .338-.03.465-.067a.615.615 0 00.314-.334c.108-.267 0-.697-.345-1.163-.345-.467-.931-.995-1.788-1.521-.63-.4-.986-.87-1.15-1.396-.165-.534-.143-1.085-.015-1.645.245-1.07.873-2.11 1.274-2.763.107-.065.037.135-.408.974-.396.751-1.14 2.497-.122 3.854a8.123 8.123 0 01.647-2.876c.564-1.278 1.743-3.504 1.836-5.268.048.036.217.135.289.202.218.133.38.333.59.465.21.201.477.335.876.335.039.003.075.006.11.006.412 0 .73-.134.997-.268.29-.134.52-.334.74-.4h.005c.467-.135.835-.402 1.044-.7zm2.185 8.958c.037.6.343 1.245.882 1.377.588.134 1.434-.333 1.791-.765l.211-.01c.315-.007.577.01.847.268l.003.003c.208.199.305.53.391.876.085.4.154.78.409 1.066.486.527.645.906.636 1.14l.003-.007v.018l-.003-.012c-.015.262-.185.396-.498.595-.63.401-1.746.712-2.457 1.57-.618.737-1.37 1.14-2.036 1.191-.664.053-1.237-.2-1.574-.898l-.005-.003c-.21-.4-.12-1.025.056-1.69.176-.668.428-1.344.463-1.897.037-.714.076-1.335.195-1.814.12-.465.308-.797.641-.984l.045-.022zm-10.814.049h.01c.053 0 .105.005.157.014.376.055.706.333 1.023.752l.91 1.664.003.003c.243.533.754 1.064 1.189 1.637.434.598.77 1.131.729 1.57v.006c-.057.744-.48 1.148-1.125 1.294-.645.135-1.52.002-2.395-.464-.968-.536-2.118-.469-2.857-.602-.369-.066-.61-.2-.723-.4-.11-.2-.113-.602.123-1.23v-.004l.002-.003c.117-.334.03-.752-.027-1.118-.055-.401-.083-.71.043-.94.16-.334.396-.4.69-.533.294-.135.64-.202.915-.47h.002v-.002c.256-.268.445-.601.668-.838.19-.201.38-.336.663-.336zm7.159-9.074c-.435.201-.945.535-1.488.535-.542 0-.97-.267-1.28-.466-.154-.134-.28-.268-.373-.335-.164-.134-.144-.333-.074-.333.109.016.129.134.199.2.096.066.215.2.36.333.292.2.68.467 1.167.467.485 0 1.053-.267 1.398-.466.195-.135.445-.334.648-.467.156-.136.149-.267.279-.267.128.016.034.134-.147.332a8.097 8.097 0 01-.69.468zm-1.082-1.583V5.64c-.006-.02.013-.042.029-.05.074-.043.18-.027.26.004.063 0 .16.067.15.135-.006.049-.085.066-.135.066-.055 0-.092-.043-.141-.068-.052-.018-.146-.008-.163-.065zm-.551 0c-.02.058-.113.049-.166.066-.047.025-.086.068-.14.068-.05 0-.13-.02-.136-.068-.01-.066.088-.133.15-.133.08-.031.184-.047.259-.005.019.009.036.03.03.05v.02h.003z"
            />
          </svg>
          {{ d().downloadBtnLinux }}
        </a>
        <a class="btn btn-primary" :href="RELEASE.preview.macosDmg.downloadUrl" rel="noopener">
          <svg
            class="pf-icon"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
            />
          </svg>
          {{ d().downloadBtnMac }}
        </a>
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
