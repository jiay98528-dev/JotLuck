<template>
  <article
    ref="root"
    class="progressive-preview"
    :class="{ 'progressive-preview--outer-scroll': !!scrollParent }"
    tabindex="0"
    :data-preview-complete="complete"
    @scroll.passive="onScroll"
    @keydown="onKeydown"
    @copy="onCopy"
    @pointerdown="onPointerDown"
    @wheel.passive="onUserInteraction"
    @touchmove.passive="onUserInteraction"
  >
    <form v-if="findOpen" class="preview-find" @submit.prevent="find(1)">
      <input ref="findInput" v-model="query" :aria-label="t('editor.find.find')" @input="find(0)" />
      <button type="button" @click="find(-1)">{{ t('editor.find.previous') }}</button>
      <button type="submit">{{ t('editor.find.next') }}</button>
      <button type="button" @click="findOpen = false">{{ t('editor.find.close') }}</button>
    </form>
    <template v-if="fragments.length">
      <div :style="{ height: `${topHeight}px` }" aria-hidden="true" />
      <div
        v-for="item in visible"
        :key="`${item.fragment.from}:${item.fragment.to}`"
        :ref="(element) => bindFragment(item.fragment, element)"
        class="preview-fragment"
        :data-preview-index="item.index"
        :data-source-from="item.fragment.from"
        :style="{ minHeight: `${heights[item.index] ?? 24}px` }"
      />
      <div :style="{ height: `${bottomHeight}px` }" aria-hidden="true" />
    </template>
    <div v-else class="preview-source-fallback">{{ source.slice(0, 4096) }}</div>
    <button v-if="failed" class="btn btn--secondary" @click="retry">{{ t('common.retry') }}</button>
  </article>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
  type ComponentPublicInstance,
} from 'vue';
import { useI18n } from 'vue-i18n';
import {
  finalizePreparedHtml,
  renderMarkdown,
  highlightCodeBlocks,
  type RendererOptions,
} from '@jotluck/renderer';
import type { PreviewFragment } from '@jotluck/renderer/progressive';
import type { DocumentAnalysis } from '@/services/document-analysis';
import { prepareDocumentHtml } from '@/services/progressive-print';
import type { DocumentLocation } from '@/utils/document-location';

const props = defineProps<{
  source: string;
  analysis: DocumentAnalysis;
  options: RendererOptions;
  revision?: string | number;
  /** Reading uses the existing host workbench; split/external previews scroll themselves. */
  scrollParent?: HTMLElement | null;
}>();
const { t } = useI18n();
const root = ref<HTMLElement | null>(null);
let boundScrollParent: HTMLElement | null = null;
const parentInteractionEvents = ['pointerdown', 'wheel', 'keydown', 'touchmove'] as const;

function viewportBounds() {
  const owner = props.scrollParent ?? root.value;
  const rect = owner?.getBoundingClientRect();
  const headerHeight =
    props.scrollParent?.querySelector('.reader-workbench__bar')?.getBoundingClientRect().height ??
    0;
  const top = (rect?.top ?? 0) + headerHeight;
  return {
    top,
    bottom: rect?.bottom ?? 800,
    height: Math.max(1, (owner?.clientHeight || 800) - headerHeight),
  };
}
function viewportScrollTop() {
  if (!props.scrollParent || !root.value) return root.value?.scrollTop ?? 0;
  return Math.max(0, viewportBounds().top - root.value.getBoundingClientRect().top);
}
function setViewportScrollTop(top: number) {
  const owner = props.scrollParent ?? root.value;
  if (owner) owner.scrollTop += top - viewportScrollTop();
}
function bindScrollParent() {
  if (boundScrollParent) {
    boundScrollParent.removeEventListener('scroll', onScroll);
    for (const event of parentInteractionEvents)
      boundScrollParent.removeEventListener(event, onUserInteraction);
    observer?.unobserve(boundScrollParent);
  }
  boundScrollParent = props.scrollParent ?? null;
  if (boundScrollParent) {
    boundScrollParent.addEventListener('scroll', onScroll, { passive: true });
    for (const event of parentInteractionEvents)
      boundScrollParent.addEventListener(event, onUserInteraction, { passive: true });
    observer?.observe(boundScrollParent);
  }
  onScroll();
}
const emit = defineEmits<{ 'position-change': [location: DocumentLocation]; interaction: [] }>();
const fragments = shallowRef<PreviewFragment[]>([]);
let readingActive = false;
let positionFrame: number | null = null;
let navigationRange: { from: number; to: number; version: number } | null = null;
let navigationTimer: ReturnType<typeof setTimeout> | null = null;
let headingPositions = new Map<string, number>();
let unsubscribeHeadings: (() => void) | null = null;
let navigationElement: HTMLElement | null = null;
let resolveNavigationElement: (() => HTMLElement | null) | null = null;
let navigationIndex: number | null = null;
let navigationSource: number | null = null;
let baselineFragments: PreviewFragment[] = [];
let priorityFragments: PreviewFragment[] = [];
let unsubscribePriority: (() => void) | null = null;
let hadPriority = false;

