/**
 * useSavePipeline — 保存管线状态机与工作区/外部双写链
 *
 * 自 NotebookHome.vue 保存块原样迁出（工单 B4 / Phase3）：
 *  - SaveIssue 接口与 saveIssue / currentDiskRevision / lastSavedAt /
 *    unsavedDialogIntent 状态 ref（页面按原名解构消费，模板/computed 不断闭包）；
 *  - saveGeneration / contentRevision / localWriteEpoch 三个原模块级 let 计数器
 *    （评审定案：升格 ref 暴露，页面全部读写点机械改写 .value——按身份共享，
 *    消除 let 无法按引用跨闭包传递的机制矛盾）；
 *  - saveTimer 句柄收进内部，经 scheduleSave / cancelScheduledSave 两方法访问
 *    （clearTimeout + 置 null 幂等）；currentSavePromise 为内部 let，不暴露；
 *  - clearSaveIssue / clearTransientSaveIssueOnEdit / reportSaveIssue /
 *    flushPendingCurrentSave / retryCurrentSave / debouncedSave /
 *    debouncedExternalSave 迁移体。
 *
 * 依赖全部经参数注入（照 useDocumentNavigation / B3 风格）；计数器 .value 化与
 * saveTimer 两方法替换属工单明确豁免的访问形式映射，逻辑与调用序零变化，
 * 保存竞态由 30-race-regressions 门禁兜底。
 */
import { ref } from 'vue';
import type { Ref } from 'vue';
import type { ConditionalWriteResult, IFileSystemService } from '@/types';
import type { useIndexStore } from '@/stores/notebookIndex';
import { createUserMessageError } from '@/services/command-errors';
import { normalizePath, notebookRootsEqual } from '@/utils/notebook-paths';
import type { ToastAPI } from '@/components/common/Toast.vue';

/** 保存阻塞问题（冲突/缺失/IO 失败），驱动未保存恢复弹窗 */
export interface SaveIssue {
  kind: 'io' | 'conflict' | 'missing';
  source: 'workspace' | 'external';
  path: string;
  message: string;
  actualRevision?: string | null;
}

/** 外部打开文件载荷（与页面 OpenedFilePayload 结构同源；页面本地类型不迁移，按结构契约注入） */
export interface SavePipelineOpenedFile {
  absolutePath: string;
  notebookRoot: string;
  relativePath: string;
  accessToken?: string;
}

/** 编辑器实例保存句柄（页面 MarkdownEditorExposed 的保存子集，注入方保持不变） */
export interface SavePipelineEditorHandle {
  settlePendingAutocompleteFeedback(): Promise<void>;
}

/** E2E 强制保存失败注入句柄（页面 failNextSave 写、debouncedSave 读并清零；跨闭包活引用） */
export interface ForcedE2ESaveFailureHandle {
  get(): string | null;
  set(value: string | null): void;
}

export interface UseSavePipelineOptions {
  // ── refs（页面拥有，按引用共享读写） ──
  currentContent: Ref<string>;
  activePath: Ref<string>;
  activeNotebookRoot: Ref<string>;
  externalFile: Ref<SavePipelineOpenedFile | null>;
  isDirty: Ref<boolean>;
  isSaving: Ref<boolean>;
  saveError: Ref<string | null>;
  /** 未保存恢复弹窗可见性（reportSaveIssue / retryCurrentSave 写） */
  showScratchExitDialog: Ref<boolean>;
  /** wiki 链接渲染代次（保存成功后自增触发重渲染） */
  wikiLinkRevision: Ref<number>;
  /** 保存收尾等待补全反馈（页面 MarkdownEditorExposed 句柄） */
  editorRef: Ref<SavePipelineEditorHandle | null>;
  fs: IFileSystemService;
  indexStore: ReturnType<typeof useIndexStore>;
  /** 工作区代次（页面 let 变量，经 getter 读取实时值） */
  notebookDataGeneration: () => number;
  /** E2E 强制保存失败注入（get/set 活引用） */
  forcedE2ESaveFailure: ForcedE2ESaveFailureHandle;
  // ── 布尔派生（computed/ref 注入） ──
  isExternalEditing: Ref<boolean>;
  isExternalSession: Ref<boolean>;
  isExternalReadonly: Ref<boolean>;
  isGuidedSampleSession: Ref<boolean>;
  isScratchSession: Ref<boolean>;
  isWorkspaceUnbound: Ref<boolean>;
  isNotebookOpening: Ref<boolean>;
  isAutosavePausedForDiskIssue(): boolean;
  // ── 外部会话快照键与写入 ──
  externalFileKey(file: SavePipelineOpenedFile | null): string;
  writeExternalNoteFileIfUnchanged(
    openedFile: SavePipelineOpenedFile,
    content: string,
    expectedRevision: string | null,
  ): Promise<ConditionalWriteResult>;
  // ── 回调（页面编排入口） ──
  syncCurrentContentFromEditor(): void;
  persistGuidedSampleCurrent(): void;
  requestWorkspaceForGuidedSave(): boolean;
  saveScratchAs(): Promise<boolean>;
  requireBoundWorkspace(action: string): boolean;
  trainCurrentFile(path: string, content: string): Promise<void>;
  userErrorMessage(error: unknown): string;
  toast: ToastAPI;
  t: (key: string, params?: Record<string, unknown>) => string;
}

