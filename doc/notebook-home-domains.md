# NotebookHome.vue 职责域地图

- 实测基准：`packages/app/src/pages/NotebookHome.vue`，共 **6277 行**（`<template>` 1-933 / `<script setup>` 935-5584 / `<style scoped>` 5586-6277）。
- 行号实测日期：**2026-10-22**（main 分支工作树；行号随后续改动漂移，以本文件落盘时点为准）。
- 用途：Phase1-3 渐进解耦已把可独立验收的块迁出为 composables/services；本地图给出剩余本体的九域行号与协作物指向，作为 Phase4 分簇先行的底图。maint-2 的 NotebookHome 本体拆分不在本轮，仅落盘计划。

## 九域行号地图

### 1. 外部文件会话（external file session）

| 内容                                                                                                                                                                                                                                     | 行号      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 状态 ref：externalSessionMode / externalFile / externalError / externalPreviewHtml / showExternalEditConfirm / externalFiles / externalOpenedNotes / externalOpenedFileMap + isExternalSession/isExternalReadonly/isExternalEditing 派生 | 1415-1425 |
| 展示派生：externalFilePath / externalFileName / externalRelativePath / externalReadStats                                                                                                                                                 | 1485-1497 |
| 启动载荷归一：normalizeOpenedFilePayload / getPendingOpenedFile / openedFileFromBootstrap                                                                                                                                                | 2388-2445 |
| IPC 包装：readExternalNoteFileSnapshot / writeExternalNoteFileIfUnchanged / revokeExternalGrant                                                                                                                                          | 2983-3060 |
| 会话键与登记：externalAbsoluteFromRelative / externalFileKey / openedFileFromRelative / rememberExternalOpenedFile / exposeOnlyCurrentExternalFile                                                                                       | 3166-3219 |
| **enterExternalFileSession 主入口**（Phase4 焦点，见下）                                                                                                                                                                                 | 3465-3555 |
| 外部笔记选择与只读：onSelectExternalNote / onShellOpenReadonly / exitReadonlyMode                                                                                                                                                        | 3976-4074 |
| 外部预览：updateExternalPreview                                                                                                                                                                                                          | 4339-4356 |
| 编辑确认与升级：confirmExternalEdit / enableExternalEdit / openExternalParentAsNotebook / scrollExternalHeading                                                                                                                          | 4357-4469 |
| 外部内容回写：onExternalContentUpdate                                                                                                                                                                                                    | 4546-4561 |

协作物：IPC 命令走 `@/services/windowSession`（导入别名见 969-981）；条件写与保存竞态走 `useSavePipeline`（见域 2）；路径工具 `utils/notebook-paths.ts`。

### 2. 保存编排（save orchestration）

| 内容                                                                                                                                                                                                                                                | 行号      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 保存态 ref：isDirty / isSaving / saveError + 选择队列 let                                                                                                                                                                                           | 2197-2203 |
| **useSavePipeline 消费点**（16 个符号按原名解构 + 全量注入）                                                                                                                                                                                        | 2204-2260 |
| isAutosavePausedForDiskIssue                                                                                                                                                                                                                        | 2262-2264 |
| 编辑器内容同步：syncCurrentContentFromEditor                                                                                                                                                                                                        | 3220-3243 |
| 保存前置：createTextFile / flushCurrentSaveOrBlock / requireBoundWorkspace / requireFileBrowseSession                                                                                                                                               | 3244-3286 |
| 另存/下载：saveScratchAs / saveCurrentAsCopy / downloadCurrentContentAsMarkdown / downloadScratchAsMarkdown / enterNotebookFromSavedNote                                                                                                            | 3061-3165 |
| 改稿模式桥：onEnterReviewMode / onExitReviewMode / onReviewSourceAdopted                                                                                                                                                                            | 1258-1297 |
| 未保存退出与恢复链：hasUnsavedScratch / onBeforeUnload / closeCurrentWindow / requestDesktopWindowClose / cancelUnsavedExit / copyCurrentContent / reloadCurrentFromDisk / overwriteCurrentDiskVersion / discardUnsavedAndClose / saveUnsavedAsCopy | 5263-5458 |

