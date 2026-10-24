<template>
  <div class="review-workbench">
    <!-- ── 顶栏 ── -->
    <header class="review-topbar">
      <div class="review-topbar-title">
        <span class="review-mode-title">{{ t('review.title') }}</span>
        <span class="review-note-name">{{ noteName }}</span>
        <span v-if="hunks.length > 0" class="review-hunk-badge">
          {{ t('review.hunkCount', { n: hunks.length }) }}
        </span>
      </div>
      <div class="review-topbar-actions">
        <div class="review-mode-toggle" role="group" :aria-label="t('review.mode.label')">
          <button
            type="button"
            class="review-mode-option"
            :class="{ selected: mode === 'rendered' }"
            @click="mode = 'rendered'"
          >
            {{ t('review.mode.rendered') }}
          </button>
          <button
            type="button"
            class="review-mode-option"
            :class="{ selected: mode === 'source' }"
            @click="mode = 'source'"
          >
            {{ t('review.mode.source') }}
          </button>
        </div>
        <button
          type="button"
          class="review-topbar-button"
          :disabled="workingText === sourceText"
          @click="exportVisible = true"
        >
          {{ t('review.export.button') }}
        </button>
        <button type="button" class="review-topbar-button" @click="requestExit">
          {{ t('review.exit') }}
        </button>
      </div>
    </header>

    <p v-if="ioError" class="review-io-error" role="alert">{{ ioError }}</p>

    <!-- ── 分栏（复刻 NotebookHome split-pane：左右 flex + 可拖动分隔条） ── -->
    <div ref="splitPaneEl" class="split-pane">
      <section class="split-left" :style="{ flex: `0 0 ${splitRatio}%` }">
        <!-- 左栏源码态：只读源稿 + 红马克笔 -->
        <MarkdownEditor
          v-if="mode === 'source'"
          ref="leftEditorRef"
          :key="`review-left-${mode}`"
          :model-value="sourceText"
          :read-only="true"
          :source-only="true"
          :live-preview="false"
          :show-line-numbers="true"
          :review-marks="leftMarks"
        />
        <!-- 左栏渲染态：改动块「源码显形」（红马克笔原文），其余正常渲染 -->
        <!-- load/error 不冒泡：捕获态监听转发远程图会话句柄（同主编辑器静态预览） -->
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div
          v-else
          ref="leftRenderRef"
          class="markdown-body review-left-render"
          @click="onLeftPaneClick"
          @load.capture="onLivePreviewRemoteImageLoad?.($event)"
          @error.capture="onLivePreviewRemoteImageError?.($event)"
          v-html="leftRenderedHtml"
        />
      </section>
      <div
        class="split-divider"
        :style="{ left: `${splitRatio}%` }"
        @pointerdown="onSplitDragStart"
      />
      <section class="split-right" :style="{ flex: `0 0 ${100 - splitRatio}%` }">
        <!-- 右栏工作稿：渲染态走即时渲染 + 内嵌批注钩子；源码态显示源码 + 绿马克笔 -->
        <!-- 渲染 props（W2 下沉）与主编辑器同源：wiki 跳转/死链判定、本地图解析、远程图策略与占位交互 -->
        <MarkdownEditor
          ref="rightEditorRef"
          :key="`review-right-${mode}`"
          :model-value="workingText"
          :read-only="false"
          :live-preview="mode === 'rendered'"
          :source-only="mode === 'source'"
          :review-marks="rightMarks"
          :annotate-rendered-block="annotateHook"
          :predictor="predictor"
          :completion-settings="completionSettings"
          :enable-autocomplete="true"
          :on-live-preview-wiki-link-click="onLivePreviewWikiLinkClick"
          :wiki-link-exists="wikiLinkExists"
          :wiki-link-revision="wikiLinkRevision"
          :resolve-image-src="resolveImageSrc"
          :image-revision="imageRevision"
          :remote-images="remoteImages"
          :remote-image-revision="remoteImageRevision"
          :on-live-preview-remote-image-click="onLivePreviewRemoteImageClick"
          :on-live-preview-remote-image-load="onLivePreviewRemoteImageLoad"
          :on-live-preview-remote-image-error="onLivePreviewRemoteImageError"
          :on-live-preview-tag-click="onLivePreviewTagClick"
          @update:model-value="onWorkingUpdate"
        />
      </section>

      <!-- ── 右上角批注面板（absolute 于分栏容器内，不遮顶栏动作区） ── -->
      <div class="review-panel-host">
        <ReviewAnnotationPanel
          :hunks="hunks"
          @locate="onLocate"
          @decide="onDecide"
          @decide-all="onDecideAll"
        />
      </div>
    </div>

    <!-- ── 退出确认小卡 ── -->
    <Teleport to="body">
      <div
        v-if="exitConfirmVisible"
        class="modal-overlay"
        @click.self="exitConfirmVisible = false"
        @keydown.escape="exitConfirmVisible = false"
      >
        <div class="modal-card review-confirm-card" role="dialog" aria-modal="true">
          <h3 class="review-confirm-title">
            {{ t('review.exitConfirm.title', { n: hunks.length }) }}
          </h3>
          <p class="review-confirm-body">{{ t('review.exitConfirm.body') }}</p>
          <div class="review-confirm-actions">
            <Button variant="secondary" @click="exitConfirmVisible = false">
              {{ t('review.exitConfirm.stay') }}
            </Button>
            <Button variant="default" @click="confirmExit">
              {{ t('review.exitConfirm.leave') }}
            </Button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ── 冲突对话框 ── -->
    <Teleport to="body">
      <div v-if="conflictVisible" class="modal-overlay" @keydown.escape="conflictVisible = false">
        <div class="modal-card review-confirm-card" role="dialog" aria-modal="true">
          <h3 class="review-confirm-title">{{ t('review.conflict.title') }}</h3>
          <p class="review-confirm-body">{{ t('review.conflict.body') }}</p>
          <div class="review-confirm-actions">
            <Button variant="secondary" :disabled="rebasing" @click="conflictVisible = false">
              {{ t('review.conflict.cancel') }}
            </Button>
            <Button
              variant="default"
              :loading="rebasing"
              :disabled="rebasing"
              @click="rebaseOnLatest"
            >
              {{ t('review.conflict.reopen') }}
            </Button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ── 导出批注版本 ── -->
    <ReviewExportDialog
      :visible="exportVisible"
      :fs="fs"
      :root="root"
      :note-path="path"
      :working-text="workingText"
      @update:visible="exportVisible = $event"
      @cancel="exportVisible = false"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * ReviewWorkbench — 改稿（审批/批注）模式工作台
 *
 * 分栏：左=源稿（只读，红马克笔=被改动/删除的原文），右=工作稿（可编辑，
 * 绿马克笔=修改/新增文字，幽灵补全照常）。两栏默认「即时渲染」态，一键切
 * 「源码」态且两栏同步切换。
 *
 * 左栏渲染态的 V1 落地口径（源码显形）：改动块（hunk 所在块）不参与 markdown
 * 渲染，直接以 <pre class="review-source-reveal"> 显示原文并在 hunk.leftRange
 * 区间包红马克笔（<mark class="review-mark-del">，S2 全局类）；未改动块照常
 * renderMarkdown。块对齐用 parseDocument，与 cm6-live-preview 同一 AST 权威。
 *
 * 右栏渲染态用 cm6-live-preview 的 annotateRenderedBlock 钩子对未聚焦改动块做
 * 渲染内嵌：按块载荷（contentFrom/literal/definitions，与 sourcePosition 同口径）
 * 经 annotateBlockBySourceRanges 做「源码区间 → 可见文本」的词级绿马克笔投影
 * （带 visibleTextOf===map.text 全等校验，位移型错位一律回退）；投影空/校验
 * 失败/tableRow 退化为整块绿底 tint（applyBlockTint）；聚焦改动块显示源码，
 * 由 reviewMarks 绿标覆盖。注解器为 setup 期一次创建的稳定函数 + signature，
 * 批注数据轮换走 refreshRenderedAnnotations（换数据不换扩展，IME 友好）。
 *
 * 渲染 props 下沉（W2）：宿主（NotebookHome）传入与主编辑器同源的全套渲染
 * props——本地图解析（修改稿模式本地图全 404）、wiki 死链判定与跳转回调、
 * 远程图策略（本地化 labels）与占位交互三件套；右栏 MarkdownEditor 全量
 * 透传，左栏 v-html 经 renderLeftPane options + 点击委托同口径消费。
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { EditorView } from '@codemirror/view';
import { parseDocument, renderMarkdown } from '@jotluck/renderer';
import MarkdownEditor from '@/components/editor/MarkdownEditor.vue';
import Button from '@/components/common/Button.vue';
import ReviewAnnotationPanel from '@/components/review/ReviewAnnotationPanel.vue';
import ReviewExportDialog from '@/components/review/ReviewExportDialog.vue';
import { useReviewSession } from '@/composables/useReviewSession';
import type { IFileSystemService } from '@/types/file-system';
import type { CompletionSettings } from '@/services/CompletionSettings';
import type { MarkdownPredictor } from '@/services/MarkdownPredictor';
import type { RendererOptions } from '@jotluck/renderer';
import type { ReviewHunk } from '@/utils/review-types';
import {
  leftMarksFromHunks,
  mapLeftPositionToWorking,
  rightMarksFromHunks,
} from '@/services/review-session-store';
import { useToast } from '@/components/common/Toast.vue';
import { annotateBlockBySourceRanges, applyBlockTint } from '@/utils/review-dom-annotator';
import { openExternalUrl } from '@/utils/urlUtils';
import { classifyAnchorHref } from '@/utils/preview-links';
import { findHeadingElement } from '@/utils/heading-anchor';
import type {
  RenderedBlockAnnotator,
  RenderedBlockAnnotationPayload,
} from '@/utils/cm6-live-preview';

