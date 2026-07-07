<template>
  <div class="notebook-home-root">
    <Transition name="external-mode" appear>
      <div v-if="isExternalReadonly" key="external-reader" class="external-reader-frame">
        <ThemeSlotBoundary
          slot-id="external-reader"
          :theme-id="theme.renderedTheme.manifest.id"
          :recipe="theme.activeUxRecipes['external-reader']"
          :actions="shellActions"
          :slot-props="externalReaderSlotProps"
        >
          <div class="external-reader" data-testid="external-file-session">
            <header class="external-reader-topbar">
              <div class="external-reader-identity">
                <span class="external-reader-kicker">外部文件 · 只读预览</span>
                <h1 class="external-reader-title">{{ externalFileName }}</h1>
                <p class="external-reader-path">{{ externalFilePath }}</p>
              </div>
              <div class="external-reader-actions">
                <span class="external-reader-stat">{{ externalReadStats }}</span>
                <button
                  v-if="!externalError"
                  class="btn btn--secondary"
                  @click="openExternalParentAsNotebook"
                >
                  打开所在文件夹为笔记本
                </button>
                <button
                  v-if="!externalError"
                  class="btn btn--primary"
                  @click="showExternalEditConfirm = true"
                >
                  启用编辑
                </button>
              </div>
            </header>

            <main class="external-reader-main">
              <aside
                v-if="headings.length > 0 && !loading && !externalError"
                class="external-reader-rail"
              >
                <span class="external-reader-rail-label">大纲</span>
                <button
                  v-for="heading in headings"
                  :key="heading.id"
                  class="external-reader-heading"
                  :class="`external-reader-heading--level-${heading.level}`"
                  @click="scrollExternalHeading(heading.id)"
                >
                  {{ heading.text }}
                </button>
              </aside>

              <div class="external-reader-content">
                <div v-if="loading" class="external-state">正在打开文件...</div>
                <div v-else-if="externalError" class="external-state external-state--error">
                  <strong>无法打开文件</strong>
                  <span>{{ externalError }}</span>
                </div>
                <!-- eslint-disable vue/no-v-html -->
                <article
                  v-else
                  class="markdown-body external-preview"
                  v-html="externalPreviewHtml"
                />
                <!-- eslint-enable vue/no-v-html -->
              </div>
            </main>
          </div>
        </ThemeSlotBoundary>
      </div>
    </Transition>

    <Transition name="external-mode" appear>
      <div v-if="!isExternalReadonly" key="editor-shell" class="editor-shell-frame">
        <AppShell
          :recent-notes="shellRecentNotesWithColors"
          :active-path="shellActivePath"
          :note-title="shellNoteTitle"
          :notebook-name="shellNotebookName"
          :show-top-bar="true"
          :show-right-wing="showRightWing"
          :headings="headings"
          :backlinks="shellBacklinks"
          :tags="shellTags"
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
          :theme-chrome="chrome"
          :actions="shellActions"
          :theme-host-ui="themeHostUi"
          @select-note="onShellSelectNote"
          @navigate-heading="onNavTreeNavigate"
          @navigate-backlink="onBacklinkNavigate"
          @select-tag="onTagSelect"
          @toggle-right-wing="showRightWing = !showRightWing"
        >
          <template #drawer-bottom>
            <ThemeSlotBoundary
              slot-id="editor-control"
              :theme-id="theme.renderedTheme.manifest.id"
              :recipe="theme.activeUxRecipes['editor-control']"
              :actions="shellActions"
              :slot-props="editorControlSlotProps"
            >
              <EditorControlStrip
                :region="{ layout: chrome.editorControlLayout, density: chrome.toolbarDensity }"
                :actions="actionsForRegion('editor-control')"
                :preset="activeParagraphPreset"
                :active-action="pendingFormatAction"
                @format="onToolbarFormat"
              />
            </ThemeSlotBoundary>
          </template>

          <template #editor>
            <ThemeSlotBoundary
              slot-id="workflow-canvas"
              :theme-id="theme.renderedTheme.manifest.id"
              :recipe="theme.activeUxRecipes['workflow-canvas']"
              :actions="shellActions"
              :slot-props="workflowSlotProps"
            >
              <div class="workflow-canvas" :data-workspace-intent="chrome.workspaceIntent">
                <StudioRail
                  v-if="chrome.editorControlLayout === 'studio-rail' && !isSinglePageLayout"
                  :actions="actionsForRegion('studio-rail')"
                  :preset="activeParagraphPreset"
                  :active-action="pendingFormatAction"
                  @format="onToolbarFormat"
                />

                <div class="workflow-canvas__main">
                  <ThemeSlotBoundary
                    v-if="chrome.editorControlLayout !== 'studio-rail' && !isSinglePageLayout"
                    slot-id="editor-control"
                    :theme-id="theme.renderedTheme.manifest.id"
                    :recipe="theme.activeUxRecipes['editor-control']"
                    :actions="shellActions"
                    :slot-props="editorControlSlotProps"
                  >
                    <EditorControlStrip
                      :region="{
                        layout: chrome.editorControlLayout,
                        density: chrome.toolbarDensity,
                      }"
                      :actions="actionsForRegion('editor-control')"
                      :preset="activeParagraphPreset"
                      :active-action="pendingFormatAction"
                      @format="onToolbarFormat"
                    />
                  </ThemeSlotBoundary>

                  <ThemeSlotBoundary
                    slot-id="editor-surface"
                    :theme-id="theme.renderedTheme.manifest.id"
                    :recipe="theme.activeUxRecipes['editor-surface']"
                    :actions="shellActions"
                    :slot-props="editorSurfaceSlotProps"
                  >
                    <div v-if="viewMode === 'read'" class="reader-workbench" data-view-mode="read">
                      <div class="reader-workbench__bar">
                        <span class="reader-workbench__label">阅读</span>
                        <div class="reader-workbench__actions">
                          <ShellActionButton
                            v-for="action in actionsForRegion('reader-bar')"
                            :key="action.id"
                            :action="action"
                            label-mode="short"
                            size="sm"
                          />
                        </div>
                      </div>
                      <!-- eslint-disable-next-line vue/no-v-html -->
                      <article class="markdown-body reader-preview" v-html="splitPreviewHtml" />
                    </div>

                    <template v-else>
                      <!-- Format Bubble (floating, on text selection) -->
                      <FormatBubble
                        :visible="bubbleVisible"
                        :position="bubblePosition"
                        @format="onBubbleFormat"
                      />
                      <!-- Split Mode: left editor + right preview -->
                      <div v-if="viewMode === 'split'" class="split-pane">
                        <div class="split-left" :style="{ flex: `0 0 ${splitRatio}%` }">
                          <MarkdownEditor
                            v-if="!deferSplitEditorMount"
                            ref="editorRef"
                            :key="`split-${isScratchSession ? 'draft' : shellActivePath}`"
                            :model-value="currentContent"
                            :placeholder="isScratchSession ? '开始输入文字' : undefined"
                            :show-line-numbers="!isLargeDocument"
                            :live-preview="false"
                            :source-only="true"
                            :pending-format="pendingFormatAction"
                            :wiki-link-exists="wikiLinkExists"
                            :wiki-link-revision="wikiLinkRevision"
                            :completion-settings="completionSettings"
                            :enable-autocomplete="!isExternalEditing && !isLargeDocument"
                            :on-editor-drop="isExternalEditing ? undefined : imageUpload.handleDrop"
                            :on-editor-drag-over="
                              isExternalEditing ? undefined : imageUpload.handleDragOver
                            "
                            :on-editor-paste="
                              isExternalEditing ? undefined : imageUpload.handlePaste
                            "
                            @update:model-value="onEditorContentUpdate"
                            @selection-change="onSelectionChange"
                            @pending-format-ended="pendingFormatAction = null"
                          />
                          <div v-else class="large-doc-editor-placeholder">
                            <span>正在准备大文档源码视图...</span>
                          </div>
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
                        :key="`live-${isScratchSession ? 'draft' : shellActivePath}`"
                        :model-value="currentContent"
                        :placeholder="isScratchSession ? '开始输入文字' : undefined"
                        :show-line-numbers="false"
                        :live-preview="true"
                        :pending-format="pendingFormatAction"
                        :on-live-preview-external-link-click="onLivePreviewExternalLinkClick"
                        :on-live-preview-tag-click="onLivePreviewTagClick"
                        :on-live-preview-wiki-link-click="onLivePreviewWikiLinkClick"
                        :wiki-link-exists="wikiLinkExists"
                        :wiki-link-revision="wikiLinkRevision"
                        :completion-settings="completionSettings"
                        :enable-autocomplete="!isExternalEditing && !isLargeDocument"
                        :on-editor-drop="isExternalEditing ? undefined : imageUpload.handleDrop"
                        :on-editor-drag-over="
                          isExternalEditing ? undefined : imageUpload.handleDragOver
                        "
                        :on-editor-paste="isExternalEditing ? undefined : imageUpload.handlePaste"
                        @update:model-value="onEditorContentUpdate"
                        @selection-change="onSelectionChange"
                        @pending-format-ended="pendingFormatAction = null"
                      />
                    </template>
                  </ThemeSlotBoundary>
                </div>
              </div>
            </ThemeSlotBoundary>
          </template>
        </AppShell>
      </div>
    </Transition>
  </div>

  <!-- Command Palette -->
  <ThemeSlotBoundary
    slot-id="command-palette"
    :theme-id="theme.renderedTheme.manifest.id"
    :recipe="theme.activeUxRecipes['command-palette']"
    :actions="shellActions"
    :slot-props="commandPaletteSlotProps"
  >
    <CommandPalette
      :visible="searchVisible"
      @update:visible="searchVisible = $event"
      @select-result="onSearchSelectResult"
      @quick-action="onQuickAction"
    />
  </ThemeSlotBoundary>

  <!-- File Drawer (left slide) -->
  <ThemeSlotBoundary
    slot-id="file-drawer"
    :theme-id="theme.renderedTheme.manifest.id"
    :recipe="theme.activeUxRecipes['file-drawer']"
    :actions="shellActions"
    :slot-props="fileDrawerSlotProps"
  >
    <FileDrawer
      :visible="showLeftDrawer"
      :files="shellFiles"
      root-dir="/"
      :active-path="shellActivePath"
      :loading="loading"
      :error="errorMessage"
      @update:visible="showLeftDrawer = $event"
      @select-file="onShellSelectNote"
      @navigate-dir="onShellDrawerNavigateDir"
      @create-file="onShellCreateFile"
      @delete-file="requestShellDeleteFile"
      @rename-file="onShellRenameFile"
      @retry="onShellDrawerRetry"
    />
  </ThemeSlotBoundary>

  <!-- Export Dialog -->
  <ThemeSlotBoundary
    slot-id="export-dialog"
    :theme-id="theme.renderedTheme.manifest.id"
    :recipe="theme.activeUxRecipes['export-dialog']"
    :actions="shellActions"
    :slot-props="exportDialogSlotProps"
  >
    <ExportDialog
      :visible="showExport"
      :note-path="shellActivePath"
      :note-title="shellNoteTitle"
      :markdown-content="currentContent"
      @update:visible="showExport = $event"
    />
  </ThemeSlotBoundary>

  <!-- Template Dialog -->
  <ThemeSlotBoundary
    slot-id="template-dialog"
    :theme-id="theme.renderedTheme.manifest.id"
    :recipe="theme.activeUxRecipes['template-dialog']"
    :actions="shellActions"
    :slot-props="templateDialogSlotProps"
  >
    <TemplateDialog
      :visible="showTemplate"
      :current-content="shellActivePath ? currentContent : undefined"
      @update:visible="showTemplate = $event"
      @select="onTemplateSelect"
      @create-blank="onCreateBlank"
    />
  </ThemeSlotBoundary>

  <!-- Settings Dialog -->
  <ThemeSlotBoundary
    slot-id="settings-dialog"
    :theme-id="theme.renderedTheme.manifest.id"
    :recipe="theme.activeUxRecipes['settings-dialog']"
    :actions="shellActions"
    :slot-props="settingsDialogSlotProps"
  >
    <SettingsDialog
      :visible="showSettings"
      :completion-settings="completionSettings"
      :completion-training-meta="completionTrainingMeta"
      :external-scan-root-text-files="externalScanRootTextFiles"
      @update:visible="showSettings = $event"
      @update-completion-settings="onUpdateCompletionSettings"
      @update-external-scan-root="onUpdateExternalScanRootTextFiles"
      @clear-completion-data="onClearCompletionData"
    />
  </ThemeSlotBoundary>

  <ThemeSlotBoundary
    slot-id="dialogs.theme"
    :theme-id="theme.renderedTheme.manifest.id"
    :recipe="theme.activeUxRecipes['dialogs.theme']"
    :actions="shellActions"
    :slot-props="themeDialogSlotProps"
  >
    <ThemeDialog :visible="showThemeDialog" @update:visible="showThemeDialog = $event" />
  </ThemeSlotBoundary>

  <!-- Share Dialog -->
  <ThemeSlotBoundary
    slot-id="share-dialog"
    :theme-id="theme.renderedTheme.manifest.id"
    :recipe="theme.activeUxRecipes['share-dialog']"
    :actions="shellActions"
    :slot-props="shareDialogSlotProps"
  >
    <ShareDialog
      :visible="showShare"
      :note-title="shellNoteTitle"
      :markdown-content="currentContent"
      @update:visible="showShare = $event"
    />
  </ThemeSlotBoundary>

  <!-- Toast Container -->
  <ThemeSlotBoundary
    slot-id="toast-container"
    :theme-id="theme.renderedTheme.manifest.id"
    :recipe="theme.activeUxRecipes['toast-container']"
    :actions="shellActions"
    :slot-props="toastSlotProps"
  >
    <ToastContainer />
  </ThemeSlotBoundary>

  <!-- Update Notification -->
  <ThemeSlotBoundary
    slot-id="update-notification"
    :theme-id="theme.renderedTheme.manifest.id"
    :recipe="theme.activeUxRecipes['update-notification']"
    :actions="shellActions"
    :slot-props="updateNotificationSlotProps"
  >
    <UpdateNotification
      :visible="showUpdateNotification"
      :latest-version="updateLatestVersion"
      :release-url="updateReleaseUrl"
      :release-notes="updateReleaseNotes"
      @update:visible="showUpdateNotification = $event"
      @dismiss-version="onDismissVersion"
    />
  </ThemeSlotBoundary>

  <!-- Markdown Cheat Sheet -->
  <ThemeSlotBoundary
    slot-id="markdown-cheat-sheet"
    :theme-id="theme.renderedTheme.manifest.id"
    :recipe="theme.activeUxRecipes['markdown-cheat-sheet']"
    :actions="shellActions"
    :slot-props="markdownCheatSheetSlotProps"
  >
    <MarkdownCheatSheet />
  </ThemeSlotBoundary>

  <!-- New File Dialog -->
  <ThemeSlotBoundary
    slot-id="new-file-dialog"
    :theme-id="theme.renderedTheme.manifest.id"
    :recipe="theme.activeUxRecipes['new-file-dialog']"
    :actions="shellActions"
    :slot-props="newFileDialogSlotProps"
  >
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
              :placeholder="`文件名（${supportedNoteExtensionsText}）`"
              autofocus
              @keydown.escape="cancelNewFile"
              @keydown.enter="confirmNewFile"
            />
          </div>
          <div class="modal-footer">
            <button class="btn btn--secondary" @click="cancelNewFile">取消</button>
            <button
              class="btn btn--primary"
              :disabled="!newFileName.trim()"
              @click="confirmNewFile"
            >
              确定
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </ThemeSlotBoundary>

  <!-- Delete Confirm Dialog -->
  <ThemeSlotBoundary
    slot-id="delete-confirm-dialog"
    :theme-id="theme.renderedTheme.manifest.id"
    :recipe="theme.activeUxRecipes['delete-confirm-dialog']"
    :actions="shellActions"
    :slot-props="deleteConfirmSlotProps"
  >
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
  </ThemeSlotBoundary>

  <!-- External Edit Confirm Dialog -->
  <ThemeSlotBoundary
    slot-id="external-edit-dialog"
    :theme-id="theme.renderedTheme.manifest.id"
    :recipe="theme.activeUxRecipes['external-edit-dialog']"
    :actions="shellActions"
    :slot-props="externalEditDialogSlotProps"
  >
    <Teleport to="body">
      <div
        v-if="showExternalEditConfirm"
        class="modal-overlay"
        @click.self="showExternalEditConfirm = false"
      >
        <div
          class="modal-card"
          style="width: 420px"
          role="dialog"
          aria-modal="true"
          aria-labelledby="external-edit-title"
        >
          <div class="modal-header">
            <h2 id="external-edit-title">启用单文件编辑</h2>
          </div>
          <div class="modal-body">
            <p class="delete-confirm-text">
              默认仅编辑当前文件，不会扫描所在文件夹，也不会把它加入笔记本或标签索引。
              如需搜索和标签，可显式扫描所在文件夹；较大的目录可能需要一些时间。
            </p>
          </div>
          <div class="modal-footer">
            <button class="btn btn--secondary" @click="showExternalEditConfirm = false">
              取消
            </button>
            <button class="btn btn--secondary" @click="confirmExternalEditAndScan">
              扫描所在文件夹
            </button>
            <button class="btn btn--primary" @click="confirmExternalEdit(false)">
              仅编辑当前文件
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </ThemeSlotBoundary>

  <!-- Scratch Exit Confirm Dialog -->
  <ThemeSlotBoundary
    slot-id="scratch-exit-dialog"
    :theme-id="theme.renderedTheme.manifest.id"
    :recipe="theme.activeUxRecipes['scratch-exit-dialog']"
    :actions="shellActions"
    :slot-props="scratchExitDialogSlotProps"
  >
    <Teleport to="body">
      <div v-if="showScratchExitDialog" class="modal-overlay">
        <div
          class="modal-card"
          style="width: 420px"
          role="dialog"
          aria-modal="true"
          aria-labelledby="scratch-exit-title"
        >
          <div class="modal-header">
            <h2 id="scratch-exit-title">保存临时草稿？</h2>
          </div>
          <div class="modal-body">
            <p class="delete-confirm-text">
              当前草稿还没有保存为文件。可以选择保存位置，或放弃这次临时内容。
            </p>
          </div>
          <div class="modal-footer">
            <button class="btn btn--secondary" @click="cancelScratchExit">取消</button>
            <button class="btn btn--secondary" @click="discardScratchAndClose">不保存</button>
            <button class="btn btn--primary" @click="saveScratchAndClose">保存</button>
          </div>
        </div>
      </div>
    </Teleport>
  </ThemeSlotBoundary>