function installCombined() {
  const priority = priorityFragments;
  const start = priority[0]?.from;
  const end = priority.at(-1)?.to;
  const selection = document.getSelection();
  const keepSelection =
    selection && !selection.isCollapsed && root.value?.contains(selection.anchorNode);
  const usePriority =
    start !== undefined &&
    end !== undefined &&
    ((baselineFragments.at(-1)?.to ?? 0) < end || keepSelection);
  let next = baselineFragments;
  if (usePriority) {
    let normal = baselineFragments.filter((part) => part.to <= start);
    let gapStart = normal.at(-1)?.to ?? 0;
    // Gaps begin at a whole structure boundary, so copying a gap can use the shared renderer.
    const blocks = props.analysis.result?.ast.blocks ?? [];
    let low = 0,
      high = blocks.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (blocks[mid]!.range.to < gapStart) low = mid + 1;
      else high = mid;
    }
    const block = blocks[low];
    if (block && block.range.from < gapStart && block.range.to > gapStart) {
      gapStart = block.type === 'listItem' ? block.groupRange.from : block.range.from;
      normal = normal.filter((part) => part.to <= gapStart);
      gapStart = normal.at(-1)?.to ?? 0;
    }
    const gap = (from: number, to: number): PreviewFragment[] =>
      to > from
        ? [
            {
              from,
              to,
              html: '',
              headings: [],
              lines: Math.max(1, Math.ceil((to - from) / 80)),
              placeholder: true,
            },
          ]
        : [];
    next = [...normal, ...gap(gapStart, start), ...priority, ...gap(end, props.source.length)];
  }
  const remap = hadPriority || !!usePriority;
  hadPriority = !!usePriority;
  if (navigationSource !== null) {
    const index = next.findIndex(
      (part) => !part.placeholder && navigationSource! >= part.from && navigationSource! < part.to,
    );
    if (index >= 0) navigationIndex = index;
  }
  install(next, remap);
}

function cancelNavigation() {
  pendingPosition = null;
  pendingHeading = null;
  navigationRange = null;
  navigationElement = null;
  resolveNavigationElement = null;
  navigationIndex = null;
  navigationSource = null;
  props.analysis.cancelPriority();
  if (navigationTimer) clearTimeout(navigationTimer);
  root.value
    ?.querySelectorAll('.preview-navigation-target')
    .forEach((node) => node.classList.remove('preview-navigation-target'));
}
function onUserInteraction() {
  readingActive = true;
  cancelNavigation();
  emit('interaction');
}
function notifyReadingPosition() {
  if (!readingActive || positionFrame !== null) return;
  positionFrame = requestAnimationFrame(() => {
    positionFrame = null;
    if (!disposed)
      emit('position-change', {
        analysis: props.analysis,
        revision: props.analysis.version,
        position: getPosition(),
        reason: 'scroll',
      });
  });
}
const heights = shallowRef<number[]>([]);
const first = ref(0);
const last = ref(12);
const failed = ref(false);
const complete = ref(false);
const findOpen = ref(false);
const findInput = ref<HTMLInputElement | null>(null);
const query = ref('');
let foundOffset = -1;
let prefix: number[] = [0];
const elements = new Map<string, HTMLElement>();
let fragmentIndices = new Map<string, number>();
const fragmentKey = (part: PreviewFragment) => `${part.from}:${part.to}`;
function elementAt(index: number): HTMLElement | undefined {
  const part = fragments.value[index];
  return part ? elements.get(fragmentKey(part)) : undefined;
}
function indexedElements(): Array<[number, HTMLElement]> {
  const result: Array<[number, HTMLElement]> = [];
  for (const [key, element] of elements) {
    const index = fragmentIndices.get(key);
    if (index !== undefined) result.push([index, element]);
  }
  return result;
}
const rendered = new WeakMap<HTMLElement, string>();
const inlineProgress = new WeakMap<HTMLElement, { html: string; next: number }>();
const htmlCache = new Map<string, string>();
let cacheBytes = 0;
let frame: number | null = null;
let measureFrame: number | null = null;
let observer: ResizeObserver | null = null;
let unsubscribe: (() => void) | null = null;
let healthTimer: ReturnType<typeof setInterval> | null = null;
let disposed = false;
let generation = 0;
let printAbort = new AbortController();
let selectedAll = false;
let selectionStart: number | null = null;
let draggingSelection = false;
let pendingPosition: number | null = null;
let pendingHeading: string | null = null;
let highlightedMatch = '';

