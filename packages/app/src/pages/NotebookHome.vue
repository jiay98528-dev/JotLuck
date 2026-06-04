<template>
  <AppLayout>
    <template #left-sidebar>
      <div class="sidebar-content">
        <div class="sidebar-header">
          <span class="sidebar-title">MarkLuck</span>
          <div class="sidebar-header-actions">
            <ThemeSelector compact />
            <button class="btn-new-note" title="新建笔记（从模板）" @click="showTemplate = true">
              +
            </button>
          </div>
        </div>
        <FileTree
          :files="files"
          :root-dir="currentDir"
          :loading="loading"
          :error="errorMessage"
          :active-path="activePath"
          @select-file="onSelectFileOrDir"
          @delete-file="onDeleteFile"
          @rename-file="onRenameFile"
          @navigate-dir="onNavigateDir"
          @create-file="onCreateFile"
          @retry="initNotebook"
        />
      </div>
    </template>

    <template #editor>
      <WelcomePage
        v-if="!activePath && !loading && files.length === 0"
        @create-note="showTemplate = true"
      />
      <div v-else-if="!activePath" class="editor-empty">
        <h1>MarkLuck</h1>
        <p>选择左侧一条笔记开始编辑</p>
        <p class="editor-hint">Ctrl+Shift+P 搜索笔记</p>
      </div>
      <div v-if="activePath" class="editor-wrapper">
        <div class="editor-toolbar">
          <span class="editor-file-name">{{ activePath }}</span>
          <div class="editor-actions">
            <button
              class="btn-action btn-preview-toggle"
              :title="showPreview ? '切换到编辑模式' : '切换到预览模式'"
              @click="showPreview = !showPreview"
            >
              {{ showPreview ? '编辑' : '预览' }}
            </button>
            <button class="btn-action" title="导出" @click="showExport = true">导出</button>
            <button class="btn-action" title="分享" @click="showShare = true">分享</button>
          </div>
        </div>
        <!-- M7-01: Large file warning -->
        <div v-if="largeFileWarning" class="file-warning">
          {{ largeFileWarning }}
          <button
            v-if="largeFileWarning.includes('外部程序修改')"
            class="file-warning-btn"
            @click="largeFileWarning = ''"
          >
            x
          </button>
        </div>
        <FormatToolbar v-if="!showPreview" :disabled="!activePath" @format="onFormat" />
        <!-- Edit Mode -->
        <MarkdownEditor
          v-show="!showPreview"
          ref="editorRef"
          :key="activePath"
          :model-value="currentContent"
          :blocks="currentBlocks"
          :on-editor-drop="imageUpload.handleDrop"
          :on-editor-drag-over="imageUpload.handleDragOver"
          :on-editor-paste="imageUpload.handlePaste"
          @update:model-value="onContentUpdate"
        />
        <!-- Preview Mode (M1-08: full-document rendered preview) -->
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-if="showPreview" class="markdown-preview" v-html="renderedHtml" />
        <StatusBar
          :char-count="editorStats.charCount"
          :word-count="editorStats.wordCount"
          :line-count="editorStats.lineCount"
          :cursor-line="showPreview ? null : editorStats.cursorLine"
          :cursor-col="showPreview ? null : editorStats.cursorCol"
          :is-dirty="isDirty"
          :is-saving="isSaving"
          :save-error="saveError"
        />
      </div>
    </template>

    <template #right-sidebar>
      <div class="right-sidebar-content">
        <!-- NavTree -->
        <NavTree
          :headings="headings"
          :active-heading-id="activeHeadingId"
          :collapsed="navTreeCollapsed"
          :loading="indexStatus === 'building'"
          @navigate-to="onNavTreeNavigate"
          @toggle-collapse="navTreeCollapsed = !navTreeCollapsed"
        />

        <!-- Backlinks -->
        <BacklinksPanel
          :backlinks="currentBacklinks"
          :collapsed="backlinksCollapsed"
          :loading="indexStatus === 'building'"
          @navigate="onBacklinkNavigate"
          @toggle-collapse="backlinksCollapsed = !backlinksCollapsed"
        />

        <!-- Tag Cloud -->
        <TagCloudPanel
          :tags="allTags"
          :collapsed="tagsCollapsed"
          :loading="indexStatus === 'building'"
          @select-tag="onTagSelect"
          @toggle-collapse="tagsCollapsed = !tagsCollapsed"
        />

        <!-- Recent Notes -->
        <RecentNotes
          :notes="recentNotes"
          :loading="indexStatus === 'building'"
          @select-note="onSelectFileOrDir"
        />

        <!-- Theme Selector (M5-06) — 已移至编辑器工具栏 -->
      </div>
    </template>
  </AppLayout>

  <!-- Search Panel (Teleported to body) -->
  <SearchPanel
    :visible="searchVisible"
    @update:visible="searchVisible = $event"
    @select-result="onSearchResultSelect"
  />

  <!-- Export Dialog -->
  <ExportDialog
    :visible="showExport"
    :note-path="activePath"
    :note-title="activePath.replace(/\.md$/, '').replace(/^\//, '')"
    :markdown-content="currentContent"
    :read-binary="(path: string) => fs.readBinary(path)"
    @update:visible="showExport = $event"
  />

  <!-- Share Dialog -->
  <ShareDialog
    :visible="showShare"
    :note-title="activePath.replace(/\.md$/, '').replace(/^\//, '')"
    :markdown-content="currentContent"
    @update:visible="showShare = $event"
  />

  <!-- Template Dialog -->
  <TemplateDialog
    :visible="showTemplate"
    :current-content="activePath ? currentContent : undefined"
    @update:visible="showTemplate = $event"
    @select="onTemplateSelect"
    @create-blank="onCreateBlank"
  />

  <!-- P2-1: Hidden file input for image upload -->
  <input
    ref="imageFileInput"
    type="file"
    accept="image/*"
    style="display: none"
    @change="onImageFileSelected"
  />
