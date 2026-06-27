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
    <ThemeRuntimeRenderer
      slot-id="left-wing"
      :theme-id="theme.renderedTheme.manifest.id"
      :recipe="theme.activeUxRecipes['left-wing']"
      :actions="actions"
    >
      <LeftWing
        :notes="recentNotes"
        :active-path="activePath"
        :region="leftWingRegion"
        :actions="actionsFor('left-wing')"
        @select-note="$emit('select-note', $event)"
      />
    </ThemeRuntimeRenderer>
    <div class="wing-divider" />
    <!-- Center: Editor Area -->
    <main class="editor-area">
      <ThemeRuntimeRenderer
        v-if="showTopBar"
        slot-id="topbar"
        :theme-id="theme.renderedTheme.manifest.id"
        :recipe="theme.activeUxRecipes.topbar"
        :actions="actions"
      >
        <TopBar
          :note-title="noteTitle"
          :notebook-name="notebookName"
          :region="topBarRegion"
          :left-actions="actionsFor('topbar-left')"
          :center-actions="actionsFor('topbar-center')"
          :right-actions="actionsFor('topbar-right')"
        />
      </ThemeRuntimeRenderer>
      <div class="editor-scroll">
        <slot name="editor" />
      </div>
      <ThemeRuntimeRenderer
        slot-id="status-bar"
        :theme-id="theme.renderedTheme.manifest.id"
        :recipe="theme.activeUxRecipes['status-bar']"
        :actions="actions"
        :status-text="statusText"
      >
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
          :region="statusBarRegion"
          :actions="actionsFor('status-right')"
        />
      </ThemeRuntimeRenderer>
    </main>
    <div v-if="showRightWing" class="wing-divider" />
    <ThemeRuntimeRenderer
      v-if="showRightWing"
      slot-id="right-wing"
      :theme-id="theme.renderedTheme.manifest.id"
      :recipe="theme.activeUxRecipes['right-wing']"
      :actions="actions"
    >
      <RightWing
        :headings="headings"
        :backlinks="backlinks"
        :tags="tags"
        :active-heading-id="activeHeadingId"
        :collapsed="!showRightWing"
        :region="rightWingRegion"
        @navigate-heading="(id: string, ln: number) => $emit('navigate-heading', id, ln)"
        @navigate-backlink="(entry: BacklinkEntry) => $emit('navigate-backlink', entry)"
        @select-tag="$emit('select-tag', $event)"
        @toggle-collapse="$emit('toggle-right-wing')"
      />
    </ThemeRuntimeRenderer>
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
import ThemeRuntimeRenderer from '@/components/theme/ThemeRuntimeRenderer.vue';
import { activateTrustedThemeRuntime, unregisterTrustedTheme } from '@/services/ThemeRuntimeHost';
import { useThemeStore } from '@/stores/theme';
import type { HeadingItem, BacklinkEntry, TagEntry } from '@/types';
import type {
  ShellAction,
  ThemeActionRegion,
  ThemeChromeState,
  TopBarRegion,
  LeftWingRegion,
  StatusBarRegion,
  RightWingRegion,
} from '@/types/theme-pack';
import { computed, watchEffect } from 'vue';

const theme = useThemeStore();

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

// ── Region objects: 将 ThemeChromeState 散字段聚合为统一 region ──
const topBarRegion = computed<TopBarRegion>(() => ({
  variant: props.themeChrome.topBarVariant,
  layout: props.themeChrome.topBarLayout,
}));

const leftWingRegion = computed<LeftWingRegion>(() => ({
  mode: props.themeChrome.leftWingMode,
  layout: props.themeChrome.leftWingLayout,
}));

const statusBarRegion = computed<StatusBarRegion>(() => ({
  layout: props.themeChrome.statusLayout,
  density: props.themeChrome.statusDensity,
}));

const rightWingRegion = computed<RightWingRegion>(() => ({
  mode: props.themeChrome.rightWingMode,
  policy: props.themeChrome.rightWingPolicy,
  sections: props.themeChrome.rightWingSections,
  defaultOpenSections: props.themeChrome.defaultOpenSections,
}));

const statusText = computed(() => {
  if (props.isSaving) return '保存中';
  if (props.saveError) return '保存失败';
  if (props.isDirty) return '未保存';
  return `${props.wordCount} 词 · ${props.charCount} 字`;
});

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

watchEffect((onCleanup) => {
  const pack = theme.renderedTheme;
  if (pack.manifest.runtime !== 'trusted-code') {
    unregisterTrustedTheme(pack.manifest.id);
    return;
  }
  void activateTrustedThemeRuntime(pack, props.actions).catch(() => {
    unregisterTrustedTheme(pack.manifest.id);
  });
  onCleanup(() => unregisterTrustedTheme(pack.manifest.id));
});
</script>

<style scoped>
.app-shell {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: var(--paper-bg);
}

.app-shell > * {
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