const props = defineProps<{
  fs: IFileSystemService;
  /** 笔记本根标识（localStorage 暂存 key 的一部分） */
  root: string;
  /** 笔记相对路径 */
  path: string;
  /** 会话开始时的源稿快照 */
  initialSnapshot: { content: string; revision: string };
  /** 编辑器透传（幽灵补全照常） */
  predictor?: MarkdownPredictor;
  completionSettings?: CompletionSettings;
  /** 渲染 props（W2 下沉，与主编辑器同源）：wiki 跳转回调（普通会话 resolveWikiLink
   *  跳转 / 外部会话受限提示由宿主统一裁决；缺省时左栏点击回退受限提示） */
  onLivePreviewWikiLinkClick?: (note: string, anchor: null | string) => void;
  wikiLinkExists?: (note: string) => boolean;
  wikiLinkRevision?: number;
  resolveImageSrc?: RendererOptions['resolveImageSrc'];
  imageRevision?: number;
  remoteImages?: RendererOptions['remoteImages'];
  remoteImageRevision?: number;
  onLivePreviewRemoteImageClick?: (event: MouseEvent) => boolean;
  onLivePreviewRemoteImageLoad?: (event: Event) => boolean;
  onLivePreviewRemoteImageError?: (event: Event) => boolean;
}>();

