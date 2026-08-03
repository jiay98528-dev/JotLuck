<template>
  <div class="notebook-home-root">
    <div
      v-if="!startupRouteResolved"
      class="startup-state"
      role="status"
      aria-live="polite"
      aria-label="JotLuck 正在启动"
    >
      <span class="startup-state__mark" aria-hidden="true" />
      <span>正在打开 JotLuck...</span>
    </div>

    <Transition name="external-mode" appear>
      <div
        v-if="startupRouteResolved && isExternalReadonly"
        key="external-reader"
        class="external-reader-frame"
      >
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
                  添加到笔记
                </button>
                <button v-if="!externalError" class="btn btn--primary" @click="enableExternalEdit">
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
      <div
        v-if="startupRouteResolved && !isExternalReadonly"
        key="editor-shell"
        class="editor-shell-frame"
        :class="{
          'editor-shell-frame--external': isExternalEditing,
          'editor-shell-frame--opening': isInteractionLocked,
        }"
        :aria-busy="isInteractionLocked"
      >
        <div v-if="isExternalEditing" class="external-edit-banner" role="status">
          <span>单文件编辑 · 未扫描所在目录</span>
          <button class="btn btn--secondary" type="button" @click="openExternalParentAsNotebook">
            添加到笔记
          </button>
        </div>
        <AppShell
          :recent-notes="shellRecentNotesWithColors"
          :active-path="shellActivePath"
          :note-title="shellNoteTitle"
          :notebook-name="shellNotebookName"
          :show-top-bar="true"
          :show-right-wing="showRightWing && !isWorkspaceUnbound"
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
          @retry-save="retryCurrentSave"
          @save-copy="saveCurrentAsCopy"
        >
          <template v-if="!isWorkspaceUnbound" #drawer-bottom>
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
                :view-mode="viewMode"
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
                  v-if="
                    !isWorkspaceUnbound &&
                    chrome.editorControlLayout === 'studio-rail' &&
                    !isSinglePageLayout
                  "
                  :actions="actionsForRegion('studio-rail')"
                  :preset="activeParagraphPreset"
                  :active-action="pendingFormatAction"
                  @format="onToolbarFormat"
                />

                <div class="workflow-canvas__main">
                  <ThemeSlotBoundary
                    v-if="
                      !isWorkspaceUnbound &&
                      chrome.editorControlLayout !== 'studio-rail' &&
                      !isSinglePageLayout
                    "
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
                      :view-mode="viewMode"
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
                    <NotebookOpenGate
                      v-if="isWorkspaceUnbound"
                      ref="notebookOpenGateRef"
                      :status="workspaceGateStatus ?? 'idle'"
                      :error-message="workspaceGateError"
                      :formats-label="supportedNoteExtensionsText"
                      @open-notebook="requestOpenNotebook"
                    />

                    <div
                      v-else-if="viewMode === 'read'"
                      class="reader-workbench"
                      data-view-mode="read"
                    >
                      <div class="reader-workbench__bar">
                        <span class="reader-workbench__label">只读渲染</span>
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
                            :read-only="isInteractionLocked"
                            :placeholder="isScratchSession ? '开始输入文字' : undefined"
                            :show-line-numbers="!isLargeDocument"
                            :live-preview="false"
                            :source-only="true"
                            :pending-format="pendingFormatAction"
                            :wiki-link-exists="wikiLinkExists"
                            :wiki-link-revision="wikiLinkRevision"
                            :resolve-image-src="previewImages.resolveImageSrc"
                            :image-revision="previewImages.imageRevision.value"
                            :completion-settings="completionSettings"
                            :predictor="completionPredictor"
                            :enable-autocomplete="!isExternalEditing && !isLargeDocument"
                            :on-editor-drop="
                              isExternalEditing || isInteractionLocked
                                ? undefined
                                : imageUpload.handleDrop
                            "
                            :on-editor-drag-over="
                              isExternalEditing || isInteractionLocked
                                ? undefined
                                : imageUpload.handleDragOver
                            "
                            :on-editor-paste="
                              isExternalEditing || isInteractionLocked
                                ? undefined
                                : imageUpload.handlePaste
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
                        :read-only="isInteractionLocked"
                        :placeholder="isScratchSession ? '开始输入文字' : undefined"
                        :show-line-numbers="false"
                        :live-preview="true"
                        :pending-format="pendingFormatAction"
                        :on-live-preview-external-link-click="onLivePreviewExternalLinkClick"
                        :on-live-preview-tag-click="onLivePreviewTagClick"
                        :on-live-preview-wiki-link-click="onLivePreviewWikiLinkClick"
                        :wiki-link-exists="wikiLinkExists"
                        :wiki-link-revision="wikiLinkRevision"
                        :resolve-image-src="previewImages.resolveImageSrc"
                        :image-revision="previewImages.imageRevision.value"
                        :completion-settings="completionSettings"
                        :predictor="completionPredictor"
                        :enable-autocomplete="!isExternalEditing && !isLargeDocument"
                        :on-editor-drop="
                          isExternalEditing || isInteractionLocked
                            ? undefined
                            : imageUpload.handleDrop
                        "
                        :on-editor-drag-over="
                          isExternalEditing || isInteractionLocked
                            ? undefined
                            : imageUpload.handleDragOver
                        "
                        :on-editor-paste="
                          isExternalEditing || isInteractionLocked
                            ? undefined
                            : imageUpload.handlePaste
                        "
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
        <div
          v-if="isInteractionLocked && !isWorkspaceUnbound"
          class="workspace-opening-overlay"
          role="status"
          aria-live="polite"
        >
          {{ isNotebookOpening ? '正在打开笔记本…' : '正在打开笔记…' }}
        </div>
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
      :switching-notebook="isNotebookOpening"
      @update:visible="showLeftDrawer = $event"
      @select-file="onShellSelectNote"
      @navigate-dir="onShellDrawerNavigateDir"
      @create-file="onShellCreateFile"
      @delete-file="requestShellDeleteFile"
      @rename-file="onShellRenameFile"
      @open-notebook="requestOpenNotebook"
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
      :custom-templates="customTemplates"
      :can-save-custom-template="canSaveCurrentAsTemplate"
      :custom-template-disabled-reason="customTemplateDisabledReason"
      @update:visible="showTemplate = $event"
      @select="onTemplateSelect"
      @create-blank="onCreateBlank"
      @save-template="onSaveCustomTemplate"
      @delete-template="onDeleteCustomTemplate"
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
      @update:visible="showSettings = $event"
      @update-completion-settings="onUpdateCompletionSettings"
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
      <div
        v-if="showNewFileDialog"
        ref="newFileDialogRef"
        tabindex="-1"
        class="modal-overlay"
        @click.self="cancelNewFile"
        @keydown.escape="cancelNewFile"
      >
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
              data-dialog-initial-focus
              :placeholder="`文件名（${supportedNoteExtensionsText}）`"
              autofocus
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
      <div
        v-if="pendingDeletePath"
        ref="deleteDialogRef"
        tabindex="-1"
        class="modal-overlay"
        @click.self="cancelDeleteFile"
        @keydown.escape="cancelDeleteFile"
      >
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
            <button class="btn btn--secondary" data-dialog-initial-focus @click="cancelDeleteFile">
              取消
            </button>
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
        ref="externalEditDialogRef"
        tabindex="-1"
        class="modal-overlay"
        @click.self="showExternalEditConfirm = false"
        @keydown.escape="showExternalEditConfirm = false"
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
              启用后仅编辑当前文件，不会扫描所在文件夹，也不会把它加入笔记本或标签索引。
              如需完整文件树、搜索与标签，请使用“添加到笔记”。
            </p>
          </div>
          <div class="modal-footer">
            <button
              class="btn btn--secondary"
              data-dialog-initial-focus
              @click="showExternalEditConfirm = false"
            >
              取消
            </button>
            <button class="btn btn--primary" @click="confirmExternalEdit()">仅编辑当前文件</button>
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
      <div
        v-if="showScratchExitDialog"
        ref="scratchExitDialogRef"
        tabindex="-1"
        class="modal-overlay"
        @keydown.escape="cancelUnsavedExit"
      >
        <div
          class="modal-card"
          style="width: 420px"
          role="dialog"
          aria-modal="true"
          aria-labelledby="scratch-exit-title"
        >
          <div class="modal-header">
            <h2 id="scratch-exit-title">{{ unsavedDialogTitle }}</h2>
          </div>
          <div class="modal-body">
            <p class="delete-confirm-text">{{ unsavedDialogMessage }}</p>
          </div>
          <div class="modal-footer">
            <button class="btn btn--secondary" data-dialog-initial-focus @click="cancelUnsavedExit">
              取消
            </button>
            <button
              v-if="unsavedDialogMode !== 'scratch'"
              class="btn btn--secondary"
              @click="copyCurrentContent"
            >
              复制全文
            </button>
            <button
              v-if="unsavedDialogMode === 'conflict'"
              class="btn btn--secondary"
              @click="reloadCurrentFromDisk"
            >
              {{ unsavedDialogIntent === 'close' ? '采用外部版本并退出' : '采用外部版本' }}
            </button>
            <button
              v-if="unsavedDialogMode === 'conflict' || unsavedDialogMode === 'missing'"
              class="btn btn--secondary"
              @click="overwriteCurrentDiskVersion"
            >
              {{
                unsavedDialogMode === 'missing'
                  ? unsavedDialogIntent === 'close'
                    ? '在原位置重建并退出'
                    : '在原位置重建'
                  : unsavedDialogIntent === 'close'
                    ? '覆盖原文件并退出'
                    : '覆盖原文件'
              }}
            </button>
            <button
              v-if="isScratchSession || unsavedDialogIntent === 'close'"
              class="btn btn--secondary"
              @click="discardUnsavedAndClose"
            >
              {{ isScratchSession ? '不保存' : '不保存并退出' }}
            </button>
            <button class="btn btn--primary" @click="saveUnsavedAsCopy">
              {{
                isScratchSession
                  ? '保存'
                  : unsavedDialogIntent === 'close'
                    ? '另存副本并退出'
                    : '另存副本'
              }}
            </button>
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
import { getCurrentWindow } from '@tauri-apps/api/window';
import AppShell from '@/components/layout/AppShell.vue';
import ShellActionButton from '@/components/layout/ShellActionButton.vue';
import FormatBubble from '@/components/editor/FormatBubble.vue';
import EditorControlStrip from '@/components/editor/EditorControlStrip.vue';
import StudioRail from '@/components/editor/StudioRail.vue';
import NotebookOpenGate, {
  type NotebookOpenGateStatus,
} from '@/components/workspace/NotebookOpenGate.vue';
import ThemeSlotBoundary from '@/components/theme/ThemeSlotBoundary.vue';
import ToastContainer, { useToast } from '@/components/common/Toast.vue';
import { MockFSService } from '@/services/MockFSService';
import { TauriIPCService } from '@/services/TauriIPCService';
import { useIndexStore } from '@/stores/index';
import { useSearchStore } from '@/stores/search';
import { useThemeStore } from '@/stores/theme';
import { useHeadings } from '@/composables/useHeadings';
import { renderMarkdown, highlightCodeBlocks } from '@jotluck/renderer';
import type {
  DirEntry,
  BacklinkEntry,
  SearchResult,
  IFileSystemService,
  FormatAction,
  ParagraphPreset,
  TemplateItem,
  FileChangeEvent,
  UnwatchFn,
  NotebookHandle,
  TextFileSnapshot,
  ConditionalWriteResult,
  WindowBootstrapPayload,
  PromotedNotebookPayload,
} from '@/types';
import { EditorView } from '@codemirror/view';
import { useVersionCheck } from '@/composables/useVersionCheck';
import { useImageUpload } from '@/composables/useImageUpload';
import { usePreviewImageResolver } from '@/composables/usePreviewImageResolver';
import { useDialogFocus } from '@/composables/useDialogFocus';
import { normalizeUrl } from '@/utils/urlUtils';
import { revealLivePreviewSourceAt } from '@/utils/cm6-live-preview';
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
import { MarkdownPredictor } from '@/services/MarkdownPredictor';
import {
  applyParagraphPreset,
  clearMarkdownFormatting,
  detectParagraphPreset,
  toggleInlineFormat,
} from '@/utils/markdown-formatting';
import {
  isIgnoredNotebookDirectory,
  isMarkdownLikeFile,
  isSupportedNoteFile,
  stripSupportedNoteExtension,
  supportedNoteExtensionsLabel,
} from '@/utils/note-files';
import { getDraftMarkdownFileName } from '@/utils/draft-file-name';
import { getJotLuckE2EBridge, peekJotLuckE2EBridge } from '@/utils/e2e-bridge';
import { summarizeActiveFileChanges } from '@/utils/file-change-events';
import { isDesktopRuntime, shouldPersistMockFs } from '@/utils/runtime';
import {
  loadCustomTemplatesFromFiles,
  migrateLegacyCustomTemplates,
  saveCustomTemplateToFiles,
  deleteCustomTemplateFile,
} from '@/services/TemplateEngine';
import type {
  ShellAction,
  ThemeActionRegion,
  ThemeSlotId,
  ThemeViewMode,
} from '@/types/theme-pack';

const CommandPalette = defineAsyncComponent(
  () => import('@/components/overlays/CommandPalette.vue'),
);
const MarkdownEditor = defineAsyncComponent(() => import('@/components/editor/MarkdownEditor.vue'));
const FileDrawer = defineAsyncComponent(() => import('@/components/overlays/FileDrawer.vue'));
const ThemeDialog = defineAsyncComponent(() => import('@/components/theme/ThemeDialog.vue'));
const UpdateNotification = defineAsyncComponent(
  () => import('@/components/overlays/UpdateNotification.vue'),
);
const MarkdownCheatSheet = defineAsyncComponent(
  () => import('@/components/overlays/MarkdownCheatSheet.vue'),
);
const ExportDialog = defineAsyncComponent(() => import('@/components/modals/ExportDialog.vue'));
const TemplateDialog = defineAsyncComponent(() => import('@/components/modals/TemplateDialog.vue'));
const SettingsDialog = defineAsyncComponent(() => import('@/components/modals/SettingsDialog.vue'));
const ShareDialog = defineAsyncComponent(() => import('@/components/modals/ShareDialog.vue'));