export interface UseSavePipelineReturn {
  /** 保存阻塞问题（页面弹窗模式/文案 computed 消费） */
  saveIssue: Ref<SaveIssue | null>;
  /** 磁盘侧条件写基线 revision */
  currentDiskRevision: Ref<string | null>;
  /** 最近一次保存完成时间戳（状态栏展示） */
  lastSavedAt: Ref<number | null>;
  /** 未保存弹窗意图（recover/close/bind-workspace；模板与 computed 消费） */
  unsavedDialogIntent: Ref<'recover' | 'close' | 'bind-workspace'>;
  /** 保存代次（原 let；++ 使在途保存结果失效） */
  saveGeneration: Ref<number>;
  /** 内容修订代次（原 let；编辑自增、写入前捕获比对） */
  contentRevision: Ref<number>;
  /** 本地写纪元（原 let；watcher 区分本地写与外部改写） */
  localWriteEpoch: Ref<number>;
  /** 排程自动保存定时器（内部持有句柄，重复排程顶替旧句柄） */
  scheduleSave(callback: () => void, delay: number): void;
  /** 取消已排程保存（clearTimeout + 置 null，幂等） */
  cancelScheduledSave(): void;
  clearSaveIssue(): void;
  clearTransientSaveIssueOnEdit(): void;
  reportSaveIssue(issue: SaveIssue, openRecovery?: boolean): void;
  flushPendingCurrentSave(): Promise<boolean>;
  retryCurrentSave(): Promise<boolean>;
  debouncedSave(
    path: string,
    content: string,
    revision?: number,
    expectedRoot?: string,
    expectedWorkspaceGeneration?: number,
    expectedRevisionOverride?: string | null,
  ): Promise<boolean>;
  debouncedExternalSave(
    content: string,
    openedFile: SavePipelineOpenedFile,
    revision?: number,
    expectedRevisionOverride?: string | null,
  ): Promise<boolean>;
}