const emit = defineEmits<{
  exit: [];
  /** 批准写入源稿文件后（父层刷新笔记列表/当前快照用） */
  'source-adopted': [content: string, revision: string];
}>();

const { t } = useI18n();

// ── 会话状态 ──
const session = useReviewSession({
  fs: props.fs,
  root: props.root,
  path: props.path,
  initialSnapshot: props.initialSnapshot,
});
const { sourceText, workingText, hunks } = session;

const noteName = computed(() => {
  const base = props.path.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
});

// ── 模式与分栏 ──
const mode = ref<'rendered' | 'source'>('rendered');
const splitRatio = ref(50);
const splitPaneEl = ref<HTMLDivElement | null>(null);
const leftRenderRef = ref<HTMLDivElement | null>(null);
const leftEditorRef = ref<InstanceType<typeof MarkdownEditor> | null>(null);
const rightEditorRef = ref<InstanceType<typeof MarkdownEditor> | null>(null);

// ── 源码态马克笔 ──
const leftMarks = computed(() => leftMarksFromHunks(hunks.value));
const rightMarks = computed(() => rightMarksFromHunks(hunks.value));

// ── 左栏渲染态：块级拼装（源码显形口径，见文件头） ──

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 命中 hunk 的块 → 源码显形卡片：块内 hunk.leftRange 区间包红马克笔 */
function renderSourceRevealBlock(
  blockText: string,
  blockFrom: number,
  hitHunks: readonly ReviewHunk[],
): string {
  // 命中区间 → 块内相对坐标，升序合并重叠
  const spans = hitHunks
    .map((hunk) => ({
      from: Math.max(0, hunk.leftRange!.from - blockFrom),
      to: Math.min(blockText.length, hunk.leftRange!.to - blockFrom),
    }))
    .filter((span) => span.to > span.from)
    .sort((a, b) => a.from - b.from);

  let html = '';
  let cursor = 0;
  for (const span of spans) {
    const from = Math.max(span.from, cursor);
    if (span.to <= from) continue;
    html += escapeHtml(blockText.slice(cursor, from));
    html += `<mark class="review-mark-del">${escapeHtml(blockText.slice(from, span.to))}</mark>`;
    cursor = span.to;
  }
  html += escapeHtml(blockText.slice(cursor));

  const ids = hitHunks.map((hunk) => hunk.id).join(' ');
  return `<div class="review-block-del" data-hunk-id="${escapeHtml(ids)}"><pre class="review-source-reveal">${html}</pre></div>`;
}

