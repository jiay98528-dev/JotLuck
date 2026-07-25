<template>
  <ExternalReaderSlotBoundary theme-id="jotluck.builtin-reader" :slot-props="slotProps">
    <main class="external-reader" data-testid="external-file-session">
      <header class="external-reader__topbar">
        <div class="external-reader__identity">
          <img
            class="external-reader__logo"
            :src="appLogoUrl"
            alt="JotLuck"
            width="34"
            height="34"
          />
          <div class="external-reader__title-group">
            <p class="external-reader__kicker">
              外部文件 · {{ isEditing ? '单文件编辑' : '只读预览' }}
            </p>
            <h1>{{ fileName }}</h1>
            <p class="external-reader__path" :title="openedFile?.absolutePath ?? ''">
              {{ openedFile?.absolutePath ?? '' }}
            </p>
          </div>
        </div>

        <div v-if="!errorMessage" class="external-reader__actions">
          <span class="external-reader__stats">{{ readStats }}</span>
          <Button variant="secondary" size="sm" :loading="actionPending" @click="promote">
            添加到笔记
          </Button>
          <Button v-if="!isEditing" size="sm" :disabled="actionPending" @click="enableEdit">
            启用编辑
          </Button>
        </div>
      </header>

      <div class="external-reader__workspace">
        <section
          ref="documentScroller"
          class="external-reader__document-scroll"
          aria-live="polite"
          tabindex="0"
          @scroll.passive="updateActiveHeading"
        >
          <p v-if="loading" class="external-reader__state">正在打开文件...</p>
          <div
            v-else-if="errorMessage"
            class="external-reader__state external-reader__state--error"
            role="alert"
          >
            <strong>无法打开文件</strong>
            <span>{{ errorMessage }}</span>
          </div>
          <template v-else>
            <p v-if="readerNotice" class="external-reader__notice" role="status">
              {{ readerNotice }}
            </p>
            <pre v-if="isPlainText" class="external-reader__plain">{{ content }}</pre>
            <!-- eslint-disable vue/no-v-html -->
            <article
              v-else
              ref="markdownElement"
              class="markdown-body external-reader__markdown"
              @click="onMarkdownClick"
              v-html="html"
            />
            <!-- eslint-enable vue/no-v-html -->
          </template>
        </section>

        <div v-if="!loading && !errorMessage" class="external-reader__divider" />
        <RightWing
          v-if="!loading && !errorMessage"
          :headings="headings"
          :backlinks="backlinks"
          :tags="tags"
          :active-heading-id="activeHeadingId"
          :region="readerRegion"
          backlinks-empty-text="添加笔记后可用"
          @navigate-heading="scrollHeading"
          @navigate-backlink="onBacklinkNavigate"
          @select-tag="onTagSelect"
        />
      </div>

      <footer class="external-reader__statusbar">
        <span>{{ isPlainText ? '纯文本' : 'Markdown 安全预览' }}</span>
        <span v-if="!loading && !errorMessage">{{ readStats }}</span>
      </footer>
    </main>
  </ExternalReaderSlotBoundary>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useRouter } from 'vue-router';
import Button from '@/components/common/Button.vue';
import RightWing from '@/components/layout/RightWing.vue';
import ExternalReaderSlotBoundary from '@/components/theme/ExternalReaderSlotBoundary.vue';
import { useHeadings } from '@/composables/useHeadings';
import appLogoUrl from '../../src-tauri/icons/128x128.png';
import type {
  BacklinkEntry,
  ExternalOpenedFile,
  PromotedNotebookPayload,
  TagEntry,
  WindowBootstrapPayload,
} from '@/types';
import type { RightWingRegion } from '@/types/theme-pack';
import { normalizeUrl } from '@/utils/urlUtils';

const router = useRouter();
const openedFile = ref<ExternalOpenedFile | null>(null);
const content = ref('');
const html = ref('');
const loading = ref(true);
const errorMessage = ref('');
const readerNotice = ref('');
const actionPending = ref(false);
const isEditing = ref(false);
const markdownElement = ref<HTMLElement | null>(null);
const documentScroller = ref<HTMLElement | null>(null);
const activeHeadingId = ref<string | null>(null);
const backlinks = ref<BacklinkEntry[]>([]);
const { headings, update: updateHeadings } = useHeadings();