const visible = computed(() =>
  fragments.value
    .slice(first.value, last.value)
    .map((fragment, offset) => ({ fragment, index: first.value + offset })),
);
const topHeight = computed(() => {
  return heights.value.length ? (prefix[first.value] ?? 0) : 0;
});
const bottomHeight = computed(() => {
  return heights.value.length ? Math.max(0, (prefix.at(-1) ?? 0) - (prefix[last.value] ?? 0)) : 0;
});

function rebuildPrefix() {
  prefix = [0];
  for (const height of heights.value) prefix.push(prefix[prefix.length - 1]! + height);
}
function locate(y: number) {
  let low = 0;
  let high = fragments.value.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (prefix[mid + 1]! < y) low = mid + 1;
    else high = mid;
  }
  return Math.min(low, Math.max(0, fragments.value.length - 1));
}
function onScroll() {
  if (!root.value) return;
  const height = viewportBounds().height;
  const top = viewportScrollTop();
  let from = locate(Math.max(0, top - height));
  let to = Math.min(fragments.value.length, locate(top + height * 2) + 1);
  // Keep the drag anchor in the DOM until selection ends, even across virtual ranges.
  if (selectionStart !== null) {
    from = Math.min(from, selectionStart);
    to = Math.max(to, selectionStart + 1);
  }
  if (navigationIndex !== null) {
    from = Math.min(from, navigationIndex);
    to = Math.max(to, navigationIndex + 1);
  }
  first.value = from;
  last.value = to;
  schedule();
  notifyReadingPosition();
}
function bindFragment(part: PreviewFragment, value: Element | ComponentPublicInstance | null) {
  const key = fragmentKey(part);
  const old = elements.get(key);
  if (!(value instanceof HTMLElement)) {
    if (old) observer?.unobserve(old);
    elements.delete(key);
    return;
  }
  if (old === value) return;
  elements.set(key, value);
  observer?.observe(value);
  schedule();
}
function cleanHtml(index: number): string {
  const fragment = fragments.value[index];
  if (!fragment) return '';
  if (fragment.placeholder) {
    const ast = props.analysis.result?.ast;
    const definitions =
      ast?.blocks
        .filter((block) => block.type === 'refDefinition')
        .map((block) => ast.source.slice(block.range.from, block.range.to))
        .join('\n') ?? '';
    return renderMarkdown(
      definitions + '\n\n' + props.source.slice(fragment.from, fragment.to),
      props.options,
    );
  }
  const key = fragment.html;
  const cached = htmlCache.get(key);
  if (cached !== undefined) {
    htmlCache.delete(key);
    htmlCache.set(key, cached);
    return cached;
  }
  const html = finalizePreparedHtml(fragment.html, props.options);
  const size = (key.length + html.length) * 2;
  if (size <= 24 * 1024 * 1024) {
    while (cacheBytes + size > 24 * 1024 * 1024 && htmlCache.size) {
      const oldest = htmlCache.keys().next().value!;
      cacheBytes -= (oldest.length + htmlCache.get(oldest)!.length) * 2;
      htmlCache.delete(oldest);
    }
    htmlCache.set(key, html);
    cacheBytes += size;
  }
  return html;
}