function renderLeftPane(
  source: string,
  allHunks: readonly ReviewHunk[],
  options?: RendererOptions,
): string {
  const dels = allHunks.filter(
    (hunk): hunk is ReviewHunk & { leftRange: { from: number; to: number } } =>
      hunk.type !== 'insert' && hunk.leftRange !== undefined,
  );
  if (dels.length === 0) return renderMarkdown(source, options);
  let ast;
  try {
    ast = parseDocument(source);
  } catch {
    return renderMarkdown(source, options); // AST 异常：整体渲染降级（丢失红笔，不阻断阅读）
  }
  const parts: string[] = [];
  for (const node of ast.blocks) {
    if (node.type === 'blank' || node.type === 'refDefinition') continue;
    const { from, to } = node.range;
    const hit = dels.filter((hunk) => hunk.leftRange.from < to && hunk.leftRange.to > from);
    const text = source.slice(from, to);
    parts.push(
      hit.length > 0 ? renderSourceRevealBlock(text, from, hit) : renderMarkdown(text, options),
    );
  }
  return parts.join('\n');
}

/** 左栏渲染 options（W2 下沉）：与右栏/主编辑器同源。resolve 函数身份稳定，
 *  显式读三个 revision prop 建立响应依赖——wiki 索引/本地图/远程图授权轮换时
 *  左栏 v-html 随之重渲染（同 MarkdownEditor 的 revision watch 口径）。 */
const leftRenderOptions = computed<RendererOptions>(() => {
  void props.wikiLinkRevision;
  void props.imageRevision;
  void props.remoteImageRevision;
  return {
    wikiLinkExists: props.wikiLinkExists,
    resolveImageSrc: props.resolveImageSrc,
    remoteImages: props.remoteImages,
  };
});

const leftRenderedHtml = computed(() =>
  renderLeftPane(sourceText.value, hunks.value, leftRenderOptions.value),
);

