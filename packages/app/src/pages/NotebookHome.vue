<template>
  <AppShell
    :recent-notes="recentNotesWithColors"
    :active-path="activePath"
    :note-title="noteTitle"
    :notebook-name="notebookName"
    :show-top-bar="true"
    :show-right-wing="showRightWing"
    :headings="headings"
    :backlinks="currentBacklinks"
    :tags="allTags"
    :active-heading-id="activeHeadingId"
    :char-count="editorStats.charCount"
    :word-count="editorStats.wordCount"
    :line-count="editorStats.lineCount"
    :cursor-line="editorStats.cursorLine"
    :cursor-col="editorStats.cursorCol"
    :is-dirty="isDirty"
    :is-saving="isSaving"
    :save-error="saveError"
    :last-saved-at="lastSavedAt"
    @select-note="onSelectNote"
    @create-note="showTemplate = true"
    @open-settings="showSettings = true"
    @toggle-left-wing="showLeftDrawer = !showLeftDrawer"
    @open-palette="searchVisible = true"
    @open-export="showExport = true"
    @open-share="showShare = true"
    @toggle-theme="theme.toggleColorScheme()"
    @navigate-heading="onNavTreeNavigate"
    @navigate-backlink="onBacklinkNavigate"
    @select-tag="onTagSelect"
    @toggle-right-wing="showRightWing = !showRightWing"
  >
    <template #editor>
      <div class="editor-control-bar">
        <FormatToolbar
          :preset="activeParagraphPreset"
          :active-action="pendingFormatAction"
          @format="onToolbarFormat"
        />
        <button
          class="view-mode-toggle"
          :title="`点击切换到 ${nextModeLabels[viewMode]} 模式`"
          @click="cycleViewMode"
        >
          {{ viewModeLabel }}
        </button>
      </div>
      <!-- Format Bubble (floating, on text selection) -->
      <FormatBubble :visible="bubbleVisible" :position="bubblePosition" @format="onBubbleFormat" />
      <!-- Split Mode: left editor + right preview -->
      <div v-if="viewMode === 'split'" class="split-pane">
        <div class="split-left" :style="{ flex: `0 0 ${splitRatio}%` }">
          <MarkdownEditor
            ref="editorRef"
            :key="'split-' + activePath"
            :model-value="currentContent"
            :show-line-numbers="true"
            :live-preview="false"
            :source-only="true"
            :pending-format="pendingFormatAction"
            :wiki-link-exists="wikiLinkExists"
            :wiki-link-revision="wikiLinkRevision"
            :completion-settings="completionSettings"
            :on-editor-drop="imageUpload.handleDrop"
            :on-editor-drag-over="imageUpload.handleDragOver"
            :on-editor-paste="imageUpload.handlePaste"
            @update:model-value="onSplitContentUpdate"
            @selection-change="onSelectionChange"
            @pending-format-ended="pendingFormatAction = null"
          />
        </div>
        <div
          class="split-divider"
          :style="{ left: `${splitRatio}%` }"
          @mousedown="onSplitDragStart"
        />
        <div class="split-right" :style="{ flex: `0 0 ${100 - splitRatio}%` }">
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div class="markdown-body split-preview" v-html="splitPreviewHtml" />
        </div>
      </div>
      <!-- Live Mode: single editor with block-level live preview -->
      <MarkdownEditor
        v-if="viewMode === 'live'"
        ref="editorRef"
        :key="'live-' + activePath"
        :model-value="currentContent"
        :show-line-numbers="false"
        :live-preview="true"
        :pending-format="pendingFormatAction"
        :on-live-preview-external-link-click="onLivePreviewExternalLinkClick"
        :on-live-preview-tag-click="onLivePreviewTagClick"
        :on-live-preview-wiki-link-click="onLivePreviewWikiLinkClick"
        :wiki-link-exists="wikiLinkExists"
        :wiki-link-revision="wikiLinkRevision"
        :completion-settings="completionSettings"
        :on-editor-drop="imageUpload.handleDrop"
        :on-editor-drag-over="imageUpload.handleDragOver"
        :on-editor-paste="imageUpload.handlePaste"
        @update:model-value="onContentUpdate"
        @selection-change="onSelectionChange"
        @pending-format-ended="pendingFormatAction = null"
      />
    </template>
  </AppShell>

  <!-- Command Palette -->
  <CommandPalette
    :visible="searchVisible"
    @update:visible="searchVisible = $event"
    @select-result="onSearchSelectResult"
    @quick-action="onQuickAction"
  />

  <!-- File Drawer (left slide) -->
  <FileDrawer
    :visible="showLeftDrawer"
    :files="files"
    root-dir="/"
    :active-path="activePath"
    :loading="loading"
    :error="errorMessage"
    @update:visible="showLeftDrawer = $event"
    @select-file="onSelectNote"
    @navigate-dir="onDrawerNavigateDir"
    @create-file="onCreateFile"
    @delete-file="requestDeleteFile"
    @rename-file="onRenameFile"
    @retry="initNotebook"
  />

  <!-- Export Dialog -->
  <ExportDialog
    :visible="showExport"
    :note-path="activePath"
    :note-title="noteTitle"
    :markdown-content="currentContent"
    @update:visible="showExport = $event"
  />

  <!-- Template Dialog -->
  <TemplateDialog
    :visible="showTemplate"
    :current-content="activePath ? currentContent : undefined"
    @update:visible="showTemplate = $event"
    @select="onTemplateSelect"
    @create-blank="onCreateBlank"
  />

  <!-- Settings Dialog -->
  <SettingsDialog
    :visible="showSettings"
    :completion-settings="completionSettings"
    :completion-training-meta="completionTrainingMeta"
    @update:visible="showSettings = $event"
    @update-completion-settings="onUpdateCompletionSettings"
  />

  <!-- Share Dialog -->
  <ShareDialog
    :visible="showShare"
    :note-title="noteTitle"
    :markdown-content="currentContent"
    @update:visible="showShare = $event"
  />

  <!-- Toast Container -->
  <ToastContainer />

  <!-- Update Notification -->
  <UpdateNotification
    :visible="showUpdateNotification"
    :latest-version="updateLatestVersion"
    :release-url="updateReleaseUrl"
    :release-notes="updateReleaseNotes"
    @update:visible="showUpdateNotification = $event"
    @dismiss-version="onDismissVersion"
  />

  <!-- Markdown Cheat Sheet -->
  <MarkdownCheatSheet />

  <!-- New File Dialog -->
  <Teleport to="body">
    <div v-if="showNewFileDialog" class="modal-overlay" @click.self="cancelNewFile">
      <div
        class="modal-card"
        style="width: 360px"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-file-title"
      >
        <div class="modal-header">
          <h2 id="new-file-title">新建文件</h2>
        </div>
        <div class="modal-body">
          <input
            v-model="newFileName"
            class="file-name-input"
            placeholder="文件名（.md 或 .txt）"
            autofocus
            @keydown.escape="cancelNewFile"
            @keydown.enter="confirmNewFile"
          />
        </div>
        <div class="modal-footer">
          <button class="btn btn--secondary" @click="cancelNewFile">取消</button>
          <button class="btn btn--primary" :disabled="!newFileName.trim()" @click="confirmNewFile">
            确定
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Delete Confirm Dialog -->
  <Teleport to="body">
    <div v-if="pendingDeletePath" class="modal-overlay" @click.self="cancelDeleteFile">
      <div
        class="modal-card"
        style="width: 380px"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-file-title"
      >
        <div class="modal-header">
          <h2 id="delete-file-title">删除笔记</h2>
        </div>
        <div class="modal-body">
          <p class="delete-confirm-text">
            确定删除「{{ pendingDeleteName }}」？此操作会移动到系统回收站或从当前笔记本移除。
          </p>
        </div>
        <div class="modal-footer">
          <button class="btn btn--secondary" @click="cancelDeleteFile">取消</button>
          <button class="btn btn--danger" @click="confirmDeleteFile">删除</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * NotebookHome.vue — 羽翼編纂主页面
 *
 * 集成 AppShell 布局 + MarkdownEditor + 所有浮层/对话框。
 *
 * @see migration-map.md §2
 */