</template>

<script setup lang="ts">
/**
 * NotebookHome.vue — 笔记本主页
 *
 * M1: 集成 FileTree + MarkdownEditor + MockFSService。
 * M2: 集成 SearchPanel + NavTree + Backlinks + Tags + RecentNotes + Index。
 *
 * @see pages.md §2
 */
import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import AppLayout from '@/components/layout/AppLayout.vue';
import FileTree from '@/components/file-tree/FileTree.vue';
import MarkdownEditor from '@/components/editor/MarkdownEditor.vue';
import SearchPanel from '@/components/search/SearchPanel.vue';
import ExportDialog from '@/components/modals/ExportDialog.vue';
import ShareDialog from '@/components/modals/ShareDialog.vue';
import TemplateDialog from '@/components/modals/TemplateDialog.vue';
import StatusBar from '@/components/editor/StatusBar.vue';
import FormatToolbar from '@/components/editor/FormatToolbar.vue';
import ThemeSelector from '@/components/common/ThemeSelector.vue';
import WelcomePage from '@/components/common/WelcomePage.vue';
import NavTree from '@/components/nav/NavTree.vue';
import BacklinksPanel from '@/components/panels/BacklinksPanel.vue';
import TagCloudPanel from '@/components/panels/TagCloud.vue';
import RecentNotes from '@/components/panels/RecentNotes.vue';
import { MockFSService } from '@/services/MockFSService';
import { useIndexStore } from '@/stores/index';
import { useSearchStore } from '@/stores/search';
import { useHeadings } from '@/composables/useHeadings';
import { parseBlocks } from '@/utils/blockParser';
import { scanContentWarnings, humanizeError } from '@/utils/contentUtils';
import { useImageUpload } from '@/composables/useImageUpload';
import { setImageResolver } from '@/utils/cm6-live-preview';
import { renderMarkdown, highlightCodeBlocks } from '@markluck/renderer';
import type {
  DirEntry,
  IFileSystemService,
  SearchResult,
  BacklinkEntry,
  MarkdownBlock,
} from '@/types';

// --- File System ---
const fs: IFileSystemService = new MockFSService(50);

const files = ref<DirEntry[]>([]);
const currentContent = ref('');
const activePath = ref('');
const loading = ref(true); // Start loading to avoid WelcomePage flash before init
const errorMessage = ref('');
const showTemplate = ref(false);

