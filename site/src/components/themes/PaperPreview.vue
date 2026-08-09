<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import SvgInlineText from './SvgInlineText.vue';
import { wrapText, widthUnits } from '../../lib/inline-marks';
import type { ThemeHaloNote, ThemePreviewUi, ThemeSampleNote } from '../../content/types';

/**
 * Paper 主题 1:1 SVG 重绘（参照官方预览 paper-preview.webp，1280×800）。
 * 和纸满幅布局：细左栏 + 顶栏 + 工具条 + 编辑区 + 右侧面板 + 状态栏。
 * intro/quote 行随语言长度自动换行，文档流整体下移；
 * 工具条按钮按文字估算宽度动态收缩（fr「Instantané」等长词不溢出）。
 * 入场一次性（is-in）：▷即时按压 → 预览引文行浮起（模拟切换实时预览）；
 * reduced-motion 直接呈终态（见底部非 scoped 块）。
 * demo 模式（首页 Hero 仿真件）：is-in 后追加模拟操作序列——光标逐字键入
 * frame.typedBullet（含 [[wikilink]]，完成翻高亮）→ 状态栏 未保存→已保存；
 * 点击/回车重播。主题页不传 frame/demo，行为与版式不变。
 */
const props = defineProps<{
  ui: ThemePreviewUi;
  note: ThemeSampleNote;
  frame?: ThemeHaloNote;
  demo?: boolean;
}>();

/* ---------- 入场：入视口一次性 is-in；demo 模式随后启动键入序列 ---------- */
const rootEl = ref<SVGSVGElement | null>(null);
const typed = ref('');
const saved = ref(true);
const cursorOn = ref(false);
const running = ref(false);
let timers: number[] = [];

const typedDone = computed(() =>
  props.frame ? typed.value.length === props.frame.typedBullet.length : true,
);
/** 光标 x：bullet 文本起点 228 + 已键入宽度（14px 字 → 单位 × 7） */
const cursorX = computed(() => 228 + widthUnits(typed.value) * 7);

function clearTimers() {
  for (const t of timers) clearTimeout(t);
  timers = [];
}
/** reduced-motion / 截图链路：直接呈完成态 */
function finish() {
  clearTimers();
  if (props.frame) typed.value = props.frame.typedBullet;
  saved.value = true;
  cursorOn.value = false;
  running.value = false;
}
function run() {
  if (!props.demo || !props.frame || running.value) return;
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

/**
 * 跨语言切换（裁决 26，黑盒审计实测 zh→en 残留中文键入句）：
 * 五语路由共用组件实例，切语言时 onMounted 不重跑，演示内部状态必须跟随
 * 新语言重置；已入场的演示按新语言重播（reduced-motion 直接呈新终态）。
 */
watch(
  () => props.frame?.typedBullet,
  () => {
    if (!props.demo) return;
    clearTimers();
    typed.value = '';
    saved.value = true;
    cursorOn.value = false;
    running.value = false;
    const el = rootEl.value;
    if (!el?.classList.contains('is-in')) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish();
    } else {
      timers.push(window.setTimeout(run, 700));
    }
  },
);

onMounted(() => {
  const el = rootEl.value;
  if (!el) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.classList.add('is-in');
    finish();
    return;
  }
  if (!('IntersectionObserver' in window)) {
    el.classList.add('is-in');
    run();
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          timers.push(window.setTimeout(run, 700));
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.35 },
  );
  io.observe(el);
});
onBeforeUnmount(clearTimers);

const introLines = computed(() => wrapText(props.note.intro, 108));
const quoteLines = computed(() => wrapText(props.note.quoteLine, 104));
const sectionY = computed(() => 342 + (introLines.value.length - 1) * 20);
const bulletY = (i: number) => sectionY.value + 46 + i * 22;
/** demo 键入行槽位（bullets 之下）；引文行随之整体下移 */
const typedY = computed(() => bulletY(props.note.bullets.length));
const quoteY = computed(() =>
  props.demo ? typedY.value + 48 : bulletY(props.note.bullets.length - 1) + 48,
);