import { ref, reactive, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import AppShell from '@/components/layout/AppShell.vue';
import MarkdownEditor from '@/components/editor/MarkdownEditor.vue';
import FormatBubble from '@/components/editor/FormatBubble.vue';
import FormatToolbar from '@/components/editor/FormatToolbar.vue';
import CommandPalette from '@/components/overlays/CommandPalette.vue';
import FileDrawer from '@/components/overlays/FileDrawer.vue';
import ExportDialog from '@/components/modals/ExportDialog.vue';
import TemplateDialog from '@/components/modals/TemplateDialog.vue';
import SettingsDialog from '@/components/modals/SettingsDialog.vue';
import ShareDialog from '@/components/modals/ShareDialog.vue';
import ToastContainer, { useToast } from '@/components/common/Toast.vue';
import { MockFSService } from '@/services/MockFSService';
import { TauriIPCService } from '@/services/TauriIPCService';
import { useIndexStore } from '@/stores/index';
import { useSearchStore } from '@/stores/search';
import { useThemeStore } from '@/stores/theme';
import { useHeadings } from '@/composables/useHeadings';
import { renderMarkdown, highlightCodeBlocks } from '@markluck/renderer';
import type {
  DirEntry,
  BacklinkEntry,
  SearchResult,
  IFileSystemService,
  FormatAction,
  ParagraphPreset,
} from '@/types';
import UpdateNotification from '@/components/overlays/UpdateNotification.vue';
import MarkdownCheatSheet from '@/components/overlays/MarkdownCheatSheet.vue';
import { useVersionCheck } from '@/composables/useVersionCheck';
import { useImageUpload } from '@/composables/useImageUpload';
import { normalizeUrl } from '@/utils/urlUtils';
import {
  getCompletionSettings,
  saveCompletionSettings,
  subscribeCompletionSettings,
  type CompletionSettings,
} from '@/services/CompletionSettings';
import {
  CompletionTrainingService,
  loadTrainingMeta,
  subscribeTrainingMeta,
  type CompletionTrainingMeta,
} from '@/services/CompletionTrainingService';
import {
  applyParagraphPreset,
  clearMarkdownFormatting,
  detectParagraphPreset,
  toggleInlineFormat,
} from '@/utils/markdown-formatting';

// --- File System ---
// Tauri 桌面端使用真实文件系统，Web/E2E 使用虚拟 MockFS
function createFileSystem(): IFileSystemService {
  if (window.__TAURI__) return new TauriIPCService();
  return new MockFSService(50);
}
const fs: IFileSystemService = createFileSystem();
const files = ref<DirEntry[]>([]);
const currentContent = ref('');
const activePath = ref('');
const loading = ref(true);
const errorMessage = ref('');
const currentDir = ref('/');

// --- Theme ---
const theme = useThemeStore();

// --- Index & Search ---
const indexStore = useIndexStore();
const searchStore = useSearchStore();
const { headings, update: updateHeadings, getActiveHeadingId } = useHeadings();
const imageUpload = useImageUpload(
  fs,
  () => editorRef.value?.getEditorView() ?? null,
  () => activePath.value,
  () => refreshFileTree(),
);

// --- UI State ---
type ViewMode = 'split' | 'live';
const viewMode = ref<ViewMode>('live');
const splitRatio = ref(50); // 50:50 default for split pane
const splitPreviewHtml = ref('');
const wikiLinkRevision = ref(0);
let splitDebounceTimer: ReturnType<typeof setTimeout> | null = null;

const showRightWing = ref(true);
const showLeftDrawer = ref(false);
const searchVisible = ref(false);
const showExport = ref(false);
const showTemplate = ref(false);
const showNewFileDialog = ref(false);
const newFileName = ref('新笔记.md');
const showSettings = ref(false);
const showShare = ref(false);
const pendingDeletePath = ref<string | null>(null);
const notebookName = ref('示例笔记本');
const completionSettings = ref<CompletionSettings>(getCompletionSettings());
const completionTrainingMeta = ref<CompletionTrainingMeta>(loadTrainingMeta());
let unsubscribeCompletionSettings: (() => void) | null = null;
let unsubscribeTrainingMeta: (() => void) | null = null;
let completionTrainer: CompletionTrainingService | null = null;

// --- Format Bubble ---
const bubbleVisible = ref(false);
const bubblePosition = ref({ x: 0, y: 0 });
const activeParagraphPreset = ref<ParagraphPreset>('paragraph');
const pendingFormatAction = ref<FormatAction | null>(null);
const editorRef = ref<InstanceType<typeof MarkdownEditor> | null>(null);

// --- View Mode ---
const viewModeLabels: Record<ViewMode, string> = { split: '分栏', live: '即时' };
const viewModeLabel = computed(() => viewModeLabels[viewMode.value]);
const nextModeLabels: Record<ViewMode, string> = { split: '即时', live: '分栏' };

function cycleViewMode(): void {
  pendingFormatAction.value = null;
  const modes: ViewMode[] = ['split', 'live'];
  const idx = modes.indexOf(viewMode.value);
  viewMode.value = modes[(idx + 1) % 2]!;
  if (viewMode.value === 'split') {
    updateSplitPreview();
  }
}

// --- Split Pane ---
function onSplitContentUpdate(content: string): void {
  currentContent.value = content;
  updateHeadings(content);
  updateEditorStats(content);
  if (activePath.value) {
    isDirty.value = true;
    saveError.value = null;
    if (saveTimer) clearTimeout(saveTimer);
    const savingPath = activePath.value;
    saveTimer = setTimeout(() => debouncedSave(savingPath, content), 600);
  }
  // Debounce preview update for split mode
  if (splitDebounceTimer) clearTimeout(splitDebounceTimer);
  splitDebounceTimer = setTimeout(() => updateSplitPreview(), 300);
}

let splitDragActive = false;
let splitDragCleanup: (() => void) | null = null;

function onSplitDragStart(e: MouseEvent): void {
  e.preventDefault();
  splitDragActive = true;
  const onMove = (ev: MouseEvent) => {
    if (!splitDragActive) return;
    const container = (e.target as HTMLElement).parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const pct = ((ev.clientX - rect.left) / rect.width) * 100;
    splitRatio.value = Math.max(30, Math.min(70, pct));
  };
  const onUp = () => {
    splitDragActive = false;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    splitDragCleanup = null;
  };
  // Clean up any stale listeners first
  if (splitDragCleanup) splitDragCleanup();
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  splitDragCleanup = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
}

// --- Save State ---
const isDirty = ref(false);
const isSaving = ref(false);
const saveError = ref<string | null>(null);
const lastSavedAt = ref<number | null>(null);
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveGeneration = 0;

// --- Editor Stats ---
const editorStats = reactive({
  charCount: 0,
  wordCount: 0,
  lineCount: 0,
  cursorLine: null as number | null,
  cursorCol: null as number | null,
});

// --- Computed ---
const noteTitle = computed(() => {
  if (!activePath.value) return '';
  return activePath.value.split('/').pop()?.replace(/\.md$/, '') ?? '';
});
const pendingDeleteName = computed(() =>
  pendingDeletePath.value
    ? (pendingDeletePath.value.split('/').pop() ?? pendingDeletePath.value)
    : '',
);

const allTags = computed(() => indexStore.tags);
const activeHeadingId = computed(() => getActiveHeadingId(editorStats.cursorLine ?? 0));
const currentBacklinks = computed((): BacklinkEntry[] => {
  if (!activePath.value) return [];
  return indexStore.getBacklinks(activePath.value);
});

// Recent notes with auto-assigned bookmark colors
const recentNotesWithColors = computed(() =>
  indexStore.recentNotes.map((n, i) => ({
    path: n.path,
    title: n.title,
    colorIndex: Math.abs(hashString(n.path)) % 8,
    _i: i,
  })),
);

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Debug watcher — log recentNotes population
watch(
  () => indexStore.recentNotes.length,
  (len) => {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug(
        `[NotebookHome] recentNotes.length = ${len}`,
        indexStore.recentNotes.map((n) => n.path),
      );
    }
  },
  { immediate: true },
);