// --- P2-2: 文件管理器状态 ---
const currentDir = ref('/');

/** 加载指定目录的文件列表 */
async function loadDirectory(dir: string): Promise<void> {
  currentDir.value = dir;
  try {
    const entries = await fs.listDirectory(dir);
    files.value = entries;
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : '加载目录失败';
  }
}

/** 导航到目录 */
function onNavigateDir(path: string): void {
  loadDirectory(path);
}

// --- Save State (M4-08: StatusBar feedback) ---
const isDirty = ref(false);
const isSaving = ref(false);
const saveError = ref<string | null>(null);
let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const MIN_SAVE_DISPLAY_MS = 500;

// --- Index & Search ---
const indexStore = useIndexStore();
const { headings, update: updateHeadings, getActiveHeadingId } = useHeadings();
const searchVisible = ref(false);

// --- Panel collapse states ---
const navTreeCollapsed = ref(false);
const backlinksCollapsed = ref(false);
const tagsCollapsed = ref(false);
const showExport = ref(false);
const showShare = ref(false);

// --- M1-08: Preview Mode ---
const showPreview = ref(false);
const renderedHtml = ref('');

async function updatePreview(content: string): Promise<void> {
  try {
    // 解析本地图片路径为 data URI（预览模式）
    const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let resolved = content;
    const matches = [...content.matchAll(imgRegex)];
    for (const m of matches.reverse()) {
      const path = m[2] || '';
      if (path.startsWith('data:') || path.startsWith('http')) continue;
      try {
        const base64 = await fs.readBinary(path);
        if (base64) {
          const ext = path.split('.').pop()?.toLowerCase() ?? 'png';
          const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
          const dataUri = base64.startsWith('data:') ? base64 : `data:${mime};base64,${base64}`;
          resolved =
            resolved.slice(0, m.index!) +
            `![${m[1] || ''}](${dataUri})` +
            resolved.slice(m.index! + m[0].length);
        }
      } catch {
        // 图片不可用 — 保留原始语法
      }
    }

    renderedHtml.value = renderMarkdown(resolved);
    // Apply syntax highlighting to code blocks after DOM insert
    nextTick(() => {
      const previewEl = document.querySelector('.markdown-preview');
      if (previewEl) {
        highlightCodeBlocks(previewEl as HTMLElement);
      }
    });
  } catch {
    renderedHtml.value = '<p class="render-error">渲染失败</p>';
  }
}

// Watch content changes to update preview when visible
// (preview is updated on-demand when toggling to preview mode)

// When user toggles preview on, render current content
watch(showPreview, (visible) => {
  if (visible && currentContent.value) {
    void updatePreview(currentContent.value);
  }
});

// --- M7-01: Large file handling ---
const FILE_SIZE_WARN = 1 * 1024 * 1024; // 1MB soft warning
const FILE_SIZE_MAX = 5 * 1024 * 1024; // 5MB hard limit for full rendering
const largeFileWarning = ref('');
const isLargeFile = ref(false);

// --- M7-04: Concurrent edit conflict detection ---
const fileMtimeAtOpen = ref<number | null>(null);

// --- M1-08: Block Parser ---
const currentBlocks = ref<MarkdownBlock[]>([]);
function updateBlocks(content: string): void {
  currentBlocks.value = parseBlocks(content, activePath.value);
}

const indexStatus = computed(() => indexStore.status);
const allTags = computed(() => indexStore.tags);
const recentNotes = computed(() => indexStore.recentNotes);
const activeHeadingId = computed(() => {
  // M2-15: heading scroll-follow — use line 0 for now (top of document)
  return getActiveHeadingId(0);
});

const currentBacklinks = computed((): BacklinkEntry[] => {
  if (!activePath.value) return [];
  return indexStore.getBacklinks(activePath.value);
});

// --- Initialize ---
async function initNotebook(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    await loadDirectory('/');
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : '加载笔记本失败';
  } finally {
    loading.value = false;
  }

  // Build index (async, non-blocking)
  try {
    await indexStore.initialize(fs);
  } catch {
    // Index build failure is non-fatal
  }
}