// ── 左栏 v-html 点击委托：杜绝改稿窗口被锚点整页接管 ──

const toast = useToast();

/**
 * 左栏渲染态是 v-html 注入（无 Vue 事件绑定），点击走委托统一收口：
 * 远程图占位「载入/重试」按钮 → 会话句柄裁决（同主编辑器 onPreviewClick 首行）；
 * wiki 链接 → 跳转透传（W2 接入宿主回调，普通会话 resolveWikiLink 跳转 /
 * 外部会话受限提示由宿主统一裁决），缺省时回退受限提示；tag → 受限提示；
 * # 锚点 → 左栏容器内三形态归一滚动（miss 给 headingNotFound 轻反馈）；
 * 绝对外链/裸域名 → preventDefault 后移交系统浏览器；其余相对路径 → 仅
 * preventDefault 不动作。不存在「未 preventDefault 即放行」的路径。
 */
function onLeftPaneClick(event: MouseEvent): void {
  if (props.onLivePreviewRemoteImageClick?.(event)) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest('a');
  if (!anchor) return;
  if (anchor.hasAttribute('data-note')) {
    event.preventDefault();
    const note = anchor.getAttribute('data-note');
    if (note && props.onLivePreviewWikiLinkClick) {
      props.onLivePreviewWikiLinkClick(note, anchor.getAttribute('data-anchor'));
      return;
    }
    toast.show(t('review.linkRestricted'), 'info', 3500);
    return;
  }
  if (anchor.hasAttribute('data-tag')) {
    event.preventDefault();
    toast.show(t('review.linkRestricted'), 'info', 3500);
    return;
  }
  const href = anchor.getAttribute('href');
  if (!href) return;
  event.preventDefault();
  // 站内锚点（#fragment）：左栏容器内三形态归一定位（原文/heading-原文/
  // headingIdFromText 形态，与静态预览 NotebookHome/阅读页同口径），miss 给
  // headingNotFound 轻反馈——不再落入下方 classify 的 relative 静默 no-op。
  if (href.startsWith('#')) {
    const heading = leftRenderRef.value
      ? findHeadingElement(leftRenderRef.value, href.slice(1))
      : undefined;
    if (heading) heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else toast.show(t('navigation.headingNotFound'), 'info', 3500);
    return;
  }
  const hrefKind = classifyAnchorHref(href);
  if (hrefKind !== 'relative') void openExternalUrl(href);
}

/**
 * 右栏 live 视图 #tag 点击（L5 透传）：改稿台无搜索面板，与左栏 data-tag
 * 同口径给受限提示——不透传时 cm6 会 stopPropagation+preventDefault 静默
 * 吞掉点击（options.onTagClick 缺省仍 return true），三面口径就此统一。
 */
function onLivePreviewTagClick(tag: string): void {
  void tag;
  toast.show(t('review.linkRestricted'), 'info', 3500);
}

// ── 右栏渲染态钩子：未聚焦改动块的内嵌批注（投影梯） ──

/** 与块区间相交的 add 侧 hunk（modify/insert 且有 rightRange） */
function intersectingHunksOf(payload: RenderedBlockAnnotationPayload): ReviewHunk[] {
  return hunks.value.filter(
    (hunk) =>
      (hunk.type === 'modify' || hunk.type === 'insert') &&
      hunk.rightRange &&
      hunk.rightRange.from < payload.to &&
      hunk.rightRange.to > payload.from,
  );
}

/**
 * 投影梯：相交 hunk 过滤 → tableRow 直接 tint（V1 非 prose 块：网格布局 +
 * 空格补位，词级投影对不齐，不升级）→ 其余块用 annotateBlockBySourceRanges
 * 做源码坐标 → 可见文本的词级绿马克笔；false（投影空 / 全等校验失败 /
 * 词法异常）一律回退整块绿底 tint——宁降级不错位。
 */