// --- Initialize ---
async function initNotebook(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    await loadDirectory('/');
  } catch (e) {
    errorMessage.value = String(e);
  } finally {
    loading.value = false;
  }
  try {
    await indexStore.initialize(fs);
    wikiLinkRevision.value++;
    updateSplitPreview();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[NotebookHome] indexStore.initialize 失败', e);
  }
}

function normalizeDir(dir: string): string {
  const normalized = (dir || '/').replace(/\\/g, '/');
  if (normalized === '/') return '/';
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function joinPath(dir: string, name: string): string {
  const base = normalizeDir(dir);
  return base === '/' ? `/${name}` : `${base}/${name}`;
}

async function listDirectoryRecursive(dir: string): Promise<DirEntry[]> {
  const normalized = normalizeDir(dir);
  const entries = await fs.listDirectory(normalized);
  const result = [...entries];
  for (const entry of entries) {
    if (entry.isDirectory) {
      result.push(...(await listDirectoryRecursive(entry.path)));
    }
  }
  return result;
}

async function refreshFileTree(): Promise<void> {
  files.value = await listDirectoryRecursive('/');
  wikiLinkRevision.value++;
}

async function loadDirectory(dir: string): Promise<void> {
  currentDir.value = normalizeDir(dir);
  await refreshFileTree();
}

function onDrawerNavigateDir(path: string): void {
  currentDir.value = normalizeDir(path);
}

// --- File Operations ---
async function onSelectNote(path: string): Promise<void> {
  // Flush any pending save before switching notes
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  // 防御性刷新：即使 saveTimer 已触发但 debouncedSave 尚未完成，
  // 只要 isDirty 为 true 就执行保存，确保内容不丢失
  if (isDirty.value && activePath.value) {
    await debouncedSave(activePath.value, currentContent.value);
  }

  if (!path) {
    activePath.value = '';
    currentContent.value = '';
    isDirty.value = false;
    isSaving.value = false;
    saveError.value = null;
    updateHeadings('');
    updateEditorStats('');
    updateSplitPreview();
    return;
  }

  try {
    const stat = await fs.statFile(path);
    if (stat.isDirectory) {
      await loadDirectory(path);
      return;
    }
  } catch {
    // statFile 失败意味着路径不是文件（可能是目录或不存在），继续尝试作为文件打开
    /* open as file */
  }

  loading.value = true;
  isDirty.value = false;
  isSaving.value = false;
  saveError.value = null;

  // Read content BEFORE setting activePath — prevents editor mounting with empty content
  // while onMounted is still async (predictor.initialize blocking view creation).
  let content: string;
  try {
    content = await fs.readFile(path);
  } catch (e) {
    errorMessage.value = String(e);
    loading.value = false;
    return;
  }

  // Now set reactive state — editor mounts with content already available
  activePath.value = path;
  currentContent.value = content;

  const dir = path.substring(0, path.lastIndexOf('/') + 1) || '/';
  currentDir.value = normalizeDir(dir);
  void refreshFileTree();

  updateHeadings(content);
  updateEditorStats(content);
  updateSplitPreview();
  try {
    await indexStore.refreshDocument(fs, path);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[NotebookHome] indexStore.refreshDocument 失败', e);
  }
  showLeftDrawer.value = false; // 选择笔记后关闭文件抽屉，避免 overlay 遮挡
  loading.value = false;
}

async function onDeleteFile(path: string): Promise<void> {
  await fs.deleteFile(path);
  if (activePath.value === path) {
    activePath.value = '';
    currentContent.value = '';
    updateHeadings('');
    updateEditorStats('');
    updateSplitPreview();
  }
  indexStore.removeDocument(path);
  completionTrainer?.removePath(path);
  await refreshFileTree();
  toast.show('笔记已删除', 'success', 2500);
}

function requestDeleteFile(path: string): void {
  pendingDeletePath.value = path;
}

function cancelDeleteFile(): void {
  pendingDeletePath.value = null;
}

async function confirmDeleteFile(): Promise<void> {
  const path = pendingDeletePath.value;
  if (!path) return;
  pendingDeletePath.value = null;
  try {
    await onDeleteFile(path);
  } catch (e) {
    toast.show(`删除失败：${e instanceof Error ? e.message : String(e)}`, 'error', 4000);
  }
}

async function onRenameFile(oldPath: string, newName: string): Promise<void> {
  // 从旧路径提取父目录，避免 currentDir 尾斜杠不一致导致路径错误
  const parentDir = oldPath.substring(0, oldPath.lastIndexOf('/') + 1) || '/';
  const newPath = joinPath(parentDir, newName);
  await fs.renameFile(oldPath, newPath);
  completionTrainer?.removePath(oldPath);
  if (activePath.value === oldPath) activePath.value = newPath;
  // 更新索引：移除旧路径，索引新路径
  indexStore.removeDocument(oldPath);
  await indexStore.refreshDocument(fs, newPath);
  if (activePath.value === newPath) void trainCurrentFile(newPath, currentContent.value);
  await refreshFileTree();
}

async function onCreateFile(): Promise<void> {
  newFileName.value = '新笔记.md';
  showNewFileDialog.value = true;
}

async function confirmNewFile(): Promise<void> {
  const name = newFileName.value.trim();
  if (!name) return;
  showNewFileDialog.value = false;
  const path = joinPath(currentDir.value, name);
  const content = name.endsWith('.md') ? `# ${name.replace(/\.md$/, '')}\n\n` : '';
  await fs.writeFile(path, content);
  await refreshFileTree();
  await indexStore.refreshDocument(fs, path);
  void trainCurrentFile(path, content);
  if (name.endsWith('.md')) {
    activePath.value = path;
    currentContent.value = content;
    updateSplitPreview();
  }
}

function cancelNewFile(): void {
  showNewFileDialog.value = false;
}

// --- Preview Render ---
let previewRenderTimer: ReturnType<typeof setTimeout> | null = null;

function wikiLinkExists(noteTitle: string): boolean {
  const target = noteTitle.trim();
  if (!target) return false;
  const existsInTree = files.value.some((entry) => {
    if (!entry.isFile) return false;
    const filename = entry.name.replace(/\.(md|markdown)$/i, '');
    return filename === target;
  });
  if (existsInTree) return true;
  const docs = Object.values(indexStore.getIndexService()?.getAllDocuments() ?? {});
  return docs.some((doc) => {
    const filename =
      doc.path
        .split('/')
        .pop()
        ?.replace(/\.(md|markdown)$/i, '') ?? '';
    return doc.title === target || filename === target;
  });
}

/**
 * 逐行渲染源码为 HTML，保持源码行号与渲染行 1:1 对应。
 * 与即时模式（parseLiveBlocks）相同的策略：每行独立调用 renderMarkdown()，
 * 避免 marked 将无空行分隔的相邻内联行合并为同一段落。
 * 代码围栏内部作为整体渲染，保留语法高亮。
 */
function updateSplitPreview(): void {
  if (previewRenderTimer) clearTimeout(previewRenderTimer);
  previewRenderTimer = setTimeout(() => {
    try {
      splitPreviewHtml.value = renderMarkdown(currentContent.value, { wikiLinkExists });
      void nextTick(() => {
        const previewEl = document.querySelector<HTMLElement>(
          '.split-preview, .markdown-body--full',
        );
        if (previewEl) highlightCodeBlocks(previewEl);
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[NotebookHome] 渲染预览失败:', e);
      splitPreviewHtml.value = '<p class="render-error">渲染失败</p>';
    }
  }, 50);
}

// --- Content Updates ---
function onContentUpdate(content: string): void {
  currentContent.value = content;
  updateHeadings(content);
  updateEditorStats(content);
  if (activePath.value) {
    isDirty.value = true;
    saveError.value = null;
    if (saveTimer) clearTimeout(saveTimer);
    const savingPath = activePath.value;
    saveTimer = setTimeout(() => debouncedSave(savingPath, content), 600);
  }
}

function updateEditorStats(content: string): void {
  editorStats.charCount = content.length;
  editorStats.wordCount = content ? content.split(/\s+/).filter(Boolean).length : 0;
  editorStats.lineCount = content ? content.split('\n').length : 0;
}

async function debouncedSave(path: string, content: string): Promise<void> {
  const gen = ++saveGeneration;
  isSaving.value = true;
  const start = Date.now();
  try {
    await fs.writeFile(path, content);
    if (gen !== saveGeneration) return; // 新保存已启动，放弃本次后续操作
    await indexStore.refreshDocument(fs, path);
    void trainCurrentFile(path, content);
    if (gen !== saveGeneration) return;
    wikiLinkRevision.value++;
    lastSavedAt.value = Date.now();
    const elapsed = Date.now() - start;
    if (elapsed < 500) await new Promise((r) => setTimeout(r, 500 - elapsed));
    if (gen !== saveGeneration) return;
    isDirty.value = false;
  } catch (e) {
    saveError.value = String(e);
  } finally {
    if (gen === saveGeneration) isSaving.value = false;
  }
}

// --- Format Bubble ---
const FORMAT_HINT_KEY = 'markluck:formatBubble:hintShown';
const toast = useToast();

watch(imageUpload.uploadError, (message) => {
  if (message) toast.show(message, 'error', 4000);
});

function onSelectionChange(sel: { from: number; to: number } | null): void {
  const view = editorRef.value?.getEditorView();
  if (view && sel) {
    activeParagraphPreset.value = detectParagraphPreset(view.state.doc.toString(), sel.from);
  }
  if (!sel || sel.from === sel.to) {
    bubbleVisible.value = false;
    return;
  }

  // BUG-013: 首次选中文字 → 显示一次性格式气泡提示
  if (!localStorage.getItem(FORMAT_HINT_KEY)) {
    localStorage.setItem(FORMAT_HINT_KEY, '1');
    toast.show('选中文字后使用格式气泡进行加粗、斜体等操作', 'info', 5000);
  }

  // Use CodeMirror 6 API to get pixel coordinates — window.getSelection() is unreliable inside CM6
  if (view) {
    const headCoords = view.coordsAtPos(sel.from);
    if (headCoords) {
      bubblePosition.value = {
        x:
          headCoords.left +
          (view.coordsAtPos(sel.to)?.left ?? headCoords.left) / 2 -
          (headCoords.left > (view.coordsAtPos(sel.to)?.left ?? headCoords.left) ? 0 : 0),
        y: headCoords.top,
      };
      // Recalculate: center of selection
      const tailCoords = view.coordsAtPos(sel.to);
      if (tailCoords) {
        bubblePosition.value.x = (headCoords.left + tailCoords.right) / 2;
        bubblePosition.value.y = headCoords.top;
      }
      bubbleVisible.value = true;
    }
  }
}

const PARAGRAPH_PRESETS: readonly ParagraphPreset[] = [
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
  'blockquote',
];

function isParagraphPreset(action: FormatAction): action is ParagraphPreset {
  return PARAGRAPH_PRESETS.includes(action as ParagraphPreset);
}

function onToolbarFormat(action: FormatAction): void {
  pendingFormatAction.value =
    action === 'clear' || pendingFormatAction.value === action ? null : action;
  bubbleVisible.value = false;
}

function onBubbleFormat(action: FormatAction): void {
  const view = editorRef.value?.getEditorView();
  if (!view) return;
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc.toString();
  const edit = isParagraphPreset(action)
    ? applyParagraphPreset(doc, from, to, action)
    : action === 'clear'
      ? clearMarkdownFormatting(doc, from, to)
      : toggleInlineFormat(doc, from, to, action);

  view.dispatch({
    changes: edit.changes,
    selection: edit.selection,
    scrollIntoView: true,
  });
  view.focus();
  activeParagraphPreset.value = detectParagraphPreset(
    view.state.doc.toString(),
    edit.selection.anchor,
  );
  bubbleVisible.value = false;
}

// --- Search ---
function onSearchSelectResult(result: SearchResult): void {
  searchVisible.value = false;
  onSelectNote(result.notePath);
}
function onQuickAction(action: 'new-note' | 'export' | 'settings'): void {
  searchVisible.value = false;
  if (action === 'new-note') showTemplate.value = true;
  else if (action === 'export') showExport.value = true;
  else if (action === 'settings') showSettings.value = true;
}

// --- Navigation ---
function onNavTreeNavigate(_headingId: string, lineNumber: number): void {
  const view = editorRef.value?.getEditorView();
  if (!view || lineNumber <= 0) return;
  const line = view.state.doc.line(Math.min(lineNumber, view.state.doc.lines));
  view.dispatch({
    selection: { anchor: line.from, head: line.from },
    scrollIntoView: true,
  });
  view.focus();
}
function onBacklinkNavigate(entry: BacklinkEntry): void {
  onSelectNote(entry.notePath);
}
function onTagSelect(tagName: string): void {
  searchStore.open(`tag:${tagName}`);
  searchVisible.value = true;
}

function onLivePreviewExternalLinkClick(href: string): void {
  window.open(normalizeUrl(href), '_blank', 'noopener,noreferrer');
}

function onLivePreviewTagClick(tagName: string): void {
  onTagSelect(tagName);
}

async function onLivePreviewWikiLinkClick(noteTitle: string, anchor: null | string): Promise<void> {
  const docs = Object.values(indexStore.getIndexService()?.getAllDocuments() ?? {});
  const exact =
    docs.find((doc) => doc.title === noteTitle) ??
    docs.find((doc) => doc.path.split('/').pop()?.replace(/\.md$/, '') === noteTitle);

  if (!exact) {
    toast.show(`未找到笔记：${noteTitle}`, 'warning', 3000);
    return;
  }

  await onSelectNote(exact.path);
  if (!anchor) return;

  const targetHeading = headings.value.find((heading) => heading.text.trim() === anchor.trim());
  if (targetHeading) {
    onNavTreeNavigate(targetHeading.id, targetHeading.lineNumber);
  }
}

// --- Templates ---
async function onTemplateSelect(_tpl: unknown, content: string): Promise<void> {
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const name = titleMatch?.[1]?.trim() || '新笔记';
  const path = `/${name}.md`;
  // Set activePath + currentContent BEFORE async write so editor mounts immediately
  activePath.value = path;
  currentContent.value = content;
  await fs.writeFile(path, content);
  await refreshFileTree();
  await indexStore.refreshDocument(fs, path);
  void trainCurrentFile(path, content);
  updateHeadings(content);
  updateEditorStats(content);
  updateSplitPreview();
  showTemplate.value = false;
}

async function onCreateBlank(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const path = `/笔记-${today}.md`;
  const content = '# 新笔记\n\n';
  // Set activePath + currentContent BEFORE async write so editor mounts immediately
  activePath.value = path;
  currentContent.value = content;
  await fs.writeFile(path, content);
  await refreshFileTree();
  await indexStore.refreshDocument(fs, path);
  void trainCurrentFile(path, content);
  updateHeadings(content);
  updateEditorStats(content);
  updateSplitPreview();
  showTemplate.value = false;
}

// --- Keyboard ---
function onGlobalKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
    e.preventDefault();
    searchVisible.value = true;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    searchVisible.value = true;
  }
}

/** Wire predictor to IndexStore for structured completions ([[/#/path). */
function connectPredictor(): void {
  const pred = editorRef.value?.predictor;
  if (!pred) return;
  const svc = indexStore.getIndexService();
  pred.setIndexData({
    getAllNoteTitles: () => svc?.getAllNoteTitles() ?? [],
    getAllTags: () => (indexStore.tags ?? []).map((t) => t.name),
    matchFilePaths: (prefix: string) => {
      const docs = svc?.getAllDocuments() ?? {};
      return Object.keys(docs).filter((p) => p.toLowerCase().includes(prefix.toLowerCase()));
    },
  });
  const titles = svc?.getAllNoteTitles() ?? [];
  pred.ingestExcerpts(titles);
  ensureCompletionTrainer(pred);
  void maybeTrainNotebook();
}

function ensureCompletionTrainer(
  pred = editorRef.value?.predictor,
): CompletionTrainingService | null {
  if (!pred) return null;
  if (!completionTrainer) completionTrainer = new CompletionTrainingService(fs, pred);
  return completionTrainer;
}

async function maybeTrainNotebook(): Promise<void> {
  if (!completionSettings.value.backgroundTraining) return;
  const trainer = ensureCompletionTrainer();
  if (!trainer) return;
  await trainer.trainNotebook(files.value);
}

async function trainCurrentFile(path: string, content: string): Promise<void> {
  if (!completionSettings.value.backgroundTraining) return;
  const trainer = ensureCompletionTrainer();
  if (!trainer) return;
  let stat: { mtime: number; size: number };
  try {
    const fileStat = await fs.statFile(path);
    stat = { mtime: fileStat.mtime, size: fileStat.size };
  } catch {
    stat = { mtime: Date.now(), size: content.length };
  }
  await trainer.trainFile(path, content, stat);
}

function onUpdateCompletionSettings(settings: CompletionSettings): void {
  completionSettings.value = settings;
  saveCompletionSettings(settings);
  editorRef.value?.predictor.configure(settings);
  if (settings.backgroundTraining) void maybeTrainNotebook();
}

// Reconnect predictor when editor remounts due to :key changes (view-mode / note switch).
watch([activePath, viewMode], async () => {
  await nextTick();
  connectPredictor();
});

// ── Version Check ──────────────────────────────────────────
const { hasUpdate, latestVersion, releaseUrl, releaseNotes, checkNow } = useVersionCheck();
const showUpdateNotification = ref(false);
const updateLatestVersion = computed(() => latestVersion.value);
const updateReleaseUrl = computed(() => releaseUrl.value);
const updateReleaseNotes = computed(() => releaseNotes.value);

// Show update notification 15s after mount if update available
let updateTimer: ReturnType<typeof setTimeout> | null = null;

onMounted(async () => {
  theme.init();
  await initNotebook();
  window.addEventListener('keydown', onGlobalKeydown);

  // Listen for file-association events (double-click .md in Explorer)
  if (window.__TAURI__) {
    const { listen } = await import('@tauri-apps/api/event');
    listen<string>('opened-file', (event) => {
      const filePath = event.payload;
      if (filePath) {
        // Extract notebook folder from file path, then open the file
        const dir = filePath.substring(0, filePath.lastIndexOf('/') + 1) || '/';
        currentDir.value = dir;
        loadDirectory(dir).then(() => onSelectNote(filePath));
      }
    });
  }

  await nextTick();
  connectPredictor();
  unsubscribeCompletionSettings = subscribeCompletionSettings((settings) => {
    completionSettings.value = settings;
    editorRef.value?.predictor.configure(settings);
    if (settings.backgroundTraining) void maybeTrainNotebook();
  });
  unsubscribeTrainingMeta = subscribeTrainingMeta((meta) => {
    completionTrainingMeta.value = meta;
  });

  // Check for updates after a delay
  updateTimer = setTimeout(async () => {
    await checkNow();
    if (hasUpdate.value) {
      showUpdateNotification.value = true;
    }
  }, 15000); // 15 seconds after mount
});

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKeydown);
  if (saveTimer) clearTimeout(saveTimer);
  if (splitDebounceTimer) clearTimeout(splitDebounceTimer);
  if (previewRenderTimer) clearTimeout(previewRenderTimer);
  if (updateTimer) clearTimeout(updateTimer);
  if (splitDragCleanup) splitDragCleanup();
  unsubscribeCompletionSettings?.();
  unsubscribeTrainingMeta?.();
});

