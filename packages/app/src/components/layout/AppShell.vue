<template>
  <ThemeSlotBoundary
    slot-id="app-shell"
    :theme-id="theme.renderedTheme.manifest.id"
    :recipe="theme.activeUxRecipes['app-shell']"
    :actions="actions"
    :slot-props="appShellSlotProps"
  >
    <SinglePageDrawerShell
      v-if="themeChrome.layoutPreset === 'single-page' && themeChrome.drawerShell"
      :theme-id="theme.renderedTheme.manifest.id"
      :drawer-shell="themeChrome.drawerShell"
    >
      <template #left>
        <ThemeSlotBoundary
          slot-id="left-wing"
          :theme-id="theme.renderedTheme.manifest.id"
          :recipe="theme.activeUxRecipes['left-wing']"
          :actions="actions"
          :slot-props="leftWingSlotProps"
        >
          <LeftWing
            :notes="recentNotes"
            :active-path="activePath"
            :region="leftWingRegion"
            :actions="actionsFor('left-wing')"
            @select-note="$emit('select-note', $event)"
          />
        </ThemeSlotBoundary>
      </template>

      <template #main>
        <main class="editor-area editor-area--single-page">
          <div class="editor-scroll">
            <slot name="editor" />
          </div>
        </main>
      </template>

      <template #right>
        <ThemeSlotBoundary
          slot-id="right-wing"
          :theme-id="theme.renderedTheme.manifest.id"
          :recipe="theme.activeUxRecipes['right-wing']"
          :actions="actions"
          :slot-props="rightWingSlotProps"
        >
          <RightWing
            :headings="headings"
            :backlinks="backlinks"
            :tags="tags"
            :active-heading-id="activeHeadingId"
            :collapsed="false"
            :region="rightWingRegion"
            @navigate-heading="(id: string, ln: number) => $emit('navigate-heading', id, ln)"
            @navigate-backlink="(entry: BacklinkEntry) => $emit('navigate-backlink', entry)"
            @select-tag="$emit('select-tag', $event)"
            @toggle-collapse="$emit('toggle-right-wing')"
          />
        </ThemeSlotBoundary>
      </template>

      <template #bottom>
        <slot name="drawer-bottom" />
        <ThemeSlotBoundary
          slot-id="status-bar"
          :theme-id="theme.renderedTheme.manifest.id"
          :recipe="theme.activeUxRecipes['status-bar']"
          :actions="actions"
          :status-text="statusText"
          :slot-props="statusBarSlotProps"
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
        </ThemeSlotBoundary>
      </template>
    </SinglePageDrawerShell>
    <div
      v-else
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
      <ThemeSlotBoundary
        slot-id="left-wing"
        :theme-id="theme.renderedTheme.manifest.id"
        :recipe="theme.activeUxRecipes['left-wing']"
        :actions="actions"
        :slot-props="leftWingSlotProps"
      >
        <LeftWing
          :notes="recentNotes"
          :active-path="activePath"
          :region="leftWingRegion"
          :actions="actionsFor('left-wing')"
          @select-note="$emit('select-note', $event)"
        />
      </ThemeSlotBoundary>
      <div class="wing-divider" />
      <!-- Center: Editor Area -->
      <main class="editor-area">
        <ThemeSlotBoundary
          v-if="showTopBar"
          slot-id="topbar"
          :theme-id="theme.renderedTheme.manifest.id"
          :recipe="theme.activeUxRecipes.topbar"
          :actions="actions"
          :slot-props="topBarSlotProps"
        >
          <TopBar
            :note-title="noteTitle"
            :notebook-name="notebookName"
            :region="topBarRegion"
            :left-actions="actionsFor('topbar-left')"
            :center-actions="actionsFor('topbar-center')"
            :right-actions="actionsFor('topbar-right')"
          />
        </ThemeSlotBoundary>
        <div class="editor-scroll">
          <slot name="editor" />
        </div>
        <ThemeSlotBoundary
          slot-id="status-bar"
          :theme-id="theme.renderedTheme.manifest.id"
          :recipe="theme.activeUxRecipes['status-bar']"
          :actions="actions"
          :status-text="statusText"
          :slot-props="statusBarSlotProps"
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
        </ThemeSlotBoundary>
      </main>
      <div v-if="showRightWing" class="wing-divider" />
      <ThemeSlotBoundary
        v-if="showRightWing"
        slot-id="right-wing"
        :theme-id="theme.renderedTheme.manifest.id"
        :recipe="theme.activeUxRecipes['right-wing']"
        :actions="actions"
        :slot-props="rightWingSlotProps"
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
      </ThemeSlotBoundary>
    </div>
  </ThemeSlotBoundary>
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
import SinglePageDrawerShell from './SinglePageDrawerShell.vue';
import TopBar from '../editor/TopBar.vue';
import StatusBar from '../editor/StatusBar.vue';
import ThemeSlotBoundary from '@/components/theme/ThemeSlotBoundary.vue';
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
import { computed, watch } from 'vue';

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
  themeHostUi?: Record<string, unknown>;
}>();