</template>

<script setup lang="ts">
/**
 * NotebookHome.vue — 羽翼編纂主页面
 *
 * 集成 AppShell 布局 + MarkdownEditor + 所有浮层/对话框。
 *
 * @see migration-map.md §2
 */
import {
  ref,
  reactive,
  computed,
  onMounted,
  onUnmounted,
  nextTick,
  watch,
  defineAsyncComponent,
} from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import AppShell from '@/components/layout/AppShell.vue';
import ShellActionButton from '@/components/layout/ShellActionButton.vue';
import MarkdownEditor from '@/components/editor/MarkdownEditor.vue';
import FormatBubble from '@/components/editor/FormatBubble.vue';
import EditorControlStrip from '@/components/editor/EditorControlStrip.vue';
import StudioRail from '@/components/editor/StudioRail.vue';
import ThemeDialog from '@/components/theme/ThemeDialog.vue';
import ThemeSlotBoundary from '@/components/theme/ThemeSlotBoundary.vue';
import FileDrawer from '@/components/overlays/FileDrawer.vue';
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
  DEFAULT_TRAINING_META,
  loadTrainingMeta,
  saveTrainingMeta,
  subscribeTrainingMeta,
  type CompletionTrainingMeta,
} from '@/services/CompletionTrainingService';
import {
  applyParagraphPreset,
  clearMarkdownFormatting,
  detectParagraphPreset,
  toggleInlineFormat,
} from '@/utils/markdown-formatting';
import {
  isMarkdownLikeFile,
  isSupportedNoteFile,
  stripSupportedNoteExtension,
  supportedNoteExtensionsLabel,
} from '@/utils/note-files';
import { getDraftMarkdownFileName } from '@/utils/draft-file-name';
import { getMarkluckE2EBridge, peekMarkluckE2EBridge } from '@/utils/e2e-bridge';
import { isDesktopRuntime, shouldPersistMockFs } from '@/utils/runtime';
import type {
  ShellAction,
  ThemeActionRegion,
  ThemeSlotId,
  ThemeViewMode,
} from '@/types/theme-pack';

const CommandPalette = defineAsyncComponent(
  () => import('@/components/overlays/CommandPalette.vue'),
);
const ExportDialog = defineAsyncComponent(() => import('@/components/modals/ExportDialog.vue'));
const TemplateDialog = defineAsyncComponent(() => import('@/components/modals/TemplateDialog.vue'));
const SettingsDialog = defineAsyncComponent(() => import('@/components/modals/SettingsDialog.vue'));
const ShareDialog = defineAsyncComponent(() => import('@/components/modals/ShareDialog.vue'));

// --- File System ---
// Tauri 桌面端使用真实文件系统，Web/E2E 使用虚拟 MockFS
function createFileSystem(): IFileSystemService {
  if (isDesktopRuntime()) return new TauriIPCService();
  return new MockFSService(50, { persist: shouldPersistMockFs() });
}
const fs: IFileSystemService = createFileSystem();
const supportedNoteExtensionsText = supportedNoteExtensionsLabel();
const MOCK_FS_STORAGE_KEY = 'markluck-mockfs';
const LARGE_DOCUMENT_PREVIEW_DELAY_THRESHOLD_CHARS = 120_000;
const LARGE_DOCUMENT_PREVIEW_DELAY_THRESHOLD_LINES = 3_000;
const LARGE_DOCUMENT_DEFERRED_WORK_DELAY_MS = 1800;
const LARGE_DOCUMENT_PREVIEW_PENDING_HTML =
  '<p class="large-doc-preview-pending">正在渲染大文档预览...</p>';

interface OpenedFilePayload {
  absolutePath: string;
  notebookRoot: string;
  relativePath: string;
}

type ExternalSessionMode = 'none' | 'readonly' | 'edit-shell' | 'folder-indexed';

const files = ref<DirEntry[]>([]);
const currentContent = ref('');
const activePath = ref('');
const loading = ref(true);
const errorMessage = ref('');
const currentDir = ref('/');

// --- Theme ---
const theme = useThemeStore();
// 便捷别名：主题 ChromeState（布局 recipe 的运行时镜像）
const chrome = computed(() => theme.activeChromeState);
const isSinglePageLayout = computed(
  () => chrome.value.layoutPreset === 'single-page' && Boolean(chrome.value.drawerShell),
);
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
type ViewMode = ThemeViewMode | string;
const viewMode = ref<ViewMode>('live');
const splitRatio = ref(50); // 50:50 default for split pane
const splitPreviewHtml = ref('');
const wikiLinkRevision = ref(0);
const deferSplitEditorMount = ref(false);
let splitDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let splitEditorMountTimer: ReturnType<typeof setTimeout> | null = null;

