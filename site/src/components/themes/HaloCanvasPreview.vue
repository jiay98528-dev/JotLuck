<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import SvgInlineText from './SvgInlineText.vue';
import { wrapText, widthUnits } from '../../lib/inline-marks';
import type { ThemeHaloNote, ThemePreviewUi, ThemeSampleNote } from '../../content/types';

/**
 * Halo Canvas 主题 1:1 SVG 重绘（临摹真实应用桌面截图，viewBox 1280×860）。
 * 浮动画布：书签卡 / 编辑卡 / 面板卡三卡悬浮于平涂暖纸底（契约禁渐变，
 * 配色按实机截图逐点采样：底 (252,250,244)、左卡 (237,231,226)、
 * 编辑卡 (254,252,248)、右卡 (253,248,241)、墨字 (63,57,51)）。
 * 正文与 Paper/Lumen 共享 sampleNote（示例文本只维护一份），
 * frame（haloNote）仅提供侧栏/标签页/frontmatter 等界面框架。
 * 模拟操作（一次性）：入视口后光标出现 → 逐字键入 typedBullet（含 [[wikilink]]）
 * → 状态栏 未保存 → 已保存；点击/回车重播；reduced-motion 直接呈完成态。
 */
const props = defineProps<{ ui: ThemePreviewUi; note: ThemeSampleNote; frame: ThemeHaloNote }>();

const introLines = computed(() => wrapText(props.note.intro, 94));
const sectionY = computed(() => 462 + (introLines.value.length - 1) * 20);
const bulletY = (i: number) => sectionY.value + 40 + i * 24;
/** 模拟键入行（bullets 之下预留的槽位）与引文行 */
const typedY = computed(() => bulletY(props.note.bullets.length));
const quoteY = computed(() => typedY.value + 48);

const dotColors = ['#e8833a', '#8b7bd8', '#e8833a', '#5cae7c', '#d9b13b'];
const rowY = (i: number) => 148 + i * 76;

// 工具条流动定位：模板 → 正文▾ → B I S </> ↗ → 清除格式（13px 字 → 单位 × 6.5）
const ui13 = (s: string) => Math.ceil(widthUnits(s) * 6.5);
const div1X = computed(() => 330 + ui13(props.ui.templates) + 14);
const bodyX = computed(() => div1X.value + 16);
const bodyChevX = computed(() => bodyX.value + ui13(props.ui.body) + 8);
const fmtBX = computed(() => bodyChevX.value + 26);
const fmtIX = computed(() => fmtBX.value + 30);
const fmtSX = computed(() => fmtIX.value + 28);
const fmtMonoX = computed(() => fmtSX.value + 34);
const fmtArrowX = computed(() => fmtMonoX.value + 46);
const div2X = computed(() => fmtArrowX.value + 24);
const clearX = computed(() => div2X.value + 18);

/* ---------- 模拟操作：逐字键入 → 保存翻牌 ---------- */
const rootEl = ref<HTMLElement | null>(null);
const typed = ref('');
const saved = ref(true);
const cursorOn = ref(false);
const running = ref(false);
let timers: number[] = [];

const typedDone = computed(() => typed.value.length === props.frame.typedBullet.length);
/** 光标 x：bullet 文本起点 305 + 已键入宽度（14px 字 → 单位 × 7） */
const cursorX = computed(() => 305 + widthUnits(typed.value) * 7);

function clearTimers() {
  for (const t of timers) clearTimeout(t);
  timers = [];
}
/** reduced-motion / 截图链路：直接呈完成态 */
function finish() {
  clearTimers();
  typed.value = props.frame.typedBullet;
  saved.value = true;
  cursorOn.value = false;
  running.value = false;
}
function run() {
  if (running.value) return;
  running.value = true;
  clearTimers();
  typed.value = '';
  saved.value = false;
  cursorOn.value = true;
  const text = props.frame.typedBullet;
  for (let i = 1; i <= text.length; i++) {
    timers.push(
      window.setTimeout(
        () => {
          typed.value = text.slice(0, i);
        },
        350 + i * 55,
      ),
    );
  }
  timers.push(
    window.setTimeout(
      () => {
        saved.value = true;
        cursorOn.value = false;
        running.value = false;
      },
      350 + text.length * 55 + 900,
    ),
  );
}

onMounted(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    finish();
    return;
  }
  const el = rootEl.value;
  if (!el || !('IntersectionObserver' in window)) {
    run();
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          run();
          io.disconnect();
        }
      }
    },
    { threshold: 0.35 },
  );
  io.observe(el);
});
onBeforeUnmount(clearTimers);
</script>