function onDismissVersion(version: string) {
  localStorage.setItem('markluck:version:dismissedVersion', version);
  showUpdateNotification.value = false;
}
</script>

<style scoped>
/* ===== View Mode Toggle ===== */
.editor-control-bar {
  position: absolute;
  top: calc(var(--topbar-height) + var(--space-8));
  left: var(--space-16);
  right: var(--space-16);
  z-index: calc(var(--z-overlay) + 1);
  display: flex;
  align-items: center;
  min-width: 0;
  background: var(--paper-raised);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sheet);
}

.editor-control-bar :deep(.format-toolbar) {
  flex: 1 1 auto;
}

.view-mode-toggle {
  flex: 0 0 auto;
  margin-right: var(--space-4);
  padding: var(--space-4) var(--space-10);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
  color: var(--ink-secondary);
  font-size: var(--text-xs);
  cursor: pointer;
  transition:
    background var(--dur-micro) var(--ease-fade),
    color var(--dur-micro) var(--ease-fade),
    border-color var(--dur-micro) var(--ease-fade);
}

.view-mode-toggle:hover {
  background: var(--accent-soft);
  color: var(--ink-primary);
  border-color: var(--accent);
}

.view-mode-toggle:active {
  transform: scale(0.97);
}

/* ===== Split Pane ===== */
.split-pane {
  display: flex;
  height: 100%;
  box-sizing: border-box;
  padding-top: var(--space-48);
  overflow: hidden;
  position: relative;
}