const showRightWing = ref(true);
const showLeftDrawer = ref(false);
const searchVisible = ref(false);
const showExport = ref(false);
const showTemplate = ref(false);
const showNewFileDialog = ref(false);
const newFileName = ref('新笔记.md');
const showSettings = ref(false);
const showThemeDialog = ref(false);
const showShare = ref(false);
const isScratchSession = ref(false);
const showScratchExitDialog = ref(false);
const pendingDeletePath = ref<string | null>(null);
const toast = useToast();
const notebookName = ref('未打开笔记本');
const completionSettings = ref<CompletionSettings>(getCompletionSettings());
const completionTrainingMeta = ref<CompletionTrainingMeta>(loadTrainingMeta());
let unsubscribeCompletionSettings: (() => void) | null = null;
let unsubscribeTrainingMeta: (() => void) | null = null;
let completionTrainer: CompletionTrainingService | null = null;
let unlistenOpenedFile: (() => void) | null = null;
let unlistenWindowClose: (() => void) | null = null;
let startupOpenedFileConsumed = false;
let allowWindowClose = false;
const MAX_FILE_TREE_ENTRIES = 5000;

const externalSessionMode = ref<ExternalSessionMode>('none');
const externalFile = ref<OpenedFilePayload | null>(null);
const externalError = ref('');
const externalPreviewHtml = ref('');
const showExternalEditConfirm = ref(false);
const externalFiles = ref<DirEntry[]>([]);
const externalOpenedNotes = ref<Array<{ path: string; title: string; lastOpenedAt: number }>>([]);
const externalOpenedFileMap = ref<Record<string, OpenedFilePayload>>({});
const externalScanRootTextFiles = ref(
  localStorage.getItem('markluck:external:scanRootTextFiles') === 'true',
);
const isExternalSession = computed(() => externalSessionMode.value !== 'none');
const isExternalReadonly = computed(() => externalSessionMode.value === 'readonly');
const isExternalEditing = computed(
  () =>
    externalSessionMode.value === 'edit-shell' || externalSessionMode.value === 'folder-indexed',
);
const isExternalFolderIndexed = computed(() => externalSessionMode.value === 'folder-indexed');
const externalFilePath = computed(() => externalFile.value?.absolutePath ?? '');
const externalFileName = computed(() => {
  const path = externalFilePath.value;
  return path.split('/').pop() || path || '外部文件';
});
const externalRelativePath = computed(() =>
  externalFile.value ? normalizePath(externalFile.value.relativePath) : '',
);
const externalReadStats = computed(() => {
  const chars = editorStats.charCount;
  const lines = editorStats.lineCount;
  return `${chars} 字符 · ${lines} 行`;
});

function actionRegion(id: ShellAction['id']): ThemeActionRegion {
  const preferred = chrome.value.actionPlacements[id] ?? 'hidden';
  if (id === 'view-toggle' && preferred === 'reader-bar' && viewMode.value !== 'read') {
    return 'topbar-right';
  }
  return preferred;
}

const shellActions = computed<ShellAction[]>(() => [
  {
    id: 'new-note',
    region: actionRegion('new-note'),
    label: '新建笔记',
    shortLabel: '新建',
    title: '新建笔记',
    icon: 'new-note',
    run: onShellCreateNote,
  },
  {
    id: 'file-drawer',
    region: actionRegion('file-drawer'),
    label: '切换左侧书签栏',
    shortLabel: '文件',
    title: '打开文件抽屉',
    icon: 'file-drawer',
    run: onToggleLeftDrawer,
    active: showLeftDrawer.value,
  },
  {
    id: 'search',
    region: actionRegion('search'),
    label: '搜索 Ctrl+K',
    shortLabel: '搜索',
    title: '搜索笔记 (Ctrl+K)',
    icon: 'search',
    run: onOpenPalette,
    active: searchVisible.value,
  },
  {
    id: 'template',
    region: actionRegion('template'),
    label: '模板',
    shortLabel: '模板',
    title: '打开模板',
    icon: 'template',
    run: onShellCreateNote,
    active: showTemplate.value,
  },
  {
    id: 'export',
    region: actionRegion('export'),
    label: '导出笔记',
    shortLabel: '导出',
    title: '导出笔记',
    icon: 'export',
    run: () => {
      showExport.value = true;
    },
    active: showExport.value,
  },
  {
    id: 'share',
    region: actionRegion('share'),
    label: '分享笔记',
    shortLabel: '分享',
    title: '分享笔记',
    icon: 'share',
    run: () => {
      showShare.value = true;
    },
    active: showShare.value,
  },
  {
    id: 'theme',
    region: actionRegion('theme'),
    label: '主题',
    shortLabel: '主题',
    title: '打开主题窗口',
    icon: 'theme',
    run: () => {
      showThemeDialog.value = true;
    },
    active: showThemeDialog.value,
  },
  {
    id: 'settings',
    region: actionRegion('settings'),
    label: '设置',
    shortLabel: '设置',
    title: '打开设置',
    icon: 'settings',
    run: () => {
      showSettings.value = true;
    },
    active: showSettings.value,
  },
  {
    id: 'view-toggle',
    region: actionRegion('view-toggle'),
    label: viewMode.value === 'read' ? '进入编辑' : `当前${resolvedViewModeLabel.value}`,
    shortLabel: viewMode.value === 'read' ? '编辑' : resolvedViewModeLabel.value,
    title: `切换视图，当前为${resolvedViewModeLabel.value}`,
    icon: 'view-toggle',
    run: cycleViewMode,
    active: viewMode.value === chrome.value.defaultViewMode,
  },
]);

function actionsForRegion(region: ThemeActionRegion): ShellAction[] {
  return shellActions.value.filter((action) => action.region === region);
}

const workflowSlotProps = computed(() => ({
  activePath: shellActivePath.value,
  noteTitle: shellNoteTitle.value,
  notebookName: shellNotebookName.value,
  isDraftSession: isScratchSession.value,
  viewMode: viewMode.value,
  workspaceIntent: chrome.value.workspaceIntent,
  switchViewMode: cycleViewMode,
  saveDraftAs: saveScratchAs,
}));

const editorControlSlotProps = computed(() => ({
  region: { layout: chrome.value.editorControlLayout, density: chrome.value.toolbarDensity },
  actions: actionsForRegion('editor-control'),
  preset: activeParagraphPreset.value,
  activeAction: pendingFormatAction.value,
  format: onToolbarFormat,
}));

const editorSurfaceSlotProps = computed(() => ({
  activePath: shellActivePath.value,
  isDraftSession: isScratchSession.value,
  viewMode: viewMode.value,
  splitRatio: splitRatio.value,
  charCount: editorStats.charCount,
  wordCount: editorStats.wordCount,
  headings: headings.value,
  setViewMode: (mode: ViewMode) => {
    viewMode.value = mode;
  },
}));

const externalReaderSlotProps = computed(() => ({
  fileName: externalFileName.value,
  filePath: externalFilePath.value,
  stats: externalReadStats.value,
  headings: headings.value,
  loading: loading.value,
  error: externalError.value,
  enableEdit: () => {
    showExternalEditConfirm.value = true;
  },
  openParentAsNotebook: openExternalParentAsNotebook,
  scrollHeading: scrollExternalHeading,
}));

const themeDialogSlotProps = computed(() => ({
  visible: showThemeDialog.value,
  activeThemeId: theme.activeThemeId,
  themes: theme.themes,
  entitlements: theme.entitlements,
  commerceError: theme.commerceError,
  close: () => {
    showThemeDialog.value = false;
  },
  activateTheme: theme.activateTheme,
  refreshEntitlements: theme.refreshEntitlements,
}));

const commandPaletteSlotProps = computed(() => ({
  visible: searchVisible.value,
  close: () => {
    searchVisible.value = false;
  },
}));

const fileDrawerSlotProps = computed(() => ({
  visible: showLeftDrawer.value,
  files: shellFiles.value,
  activePath: shellActivePath.value,
  loading: loading.value,
  error: errorMessage.value,
  close: () => {
    showLeftDrawer.value = false;
  },
}));

const exportDialogSlotProps = computed(() => ({
  visible: showExport.value,
  notePath: shellActivePath.value,
  noteTitle: shellNoteTitle.value,
  close: () => {
    showExport.value = false;
  },
}));

const templateDialogSlotProps = computed(() => ({
  visible: showTemplate.value,
  activePath: shellActivePath.value,
  close: () => {
    showTemplate.value = false;
  },
}));

const settingsDialogSlotProps = computed(() => ({
  visible: showSettings.value,
  completionSettings: completionSettings.value,
  completionTrainingMeta: completionTrainingMeta.value,
  close: () => {
    showSettings.value = false;
  },
}));

const shareDialogSlotProps = computed(() => ({
  visible: showShare.value,
  noteTitle: shellNoteTitle.value,
  close: () => {
    showShare.value = false;
  },
}));

const toastSlotProps = computed(() => ({
  activeThemeId: theme.activeThemeId,
}));

const updateNotificationSlotProps = computed(() => ({
  visible: showUpdateNotification.value,
  latestVersion: updateLatestVersion.value,
  releaseUrl: updateReleaseUrl.value,
  close: () => {
    showUpdateNotification.value = false;
  },
}));

const markdownCheatSheetSlotProps = computed(() => ({
  activeThemeId: theme.activeThemeId,
}));

const newFileDialogSlotProps = computed(() => ({
  visible: showNewFileDialog.value,
  fileName: newFileName.value,
  supportedExtensions: supportedNoteExtensionsText,
  cancel: cancelNewFile,
  confirm: confirmNewFile,
}));

const deleteConfirmSlotProps = computed(() => ({
  visible: Boolean(pendingDeletePath.value),
  path: pendingDeletePath.value,
  name: pendingDeleteName.value,
  cancel: cancelDeleteFile,
  confirm: confirmDeleteFile,
}));

const externalEditDialogSlotProps = computed(() => ({
  visible: showExternalEditConfirm.value,
  cancel: () => {
    showExternalEditConfirm.value = false;
  },
  confirmEditOnly: () => confirmExternalEdit(false),
  confirmScan: confirmExternalEditAndScan,
}));

const scratchExitDialogSlotProps = computed(() => ({
  visible: showScratchExitDialog.value,
  cancel: cancelScratchExit,
  discard: discardScratchAndClose,
  save: saveScratchAndClose,
}));

function openThemeDialogSlot(slot: ThemeSlotId): void {
  if (slot === 'command-palette') searchVisible.value = true;
  else if (slot === 'file-drawer') showLeftDrawer.value = true;
  else if (slot === 'export-dialog') showExport.value = true;
  else if (slot === 'template-dialog') showTemplate.value = true;
  else if (slot === 'settings-dialog') showSettings.value = true;
  else if (slot === 'share-dialog') showShare.value = true;
  else if (slot === 'dialogs.theme') showThemeDialog.value = true;
  else if (slot === 'new-file-dialog') showNewFileDialog.value = true;
}

function closeThemeDialogSlot(slot: ThemeSlotId): void {
  if (slot === 'command-palette') searchVisible.value = false;
  else if (slot === 'file-drawer') showLeftDrawer.value = false;
  else if (slot === 'export-dialog') showExport.value = false;
  else if (slot === 'template-dialog') showTemplate.value = false;
  else if (slot === 'settings-dialog') showSettings.value = false;
  else if (slot === 'share-dialog') showShare.value = false;
  else if (slot === 'dialogs.theme') showThemeDialog.value = false;
  else if (slot === 'new-file-dialog') cancelNewFile();
  else if (slot === 'delete-confirm-dialog') cancelDeleteFile();
  else if (slot === 'external-edit-dialog') showExternalEditConfirm.value = false;
  else if (slot === 'scratch-exit-dialog') cancelScratchExit();
}

const themeHostUi = computed(() => ({
  editor: {
    getContent: () => currentContent.value,
    setContent: (content: string) => onEditorContentUpdate(content),
    focus: () => void nextTick(() => editorRef.value?.focus()),
  },
  dialogs: {
    open: openThemeDialogSlot,
    close: closeThemeDialogSlot,
  },
  toast: {
    show: (message: string) => toast.show(message, 'info', 3500),
  },
  commerce: theme.commerce,
  appState: {
    activePath: shellActivePath.value,
    noteTitle: shellNoteTitle.value,
    notebookName: notebookName.value,
    viewMode: viewMode.value,
    isScratchSession: isScratchSession.value,
    activeThemeId: theme.activeThemeId,
  },
}));