协作物：**`composables/useSavePipeline.ts`**（条件写状态机、外部双写链、retry/flush）；条件写 IPC `writeFileIfUnchanged` / `writeExternalNoteFileIfUnchanged`；单测 `pages/__tests__/NotebookHome.save-pipeline.test.ts`。

### 3. 导航（navigation）

| 内容                                                                                                | 行号      |
| --------------------------------------------------------------------------------------------------- | --------- |
| 预览容器 ref：progressivePreviewRef / readerWorkbenchRef / staticPreviewRef / renderedPreviewSource | 4850-4853 |
| **useDocumentNavigation 消费点**（13 个符号解构 + 全量注入）                                        | 4855-4890 |
| 路径切换 watch（取消在途导航 + 复位位置/标题/分析）                                                 | 4835-4848 |
| 静态预览滚动投影：onStaticPreviewScroll                                                             | 4892-4926 |
| 渐进预览选项：progressivePreviewOptions                                                             | 4928-4933 |
| 搜索结果跳转（含导航中断 keydown 挂/卸）：onSearchSelectResult                                      | 4719-4826 |

协作物：**`composables/useDocumentNavigation.ts`**（位置状态、请求时效、静态/渐进滚动）；`utils/document-location.ts`（relocateBacklink）、`utils/cm6-live-preview.ts`（revealLivePreviewSourceAt）；单测 `composables/__tests__/useDocumentNavigation.test.ts`。

### 4. 补全装配（completion assembly）

| 内容                                                                                                                                                          | 行号                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 设置/训练元数据 ref                                                                                                                                           | 1256, 1298           |
| completionPredictor（shallowRef）/ completionEngineHealth                                                                                                     | 1303-1307            |
| 编排器句柄 let（publicDecoderSetup / reinkEngineSetup / 状态镜像 / 订阅退订）                                                                                 | 1311-1324            |
| **completionAssembly 惰性装配**（动态 import → usePublicDecoderSetup + useReinkEngineSetup 后装胜出）                                                         | 1337-1398            |
| 存储作用域：hashCompletionScope / completionStorageScope                                                                                                      | 1400-1413            |
| 连接与训练：connectPredictor / setupCanonicalPublicDecoderOnce / scheduleBackgroundTraining / ensureCompletionTrainer / maybeTrainNotebook / trainCurrentFile | 5133-5228            |
| 设置回调：onUpdateCompletionSettings / onClearCompletionData / onSettingsVisibilityChange / onRetryCompletionEngine                                           | 5229-5262            |
| 重挂载重连 watch                                                                                                                                              | 5461-5467            |
| onMounted 订阅 / onUnmounted 释放                                                                                                                             | 5515-5531, 5561-5570 |

协作物：`composables/usePublicDecoderSetup.ts`、`composables/useReinkEngineSetup.ts`（S5）、`services/MarkdownPredictor`（异步块）、`services/CompletionSettings`、`services/CompletionTrainingService`。

### 5. 主题与外观（theme & appearance）

| 内容                                                                                                                                                                                                                                 | 行号      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| theme store + chrome 派生                                                                                                                                                                                                            | 1191-1197 |
| 视图模式 ref（viewMode / splitRatio / splitPreviewHtml / deferSplitEditorMount）                                                                                                                                                     | 1209-1216 |
| shellActions 动作面 / actionsForRegion / 各 slotProps（workflow/editor/editorSurface/externalReader/themeDialog/commandPalette/fileDrawer/export/template/settings/share/update/cheatsheet 等对话框 slotProps 与未保存弹窗文案派生） | 1499-1852 |
| 主题槽开合：openThemeDialogSlot / closeThemeDialogSlot                                                                                                                                                                               | 1854-1881 |
| themeHostUi 宿主桥                                                                                                                                                                                                                   | 1883-1910 |
| 格式气泡态与 watch                                                                                                                                                                                                                   | 1912-1918 |
| 视图模式切换：viewModeLabels / cycleViewMode / applyInitialThemeWorkflowDefaults                                                                                                                                                     | 2053-2102 |
| 分屏预览与拖拽：refreshSplitPreviewIfVisible / scheduleSplitEditorMountForCurrentMode / onSplitContentUpdate / onSplitDragStart                                                                                                      | 2103-2195 |
| 分屏/外部预览渲染：wikiLinkExists / updateSplitPreview / updateExternalPreview（previewRenderTimer）                                                                                                                                 | 4274-4356 |

