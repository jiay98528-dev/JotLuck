<template>
  <article
    ref="root"
    class="progressive-preview"
    tabindex="0"
    :data-preview-complete="complete"
    @scroll.passive="onScroll"
    @keydown="onKeydown"
    @copy="onCopy"
    @pointerdown="onPointerDown"
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
        :key="item.index"
        :ref="(element) => bindFragment(item.index, element)"
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

const props = defineProps<{
  source: string;
  analysis: DocumentAnalysis;
  options: RendererOptions;
  revision?: string | number;
}>();
const { t } = useI18n();
const root = ref<HTMLElement | null>(null);
const fragments = shallowRef<PreviewFragment[]>([]);
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
const elements = new Map<number, HTMLElement>();
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
  const height = root.value.clientHeight || 800;
  let from = locate(Math.max(0, root.value.scrollTop - height));
  let to = Math.min(fragments.value.length, locate(root.value.scrollTop + height * 2) + 1);
  // Keep the drag anchor in the DOM until selection ends, even across virtual ranges.
  if (selectionStart !== null) {
    from = Math.min(from, selectionStart);
    to = Math.max(to, selectionStart + 1);
  }
  first.value = from;
  last.value = to;
  schedule();
}
function bindFragment(index: number, value: Element | ComponentPublicInstance | null) {
  const old = elements.get(index);
  if (!(value instanceof HTMLElement)) {
    if (old) observer?.unobserve(old);
    elements.delete(index);
    return;
  }
  if (old === value) return;
  elements.set(index, value);
  observer?.observe(value);
  schedule();
}
function cleanHtml(index: number): string {
  const fragment = fragments.value[index];
  if (!fragment) return '';
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
  const center = locate(root.value?.scrollTop ?? 0);
  const entries = [...elements].sort(([a], [b]) => Math.abs(a - center) - Math.abs(b - center));
  for (const [index, element] of entries) {
    const fragment = fragments.value[index];
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
}
function measure() {
  measureFrame = null;
  if (!root.value || disposed) return;
  const anchor = locate(root.value.scrollTop);
  const before = prefix[anchor] ?? 0;
  const next = [...heights.value];
  let changed = false;
  for (const [index, element] of elements) {
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
    root.value.scrollTop += (prefix[anchor] ?? 0) - before;
    onScroll();
  }
}
function install(next: PreviewFragment[]) {
  if (disposed) return;
  complete.value = props.analysis.previewComplete;
  if (fragments.value.length && next[0] === fragments.value[0]) {
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
  fragments.value = next;
  heights.value = next.map((part, index) =>
    previous[index]?.html === part.html
      ? (previousHeights[index] ?? estimateHeight(part))
      : estimateHeight(part),
  );
  rebuildPrefix();
  first.value = 0;
  last.value = Math.min(12, next.length);
  void nextTick(() => {
    if (disposed) return;
    scrollToPosition(pendingPosition ?? position);
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
  return fragments.value[locate(root.value?.scrollTop ?? 0)]?.from ?? 0;
}
function scrollToPosition(position: number) {
  if (!fragments.value.length || !root.value) {
    pendingPosition = position;
    return;
  }
  let index = fragments.value.findIndex((part) => position >= part.from && position < part.to);
  if (index < 0 && !complete.value) {
    pendingPosition = position;
    return;
  }
  pendingPosition = null;
  if (index < 0) index = position <= 0 ? 0 : fragments.value.length - 1;
  root.value.scrollTop = prefix[index] ?? 0;
  onScroll();
}
function scrollToHeading(id: string) {
  const index = fragments.value.findIndex((part) => part.headings.includes(id));
  if (index < 0) {
    pendingHeading = id;
    return false;
  }
  pendingHeading = null;
  scrollToPosition(fragments.value[index]!.from);
  void nextTick(() =>
    elements
      .get(index)
      ?.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
      ?.scrollIntoView({ block: 'start' }),
  );
  return true;
}
function retry() {
  failed.value = false;
  props.analysis.retry();
  props.analysis.requestPreview();
}
function onPointerDown(event: PointerEvent) {
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
  } else if (!selectedAll && selection.anchorNode && root.value?.contains(selection.anchorNode)) {
    const anchor = endpoint(selection.anchorNode, selection.anchorOffset);
    if (anchor) selectionStart = anchor.index;
  }
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
  for (const [index, element] of elements) {
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
watch(
  () => props.source,
  (source) => {
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
  observer = new ResizeObserver(() => {
    if (measureFrame === null) measureFrame = requestAnimationFrame(measure);
  });
  unsubscribe = props.analysis.subscribePreview(install);
  props.analysis.update(props.source);
  props.analysis.requestPreview();
  healthTimer = setInterval(() => {
    failed.value = !!props.analysis.error;
  }, 500);
  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('pointerup', onPointerUp);
});
onUnmounted(() => {
  disposed = true;
  printAbort.abort();
  unsubscribe?.();
  observer?.disconnect();
  if (frame !== null) cancelAnimationFrame(frame);
  if (measureFrame !== null) cancelAnimationFrame(measureFrame);
  if (healthTimer !== null) clearInterval(healthTimer);
  document.removeEventListener('selectionchange', onSelectionChange);
  document.removeEventListener('pointerup', onPointerUp);
  elements.clear();
  htmlCache.clear();
});
defineExpose({ scrollToPosition, scrollToHeading, getPosition, prepareFullHtml, openFind });
</script>

<style scoped>
.progressive-preview {
  overflow: auto;
  overflow-anchor: none;
}

.preview-fragment {
  display: flow-root;
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