// --- File Operations ---

/** 选择文件或目录：文件→打开编辑；目录→进入文件夹 */
async function onSelectFileOrDir(path: string): Promise<void> {
  try {
    const stat = await fs.statFile(path);
    if (stat.isDirectory) {
      // 进入子目录
      await loadDirectory(path);
      return;
    }
  } catch {
    // statFile 失败，尝试作为文件打开
  }

  // 当作文件打开
  activePath.value = path;
  // P2-2: 自动定位到文件所在目录
  const dir = path.substring(0, path.lastIndexOf('/') + 1) || '/';
  if (dir !== currentDir.value) {
    currentDir.value = dir;
    loadDirectory(dir); // fire-and-forget 更新侧栏
  }

  loading.value = true;
  // Reset save state for new file
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  isDirty.value = false;
  isSaving.value = false;
  saveError.value = null;
  largeFileWarning.value = '';
  isLargeFile.value = false;

  // M7-01: Check file size before loading
  try {
    const stat = await fs.statFile(path);
    fileMtimeAtOpen.value = stat.mtime;
    if (stat.size > FILE_SIZE_MAX) {
      isLargeFile.value = true;
      largeFileWarning.value = `文件过大（${(stat.size / 1024 / 1024).toFixed(1)}MB），已切换为纯文本模式。超过 5MB 的文件不支持完整渲染。`;
    } else if (stat.size > FILE_SIZE_WARN) {
      largeFileWarning.value = `文件较大（${(stat.size / 1024 / 1024).toFixed(1)}MB），加载可能较慢。`;
    }
  } catch {
    fileMtimeAtOpen.value = null;
  }

  try {
    currentContent.value = await fs.readFile(path);
    updateHeadings(currentContent.value);
    updateEditorStats(currentContent.value);
    updateBlocks(currentContent.value);
    if (showPreview.value) void updatePreview(currentContent.value);

    // Update recent notes in index
    try {
      await indexStore.refreshDocument(fs, path);
    } catch {
      // non-fatal
    }
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : '读取文件失败';
  } finally {
    loading.value = false;
  }
}

/** 新建文本文件 */
async function onCreateFile(): Promise<void> {
  // eslint-disable-next-line no-alert
  const name = prompt('文件名（.md 或 .txt）：', '新笔记.md');
  if (!name) return;

  const path = currentDir.value === '/' ? `/${name}` : `${currentDir.value}${name}`;

  try {
    const content = name.endsWith('.md') ? `# ${name.replace(/\.md$/, '')}\n\n` : '';
    await fs.writeFile(path, content);
    await loadDirectory(currentDir.value);

    // 如果是 .md 文件，自动打开
    if (name.endsWith('.md')) {
      activePath.value = path;
      currentContent.value = content;
      updateHeadings(content);
      updateEditorStats(content);
    }
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : '创建文件失败';
  }
}

/** 重命名文件 */
async function onRenameFile(oldPath: string, newName: string): Promise<void> {
  try {
    const newPath = newName.startsWith('/') ? newName : currentDir.value + newName;
    await fs.renameFile(oldPath, newPath);

    // 更新当前活动路径
    if (activePath.value === oldPath) {
      activePath.value = newPath;
    }

    await loadDirectory(currentDir.value);
    await indexStore.refreshDocument(fs, newPath);
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : '重命名失败';
  }
}

// Editor stats (reactive)
const editorStats = reactive({
  charCount: 0,
  wordCount: 0,
  lineCount: 0,
  cursorLine: null as number | null,
  cursorCol: null as number | null,
});

// Watch content changes for stats
const updateEditorStats = (content: string): void => {
  editorStats.charCount = content.length;
  editorStats.wordCount = content ? content.split(/\s+/).filter(Boolean).length : 0;
  editorStats.lineCount = content ? content.split('\n').length : 0;
};

// --- M1-12: FormatToolbar ---
const editorRef = ref<InstanceType<typeof MarkdownEditor> | null>(null);