const emit = defineEmits<{
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

const appShellSlotProps = computed(() => ({
  chrome: props.themeChrome,
  activePath: props.activePath,
  noteTitle: props.noteTitle,
  notebookName: props.notebookName,
  showTopBar: props.showTopBar,
  showRightWing: props.showRightWing,
  drawerShell: props.themeChrome.drawerShell,
}));

const topBarSlotProps = computed(() => ({
  noteTitle: props.noteTitle,
  notebookName: props.notebookName,
  region: topBarRegion.value,
  leftActions: actionsFor('topbar-left'),
  centerActions: actionsFor('topbar-center'),
  rightActions: actionsFor('topbar-right'),
}));

const leftWingSlotProps = computed(() => ({
  notes: props.recentNotes,
  activePath: props.activePath,
  region: leftWingRegion.value,
  actions: actionsFor('left-wing'),
  onSelectNote: (path: string) => emit('select-note', path),
}));

const statusBarSlotProps = computed(() => ({
  charCount: props.charCount,
  wordCount: props.wordCount,
  lineCount: props.lineCount,
  cursorLine: props.cursorLine,
  cursorCol: props.cursorCol,
  isDirty: props.isDirty,
  isSaving: props.isSaving,
  saveError: props.saveError,
  lastSavedAt: props.lastSavedAt,
  region: statusBarRegion.value,
  actions: actionsFor('status-right'),
  statusText: statusText.value,
}));

const rightWingSlotProps = computed(() => ({
  headings: props.headings,
  backlinks: props.backlinks,
  tags: props.tags,
  activeHeadingId: props.activeHeadingId,
  collapsed: !props.showRightWing,
  region: rightWingRegion.value,
  onNavigateHeading: (id: string, lineNumber: number) => emit('navigate-heading', id, lineNumber),
  onNavigateBacklink: (entry: BacklinkEntry) => emit('navigate-backlink', entry),
  onSelectTag: (tagName: string) => emit('select-tag', tagName),
  onToggleCollapse: () => emit('toggle-right-wing'),
}));

watch(
  () => {
    const pack = theme.renderedTheme;
    const entrypoints = pack.manifest.entrypoints
      ?.map((entry) => `${entry.slot}:${entry.module}:${entry.exportName ?? ''}:${entry.checksum}`)
      .join('|');
    return `${pack.manifest.id}:${pack.manifest.version}:${pack.manifest.runtime}:${entrypoints ?? ''}`;
  },
  (_runtimeKey, _previousRuntimeKey, onCleanup) => {
    const pack = theme.renderedTheme;
    if (pack.manifest.runtime !== 'trusted-code' && !pack.module?.plugin) {
      unregisterTrustedTheme(pack.manifest.id);
      return;
    }
    const injectedUi = props.themeHostUi ?? {};
    const injectedAppState =
      typeof injectedUi.appState === 'object' && injectedUi.appState !== null
        ? (injectedUi.appState as Record<string, unknown>)
        : {};
    void activateTrustedThemeRuntime(pack, props.actions, props.themeChrome, {
      ...injectedUi,
      appShell: {
        activePath: props.activePath,
        noteTitle: props.noteTitle,
        notebookName: props.notebookName,
      },
      appState: {
        ...injectedAppState,
        appShell: appShellSlotProps.value,
      },
      commerce: theme.commerce,
    }).catch(() => {
      unregisterTrustedTheme(pack.manifest.id);
    });
    onCleanup(() => unregisterTrustedTheme(pack.manifest.id));
  },
  { immediate: true },
);
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

.editor-area--single-page {
  height: 100%;
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

@media (width <= 900px) {
  .editor-area + .wing-divider,
  :deep(.right-wing) {
    display: none;
  }
}

@media (width <= 720px) {
  .app-shell {
    width: 100%;
    min-width: 0;
  }
}
</style>