const readerRegion: RightWingRegion = {
  mode: 'balanced',
  policy: 'outline',
  sections: ['outline', 'backlinks', 'tags'],
  defaultOpenSections: ['outline', 'backlinks'],
};

const fileName = computed(
  () => openedFile.value?.absolutePath.split(/[\\/]/).pop() || '未命名文件',
);
const isPlainText = computed(() => /\.txt$/i.test(fileName.value));
const readStats = computed(() => {
  const lineCount = content.value === '' ? 0 : content.value.split('\n').length;
  return `${lineCount} 行 · ${content.value.length} 字符`;
});
const tags = computed<TagEntry[]>(() => {
  if (isPlainText.value) return [];
  const counts = new Map<string, number>();
  for (const line of content.value.split('\n')) {
    if (/^\s{0,3}#{1,6}\s/u.test(line)) continue;
    for (const match of line.matchAll(/(?:^|[\s(])#([^\s#)]+)/gu)) {
      const name = match[1]?.replace(/[.,!?;:，。！？；：]+$/u, '');
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts].map(([name, count]) => ({ name, count }));
});
const slotProps = computed(() => ({
  fileName: fileName.value,
  filePath: openedFile.value?.absolutePath ?? '',
  stats: readStats.value,
  headings: headings.value,
  loading: loading.value,
  error: errorMessage.value,
  enableEdit,
  openParentAsNotebook: promote,
  scrollHeading,
}));

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    const bootstrap = await invoke<WindowBootstrapPayload>('get_window_bootstrap');
    if (bootstrap.mode === 'workspace') {
      await router.replace('/workspace');
      return;
    }
    openedFile.value = bootstrap.openedFile;
    isEditing.value = bootstrap.mode === 'external-edit';
    content.value = await invoke<string>('read_external_note_file', {
      accessToken: bootstrap.openedFile.accessToken,
      relativePath: bootstrap.openedFile.relativePath,
    });
    document.title = `${fileName.value} · JotLuck`;
    if (!isPlainText.value) {
      updateHeadings(content.value);
      const renderer = await import('@jotluck/renderer');
      html.value = renderer.renderMarkdown(content.value);
      await nextTick();
      if (markdownElement.value) renderer.highlightCodeBlocks(markdownElement.value);
    }
    performance.mark('jotluck:reader-ready');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

function findHeadingElement(id: string): HTMLElement | undefined {
  return [...(markdownElement.value?.querySelectorAll<HTMLElement>('[id]') ?? [])].find(
    (element) => element.id === id,
  );
}

function scrollHeading(id: string): void {
  const target = findHeadingElement(id);
  if (!target) return;
  activeHeadingId.value = id;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateActiveHeading(): void {
  const scroller = documentScroller.value;
  const article = markdownElement.value;
  if (!scroller || !article) return;
  const threshold = scroller.getBoundingClientRect().top + 96;
  let active: string | null = null;
  for (const heading of article.querySelectorAll<HTMLElement>(
    'h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]',
  )) {
    if (heading.getBoundingClientRect().top <= threshold) active = heading.id;
    else break;
  }
  activeHeadingId.value = active;
}

function showNotebookCapabilityNotice(subject: string): void {
  readerNotice.value = `${subject}需要笔记本上下文。点击“添加到笔记”后即可使用。`;
}

function onMarkdownClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest('a');
  if (!anchor || !markdownElement.value?.contains(anchor)) return;

  const note = anchor.getAttribute('data-note');
  if (note) {
    event.preventDefault();
    showNotebookCapabilityNotice(`Wiki-link“${note}”跳转`);
    return;
  }
  const tag = anchor.getAttribute('data-tag');
  if (tag) {
    event.preventDefault();
    showNotebookCapabilityNotice(`标签“#${tag}”筛选`);
    return;
  }

  const href = anchor.getAttribute('href');
  if (!href) return;
  event.preventDefault();
  if (href.startsWith('#')) {
    scrollHeading(decodeURIComponent(href.slice(1)));
    return;
  }
  if (/^(?:https?:\/\/|mailto:|tel:|ftp:|www\.)/i.test(href)) {
    window.open(normalizeUrl(href), '_blank', 'noopener,noreferrer');
    return;
  }
  showNotebookCapabilityNotice(`相对链接“${href}”跳转`);
}

function onTagSelect(tagName: string): void {
  showNotebookCapabilityNotice(`标签“#${tagName}”筛选`);
}

function onBacklinkNavigate(): void {
  showNotebookCapabilityNotice('反链跳转');
}

async function enableEdit(): Promise<void> {
  actionPending.value = true;
  try {
    await invoke('enable_external_edit');
    await router.replace('/workspace');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    actionPending.value = false;
  }
}

async function promote(): Promise<void> {
  actionPending.value = true;
  try {
    await invoke<PromotedNotebookPayload>('promote_external_file_to_notebook');
    await router.replace('/workspace');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    actionPending.value = false;
  }
}

onMounted(() => void load());
</script>

<style scoped>
.external-reader {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background: var(--paper-bg);
  color: var(--ink-primary);
}

.external-reader__topbar {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-16);
  min-height: var(--topbar-height);
  padding: var(--space-8) var(--space-16);
  border-bottom: var(--border-thin) solid var(--rule);
  background: var(--paper-raised);
}

.external-reader__identity {
  display: flex;
  align-items: center;
  gap: var(--space-12);
  min-width: 0;
}

.external-reader__logo {
  flex: 0 0 34px;
  width: 34px;
  height: 34px;
  border-radius: var(--radius);
  object-fit: cover;
}

.external-reader__title-group {
  min-width: 0;
}

.external-reader__kicker,
.external-reader__path,
.external-reader__stats {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--text-xs);
  line-height: var(--lh-ui);
}

.external-reader h1 {
  margin: 1px 0;
  overflow: hidden;
  color: var(--ink-primary);
  font-family: var(--ff-heading);
  font-size: var(--text-base);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-heading);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.external-reader__path {
  max-width: min(52vw, 680px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.external-reader__actions {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  flex-shrink: 0;
}

.external-reader__stats {
  margin-right: var(--space-4);
}

.external-reader__workspace {
  display: flex;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.external-reader__document-scroll {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  background: color-mix(in oklch, var(--paper-bg) 72%, var(--paper-surface));
}

.external-reader__document-scroll:focus-visible {
  outline: var(--focus-ring-width) solid var(--accent);
  outline-offset: calc(-1 * var(--focus-ring-offset));
}

.external-reader__divider {
  flex: 0 0 var(--border-thin);
  background: var(--rule-wing);
}

.external-reader__state,
.external-reader__notice,
.external-reader__plain,
.external-reader__markdown {
  width: min(var(--editor-max-width), calc(100% - var(--space-48)));
  margin-inline: auto;
}

.external-reader__state {
  display: grid;
  gap: var(--space-8);
  padding-top: var(--space-48);
  color: var(--ink-secondary);
}

.external-reader__state--error {
  color: var(--signal-error);
}

.external-reader__notice {
  box-sizing: border-box;
  margin-top: var(--space-16);
  margin-bottom: calc(-1 * var(--space-16));
  padding: var(--space-8) var(--space-12);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--accent-soft);
  color: var(--ink-secondary);
  font-size: var(--text-sm);
  line-height: var(--lh-ui);
}

.external-reader__plain {
  box-sizing: border-box;
  min-height: 100%;
  margin-top: 0;
  margin-bottom: 0;
  padding-top: var(--editor-top-pad);
  padding-bottom: var(--space-96);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  color: var(--ink-primary);
  font-family: var(--ff-body);
  font-size: var(--text-base);
  line-height: var(--lh-body);
}

.external-reader__markdown {
  box-sizing: border-box;
}

.external-reader__statusbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: var(--statusbar-height);
  padding: 0 var(--space-12);
  border-top: var(--border-thin) solid var(--rule);
  background: var(--paper-raised);
  color: var(--ink-muted);
  font-size: var(--text-xs);
  line-height: var(--lh-ui);
}

@media (width <= 900px) {
  .external-reader__stats {
    display: none;
  }

  .external-reader__workspace :deep(.right-wing) {
    width: 220px !important;
  }
}

@media (width <= 720px) {
  .external-reader__topbar {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .external-reader__actions {
    width: 100%;
    justify-content: flex-end;
  }

  .external-reader__workspace :deep(.right-wing),
  .external-reader__divider {
    display: none;
  }

  .external-reader__path {
    max-width: calc(100vw - 80px);
  }
}
</style>