// --- P2-1: Image Upload ---
const imageFileInput = ref<HTMLInputElement | null>(null);
const imageUpload = useImageUpload(fs, () => editorRef.value?.getEditorView() ?? null);

/** 工具栏图片按钮 → 触发文件选择器 */
function triggerImagePicker(): void {
  imageFileInput.value?.click();
}

/** 文件选择器回调 */
async function onImageFileSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const handler = imageUpload.createFilePickerHandler();
  await handler(file);

  // 重置 input 以允许重复选择同一文件
  input.value = '';
}

function applyFormat(wrapper: string, placeholder = '', blockPrefix = false): void {
  const view = editorRef.value?.getEditorView();
  if (!view) return;

  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to) || placeholder;

  if (blockPrefix) {
    const lines = selected.split('\n');
    const prefixed = lines.map((l) => wrapper + l).join('\n');
    view.dispatch({
      changes: { from, to, insert: prefixed },
      selection: { anchor: from + prefixed.length, head: from + prefixed.length },
    });
  } else if (wrapper.includes('$1')) {
    const result = wrapper.replace('$1', selected);
    const cursorOffset = result.indexOf(selected);
    view.dispatch({
      changes: { from, to, insert: result },
      selection: { anchor: from + cursorOffset, head: from + cursorOffset + selected.length },
    });
  } else {
    const wrapped = wrapper + selected + wrapper;
    view.dispatch({
      changes: { from, to, insert: wrapped },
      selection: { anchor: from + wrapper.length, head: from + wrapper.length + selected.length },
    });
  }
}

function onFormat(type: string): void {
  switch (type) {
    case 'bold':
      applyFormat('**', '粗体文字');
      break;
    case 'italic':
      applyFormat('*', '斜体文字');
      break;
    case 'strikethrough':
      applyFormat('~~', '删除文字');
      break;
    case 'heading':
      applyFormat('## ', '标题', true);
      break;
    case 'unorderedList':
      applyFormat('- ', '列表项', true);
      break;
    case 'orderedList':
      applyFormat('1. ', '列表项', true);
      break;
    case 'taskList':
      applyFormat('- [ ] ', '待办项', true);
      break;
    case 'blockquote':
      applyFormat('> ', '引用文字', true);
      break;
    case 'codeBlock':
      applyFormat('```\n', 'code', false);
      break;
    case 'link':
      applyFormat('[$1](url)', '', false);
      break;
    case 'image':
      triggerImagePicker();
      break;
    case 'horizontalRule':
      applyFormat('\n---\n', '', false);
      break;
  }
}

async function onTemplateSelect(_tpl: unknown, content: string): Promise<void> {
  // Use template title as note name
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const name = titleMatch?.[1]?.trim() || '新笔记';
  const path = `/${name}.md`;

  try {
    await fs.writeFile(path, content);
    const entries = await fs.listDirectory('/');
    files.value = entries;
    activePath.value = path;
    currentContent.value = content;
    updateHeadings(content);
    updateEditorStats(content);

    try {
      await indexStore.refreshDocument(fs, path);
    } catch {
      /* ok */
    }
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : '创建笔记失败';
  }
}

async function onCreateBlank(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const name = `笔记-${today}`;
  const path = `/${name}.md`;
  const content = `# 新笔记\n\n`;

  try {
    await fs.writeFile(path, content);
    const entries = await fs.listDirectory('/');
    files.value = entries;
    activePath.value = path;
    currentContent.value = content;
    updateHeadings(content);
    updateEditorStats(content);

    try {
      await indexStore.refreshDocument(fs, path);
    } catch {
      /* ok */
    }
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : '创建笔记失败';
  }
}

async function onDeleteFile(path: string): Promise<void> {
  try {
    await fs.deleteFile(path);
    if (activePath.value === path) {
      activePath.value = '';
      currentContent.value = '';
    }
    indexStore.removeDocument(path);
    const entries = await fs.listDirectory('/');
    files.value = entries;
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : '删除失败';
  }
}