function annotateRightBlock(payload: RenderedBlockAnnotationPayload, dom: HTMLElement): void {
  const intersecting = intersectingHunksOf(payload);
  if (intersecting.length === 0) return;
  if (payload.type === 'tableRow') {
    applyBlockTint(dom, 'add');
    return;
  }
  const working = workingText.value;
  try {
    const projected = annotateBlockBySourceRanges(dom, {
      blockSource: working.slice(payload.contentFrom, payload.to),
      contentFrom: payload.contentFrom,
      literal: payload.literal,
      definitions: payload.definitions,
      ranges: intersecting.flatMap((hunk) => (hunk.rightRange ? [hunk.rightRange] : [])),
      side: 'add',
    });
    if (projected) return;
  } catch {
    // 投影异常 → tint 兜底
  }
  applyBlockTint(dom, 'add');
}

/**
 * 稳定注解器：函数身份在 setup 期创建后永不变（闭包身份恒定），批注数据经
 * hunks.value 实时读取。数据轮换由 signature（相交 hunk 的 id:rightRange 区间
 * 串接，无相交为 ''）驱动 cm6-live-preview 的定向 widget 重建（换数据不换
 * 扩展，IME/renderCache 不受扰动）；hunks 变化另经下方 watch 主动触发
 * refreshRenderedAnnotations 兜底刷新。
 */
const annotateHook: RenderedBlockAnnotator = Object.assign(annotateRightBlock, {
  signature: (payload: RenderedBlockAnnotationPayload): string =>
    intersectingHunksOf(payload)
      .map((hunk) => `${hunk.id}:${hunk.rightRange?.from ?? ''}-${hunk.rightRange?.to ?? ''}`)
      .join('|'),
});

// ── 编辑同步（右栏） ──

function onWorkingUpdate(value: string): void {
  workingText.value = value;
}

// hunks 轮换 → 渲染态右栏定向刷新（adopt/discard 的 computeNow 同步重算路径
// 同样覆盖；引用稳定化使结构未变时不触发本 watch，避免无谓刷新）
watch(hunks, () => {
  if (mode.value === 'rendered') rightEditorRef.value?.refreshRenderedAnnotations();
});

// ── 面板定位：两栏滚动 ──

function cssEscapeIdent(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '');
}

function scrollRightTo(hunk: ReviewHunk): void {
  const view = rightEditorRef.value?.getEditorView();
  if (!view) return;
  let pos: number | null = null;
  if (hunk.rightRange) pos = Math.min(hunk.rightRange.from, hunk.rightRange.to);
  else if (hunk.leftRange) {
    // delete 类型：工作稿无对应区间 → 用 hunk 全集位移反推锚点
    pos = mapLeftPositionToWorking(hunk.leftRange.from, hunks.value);
  }
  if (pos === null) return;
  const clamped = Math.max(0, Math.min(view.state.doc.length, Math.trunc(pos)));
  view.dispatch({ effects: EditorView.scrollIntoView(clamped, { y: 'center' }) });
}