<template>
  <div
    ref="rootEl"
    class="halo-mock"
    role="button"
    tabindex="0"
    :aria-label="ui.replay"
    :title="ui.replay"
    @click="run"
    @keydown.enter.prevent="run"
    @keydown.space.prevent="run"
  >
    <svg
      class="halo-preview"
      viewBox="0 0 1280 860"
      role="img"
      :aria-label="note.title"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <filter id="halo-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow
            dx="0"
            dy="8"
            stdDeviation="18"
            flood-color="#4a3f2e"
            flood-opacity="0.10"
          />
        </filter>
      </defs>

      <!-- 平涂暖纸底（真实应用即平涂，契约禁渐变） -->
      <rect width="1280" height="860" fill="#fcfaf4" />

      <!-- 左：书签卡 -->
      <g filter="url(#halo-shadow)">
        <rect x="16" y="16" width="230" height="828" rx="14" class="hc-card-side" />
      </g>
      <rect x="119" y="34" width="24" height="20" rx="3" class="hc-icon-ghost" />
      <line x1="131" y1="34" x2="131" y2="54" class="hc-icon-line" />
      <line x1="16" y1="72" x2="246" y2="72" class="hc-hairline" />
      <text x="32" y="105" class="hc-recent">{{ ui.recent.toUpperCase() }}</text>
      <template v-for="(name, i) in frame.files" :key="name">
        <rect
          v-if="i === 0"
          :x="28"
          :y="rowY(0) - 24"
          width="206"
          height="50"
          rx="8"
          class="hc-row-sel"
        />
        <circle cx="40" :cy="rowY(i) - 8" r="3.5" :fill="dotColors[i]" />
        <text x="54" :y="rowY(i) - 4" class="hc-row-name" :class="{ 'hc-row-on': i === 0 }">
          {{ name }}
        </text>
        <text x="54" :y="rowY(i) + 14" class="hc-row-path">{{ frame.filePaths[i] }}</text>
      </template>

      <!-- 中：编辑卡 -->
      <g filter="url(#halo-shadow)">
        <rect x="260" y="16" width="746" height="828" rx="14" class="hc-card-editor" />
      </g>
      <line x1="288" y1="40" x2="288" y2="52" class="hc-icon-strong" />
      <line x1="282" y1="46" x2="294" y2="46" class="hc-icon-strong" />
      <rect x="314" y="37" width="16" height="13" rx="2" class="hc-icon-ghost" />
      <rect x="314" y="34" width="9" height="4" rx="1.5" class="hc-icon-ghost" />
      <text x="344" y="42" class="hc-ui-strong">{{ frame.notebook }}</text>
      <text x="344" y="60" class="hc-ui-strong">{{ frame.files[0] }}</text>
      <rect x="565" y="30" width="310" height="28" rx="8" class="hc-search" />
      <circle cx="582" cy="43" r="5" class="hc-icon-ghost" />
      <line x1="586" y1="47" x2="590" y2="51" class="hc-icon-line" />
      <text x="598" y="48" class="hc-muted-13">{{ ui.searchShortcut }}</text>
      <rect x="888" y="36" width="14" height="14" rx="2" class="hc-icon-ghost" />
      <line x1="895" y1="36" x2="895" y2="50" class="hc-icon-line" />
      <circle cx="922" cy="43" r="7" class="hc-icon-ghost" />
      <circle cx="922" cy="43" r="2.4" class="hc-dot-grey" />
      <rect x="942" y="34" width="16" height="18" rx="2" class="hc-icon-ghost" />
      <line x1="950" y1="34" x2="950" y2="52" class="hc-icon-line" />
      <line x1="260" y1="72" x2="1006" y2="72" class="hc-hairline" />

      <!-- 工具条 pill（按文字宽度流动定位） -->
      <rect x="286" y="88" width="694" height="42" rx="9" class="hc-toolbar" />
      <rect x="304" y="100" width="18" height="14" rx="2" class="hc-icon-ghost" />
      <line x1="307" y1="103" x2="319" y2="103" class="hc-icon-line" />
      <text x="330" y="114" class="hc-ui">{{ ui.templates }}</text>
      <line :x1="div1X" y1="98" :x2="div1X" y2="120" class="hc-hairline" />
      <text :x="bodyX" y="114" class="hc-ui">{{ ui.body }}</text>
      <path :d="`M${bodyChevX} 106 l4 5 4 -5`" class="hc-icon-line" />
      <text :x="fmtBX" y="115" class="hc-fmt">B</text>
      <text :x="fmtIX" y="115" class="hc-fmt italic">I</text>
      <text :x="fmtSX" y="115" class="hc-fmt strike">S</text>
      <text :x="fmtMonoX" y="115" class="hc-fmt mono">&lt;/&gt;</text>
      <text :x="fmtArrowX" y="115" class="hc-fmt">↗</text>
      <line :x1="div2X" y1="98" :x2="div2X" y2="120" class="hc-hairline" />
      <text :x="clearX" y="114" class="hc-muted-13">{{ ui.clearFormat }}</text>

      <!-- frontmatter（暖纸衬块，临摹真实截图） -->
      <rect x="282" y="148" width="700" height="152" rx="8" class="hc-fm-block" />
      <text x="298" y="172" class="hc-fm">---</text>
      <text x="298" y="191" class="hc-fm">title: {{ frame.frontmatterTitle }}</text>
      <text x="298" y="210" class="hc-fm">tags:</text>
      <text x="314" y="229" class="hc-fm">- {{ frame.frontmatterTags[0] }}</text>
      <text x="314" y="248" class="hc-fm">- {{ frame.frontmatterTags[1] }}</text>
      <text x="298" y="267" class="hc-fm">created: 2026-06-01</text>
      <text x="298" y="286" class="hc-fm">---</text>

      <!-- 正文（与 Paper/Lumen 共享 sampleNote） -->
      <text x="290" y="360" class="hc-h1">{{ note.title }}</text>
      <text v-for="(line, i) in introLines" :key="line" x="290" :y="400 + i * 20" class="hc-body">
        {{ line }}
      </text>
      <text x="290" :y="sectionY" class="hc-h2">{{ note.section }}</text>
      <g v-for="(b, i) in note.bullets" :key="b">
        <text x="290" :y="bulletY(i)" class="hc-body">·</text>
        <SvgInlineText :x="305" :y="bulletY(i)" :src="b" />
      </g>

      <!-- 模拟键入行：打字中呈纯文本，完成后换行内标记渲染（[[wikilink]] 高亮） -->
      <template v-if="typed">
        <text x="290" :y="typedY" class="hc-body">·</text>
        <SvgInlineText v-if="typedDone" :x="305" :y="typedY" :src="frame.typedBullet" />
        <text v-else x="305" :y="typedY" class="hc-body">{{ typed }}</text>
      </template>
      <rect v-if="cursorOn" :x="cursorX" :y="typedY - 12" width="2" height="15" class="hc-cursor" />

      <rect x="288" :y="quoteY - 14" width="3" height="18" class="hc-quote-bar" />
      <text x="300" :y="quoteY" class="hc-quote">{{ note.quoteLine }}</text>

      <!-- 状态栏 -->
      <line x1="280" y1="800" x2="986" y2="800" class="hc-hairline" />
      <text x="300" y="824" class="hc-status">{{ note.statusLeft }} · {{ ui.ready }}</text>
      <text x="815" y="824" class="hc-status-strong">⇩ {{ ui.exportAction }}</text>
      <text x="890" y="824" class="hc-status-strong">⌗ {{ ui.share }}</text>
      <text x="965" y="824" :class="saved ? 'hc-saved' : 'hc-unsaved'">
        {{ saved ? '✓ ' + ui.saved : '● ' + ui.unsaved }}
      </text>

      <!-- 右：面板卡 -->
      <g filter="url(#halo-shadow)">
        <rect x="1020" y="16" width="244" height="828" rx="14" class="hc-card-panel" />
      </g>
      <line x1="1042" y1="42" x2="1050" y2="42" class="hc-icon-line" />
      <line x1="1042" y1="46" x2="1050" y2="46" class="hc-icon-line" />
      <line x1="1042" y1="50" x2="1050" y2="50" class="hc-icon-line" />
      <text x="1058" y="48" class="hc-ui-strong">{{ ui.outline }}</text>
      <circle cx="1218" cy="43" r="8" class="hc-badge" />
      <text x="1218" y="47" text-anchor="middle" class="hc-badge-text">1</text>
      <text x="1246" y="48" text-anchor="end" class="hc-muted-13">‹</text>
      <text x="1045" y="85" class="hc-ui-strong">{{ note.title }}</text>
      <text x="1045" y="110" class="hc-ui">{{ note.section }}</text>
      <line x1="1020" y1="140" x2="1264" y2="140" class="hc-hairline" />
      <path d="M1042 166 q4 -4 8 0 q-4 4 -8 0 m4 -4 l2 6" class="hc-icon-line" />
      <text x="1058" y="170" class="hc-ui-strong">{{ ui.backlinks }}</text>
      <circle cx="1218" cy="165" r="8" class="hc-badge" />
      <text x="1218" y="169" text-anchor="middle" class="hc-badge-text">3</text>
      <text x="1246" y="170" text-anchor="end" class="hc-muted-13">‹</text>
      <text x="1045" y="208" class="hc-ui">{{ frame.files[4] }}</text>
      <text x="1045" y="242" class="hc-ui">{{ frame.files[2] }}</text>
      <text x="1045" y="276" class="hc-ui">{{ frame.files[1] }}</text>
      <line x1="1020" y1="310" x2="1264" y2="310" class="hc-hairline" />
      <path d="M1042 332 l4 4 -4 4 -4 -4 z m4 4 l5 0" class="hc-icon-line" />
      <text x="1058" y="338" class="hc-ui-strong">{{ ui.tags }}</text>
      <text x="1246" y="338" text-anchor="end" class="hc-muted-13">‹</text>
      <text x="1142" y="378" text-anchor="middle" class="hc-muted-13">{{ ui.noTags }}</text>
      <rect x="1192" y="772" width="62" height="26" rx="10" class="hc-pill" />
      <text x="1223" y="789" text-anchor="middle" class="hc-muted-13">{{ ui.syntax }}</text>
    </svg>
  </div>