// --- File System ---
// Tauri 桌面端使用真实文件系统，Web/E2E 使用虚拟 MockFS
function createFileSystem(): IFileSystemService {
  if (isDesktopRuntime()) return new TauriIPCService();
  const mockNotebook = peekJotLuckE2EBridge()?.mockNotebook;
  return new MockFSService(50, {
    persist: shouldPersistMockFs(),
    recentNotebooks: mockNotebook?.recentRoots,
    pickerResult:
      mockNotebook?.pickerOutcome === 'cancel'
        ? null
        : mockNotebook?.pickerOutcome === 'success'
          ? {
              rootPath: mockNotebook.pickerRoot ?? '/e2e-notebook',
              name: mockNotebook.pickerName ?? 'E2E Notebook',
            }
          : undefined,
    pickerError:
      mockNotebook?.pickerOutcome === 'error'
        ? (mockNotebook.pickerError ?? '测试文件夹选择失败')
        : undefined,
    unavailableNotebookPaths: mockNotebook?.unavailableRoots,
  });
}
const fs: IFileSystemService = createFileSystem();
const supportedNoteExtensionsText = supportedNoteExtensionsLabel();
const LARGE_DOCUMENT_PREVIEW_DELAY_THRESHOLD_CHARS = 120_000;
const LARGE_DOCUMENT_PREVIEW_DELAY_THRESHOLD_LINES = 3_000;
const LARGE_DOCUMENT_DEFERRED_WORK_DELAY_MS = 1800;
const LARGE_DOCUMENT_PREVIEW_PENDING_HTML =
  '<p class="large-doc-preview-pending">正在渲染大文档预览...</p>';