function onContentUpdate(content: string): void {
  currentContent.value = content;
  updateHeadings(content);
  updateEditorStats(content);
  updateBlocks(content);

  // Update preview if visible (live preview)
  if (showPreview.value) {
    void updatePreview(content);
  }

  // M7-03: Check for problematic characters on each update (debounced)
  if (content.length > 0 && content.length % 500 < 10) {
    const warnings = scanContentWarnings(content);
    if (warnings.length > 0 && !largeFileWarning.value) {
      largeFileWarning.value = warnings[0]?.message ?? '';
    }
  }

  // Mark dirty, debounce save
  if (activePath.value) {
    isDirty.value = true;
    saveError.value = null;

    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(() => {
      void debouncedSave(activePath.value!, content);
    }, 600);
  }
}

/** M7-04: 防抖保存 + 外部修改冲突检测 */
async function debouncedSave(path: string, content: string): Promise<void> {
  isSaving.value = true;
  const start = Date.now();

  // M7-04: Check for external modifications before saving
  try {
    const stat = await fs.statFile(path);
    if (fileMtimeAtOpen.value !== null && stat.mtime !== fileMtimeAtOpen.value) {
      // File was modified externally since we opened it
      largeFileWarning.value = '此文件已被外部程序修改。继续保存将覆盖外部更改。';
    }
  } catch {
    // statFile may fail; skip conflict check
  }

  try {
    await fs.writeFile(path, content);
    await indexStore.refreshDocument(fs, path);
    // Update our mtime reference after successful save
    try {
      const stat = await fs.statFile(path);
      fileMtimeAtOpen.value = stat.mtime;
    } catch {
      /* ok */
    }

    // Ensure "保存中" visible for at least MIN_SAVE_DISPLAY_MS
    const elapsed = Date.now() - start;
    if (elapsed < MIN_SAVE_DISPLAY_MS) {
      await new Promise((r) => setTimeout(r, MIN_SAVE_DISPLAY_MS - elapsed));
    }

    isDirty.value = false;
    saveError.value = null;
  } catch (e) {
    saveError.value = humanizeError(e);
  } finally {
    isSaving.value = false;
  }
}

// --- Search ---
function onSearchResultSelect(result: SearchResult): void {
  searchVisible.value = false;
  onSelectFileOrDir(result.notePath);
}

function onTagSelect(tagName: string): void {
  searchVisible.value = true;
  const searchStore = useSearchStore();
  setTimeout(() => {
    searchStore.open(`tag:${tagName}`);
  }, 50);
}

// --- Navigation ---
function onNavTreeNavigate(_headingId: string, lineNumber: number): void {
  // Scroll CM6 editor to the line (via editorView ref — not directly accessible here)
  // M2-14: Scroll to heading via CodeMirror dispatch
  // For now, log the intent — full integration requires exposing scrollTo from MarkdownEditor
  if (lineNumber > 0) {
    // EditorView.dispatch({ selection: { anchor: line }, scrollIntoView: true })
  }
}

function onBacklinkNavigate(entry: BacklinkEntry): void {
  onSelectFileOrDir(entry.notePath);
}

// --- Keyboard Shortcuts ---
function handleGlobalKeydown(e: KeyboardEvent): void {
  // Ctrl+Shift+P → open search (avoid Chinese IME conflict with Ctrl+Shift+F)
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
    e.preventDefault();
    searchVisible.value = true;
  }
}

onMounted(() => {
  // P2-1: 注册图片解析器（供 CM6 ImageWidget 异步加载图片）
  setImageResolver(async (path: string) => {
    try {
      return await fs.readBinary(path);
    } catch {
      return null;
    }
  });
  initNotebook();
  window.addEventListener('keydown', handleGlobalKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown);
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
});
</script>

<style scoped>
.sidebar-content {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--rule, oklch(0.88 0.003 85));
}

.sidebar-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sidebar-title {
  font-weight: 700;
  font-size: 14px;
  color: var(--ink-primary, oklch(0.15 0.003 85));
}

.btn-new-note {
  width: 28px;
  height: 28px;
  border: 1px solid var(--rule, oklch(0.88 0.003 85));
  border-radius: var(--radius, 2px);
  background: var(--paper-surface, oklch(0.985 0.002 85));
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  color: var(--ink-secondary, oklch(0.42 0.003 85));
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 150ms var(--ease-fade, cubic-bezier(0.4, 0, 0.2, 1));
}