// --- Format Bubble ---
const bubbleVisible = ref(false);
const bubblePosition = ref({ x: 0, y: 0 });
const activeParagraphPreset = ref<ParagraphPreset>('paragraph');
const pendingFormatAction = ref<FormatAction | null>(null);
const editorRef = ref<InstanceType<typeof MarkdownEditor> | null>(null);

// --- View Mode ---
const viewModeLabels: Record<string, string> = {
  split: '分栏',
  live: '即时',
  read: '阅读',
};
const viewModeLabel = computed(() => viewModeLabels[viewMode.value]);
const resolvedViewModeLabel = computed(() => viewModeLabel.value ?? '阅读');

function cycleViewMode(): void {
  pendingFormatAction.value = null;
  const modes: ViewMode[] =
    chrome.value.defaultViewMode === 'read' ? ['read', 'live', 'split'] : ['split', 'live'];
  const idx = modes.indexOf(viewMode.value);
  viewMode.value = modes[(idx + 1 + modes.length) % modes.length]!;
  scheduleSplitEditorMountForCurrentMode();
  if (viewMode.value === 'split' || viewMode.value === 'read') {
    updateSplitPreview();
  }
}

function applyInitialThemeWorkflowDefaults(): void {
  pendingFormatAction.value = null;
  viewMode.value = chrome.value.defaultViewMode;
  showRightWing.value = chrome.value.rightWingPolicy !== 'collapsed';
  refreshSplitPreviewIfVisible();
}

function refreshSplitPreviewIfVisible(): void {
  if (viewMode.value === 'split' || viewMode.value === 'read') {
    updateSplitPreview();
  }
}

function scheduleSplitEditorMountForCurrentMode(): void {
  if (splitEditorMountTimer) {
    clearTimeout(splitEditorMountTimer);
    splitEditorMountTimer = null;
  }
  if (viewMode.value === 'split' && isLargeDocument.value) {
    deferSplitEditorMount.value = true;
    splitEditorMountTimer = setTimeout(() => {
      deferSplitEditorMount.value = false;
      splitEditorMountTimer = null;
    }, LARGE_DOCUMENT_DEFERRED_WORK_DELAY_MS);
    return;
  }
  deferSplitEditorMount.value = false;
}