const STARTUP_IPC_TIMEOUT_MS = 8_000;
const EXTERNAL_FILE_READ_TIMEOUT_MS = 15_000;

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label}超时，请重试`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

interface OpenedFilePayload {
  absolutePath: string;
  notebookRoot: string;
  relativePath: string;
  accessToken?: string;
}

interface SaveIssue {
  kind: 'io' | 'conflict' | 'missing';
  source: 'workspace' | 'external';
  path: string;
  message: string;
  actualRevision?: string | null;
}

type ExternalSessionMode = 'none' | 'readonly' | 'edit-shell';
interface NotebookOpenGateExposed {
  focusPrimary(): Promise<void>;
}

const files = ref<DirEntry[]>([]);
const currentContent = ref('');
const activePath = ref('');
const loading = ref(true);
const startupRouteResolved = ref(false);
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
const workspaceGateStatus = ref<NotebookOpenGateStatus | null>(null);
const workspaceGateError = ref('');
const isNotebookOpening = ref(false);
const isNoteSwitching = ref(false);
const isInteractionLocked = computed(() => isNotebookOpening.value || isNoteSwitching.value);
const notebookOpenGateRef = ref<NotebookOpenGateExposed | null>(null);
const isWorkspaceUnbound = computed(() => workspaceGateStatus.value !== null);
const customTemplates = ref<TemplateItem[]>([]);
const showScratchExitDialog = ref(false);
const pendingDeletePath = ref<string | null>(null);
const toast = useToast();
const notebookName = ref('未打开笔记本');
const activeNotebookRoot = ref('');
const completionSettings = ref<CompletionSettings>(getCompletionSettings());
const completionTrainingMeta = ref<CompletionTrainingMeta>(loadTrainingMeta());
const completionPredictor = new MarkdownPredictor(4);
let unsubscribeCompletionSettings: (() => void) | null = null;
let unsubscribeTrainingMeta: (() => void) | null = null;
let completionTrainer: CompletionTrainingService | null = null;
let unlistenWindowClose: (() => void) | null = null;
let componentUnmounted = false;
let externalSessionGeneration = 0;
let allowWindowClose = false;
let unwatchNotebook: UnwatchFn | null = null;
let notebookWatchGeneration = 0;
let notebookDataGeneration = 0;
let watcherRefreshTimer: ReturnType<typeof setTimeout> | null = null;
const pendingWatcherEvents: FileChangeEvent[] = [];
let watcherFlushChain: Promise<void> = Promise.resolve();
let fileTreeRequestId = 0;
let backgroundTrainingTimer: ReturnType<typeof setTimeout> | null = null;
const MAX_FILE_TREE_ENTRIES = 5000;

function hashCompletionScope(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

const completionStorageScope = computed(() =>
  activeNotebookRoot.value
    ? `notebook-${hashCompletionScope(activeNotebookRoot.value)}`
    : 'unscoped',
);

const externalSessionMode = ref<ExternalSessionMode>('none');
const externalFile = ref<OpenedFilePayload | null>(null);
const externalError = ref('');
const externalPreviewHtml = ref('');
const showExternalEditConfirm = ref(false);
const externalFiles = ref<DirEntry[]>([]);
const externalOpenedNotes = ref<Array<{ path: string; title: string; lastOpenedAt: number }>>([]);
const externalOpenedFileMap = ref<Record<string, OpenedFilePayload>>({});
const isExternalSession = computed(() => externalSessionMode.value !== 'none');
const isExternalReadonly = computed(() => externalSessionMode.value === 'readonly');
const isExternalEditing = computed(() => externalSessionMode.value === 'edit-shell');
const canSaveCurrentAsTemplate = computed(
  () =>
    Boolean(activeNotebookRoot.value) &&
    !isWorkspaceUnbound.value &&
    !isNotebookOpening.value &&
    !isScratchSession.value &&
    !isExternalSession.value &&
    currentContent.value.trim().length > 0,
);
const customTemplateDisabledReason = computed(() => {
  if (!currentContent.value.trim()) return '当前笔记为空，无法保存为模板。';
  if (isScratchSession.value) return '临时草稿尚未进入笔记本，保存后可作为模板。';
  if (isExternalSession.value) return '外部单文件不写入模板目录，请先打开所在文件夹为笔记本。';
  if (!activeNotebookRoot.value) return '请先打开一个笔记本，再保存自定义模板。';
  return '';
});
let forcedE2ESaveFailure: string | null = null;
const e2eBridge = getJotLuckE2EBridge();
if (e2eBridge) {
  e2eBridge.debugState = () => ({
    activePath: activePath.value,
    currentContent: currentContent.value,
    externalSessionMode: externalSessionMode.value,
    isDirty: isDirty.value,
    isExternalEditing: isExternalEditing.value,
    activeNotebookRoot: activeNotebookRoot.value,
    isWorkspaceUnbound: isWorkspaceUnbound.value,
    isNotebookOpening: isNotebookOpening.value,
    isNoteSwitching: isNoteSwitching.value,
    saveIssueKind: saveIssue.value?.kind ?? null,
  });
  e2eBridge.listNotePaths = () =>
    files.value
      .filter((entry) => entry.isFile && isSupportedNoteFile(entry.name))
      .map((entry) => entry.path);
  e2eBridge.selectNote = (path) => onSelectNote(path);
  e2eBridge.readNoteFile = (path) => fs.readFile(path);
  e2eBridge.writeNoteFileExternally = (path, content) => fs.writeFile(path, content);
  e2eBridge.deleteNoteFile = (path) => fs.deleteFile(path);
  e2eBridge.failNextSave = (message = '模拟原文件位置不可写') => {
    forcedE2ESaveFailure = message;
  };
  e2eBridge.requestClose = () => requestDesktopWindowClose();
}
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
    disabled: isWorkspaceUnbound.value || isNotebookOpening.value,
  },
  {
    id: 'file-drawer',
    region: actionRegion('file-drawer'),
    label: isWorkspaceUnbound.value ? '打开笔记本文件夹' : '切换左侧书签栏',
    shortLabel: isWorkspaceUnbound.value ? '打开' : '文件',
    title: isWorkspaceUnbound.value ? '选择笔记本文件夹 (Ctrl/Cmd+O)' : '打开文件抽屉',
    icon: 'file-drawer',
    run: isWorkspaceUnbound.value ? requestOpenNotebook : onToggleLeftDrawer,
    active: !isWorkspaceUnbound.value && showLeftDrawer.value,
    disabled: isNotebookOpening.value,
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
    disabled: isWorkspaceUnbound.value || isNotebookOpening.value,
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
    disabled: isWorkspaceUnbound.value || isNotebookOpening.value,
  },
  {
    id: 'export',
    region: actionRegion('export'),
    label: '导出笔记',
    shortLabel: '导出',
    title: '导出笔记',
    icon: 'export',
    run: () => {
      if (!requireBoundWorkspace('导出')) return;
      showExport.value = true;
    },
    active: showExport.value,
    disabled: isWorkspaceUnbound.value || isNotebookOpening.value,
  },
  {
    id: 'share',
    region: actionRegion('share'),
    label: '分享笔记',
    shortLabel: '分享',
    title: '分享笔记',
    icon: 'share',
    run: () => {
      if (!requireBoundWorkspace('分享')) return;
      showShare.value = true;
    },
    active: showShare.value,
    disabled: isWorkspaceUnbound.value || isNotebookOpening.value,
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
    label: viewModeActionCopy.value.label,
    shortLabel: viewModeActionCopy.value.shortLabel,
    title: `${viewModeActionCopy.value.label}，当前为${resolvedViewModeLabel.value}`,
    icon: 'view-toggle',
    run: cycleViewMode,
    disabled: isWorkspaceUnbound.value || isNotebookOpening.value,
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
  enableEdit: enableExternalEdit,
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
  confirmEditOnly: () => confirmExternalEdit(),
}));

const unsavedDialogMode = computed<'scratch' | 'save-failed' | 'conflict' | 'missing'>(() => {
  if (isScratchSession.value) return 'scratch';
  if (saveIssue.value?.kind === 'conflict') return 'conflict';
  if (saveIssue.value?.kind === 'missing') return 'missing';
  return 'save-failed';
});
const unsavedDialogTitle = computed(() => {
  if (unsavedDialogMode.value === 'scratch') return '保存临时草稿？';
  if (unsavedDialogMode.value === 'conflict') return '原文件和本地草稿不一样';
  if (unsavedDialogMode.value === 'missing') return '原文件已被移动或删除';
  return '这次修改还没保存';
});
const unsavedDialogMessage = computed(() => {
  if (unsavedDialogMode.value === 'scratch') {
    return '当前草稿还没有保存为文件。可以选择保存位置，或放弃这次临时内容。';
  }
  return saveIssue.value?.message ?? '原文件现在无法写入。本地草稿仍在，可以先另存副本或复制全文。';
});

const scratchExitDialogSlotProps = computed(() => ({
  visible: showScratchExitDialog.value,
  mode: unsavedDialogMode.value,
  intent: unsavedDialogIntent.value,
  message: saveIssue.value?.message ?? saveError.value,
  cancel: cancelUnsavedExit,
  discard: discardUnsavedAndClose,
  saveCopy: saveUnsavedAsCopy,
  copyContent: copyCurrentContent,
  reloadExternal: reloadCurrentFromDisk,
  overwrite: overwriteCurrentDiskVersion,
  save: saveUnsavedAsCopy,
}));

function openThemeDialogSlot(slot: ThemeSlotId): void {
  if (slot === 'command-palette' && requireBoundWorkspace('搜索笔记')) searchVisible.value = true;
  else if (slot === 'file-drawer' && requireFileBrowseSession()) showLeftDrawer.value = true;
  else if (slot === 'export-dialog' && requireBoundWorkspace('导出')) showExport.value = true;
  else if (slot === 'template-dialog' && requireBoundWorkspace('使用模板'))
    showTemplate.value = true;
  else if (slot === 'settings-dialog') showSettings.value = true;
  else if (slot === 'share-dialog') showShare.value = true;
  else if (slot === 'dialogs.theme') showThemeDialog.value = true;
  else if (slot === 'new-file-dialog' && requireBoundWorkspace('新建文件'))
    showNewFileDialog.value = true;
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
  else if (slot === 'scratch-exit-dialog') cancelUnsavedExit();
}

const themeHostUi = computed(() => ({
  editor: {
    getContent: () => currentContent.value,
    setContent: (content: string) => {
      if (isInteractionLocked.value) return;
      if (isExternalSession.value || requireBoundWorkspace('编辑笔记')) {
        onEditorContentUpdate(content);
      }
    },
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
interface MarkdownEditorExposed {
  getEditorView(): EditorView | null;
  focus(): void;
}

const editorRef = ref<MarkdownEditorExposed | null>(null);
const newFileDialogRef = ref<HTMLDivElement | null>(null);
const deleteDialogRef = ref<HTMLDivElement | null>(null);
const externalEditDialogRef = ref<HTMLDivElement | null>(null);
const scratchExitDialogRef = ref<HTMLDivElement | null>(null);
const editorFocusFallback = () => editorRef.value?.getEditorView()?.contentDOM ?? null;

useDialogFocus({
  visible: () => showNewFileDialog.value,
  containerRef: newFileDialogRef,
  initialFocus: '[data-dialog-initial-focus]',
  fallbackFocus: editorFocusFallback,
});
useDialogFocus({
  visible: () => Boolean(pendingDeletePath.value),
  containerRef: deleteDialogRef,
  initialFocus: '[data-dialog-initial-focus]',
  fallbackFocus: editorFocusFallback,
});
useDialogFocus({
  visible: () => showExternalEditConfirm.value,
  containerRef: externalEditDialogRef,
  initialFocus: '[data-dialog-initial-focus]',
  fallbackFocus: editorFocusFallback,
});
useDialogFocus({
  visible: () => showScratchExitDialog.value,
  containerRef: scratchExitDialogRef,
  initialFocus: '[data-dialog-initial-focus]',
  fallbackFocus: editorFocusFallback,
});

const previewImages = usePreviewImageResolver(fs);
const imageUpload = useImageUpload(
  fs,
  () => {
    const view = editorRef.value?.getEditorView() ?? null;
    if (!view || !activePath.value || isScratchSession.value || isExternalSession.value)
      return null;
    return {
      workspaceEpoch: notebookDataGeneration,
      notePath: activePath.value,
      view,
    };
  },
  async (path, owner) => {
    await previewImages.prime(path);
    if (
      owner.workspaceEpoch === notebookDataGeneration &&
      normalizePath(owner.notePath) === normalizePath(activePath.value)
    ) {
      await refreshFileTree();
    }
  },
  (failure) => toast.show(failure.message, 'error', 6000),
);

watch(
  [activeNotebookRoot, activePath, isExternalSession],
  ([root, path, external]) => previewImages.setNotePath(external ? '' : path, root),
  { immediate: true },
);
watch(previewImages.imageRevision, () => refreshSplitPreviewIfVisible());

// --- View Mode ---
const viewModeLabels: Record<string, string> = {
  split: '分栏',
  live: '即时',
  read: '只读渲染',
};
const viewModeLabel = computed(() => viewModeLabels[viewMode.value]);
const resolvedViewModeLabel = computed(() => viewModeLabel.value ?? '阅读');
const viewModeCycle = computed<readonly ViewMode[]>(() =>
  chrome.value.defaultViewMode === 'read' ? ['read', 'live', 'split'] : ['live', 'split', 'read'],
);
const nextViewMode = computed<ViewMode>(() => {
  const idx = viewModeCycle.value.indexOf(viewMode.value);
  return viewModeCycle.value[(idx + 1 + viewModeCycle.value.length) % viewModeCycle.value.length]!;
});
const viewModeActionCopy = computed(() => {
  if (nextViewMode.value === 'split') {
    return { label: '切换到分栏视图', shortLabel: '分栏' };
  }
  if (nextViewMode.value === 'read') {
    return { label: '切换到只读渲染', shortLabel: '只读' };
  }
  return { label: '返回即时编辑', shortLabel: '返回编辑' };
});

function cycleViewMode(): void {
  pendingFormatAction.value = null;
  viewMode.value = nextViewMode.value;
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
  if (
    !isScratchSession.value &&
    (!activeNotebookRoot.value || isWorkspaceUnbound.value || isInteractionLocked.value)
  ) {
    requireBoundWorkspace('编辑笔记');
    return;
  }
  const revision = ++contentRevision;
  currentContent.value = content;
  updateHeadings(content);
  updateEditorStats(content);
  if (isScratchSession.value) {
    isDirty.value = content.trim().length > 0;
    clearSaveIssue();
  } else if (activePath.value) {
    isDirty.value = true;
    clearTransientSaveIssueOnEdit();
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!isAutosavePausedForDiskIssue()) {
      const savingPath = activePath.value;
      const savingRoot = activeNotebookRoot.value;
      const savingGeneration = notebookDataGeneration;
      saveTimer = setTimeout(
        () => void debouncedSave(savingPath, content, revision, savingRoot, savingGeneration),
        600,
      );
    }
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
const saveIssue = ref<SaveIssue | null>(null);
const currentDiskRevision = ref<string | null>(null);
const lastSavedAt = ref<number | null>(null);
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveGeneration = 0;
let contentRevision = 0;
let localWriteEpoch = 0;
let currentSavePromise: Promise<boolean> | null = null;
let noteSelectionQueue: Promise<void> = Promise.resolve();
let noteSelectionVersion = 0;
let externalSelectionVersion = 0;
const unsavedDialogIntent = ref<'recover' | 'close'>('recover');

function clearSaveIssue(): void {
  saveIssue.value = null;
  saveError.value = null;
}

function clearTransientSaveIssueOnEdit(): void {
  if (saveIssue.value && saveIssue.value.kind !== 'io') return;
  clearSaveIssue();
}

function isAutosavePausedForDiskIssue(): boolean {
  return saveIssue.value?.kind === 'conflict' || saveIssue.value?.kind === 'missing';
}

function reportSaveIssue(issue: SaveIssue, openRecovery = issue.kind !== 'io'): void {
  saveIssue.value = issue;
  saveError.value = issue.message;
  if (openRecovery) {
    unsavedDialogIntent.value = 'recover';
    showScratchExitDialog.value = true;
  }
}

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
const shellBacklinks = computed((): BacklinkEntry[] => currentBacklinks.value);
const shellTags = computed(() => []);

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

function notebookRootsEqual(left: string, right: string): boolean {
  const normalizedLeft = normalizeOsPath(left);
  const normalizedRight = normalizeOsPath(right);
  const isWindowsPath = /^[A-Za-z]:\//.test(normalizedLeft) || /^[A-Za-z]:\//.test(normalizedRight);
  return isWindowsPath
    ? normalizedLeft.toLocaleLowerCase() === normalizedRight.toLocaleLowerCase()
    : normalizedLeft === normalizedRight;
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
  const accessTokenValue = record.accessToken ?? record.access_token;
  const accessToken =
    typeof accessTokenValue === 'string' && accessTokenValue.length > 0
      ? accessTokenValue
      : undefined;
  if (!notebookRoot || !relativePath) return null;

  return {
    absolutePath: normalizeOsPath(absolutePath),
    notebookRoot: normalizeOsPath(notebookRoot),
    relativePath: normalizePath(relativePath),
    accessToken,
  };
}

async function getPendingOpenedFile(): Promise<OpenedFilePayload | null> {
  const mockOpenedFile = normalizeOpenedFilePayload(peekJotLuckE2EBridge()?.mockOpenedFile);
  return mockOpenedFile;
}

function openedFileFromBootstrap(
  bootstrap: Extract<WindowBootstrapPayload, { mode: 'external-readonly' | 'external-edit' }>,
): OpenedFilePayload {
  const absolutePath = normalizeOsPath(bootstrap.openedFile.absolutePath);
  const slash = absolutePath.lastIndexOf('/');
  return {
    absolutePath,
    notebookRoot: slash > 0 ? absolutePath.slice(0, slash) : absolutePath,
    relativePath: normalizePath(bootstrap.openedFile.relativePath),
    accessToken: bootstrap.openedFile.accessToken,
  };
}

async function suspendWorkspaceForTransition(): Promise<void> {
  await stopNotebookWatcher();
  completionTrainer?.cancelCurrentRun();
  completionTrainer = null;
  indexStore.reset();
  noteSelectionVersion++;
  externalSelectionVersion++;
  isNoteSwitching.value = false;
  saveGeneration++;
  notebookDataGeneration++;
  fileTreeRequestId++;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

async function commitWorkspaceHandle(
  handle: NotebookHandle,
  stagedFiles: DirEntry[] | null = null,
  transitionAlreadyStarted = false,
): Promise<void> {
  if (!transitionAlreadyStarted) await suspendWorkspaceForTransition();

  isScratchSession.value = false;
  workspaceGateStatus.value = null;
  workspaceGateError.value = '';
  activeNotebookRoot.value = normalizeOsPath(handle.rootPath);
  notebookName.value = handle.name || displayNameFromPath(handle.rootPath);
  activePath.value = '';
  contentRevision++;
  currentContent.value = '';
  currentDiskRevision.value = null;
  files.value = stagedFiles ?? [];
  currentDir.value = '/';
  customTemplates.value = [];
  errorMessage.value = '';
  isDirty.value = false;
  isSaving.value = false;
  clearSaveIssue();
  lastSavedAt.value = null;
  showLeftDrawer.value = false;
  showTemplate.value = false;
  showExport.value = false;
  showShare.value = false;
  showNewFileDialog.value = false;
  pendingDeletePath.value = null;
  searchVisible.value = false;
  updateHeadings('');
  updateEditorStats('');
  refreshSplitPreviewIfVisible();
  void restartNotebookWatcher(activeNotebookRoot.value);
}

async function enterWorkspaceGate(error = ''): Promise<void> {
  await stopNotebookWatcher();
  completionTrainer?.cancelCurrentRun();
  completionTrainer = null;
  indexStore.reset();
  noteSelectionVersion++;
  externalSelectionVersion++;
  isNoteSwitching.value = false;
  saveGeneration++;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  isScratchSession.value = false;
  externalSessionMode.value = 'none';
  void revokeExternalGrant(externalFile.value);
  externalFile.value = null;
  externalError.value = '';
  activeNotebookRoot.value = '';
  notebookDataGeneration++;
  activePath.value = '';
  contentRevision++;
  currentContent.value = '';
  currentDiskRevision.value = null;
  files.value = [];
  currentDir.value = '/';
  customTemplates.value = [];
  notebookName.value = '打开笔记本';
  errorMessage.value = '';
  isDirty.value = false;
  isSaving.value = false;
  clearSaveIssue();
  lastSavedAt.value = null;
  showLeftDrawer.value = false;
  showRightWing.value = true;
  showTemplate.value = false;
  showExport.value = false;
  showShare.value = false;
  showNewFileDialog.value = false;
  pendingDeletePath.value = null;
  searchVisible.value = false;
  workspaceGateError.value = error;
  workspaceGateStatus.value = error ? 'error' : 'idle';
  updateHeadings('');
  updateEditorStats('');
  refreshSplitPreviewIfVisible();
  await nextTick();
  await notebookOpenGateRef.value?.focusPrimary();
}

async function restoreWorkspaceAfterFailedBinding(previousRoot: string): Promise<void> {
  if (!previousRoot) return;
  const rollback = await fs.openNotebookAt(previousRoot);
  if (!notebookRootsEqual(rollback.rootPath, previousRoot)) {
    throw new Error('恢复后的笔记本根目录与原目录不一致');
  }
  activeNotebookRoot.value = normalizeOsPath(rollback.rootPath);
  await restartNotebookWatcher(activeNotebookRoot.value);
  void completeNotebookInitializationInBackground(activeNotebookRoot.value, notebookDataGeneration);
}

async function openNotebookRoot(rootPath: string): Promise<void> {
  const previousRoot = activeNotebookRoot.value;
  isScratchSession.value = false;
  await suspendWorkspaceForTransition();
  try {
    const handle = await fs.openNotebookAt(rootPath);
    await commitWorkspaceHandle(handle, null, true);
  } catch (error) {
    await restoreWorkspaceAfterFailedBinding(previousRoot);
    throw error;
  }
}

async function openNotebookFromExternalGrant(accessToken: string): Promise<void> {
  const openFromGrant = fs.openNotebookFromExternalGrant;
  if (!openFromGrant) throw new Error('当前桌面文件会话不支持外部目录授权');
  const previousRoot = activeNotebookRoot.value;
  isScratchSession.value = false;
  await suspendWorkspaceForTransition();
  try {
    const handle = await openFromGrant.call(fs, accessToken);
    await commitWorkspaceHandle(handle, null, true);
  } catch (error) {
    await restoreWorkspaceAfterFailedBinding(previousRoot);
    throw error;
  }
}

function markStartupReady(mode: 'workspace' | 'external' | 'gate'): void {
  if (performance.getEntriesByName('jotluck:shell-ready').length > 0) return;
  performance.mark('jotluck:shell-ready', { detail: { mode } });
  if (performance.getEntriesByName('jotluck:bootstrap-start').length === 0) return;
  performance.measure(
    'jotluck:cold-start-to-shell',
    'jotluck:bootstrap-start',
    'jotluck:shell-ready',
  );
}

async function stopNotebookWatcher(): Promise<void> {
  notebookWatchGeneration++;
  const e2eBridge = getJotLuckE2EBridge();
  if (e2eBridge) e2eBridge.emitFileChange = undefined;
  if (watcherRefreshTimer) {
    clearTimeout(watcherRefreshTimer);
    watcherRefreshTimer = null;
  }
  pendingWatcherEvents.splice(0);
  unwatchNotebook?.();
  unwatchNotebook = null;
  await fs.unwatchAll();
  await watcherFlushChain.catch(() => undefined);
}

function queueWatcherRefresh(
  event: FileChangeEvent | FileChangeEvent[],
  expectedRoot: string,
  expectedWatcherGeneration: number,
): void {
  if (
    expectedWatcherGeneration !== notebookWatchGeneration ||
    !notebookRootsEqual(expectedRoot, activeNotebookRoot.value)
  ) {
    return;
  }
  pendingWatcherEvents.push(...(Array.isArray(event) ? event : [event]));
  if (watcherRefreshTimer) clearTimeout(watcherRefreshTimer);
  watcherRefreshTimer = setTimeout(() => {
    watcherRefreshTimer = null;
    const events = pendingWatcherEvents.splice(0);
    watcherFlushChain = watcherFlushChain
      .catch(() => undefined)
      .then(() => flushWatcherEvents(events, expectedRoot, expectedWatcherGeneration));
  }, 120);
}

async function flushWatcherEvents(
  events: FileChangeEvent[],
  expectedRoot: string,
  expectedWatcherGeneration: number,
): Promise<void> {
  const isCurrentWatcher = () =>
    expectedWatcherGeneration === notebookWatchGeneration &&
    notebookRootsEqual(expectedRoot, activeNotebookRoot.value);
  if (
    events.length === 0 ||
    isScratchSession.value ||
    isExternalReadonly.value ||
    !isCurrentWatcher()
  )
    return;
  const active = normalizePath(activePath.value);
  const activeChange = summarizeActiveFileChanges(events, active);

  for (const event of events) {
    if (event.type === 'deleted' || event.type === 'renamed') {
      indexStore.removeDocument(event.oldPath ?? event.path);
    }
  }

  try {
    await refreshFileTree();
    if (!isCurrentWatcher()) return;
    for (const event of events) {
      const path = normalizePath(event.path);
      const fileName = path.split('/').pop() ?? '';
      if (
        (event.type === 'created' || event.type === 'modified' || event.type === 'renamed') &&
        isSupportedNoteFile(fileName)
      ) {
        await indexStore.refreshDocument(fs, path);
        if (!isCurrentWatcher()) return;
      }
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[NotebookHome] 文件监控刷新失败', error);
  }

  const requiresActiveRecheck =
    activeChange.destructive ||
    activeChange.changed ||
    events.some((event) => event.rescan || event.entryKind === 'directory');
  if (!active || !requiresActiveRecheck) return;

  const expectedContentRevision = contentRevision;
  const expectedLocalWriteEpoch = localWriteEpoch;
  let diskSnapshot: TextFileSnapshot;
  try {
    // A replacement may be reported as remove + rename, or even as remove before the matching
    // rename arrives. The final path is authoritative: if it is readable, the file was not lost.
    diskSnapshot = await fs.readFileSnapshot(active);
  } catch (error) {
    if (
      !isCurrentWatcher() ||
      normalizePath(activePath.value) !== active ||
      contentRevision !== expectedContentRevision ||
      localWriteEpoch !== expectedLocalWriteEpoch
    ) {
      return;
    }
    if (
      activeChange.destructive ||
      events.some(
        (event) =>
          event.rescan ||
          (event.entryKind === 'directory' &&
            (event.type === 'deleted' || event.type === 'renamed')),
      )
    ) {
      if (isDirty.value) {
        reportSaveIssue({
          kind: 'missing',
          source: 'workspace',
          path: active,
          actualRevision: null,
          message: '原文件已被移动或删除。本地草稿仍在；可以另存副本，或明确选择在原位置重建。',
        });
      } else {
        clearActiveNoteState();
      }
      return;
    }
    if (!isDirty.value) {
      reportSaveIssue(
        {
          kind: 'io',
          source: 'workspace',
          path: active,
          message: error instanceof Error ? error.message : String(error),
        },
        false,
      );
    }
    return;
  }

  if (
    !isCurrentWatcher() ||
    normalizePath(activePath.value) !== active ||
    isDirty.value ||
    contentRevision !== expectedContentRevision ||
    localWriteEpoch !== expectedLocalWriteEpoch
  ) {
    return;
  }
  contentRevision++;
  currentContent.value = diskSnapshot.content;
  currentDiskRevision.value = diskSnapshot.revision;
  clearSaveIssue();
  updateHeadings(diskSnapshot.content);
  updateEditorStats(diskSnapshot.content);
  refreshSplitPreviewIfVisible();
}

async function restartNotebookWatcher(rootPath: string): Promise<void> {
  const generation = ++notebookWatchGeneration;
  unwatchNotebook?.();
  unwatchNotebook = null;
  try {
    const handleFileChange = (event: FileChangeEvent | FileChangeEvent[]) =>
      queueWatcherRefresh(event, rootPath, generation);
    const unwatch = await fs.watch(rootPath, handleFileChange);
    if (generation !== notebookWatchGeneration) {
      unwatch();
      return;
    }
    unwatchNotebook = unwatch;
    const e2eBridge = getJotLuckE2EBridge();
    if (e2eBridge) e2eBridge.emitFileChange = handleFileChange;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[NotebookHome] 文件监控启动失败', error);
  }
}

let initialNotebookGateError = '';

async function openInitialNotebook(): Promise<boolean> {
  initialNotebookGateError = '';
  const forceGate = !isDesktopRuntime() && peekJotLuckE2EBridge()?.mockNotebook?.forceGate;

  let recent: string[] = [];
  try {
    recent = await fs.getRecentNotebooks();
  } catch (e) {
    initialNotebookGateError = '无法读取最近使用的笔记本，请重新选择文件夹。';
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
  if (recent.length > 0) {
    initialNotebookGateError = '最近使用的笔记本不可用，请重新选择文件夹。';
  }

  if (!isDesktopRuntime() && !forceGate) {
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

function enterNotebookFileState(path: string, content: string, revision: string): void {
  isScratchSession.value = false;
  externalSessionMode.value = 'none';
  void revokeExternalGrant(externalFile.value);
  externalFile.value = null;
  externalError.value = '';
  activePath.value = path;
  contentRevision++;
  currentContent.value = content;
  currentDiskRevision.value = revision;
  isDirty.value = false;
  isSaving.value = false;
  clearSaveIssue();
  lastSavedAt.value = Date.now();
  updateHeadings(content);
  updateEditorStats(content);
  scheduleSplitEditorMountForCurrentMode();
  refreshSplitPreviewIfVisible();
}

async function revisionForText(content: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(content),
  );
  return `sha256:${Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

async function readExternalNoteFileSnapshot(
  openedFile: OpenedFilePayload,
): Promise<TextFileSnapshot> {
  if (isDesktopRuntime()) {
    if (!openedFile.accessToken) throw new Error('External file grant is missing or expired');
    return withTimeout(
      invoke<TextFileSnapshot>('read_external_note_file_snapshot', {
        accessToken: openedFile.accessToken,
        relativePath: normalizePath(openedFile.relativePath),
      }),
      EXTERNAL_FILE_READ_TIMEOUT_MS,
      '打开外部文件',
    );
  }
  const filesByPath = peekJotLuckE2EBridge()?.externalFiles ?? {};
  if (Object.prototype.hasOwnProperty.call(filesByPath, openedFile.absolutePath)) {
    const content = filesByPath[openedFile.absolutePath] ?? '';
    return { content, revision: await revisionForText(content) };
  }
  const absolutePath = openedFile.absolutePath;
  throw new Error(`测试外部文件不存在: ${absolutePath}`);
}

async function writeExternalNoteFileIfUnchanged(
  openedFile: OpenedFilePayload,
  content: string,
  expectedRevision: string | null,
): Promise<ConditionalWriteResult> {
  if (isDesktopRuntime()) {
    if (!openedFile.accessToken) throw new Error('External file grant is missing or expired');
    return invoke<ConditionalWriteResult>('write_external_note_file_if_unchanged', {
      accessToken: openedFile.accessToken,
      relativePath: normalizePath(openedFile.relativePath),
      content,
      expectedRevision,
    });
  }
  const e2eBridge = getJotLuckE2EBridge();
  if (!e2eBridge) throw new Error('Web external file writes are available only in E2E mode');
  e2eBridge.externalFiles = e2eBridge.externalFiles ?? {};
  const hasCurrent = Object.prototype.hasOwnProperty.call(
    e2eBridge.externalFiles,
    openedFile.absolutePath,
  );
  const observedContent = hasCurrent
    ? (e2eBridge.externalFiles[openedFile.absolutePath] ?? '')
    : null;
  const actualRevision = observedContent === null ? null : await revisionForText(observedContent);
  if (
    (observedContent === null) !==
      !Object.prototype.hasOwnProperty.call(e2eBridge.externalFiles, openedFile.absolutePath) ||
    (observedContent !== null &&
      e2eBridge.externalFiles[openedFile.absolutePath] !== observedContent)
  ) {
    return writeExternalNoteFileIfUnchanged(openedFile, content, expectedRevision);
  }
  if (actualRevision !== expectedRevision) return { status: 'conflict', actualRevision };
  e2eBridge.externalFiles[openedFile.absolutePath] = content;
  e2eBridge.externalWrites = e2eBridge.externalWrites ?? [];
  e2eBridge.externalWrites.push({
    absolutePath: openedFile.absolutePath,
    content,
    time: Date.now(),
  });
  return { status: 'saved', revision: await revisionForText(content) };
}

async function revokeExternalGrant(openedFile: OpenedFilePayload | null): Promise<void> {
  if (!isDesktopRuntime() || !openedFile?.accessToken) return;
  try {
    await invoke('revoke_external_access', { accessToken: openedFile.accessToken });
  } catch {
    // Window teardown must not be blocked by an already-expired grant.
  }
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

function downloadCurrentContentAsMarkdown(fileName: string): void {
  const blob = new Blob([currentContent.value], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadScratchAsMarkdown(fileName: string): void {
  downloadCurrentContentAsMarkdown(fileName);
  toast.show('Web 预览已下载草稿；当前仍停留在临时草稿。', 'info', 3500);
}

async function enterNotebookFromSavedNote(savedFile: OpenedFilePayload): Promise<void> {
  const relativePath = normalizePath(savedFile.relativePath);
  if (isDesktopRuntime()) {
    if (!savedFile.accessToken) throw new Error('保存后的外部文件授权已失效');
    await openNotebookFromExternalGrant(savedFile.accessToken);
  } else {
    const { root } = splitAbsoluteFilePath(savedFile.absolutePath);
    await openNotebookRoot(root);
  }
  activePath.value = '';
  await loadDirectory('/');
  await indexStore.initialize(fs, true);
  wikiLinkRevision.value++;
  await onSelectNote(relativePath);
}

async function saveScratchAs(): Promise<boolean> {
  if (!isScratchSession.value) return false;
  const defaultFileName = ensureMarkdownExtension(getDraftMarkdownFileName(currentContent.value));

  if (!isDesktopRuntime()) {
    downloadScratchAsMarkdown(defaultFileName);
    isDirty.value = false;
    return true;
  }

  const savedFile = await invoke<OpenedFilePayload>('save_external_note_as', {
    defaultFileName,
    content: currentContent.value,
  });
  /*
    title: '保存临时草稿',
    defaultPath: defaultFileName,
    filters: [
      {
        name: 'Markdown',
        extensions: ['md', 'markdown', 'mdx', 'txt'],
      },
    ],
  });
  */
  await enterNotebookFromSavedNote(savedFile);

  toast.show('草稿已保存为笔记。', 'success', 2500);
  return true;
}

async function saveCurrentAsCopy(): Promise<boolean> {
  await imageUpload.waitForIdle();
  syncCurrentContentFromEditor();
  const wasExternalEditing = isExternalEditing.value;
  const sourcePath = isExternalEditing.value ? externalFile.value?.relativePath : activePath.value;
  const defaultFileName = ensureMarkdownExtension(
    basenameFromPath(sourcePath ?? '') || getDraftMarkdownFileName(currentContent.value),
  );

  if (!isDesktopRuntime()) {
    downloadCurrentContentAsMarkdown(defaultFileName);
    if (!isExternalEditing.value && sourcePath) clearPendingSaveForPath(sourcePath);
    lastSavedAt.value = Date.now();
    toast.show('副本已下载；原文件和本地草稿仍保持原样。', 'success', 3500);
    return true;
  }

  let savedFile: OpenedFilePayload;
  try {
    savedFile = await invoke<OpenedFilePayload>('save_external_note_as', {
      defaultFileName,
      content: currentContent.value,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/cancel(?:led|ed)?|取消/i.test(message)) {
      toast.show('已取消另存副本。', 'info', 2500);
    } else {
      toast.show(`另存副本失败：${message}`, 'error', 5000);
    }
    return false;
  }

  if (!isExternalEditing.value && sourcePath) clearPendingSaveForPath(sourcePath);
  lastSavedAt.value = Date.now();
  if (wasExternalEditing) {
    await revokeExternalGrant(savedFile);
    toast.show('副本已保存；原文件和本地草稿仍保持原样。', 'success', 3500);
    return true;
  }
  try {
    await enterNotebookFromSavedNote(savedFile);
    toast.show('副本已保存，并已打开它所在的文件夹。', 'success', 3000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toast.show(`副本已保存，但未能打开它所在的文件夹：${message}`, 'warning', 5000);
  }
  return true;
}

function externalAbsoluteFromRelative(relativePath: string): string {
  const root = externalFile.value?.notebookRoot;
  if (!root) throw new Error('外部文件根目录不可用');
  const rel = normalizePath(relativePath).replace(/^\/+/, '');
  return `${normalizeOsPath(root).replace(/\/+$/, '')}/${rel}`;
}

function externalFileKey(file: OpenedFilePayload | null): string {
  if (!file) return '';
  return `${file.accessToken ?? file.notebookRoot}:${normalizePath(file.relativePath)}`;
}

function openedFileFromRelative(relativePath: string): OpenedFilePayload {
  const root = externalFile.value?.notebookRoot;
  if (!root) throw new Error('外部文件根目录不可用');
  const normalizedRelativePath = normalizePath(relativePath);
  return {
    absolutePath: externalAbsoluteFromRelative(normalizedRelativePath),
    notebookRoot: normalizeOsPath(root),
    relativePath: normalizedRelativePath,
    accessToken: externalFile.value?.accessToken,
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

function exposeOnlyCurrentExternalFile(openedFile: OpenedFilePayload, content: string): void {
  const path = normalizePath(openedFile.relativePath);
  externalFiles.value = [
    {
      name: path.split('/').pop() ?? path,
      path,
      isDirectory: false,
      isFile: true,
      size: encodeContentSize(content),
      mtime: Date.now(),
    },
  ];
}

function syncCurrentContentFromEditor(): void {
  const view = editorRef.value?.getEditorView();
  if (!view) return;
  const content = view.state.doc.toString();
  if (content === currentContent.value) return;

  contentRevision++;
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

async function createTextFile(path: string, content: string): Promise<string> {
  const result = await fs.writeFileIfUnchanged(path, content, null);
  if (result.status === 'conflict') {
    throw new Error(`文件已存在：${path}`);
  }
  return result.revision;
}

async function flushPendingCurrentSave(): Promise<boolean> {
  syncCurrentContentFromEditor();
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!isDirty.value) {
    if (currentSavePromise) await currentSavePromise;
    return !saveError.value;
  }

  for (let attempt = 0; attempt < 3 && isDirty.value; attempt++) {
    const revision = contentRevision;
    const content = currentContent.value;
    const path = activePath.value;
    const externalSnapshot = externalFile.value ? { ...externalFile.value } : null;
    const saved =
      isExternalEditing.value && externalSnapshot
        ? await debouncedExternalSave(content, externalSnapshot, revision)
        : path
          ? await debouncedSave(path, content, revision)
          : currentSavePromise
            ? (await currentSavePromise, !saveError.value)
            : false;
    if (!saved) return false;
    if (
      revision === contentRevision &&
      path === activePath.value &&
      externalFileKey(externalSnapshot) === externalFileKey(externalFile.value)
    ) {
      break;
    }
  }
  return !isDirty.value && !saveError.value;
}

async function retryCurrentSave(): Promise<boolean> {
  syncCurrentContentFromEditor();
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  if (saveIssue.value?.kind === 'conflict' || saveIssue.value?.kind === 'missing') {
    unsavedDialogIntent.value = 'recover';
    showScratchExitDialog.value = true;
    return false;
  }

  if (isScratchSession.value) return saveScratchAs();
  if (isWorkspaceUnbound.value || isNotebookOpening.value) {
    requireBoundWorkspace('保存笔记');
    return false;
  }

  if (isExternalReadonly.value) return false;
  const externalSnapshot = externalFile.value ? { ...externalFile.value } : null;
  if (!isExternalEditing.value && !activePath.value) {
    toast.show('当前没有可保存的笔记。', 'info', 2500);
    return false;
  }
  if (isExternalEditing.value && !externalSnapshot) {
    toast.show('当前外部文件的写入授权已失效。', 'error', 4000);
    return false;
  }

  const revision = contentRevision;
  const content = currentContent.value;
  isDirty.value = true;

  const saved =
    isExternalEditing.value && externalSnapshot
      ? await debouncedExternalSave(content, externalSnapshot, revision)
      : activePath.value
        ? await debouncedSave(
            activePath.value,
            content,
            revision,
            activeNotebookRoot.value,
            notebookDataGeneration,
          )
        : false;

  if (!saved) {
    if (!saveError.value) {
      reportSaveIssue(
        {
          kind: 'io',
          source: isExternalEditing.value ? 'external' : 'workspace',
          path: isExternalEditing.value ? (externalSnapshot?.relativePath ?? '') : activePath.value,
          message: '当前笔记没有可写入的文件位置',
        },
        false,
      );
    }
    toast.show(`重新保存失败：${saveError.value}`, 'error', 4000);
  }
  return saved;
}

async function flushCurrentSaveOrBlock(reason: string): Promise<boolean> {
  await imageUpload.waitForIdle();
  await flushPendingCurrentSave();
  if (!isDirty.value && !saveError.value) return true;
  const message = saveError.value
    ? `${reason}失败：${saveError.value}`
    : `${reason}失败：当前内容尚未保存`;
  toast.show(message, 'error', 4000);
  return false;
}

function requireBoundWorkspace(action: string): boolean {
  if (
    activeNotebookRoot.value &&
    !isWorkspaceUnbound.value &&
    !isNotebookOpening.value &&
    !isExternalSession.value
  ) {
    return true;
  }

  const message = isNotebookOpening.value
    ? `正在切换笔记本，暂时不能${action}。`
    : `请先选择笔记本文件夹，再${action}。`;
  toast.show(message, 'warning', 3500);
  if (isWorkspaceUnbound.value) void notebookOpenGateRef.value?.focusPrimary();
  return false;
}

function requireFileBrowseSession(): boolean {
  if (isExternalEditing.value && !isNotebookOpening.value) return true;
  return requireBoundWorkspace('浏览文件');
}

let notebookOpenTask: Promise<void> | null = null;

function requestOpenNotebook(): Promise<void> {
  if (notebookOpenTask) return notebookOpenTask;
  const task = performOpenNotebook();
  void task.then(
    () => {
      if (notebookOpenTask === task) notebookOpenTask = null;
    },
    () => {
      if (notebookOpenTask === task) notebookOpenTask = null;
    },
  );
  notebookOpenTask = task;
  return task;
}

async function performOpenNotebook(): Promise<void> {
  if (isExternalSession.value) {
    toast.show('外部单文件会话请使用“添加到笔记”，不会自动扩大目录授权。', 'info', 4000);
    return;
  }

  const previousRoot = activeNotebookRoot.value;
  const startedFromGate = isWorkspaceUnbound.value;
  let shouldResumePreviousWatcher = false;
  if (startedFromGate) {
    workspaceGateStatus.value = 'opening';
    workspaceGateError.value = '';
  }

  try {
    // Selection is deliberately side-effect free. Cancelling the picker leaves the
    // old backend root, watcher, editor and all pending work untouched.
    const selection = await fs.selectNotebook();
    if (!selection) {
      if (startedFromGate) workspaceGateStatus.value = 'idle';
      return;
    }

    const nextRoot = normalizeOsPath(selection.rootPath);
    if (previousRoot && notebookRootsEqual(previousRoot, nextRoot)) {
      toast.show('当前已经是这个笔记本。', 'info', 2500);
      return;
    }

    if (previousRoot) isNoteSwitching.value = true;
    await imageUpload.waitForIdle();
    if (previousRoot && !(await flushCurrentSaveOrBlock('切换笔记本'))) {
      isNoteSwitching.value = false;
      return;
    }

    await suspendWorkspaceForTransition();
    shouldResumePreviousWatcher = Boolean(previousRoot);
    isNotebookOpening.value = true;

    const handle = await fs.openNotebookAt(selection.rootPath);

    let stagedFiles: DirEntry[];
    try {
      stagedFiles = await listDirectoryRecursive('/');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (previousRoot) {
        try {
          const rollback = await fs.openNotebookAt(previousRoot);
          if (!notebookRootsEqual(rollback.rootPath, previousRoot)) {
            throw new Error('恢复后的笔记本根目录与原目录不一致');
          }
          activeNotebookRoot.value = normalizeOsPath(rollback.rootPath);
          toast.show(`无法打开所选文件夹，已保留原笔记本：${message}`, 'error', 5000);
        } catch (rollbackError) {
          const rollbackMessage =
            rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
          await enterWorkspaceGate(`切换失败，且无法恢复原笔记本：${rollbackMessage}`);
        }
      } else {
        await enterWorkspaceGate(`无法打开所选文件夹：${message}`);
      }
      return;
    }

    await commitWorkspaceHandle(handle, stagedFiles, true);
    shouldResumePreviousWatcher = false;
    toast.show(previousRoot ? '已切换笔记本。' : '笔记本已打开。', 'success', 2500);
    void completeNotebookInitializationInBackground(
      activeNotebookRoot.value,
      notebookDataGeneration,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (previousRoot && shouldResumePreviousWatcher) {
      try {
        const rollback = await fs.openNotebookAt(previousRoot);
        if (!notebookRootsEqual(rollback.rootPath, previousRoot)) {
          throw new Error('恢复后的笔记本根目录与原目录不一致');
        }
        activeNotebookRoot.value = normalizeOsPath(rollback.rootPath);
      } catch (rollbackError) {
        const rollbackMessage =
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        await enterWorkspaceGate(`切换失败，且无法恢复原笔记本：${rollbackMessage}`);
        shouldResumePreviousWatcher = false;
      }
    }
    if (startedFromGate) {
      workspaceGateStatus.value = 'error';
      workspaceGateError.value = `无法打开笔记本：${message}`;
    } else {
      toast.show(`无法切换笔记本：${message}`, 'error', 5000);
    }
  } finally {
    isNotebookOpening.value = false;
    isNoteSwitching.value = false;
    if (
      shouldResumePreviousWatcher &&
      previousRoot &&
      notebookRootsEqual(activeNotebookRoot.value, previousRoot) &&
      !isWorkspaceUnbound.value
    ) {
      await restartNotebookWatcher(previousRoot);
    }
    if (workspaceGateStatus.value === 'opening') workspaceGateStatus.value = 'idle';
    if (isWorkspaceUnbound.value) {
      await nextTick();
      await notebookOpenGateRef.value?.focusPrimary();
    }
  }
}

function clearPendingSaveForPath(path: string): void {
  const normalized = normalizePath(path);
  if (normalizePath(activePath.value) === normalized) {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    saveGeneration++;
  }
}

async function enterExternalFileSession(
  openedFile: OpenedFilePayload,
  options: { setLoading?: boolean } = {},
): Promise<void> {
  const sessionGeneration = ++externalSessionGeneration;
  isNoteSwitching.value = true;
  await imageUpload.waitForIdle();
  if (!(await flushPendingCurrentSave())) {
    if (sessionGeneration === externalSessionGeneration) isNoteSwitching.value = false;
    return;
  }
  if (sessionGeneration !== externalSessionGeneration) {
    await revokeExternalGrant(openedFile);
    return;
  }
  await suspendWorkspaceForTransition();
  isNotebookOpening.value = true;
  const previousExternalFile = externalFile.value;
  if (
    previousExternalFile &&
    externalFileKey(previousExternalFile) !== externalFileKey(openedFile)
  ) {
    await revokeExternalGrant(previousExternalFile);
  }

  isScratchSession.value = false;
  const shouldSetLoading = options.setLoading ?? true;
  if (shouldSetLoading) loading.value = true;
  externalError.value = '';
  errorMessage.value = '';
  window.dispatchEvent(new CustomEvent('jotluck:external-file-opened'));
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
  activeNotebookRoot.value = '';
  customTemplates.value = [];
  notebookName.value = '外部文件';

  try {
    const snapshot = await readExternalNoteFileSnapshot(openedFile);
    if (sessionGeneration !== externalSessionGeneration) {
      await revokeExternalGrant(openedFile);
      return;
    }
    externalFile.value = openedFile;
    externalSessionMode.value = 'readonly';
    contentRevision++;
    currentContent.value = snapshot.content;
    currentDiskRevision.value = snapshot.revision;
    rememberExternalOpenedFile(openedFile);
    exposeOnlyCurrentExternalFile(openedFile, snapshot.content);
    isDirty.value = false;
    isSaving.value = false;
    clearSaveIssue();
    lastSavedAt.value = null;
    updateHeadings(snapshot.content);
    updateEditorStats(snapshot.content);
    scheduleSplitEditorMountForCurrentMode();
    updateExternalPreview();
  } catch (e) {
    if (sessionGeneration !== externalSessionGeneration) return;
    externalFile.value = openedFile;
    externalSessionMode.value = 'readonly';
    contentRevision++;
    currentContent.value = '';
    currentDiskRevision.value = null;
    exposeOnlyCurrentExternalFile(openedFile, '');
    externalError.value = `${openedFile.absolutePath}\n${e instanceof Error ? e.message : String(e)}`;
    updateHeadings('');
    updateEditorStats('');
    externalPreviewHtml.value = '';
  } finally {
    if (shouldSetLoading && sessionGeneration === externalSessionGeneration) {
      loading.value = false;
      markStartupReady('external');
    }
    if (sessionGeneration === externalSessionGeneration) {
      isNotebookOpening.value = false;
      isNoteSwitching.value = false;
    }
  }
}

async function initNotebook(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  let pendingOpenedFile: OpenedFilePayload | null = null;
  let notebookReady = false;
  try {
    pendingOpenedFile = await getPendingOpenedFile();
    if (pendingOpenedFile) {
      externalSessionMode.value = 'readonly';
      startupRouteResolved.value = true;
      await enterExternalFileSession(pendingOpenedFile, { setLoading: false });
      notebookReady = false;
      return;
    }

    let initialRelativePath: string | undefined;
    if (isDesktopRuntime()) {
      const bootstrap = await withTimeout(
        invoke<WindowBootstrapPayload>('get_window_bootstrap'),
        STARTUP_IPC_TIMEOUT_MS,
        '读取窗口启动信息',
      );
      if (bootstrap.mode !== 'workspace') {
        pendingOpenedFile = openedFileFromBootstrap(bootstrap);
        externalSessionMode.value = bootstrap.mode === 'external-edit' ? 'edit-shell' : 'readonly';
        startupRouteResolved.value = true;
        await enterExternalFileSession(pendingOpenedFile, { setLoading: false });
        externalSessionMode.value = bootstrap.mode === 'external-edit' ? 'edit-shell' : 'readonly';
        notebookReady = false;
        return;
      }
      if (bootstrap.mode === 'workspace') {
        initialRelativePath = bootstrap.initialRelativePath;
        if (initialRelativePath) {
          const root = await invoke<string | null>('get_notebook_root');
          if (!root) throw new Error('窗口笔记本根目录尚未初始化');
          await openNotebookRoot(root);
          notebookReady = true;
        }
      }
    }

    startupRouteResolved.value = true;
    if (!notebookReady) notebookReady = await openInitialNotebook();
    if (!notebookReady) {
      await enterWorkspaceGate(initialNotebookGateError);
      return;
    }
    if (initialRelativePath) {
      await loadDirectoryShallow('/');
      await onSelectNote(initialRelativePath);
      void completeNotebookInitializationInBackground(
        activeNotebookRoot.value,
        notebookDataGeneration,
      );
    } else {
      await loadDirectory('/');
    }
  } catch (e) {
    startupRouteResolved.value = true;
    const message = e instanceof Error ? e.message : String(e);
    await enterWorkspaceGate(`启动初始化失败：${message}`);
  } finally {
    loading.value = false;
    markStartupReady(notebookReady ? 'workspace' : 'gate');
  }
  if (!notebookReady) return;
  try {
    await indexStore.initialize(fs, true);
    await refreshCustomTemplates(true);
    wikiLinkRevision.value++;
    refreshSplitPreviewIfVisible();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[NotebookHome] indexStore.initialize 失败', e);
  }
}

async function refreshCustomTemplates(
  migrateLegacy = false,
  expectedRoot = activeNotebookRoot.value,
  expectedGeneration = notebookDataGeneration,
): Promise<void> {
  if (!activeNotebookRoot.value || isScratchSession.value || isExternalSession.value) {
    customTemplates.value = [];
    return;
  }
  try {
    if (migrateLegacy) await migrateLegacyCustomTemplates(fs);
    const nextTemplates = await loadCustomTemplatesFromFiles(fs);
    if (
      expectedGeneration !== notebookDataGeneration ||
      !notebookRootsEqual(expectedRoot, activeNotebookRoot.value)
    ) {
      return;
    }
    customTemplates.value = nextTemplates;
  } catch (e) {
    if (
      expectedGeneration !== notebookDataGeneration ||
      !notebookRootsEqual(expectedRoot, activeNotebookRoot.value)
    ) {
      return;
    }
    customTemplates.value = [];
    // eslint-disable-next-line no-console
    console.warn('[NotebookHome] 自定义模板加载失败', e);
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
  contentRevision++;
  currentContent.value = '';
  currentDiskRevision.value = null;
  isDirty.value = false;
  isSaving.value = false;
  clearSaveIssue();
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
  const entries = (await fs.listDirectory(normalized)).filter(
    (entry) =>
      !entry.name.startsWith('.') &&
      (!entry.isDirectory || !isIgnoredNotebookDirectory(entry.name)),
  );
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

async function refreshFileTree(
  expectedRoot = activeNotebookRoot.value,
  expectedGeneration = notebookDataGeneration,
): Promise<boolean> {
  const requestId = ++fileTreeRequestId;
  const nextFiles = await listDirectoryRecursive('/');
  if (
    requestId !== fileTreeRequestId ||
    expectedGeneration !== notebookDataGeneration ||
    !notebookRootsEqual(expectedRoot, activeNotebookRoot.value)
  ) {
    return false;
  }
  files.value = nextFiles;
  const existingPaths = nextFiles
    .filter((entry) => entry.isFile && isSupportedNoteFile(entry.name))
    .map((entry) => normalizePath(entry.path));
  indexStore.synchronizeFromFileTree(existingPaths);
  wikiLinkRevision.value++;
  return true;
}

async function loadDirectory(dir: string): Promise<void> {
  const expectedRoot = activeNotebookRoot.value;
  const expectedGeneration = notebookDataGeneration;
  if (await refreshFileTree(expectedRoot, expectedGeneration)) {
    currentDir.value = normalizeDir(dir);
  }
}

async function loadDirectoryShallow(dir: string): Promise<void> {
  const normalized = normalizeDir(dir);
  const expectedRoot = activeNotebookRoot.value;
  const expectedGeneration = notebookDataGeneration;
  const requestId = ++fileTreeRequestId;
  const nextFiles = (await fs.listDirectory(normalized)).filter(
    (entry) =>
      !entry.name.startsWith('.') &&
      (!entry.isDirectory || !isIgnoredNotebookDirectory(entry.name)),
  );
  if (
    requestId !== fileTreeRequestId ||
    expectedGeneration !== notebookDataGeneration ||
    !notebookRootsEqual(expectedRoot, activeNotebookRoot.value)
  ) {
    return;
  }
  currentDir.value = normalized;
  files.value = nextFiles;
}

async function completeNotebookInitializationInBackground(
  expectedRoot: string,
  expectedGeneration: number,
): Promise<void> {
  try {
    const requestId = ++fileTreeRequestId;
    const nextFiles = await listDirectoryRecursive('/');
    if (
      requestId !== fileTreeRequestId ||
      expectedGeneration !== notebookDataGeneration ||
      expectedRoot !== activeNotebookRoot.value
    ) {
      return;
    }
    files.value = nextFiles;
    wikiLinkRevision.value++;

    await indexStore.initialize(fs, true);
    if (
      expectedGeneration !== notebookDataGeneration ||
      expectedRoot !== activeNotebookRoot.value
    ) {
      return;
    }
    await refreshCustomTemplates(true, expectedRoot, expectedGeneration);
    if (
      expectedGeneration !== notebookDataGeneration ||
      !notebookRootsEqual(expectedRoot, activeNotebookRoot.value)
    ) {
      return;
    }
    connectPredictor();
  } catch (error) {
    if (
      expectedGeneration !== notebookDataGeneration ||
      expectedRoot !== activeNotebookRoot.value
    ) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    toast.show(`笔记本后台扫描未完成：${message}`, 'warning', 5000);
  }
}

function onDrawerNavigateDir(path: string): void {
  currentDir.value = normalizeDir(path);
}

// --- File Operations ---
async function onSelectNote(path: string): Promise<void> {
  const selectionVersion = ++noteSelectionVersion;
  isNoteSwitching.value = true;
  const task = noteSelectionQueue
    .catch(() => undefined)
    .then(() => {
      if (selectionVersion !== noteSelectionVersion) return;
      return selectNoteNow(path, selectionVersion);
    })
    .finally(() => {
      if (selectionVersion === noteSelectionVersion) isNoteSwitching.value = false;
    });
  noteSelectionQueue = task.catch(() => undefined);
  await task;
}

async function selectNoteNow(path: string, selectionVersion: number): Promise<void> {
  // Existing uploads own the current note. Finish them while that note and editor
  // are still valid, then capture their inserted Markdown in the final save.
  await imageUpload.waitForIdle();
  if (selectionVersion !== noteSelectionVersion) return;
  // Flush any pending save before switching notes
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  syncCurrentContentFromEditor();
  // 防御性刷新：即使 saveTimer 已触发但 debouncedSave 尚未完成，
  // 只要 isDirty 为 true 就执行保存，确保内容不丢失
  if (!(await flushPendingCurrentSave())) return;

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
  clearSaveIssue();

  // Read content BEFORE setting activePath — prevents editor mounting with empty content
  // while onMounted is still async (predictor.initialize blocking view creation).
  let snapshot: TextFileSnapshot;
  try {
    snapshot = await fs.readFileSnapshot(path);
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

  // Close the drawer in the same synchronous commit as the selected content. Index refresh below
  // must not overwrite a later user action that reopens the drawer.
  showLeftDrawer.value = false;

  // Now set reactive state — editor mounts with content already available
  isScratchSession.value = false;
  activePath.value = path;
  contentRevision++;
  currentContent.value = snapshot.content;
  currentDiskRevision.value = snapshot.revision;

  const dir = path.substring(0, path.lastIndexOf('/') + 1) || '/';
  currentDir.value = normalizeDir(dir);
  updateHeadings(snapshot.content);
  updateEditorStats(snapshot.content);
  refreshSplitPreviewIfVisible();
  try {
    await indexStore.refreshDocument(fs, path);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[NotebookHome] indexStore.refreshDocument 失败', e);
  }
  loading.value = false;
}

async function onSelectExternalNote(path: string): Promise<void> {
  const selectionVersion = ++externalSelectionVersion;
  const normalizedPath = normalizePath(path);
  const entry = externalFiles.value.find((item) => normalizePath(item.path) === normalizedPath);

  if (entry?.isDirectory) {
    toast.show('单文件编辑不会扫描所在文件夹；请使用“添加到笔记”管理目录。', 'info', 3500);
    return;
  }

  const fileName = normalizedPath.split('/').pop() ?? normalizedPath;
  if (!isSupportedNoteFile(fileName)) {
    toast.show(`外部编辑仅支持 ${supportedNoteExtensionsText} 文件`, 'warning', 3000);
    return;
  }

  isNoteSwitching.value = true;
  await imageUpload.waitForIdle();
  if (selectionVersion !== externalSelectionVersion) return;
  if (!(await flushPendingCurrentSave())) {
    if (selectionVersion === externalSelectionVersion) isNoteSwitching.value = false;
    return;
  }
  if (selectionVersion !== externalSelectionVersion) return;
  loading.value = true;
  errorMessage.value = '';
  clearSaveIssue();
  isSaving.value = false;

  try {
    const openedFile =
      externalOpenedFileMap.value[normalizedPath] ?? openedFileFromRelative(normalizedPath);
    const snapshot = await readExternalNoteFileSnapshot(openedFile);
    if (selectionVersion !== externalSelectionVersion) return;
    externalFile.value = openedFile;
    contentRevision++;
    currentContent.value = snapshot.content;
    currentDiskRevision.value = snapshot.revision;
    rememberExternalOpenedFile(openedFile);
    isDirty.value = false;
    lastSavedAt.value = null;
    updateHeadings(snapshot.content);
    updateEditorStats(snapshot.content);
    refreshSplitPreviewIfVisible();
    showLeftDrawer.value = false;
    void nextTick(() => editorRef.value?.focus());
  } catch (e) {
    if (selectionVersion !== externalSelectionVersion) return;
    reportSaveIssue(
      {
        kind: 'io',
        source: 'external',
        path: normalizedPath,
        message: e instanceof Error ? e.message : String(e),
      },
      false,
    );
    toast.show(`打开外部文件失败：${saveError.value}`, 'error', 4000);
  } finally {
    if (selectionVersion === externalSelectionVersion) {
      loading.value = false;
      isNoteSwitching.value = false;
    }
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
  if (!requireFileBrowseSession()) return;
  showLeftDrawer.value = !showLeftDrawer.value;
}

function onOpenPalette(): void {
  if (isExternalEditing.value) {
    toast.show('单文件编辑未扫描所在文件夹，搜索和标签不会读取其他文件。', 'info', 3500);
    return;
  }
  if (!requireBoundWorkspace('搜索笔记')) return;
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
  if (!requireBoundWorkspace('新建笔记')) return;
  showTemplate.value = true;
}

async function onShellDrawerNavigateDir(path: string): Promise<void> {
  if (isExternalEditing.value) {
    toast.show('单文件编辑不浏览所在目录；请先添加到笔记。', 'info', 3000);
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
  if (!requireBoundWorkspace('新建文件')) return;
  await onCreateFile();
}

async function onShellDrawerRetry(): Promise<void> {
  if (isExternalEditing.value) {
    return;
  }
  await initNotebook();
}

function requestShellDeleteFile(path: string): void {
  if (isExternalEditing.value) {
    toast.show('外部单文件编辑不删除文件。', 'warning', 3000);
    return;
  }
  if (!requireBoundWorkspace('删除文件')) return;
  requestDeleteFile(path);
}

async function onShellRenameFile(oldPath: string, newName: string): Promise<void> {
  if (isExternalEditing.value) {
    toast.show('外部单文件编辑不重命名文件。', 'warning', 3000);
    return;
  }
  if (!requireBoundWorkspace('重命名文件')) return;
  try {
    await onRenameFile(oldPath, newName);
  } catch (error) {
    toast.show(
      `重命名失败：${error instanceof Error ? error.message : String(error)}`,
      'error',
      4000,
    );
  }
}

async function onDeleteFile(path: string): Promise<void> {
  if (!requireBoundWorkspace('删除文件')) return;
  const normalizedPath = normalizePath(path);
  if (normalizePath(activePath.value) === normalizedPath) {
    if (!(await flushPendingCurrentSave())) return;
  }
  clearPendingSaveForPath(path);
  await fs.deleteFile(path);
  if (normalizePath(activePath.value) === normalizedPath) {
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
  if (!requireBoundWorkspace('删除文件')) return;
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
  if (!requireBoundWorkspace('重命名文件')) return;
  if (!isSupportedNoteFile(newName)) {
    toast.show(`仅支持 ${supportedNoteExtensionsText} 文件`, 'warning', 3000);
    return;
  }
  const renamingActivePath = normalizePath(activePath.value) === normalizePath(oldPath);
  if (renamingActivePath && !(await flushCurrentSaveOrBlock('重命名'))) return;
  // 从旧路径提取父目录，避免 currentDir 尾斜杠不一致导致路径错误
  const parentDir = oldPath.substring(0, oldPath.lastIndexOf('/') + 1) || '/';
  const newPath = joinPath(parentDir, newName);
  clearPendingSaveForPath(oldPath);
  await fs.renameFile(oldPath, newPath);
  completionTrainer?.renamePath(oldPath, newPath);
  if (renamingActivePath) activePath.value = newPath;
  // 更新索引：移除旧路径，索引新路径
  indexStore.removeDocument(oldPath);
  await indexStore.refreshDocument(fs, newPath);
  await refreshFileTree();
}

async function onCreateFile(): Promise<void> {
  if (!requireBoundWorkspace('新建文件')) return;
  newFileName.value = '新笔记.md';
  showNewFileDialog.value = true;
}

async function confirmNewFile(): Promise<void> {
  if (!requireBoundWorkspace('新建文件')) return;
  const name = newFileName.value.trim();
  if (!name) return;
  if (!isSupportedNoteFile(name)) {
    toast.show(`仅支持 ${supportedNoteExtensionsText} 文件`, 'warning', 3000);
    return;
  }
  showNewFileDialog.value = false;
  const requestedDirectory = currentDir.value;
  const content = isMarkdownLikeFile(name) ? `# ${stripSupportedNoteExtension(name)}\n\n` : '';
  isNoteSwitching.value = true;
  try {
    if (!(await flushCurrentSaveOrBlock('新建文件'))) return;
    const expectedRoot = activeNotebookRoot.value;
    const expectedGeneration = notebookDataGeneration;
    const path = joinPath(requestedDirectory, name);
    const revision = await createTextFile(path, content);
    if (
      expectedGeneration !== notebookDataGeneration ||
      !notebookRootsEqual(expectedRoot, activeNotebookRoot.value)
    ) {
      return;
    }
    if (!(await refreshFileTree(expectedRoot, expectedGeneration))) return;
    await indexStore.refreshDocument(fs, path);
    if (
      expectedGeneration !== notebookDataGeneration ||
      !notebookRootsEqual(expectedRoot, activeNotebookRoot.value)
    ) {
      return;
    }
    void trainCurrentFile(path, content);
    enterNotebookFileState(path, content, revision);
  } catch (error) {
    toast.show(
      `新建文件失败：${error instanceof Error ? error.message : String(error)}`,
      'error',
      4000,
    );
  } finally {
    isNoteSwitching.value = false;
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
      splitPreviewHtml.value = renderMarkdown(content, {
        wikiLinkExists,
        resolveImageSrc: previewImages.resolveImageSrc,
      });
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

function confirmExternalEdit(): void {
  if (!externalFile.value || externalError.value) return;
  showExternalEditConfirm.value = false;
  externalSessionMode.value = 'edit-shell';
  showRightWing.value = true;
  clearSaveIssue();
  void nextTick(() => editorRef.value?.focus());
}

async function enableExternalEdit(): Promise<void> {
  if (!externalFile.value || externalError.value) return;
  try {
    if (isDesktopRuntime()) await invoke('enable_external_edit');
    confirmExternalEdit();
  } catch (error) {
    externalError.value = error instanceof Error ? error.message : String(error);
  }
}

async function openExternalParentAsNotebook(): Promise<void> {
  if (!externalFile.value) return;
  const target = externalFile.value;
  isNoteSwitching.value = true;
  await imageUpload.waitForIdle();
  if (!(await flushPendingCurrentSave())) {
    isNoteSwitching.value = false;
    return;
  }
  syncCurrentContentFromEditor();
  const preservedDraft = currentContent.value;
  await suspendWorkspaceForTransition();
  isNotebookOpening.value = true;
  loading.value = true;
  externalError.value = '';
  let workspaceCommitted = false;
  try {
    let initialRelativePath = target.relativePath;
    if (!isDesktopRuntime()) {
      const handle = await fs.openNotebookAt('/');
      await commitWorkspaceHandle(handle, null, true);
      workspaceCommitted = true;
      await hydrateMockNotebookFromExternalFiles(target.notebookRoot);
    } else {
      const promoted = await invoke<PromotedNotebookPayload>('promote_external_file_to_notebook');
      await commitWorkspaceHandle({ rootPath: promoted.rootPath, name: promoted.name }, null, true);
      workspaceCommitted = true;
      initialRelativePath = normalizePath(promoted.initialRelativePath);
    }
    await loadDirectoryShallow('/');
    wikiLinkRevision.value++;
    await onSelectNote(initialRelativePath);
    if (normalizePath(activePath.value) !== normalizePath(initialRelativePath)) {
      throw new Error('目标文件在切换期间不可读取');
    }
    await revokeExternalGrant(target);
    externalSessionMode.value = 'none';
    externalFile.value = null;
    externalFiles.value = [];
    externalOpenedNotes.value = [];
    externalOpenedFileMap.value = {};
    await nextTick();
    editorRef.value?.focus();
    void completeNotebookInitializationInBackground(
      activeNotebookRoot.value,
      notebookDataGeneration,
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (workspaceCommitted) {
      void revokeExternalGrant(target);
      isScratchSession.value = true;
      externalSessionMode.value = 'none';
      externalFile.value = null;
      externalFiles.value = [];
      externalOpenedNotes.value = [];
      externalOpenedFileMap.value = {};
      activePath.value = '';
      contentRevision++;
      currentContent.value = preservedDraft;
      currentDiskRevision.value = null;
      isDirty.value = preservedDraft.trim().length > 0;
      clearSaveIssue();
      errorMessage.value = message;
      updateHeadings(preservedDraft);
      updateEditorStats(preservedDraft);
      refreshSplitPreviewIfVisible();
      toast.show('目标文件暂时无法打开，原内容已保留为临时草稿。', 'error', 6000);
    } else {
      externalError.value = message;
    }
  } finally {
    loading.value = false;
    isNotebookOpening.value = false;
    isNoteSwitching.value = false;
  }
}

function scrollExternalHeading(id: string): void {
  const target = document.getElementById(id);
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function ensureNotebookDirectoryPath(path: string): Promise<void> {
  const normalized = normalizePath(path);
  if (normalized === '/') return;
  const segments = normalized.split('/').filter(Boolean);
  let cursor = '';
  for (const segment of segments) {
    cursor = `${cursor}/${segment}`;
    await fs.createDirectory(cursor);
  }
}

async function hydrateMockNotebookFromExternalFiles(rootPath: string): Promise<void> {
  if (isDesktopRuntime()) return;
  const filesByPath = peekJotLuckE2EBridge()?.externalFiles;
  if (!filesByPath) return;
  const normalizedRoot = normalizeOsPath(rootPath).replace(/\/+$/, '');
  for (const [absolutePath, content] of Object.entries(filesByPath)) {
    const normalizedPath = normalizeOsPath(absolutePath);
    if (!normalizedPath.startsWith(`${normalizedRoot}/`)) continue;
    const relativePath = normalizePath(`/${normalizedPath.slice(normalizedRoot.length + 1)}`);
    const fileName = relativePath.split('/').pop() ?? '';
    if (!isSupportedNoteFile(fileName)) continue;
    await ensureNotebookDirectoryPath(parentDirFromPath(relativePath));
    await fs.writeFile(relativePath, content);
  }
}

// --- Content Updates ---
function onContentUpdate(content: string): void {
  if (
    !isScratchSession.value &&
    (!activeNotebookRoot.value || isWorkspaceUnbound.value || isInteractionLocked.value)
  ) {
    requireBoundWorkspace('编辑笔记');
    return;
  }
  const revision = ++contentRevision;
  currentContent.value = content;
  updateHeadings(content);
  updateEditorStats(content);
  if (isScratchSession.value) {
    isDirty.value = content.trim().length > 0;
    clearSaveIssue();
    refreshSplitPreviewIfVisible();
    return;
  }
  if (activePath.value) {
    isDirty.value = true;
    clearTransientSaveIssueOnEdit();
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (isAutosavePausedForDiskIssue()) return;
    const savingPath = activePath.value;
    const savingRoot = activeNotebookRoot.value;
    const savingGeneration = notebookDataGeneration;
    saveTimer = setTimeout(
      () => void debouncedSave(savingPath, content, revision, savingRoot, savingGeneration),
      600,
    );
  }
}

function onExternalContentUpdate(content: string): void {
  if (isInteractionLocked.value) return;
  const revision = ++contentRevision;
  currentContent.value = content;
  updateHeadings(content);
  updateEditorStats(content);
  if (externalFile.value) {
    isDirty.value = true;
    clearTransientSaveIssueOnEdit();
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (isAutosavePausedForDiskIssue()) return;
    const savingFile = { ...externalFile.value };
    saveTimer = setTimeout(() => void debouncedExternalSave(content, savingFile, revision), 600);
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

async function debouncedSave(
  path: string,
  content: string,
  revision = contentRevision,
  expectedRoot = activeNotebookRoot.value,
  expectedWorkspaceGeneration = notebookDataGeneration,
  expectedRevisionOverride?: string | null,
): Promise<boolean> {
  const previousSave = currentSavePromise;
  const saveTask = (async () => {
    if (previousSave) await previousSave.catch(() => undefined);
    const gen = ++saveGeneration;
    isSaving.value = true;
    const start = Date.now();
    try {
      if (
        !expectedRoot ||
        !activeNotebookRoot.value ||
        isWorkspaceUnbound.value ||
        isNotebookOpening.value ||
        expectedWorkspaceGeneration !== notebookDataGeneration ||
        !notebookRootsEqual(expectedRoot, activeNotebookRoot.value) ||
        normalizePath(path) !== normalizePath(activePath.value)
      ) {
        throw new Error('笔记本已取消绑定或正在切换，已拒绝过期写入');
      }
      if (forcedE2ESaveFailure) {
        const message = forcedE2ESaveFailure;
        forcedE2ESaveFailure = null;
        throw new Error(message);
      }
      const expectedRevision =
        expectedRevisionOverride === undefined
          ? currentDiskRevision.value
          : expectedRevisionOverride;
      const result = await fs.writeFileIfUnchanged(path, content, expectedRevision);
      if (result.status === 'conflict') {
        const kind = result.actualRevision === null ? 'missing' : 'conflict';
        reportSaveIssue({
          kind,
          source: 'workspace',
          path,
          actualRevision: result.actualRevision,
          message:
            kind === 'missing'
              ? '原文件已不存在。本地草稿仍在；可以另存副本，或明确选择在原位置重建。'
              : '原文件已被其他程序或窗口修改。JotLuck 已停止覆盖，本地草稿仍完整保留。',
        });
        return false;
      }
      if (gen !== saveGeneration) return true;
      currentDiskRevision.value = result.revision;
      localWriteEpoch++;
      clearSaveIssue();
      try {
        await indexStore.refreshDocument(fs, path);
      } catch (error) {
        // The file is already safely written; an index refresh must not turn it into a save failure.
        // eslint-disable-next-line no-console
        console.warn('[NotebookHome] 保存后索引刷新失败', error);
      }
      void trainCurrentFile(path, content);
      if (gen !== saveGeneration) return true;
      wikiLinkRevision.value++;
      lastSavedAt.value = Date.now();
      const elapsed = Date.now() - start;
      if (elapsed < 500) await new Promise((r) => setTimeout(r, 500 - elapsed));
      if (gen !== saveGeneration) return true;
      if (activePath.value === path && contentRevision === revision) isDirty.value = false;
      return true;
    } catch (e) {
      if (gen === saveGeneration) {
        reportSaveIssue(
          {
            kind: 'io',
            source: 'workspace',
            path,
            message: e instanceof Error ? e.message : String(e),
          },
          false,
        );
      }
      return false;
    } finally {
      if (gen === saveGeneration) isSaving.value = false;
    }
  })();
  currentSavePromise = saveTask;
  try {
    return await saveTask;
  } finally {
    if (currentSavePromise === saveTask) currentSavePromise = null;
  }
}

async function debouncedExternalSave(
  content: string,
  openedFile: OpenedFilePayload,
  revision = contentRevision,
  expectedRevisionOverride?: string | null,
): Promise<boolean> {
  const previousSave = currentSavePromise;
  const saveTask = (async () => {
    if (previousSave) await previousSave.catch(() => undefined);
    const gen = ++saveGeneration;
    isSaving.value = true;
    const start = Date.now();
    try {
      if (externalFileKey(externalFile.value) !== externalFileKey(openedFile)) {
        return false;
      }
      const expectedRevision =
        expectedRevisionOverride === undefined
          ? currentDiskRevision.value
          : expectedRevisionOverride;
      const result = await writeExternalNoteFileIfUnchanged(openedFile, content, expectedRevision);
      if (result.status === 'conflict') {
        const kind = result.actualRevision === null ? 'missing' : 'conflict';
        reportSaveIssue({
          kind,
          source: 'external',
          path: openedFile.relativePath,
          actualRevision: result.actualRevision,
          message:
            kind === 'missing'
              ? '原文件已不存在。本地草稿仍在；可以另存副本，或明确选择在原位置重建。'
              : '原文件已被其他程序或窗口修改。JotLuck 已停止覆盖，本地草稿仍完整保留。',
        });
        return false;
      }
      if (gen !== saveGeneration) return true;
      currentDiskRevision.value = result.revision;
      localWriteEpoch++;
      clearSaveIssue();
      lastSavedAt.value = Date.now();
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise((r) => setTimeout(r, 300 - elapsed));
      if (gen !== saveGeneration) return true;
      if (
        externalFileKey(externalFile.value) === externalFileKey(openedFile) &&
        contentRevision === revision
      ) {
        isDirty.value = false;
      }
      return true;
    } catch (e) {
      if (gen === saveGeneration) {
        reportSaveIssue(
          {
            kind: 'io',
            source: 'external',
            path: openedFile.relativePath,
            message: e instanceof Error ? e.message : String(e),
          },
          false,
        );
      }
      return false;
    } finally {
      if (gen === saveGeneration) isSaving.value = false;
    }
  })();
  currentSavePromise = saveTask;
  try {
    return await saveTask;
  } finally {
    if (currentSavePromise === saveTask) currentSavePromise = null;
  }
}

// --- Format Bubble ---
const FORMAT_HINT_KEY = 'jotluck:formatBubble:hintShown';

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
async function onSearchSelectResult(result: SearchResult): Promise<void> {
  searchVisible.value = false;
  await onShellSelectNote(result.notePath);
  if (normalizePath(activePath.value) !== normalizePath(result.notePath)) return;

  const match = result.matches[0];
  if (!match) return;
  await nextTick();
  await nextTick();

  const view = editorRef.value?.getEditorView();
  if (!view) return;
  const doc = view.state.doc;
  let offset = -1;

  if (match.line >= 1 && match.line <= doc.lines && match.column >= 1) {
    const line = doc.line(match.line);
    const candidate = line.from + match.column - 1;
    if (
      candidate <= line.to &&
      (!match.text || doc.sliceString(candidate, candidate + match.text.length) === match.text)
    ) {
      offset = candidate;
    }
  }

  if (offset < 0 && match.text) {
    offset = doc.toString().indexOf(match.text);
  }
  if (offset < 0) return;

  let selectionChangeVersion = 0;
  let navigationInterrupted = false;
  const navigationDoc = view.state.doc;
  const onProgrammaticSelectionChange = (): void => {
    const activeElement = document.activeElement;
    if (activeElement instanceof Node && view.dom.contains(activeElement)) {
      selectionChangeVersion += 1;
    }
  };
  const onNavigationInterrupt = (): void => {
    navigationInterrupted = true;
  };
  document.addEventListener('selectionchange', onProgrammaticSelectionChange, true);
  view.dom.addEventListener('pointerdown', onNavigationInterrupt, true);
  view.dom.addEventListener('keydown', onNavigationInterrupt, true);
  view.dom.addEventListener('beforeinput', onNavigationInterrupt, true);
  view.dom.addEventListener('compositionstart', onNavigationInterrupt, true);

  try {
    // Reveal the source before focus can map a selection inside a replacement
    // widget back to the Markdown block boundary (notably in Firefox).
    revealLivePreviewSourceAt(view, offset);
    view.focus();

    let lastSelectionChangeVersion = selectionChangeVersion;
    let observedEditorSelectionChange = false;
    let quietFrames = 0;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (
        editorRef.value?.getEditorView() !== view ||
        normalizePath(activePath.value) !== normalizePath(result.notePath) ||
        view.state.doc !== navigationDoc ||
        navigationInterrupted
      ) {
        return;
      }

      const selectionChanged = selectionChangeVersion !== lastSelectionChangeVersion;
      if (selectionChanged) {
        observedEditorSelectionChange = true;
        lastSelectionChangeVersion = selectionChangeVersion;
        quietFrames = 0;
      }

      if (!view.hasFocus) {
        revealLivePreviewSourceAt(view, offset);
        view.focus();
        quietFrames = 0;
        continue;
      }
      if (view.state.selection.main.head !== offset) {
        revealLivePreviewSourceAt(view, offset);
        quietFrames = 0;
        continue;
      }

      if (!selectionChanged) quietFrames += 1;
      if (
        (observedEditorSelectionChange && quietFrames >= 6) ||
        (!observedEditorSelectionChange && quietFrames >= 12)
      ) {
        break;
      }
    }

    // Reassert once after the quiet window so the handler has one exact,
    // observable terminal state even if Firefox published an old DOM selection.
    revealLivePreviewSourceAt(view, offset);
  } finally {
    document.removeEventListener('selectionchange', onProgrammaticSelectionChange, true);
    view.dom.removeEventListener('pointerdown', onNavigationInterrupt, true);
    view.dom.removeEventListener('keydown', onNavigationInterrupt, true);
    view.dom.removeEventListener('beforeinput', onNavigationInterrupt, true);
    view.dom.removeEventListener('compositionstart', onNavigationInterrupt, true);
  }
}
function onQuickAction(action: 'new-note' | 'export' | 'settings'): void {
  searchVisible.value = false;
  if (action === 'new-note') onShellCreateNote();
  else if (action === 'export' && requireBoundWorkspace('导出')) showExport.value = true;
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
  if (isExternalEditing.value) {
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
  if (isExternalEditing.value) {
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
async function onSaveCustomTemplate(name: string, description: string): Promise<void> {
  if (!requireBoundWorkspace('保存自定义模板')) return;
  if (!canSaveCurrentAsTemplate.value) {
    toast.show(
      customTemplateDisabledReason.value || '当前状态不能保存自定义模板。',
      'warning',
      3000,
    );
    return;
  }
  try {
    await saveCustomTemplateToFiles(fs, name, description, currentContent.value);
    await refreshCustomTemplates();
    toast.show('模板已保存到当前笔记本。', 'success', 2500);
  } catch (e) {
    toast.show(`模板保存失败：${e instanceof Error ? e.message : String(e)}`, 'error', 4000);
  }
}

async function onDeleteCustomTemplate(id: string): Promise<void> {
  if (!requireBoundWorkspace('删除模板')) return;
  try {
    await deleteCustomTemplateFile(fs, id);
    await refreshCustomTemplates();
    toast.show('模板已删除。', 'success', 2500);
  } catch (e) {
    toast.show(`模板删除失败：${e instanceof Error ? e.message : String(e)}`, 'error', 4000);
  }
}

async function onTemplateSelect(_tpl: unknown, content: string): Promise<void> {
  if (!requireBoundWorkspace('从模板新建笔记')) return;
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const name = titleMatch?.[1]?.trim() || '新笔记';
  const path = `/${name}.md`;
  showTemplate.value = false;
  isNoteSwitching.value = true;
  try {
    if (!(await flushCurrentSaveOrBlock('从模板新建笔记'))) return;
    const expectedRoot = activeNotebookRoot.value;
    const expectedGeneration = notebookDataGeneration;
    const revision = await createTextFile(path, content);
    if (
      expectedGeneration !== notebookDataGeneration ||
      !notebookRootsEqual(expectedRoot, activeNotebookRoot.value)
    ) {
      return;
    }
    if (!(await refreshFileTree(expectedRoot, expectedGeneration))) return;
    await indexStore.refreshDocument(fs, path);
    if (
      expectedGeneration !== notebookDataGeneration ||
      !notebookRootsEqual(expectedRoot, activeNotebookRoot.value)
    ) {
      return;
    }
    void trainCurrentFile(path, content);
    enterNotebookFileState(path, content, revision);
  } catch (error) {
    toast.show(
      `从模板新建失败：${error instanceof Error ? error.message : String(error)}`,
      'error',
      4000,
    );
  } finally {
    isNoteSwitching.value = false;
  }
}

async function onCreateBlank(): Promise<void> {
  if (!requireBoundWorkspace('新建笔记')) return;
  const today = new Date().toISOString().slice(0, 10);
  const path = `/笔记-${today}.md`;
  const content = '# 新笔记\n\n';
  showTemplate.value = false;
  isNoteSwitching.value = true;
  try {
    if (!(await flushCurrentSaveOrBlock('新建笔记'))) return;
    const expectedRoot = activeNotebookRoot.value;
    const expectedGeneration = notebookDataGeneration;
    const revision = await createTextFile(path, content);
    if (
      expectedGeneration !== notebookDataGeneration ||
      !notebookRootsEqual(expectedRoot, activeNotebookRoot.value)
    ) {
      return;
    }
    if (!(await refreshFileTree(expectedRoot, expectedGeneration))) return;
    await indexStore.refreshDocument(fs, path);
    if (
      expectedGeneration !== notebookDataGeneration ||
      !notebookRootsEqual(expectedRoot, activeNotebookRoot.value)
    ) {
      return;
    }
    void trainCurrentFile(path, content);
    enterNotebookFileState(path, content, revision);
  } catch (error) {
    toast.show(
      `新建笔记失败：${error instanceof Error ? error.message : String(error)}`,
      'error',
      4000,
    );
  } finally {
    isNoteSwitching.value = false;
  }
}

// --- Keyboard ---
function onGlobalKeydown(e: KeyboardEvent): void {
  const key = e.key.toLowerCase();
  if (
    isInteractionLocked.value &&
    (e.ctrlKey || e.metaKey) &&
    (key === 's' || key === 'o' || key === 'k' || (e.shiftKey && key === 'p'))
  ) {
    e.preventDefault();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && key === 's') {
    e.preventDefault();
    e.stopPropagation();
    if (isScratchSession.value) {
      void saveScratchAs();
    } else if (isWorkspaceUnbound.value) {
      requireBoundWorkspace('保存笔记');
    } else {
      void retryCurrentSave();
    }
    return;
  }
  if (isExternalSession.value) return;
  if ((e.ctrlKey || e.metaKey) && key === 'o') {
    e.preventDefault();
    e.stopPropagation();
    void requestOpenNotebook();
    return;
  }
  if (isWorkspaceUnbound.value || isInteractionLocked.value) return;
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
  const pred = completionPredictor;
  pred.setStorageScope(completionStorageScope.value);
  completionTrainingMeta.value = loadTrainingMeta(completionStorageScope.value);
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
  scheduleBackgroundTraining();
}

function scheduleBackgroundTraining(): void {
  if (!completionSettings.value.backgroundTraining || isExternalSession.value) return;
  if (backgroundTrainingTimer) clearTimeout(backgroundTrainingTimer);
  backgroundTrainingTimer = setTimeout(() => {
    backgroundTrainingTimer = null;
    void maybeTrainNotebook();
  }, 2000);
}

function ensureCompletionTrainer(pred = completionPredictor): CompletionTrainingService | null {
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
  completionPredictor.configure(settings);
  if (settings.backgroundTraining) scheduleBackgroundTraining();
}

function onClearCompletionData(): void {
  completionTrainer?.cancelCurrentRun();
  completionTrainer = null;
  completionPredictor.clearLearningData();
  const nextMeta: CompletionTrainingMeta = {
    ...DEFAULT_TRAINING_META,
    trainedPaths: {},
    failedPaths: {},
    updatedAt: Date.now(),
  };
  completionTrainingMeta.value = nextMeta;
  saveTrainingMeta(nextMeta, completionStorageScope.value);
  toast.show('已清空文字补全的本地学习数据', 'success', 2500);
}

function hasUnsavedScratch(): boolean {
  return isScratchSession.value && currentContent.value.trim().length > 0 && isDirty.value;
}

function onBeforeUnload(e: BeforeUnloadEvent): void {
  if (!isDirty.value) return;
  e.preventDefault();
  e.returnValue = '';
}

async function closeCurrentWindow(): Promise<boolean> {
  allowWindowClose = true;
  try {
    if (isDesktopRuntime()) {
      await invoke('destroy_current_window');
      return true;
    }
    window.close();
    if (window.closed) return true;
    allowWindowClose = false;
    toast.show('浏览器不允许自动关闭当前标签页，请手动关闭。', 'warning', 4000);
    return false;
  } catch (error) {
    allowWindowClose = false;
    const message = error instanceof Error ? error.message : String(error);
    toast.show(`关闭窗口失败：${message}`, 'error', 5000);
    return false;
  }
}

async function requestDesktopWindowClose(): Promise<void> {
  if (hasUnsavedScratch()) {
    unsavedDialogIntent.value = 'close';
    showScratchExitDialog.value = true;
    return;
  }
  isNoteSwitching.value = true;
  if (!(await flushCurrentSaveOrBlock('关闭窗口'))) {
    isNoteSwitching.value = false;
    unsavedDialogIntent.value = 'close';
    showScratchExitDialog.value = true;
    return;
  }
  await closeCurrentWindow();
  isNoteSwitching.value = false;
}

function cancelUnsavedExit(): void {
  showScratchExitDialog.value = false;
  if (!isNotebookOpening.value) isNoteSwitching.value = false;
}

async function copyCurrentContent(): Promise<void> {
  syncCurrentContentFromEditor();
  try {
    await navigator.clipboard.writeText(currentContent.value);
    toast.show('全文已复制。', 'success', 2200);
    return;
  } catch {
    // Desktop WebViews can deny Clipboard API despite a user gesture. Use the
    // legacy command as a narrow fallback so recovery does not depend on editor focus.
  }

  const textarea = document.createElement('textarea');
  textarea.value = currentContent.value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  toast.show(
    copied ? '全文已复制。' : '复制失败，请先另存副本。',
    copied ? 'success' : 'error',
    3000,
  );
}

async function reloadCurrentFromDisk(): Promise<void> {
  const issue = saveIssue.value;
  if (!issue || issue.kind !== 'conflict') return;
  const intent = unsavedDialogIntent.value;
  const expectedPath = issue.path;
  const expectedSource = issue.source;
  const expectedWorkspaceGeneration = notebookDataGeneration;
  const expectedExternalKey = externalFileKey(externalFile.value);
  isNoteSwitching.value = true;
  try {
    const snapshot =
      expectedSource === 'external' && externalFile.value
        ? await readExternalNoteFileSnapshot({ ...externalFile.value })
        : await fs.readFileSnapshot(expectedPath);
    if (
      saveIssue.value !== issue ||
      expectedWorkspaceGeneration !== notebookDataGeneration ||
      (expectedSource === 'workspace' &&
        normalizePath(activePath.value) !== normalizePath(expectedPath)) ||
      (expectedSource === 'external' && externalFileKey(externalFile.value) !== expectedExternalKey)
    ) {
      return;
    }
    contentRevision++;
    currentContent.value = snapshot.content;
    currentDiskRevision.value = snapshot.revision;
    isDirty.value = false;
    clearSaveIssue();
    showScratchExitDialog.value = false;
    updateHeadings(snapshot.content);
    updateEditorStats(snapshot.content);
    refreshSplitPreviewIfVisible();
    toast.show('已采用磁盘上的版本；本地草稿未写回原文件。', 'info', 3500);
    if (intent === 'close') await closeCurrentWindow();
  } catch (error) {
    reportSaveIssue({
      kind: 'io',
      source: expectedSource,
      path: expectedPath,
      message: `读取磁盘版本失败：${error instanceof Error ? error.message : String(error)}`,
    });
  } finally {
    isNoteSwitching.value = false;
  }
}

async function overwriteCurrentDiskVersion(): Promise<void> {
  const issue = saveIssue.value;
  if (!issue || (issue.kind !== 'conflict' && issue.kind !== 'missing')) return;
  const intent = unsavedDialogIntent.value;
  syncCurrentContentFromEditor();
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const revision = contentRevision;
  const content = currentContent.value;
  isDirty.value = true;
  isNoteSwitching.value = true;
  const externalSnapshot = externalFile.value ? { ...externalFile.value } : null;
  const saved =
    issue.source === 'external' && externalSnapshot
      ? await debouncedExternalSave(
          content,
          externalSnapshot,
          revision,
          issue.actualRevision ?? null,
        )
      : await debouncedSave(
          issue.path,
          content,
          revision,
          activeNotebookRoot.value,
          notebookDataGeneration,
          issue.actualRevision ?? null,
        );
  isNoteSwitching.value = false;
  if (!saved) return;
  showScratchExitDialog.value = false;
  toast.show(
    issue.kind === 'missing' ? '已在原位置重建文件。' : '已按你的选择覆盖原文件。',
    'success',
    3000,
  );
  if (intent === 'close') await closeCurrentWindow();
}

async function discardUnsavedAndClose(): Promise<void> {
  await closeCurrentWindow();
}

async function saveUnsavedAsCopy(): Promise<void> {
  const intent = unsavedDialogIntent.value;
  const saved = isScratchSession.value ? await saveScratchAs() : await saveCurrentAsCopy();
  if (!saved) return;
  showScratchExitDialog.value = false;
  if (intent === 'close') await closeCurrentWindow();
}

// Reconnect predictor when editor remounts due to :key changes (view-mode / note switch).
watch([activePath, viewMode], async () => {
  await nextTick();
  connectPredictor();
});

// ── Version Check ──────────────────────────────────────────
const VERSION_AUTO_CHECK_KEY = 'jotluck:version:autoCheck';
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

function setupDesktopLifecycleListeners(): void {
  void getCurrentWindow()
    .onCloseRequested((event) => {
      if (allowWindowClose) return;
      event.preventDefault();
      void requestDesktopWindowClose();
    })
    .then((unlisten) => {
      if (componentUnmounted) unlisten();
      else unlistenWindowClose = unlisten;
    })
    .catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('[NotebookHome] 窗口关闭监听注册失败', error);
    });
}

onMounted(async () => {
  theme.init();
  applyInitialThemeWorkflowDefaults();
  window.addEventListener('keydown', onGlobalKeydown, { capture: true });
  window.addEventListener('beforeunload', onBeforeUnload);
  if (isDesktopRuntime()) setupDesktopLifecycleListeners();
  await initNotebook();

  await nextTick();
  connectPredictor();
  unsubscribeCompletionSettings = subscribeCompletionSettings((settings) => {
    completionSettings.value = settings;
    completionPredictor.configure(settings);
    if (!isExternalSession.value && settings.backgroundTraining) scheduleBackgroundTraining();
  });
  unsubscribeTrainingMeta = subscribeTrainingMeta(
    (meta) => {
      completionTrainingMeta.value = meta;
    },
    () => completionStorageScope.value,
  );

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
  componentUnmounted = true;
  externalSessionGeneration++;
  window.removeEventListener('keydown', onGlobalKeydown, { capture: true });
  window.removeEventListener('beforeunload', onBeforeUnload);
  if (saveTimer) clearTimeout(saveTimer);
  if (splitDebounceTimer) clearTimeout(splitDebounceTimer);
  if (splitEditorMountTimer) clearTimeout(splitEditorMountTimer);
  if (previewRenderTimer) clearTimeout(previewRenderTimer);
  previewImages.reset();
  if (updateTimer) clearTimeout(updateTimer);
  if (backgroundTrainingTimer) clearTimeout(backgroundTrainingTimer);
  if (watcherRefreshTimer) clearTimeout(watcherRefreshTimer);
  if (splitDragCleanup) splitDragCleanup();
  unsubscribeCompletionSettings?.();
  unsubscribeTrainingMeta?.();
  completionTrainer?.cancelCurrentRun();
  completionTrainer = null;
  void completionPredictor.dispose();
  void stopNotebookWatcher();
  void revokeExternalGrant(externalFile.value);
  unlistenWindowClose?.();
});

function onDismissVersion(version: string) {
  localStorage.setItem('jotluck:version:dismissedVersion', version);
  showUpdateNotification.value = false;
}
</script>

<style scoped>
.notebook-home-root {
  height: 100vh;
  min-height: 0;
  overflow: hidden;
}

.startup-state {
  display: flex;
  height: 100%;
  align-items: center;
  justify-content: center;
  gap: var(--space-8);
  color: var(--ink-muted);
  background: var(--paper-bg);
  font-size: var(--text-sm);
  line-height: var(--lh-ui);
}

.startup-state__mark {
  width: var(--space-8);
  height: var(--space-8);
  border: var(--border-thin) solid var(--accent);
  border-radius: 50%;
  background: var(--accent-soft);
}

.editor-shell-frame {
  position: relative;
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  height: 100vh;
  min-height: 0;
}

.workspace-opening-overlay {
  position: absolute;
  z-index: var(--z-overlay);
  inset: 0;
  display: grid;
  place-items: center;
  background: color-mix(in oklch, var(--paper-bg) 82%, transparent);
  color: var(--ink-secondary);
  font-size: var(--text-sm);
  line-height: var(--lh-ui);
  cursor: wait;
}

.editor-shell-frame--external {
  grid-template-rows: auto minmax(0, 1fr);
}

.external-edit-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-8);
  padding: var(--space-6) var(--space-12);
  border-bottom: var(--border-thin) solid var(--rule);
  background: var(--paper-raised);
  color: var(--ink-secondary);
  font-size: var(--text-sm);
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
  height: 100vh;
  min-height: 0;
  overflow: hidden;
}

.external-reader {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100vh;
  min-height: 0;
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
  flex-wrap: wrap;
  justify-content: flex-end;
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
  padding: var(--space-40) clamp(var(--space-32), 5vw, var(--space-64)) var(--space-96);
  overflow: hidden auto;
  overscroll-behavior: contain;
  scroll-padding: var(--space-32) 0 var(--space-96);
}

.external-reader-content {
  min-width: 0;
  max-width: calc(var(--editor-max-width) + var(--space-96) + var(--space-96));
  width: 100%;
  margin: 0 auto;
}

.external-preview {
  min-height: calc(100vh - 220px);
  padding: 0 clamp(var(--space-8), 2vw, var(--space-24)) var(--space-48);
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
    grid-template-columns:
      minmax(160px, 220px)
      minmax(0, calc(var(--editor-max-width) + var(--space-96) + var(--space-96)))
      minmax(160px, 220px);
    justify-content: center;
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
    margin: 0 auto;
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