function scrollLeftTo(hunk: ReviewHunk): void {
  if (mode.value === 'rendered') {
    const el = leftRenderRef.value?.querySelector(`[data-hunk-id~="${cssEscapeIdent(hunk.id)}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (!hunk.leftRange) return;
  const view = leftEditorRef.value?.getEditorView();
  if (!view) return;
  const clamped = Math.max(0, Math.min(view.state.doc.length, hunk.leftRange.from));
  view.dispatch({ effects: EditorView.scrollIntoView(clamped, { y: 'center' }) });
}

function onLocate(hunk: ReviewHunk): void {
  scrollRightTo(hunk);
  scrollLeftTo(hunk);
}

// ── 批准 / 丢弃（弹窗按钮执行；执行期间防重入） ──

const deciding = ref(false);
const ioError = ref('');
const conflictVisible = ref(false);
const rebasing = ref(false);

/**
 * 批量裁决（面板头部入口，经内联二次确认后触发）：
 * 全部批准 = 会话层 adoptAll 一次写盘；全部丢弃 = discardAll 整体回滚。
 * 冲突/IO 处理与单条 onDecide 同口径。
 */
async function onDecideAll(action: 'adopt' | 'discard'): Promise<void> {
  if (deciding.value || hunks.value.length === 0) return;
  deciding.value = true;
  ioError.value = '';
  try {
    if (action === 'discard') {
      session.discardAll(); // 整体回滚为纯赋值（workingText=sourceText），无抛错面
      return;
    }
    const result = await session.adoptAll();
    if (result.ok) {
      emit('source-adopted', session.sourceText.value, session.sourceRevision.value);
    } else if (result.reason === 'conflict') {
      conflictVisible.value = true;
    } else {
      ioError.value = t('review.ioError', { message: result.message });
    }
  } finally {
    deciding.value = false;
  }
}

async function onDecide(hunk: ReviewHunk, action: 'adopt' | 'discard'): Promise<void> {
  if (deciding.value) return;
  deciding.value = true;
  ioError.value = '';
  try {
    if (action === 'discard') {
      try {
        session.discard(hunk);
      } catch (error) {
        ioError.value = t('review.ioError', {
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    const result = await session.adopt(hunk);
    if (result.ok) {
      emit('source-adopted', session.sourceText.value, session.sourceRevision.value);
    } else if (result.reason === 'conflict') {
      conflictVisible.value = true;
    } else {
      ioError.value = t('review.ioError', { message: result.message });
    }
  } finally {
    deciding.value = false;
  }
}

/** 冲突 → 以最新源稿重开（保留工作稿，重设基线） */
async function rebaseOnLatest(): Promise<void> {
  if (rebasing.value) return;
  rebasing.value = true;
  try {
    const snapshot = await props.fs.readFileSnapshot(props.path);
    session.rebaseSource({ content: snapshot.content, revision: snapshot.revision });
    conflictVisible.value = false;
  } catch (error) {
    conflictVisible.value = false;
    ioError.value = t('review.ioError', {
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    rebasing.value = false;
  }
}

// ── 导出 / 退出 ──

const exportVisible = ref(false);
const exitConfirmVisible = ref(false);

function requestExit(): void {
  if (hunks.value.length > 0) exitConfirmVisible.value = true;
  else emit('exit');
}

function confirmExit(): void {
  exitConfirmVisible.value = false;
  emit('exit');
}

// ── 分栏拖动（复刻 NotebookHome onSplitDragStart） ──

let splitDragCleanup: (() => void) | null = null;

function onSplitDragStart(event: PointerEvent): void {
  if (!event.isPrimary || event.button !== 0) return;
  splitDragCleanup?.();
  const divider = event.currentTarget as HTMLElement;
  const container = divider.parentElement;
  if (!container) return;
  event.preventDefault();
  divider.setPointerCapture(event.pointerId);
  const move = (next: PointerEvent) => {
    if (next.pointerId !== event.pointerId) return;
    const rect = container.getBoundingClientRect();
    if (rect.width > 0)
      splitRatio.value = Math.max(
        30,
        Math.min(70, ((next.clientX - rect.left) / rect.width) * 100),
      );
  };
  const finish = (next?: PointerEvent) => {
    if (next && next.pointerId !== event.pointerId) return;
    divider.removeEventListener('pointermove', move);
    divider.removeEventListener('pointerup', finish);
    divider.removeEventListener('pointercancel', finish);
    divider.removeEventListener('lostpointercapture', finish);
    window.removeEventListener('blur', blur);
    if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
    splitDragCleanup = null;
  };
  const blur = () => finish();
  divider.addEventListener('pointermove', move);
  divider.addEventListener('pointerup', finish);
  divider.addEventListener('pointercancel', finish);
  divider.addEventListener('lostpointercapture', finish);
  window.addEventListener('blur', blur);
  splitDragCleanup = blur;
}

onUnmounted(() => {
  splitDragCleanup?.();
  splitDragCleanup = null;
});
</script>

<style scoped>
.review-workbench {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--paper-surface);
}

/* ── 顶栏 ── */
.review-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-12);
  padding: var(--space-8) var(--space-16);
  border-bottom: var(--border-thin) solid var(--rule);
  flex: none;
}

.review-topbar-title {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  min-width: 0;
}

.review-mode-title {
  font-size: var(--text-sm);
  font-weight: var(--fw-medium);
  color: var(--ink-primary);
  flex: none;
}

.review-note-name {
  font-size: var(--text-sm);
  color: var(--ink-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.review-hunk-badge {
  flex: none;
  padding: 1px 8px;
  border-radius: var(--radius-full);
  background: var(--accent);
  color: var(--paper-raised);
  font-size: var(--text-xs);
  line-height: 16px;
}

.review-topbar-actions {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  flex: none;
}

.review-mode-toggle {
  display: inline-flex;
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  overflow: hidden;
}

.review-mode-option {
  padding: 4px 12px;
  border: none;
  background: var(--paper-surface);
  font-size: var(--text-xs);
  color: var(--ink-secondary);
  cursor: pointer;
}

.review-mode-option.selected {
  background: var(--accent-soft);
  color: var(--ink-primary);
  font-weight: var(--fw-medium);
}

.review-topbar-button {
  padding: 4px 12px;
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
  font-size: var(--text-xs);
  color: var(--ink-secondary);
  cursor: pointer;
}

.review-topbar-button:disabled {
  opacity: 0.5;
  cursor: default;
}

.review-topbar-button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--ink-primary);
}

.review-io-error {
  margin: 0;
  padding: var(--space-4) var(--space-16);
  background: var(--signal-error-soft);
  color: var(--signal-error);
  font-size: var(--text-xs);
  flex: none;
}

/* ── 分栏（复刻 NotebookHome split-pane） ── */
.split-pane {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;

  /* 左栏 .review-left-render 顶 pad 16px——右栏编辑器同起点 */
  --editor-top-pad: var(--space-16);
}

.split-left,
.split-right {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.split-divider {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 7px;
  margin-left: -3px;
  cursor: col-resize;
  touch-action: none;
  z-index: 5;
}

.split-divider:hover {
  background: var(--accent-soft);
}

/* ── 左栏渲染态 ── */
.review-left-render {
  height: 100%;
  overflow-y: auto;
  padding: var(--space-16);
}

/* 源码显形卡片（review-block-del 底色类由 S2 全局 editor.css 提供） */
.review-left-render :deep(.review-source-reveal) {
  margin: 0;
  padding: var(--space-8) var(--space-12);
  border-radius: var(--radius);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--text-sm);
  line-height: var(--lh-relaxed, 1.7);
  white-space: pre-wrap;
  overflow-wrap: break-word;
}

/* ── 批注面板锚点（面板自含尺寸，不遮挡其余区域） ──
 * host 与面板空白/空态区不拦截指针——编辑器首行位于面板下方，须可直接点选；
 * 仅折叠头与批注条目本身可交互 */
.review-panel-host {
  position: absolute;
  top: var(--space-12);
  right: var(--space-16);
  z-index: 20;
  display: flex;
  justify-content: flex-end;
  pointer-events: none;
}

.review-panel-host :deep(.review-panel-header),
.review-panel-host :deep(.review-panel-item),
.review-panel-host :deep(.review-bulk-bar) {
  pointer-events: auto;
}

/* ── 小卡对话框（modal-overlay/modal-card 全局范式） ── */
.review-confirm-card {
  width: 400px;
  padding: var(--space-20);
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
}

.review-confirm-title {
  margin: 0;
  font-size: var(--text-base);
  font-weight: var(--fw-medium);
  color: var(--ink-primary);
}

.review-confirm-body {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--ink-secondary);
}

.review-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-8);
}
</style>