// 按钮文字宽度估算：12px 字 ≈ 全宽 12px / 半宽 6.3px → 单位 × 6
const btnTextW = (s: string) => Math.ceil(widthUnits(s) * 6);
const tplW = computed(() => btnTextW(props.ui.templates) + 22);
const liveW = computed(() => btnTextW(`▷ ${props.ui.live}`) + 18);
const liveX = computed(() => 1028 - liveW.value);
const tplX = computed(() => liveX.value - 6 - tplW.value);

// 工具条左组同样流动：引用▾ → B I S </> ↗ → 清除格式
const ui13 = (s: string) => Math.ceil(widthUnits(s) * 6.5);
const quoteChevX = computed(() => 76 + ui13(props.ui.quote) + 8);
const fmtDiv1X = computed(() => quoteChevX.value + 14);
const fmtBX = computed(() => fmtDiv1X.value + 18);
const fmtIX = computed(() => fmtBX.value + 32);
const fmtSX = computed(() => fmtIX.value + 28);
const fmtMonoX = computed(() => fmtSX.value + 34);
const fmtArrowX = computed(() => fmtMonoX.value + 46);
const fmtDiv2X = computed(() => fmtArrowX.value + 24);
const clearX = computed(() => fmtDiv2X.value + 18);
</script>