协作物：`stores/theme.ts`、`components/theme/ThemeSlotBoundary.vue`；图片/远程图 `composables/usePreviewImageResolver.ts`、`composables/useRemoteImageSession.ts`、`composables/useImageUpload.ts`（装配 1958-2009）。

### 6. 索引与 watcher（index & watcher）

| 内容                                                                                                                                                                                  | 行号      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| indexStore / searchStore / documentAnalysis / headingIndex 装配 + updateHeadings                                                                                                      | 1198-1206 |
| watcher 句柄与去抖队列 let（unwatchNotebook / notebookWatchGeneration / notebookDataGeneration / watcherRefreshTimer / pendingWatcherEvents / watcherFlushChain / fileTreeRequestId） | 1327-1335 |
| 标题/反链派生：activeHeadingId / currentBacklinks（documentAnalysis.subscribe 字数镜像见域 8）                                                                                        | 2293-2299 |
| watcher 生命周期：stopNotebookWatcher / queueWatcherRefresh / flushWatcherEvents / restartNotebookWatcher / onWindowFocusRetryWatcherStart                                            | 2597-2800 |
| 文件树：listDirectoryRecursive / refreshFileTree / loadDirectory / loadDirectoryShallow                                                                                               | 3719-3794 |

协作物：`stores/notebookIndex.ts` + `services/IndexService`、`services/document-analysis.ts`（worker 化）、`composables/useHeadings.ts`、`composables/useSearch.ts` + `services/SearchEngine.ts`。

### 7. 全局快捷键（global shortcuts）

| 内容                                                                    | 行号                 |
| ----------------------------------------------------------------------- | -------------------- |
| onGlobalKeydown（Ctrl+F/P/S/N/O/K、Ctrl+Shift+P，交互锁与外部会话守卫） | 5061-5130            |
| 注册/注销（capture keydown + beforeunload + focus 重试）                | 5508-5510, 5549-5551 |

协作物：复用域 2 的 retryCurrentSave / saveScratchAs / requireBoundWorkspace 与域 3 的 progressivePreviewRef.openFind；无独立 composable。

### 8. 统计（statistics）

| 内容                                                                                        | 行号      |
| ------------------------------------------------------------------------------------------- | --------- |
| editorStats reactive（charCount/wordCount/lineCount/cursorLine/cursorCol）+ isLargeDocument | 2266-2276 |
| externalReadStats 派生（外部只读页展示）                                                    | 1493-1497 |
| documentAnalysis.subscribe 字数镜像                                                         | 2289-2291 |
| updateEditorStats / onSelectionChange（行列定位）                                           | 4580-4657 |

协作物：`services/document-analysis.ts`（wordCount 事件）、`utils/cm6-document-analysis.ts`（docToString）；无独立 composable。

### 9. 模板与对话框（templates & dialogs）

| 内容                                                                                                                                                                                                                                            | 行号                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 对话框可见性 ref（showRightWing/showLeftDrawer/searchVisible/showExport/showTemplate/showNewFileDialog/newFileName/showSettings/showThemeDialog/showShare）+ customTemplates / showScratchExitDialog / pendingDeletePath                        | 1218-1252            |
| 模板 CRUD：refreshCustomTemplates / onSaveCustomTemplate / onDeleteCustomTemplate / onTemplateSelect / onCreateBlank                                                                                                                            | 3671-3702, 4952-5060 |
| 新建/删除/重命名流：onShellCreateNote / onShellCreateFile / onCreateFile / confirmNewFile / cancelNewFile / requestShellDeleteFile / onDeleteFile / requestDeleteFile / cancelDeleteFile / confirmDeleteFile / onShellRenameFile / onRenameFile | 4089-4273            |
| 快捷入口：onToggleLeftDrawer / onOpenPalette / onQuickAction                                                                                                                                                                                    | 4075-4088, 4827-4833 |

