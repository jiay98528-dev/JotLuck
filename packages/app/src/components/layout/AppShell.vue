<template>
  <div class="app-shell">
    <!-- Left Wing: 56px bookmark strip -->
    <LeftWing
      :notes="recentNotes"
      :active-path="activePath"
      @select-note="$emit('select-note', $event)"
      @create-note="$emit('create-note')"
      @open-settings="$emit('open-settings')"
    />
    <div class="wing-divider" />
    <!-- Center: Editor Area -->
    <main class="editor-area">
      <TopBar
        v-if="showTopBar"
        :note-title="noteTitle"
        :notebook-name="notebookName"
        @toggle-left-wing="$emit('toggle-left-wing')"
        @open-palette="$emit('open-palette')"
        @open-export="$emit('open-export')"
        @open-share="$emit('open-share')"
        @toggle-theme="$emit('toggle-theme')"
      />
      <div class="editor-scroll">
        <slot name="editor" />
      </div>
      <StatusBar
        :char-count="charCount"
        :word-count="wordCount"
        :line-count="lineCount"
        :cursor-line="cursorLine"
        :cursor-col="cursorCol"
        :is-dirty="isDirty"
        :is-saving="isSaving"
        :save-error="saveError"
        :last-saved-at="lastSavedAt"
      />
    </main>
    <div v-if="showRightWing" class="wing-divider" />
    <!-- Right Wing: 240px reference panel -->
    <RightWing
      v-if="showRightWing"
      :headings="headings"
      :backlinks="backlinks"
      :tags="tags"
      :active-heading-id="activeHeadingId"
      :collapsed="!showRightWing"
      @navigate-heading="(id: string, ln: number) => $emit('navigate-heading', id, ln)"
      @navigate-backlink="(entry: any) => $emit('navigate-backlink', entry)"
      @select-tag="$emit('select-tag', $event)"
      @toggle-collapse="$emit('toggle-right-wing')"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * AppShell.vue — 羽翼編纂布局容器
 *
 * 非对称三区布局:
 *   左翼 56px | 编辑器 flex:1 | 右翼 240px
 *
 * @see migration-map.md §1.4 — 替换原 AppLayout
 */
import LeftWing from './LeftWing.vue';
import RightWing from './RightWing.vue';
import TopBar from '../editor/TopBar.vue';
import StatusBar from '../editor/StatusBar.vue';
import type { HeadingItem, BacklinkEntry, TagEntry } from '@/types';

defineProps<{
  recentNotes: Array<{ path: string; title: string; colorIndex: number }>;
  activePath: string;
  noteTitle: string;
  notebookName: string;
  showTopBar: boolean;
  showRightWing: boolean;
  headings: HeadingItem[];
  backlinks: BacklinkEntry[];
  tags: TagEntry[];
  activeHeadingId: string | null;
  charCount: number;
  wordCount: number;
  lineCount: number;
  cursorLine: number | null;
  cursorCol: number | null;
  isDirty: boolean;
  isSaving: boolean;
  saveError: string | null;
  lastSavedAt: number | null;
}>();

defineEmits<{
  'select-note': [path: string];
  'create-note': [];
  'open-settings': [];
  'toggle-left-wing': [];
  'open-palette': [];
  'open-export': [];
  'open-share': [];
  'toggle-theme': [];
  'navigate-heading': [headingId: string, lineNumber: number];
  'navigate-backlink': [entry: BacklinkEntry];
  'select-tag': [tagName: string];
  'toggle-right-wing': [];
}>();
</script>

<style scoped>
.app-shell {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: var(--paper-bg);
}

.editor-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--paper-surface);
  position: relative;
}

.editor-scroll {
  flex: 1;
  overflow: hidden auto;
  scroll-behavior: smooth;
}

@media (width <= 720px) {
  .app-shell {
    width: 100%;
    min-width: 0;
  }

  .editor-area + .wing-divider,
  :deep(.right-wing) {
    display: none;
  }
}
</style>
