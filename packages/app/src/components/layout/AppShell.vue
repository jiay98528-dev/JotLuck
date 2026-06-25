<template>
  <div
    class="app-shell"
    :data-chrome-topbar="themeChrome.topBarVariant"
    :data-chrome-left-wing="themeChrome.leftWingMode"
    :data-chrome-right-wing="themeChrome.rightWingMode"
    :data-chrome-toolbar="themeChrome.toolbarDensity"
    :data-chrome-reading="themeChrome.readingWidth"
    :data-chrome-official="themeChrome.official ? 'true' : 'false'"
    :data-workspace-intent="themeChrome.workspaceIntent"
    :data-topbar-layout="themeChrome.topBarLayout"
    :data-left-wing-layout="themeChrome.leftWingLayout"
    :data-editor-control-layout="themeChrome.editorControlLayout"
    :data-status-layout="themeChrome.statusLayout"
    :data-right-wing-policy="themeChrome.rightWingPolicy"
  >
    <ThemeEffectLayer
      :effect-profile="themeChrome.effectProfile"
      :motion-intensity="themeChrome.motionIntensity"
    />
    <!-- Left Wing: 56px bookmark strip -->
    <LeftWing
      :notes="recentNotes"
      :active-path="activePath"
      :mode="themeChrome.leftWingMode"
      :layout="themeChrome.leftWingLayout"
      :actions="actionsFor('left-wing')"
      @select-note="$emit('select-note', $event)"
    />
    <div class="wing-divider" />
    <!-- Center: Editor Area -->
    <main class="editor-area">
      <TopBar
        v-if="showTopBar"
        :note-title="noteTitle"
        :notebook-name="notebookName"
        :variant="themeChrome.topBarVariant"
        :layout="themeChrome.topBarLayout"
        :left-actions="actionsFor('topbar-left')"
        :center-actions="actionsFor('topbar-center')"
        :right-actions="actionsFor('topbar-right')"
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
        :density="themeChrome.statusDensity"
        :layout="themeChrome.statusLayout"
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
      :mode="themeChrome.rightWingMode"
      :policy="themeChrome.rightWingPolicy"
      :sections="themeChrome.rightWingSections"
      :default-open-sections="themeChrome.defaultOpenSections"
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
import ThemeEffectLayer from '../theme/ThemeEffectLayer.vue';
import type { HeadingItem, BacklinkEntry, TagEntry } from '@/types';
import type { ShellAction, ThemeActionRegion, ThemeChromeState } from '@/types/theme-pack';
import { computed } from 'vue';

const props = defineProps<{
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
  themeChrome: ThemeChromeState;
  actions: ShellAction[];
}>();

defineEmits<{
  'select-note': [path: string];
  'navigate-heading': [headingId: string, lineNumber: number];
  'navigate-backlink': [entry: BacklinkEntry];
  'select-tag': [tagName: string];
  'toggle-right-wing': [];
}>();

const actionGroups = computed(() => {
  const groups = new Map<ThemeActionRegion, ShellAction[]>();
  for (const action of props.actions) {
    if (action.region === 'hidden') continue;
    const group = groups.get(action.region) ?? [];
    group.push(action);
    groups.set(action.region, group);
  }
  return groups;
});

function actionsFor(region: ThemeActionRegion): ShellAction[] {
  return actionGroups.value.get(region) ?? [];
}
</script>

<style scoped>
.app-shell {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: var(--paper-bg);
}

.app-shell > :not(.theme-effect-layer) {
  position: relative;
  z-index: 1;
}

.editor-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--paper-surface);
  position: relative;
}

.app-shell[data-chrome-reading='immersive'] .editor-area {
  background: color-mix(in oklch, var(--paper-surface) 88%, transparent);
}

.editor-scroll {
  flex: 1;
  overflow: hidden auto;
  scroll-behavior: smooth;
}

.app-shell[data-chrome-reading='compact'] .editor-scroll {
  scroll-padding-top: var(--space-48);
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