.split-left,
.split-right {
  min-width: 300px;
  overflow: hidden;
}

.split-left {
  border-right: none;
}

.split-right {
  background: var(--paper-surface);
}

.split-divider {
  width: 3px;
  background: var(--rule);
  cursor: col-resize;
  flex-shrink: 0;
  transition: background var(--dur-micro) var(--ease-fade);
  position: relative;
}

.split-divider:hover,
.split-divider:active {
  background: var(--accent);
}

.split-preview {
  height: 100%;
  overflow-y: auto;
  padding: var(--space-16) var(--space-20);
  scroll-behavior: smooth;
}

.markdown-body--full {
  height: 100%;
  overflow-y: auto;
  padding: var(--editor-top-pad) var(--space-32) var(--space-96);
  max-width: var(--editor-max-width);
  margin: 0 auto;
}

.file-name-input {
  width: 100%;
  box-sizing: border-box;
  padding: var(--space-8) var(--space-10);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
  color: var(--ink-primary);
  font: inherit;
}

.file-name-input:focus {
  outline: none;
  border-color: var(--accent);
}

.delete-confirm-text {
  margin: 0;
  color: var(--ink-secondary);
  font-size: var(--text-sm);
  line-height: var(--lh-body);
}

.btn {
  min-width: 72px;
  height: 32px;
  padding: 0 var(--space-12);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
  color: var(--ink-secondary);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}

.btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.btn--primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--paper-bg);
}

.btn--secondary:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--ink-primary);
}

.btn--danger {
  background: var(--signal-error);
  border-color: var(--signal-error);
  color: var(--paper-bg);
}

.btn--danger:hover {
  background: var(--signal-error-strong, var(--signal-error));
}
</style>