// --- Split Pane ---
function onSplitContentUpdate(content: string): void {
  currentContent.value = content;
  updateHeadings(content);
  updateEditorStats(content);
  if (isScratchSession.value) {
    isDirty.value = content.trim().length > 0;
    saveError.value = null;
  } else if (activePath.value) {
    isDirty.value = true;
    saveError.value = null;
    rememberPendingMockFileWrite(activePath.value, content);
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
let currentSavePromise: Promise<void> | null = null;
let noteSelectionQueue: Promise<void> = Promise.resolve();
let noteSelectionVersion = 0;
const pendingMockFileWrites = new Map<string, string>();

// --- Editor Stats ---
const editorStats = reactive({
  charCount: 0,
  wordCount: 0,
  lineCount: 0,
  cursorLine: null as number | null,
  cursorCol: null as number | null,
});
const isLargeDocument = computed(
  () =>
    currentContent.value.length > LARGE_DOCUMENT_PREVIEW_DELAY_THRESHOLD_CHARS ||
    editorStats.lineCount > LARGE_DOCUMENT_PREVIEW_DELAY_THRESHOLD_LINES,
);

// --- Computed ---
const noteTitle = computed(() => {
  if (!activePath.value) return '';
  return stripSupportedNoteExtension(activePath.value.split('/').pop() ?? '');
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
const shellActivePath = computed(() =>
  isExternalEditing.value ? externalRelativePath.value : activePath.value,
);
const shellNoteTitle = computed(() => {
  if (isScratchSession.value) return '临时草稿';
  if (isExternalSession.value) return stripSupportedNoteExtension(externalFileName.value);
  return noteTitle.value;
});
const shellNotebookName = computed(() => {
  if (isScratchSession.value) return '临时草稿';
  if (!isExternalSession.value) return notebookName.value;
  const root = externalFile.value?.notebookRoot;
  return root ? `外部文件 · ${displayNameFromPath(root)}` : '外部文件';
});
const shellFiles = computed(() => (isExternalEditing.value ? externalFiles.value : files.value));
const shellBacklinks = computed((): BacklinkEntry[] =>
  isExternalFolderIndexed.value && externalRelativePath.value
    ? indexStore.getBacklinks(externalRelativePath.value)
    : currentBacklinks.value,
);
const shellTags = computed(() => (isExternalFolderIndexed.value ? allTags.value : []));

// Recent notes with auto-assigned bookmark colors
const recentNotesWithColors = computed(() =>
  indexStore.recentNotes.map((n, i) => ({
    path: n.path,
    title: n.title,
    colorIndex: Math.abs(hashString(n.path)) % 8,
    _i: i,
  })),
);
const externalRecentNotesWithColors = computed(() =>
  externalOpenedNotes.value.map((n, i) => ({
    path: n.path,
    title: n.title,
    colorIndex: Math.abs(hashString(n.path)) % 8,
    _i: i,
  })),
);
const shellRecentNotesWithColors = computed(() =>
  isExternalEditing.value ? externalRecentNotesWithColors.value : recentNotesWithColors.value,
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
function displayNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.split('/').pop() || normalized || 'Notebook';
}

function normalizeOsPath(path: string): string {
  const normalized = (path || '').replace(/\\/g, '/');
  if (/^[A-Za-z]:\/$/.test(normalized)) return normalized;
  if (normalized === '/') return '/';
  return normalized.replace(/\/+$/, '');
}

function normalizeOpenedFilePayload(payload: unknown): OpenedFilePayload | null {
  if (!payload) return null;

  if (typeof payload === 'string') {
    const absolutePath = normalizeOsPath(payload);
    const slash = absolutePath.lastIndexOf('/');
    if (slash < 0) return null;
    return {
      absolutePath,
      notebookRoot: normalizeOsPath(absolutePath.slice(0, slash + 1) || '/'),
      relativePath: `/${absolutePath.slice(slash + 1)}`,
    };
  }

  if (typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const absolutePath = String(record.absolutePath ?? record.absolute_path ?? '');
  if (!absolutePath) return null;
  const fallback = normalizeOpenedFilePayload(absolutePath);
  const notebookRoot = String(
    record.notebookRoot ?? record.notebook_root ?? fallback?.notebookRoot,
  );
  const relativePath = String(
    record.relativePath ?? record.relative_path ?? fallback?.relativePath,
  );
  if (!notebookRoot || !relativePath) return null;

  return {
    absolutePath: normalizeOsPath(absolutePath),
    notebookRoot: normalizeOsPath(notebookRoot),
    relativePath: normalizePath(relativePath),
  };
}

async function getPendingOpenedFile(): Promise<OpenedFilePayload | null> {
  if (startupOpenedFileConsumed) return null;
  const mockOpenedFile = normalizeOpenedFilePayload(peekMarkluckE2EBridge()?.mockOpenedFile);
  if (mockOpenedFile) {
    startupOpenedFileConsumed = true;
    return mockOpenedFile;
  }
  if (!isDesktopRuntime()) return null;
  try {
    const openedFile = normalizeOpenedFilePayload(
      await invoke<OpenedFilePayload | string | null>('get_opened_file'),
    );
    if (openedFile) startupOpenedFileConsumed = true;
    return openedFile;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[NotebookHome] get_opened_file 失败', e);
    return null;
  }
}

async function openNotebookRoot(rootPath: string): Promise<void> {
  isScratchSession.value = false;
  const handle = await fs.openNotebookAt(rootPath);
  notebookName.value = handle.name || displayNameFromPath(handle.rootPath);
}

async function openInitialNotebook(): Promise<boolean> {
  let recent: string[] = [];
  try {
    recent = await fs.getRecentNotebooks();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[NotebookHome] 获取最近笔记本失败:', e);
  }

  for (const root of recent) {
    try {
      await openNotebookRoot(root);
      return true;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[NotebookHome] 最近笔记本不可用，尝试下一个:', root, e);
    }
  }

  if (!isDesktopRuntime()) {
    try {
      await openNotebookRoot('/');
      return true;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[NotebookHome] Web 默认 MockFS 笔记本不可用:', e);
    }
  }

  return false;
}

function enterNotebookFileState(path: string, content: string): void {
  isScratchSession.value = false;
  externalSessionMode.value = 'none';
  externalFile.value = null;
  externalError.value = '';
  activePath.value = path;
  currentContent.value = content;
  isDirty.value = false;
  isSaving.value = false;
  saveError.value = null;
  lastSavedAt.value = Date.now();
  updateHeadings(content);
  updateEditorStats(content);
  scheduleSplitEditorMountForCurrentMode();
  refreshSplitPreviewIfVisible();
}

function enterScratchSession(): void {
  isScratchSession.value = true;
  externalSessionMode.value = 'none';
  externalFile.value = null;
  externalError.value = '';
  activePath.value = '';
  currentContent.value = '';
  files.value = [];
  currentDir.value = '/';
  notebookName.value = '临时草稿';
  errorMessage.value = '';
  isDirty.value = false;
  isSaving.value = false;
  saveError.value = null;
  lastSavedAt.value = null;
  showLeftDrawer.value = false;
  showRightWing.value = true;
  updateHeadings('');
  updateEditorStats('');
  refreshSplitPreviewIfVisible();
}

async function readExternalMarkdownFile(absolutePath: string): Promise<string> {
  if (isDesktopRuntime()) {
    return invoke<string>('read_external_markdown_file', { absolutePath });
  }
  const filesByPath = peekMarkluckE2EBridge()?.externalFiles ?? {};
  if (Object.prototype.hasOwnProperty.call(filesByPath, absolutePath)) {
    return filesByPath[absolutePath] ?? '';
  }
  throw new Error(`测试外部文件不存在: ${absolutePath}`);
}

async function readExternalNoteFile(absolutePath: string): Promise<string> {
  if (isDesktopRuntime()) {
    return invoke<string>('read_external_note_file', { absolutePath });
  }
  const filesByPath = peekMarkluckE2EBridge()?.externalFiles ?? {};
  if (Object.prototype.hasOwnProperty.call(filesByPath, absolutePath)) {
    return filesByPath[absolutePath] ?? '';
  }
  throw new Error(`测试外部文件不存在: ${absolutePath}`);
}

async function writeExternalNoteFile(absolutePath: string, content: string): Promise<void> {
  if (isDesktopRuntime()) {
    await invoke('write_external_note_file', { absolutePath, content });
    return;
  }
  const e2eBridge = getMarkluckE2EBridge();
  if (!e2eBridge) throw new Error('Web external file writes are available only in E2E mode');
  e2eBridge.externalFiles = e2eBridge.externalFiles ?? {};
  e2eBridge.externalFiles[absolutePath] = content;
  e2eBridge.externalWrites = e2eBridge.externalWrites ?? [];
  e2eBridge.externalWrites.push({ absolutePath, content, time: Date.now() });
}

function ensureMarkdownExtension(path: string): string {
  return /\.[^\\/]+$/.test(path) ? path : `${path}.md`;
}

function splitAbsoluteFilePath(path: string): { root: string; relativePath: string } {
  const normalized = normalizeOsPath(path);
  const slash = normalized.lastIndexOf('/');
  if (slash < 0) return { root: '/', relativePath: `/${normalized}` };
  const root = normalizeOsPath(normalized.slice(0, slash) || '/');
  return { root, relativePath: `/${normalized.slice(slash + 1)}` };
}

function downloadScratchAsMarkdown(fileName: string): void {
  const blob = new Blob([currentContent.value], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast.show('Web 预览已下载草稿；当前仍停留在临时草稿。', 'info', 3500);
}

async function enterNotebookFromSavedScratch(absolutePath: string): Promise<void> {
  const { root, relativePath } = splitAbsoluteFilePath(absolutePath);
  isScratchSession.value = false;
  activePath.value = '';
  await openNotebookRoot(root);
  await loadDirectory('/');
  await indexStore.initialize(fs, true);
  wikiLinkRevision.value++;
  await onSelectNote(relativePath);
}

async function saveScratchAs(): Promise<boolean> {
  if (!isScratchSession.value) return false;
  const defaultFileName = getDraftMarkdownFileName(currentContent.value);

  if (!isDesktopRuntime()) {
    downloadScratchAsMarkdown(defaultFileName);
    isDirty.value = false;
    return true;
  }

  const selected = await saveDialog({
    title: '保存临时草稿',
    defaultPath: defaultFileName,
    filters: [
      {
        name: 'Markdown',
        extensions: ['md', 'markdown', 'mdx', 'txt'],
      },
    ],
  });
  if (!selected) return false;

  const absolutePath = ensureMarkdownExtension(String(selected));
  await writeExternalNoteFile(absolutePath, currentContent.value);
  await enterNotebookFromSavedScratch(absolutePath);
  toast.show('草稿已保存为笔记。', 'success', 2500);
  return true;
}

function externalAbsoluteFromRelative(relativePath: string): string {
  const root = externalFile.value?.notebookRoot;
  if (!root) throw new Error('外部文件根目录不可用');
  const rel = normalizePath(relativePath).replace(/^\/+/, '');
  return `${normalizeOsPath(root).replace(/\/+$/, '')}/${rel}`;
}

function openedFileFromRelative(relativePath: string): OpenedFilePayload {
  const root = externalFile.value?.notebookRoot;
  if (!root) throw new Error('外部文件根目录不可用');
  const normalizedRelativePath = normalizePath(relativePath);
  return {
    absolutePath: externalAbsoluteFromRelative(normalizedRelativePath),
    notebookRoot: normalizeOsPath(root),
    relativePath: normalizedRelativePath,
  };
}

function rememberExternalOpenedFile(openedFile: OpenedFilePayload): void {
  const path = normalizePath(openedFile.relativePath);
  externalOpenedFileMap.value = {
    ...externalOpenedFileMap.value,
    [path]: openedFile,
  };
  externalOpenedNotes.value = [
    {
      path,
      title: stripSupportedNoteExtension(path.split('/').pop() ?? path),
      lastOpenedAt: Date.now(),
    },
    ...externalOpenedNotes.value.filter((note) => normalizePath(note.path) !== path),
  ].slice(0, 20);
}

async function listExternalNoteDirectory(relativePath = '/'): Promise<DirEntry[]> {
  const rootPath = externalFile.value?.notebookRoot;
  if (!rootPath) return [];
  if (isDesktopRuntime()) {
    const entries = await invoke<
      Array<{ name: string; path: string; is_dir: boolean; size: number; modified_at: number }>
    >('list_external_note_directory', {
      rootPath,
      relativePath,
    });
    return entries.map((entry) => ({
      name: entry.name,
      path: entry.path,
      isDirectory: entry.is_dir,
      isFile: !entry.is_dir,
      size: entry.size,
      mtime: entry.modified_at * 1000,
    }));
  }

  const filesByPath = peekMarkluckE2EBridge()?.externalFiles ?? {};
  const normalizedRoot = normalizeOsPath(rootPath).replace(/\/+$/, '');
  const normalizedDir = normalizePath(relativePath);
  const dirPrefix = normalizedDir === '/' ? '/' : `${normalizedDir}/`;
  const entryMap = new Map<string, DirEntry>();

  for (const absolutePath of Object.keys(filesByPath)) {
    const normalized = normalizeOsPath(absolutePath);
    if (!normalized.startsWith(`${normalizedRoot}/`)) continue;
    const rel = `/${normalized.slice(normalizedRoot.length + 1)}`;
    if (!rel.startsWith(dirPrefix)) continue;
    const rest = rel.slice(dirPrefix.length);
    if (!rest) continue;
    const [first] = rest.split('/');
    if (!first) continue;
    const entryPath = normalizedDir === '/' ? `/${first}` : `${normalizedDir}/${first}`;
    const isDirectory = rest.includes('/');
    if (!isDirectory && !isSupportedNoteFile(first)) continue;
    entryMap.set(entryPath, {
      name: first,
      path: entryPath,
      isDirectory,
      isFile: !isDirectory,
      size: isDirectory ? 0 : (filesByPath[absolutePath]?.length ?? 0),
      mtime: Date.now(),
    });
  }

  return [...entryMap.values()].sort(
    (a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name),
  );
}

function syncCurrentContentFromEditor(): void {
  const view = editorRef.value?.getEditorView();
  if (!view) return;
  const content = view.state.doc.toString();
  if (content === currentContent.value) return;

  currentContent.value = content;
  updateHeadings(content);
  updateEditorStats(content);
  scheduleSplitEditorMountForCurrentMode();
  refreshSplitPreviewIfVisible();
  if (isScratchSession.value) {
    isDirty.value = content.trim().length > 0;
  } else if (activePath.value || isExternalEditing.value) {
    isDirty.value = true;
  }
}

function encodeContentSize(content: string): number {
  return new TextEncoder().encode(content).length;
}

function parentDirFromPath(path: string): string {
  const normalized = normalizePath(path);
  const slash = normalized.lastIndexOf('/');
  return slash > 0 ? normalized.slice(0, slash) : '/';
}

function basenameFromPath(path: string): string {
  return normalizePath(path).split('/').pop() ?? '';
}

function writeMockFileToStorage(path: string, content: string): void {
  if (isDesktopRuntime() || !shouldPersistMockFs()) return;
  const raw = localStorage.getItem(MOCK_FS_STORAGE_KEY);
  if (!raw) return;

  try {
    const data = JSON.parse(raw) as {
      files?: Record<string, { content: string; mtime: number; size: number }>;
      dirs?: Record<string, string[]>;
      version?: number;
    };
    if (!data.files || !data.dirs) return;
    const normalized = normalizePath(path);
    const now = Date.now();
    data.files[normalized] = {
      content,
      mtime: now,
      size: encodeContentSize(content),
    };

    const parent = parentDirFromPath(normalized);
    const name = basenameFromPath(normalized);
    data.dirs[parent] = data.dirs[parent] ?? [];
    if (name && !data.dirs[parent].includes(name)) data.dirs[parent].push(name);
    localStorage.setItem(MOCK_FS_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // MockFSService will recover corrupted storage on next startup.
  }
}

function rememberPendingMockFileWrite(path: string, content: string): void {
  if (
    isDesktopRuntime() ||
    !shouldPersistMockFs() ||
    isExternalEditing.value ||
    isScratchSession.value
  )
    return;
  pendingMockFileWrites.set(normalizePath(path), content);
}

function flushPendingMockFileWritesSync(): void {
  if (isDesktopRuntime() || !shouldPersistMockFs()) return;
  syncCurrentContentFromEditor();
  if (!isExternalEditing.value && !isScratchSession.value && activePath.value) {
    pendingMockFileWrites.set(normalizePath(activePath.value), currentContent.value);
  }
  for (const [path, content] of pendingMockFileWrites) {
    writeMockFileToStorage(path, content);
  }
}

async function flushPendingCurrentSave(): Promise<void> {
  syncCurrentContentFromEditor();
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!isDirty.value) {
    if (currentSavePromise) await currentSavePromise;
    return;
  }
  if (isExternalEditing.value && externalFile.value) {
    await debouncedExternalSave(currentContent.value);
  } else if (activePath.value) {
    await debouncedSave(activePath.value, currentContent.value);
  } else if (currentSavePromise) {
    await currentSavePromise;
  }
}

async function enterExternalFileSession(
  openedFile: OpenedFilePayload,
  options: { setLoading?: boolean } = {},
): Promise<void> {
  await flushPendingCurrentSave();

  isScratchSession.value = false;
  const shouldSetLoading = options.setLoading ?? true;
  if (shouldSetLoading) loading.value = true;
  externalError.value = '';
  errorMessage.value = '';
  window.dispatchEvent(new CustomEvent('markluck:external-file-opened'));
  showExternalEditConfirm.value = false;
  searchVisible.value = false;
  showLeftDrawer.value = false;
  showRightWing.value = true;
  showTemplate.value = false;
  showExport.value = false;
  showShare.value = false;
  activePath.value = '';
  files.value = [];
  externalFiles.value = [];
  externalOpenedNotes.value = [];
  externalOpenedFileMap.value = {};
  notebookName.value = '外部文件';

  try {
    const content = await readExternalMarkdownFile(openedFile.absolutePath);
    externalFile.value = openedFile;
    externalSessionMode.value = 'readonly';
    currentContent.value = content;
    rememberExternalOpenedFile(openedFile);
    isDirty.value = false;
    isSaving.value = false;
    saveError.value = null;
    lastSavedAt.value = null;
    updateHeadings(content);
    updateEditorStats(content);
    scheduleSplitEditorMountForCurrentMode();
    updateExternalPreview();
  } catch (e) {
    externalFile.value = openedFile;
    externalSessionMode.value = 'readonly';
    currentContent.value = '';
    externalError.value = `${openedFile.absolutePath}\n${e instanceof Error ? e.message : String(e)}`;
    updateHeadings('');
    updateEditorStats('');
    externalPreviewHtml.value = '';
  } finally {
    if (shouldSetLoading) loading.value = false;
  }
}

async function handleOpenedFile(
  payload: unknown,
  options: { setLoading?: boolean } = {},
): Promise<void> {
  const openedFile = normalizeOpenedFilePayload(payload);
  if (!openedFile) return;
  await enterExternalFileSession(openedFile, options);
}

async function initNotebook(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  let pendingOpenedFile: OpenedFilePayload | null = null;
  let notebookReady = false;
  try {
    pendingOpenedFile = await getPendingOpenedFile();
    if (pendingOpenedFile) {
      await enterExternalFileSession(pendingOpenedFile, { setLoading: false });
      notebookReady = false;
      return;
    } else {
      notebookReady = await openInitialNotebook();
      if (!notebookReady) {
        enterScratchSession();
        return;
      }
    }
    await loadDirectory('/');
  } catch (e) {
    errorMessage.value = String(e);
    notebookName.value = '未打开笔记本';
    enterScratchSession();
  } finally {
    loading.value = false;
  }
  if (!notebookReady) return;
  try {
    await indexStore.initialize(fs, true);
    wikiLinkRevision.value++;
    refreshSplitPreviewIfVisible();
    if (pendingOpenedFile) {
      await onSelectNote(pendingOpenedFile.relativePath);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[NotebookHome] indexStore.initialize 失败', e);
  }
}

function normalizePath(path: string): string {
  const normalized = (path || '').replace(/\\/g, '/');
  if (normalized === '/') return '/';
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function normalizeDir(dir: string): string {
  const normalized = normalizePath(dir);
  return normalized === '' ? '/' : normalized;
}

function joinPath(dir: string, name: string): string {
  const base = normalizeDir(dir);
  return base === '/' ? `/${name}` : `${base}/${name}`;
}

function clearActiveNoteState(): void {
  activePath.value = '';
  currentContent.value = '';
  isDirty.value = false;
  isSaving.value = false;
  saveError.value = null;
  loading.value = false;
  updateHeadings('');
  updateEditorStats('');
  refreshSplitPreviewIfVisible();
}

async function listDirectoryRecursive(
  dir: string,
  counter: { count: number } = { count: 0 },
): Promise<DirEntry[]> {
  const normalized = normalizeDir(dir);
  const entries = await fs.listDirectory(normalized);
  counter.count += entries.length;
  if (counter.count > MAX_FILE_TREE_ENTRIES) {
    throw new Error(`当前文件夹条目超过 ${MAX_FILE_TREE_ENTRIES}，请打开更精确的笔记本文件夹。`);
  }
  const result = [...entries];
  for (const entry of entries) {
    if (entry.isDirectory) {
      result.push(...(await listDirectoryRecursive(entry.path, counter)));
    }
  }
  return result;
}

async function refreshFileTree(): Promise<void> {
  files.value = await listDirectoryRecursive('/');
  const existingPaths = files.value
    .filter((entry) => entry.isFile && isSupportedNoteFile(entry.name))
    .map((entry) => normalizePath(entry.path));
  indexStore.synchronizeFromFileTree(existingPaths);
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
  const selectionVersion = ++noteSelectionVersion;
  const task = noteSelectionQueue
    .catch(() => undefined)
    .then(() => {
      if (selectionVersion !== noteSelectionVersion) return;
      return selectNoteNow(path, selectionVersion);
    });
  noteSelectionQueue = task.catch(() => undefined);
  await task;
}

async function selectNoteNow(path: string, selectionVersion: number): Promise<void> {
  // Flush any pending save before switching notes
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  syncCurrentContentFromEditor();
  // 防御性刷新：即使 saveTimer 已触发但 debouncedSave 尚未完成，
  // 只要 isDirty 为 true 就执行保存，确保内容不丢失
  if (isDirty.value && activePath.value) {
    await debouncedSave(activePath.value, currentContent.value);
  } else if (currentSavePromise) {
    await currentSavePromise;
  }

  if (selectionVersion !== noteSelectionVersion) return;

  if (!path) {
    clearActiveNoteState();
    return;
  }

  try {
    const stat = await fs.statFile(path);
    if (selectionVersion !== noteSelectionVersion) return;
    if (stat.isDirectory) {
      await loadDirectory(path);
      return;
    }
  } catch {
    // statFile 失败意味着路径不是文件（可能是目录或不存在），继续尝试作为文件打开
    /* open as file */
  }

  const fileName = path.split('/').pop() ?? path;
  if (!isSupportedNoteFile(fileName)) {
    toast.show(`仅支持 ${supportedNoteExtensionsText} 文件`, 'warning', 3000);
    return;
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
    if (selectionVersion !== noteSelectionVersion) return;
  } catch (e) {
    if (selectionVersion !== noteSelectionVersion) return;
    errorMessage.value = String(e);
    const normalizedTarget = normalizePath(path);
    const normalizedActive = normalizePath(activePath.value);
    if (normalizedActive && normalizedActive === normalizedTarget) {
      clearActiveNoteState();
    }
    indexStore.removeDocument(path);
    await refreshFileTree();
    loading.value = false;
    return;
  }

  // Now set reactive state — editor mounts with content already available
  isScratchSession.value = false;
  activePath.value = path;
  currentContent.value = content;

  const dir = path.substring(0, path.lastIndexOf('/') + 1) || '/';
  currentDir.value = normalizeDir(dir);
  void refreshFileTree();

  updateHeadings(content);
  updateEditorStats(content);
  refreshSplitPreviewIfVisible();
  try {
    await indexStore.refreshDocument(fs, path);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[NotebookHome] indexStore.refreshDocument 失败', e);
  }
  showLeftDrawer.value = false; // 选择笔记后关闭文件抽屉，避免 overlay 遮挡
  loading.value = false;
}

async function onSelectExternalNote(path: string): Promise<void> {
  const normalizedPath = normalizePath(path);
  const entry = externalFiles.value.find((item) => normalizePath(item.path) === normalizedPath);

  if (entry?.isDirectory) {
    await ensureExternalDirectoryListed(normalizedPath);
    return;
  }

  const fileName = normalizedPath.split('/').pop() ?? normalizedPath;
  if (!isSupportedNoteFile(fileName)) {
    toast.show(`外部编辑仅支持 ${supportedNoteExtensionsText} 文件`, 'warning', 3000);
    return;
  }

  await flushPendingCurrentSave();
  loading.value = true;
  errorMessage.value = '';
  saveError.value = null;
  isSaving.value = false;

  try {
    const openedFile =
      externalOpenedFileMap.value[normalizedPath] ?? openedFileFromRelative(normalizedPath);
    const content = await readExternalNoteFile(openedFile.absolutePath);
    externalFile.value = openedFile;
    currentContent.value = content;
    rememberExternalOpenedFile(openedFile);
    isDirty.value = false;
    lastSavedAt.value = null;
    updateHeadings(content);
    updateEditorStats(content);
    refreshSplitPreviewIfVisible();
    if (isExternalFolderIndexed.value) {
      await indexStore.refreshDocument(createExternalFolderFileSystem(), normalizedPath);
      wikiLinkRevision.value++;
    }
    showLeftDrawer.value = false;
    void nextTick(() => editorRef.value?.focus());
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e);
    toast.show(`打开外部文件失败：${saveError.value}`, 'error', 4000);
  } finally {
    loading.value = false;
  }
}

async function onShellSelectNote(path: string): Promise<void> {
  if (isExternalEditing.value) {
    await onSelectExternalNote(path);
    return;
  }
  await onSelectNote(path);
}

async function onToggleLeftDrawer(): Promise<void> {
  showLeftDrawer.value = !showLeftDrawer.value;
  if (showLeftDrawer.value && isExternalEditing.value) {
    await ensureExternalDirectoryListed(currentDir.value || '/');
  }
}

function onOpenPalette(): void {
  if (isExternalEditing.value && !isExternalFolderIndexed.value) {
    toast.show('单文件编辑未扫描所在文件夹，搜索和标签不会读取其他文件。', 'info', 3500);
    return;
  }
  searchVisible.value = true;
}

function onShellCreateNote(): void {
  if (isExternalEditing.value) {
    toast.show(
      '外部单文件编辑不新建笔记；需要管理文件夹时请打开所在文件夹为笔记本。',
      'info',
      4000,
    );
    return;
  }
  showTemplate.value = true;
}

async function onShellDrawerNavigateDir(path: string): Promise<void> {
  if (isExternalEditing.value) {
    await ensureExternalDirectoryListed(path);
    return;
  }
  onDrawerNavigateDir(path);
}

async function onShellCreateFile(): Promise<void> {
  if (isExternalEditing.value) {
    toast.show(
      '外部单文件编辑不创建新文件；需要完整文件管理时请打开所在文件夹为笔记本。',
      'info',
      4000,
    );
    return;
  }
  await onCreateFile();
}

async function onShellDrawerRetry(): Promise<void> {
  if (isExternalEditing.value) {
    await ensureExternalDirectoryListed(currentDir.value || '/');
    return;
  }
  await initNotebook();
}

function requestShellDeleteFile(path: string): void {
  if (isExternalEditing.value) {
    toast.show('外部单文件编辑不删除文件。', 'warning', 3000);
    return;
  }
  requestDeleteFile(path);
}

async function onShellRenameFile(oldPath: string, newName: string): Promise<void> {
  if (isExternalEditing.value) {
    toast.show('外部单文件编辑不重命名文件。', 'warning', 3000);
    return;
  }
  await onRenameFile(oldPath, newName);
}

async function onDeleteFile(path: string): Promise<void> {
  await fs.deleteFile(path);
  if (normalizePath(activePath.value) === normalizePath(path)) {
    clearActiveNoteState();
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
  if (!isSupportedNoteFile(newName)) {
    toast.show(`仅支持 ${supportedNoteExtensionsText} 文件`, 'warning', 3000);
    return;
  }
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
  if (!isSupportedNoteFile(name)) {
    toast.show(`仅支持 ${supportedNoteExtensionsText} 文件`, 'warning', 3000);
    return;
  }
  showNewFileDialog.value = false;
  const path = joinPath(currentDir.value, name);
  const content = isMarkdownLikeFile(name) ? `# ${stripSupportedNoteExtension(name)}\n\n` : '';
  await fs.writeFile(path, content);
  await refreshFileTree();
  await indexStore.refreshDocument(fs, path);
  void trainCurrentFile(path, content);
  enterNotebookFileState(path, content);
}

function cancelNewFile(): void {
  showNewFileDialog.value = false;
}

// --- Preview Render ---
let previewRenderTimer: ReturnType<typeof setTimeout> | null = null;

function wikiLinkExists(noteTitle: string): boolean {
  const target = noteTitle.trim();
  if (!target) return false;
  const tree = isExternalEditing.value ? externalFiles.value : files.value;
  const existsInTree = tree.some((entry) => {
    if (!entry.isFile) return false;
    const filename = stripSupportedNoteExtension(entry.name);
    return filename === target;
  });
  if (existsInTree) return true;
  const docs = Object.values(indexStore.getIndexService()?.getAllDocuments() ?? {});
  return docs.some((doc) => {
    const filename = stripSupportedNoteExtension(doc.path.split('/').pop() ?? '');
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
  const content = currentContent.value;
  const lineCount = content ? content.split('\n').length : 0;
  const renderDelay =
    content.length > LARGE_DOCUMENT_PREVIEW_DELAY_THRESHOLD_CHARS ||
    lineCount > LARGE_DOCUMENT_PREVIEW_DELAY_THRESHOLD_LINES
      ? LARGE_DOCUMENT_DEFERRED_WORK_DELAY_MS
      : 50;
  if (renderDelay > 50) {
    splitPreviewHtml.value = LARGE_DOCUMENT_PREVIEW_PENDING_HTML;
  }
  previewRenderTimer = setTimeout(() => {
    try {
      splitPreviewHtml.value = renderMarkdown(content, { wikiLinkExists });
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
  }, renderDelay);
}

function updateExternalPreview(): void {
  try {
    externalPreviewHtml.value = renderMarkdown(currentContent.value);
    void nextTick(() => {
      const previewEl = document.querySelector<HTMLElement>('.external-preview');
      if (previewEl) highlightCodeBlocks(previewEl);
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[NotebookHome] 外部文件渲染失败:', e);
    externalPreviewHtml.value = '<p class="render-error">渲染失败</p>';
  }
}

async function ensureExternalDirectoryListed(relativePath = '/'): Promise<void> {
  if (!isExternalSession.value) return;
  loading.value = true;
  errorMessage.value = '';
  const normalizedDir = normalizeDir(relativePath);
  try {
    const entries = await listExternalNoteDirectory(normalizedDir);
    if (normalizedDir === '/') {
      externalFiles.value = entries;
    } else {
      const merged = new Map<string, DirEntry>();
      for (const entry of externalFiles.value) merged.set(normalizePath(entry.path), entry);
      for (const entry of entries) merged.set(normalizePath(entry.path), entry);
      externalFiles.value = [...merged.values()];
    }
    currentDir.value = normalizedDir;
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

function createExternalFolderFileSystem(): IFileSystemService {
  return {
    async readFile(path: string) {
      return readExternalNoteFile(externalAbsoluteFromRelative(path));
    },
    async writeFile(path: string, content: string) {
      await writeExternalNoteFile(externalAbsoluteFromRelative(path), content);
    },
    async writeBinary() {
      throw new Error('外部单文件会话不支持写入二进制资产');
    },
    async readBinary() {
      throw new Error('外部单文件会话不支持读取二进制资产');
    },
    isBinaryPath() {
      return false;
    },
    async deleteFile() {
      throw new Error('外部单文件会话不支持删除文件');
    },
    async renameFile() {
      throw new Error('外部单文件会话不支持重命名文件');
    },
    async createDirectory() {
      throw new Error('外部单文件会话不支持创建目录');
    },
    async listDirectory(path: string) {
      return listExternalNoteDirectory(path);
    },
    async statFile(path: string) {
      const entry = externalFiles.value.find(
        (item) => normalizePath(item.path) === normalizePath(path),
      );
      return {
        size: entry?.size ?? 0,
        mtime: entry?.mtime ?? Date.now(),
        isDirectory: entry?.isDirectory ?? false,
        isFile: entry?.isFile ?? true,
        path,
      };
    },
    async watch() {
      return () => undefined;
    },
    async unwatchAll() {
      /* no watcher for external single-file shell */
    },
    resolvePath(root: string, ...segments: string[]) {
      return [root, ...segments].join('/').replace(/\/+/g, '/');
    },
    async isPathInNotebook() {
      return true;
    },
    async openNotebook() {
      throw new Error('外部单文件会话不打开笔记本');
    },
    async openNotebookAt() {
      throw new Error('外部单文件会话不打开笔记本');
    },
    async getRecentNotebooks() {
      return [];
    },
  };
}

async function buildExternalFolderIndex(): Promise<void> {
  if (!externalFile.value) return;
  loading.value = true;
  try {
    await ensureExternalDirectoryListed('/');
    await indexStore.initialize(createExternalFolderFileSystem(), true, { populateRecent: false });
    wikiLinkRevision.value++;
    toast.show('已扫描所在文件夹；左侧仅显示你实际打开过的文件', 'success', 3000);
  } catch (e) {
    toast.show(`扫描失败：${e instanceof Error ? e.message : String(e)}`, 'error', 4000);
  } finally {
    loading.value = false;
  }
}

function confirmExternalEdit(scanRoot = false): void {
  if (!externalFile.value || externalError.value) return;
  showExternalEditConfirm.value = false;
  externalSessionMode.value = scanRoot ? 'folder-indexed' : 'edit-shell';
  showRightWing.value = true;
  saveError.value = null;
  void ensureExternalDirectoryListed('/');
  void nextTick(() => editorRef.value?.focus());
}

async function confirmExternalEditAndScan(): Promise<void> {
  externalScanRootTextFiles.value = true;
  localStorage.setItem('markluck:external:scanRootTextFiles', 'true');
  confirmExternalEdit(true);
  await buildExternalFolderIndex();
}

async function openExternalParentAsNotebook(): Promise<void> {
  if (!externalFile.value) return;
  const target = externalFile.value;
  await flushPendingCurrentSave();
  externalSessionMode.value = 'none';
  externalFile.value = null;
  externalError.value = '';
  externalFiles.value = [];
  externalOpenedNotes.value = [];
  externalOpenedFileMap.value = {};
  await openNotebookRoot(target.notebookRoot);
  await loadDirectory('/');
  await indexStore.initialize(fs, true);
  wikiLinkRevision.value++;
  await onSelectNote(target.relativePath);
}

function scrollExternalHeading(id: string): void {
  const target = document.getElementById(id);
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// --- Content Updates ---
function onContentUpdate(content: string): void {
  currentContent.value = content;
  updateHeadings(content);
  updateEditorStats(content);
  if (isScratchSession.value) {
    isDirty.value = content.trim().length > 0;
    saveError.value = null;
    refreshSplitPreviewIfVisible();
    return;
  }
  if (activePath.value) {
    isDirty.value = true;
    saveError.value = null;
    rememberPendingMockFileWrite(activePath.value, content);
    if (saveTimer) clearTimeout(saveTimer);
    const savingPath = activePath.value;
    saveTimer = setTimeout(() => debouncedSave(savingPath, content), 600);
  }
}

function onExternalContentUpdate(content: string): void {
  currentContent.value = content;
  updateHeadings(content);
  updateEditorStats(content);
  if (externalFile.value) {
    isDirty.value = true;
    saveError.value = null;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => debouncedExternalSave(content), 600);
  }
}

function onEditorContentUpdate(content: string): void {
  if (isExternalEditing.value) {
    onExternalContentUpdate(content);
    if (viewMode.value === 'split') {
      if (splitDebounceTimer) clearTimeout(splitDebounceTimer);
      splitDebounceTimer = setTimeout(() => updateSplitPreview(), 300);
    }
    return;
  }

  if (viewMode.value === 'split') {
    onSplitContentUpdate(content);
    return;
  }

  onContentUpdate(content);
}

function updateEditorStats(content: string): void {
  editorStats.charCount = content.length;
  editorStats.wordCount = content ? content.split(/\s+/).filter(Boolean).length : 0;
  editorStats.lineCount = content ? content.split('\n').length : 0;
}

async function debouncedSave(path: string, content: string): Promise<void> {
  const saveTask = (async () => {
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
      pendingMockFileWrites.delete(normalizePath(path));
      const elapsed = Date.now() - start;
      if (elapsed < 500) await new Promise((r) => setTimeout(r, 500 - elapsed));
      if (gen !== saveGeneration) return;
      isDirty.value = false;
    } catch (e) {
      saveError.value = String(e);
    } finally {
      if (gen === saveGeneration) isSaving.value = false;
    }
  })();
  currentSavePromise = saveTask;
  try {
    await saveTask;
  } finally {
    if (currentSavePromise === saveTask) currentSavePromise = null;
  }
}

async function debouncedExternalSave(content: string): Promise<void> {
  const absolutePath = externalFile.value?.absolutePath;
  if (!absolutePath) return;
  const saveTask = (async () => {
    const gen = ++saveGeneration;
    isSaving.value = true;
    const start = Date.now();
    try {
      await writeExternalNoteFile(absolutePath, content);
      if (gen !== saveGeneration) return;
      lastSavedAt.value = Date.now();
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise((r) => setTimeout(r, 300 - elapsed));
      if (gen !== saveGeneration) return;
      isDirty.value = false;
    } catch (e) {
      saveError.value = e instanceof Error ? e.message : String(e);
    } finally {
      if (gen === saveGeneration) isSaving.value = false;
    }
  })();
  currentSavePromise = saveTask;
  try {
    await saveTask;
  } finally {
    if (currentSavePromise === saveTask) currentSavePromise = null;
  }
}

// --- Format Bubble ---
const FORMAT_HINT_KEY = 'markluck:formatBubble:hintShown';

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
  void onShellSelectNote(result.notePath);
}
function onQuickAction(action: 'new-note' | 'export' | 'settings'): void {
  searchVisible.value = false;
  if (action === 'new-note') onShellCreateNote();
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
  void onShellSelectNote(entry.notePath);
}
function onTagSelect(tagName: string): void {
  if (isExternalEditing.value && !isExternalFolderIndexed.value) {
    toast.show('单文件编辑未扫描所在文件夹，标签面板不会读取其他文件。', 'info', 3500);
    return;
  }
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
  if (isExternalEditing.value && !isExternalFolderIndexed.value) {
    toast.show('单文件编辑未扫描所在文件夹，无法跳转到其他 Wiki-link。', 'info', 3500);
    return;
  }
  const docs = Object.values(indexStore.getIndexService()?.getAllDocuments() ?? {});
  const exact =
    docs.find((doc) => doc.title === noteTitle) ??
    docs.find((doc) => stripSupportedNoteExtension(doc.path.split('/').pop() ?? '') === noteTitle);

  if (!exact) {
    toast.show(`未找到笔记：${noteTitle}`, 'warning', 3000);
    return;
  }

  await onShellSelectNote(exact.path);
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
  await fs.writeFile(path, content);
  await refreshFileTree();
  await indexStore.refreshDocument(fs, path);
  void trainCurrentFile(path, content);
  enterNotebookFileState(path, content);
  showTemplate.value = false;
}

async function onCreateBlank(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const path = `/笔记-${today}.md`;
  const content = '# 新笔记\n\n';
  await fs.writeFile(path, content);
  await refreshFileTree();
  await indexStore.refreshDocument(fs, path);
  void trainCurrentFile(path, content);
  enterNotebookFileState(path, content);
  showTemplate.value = false;
}

// --- Keyboard ---
function onGlobalKeydown(e: KeyboardEvent): void {
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === 's') {
    e.preventDefault();
    e.stopPropagation();
    if (isScratchSession.value) {
      void saveScratchAs();
    } else {
      void flushPendingCurrentSave();
    }
    return;
  }
  if (isExternalSession.value && !isExternalFolderIndexed.value) return;
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'p') {
    e.preventDefault();
    e.stopPropagation();
    searchVisible.value = true;
  }
  if ((e.ctrlKey || e.metaKey) && key === 'k') {
    e.preventDefault();
    e.stopPropagation();
    searchVisible.value = true;
  }
}

/** Wire predictor to IndexStore for structured completions ([[/#/path). */
function connectPredictor(): void {
  if (isExternalSession.value) return;
  const pred = editorRef.value?.predictor;
  if (!pred) return;
  const svc = indexStore.getIndexService();
  pred.setIndexData({
    getAllNoteTitles: () => svc?.getAllNoteTitles() ?? [],
    getAllTags: () => (indexStore.tags ?? []).map((t) => t.name),
    getRecentNoteTitles: () =>
      indexStore.recentNotes.map((note) => stripSupportedNoteExtension(note.title)),
    matchFilePaths: (prefix: string) => {
      const docs = svc?.getAllDocuments() ?? {};
      const q = prefix.toLowerCase();
      return Object.keys(docs).filter((p) => p.toLowerCase().startsWith(q));
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

function onClearCompletionData(): void {
  editorRef.value?.predictor.clearLearningData();
  const nextMeta: CompletionTrainingMeta = {
    ...DEFAULT_TRAINING_META,
    trainedPaths: {},
    failedPaths: {},
    updatedAt: Date.now(),
  };
  completionTrainingMeta.value = nextMeta;
  saveTrainingMeta(nextMeta);
  toast.show('已清空文字补全的本地学习数据', 'success', 2500);
}

function onUpdateExternalScanRootTextFiles(value: boolean): void {
  externalScanRootTextFiles.value = value;
  localStorage.setItem('markluck:external:scanRootTextFiles', String(value));
  if (value && isExternalEditing.value && !isExternalFolderIndexed.value) {
    void confirmExternalEditAndScan();
  } else if (!value && isExternalFolderIndexed.value) {
    externalSessionMode.value = 'edit-shell';
  }
}

function hasUnsavedScratch(): boolean {
  return isScratchSession.value && currentContent.value.trim().length > 0 && isDirty.value;
}

function onBeforeUnload(e: BeforeUnloadEvent): void {
  flushPendingMockFileWritesSync();
  if (!hasUnsavedScratch()) return;
  e.preventDefault();
  e.returnValue = '';
}

async function closeCurrentWindow(): Promise<void> {
  allowWindowClose = true;
  if (isDesktopRuntime()) {
    await getCurrentWindow().close();
  } else {
    window.close();
  }
}

function cancelScratchExit(): void {
  showScratchExitDialog.value = false;
}

async function discardScratchAndClose(): Promise<void> {
  currentContent.value = '';
  isDirty.value = false;
  showScratchExitDialog.value = false;
  await closeCurrentWindow();
}

async function saveScratchAndClose(): Promise<void> {
  const saved = await saveScratchAs();
  if (!saved) return;
  showScratchExitDialog.value = false;
  await closeCurrentWindow();
}

// Reconnect predictor when editor remounts due to :key changes (view-mode / note switch).
watch([activePath, viewMode], async () => {
  await nextTick();
  connectPredictor();
});

// ── Version Check ──────────────────────────────────────────
const VERSION_AUTO_CHECK_KEY = 'markluck:version:autoCheck';
const { hasUpdate, latestVersion, releaseUrl, releaseNotes, checkNow } = useVersionCheck();
const showUpdateNotification = ref(false);
const updateLatestVersion = computed(() => latestVersion.value);
const updateReleaseUrl = computed(() => releaseUrl.value);
const updateReleaseNotes = computed(() => releaseNotes.value);

// Show update notification 15s after mount if update available
let updateTimer: ReturnType<typeof setTimeout> | null = null;

function shouldRunBackgroundVersionCheck(): boolean {
  try {
    return localStorage.getItem(VERSION_AUTO_CHECK_KEY) === 'true';
  } catch {
    return false;
  }
}

onMounted(async () => {
  theme.init();
  applyInitialThemeWorkflowDefaults();
  window.addEventListener('keydown', onGlobalKeydown, { capture: true });
  window.addEventListener('beforeunload', onBeforeUnload);
  if (isDesktopRuntime()) {
    unlistenWindowClose = await getCurrentWindow().onCloseRequested((event) => {
      if (allowWindowClose || !hasUnsavedScratch()) return;
      event.preventDefault();
      showScratchExitDialog.value = true;
    });
    unlistenOpenedFile = await listen<OpenedFilePayload | string>('opened-file', (event) => {
      void handleOpenedFile(event.payload);
    });
  }
  await initNotebook();

  await nextTick();
  connectPredictor();
  unsubscribeCompletionSettings = subscribeCompletionSettings((settings) => {
    completionSettings.value = settings;
    editorRef.value?.predictor.configure(settings);
    if (!isExternalSession.value && settings.backgroundTraining) void maybeTrainNotebook();
  });
  unsubscribeTrainingMeta = subscribeTrainingMeta((meta) => {
    completionTrainingMeta.value = meta;
  });

  // Check for updates after a delay only when the user enabled auto-check.
  updateTimer = setTimeout(async () => {
    if (!shouldRunBackgroundVersionCheck()) return;
    await checkNow();
    if (hasUpdate.value) {
      showUpdateNotification.value = true;
    }
  }, 15000); // 15 seconds after mount
});

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKeydown, { capture: true });
  window.removeEventListener('beforeunload', onBeforeUnload);
  if (saveTimer) clearTimeout(saveTimer);
  if (splitDebounceTimer) clearTimeout(splitDebounceTimer);
  if (splitEditorMountTimer) clearTimeout(splitEditorMountTimer);
  if (previewRenderTimer) clearTimeout(previewRenderTimer);
  if (updateTimer) clearTimeout(updateTimer);
  if (splitDragCleanup) splitDragCleanup();
  unsubscribeCompletionSettings?.();
  unsubscribeTrainingMeta?.();
  unlistenOpenedFile?.();
  unlistenWindowClose?.();
});

function onDismissVersion(version: string) {
  localStorage.setItem('markluck:version:dismissedVersion', version);
  showUpdateNotification.value = false;
}
</script>

<style scoped>
.notebook-home-root {
  height: 100vh;
  min-height: 0;
}

.editor-shell-frame {
  height: 100vh;
  min-height: 0;
}

/* ===== External Reader Session ===== */
.external-mode-enter-active,
.external-mode-leave-active {
  transition:
    opacity 210ms var(--ease-fade),
    transform 210ms var(--ease-standard);
}

.external-mode-enter-from,
.external-mode-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.external-reader-frame {
  min-height: 100vh;
}

.external-reader {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 100vh;
  background: var(--paper-bg);
  color: var(--ink-primary);
}

.external-reader-topbar {
  position: sticky;
  top: 0;
  z-index: var(--z-sticky);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-20);
  min-height: 72px;
  padding: var(--space-14) var(--space-28);
  border-bottom: var(--border-thin) solid var(--rule);
  background: color-mix(in oklch, var(--paper-raised) 92%, transparent);
  backdrop-filter: blur(12px);
}

.external-reader-identity {
  min-width: 0;
}

.external-reader-kicker {
  display: block;
  margin-bottom: var(--space-4);
  color: var(--ink-muted);
  font-size: var(--text-xs);
  line-height: var(--lh-ui);
}

.external-reader-title {
  margin: 0;
  overflow: hidden;
  color: var(--ink-primary);
  font-size: var(--text-xl);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-heading);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.external-reader-path {
  max-width: min(76ch, 56vw);
  margin: var(--space-4) 0 0;
  overflow: hidden;
  color: var(--ink-secondary);
  font-size: var(--text-xs);
  line-height: var(--lh-ui);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.external-reader-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--space-10);
}

.external-reader-stat {
  color: var(--ink-muted);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.external-reader-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-24);
  min-height: 0;
  padding: var(--space-40) clamp(var(--space-20), 4vw, var(--space-56)) var(--space-96);
  overflow: hidden auto;
}

.external-reader-content {
  min-width: 0;
  max-width: var(--editor-max-width);
  width: 100%;
  margin: 0 auto;
}

.external-preview {
  min-height: calc(100vh - 220px);
  padding: 0 0 var(--space-48);
}

.external-reader-rail {
  display: none;
}

.external-state {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  max-width: 72ch;
  margin: var(--space-64) auto;
  padding: 0 var(--space-24);
  color: var(--ink-secondary);
  font-size: var(--text-sm);
  line-height: var(--lh-body);
  white-space: pre-wrap;
}

.external-state--error strong {
  color: var(--signal-error);
}

@media (width >= 1120px) {
  .external-reader-main {
    grid-template-columns: minmax(160px, 220px) minmax(0, var(--editor-max-width)) minmax(
        120px,
        1fr
      );
  }

  .external-reader-rail {
    position: sticky;
    top: calc(72px + var(--space-24));
    display: flex;
    align-self: start;
    flex-direction: column;
    gap: var(--space-6);
    max-height: calc(100vh - 120px);
    overflow: hidden auto;
    padding-right: var(--space-12);
    border-right: var(--border-thin) solid var(--rule);
  }

  .external-reader-content {
    grid-column: 2;
    margin: 0;
  }
}

.external-reader-rail-label {
  margin-bottom: var(--space-6);
  color: var(--ink-muted);
  font-size: var(--text-xs);
  line-height: var(--lh-ui);
}

.external-reader-heading {
  width: 100%;
  padding: var(--space-4) 0;
  border: 0;
  background: transparent;
  color: var(--ink-secondary);
  font: inherit;
  font-size: var(--text-xs);
  line-height: var(--lh-ui);
  text-align: left;
  cursor: pointer;
}

.external-reader-heading:hover {
  color: var(--ink-primary);
}

.external-reader-heading--level-2 {
  padding-left: var(--space-8);
}

.external-reader-heading--level-3,
.external-reader-heading--level-4,
.external-reader-heading--level-5,
.external-reader-heading--level-6 {
  padding-left: var(--space-16);
}

@media (width <= 720px) {
  .external-reader-topbar {
    align-items: flex-start;
    flex-direction: column;
    padding: var(--space-14) var(--space-16);
  }

  .external-reader-actions {
    width: 100%;
    flex-wrap: wrap;
  }

  .external-reader-path {
    max-width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .external-mode-enter-active,
  .external-mode-leave-active {
    transition: opacity 120ms var(--ease-fade);
  }

  .external-mode-enter-from,
  .external-mode-leave-to {
    transform: none;
  }
}

/* ===== Workflow Canvas ===== */
.workflow-canvas {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--paper-surface);
}

.workflow-canvas__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}

.workflow-canvas .editor-control-bar {
  flex: 0 0 auto;
}

.workflow-canvas[data-workspace-intent='writing'] {
  display: grid;
  place-items: stretch center;
  padding: var(--space-24) clamp(var(--space-24), 8vw, var(--space-80));
  background:
    linear-gradient(90deg, transparent, color-mix(in oklch, var(--accent-soft) 20%, transparent)),
    var(--paper-bg);
}

.workflow-canvas[data-workspace-intent='writing'] .workflow-canvas__main {
  width: min(860px, 100%);
  min-height: 100%;
  border: var(--border-thin) solid color-mix(in oklch, var(--rule) 72%, transparent);
  border-radius: var(--radius-md);
  background: color-mix(in oklch, var(--paper-surface) 94%, transparent);
  box-shadow:
    0 18px 48px oklch(0.2 0.018 190 / 0.08),
    inset 0 0 0 1px color-mix(in oklch, var(--paper-raised) 76%, transparent);
}

.workflow-canvas[data-workspace-intent='writing'] :deep(.editor-control-strip) {
  width: min(720px, calc(100% - var(--space-48)));
  margin: var(--space-16) auto 0;
}

.workflow-canvas[data-workspace-intent='archive'] .workflow-canvas__main {
  background:
    linear-gradient(
      90deg,
      color-mix(in oklch, var(--accent-soft) 16%, transparent),
      transparent 34%
    ),
    var(--paper-surface);
}

.workflow-canvas[data-workspace-intent='studio'] {
  flex-direction: row;
  background: var(--paper-bg);
}

.workflow-canvas[data-workspace-intent='studio'] .workflow-canvas__main {
  border-left: var(--border-thin) solid var(--rule);
  background:
    linear-gradient(
      90deg,
      color-mix(in oklch, var(--accent-soft) 12%, transparent),
      transparent 28%
    ),
    var(--paper-surface);
}

.workflow-canvas[data-workspace-intent='atelier'] {
  padding: var(--space-18);
  background:
    linear-gradient(
      180deg,
      color-mix(in oklch, var(--accent-soft) 20%, transparent),
      transparent 18%
    ),
    linear-gradient(
      90deg,
      color-mix(in oklch, var(--paper-left) 88%, transparent) 0 22%,
      transparent 22%
    ),
    var(--paper-bg);
}

.workflow-canvas[data-workspace-intent='atelier'] .workflow-canvas__main {
  min-height: 100%;
  border: var(--border-thin) solid color-mix(in oklch, var(--rule) 78%, transparent);
  border-radius: var(--radius-md);
  background:
    linear-gradient(
      180deg,
      color-mix(in oklch, var(--paper-raised) 54%, transparent),
      transparent 18%
    ),
    color-mix(in oklch, var(--paper-surface) 94%, transparent);
  box-shadow:
    0 24px 56px oklch(0.2 0.02 240 / 0.12),
    inset 0 0 0 1px color-mix(in oklch, var(--paper-raised) 82%, transparent);
}

.workflow-canvas[data-workspace-intent='atelier'] :deep(.editor-control-strip--stacked) {
  border-bottom-color: color-mix(in oklch, var(--accent) 18%, var(--rule));
}

.workflow-canvas[data-workspace-intent='reader'] {
  background: color-mix(in oklch, var(--paper-bg) 82%, transparent);
}

/* ===== View Mode Toggle ===== */

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

.external-edit-return {
  display: flex;
  justify-content: flex-end;
  padding: var(--space-6) var(--space-12) 0;
}

.reader-workbench {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: color-mix(in oklch, var(--paper-bg) 72%, var(--paper-surface));
}

.reader-workbench__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-12);
  padding: var(--space-8) var(--space-24);
  border-bottom: var(--border-thin) solid color-mix(in oklch, var(--rule) 66%, transparent);
  background: color-mix(in oklch, var(--paper-bg) 88%, transparent);
}

.reader-workbench__label {
  color: var(--ink-muted);
  font-size: var(--text-xs);
  letter-spacing: 0;
}

.reader-workbench__actions {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}

.reader-preview {
  width: min(760px, calc(100% - var(--space-48)));
  margin: 0 auto;
  padding: var(--space-48) 0 var(--space-64);
}

/* ===== Split Pane ===== */
.split-pane {
  display: flex;
  flex: 1;
  min-height: 0;
  height: 100%;
  box-sizing: border-box;
  padding-top: var(--space-48);
  overflow: hidden;
  position: relative;
}

.workflow-canvas[data-workspace-intent='archive'] .split-pane,
.workflow-canvas[data-workspace-intent='studio'] .split-pane {
  padding-top: var(--space-16);
}

.workflow-canvas[data-workspace-intent='atelier'] .split-pane {
  padding-top: var(--space-18);
}

.split-left,
.split-right {
  min-width: 300px;
  overflow: hidden;
}

.split-left {
  border-right: none;
}

.large-doc-editor-placeholder {
  display: grid;
  height: 100%;
  place-items: center;
  color: var(--ink-secondary);
  background: var(--paper-surface);
  font-size: var(--fs-sm);
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