export function useSavePipeline(options: UseSavePipelineOptions): UseSavePipelineReturn {
  const {
    currentContent,
    activePath,
    activeNotebookRoot,
    externalFile,
    isDirty,
    isSaving,
    saveError,
    showScratchExitDialog,
    wikiLinkRevision,
    editorRef,
    fs,
    indexStore,
    notebookDataGeneration,
    forcedE2ESaveFailure,
    isExternalEditing,
    isExternalReadonly,
    isGuidedSampleSession,
    isScratchSession,
    isWorkspaceUnbound,
    isNotebookOpening,
    externalFileKey,
    writeExternalNoteFileIfUnchanged,
    syncCurrentContentFromEditor,
    persistGuidedSampleCurrent,
    requestWorkspaceForGuidedSave,
    saveScratchAs,
    requireBoundWorkspace,
    trainCurrentFile,
    userErrorMessage,
    toast,
    t,
  } = options;

  const saveIssue = ref<SaveIssue | null>(null);
  const currentDiskRevision = ref<string | null>(null);
  const lastSavedAt = ref<number | null>(null);
  // 原页面模块级 let 计数器：升格 ref 后由页面与管线共享同一身份（工单 B4 定案）
  const saveGeneration = ref(0);
  const contentRevision = ref(0);
  const localWriteEpoch = ref(0);
  const unsavedDialogIntent = ref<'recover' | 'close' | 'bind-workspace'>('recover');
  // 自动保存定时器句柄仅存于管线内部（原 saveTimer let；页面经两方法访问）
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  // 在途保存单例（原模块级 let，仅迁移函数引用——不暴露）
  let currentSavePromise: Promise<boolean> | null = null;

  function scheduleSave(callback: () => void, delay: number): void {
    saveTimer = setTimeout(callback, delay);
  }

  function cancelScheduledSave(): void {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  }

  function clearSaveIssue(): void {
    saveIssue.value = null;
    saveError.value = null;
  }

  function clearTransientSaveIssueOnEdit(): void {
    if (saveIssue.value && saveIssue.value.kind !== 'io') return;
    clearSaveIssue();
  }

  function reportSaveIssue(issue: SaveIssue, openRecovery = issue.kind !== 'io'): void {
    saveIssue.value = issue;
    saveError.value = issue.message;
    if (openRecovery) {
      unsavedDialogIntent.value = 'recover';
      showScratchExitDialog.value = true;
    }
  }

  async function flushPendingCurrentSave(): Promise<boolean> {
    syncCurrentContentFromEditor();
    cancelScheduledSave();
    if (isGuidedSampleSession.value) {
      persistGuidedSampleCurrent();
      return true;
    }
    if (!isDirty.value) {
      if (currentSavePromise) await currentSavePromise;
      return !saveError.value;
    }

    for (let attempt = 0; attempt < 3 && isDirty.value; attempt++) {
      const revision = contentRevision.value;
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
        revision === contentRevision.value &&
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
    cancelScheduledSave();

    if (saveIssue.value?.kind === 'conflict' || saveIssue.value?.kind === 'missing') {
      unsavedDialogIntent.value = 'recover';
      showScratchExitDialog.value = true;
      return false;
    }

    if (isGuidedSampleSession.value) return requestWorkspaceForGuidedSave();
    if (isScratchSession.value) return saveScratchAs();
    if (isWorkspaceUnbound.value || isNotebookOpening.value) {
      requireBoundWorkspace(t('notebook.actions.saveNote'));
      return false;
    }

    if (isExternalReadonly.value) return false;
    const externalSnapshot = externalFile.value ? { ...externalFile.value } : null;
    if (!isExternalEditing.value && !activePath.value) {
      toast.show(t('notebook.toast.noSavableNote'), 'info', 2500);
      return false;
    }
    if (isExternalEditing.value && !externalSnapshot) {
      toast.show(t('notebook.toast.externalAccessExpired'), 'error', 4000);
      return false;
    }

    const revision = contentRevision.value;
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
              notebookDataGeneration(),
            )
          : false;

    if (!saved) {
      if (!saveError.value) {
        reportSaveIssue(
          {
            kind: 'io',
            source: isExternalEditing.value ? 'external' : 'workspace',
            path: isExternalEditing.value
              ? (externalSnapshot?.relativePath ?? '')
              : activePath.value,
            message: t('notebook.unsaved.noWritablePath'),
          },
          false,
        );
      }
      toast.show(t('notebook.toast.retrySaveFailed', { error: saveError.value }), 'error', 4000);
    }
    return saved;
  }

  async function debouncedSave(
    path: string,
    content: string,
    revision = contentRevision.value,
    expectedRoot = activeNotebookRoot.value,
    expectedWorkspaceGeneration = notebookDataGeneration(),
    expectedRevisionOverride?: string | null,
  ): Promise<boolean> {
    const previousSave = currentSavePromise;
    const saveTask = (async () => {
      if (previousSave) await previousSave.catch(() => undefined);
      const gen = ++saveGeneration.value;
      isSaving.value = true;
      const start = Date.now();
      try {
        if (
          !expectedRoot ||
          !activeNotebookRoot.value ||
          isWorkspaceUnbound.value ||
          isNotebookOpening.value ||
          expectedWorkspaceGeneration !== notebookDataGeneration() ||
          !notebookRootsEqual(expectedRoot, activeNotebookRoot.value) ||
          normalizePath(path) !== normalizePath(activePath.value)
        ) {
          throw createUserMessageError('notebook.error.staleWrite');
        }
        if (forcedE2ESaveFailure.get()) {
          const message = forcedE2ESaveFailure.get()!;
          forcedE2ESaveFailure.set(null);
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
                ? t('notebook.unsaved.missingIssue')
                : t('notebook.unsaved.conflictIssue'),
          });
          return false;
        }
        if (gen !== saveGeneration.value) return true;
        currentDiskRevision.value = result.revision;
        localWriteEpoch.value++;
        clearSaveIssue();
        try {
          await indexStore.refreshDocument(fs, path);
        } catch (error) {
          // The file is already safely written; an index refresh must not turn it into a save failure.
          // eslint-disable-next-line no-console
          console.warn('[NotebookHome] post-save index refresh failed', error);
        }
        void trainCurrentFile(path, content);
        if (gen !== saveGeneration.value) return true;
        wikiLinkRevision.value++;
        lastSavedAt.value = Date.now();
        const elapsed = Date.now() - start;
        if (elapsed < 500) await new Promise((r) => setTimeout(r, 500 - elapsed));
        if (gen !== saveGeneration.value) return true;
        if (activePath.value === path && contentRevision.value === revision) {
          await editorRef.value?.settlePendingAutocompleteFeedback();
          if (
            gen === saveGeneration.value &&
            activePath.value === path &&
            contentRevision.value === revision
          ) {
            isDirty.value = false;
          }
        }
        return true;
      } catch (e) {
        if (gen === saveGeneration.value) {
          reportSaveIssue(
            {
              kind: 'io',
              source: 'workspace',
              path,
              message: userErrorMessage(e),
            },
            false,
          );
        }
        return false;
      } finally {
        if (gen === saveGeneration.value) isSaving.value = false;
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
    openedFile: SavePipelineOpenedFile,
    revision = contentRevision.value,
    expectedRevisionOverride?: string | null,
  ): Promise<boolean> {
    const previousSave = currentSavePromise;
    const saveTask = (async () => {
      if (previousSave) await previousSave.catch(() => undefined);
      const gen = ++saveGeneration.value;
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
        const result = await writeExternalNoteFileIfUnchanged(
          openedFile,
          content,
          expectedRevision,
        );
        if (result.status === 'conflict') {
          const kind = result.actualRevision === null ? 'missing' : 'conflict';
          reportSaveIssue({
            kind,
            source: 'external',
            path: openedFile.relativePath,
            actualRevision: result.actualRevision,
            message:
              kind === 'missing'
                ? t('notebook.unsaved.missingIssue')
                : t('notebook.unsaved.conflictIssue'),
          });
          return false;
        }
        if (gen !== saveGeneration.value) return true;
        currentDiskRevision.value = result.revision;
        localWriteEpoch.value++;
        clearSaveIssue();
        lastSavedAt.value = Date.now();
        const elapsed = Date.now() - start;
        if (elapsed < 300) await new Promise((r) => setTimeout(r, 300 - elapsed));
        if (gen !== saveGeneration.value) return true;
        if (
          externalFileKey(externalFile.value) === externalFileKey(openedFile) &&
          contentRevision.value === revision
        ) {
          isDirty.value = false;
        }
        return true;
      } catch (e) {
        if (gen === saveGeneration.value) {
          reportSaveIssue(
            {
              kind: 'io',
              source: 'external',
              path: openedFile.relativePath,
              message: userErrorMessage(e),
            },
            false,
          );
        }
        return false;
      } finally {
        if (gen === saveGeneration.value) isSaving.value = false;
      }
    })();
    currentSavePromise = saveTask;
    try {
      return await saveTask;
    } finally {
      if (currentSavePromise === saveTask) currentSavePromise = null;
    }
  }

  return {
    saveIssue,
    currentDiskRevision,
    lastSavedAt,
    unsavedDialogIntent,
    saveGeneration,
    contentRevision,
    localWriteEpoch,
    scheduleSave,
    cancelScheduledSave,
    clearSaveIssue,
    clearTransientSaveIssueOnEdit,
    reportSaveIssue,
    flushPendingCurrentSave,
    retryCurrentSave,
    debouncedSave,
    debouncedExternalSave,
  };
}