<template>
  <svg
    ref="rootEl"
    class="paper-preview"
    :class="{ 'pp-demo': demo }"
    viewBox="0 0 1280 800"
    :role="demo ? 'button' : 'img'"
    :tabindex="demo ? 0 : undefined"
    :aria-label="demo ? `${note.title} — ${ui.replay}` : note.title"
    :title="demo ? ui.replay : undefined"
    preserveAspectRatio="xMidYMid meet"
    @click="run"
    @keydown.enter.prevent="run"
    @keydown.space.prevent="run"
  >
    <!-- 底 -->
    <rect width="1280" height="800" class="pp-bg" />

    <!-- 左细栏 -->
    <rect x="0" y="0" width="58" height="800" class="pp-rail" />
    <line x1="58" y1="0" x2="58" y2="800" class="pp-hairline" />
    <rect x="20" y="18" width="18" height="14" rx="2" class="pp-icon-ghost" />
    <line x1="23" y1="21" x2="35" y2="21" class="pp-icon-line" />
    <line x1="29" y1="44" x2="29" y2="56" class="pp-icon-strong" />
    <line x1="23" y1="50" x2="35" y2="50" class="pp-icon-strong" />
    <circle cx="29" cy="98" r="2.2" class="pp-dot" />
    <circle cx="29" cy="112" r="2.2" class="pp-dot" />
    <circle cx="29" cy="126" r="2.2" class="pp-dot" />
    <circle cx="29" cy="772" r="9" class="pp-icon-ghost" />
    <circle cx="29" cy="772" r="3" class="pp-dot" />

    <!-- 顶栏 -->
    <line x1="58" y1="46" x2="1280" y2="46" class="pp-hairline" />
    <rect x="74" y="17" width="16" height="13" rx="2" class="pp-icon-ghost" />
    <rect x="74" y="14" width="9" height="4" rx="1.5" class="pp-icon-ghost" />
    <text x="98" y="28" class="pp-ui">{{ ui.scratch }}</text>
    <text x="640" y="28" text-anchor="middle" class="pp-ui-strong">{{ ui.scratch }}</text>
    <rect x="770" y="13" width="145" height="20" rx="6" class="pp-search" />
    <circle cx="783" cy="22" r="4" class="pp-icon-ghost" />
    <line x1="786" y1="25" x2="789" y2="28" class="pp-icon-line" />
    <text x="796" y="26" class="pp-muted">{{ ui.search }}</text>
    <path d="M932 17 l0 8 m0 0 l-3 -3 m3 3 l3 -3" class="pp-icon-line" />
    <rect x="932" y="26" width="8" height="2.5" class="pp-icon-ghost" />
    <circle cx="962" cy="18" r="2.4" class="pp-icon-ghost" />
    <circle cx="955" cy="25" r="2.4" class="pp-icon-ghost" />
    <circle cx="969" cy="25" r="2.4" class="pp-icon-ghost" />
    <line x1="962" y1="20" x2="956" y2="23.5" class="pp-icon-line" />
    <line x1="962" y1="20" x2="968" y2="23.5" class="pp-icon-line" />
    <rect x="994" y="15" width="14" height="14" rx="2" class="pp-icon-ghost" />
    <line x1="1001" y1="15" x2="1001" y2="29" class="pp-icon-line" />

    <!-- 工具条（左右两组均按文字宽度流动定位） -->
    <line x1="58" y1="88" x2="1040" y2="88" class="pp-hairline" />
    <text x="76" y="72" class="pp-ui">{{ ui.quote }}</text>
    <path :d="`M${quoteChevX} 67 l4 5 4 -5`" class="pp-icon-line" />
    <line :x1="fmtDiv1X" y1="58" :x2="fmtDiv1X" y2="78" class="pp-hairline" />
    <text :x="fmtBX" y="73" class="pp-fmt">B</text>
    <text :x="fmtIX" y="73" class="pp-fmt italic">I</text>
    <text :x="fmtSX" y="73" class="pp-fmt strike">S</text>
    <text :x="fmtMonoX" y="73" class="pp-fmt mono">&lt;/&gt;</text>
    <text :x="fmtArrowX" y="73" class="pp-fmt">↗</text>
    <line :x1="fmtDiv2X" y1="58" :x2="fmtDiv2X" y2="78" class="pp-hairline" />
    <text :x="clearX" y="72" class="pp-muted">{{ ui.clearFormat }}</text>
    <rect :x="tplX" y="56" :width="tplW" height="22" rx="5" class="pp-btn-ghost" />
    <text :x="tplX + tplW / 2" y="71" text-anchor="middle" class="pp-ui">{{ ui.templates }}</text>
    <rect :x="liveX" y="56" :width="liveW" height="22" rx="5" class="pp-btn-live" />
    <text :x="liveX + liveW / 2" y="71" text-anchor="middle" class="pp-live-text">
      ▷ {{ ui.live }}
    </text>

    <!-- 编辑区 -->
    <text x="213" y="245" class="pp-h1">{{ note.title }}</text>
    <text v-for="(line, i) in introLines" :key="line" x="213" :y="287 + i * 20" class="pp-body">
      {{ line }}
    </text>
    <text x="213" :y="sectionY" class="pp-h2">{{ note.section }}</text>
    <g v-for="(b, i) in note.bullets" :key="b">
      <text x="213" :y="bulletY(i)" class="pp-body">·</text>
      <SvgInlineText :x="228" :y="bulletY(i)" :src="b" />
    </g>

    <!-- demo 模拟键入行：打字中呈纯文本，完成后换行内标记渲染（[[wikilink]] 高亮） -->
    <template v-if="demo && frame && typed">
      <text x="213" :y="typedY" class="pp-body">·</text>
      <SvgInlineText v-if="typedDone" :x="228" :y="typedY" :src="frame.typedBullet" />
      <text v-else x="228" :y="typedY" class="pp-body">{{ typed }}</text>
    </template>
    <rect
      v-if="demo && cursorOn"
      :x="cursorX"
      :y="typedY - 12"
      width="2"
      height="15"
      class="pp-cursor"
    />

    <text
      v-for="(line, i) in quoteLines"
      :key="line"
      x="213"
      :y="quoteY + i * 20"
      class="pp-quote"
      :style="{ transitionDelay: 480 + i * 120 + 'ms' }"
    >
      {{ i === 0 ? '› ' + line : line }}
    </text>

    <!-- 右侧面板 -->
    <rect x="1040" y="0" width="240" height="800" class="pp-panel" />
    <line x1="1040" y1="0" x2="1040" y2="800" class="pp-hairline" />
    <line x1="1058" y1="22" x2="1066" y2="22" class="pp-icon-line" />
    <line x1="1058" y1="26" x2="1066" y2="26" class="pp-icon-line" />
    <line x1="1058" y1="30" x2="1066" y2="30" class="pp-icon-line" />
    <text x="1074" y="28" class="pp-ui-strong">{{ ui.outline }}</text>
    <circle cx="1238" cy="23" r="8" class="pp-badge" />
    <text x="1238" y="27" text-anchor="middle" class="pp-badge-text">1</text>
    <text x="1064" y="68" class="pp-ui-strong">{{ note.title }}</text>
    <text x="1078" y="93" class="pp-ui">{{ note.section }}</text>
    <line x1="1040" y1="112" x2="1280" y2="112" class="pp-hairline" />
    <path d="M1058 124 q4 -4 8 0 q-4 4 -8 0 m4 -4 l2 6" class="pp-icon-line" />
    <text x="1074" y="128" class="pp-ui">{{ ui.backlinks }}</text>
    <text x="1252" y="128" text-anchor="end" class="pp-muted">‹</text>
    <line x1="1040" y1="148" x2="1280" y2="148" class="pp-hairline" />
    <path d="M1058 160 l4 4 -4 4 -4 -4 z m4 4 l5 0" class="pp-icon-line" />
    <text x="1074" y="166" class="pp-ui">{{ ui.tags }}</text>
    <text x="1252" y="166" text-anchor="end" class="pp-muted">‹</text>
    <text x="1160" y="212" text-anchor="middle" class="pp-muted">{{ ui.noTags }}</text>

    <!-- 状态栏：demo 模式随键入序列翻牌（未保存 → 已保存） -->
    <line x1="58" y1="762" x2="1280" y2="762" class="pp-hairline" />
    <text x="640" y="785" text-anchor="middle" class="pp-status">{{ note.statusLeft }}</text>
    <template v-if="demo">
      <text x="1085" y="785" :class="saved ? 'pp-saved' : 'pp-unsaved'">
        {{ saved ? '✓ ' + ui.saved : '● ' + ui.unsaved }}
      </text>
    </template>
    <template v-else>
      <circle cx="1085" cy="781" r="3.5" class="pp-status-dot" />
      <text x="1096" y="785" class="pp-status">{{ ui.unsaved }}</text>
    </template>

    <!-- 语法 pill -->
    <rect x="1196" y="712" width="62" height="26" rx="10" class="pp-pill" />
    <text x="1227" y="729" text-anchor="middle" class="pp-muted">{{ ui.syntax }}</text>
  </svg>