协作物：`services/TemplateEngine.ts`、对话框组件 `components/modals/*`、`components/workspace/NotebookOpenGate.vue`。

### 未入九域的编排残留（Phase4 后再议）

- 工作区生命周期与启动：2446-2596（suspendWorkspaceForTransition/commitWorkspaceHandle/enterWorkspaceGate/openNotebookRoot/markStartupReady 等）、2904-2952（openInitialNotebook）、3287-3464（requestOpenNotebook/performOpenNotebook/clearPendingSaveForPath）、3557-3670（initNotebook/completeNotebookInitializationInBackground）。
- 引导示例会话：2801-2903（clearGuidedSampleSession…writeCarriedGuidedNote）。
- 笔记选择编排：3839-3975（onDrawerNavigateDir/onSelectNote/selectNoteNow）、4046-4074。
- 内容回写三入口：4498-4579（onContentUpdate/onExternalContentUpdate/onEditorContentUpdate）。
- 版本检查与桌面生命周期：5469-5504、5505-5583（onMounted/onUnmounted/onDismissVersion）。

## Phase4 迁移计划（分簇先行；maint-2 本体拆分不在本轮，不实施）

焦点：`enterExternalFileSession`（3465-3555）在页面直写 ref 过多，阻断外部会话域成块迁出。当前树实测：成功路径（前置清场 3470-3510 + try 成功支 3518-3544）直写 **29 个不同 ref**；catch 失败支另直写 externalPreviewHtml 并与主路径 5 个 ref 重叠（合计 30 个不同 ref）。

分簇方案（每簇一次独立可验收的小步，均为「收口直写、零行为变化」）：

1. **簇 E · 保存基线（先行，收益最大）**：currentContent / contentRevision / currentDiskRevision / isDirty / isSaving / lastSavedAt / clearSaveIssue() 七个保存管线符号的直写收进 `useSavePipeline` 新增意图入口（如 `enterExternalSnapshot(snapshot | null)`），页面改一次调用；管线单测同步覆盖（`useSavePipeline.ts` 现有测试文件扩展）。
2. **簇 D · 工作区清场**：activePath / files / externalFiles / externalOpenedNotes / externalOpenedFileMap / activeNotebookRoot / customTemplates / notebookName 八个 ref 收口为页面内意图函数（如 `clearWorkspaceListState()`），供 enterExternalFileSession 与 enterWorkspaceGate 复用。
3. **簇 C · 浮层可见性**：searchVisible / showLeftDrawer / showRightWing / showTemplate / showExport / showShare 收口为 `resetOverlayVisibilityForExternalSession()`。
4. **簇 A · 会话与模式**：externalSessionMode / externalFile / isScratchSession / isNoteSwitching / isNotebookOpening / loading 的成组置位收口为 `markExternalSessionTransition()` 一类小函数（保留 sessionGeneration 竞态守卫在主函数内不动）。
5. **簇 B · 错误与确认**：externalError / errorMessage / showExternalEditConfirm 三连清场并入簇 C/D 之后的单函数。
6. **收尾**：以上簇落位后，enterExternalFileSession 本体只剩编排序（flush → suspend → revoke 旧授权 → 读快照 → 调簇函数 → finally 复位），此时再评估整函数迁出至 `useExternalFileSession` composable——该迁出与 maint-2 NotebookHome 本体拆分合并处理，本轮不实施。

验收口径：每簇迁移零行为变化（现有单测 + 30-race-regressions 门禁兜底），行数配额与门禁以当轮工单为准。