.btn-new-note:hover {
  background: var(--accent-soft, oklch(0.92 0.03 250 / 0.55));
  color: var(--ink-primary, oklch(0.15 0.003 85));
}

.new-note-input {
  display: flex;
  gap: 4px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--rule, oklch(0.88 0.003 85));
}

.new-note-input input {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--rule, oklch(0.88 0.003 85));
  border-radius: var(--radius, 2px);
  font-size: 13px;
  background: var(--paper-surface, oklch(0.985 0.002 85));
  color: var(--ink-primary, oklch(0.15 0.003 85));
}

.new-note-input button {
  padding: 4px 8px;
  border: 1px solid var(--rule, oklch(0.88 0.003 85));
  border-radius: var(--radius, 2px);
  background: var(--paper-surface, oklch(0.985 0.002 85));
  cursor: pointer;
  font-size: 12px;
  color: var(--ink-secondary, oklch(0.42 0.003 85));
}

.new-note-input button:first-of-type {
  background: var(--accent, oklch(0.52 0.12 250));
  color: oklch(0.995 0 0);
  border-color: var(--accent, oklch(0.52 0.12 250));
}

.editor-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--ink-secondary, oklch(0.42 0.003 85));
}

.editor-empty h1 {
  font-size: 24px;
  margin-bottom: 8px;
  color: var(--ink-primary, oklch(0.15 0.003 85));
}

.editor-hint {
  margin-top: 16px;
  font-size: 12px;
  color: var(--ink-muted, oklch(0.6 0.002 85));
}

.right-sidebar-content {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.editor-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-bottom: 1px solid var(--rule, oklch(0.88 0.003 85));
  background: var(--paper-surface, oklch(0.985 0.002 85));
}

.editor-file-name {
  font-size: 12px;
  color: var(--ink-secondary, oklch(0.42 0.003 85));
  font-family: var(--ff-mono, monospace);
}

.file-warning {
  padding: 8px 12px;
  background: oklch(0.95 0.08 80 / 0.25);
  color: var(--signal-warning, oklch(0.63 0.15 82));
  font-size: 12px;
  border-bottom: 1px solid oklch(0.85 0.08 80 / 0.3);
  display: flex;
  align-items: center;
  gap: 8px;
}

.file-warning-btn {
  margin-left: auto;
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  font-size: 14px;
}

.editor-actions {
  display: flex;
  gap: 4px;
  align-items: center;
}

.btn-action {
  padding: 4px 10px;
  border: 1px solid var(--rule, oklch(0.88 0.003 85));
  border-radius: var(--radius, 2px);
  background: var(--paper-surface, oklch(0.985 0.002 85));
  font-size: 12px;
  cursor: pointer;
  color: var(--ink-secondary, oklch(0.42 0.003 85));
  transition:
    background 150ms var(--ease-fade, cubic-bezier(0.4, 0, 0.2, 1)),
    color 150ms var(--ease-fade, cubic-bezier(0.4, 0, 0.2, 1));
}

.btn-action:hover {
  background: var(--accent-soft, oklch(0.92 0.03 250 / 0.55));
  color: var(--ink-primary, oklch(0.15 0.003 85));
}

/* Preview toggle button — accent highlight when active */
.btn-preview-toggle {
  font-weight: 600;
}

/* ===== Markdown Preview (rendered HTML) ===== */
.markdown-preview {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
  background: var(--editor-bg, oklch(0.985 0.001 85));
  color: var(--ink-primary, oklch(0.15 0.003 85));
  line-height: var(--lh-reading, 1.8);
  font-family: var(--ff-body, system-ui, sans-serif);
  font-size: var(--text-base, 15px);
  scroll-behavior: smooth;
}

/* Markdown rendered content typography */
.markdown-preview :deep(h1) {
  font-size: 2em;
  font-weight: 700;
  margin: 0.67em 0;
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--rule, oklch(0.88 0.003 85));
  color: var(--ink-primary, oklch(0.15 0.003 85));
}