function schedule() {
  if (frame !== null || disposed) return;
  frame = requestAnimationFrame(paint);
}
function paint() {
  frame = null;
  if (disposed) return;
  const deadline = performance.now() + 8;
  // Actual viewport first, then overscan.
  const center = locate(viewportScrollTop());
  const entries = indexedElements().sort(([a], [b]) => Math.abs(a - center) - Math.abs(b - center));
  for (const [index, element] of entries) {
    const fragment = fragments.value[index];
    if (fragment?.placeholder) continue;
    if (!fragment || rendered.get(element) === fragment.html) continue;
    if (performance.now() >= deadline) {
      schedule();
      break;
    }
    if (fragment.inlineParts) {
      let progress = inlineProgress.get(element);
      if (!progress || progress.html !== fragment.html) {
        element.replaceChildren(document.createElement('p'));
        progress = { html: fragment.html, next: 0 };
        inlineProgress.set(element, progress);
      }
      while (progress.next < fragment.inlineParts.length && performance.now() < deadline) {
        const template = document.createElement('template');
        template.innerHTML = finalizePreparedHtml(
          fragment.inlineParts[progress.next++]!,
          props.options,
        );
        element.firstElementChild!.append(template.content);
      }
      if (progress.next < fragment.inlineParts.length) {
        schedule();
        break;
      }
      rendered.set(element, fragment.html);
      continue;
    }
    element.innerHTML = cleanHtml(index);
    rendered.set(element, fragment.html);
    // Large code blocks remain readable without an expensive whole-block highlighter.
    if (fragment.html.length < 16_384) highlightCodeBlocks(element);
  }
  highlightFound();
  revealNavigationRange();
  if (pendingHeading) {
    const target = root.value?.querySelector<HTMLElement>(`[id="${CSS.escape(pendingHeading)}"]`);
    if (target) {
      const id = pendingHeading;
      pendingHeading = null;
      resolveNavigationElement = () =>
        root.value?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`) ?? null;
      navigationElement = target;
      keepNavigationVisible();
    }
  }
  keepNavigationVisible();
  notifyReadingPosition();
}
function measure() {
  measureFrame = null;
  if (!root.value || disposed) return;
  const anchor = locate(viewportScrollTop());
  const before = prefix[anchor] ?? 0;
  const next = [...heights.value];
  let changed = false;
  for (const [index, element] of indexedElements()) {
    if (fragments.value[index]?.placeholder) continue;
    if (!rendered.has(element)) continue;
    element.style.minHeight = '0';
    const height = Math.max(1, element.getBoundingClientRect().height);
    if (Math.abs(height - (next[index] ?? 0)) > 1) {
      next[index] = height;
      changed = true;
    }
  }
  if (changed) {
    heights.value = next;
    rebuildPrefix();
    if (navigationIndex !== null) setViewportScrollTop(prefix[navigationIndex] ?? 0);
    else setViewportScrollTop(viewportScrollTop() + (prefix[anchor] ?? 0) - before);
    onScroll();
    void nextTick(schedule);
  } else onScroll();
}
function keepNavigationVisible() {
  navigationElement = resolveNavigationElement?.() ?? navigationElement;
  if (!navigationElement?.isConnected || !root.value) return;
  const bounds = viewportBounds();
  const rect = navigationElement.getBoundingClientRect();
  if (rect.bottom > bounds.bottom || rect.top < bounds.top)
    setViewportScrollTop(viewportScrollTop() + rect.top - bounds.top - 24);
}
function install(next: PreviewFragment[], remap = false) {
  if (disposed) return;
  complete.value = props.analysis.previewComplete;
  fragmentIndices = new Map(next.map((part, index) => [fragmentKey(part), index]));
  if (!remap && fragments.value.length && next[0] === fragments.value[0]) {
    const oldLength = fragments.value.length;
    fragments.value = next;
    heights.value = [...heights.value, ...next.slice(oldLength).map(estimateHeight)];
    rebuildPrefix();
    if (pendingHeading) scrollToHeading(pendingHeading);
    else if (pendingPosition !== null) scrollToPosition(pendingPosition);
    onScroll();
    return;
  }
  const position = getPosition();
  const previous = fragments.value;
  const previousHeights = heights.value;
  const measured = new Map(
    previous.map((part, index) => [`${part.from}:${part.to}`, previousHeights[index]]),
  );
  const selectionFrom = selectionStart === null ? null : previous[selectionStart]?.from;
  fragments.value = next;
  heights.value = next.map((part, index) =>
    remap && measured.has(`${part.from}:${part.to}`)
      ? measured.get(`${part.from}:${part.to}`)!
      : previous[index]?.html === part.html
        ? (previousHeights[index] ?? estimateHeight(part))
        : estimateHeight(part),
  );
  rebuildPrefix();
  if (selectionFrom !== null && selectionFrom !== undefined) {
    const index = next.findIndex((part) => part.from === selectionFrom);
    selectionStart = index >= 0 ? index : null;
  }
  const desired = pendingPosition ?? navigationSource ?? position;
  const anchor = Math.max(
    0,
    next.findIndex((part) => desired >= part.from && desired < part.to),
  );
  const anchorTop = prefix[anchor] ?? 0;
  const viewportHeight = viewportBounds().height;
  first.value = locate(Math.max(0, anchorTop - viewportHeight));
  last.value = Math.min(next.length, locate(anchorTop + viewportHeight * 2) + 1);
  void nextTick(() => {
    if (disposed) return;
    if (pendingHeading) scrollToHeading(pendingHeading);
    else scrollToPosition(pendingPosition ?? navigationSource ?? position);
    onScroll();
  });
}
function estimateHeight(part: PreviewFragment): number {
  return Math.max(
    24,
    Math.min(100_000, Math.max(part.lines, Math.ceil(part.html.length / 85)) * 24),
  );
}
function getPosition(): number {
  const container = root.value;
  if (!container) return 0;
  let position = fragments.value[locate(viewportScrollTop() + 24)]?.from ?? 0;
  const threshold = viewportBounds().top + 24;
  for (const heading of container.querySelectorAll<HTMLElement>(
    'h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]',
  )) {
    const from = headingPositions.get(heading.id);
    if (from === undefined) continue;
    if (heading.getBoundingClientRect().top <= threshold) position = Math.max(position, from);
    else if (from <= position) position = Math.max(0, from - 1);
  }
  return position;
}

function navigateToRange(from: number, to: number) {
  cancelNavigation();
  readingActive = false;
  navigationRange = { from, to, version: props.analysis.version };
  navigationSource = from;
  props.analysis.requestRange(from);
  scrollToPosition(from);
  schedule();
}
function revealNavigationRange() {
  const target = navigationRange;
  if (!target || target.version !== props.analysis.version) return;
  const index = fragments.value.findIndex(
    (part) => target.from >= part.from && target.from < part.to,
  );
  if (index >= 0) navigationIndex = index;
  const element = elementAt(index);
  const fragment = fragments.value[index];
  if (!element || !fragment || rendered.get(element) !== fragment.html) return;
  const references =
    props.analysis.result?.wikiLinks?.filter(
      (item) => item.from >= fragment.from && item.from < fragment.to,
    ) ?? [];
  const ordinal = references.findIndex(
    (item) => item.from === target.from && item.to === target.to,
  );
  const anchors = element.querySelectorAll<HTMLElement>('a[data-note]');
  const anchor = ordinal >= 0 ? anchors[ordinal] : undefined;
  const visibleTarget = anchor ?? element;
  resolveNavigationElement = () => {
    const currentIndex = fragments.value.findIndex(
      (part) => !part.placeholder && target.from >= part.from && target.from < part.to,
    );
    const host = elementAt(currentIndex);
    return (
      (ordinal >= 0 ? host?.querySelectorAll<HTMLElement>('a[data-note]')[ordinal] : host) ?? null
    );
  };
  navigationElement = visibleTarget;
  visibleTarget.classList.add('preview-navigation-target');
  keepNavigationVisible();
  navigationRange = null;
  navigationTimer = setTimeout(() => {
    visibleTarget.classList.remove('preview-navigation-target');
    navigationTimer = null;
  }, 1600);
}
function scrollToPosition(position: number) {
  if (!fragments.value.length || !root.value) {
    pendingPosition = position;
    props.analysis.requestRange(position);
    return;
  }
  let index = fragments.value.findIndex(
    (part) => !part.placeholder && position >= part.from && position < part.to,
  );
  if (index < 0 && !complete.value) {
    pendingPosition = position;
    props.analysis.requestRange(position);
    return;
  }
  pendingPosition = null;
  if (index < 0) index = position <= 0 ? 0 : fragments.value.length - 1;
  setViewportScrollTop(prefix[index] ?? 0);
  onScroll();
}
function scrollToHeading(id: string) {
  if (pendingHeading !== id) cancelNavigation();
  readingActive = false;
  pendingHeading = id;
  navigationSource = headingPositions.get(id) ?? null;
  if (navigationSource !== null) props.analysis.requestRange(navigationSource);
  const index = fragments.value.findIndex((part) => part.headings.includes(id));
  if (index < 0) {
    pendingHeading = id;
    return false;
  }
  navigationIndex = index;
  scrollToPosition(fragments.value[index]!.from);
  schedule();
  return true;
}
function retry() {
  failed.value = false;
  props.analysis.retry();
  props.analysis.requestPreview();
}
function onPointerDown(event: PointerEvent) {
  onUserInteraction();
  draggingSelection = true;
  selectedAll = false;
  selectionStart = Number(
    (event.target as HTMLElement)
      .closest('[data-preview-index]')
      ?.getAttribute('data-preview-index') ?? first.value,
  );
}
function onSelectionChange() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    if (!draggingSelection) selectionStart = null;
    selectedAll = false;
    if (hadPriority && complete.value) {
      priorityFragments = [];
      installCombined();
    }
  } else if (!selectedAll && selection.anchorNode && root.value?.contains(selection.anchorNode)) {
    const anchor = endpoint(selection.anchorNode, selection.anchorOffset);
    if (anchor) selectionStart = anchor.index;
  }
}
function onPointerCancel() {
  draggingSelection = false;
  selectionStart = null;
  selectedAll = false;
}
function onPointerUp() {
  draggingSelection = false;
  onSelectionChange();
}
function openFind() {
  findOpen.value = true;
  void nextTick(() => findInput.value?.focus());
}
function onKeydown(event: KeyboardEvent) {
  onUserInteraction();
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    event.stopPropagation();
    findOpen.value = true;
    void nextTick(() => findInput.value?.focus());
    return;
  }
  if (event.key === 'Escape' && findOpen.value) {
    event.preventDefault();
    findOpen.value = false;
    root.value?.focus();
    return;
  }
  if (event.target instanceof HTMLInputElement) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
    event.preventDefault();
    selectedAll = true;
    const range = document.createRange();
    range.selectNodeContents(root.value!);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
}
function find(direction: number) {
  for (const mark of root.value?.querySelectorAll('mark.preview-find-match') ?? [])
    mark.replaceWith(...mark.childNodes);
  highlightedMatch = '';
  if (!query.value) {
    foundOffset = -1;
    return;
  }
  const source = props.source;
  const pattern = new RegExp(query.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const start = direction === 0 ? 0 : foundOffset + direction;
  let offset = -1;
  if (direction >= 0) {
    pattern.lastIndex = Math.max(0, start);
    offset = pattern.exec(source)?.index ?? -1;
    if (offset < 0) {
      pattern.lastIndex = 0;
      offset = pattern.exec(source)?.index ?? -1;
    }
  } else {
    let match: RegExpExecArray | null;
    let final = -1;
    while ((match = pattern.exec(source))) {
      final = match.index;
      if (match.index <= start) offset = match.index;
    }
    if (offset < 0) offset = final;
  }
  foundOffset = offset;
  if (offset >= 0) scrollToPosition(offset);
}
function highlightFound() {
  if (!findOpen.value || foundOffset < 0 || !query.value) return;
  const identity = `${generation}:${foundOffset}:${query.value}`;
  if (identity === highlightedMatch && root.value?.querySelector('mark.preview-find-match')) return;
  for (const [index, element] of indexedElements()) {
    const fragment = fragments.value[index];
    if (
      !fragment ||
      foundOffset < fragment.from ||
      foundOffset >= fragment.to ||
      rendered.get(element) !== fragment.html
    )
      continue;
    for (const mark of root.value?.querySelectorAll('mark.preview-find-match') ?? [])
      mark.replaceWith(...mark.childNodes);
    const pattern = new RegExp(query.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
    let skip = [...props.source.slice(fragment.from, foundOffset).matchAll(pattern)].length;
    let walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    let target: { node: Node; offset: number; length: number } | null = null;
    while ((node = walker.nextNode())) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(node.textContent ?? ''))) {
        if (skip-- > 0) continue;
        target = { node, offset: match.index, length: match[0].length };
        break;
      }
      if (target) break;
    }
    if (!target) {
      // A source-only match (for example a link URL) must still be visible in read search.
      element.textContent = props.source.slice(fragment.from, fragment.to);
      walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      node = walker.nextNode();
      if (node) target = { node, offset: foundOffset - fragment.from, length: query.value.length };
    }
    if (target) {
      const range = document.createRange();
      range.setStart(target.node, target.offset);
      range.setEnd(
        target.node,
        Math.min(target.offset + target.length, target.node.textContent?.length ?? 0),
      );
      const mark = document.createElement('mark');
      mark.className = 'preview-find-match';
      range.surroundContents(mark);
      highlightedMatch = identity;
      mark.scrollIntoView?.({ block: 'center', behavior: 'instant' });
    }
    break;
  }
}
function endpoint(node: Node, offset: number): { index: number; offset: number } | null {
  const element = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(
    '[data-preview-index]',
  );
  if (!element) return null;
  const range = document.createRange();
  range.selectNodeContents(element);
  range.setEnd(node, offset);
  return { index: Number(element.dataset.previewIndex), offset: range.toString().length };
}
function onCopy(event: ClipboardEvent) {
  const selection = window.getSelection();
  if (!selection || !event.clipboardData || (!selectedAll && selection.isCollapsed)) return;
  if (selectedAll) {
    // Explicit whole-document copying preserves the canonical renderer clipboard text, including whitespace at chunk boundaries.
    const container = document.createElement('div');
    container.innerHTML = renderMarkdown(props.source, props.options);
    event.preventDefault();
    event.clipboardData.setData('text/plain', container.textContent ?? '');
    event.clipboardData.setData('text/html', container.innerHTML);
    return;
  }
  let from = { index: 0, offset: 0 };
  let to = { index: fragments.value.length - 1, offset: Infinity };
  if (!selectedAll) {
    const range = selection.getRangeAt(0);
    const start = endpoint(range.startContainer, range.startOffset);
    const end = endpoint(range.endContainer, range.endOffset);
    if (!start || !end) return;
    from = start;
    to = end;
  }
  // Clipboard is a deliberate full-selection operation, independent of mounted DOM.
  const container = document.createElement('div');
  for (let i = from.index; i <= to.index; i++) {
    const block = document.createElement('div');
    block.innerHTML = cleanHtml(i);
    container.append(block);
  }
  const text = [...container.children]
    .map((element, index) => {
      let value = element.textContent ?? '';
      if (index === to.index - from.index) value = value.slice(0, to.offset);
      if (index === 0) value = value.slice(from.offset);
      return value;
    })
    .join('');
  event.preventDefault();
  event.clipboardData.setData('text/plain', text);
  // Partial endpoints must not leak the unselected prefix/suffix as rich clipboard data.
}
async function prepareFullHtml(): Promise<string> {
  if (hadPriority || fragments.value.some((part) => part.placeholder))
    return prepareDocumentHtml(props.source, props.options, printAbort.signal);
  const version = generation;
  if (!props.analysis.previewComplete && props.source) {
    return prepareDocumentHtml(props.source, props.options, printAbort.signal);
  }
  const parts: string[] = [];
  let deadline = performance.now() + 8;
  for (let i = 0; i < fragments.value.length; i++) {
    if (disposed || generation !== version)
      throw new Error('Document changed during print preparation');
    parts.push(cleanHtml(i));
    if (performance.now() >= deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      deadline = performance.now() + 8;
    }
  }
  return parts.join('');
}
watch(() => props.scrollParent, bindScrollParent, { flush: 'post' });
watch(
  () => props.source,
  (source) => {
    cancelNavigation();
    priorityFragments = [];
    generation++;
    printAbort.abort();
    printAbort = new AbortController();
    selectedAll = false;
    selectionStart = null;
    complete.value = false;
    props.analysis.update(source);
    // The old view remains visible until the matching version is ready.
  },
);
watch(findOpen, (open) => {
  if (open) return;
  highlightedMatch = '';
  foundOffset = -1;
  for (const element of elements.values()) {
    rendered.delete(element);
    inlineProgress.delete(element);
  }
  schedule();
});
watch(
  () => props.revision,
  () => {
    htmlCache.clear();
    cacheBytes = 0;
    for (const element of elements.values()) rendered.delete(element);
    for (const element of elements.values()) inlineProgress.delete(element);
    schedule();
  },
);
onMounted(() => {
  const updateHeadings = () => {
    headingPositions = new Map(
      props.analysis.result?.ast.blocks
        .filter((block) => block.type === 'heading')
        .map((block) => [block.id, block.range.from]) ?? [],
    );
  };
  unsubscribeHeadings = props.analysis.subscribe(updateHeadings);
  updateHeadings();
  observer = new ResizeObserver(() => {
    if (measureFrame === null) measureFrame = requestAnimationFrame(measure);
  });
  bindScrollParent();
  unsubscribe = props.analysis.subscribePreview((next) => {
    baselineFragments = next;
    installCombined();
  });
  unsubscribePriority = props.analysis.subscribePriority((next) => {
    priorityFragments = next;
    installCombined();
  });
  props.analysis.update(props.source);
  props.analysis.requestPreview();
  healthTimer = setInterval(() => {
    failed.value = !!props.analysis.error;
  }, 500);
  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('blur', onPointerCancel);
});
onUnmounted(() => {
  cancelNavigation();
  unsubscribeHeadings?.();
  if (positionFrame !== null) cancelAnimationFrame(positionFrame);
  disposed = true;
  printAbort.abort();
  unsubscribe?.();
  unsubscribePriority?.();
  if (boundScrollParent) {
    boundScrollParent.removeEventListener('scroll', onScroll);
    for (const event of parentInteractionEvents)
      boundScrollParent.removeEventListener(event, onUserInteraction);
  }
  observer?.disconnect();
  if (frame !== null) cancelAnimationFrame(frame);
  if (measureFrame !== null) cancelAnimationFrame(measureFrame);
  if (healthTimer !== null) clearInterval(healthTimer);
  document.removeEventListener('selectionchange', onSelectionChange);
  document.removeEventListener('pointerup', onPointerUp);
  document.removeEventListener('pointercancel', onPointerCancel);
  window.removeEventListener('blur', onPointerCancel);
  elements.clear();
  htmlCache.clear();
});
defineExpose({
  scrollToPosition,
  scrollToHeading,
  navigateToRange,
  cancelNavigation,
  getPosition,
  prepareFullHtml,
  openFind,
});
</script>

<style scoped>
.progressive-preview {
  overflow: auto;
  overflow-anchor: none;
}

.progressive-preview--outer-scroll {
  overflow: visible;
}

.preview-fragment {
  display: flow-root;
}

.progressive-preview :deep(.preview-navigation-target) {
  background: var(--accent-soft);
  outline: var(--border-thin) solid var(--accent);
  outline-offset: 2px;
}

.preview-source-fallback {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.preview-fragment :deep(.progressive-table) {
  table-layout: fixed;
  width: 100%;
}

.preview-find {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  gap: var(--space-4);
  padding: var(--space-8);
  background: var(--paper-surface);
}

.preview-fragment :deep(.preview-find-match) {
  color: var(--accent);
  background: var(--paper-surface);
  text-decoration: underline;
}
</style>