</template>

<style scoped>
.halo-mock {
  cursor: pointer;
  border-radius: inherit;
}
.halo-mock:focus-visible {
  outline: 2px solid var(--orange);
  outline-offset: 2px;
}
.halo-preview {
  display: block;
  width: 100%;
  height: auto;
  font-family: var(--font-body);
  /* 行内标记着色变量：正文墨、活链蓝、标签钢蓝 */
  --mk-body-fill: #3f3933;
  --mk-wiki-fill: #5b7fb8;
  --mk-wiki-deco-color: #a8c0dd;
  --mk-tag-fill: #5b7fb8;
}
.halo-preview text {
  fill: #3f3933;
}
.hc-card-side {
  fill: #ede7e2;
  stroke: #e2d9cd;
  stroke-width: 1;
}
.hc-card-editor {
  fill: #fefcf8;
  stroke: #e7dfd2;
  stroke-width: 1;
}
.hc-card-panel {
  fill: #fdf8f1;
  stroke: #e7dfd2;
  stroke-width: 1;
}
.hc-hairline {
  stroke: #ece4d6;
  stroke-width: 1;
}
.hc-icon-ghost {
  fill: none;
  stroke: #a39a8d;
  stroke-width: 1.2;
}
.hc-icon-line {
  stroke: #a39a8d;
  stroke-width: 1.2;
  fill: none;
}
.hc-icon-strong {
  stroke: #6e655a;
  stroke-width: 1.6;
}
.hc-dot-grey {
  fill: #a39a8d;
}
.hc-recent {
  font-size: 10px;
  letter-spacing: 0.12em;
  fill: #b3aa9c !important;
}
.hc-row-sel {
  fill: #fbefef;
}
.hc-row-name {
  font-size: 13px;
}
.hc-row-on {
  font-weight: 700;
}
.hc-row-path {
  font-size: 11px;
  fill: #a39a8d !important;
}
.hc-ui {
  font-size: 13px;
}
.hc-ui-strong {
  font-size: 13px;
  font-weight: 700;
}
.hc-muted-13 {
  font-size: 13px;
  fill: #a39a8d !important;
}
.hc-search {
  fill: #f5f0e6;
}
.hc-toolbar {
  fill: #f5f1e8;
}
.hc-fmt {
  font-size: 13px;
  font-weight: 600;
  fill: #6e655a !important;
}
.hc-fmt.italic {
  font-style: italic;
}
.hc-fmt.strike {
  text-decoration: line-through;
}
.hc-fmt.mono {
  font-family: var(--font-mono);
  font-size: 11px;
}
.hc-fm-block {
  fill: #f4eee6;
  stroke: #e6dcc9;
  stroke-width: 1;
}
.hc-fm {
  font-family: var(--font-mono);
  font-size: 12px;
  fill: #a39a8d !important;
}
.hc-h1 {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.hc-h2 {
  font-size: 18px;
  font-weight: 700;
}
.hc-body {
  font-size: 14px;
}
.hc-quote-bar {
  fill: #d8cbb6;
}
.hc-quote {
  font-size: 13px;
  fill: #8a8378 !important;
}
.hc-cursor {
  fill: #6e655a;
  animation: hc-blink 0.85s steps(2, end) infinite;
}
@keyframes hc-blink {
  50% {
    opacity: 0;
  }
}
.hc-status {
  font-size: 12px;
  fill: #a39a8d !important;
}
.hc-status-strong {
  font-size: 12px;
  font-weight: 600;
  fill: #6e655a !important;
}
.hc-saved {
  font-size: 12px;
  font-weight: 600;
  fill: #74bda9 !important;
}
.hc-unsaved {
  font-size: 12px;
  font-weight: 600;
  fill: #d08a45 !important;
}
.hc-badge {
  fill: #efe9dc;
}
.hc-badge-text {
  font-size: 10px;
  font-weight: 700;
  fill: #6e655a !important;
}
.hc-pill {
  fill: #fbf8f0;
  stroke: #e8dfcd;
}
</style>