.markdown-preview :deep(h2) {
  font-size: 1.5em;
  font-weight: 700;
  margin: 0.83em 0 0.4em;
  padding-bottom: 0.25em;
  border-bottom: 1px solid var(--rule, oklch(0.88 0.003 85));
  color: var(--ink-primary, oklch(0.15 0.003 85));
}

.markdown-preview :deep(h3) {
  font-size: 1.25em;
  font-weight: 700;
  margin: 1em 0 0.3em;
}

.markdown-preview :deep(h4) {
  font-size: 1.1em;
  font-weight: 700;
  margin: 0.8em 0 0.2em;
}

.markdown-preview :deep(p) {
  margin: 0.6em 0;
}

.markdown-preview :deep(ul),
.markdown-preview :deep(ol) {
  padding-left: 2em;
  margin: 0.5em 0;
}

.markdown-preview :deep(li) {
  margin: 0.25em 0;
}

.markdown-preview :deep(blockquote) {
  margin: 0.8em 0;
  padding: 0.5em 1em;
  border-left: 4px solid var(--accent, oklch(0.52 0.12 250));
  background: var(--accent-soft, oklch(0.92 0.03 250 / 0.55));
  color: var(--ink-secondary, oklch(0.42 0.003 85));
}

.markdown-preview :deep(code) {
  background: var(--code-bg, oklch(0.96 0.002 85));
  color: var(--code-text, oklch(0.18 0.005 85));
  padding: 2px 6px;
  border-radius: var(--radius, 2px);
  font-family: var(--ff-mono, 'Fira Code', monospace);
  font-size: 0.9em;
}

.markdown-preview :deep(pre) {
  background: var(--code-block-bg, oklch(0.97 0.002 85));
  border: 1px solid var(--rule, oklch(0.88 0.003 85));
  border-radius: var(--radius, 2px);
  padding: 16px;
  overflow-x: auto;
  margin: 0.8em 0;
}

.markdown-preview :deep(pre code) {
  background: none;
  padding: 0;
  font-size: 0.9em;
  line-height: 1.5;
}

.markdown-preview :deep(table) {
  border-collapse: collapse;
  margin: 0.8em 0;
  width: 100%;
}

.markdown-preview :deep(th),
.markdown-preview :deep(td) {
  border: 1px solid var(--rule, oklch(0.88 0.003 85));
  padding: 8px 12px;
  text-align: left;
}

.markdown-preview :deep(th) {
  background: var(--table-stripe, var(--surface-hover, oklch(0 0 0 / 0.03)));
  font-weight: 700;
}

.markdown-preview :deep(tr:nth-child(even)) {
  background: var(--table-stripe, var(--surface-hover, oklch(0 0 0 / 0.03)));
}

.markdown-preview :deep(hr) {
  border: none;
  border-top: 2px solid var(--rule, oklch(0.88 0.003 85));
  margin: 1.5em 0;
}

.markdown-preview :deep(a) {
  color: var(--link, oklch(0.5 0.11 250));
  text-decoration: none;
}

.markdown-preview :deep(a:hover) {
  text-decoration: underline;
}

.markdown-preview :deep(img) {
  max-width: 100%;
  height: auto;
}

.markdown-preview :deep(.wiki-link) {
  color: var(--link, oklch(0.5 0.11 250));
  cursor: pointer;
  text-decoration: underline dotted;
}

.markdown-preview :deep(.wiki-link--broken) {
  color: var(--link-broken, var(--signal-error, oklch(0.48 0.17 25)));
  text-decoration: underline wavy;
}

.markdown-preview :deep(.inline-tag) {
  color: var(--accent, oklch(0.52 0.12 250));
  background: var(--accent-soft, oklch(0.92 0.03 250 / 0.55));
  padding: 1px 6px;
  border-radius: var(--radius, 2px);
  font-size: 0.85em;
}

.markdown-preview :deep(.render-error) {
  color: var(--signal-error, oklch(0.48 0.17 25));
  padding: 16px;
  border: 1px dashed var(--signal-error, oklch(0.48 0.17 25));
  border-radius: var(--radius, 2px);
}
</style>