</template>

<style scoped>
.paper-preview {
  display: block;
  width: 100%;
  height: auto;
  font-family: var(--font-body);
  /* 行内标记着色变量：活链蓝（与「▷ 即时」同色）、标签钢蓝 */
  --mk-body-fill: #3a342b;
  --mk-wiki-fill: #4a63a8;
  --mk-wiki-deco-color: #b8c6e8;
  --mk-tag-fill: #6379a0;
}
.paper-preview.pp-demo {
  cursor: pointer;
}
.paper-preview.pp-demo:focus-visible {
  outline: 2px solid var(--orange);
  outline-offset: 2px;
  border-radius: var(--r-proof);
}
.paper-preview text {
  fill: #3a342b;
}
.pp-bg {
  fill: #f8f5ee;
}
.pp-rail {
  fill: #f3f0e8;
}
.pp-panel {
  fill: #f6f3eb;
}
.pp-hairline {
  stroke: #e4ded1;
  stroke-width: 1;
}
.pp-icon-ghost {
  fill: none;
  stroke: #a39c8e;
  stroke-width: 1.2;
}
.pp-icon-line {
  stroke: #a39c8e;
  stroke-width: 1.2;
  fill: none;
}
.pp-icon-strong {
  stroke: #6e675c;
  stroke-width: 1.6;
}
.pp-dot {
  fill: #c4bcab;
}
.pp-ui {
  font-size: 13px;
}
.pp-ui-strong {
  font-size: 13px;
  font-weight: 700;
}
.pp-muted {
  font-size: 12px;
  fill: #a39d92 !important;
}
.pp-search {
  fill: #f0ece2;
  stroke: #e2dccf;
}
.pp-fmt {
  font-size: 13px;
  font-weight: 600;
  fill: #6e675c !important;
}
.pp-fmt.italic {
  font-style: italic;
}
.pp-fmt.strike {
  text-decoration: line-through;
}
.pp-fmt.mono {
  font-family: var(--font-mono);
  font-size: 11px;
}
.pp-btn-ghost {
  fill: none;
  stroke: #d8d1c1;
}
.pp-btn-live {
  fill: #e4ecfa;
  stroke: #c3d2ef;
}
.pp-live-text {
  font-size: 12px;
  font-weight: 600;
  fill: #4a63a8 !important;
}
.pp-h1 {
  font-size: 32px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.pp-h2 {
  font-size: 19px;
  font-weight: 700;
}
.pp-body {
  font-size: 14px;
}
.pp-quote {
  font-size: 14px;
  fill: #8a8378 !important;
}
.pp-badge {
  fill: #e9e4d7;
}
.pp-badge-text {
  font-size: 10px;
  font-weight: 700;
  fill: #6e675c !important;
}
.pp-status {
  font-size: 11px;
  fill: #a39d92 !important;
}
.pp-status-dot {
  fill: #7d8a96;
}
.pp-saved {
  font-size: 12px;
  font-weight: 600;
  fill: #74bda9 !important;
}
.pp-unsaved {
  font-size: 12px;
  font-weight: 600;
  fill: #d08a45 !important;
}
.pp-cursor {
  fill: #6e675c;
  animation: pp-blink 0.85s steps(2, end) infinite;
}
@keyframes pp-blink {
  50% {
    opacity: 0;
  }
}
.pp-pill {
  fill: #fbf9f3;
  stroke: #e0dacc;
}
</style>

<!-- 入场门控与 is-in 触发：html.js 祖先选择器必须非 scoped（scoped 内 :global 会丢后代选择器） -->
<style>
/* ▷即时 按钮按压 → 预览引文行浮起（transform+opacity，<400ms 单项）；无 JS 静态可见 */
html.js .paper-preview .pp-quote {
  opacity: 0;
  transform: translateY(6px);
  transform-box: fill-box;
  transition:
    opacity var(--dur-narrative) ease-out,
    transform var(--dur-narrative) var(--ease-press);
}
html.js .paper-preview.is-in .pp-quote {
  opacity: 1;
  transform: none;
}
html.js .paper-preview .pp-btn-live {
  transform-box: fill-box;
  transform-origin: center;
}
html.js .paper-preview.is-in .pp-btn-live {
  animation: pp-live-press 240ms var(--ease-press) 260ms;
}
@keyframes pp-live-press {
  40% {
    transform: scale(0.9);
  }
}
/* reduced-motion：不依赖滚动触发，直接呈终态（截图链路即 reducedMotion 环境） */
@media (prefers-reduced-motion: reduce) {
  html.js .paper-preview .pp-quote {
    opacity: 1;
    transform: none;
    transition-delay: 0ms !important;
  }
  html.js .paper-preview.is-in .pp-btn-live {
    animation: none;
  }
  html.js .paper-preview .pp-cursor {
    animation: none;
  }
}
</style>
