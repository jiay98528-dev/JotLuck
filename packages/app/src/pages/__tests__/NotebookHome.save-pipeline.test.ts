import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import {
  useSavePipeline,
  type SavePipelineEditorHandle,
  type SavePipelineOpenedFile,
} from '@/composables/useSavePipeline';
import type { useIndexStore } from '@/stores/notebookIndex';
import type { ToastAPI } from '@/components/common/Toast.vue';
import type { ConditionalWriteResult, IFileSystemService } from '@/types';

/**
 * NotebookHome 保存管线首个单测（工单 B4 / Phase3）。
 * 被测对象为自页面迁出的 useSavePipeline：以最小注入 mock（refs+回调+t）
 * 覆盖——reportSaveIssue/unsavedDialogIntent 联动、clear 系列对 io/非 io 分支、
 * debouncedSave 过期写入放弃、flushPendingCurrentSave 等待在途保存。
 */

function createPipeline() {
  // ── 注入 refs ──
  const currentContent = ref('');
  const activePath = ref('/note.md');
  const activeNotebookRoot = ref('/root');
  const externalFile = ref<SavePipelineOpenedFile | null>(null);
  const isDirty = ref(false);
  const isSaving = ref(false);
  const saveError = ref<string | null>(null);
  const showScratchExitDialog = ref(false);
  const wikiLinkRevision = ref(0);
  const editorRef = ref<SavePipelineEditorHandle | null>(null);
  const isExternalEditing = ref(false);
  const isExternalSession = ref(false);
  const isExternalReadonly = ref(false);
  const isGuidedSampleSession = ref(false);
  const isScratchSession = ref(false);
  const isWorkspaceUnbound = ref(false);
  const isNotebookOpening = ref(false);

  // ── 注入 mock（fs / 索引 / toast / t / 回调） ──
  const writeFileIfUnchanged = vi.fn(
    async (): Promise<ConditionalWriteResult> => ({ status: 'saved', revision: 'sha256:unit' }),
  );
  const writeExternalNoteFileIfUnchanged = vi.fn(
    async (): Promise<ConditionalWriteResult> => ({ status: 'saved', revision: 'sha256:unit' }),
  );
  const refreshDocument = vi.fn(async () => undefined);
  const syncCurrentContentFromEditor = vi.fn(() => undefined);
  const trainCurrentFile = vi.fn(async () => undefined);
  const toastShow = vi.fn();
  const t = vi.fn((key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  );

  let notebookDataGeneration = 0;
  let forcedE2ESaveFailure: string | null = null;

  const pipeline = useSavePipeline({
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
    // 保存管线仅触 writeFileIfUnchanged：按 unknown 收窄为最小注入桩（照 useImageUpload 测试惯例）
    fs: { writeFileIfUnchanged } as unknown as IFileSystemService,
    // Pinia store 体型大：保存管线仅触 refreshDocument，按 unknown 收窄为最小注入桩
    indexStore: { refreshDocument } as unknown as ReturnType<typeof useIndexStore>,
    notebookDataGeneration: () => notebookDataGeneration,
    forcedE2ESaveFailure: {
      get: () => forcedE2ESaveFailure,
      set: (value) => (forcedE2ESaveFailure = value),
    },
    isExternalEditing,
    isExternalSession,
    isExternalReadonly,
    isGuidedSampleSession,
    isScratchSession,
    isWorkspaceUnbound,
    isNotebookOpening,
    isAutosavePausedForDiskIssue: () => false,
    externalFileKey: () => 'external-key',
    writeExternalNoteFileIfUnchanged,
    syncCurrentContentFromEditor,
    persistGuidedSampleCurrent: () => undefined,
    requestWorkspaceForGuidedSave: () => false,
    saveScratchAs: async () => true,
    requireBoundWorkspace: () => true,
    trainCurrentFile,
    userErrorMessage: (error: unknown) => String(error),
    toast: {
      show: toastShow,
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      dismiss: vi.fn(),
    } satisfies ToastAPI,
    t,
  });

  return {
    pipeline,
    refs: {
      currentContent,
      activePath,
      activeNotebookRoot,
      isDirty,
      isSaving,
      saveError,
      showScratchExitDialog,
    },
    mocks: {
      writeFileIfUnchanged,
      writeExternalNoteFileIfUnchanged,
      refreshDocument,
      syncCurrentContentFromEditor,
      trainCurrentFile,
      toastShow,
      t,
    },
    /** 使工作区代次过期（模拟换本/切换后旧保存请求到达） */
    bumpGeneration(): void {
      notebookDataGeneration++;
    },
    setForcedSaveFailure(message: string | null): void {
      forcedE2ESaveFailure = message;
    },
  };
}

describe('useSavePipeline（NotebookHome 保存管线）', () => {
  it('reportSaveIssue 置位 saveIssue/saveError，默认对非 io 问题打开恢复弹窗并把 unsavedDialogIntent 拉回 recover', () => {
    const { pipeline, refs } = createPipeline();
    pipeline.unsavedDialogIntent.value = 'close';

    pipeline.reportSaveIssue({
      kind: 'conflict',
      source: 'workspace',
      path: '/a.md',
      message: '磁盘已被外部修改',
    });

    expect(pipeline.saveIssue.value).toMatchObject({
      kind: 'conflict',
      source: 'workspace',
      path: '/a.md',
      message: '磁盘已被外部修改',
    });
    expect(refs.saveError.value).toBe('磁盘已被外部修改');
    expect(refs.showScratchExitDialog.value).toBe(true);
    expect(pipeline.unsavedDialogIntent.value).toBe('recover');

    // io 问题默认 openRecovery=false：只记录失败，不打断式弹窗
    refs.showScratchExitDialog.value = false;
    pipeline.reportSaveIssue({
      kind: 'io',
      source: 'workspace',
      path: '/a.md',
      message: '写入失败',
    });
    expect(refs.showScratchExitDialog.value).toBe(false);
    expect(refs.saveError.value).toBe('写入失败');
  });

  it('clearSaveIssue 全清；clearTransientSaveIssueOnEdit 只在无问题或 io 问题时清空，conflict/missing 保留', () => {
    const { pipeline, refs } = createPipeline();

    pipeline.clearSaveIssue();
    expect(pipeline.saveIssue.value).toBeNull();
    expect(refs.saveError.value).toBeNull();

    // 非 io（missing）：编辑不清——恢复入口必须保留
    pipeline.reportSaveIssue(
      { kind: 'missing', source: 'workspace', path: '/a.md', message: '丢失' },
      false,
    );
    pipeline.clearTransientSaveIssueOnEdit();
    expect(pipeline.saveIssue.value?.kind).toBe('missing');
    expect(refs.saveError.value).toBe('丢失');

    // io：下一次编辑即清，避免陈旧失败态卡住自动保存
    pipeline.reportSaveIssue(
      { kind: 'io', source: 'workspace', path: '/a.md', message: '写入失败' },
      false,
    );
    pipeline.clearTransientSaveIssueOnEdit();
    expect(pipeline.saveIssue.value).toBeNull();
    expect(refs.saveError.value).toBeNull();
  });

  it('debouncedSave 放弃过期写入：注入 ref 预置不同值时不触盘且报 io；过期 revision 不清 dirty', async () => {
    vi.useFakeTimers();
    try {
      // 过期工作区（注入的 activeNotebookRoot 已与捕获值不同）→ 写入前拦截
      const stale = createPipeline();
      stale.refs.activeNotebookRoot.value = '/elsewhere';
      const staleSaved = await stale.pipeline.debouncedSave('/note.md', 'x', 0, '/root', 0);
      expect(staleSaved).toBe(false);
      expect(stale.mocks.writeFileIfUnchanged).not.toHaveBeenCalled();
      expect(stale.pipeline.saveIssue.value?.kind).toBe('io');
      expect(stale.refs.showScratchExitDialog.value).toBe(false);

      // 工作区有效但 revision 过期：磁盘写入仍完成，却不把该次写入认作最终落盘（dirty 保持）
      const superseded = createPipeline();
      superseded.pipeline.contentRevision.value = 5;
      superseded.refs.isDirty.value = true;
      const savedPromise = superseded.pipeline.debouncedSave('/note.md', 'x', 3, '/root', 0);
      await vi.advanceTimersByTimeAsync(600);
      await expect(savedPromise).resolves.toBe(true);
      expect(superseded.mocks.writeFileIfUnchanged).toHaveBeenCalledTimes(1);
      expect(superseded.refs.isDirty.value).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushPendingCurrentSave 先同步编辑器，等待在途 currentSavePromise 结束后返回其结果', async () => {
    vi.useFakeTimers();
    try {
      const ctx = createPipeline();
      ctx.refs.isDirty.value = true;
      void ctx.pipeline.debouncedSave('/note.md', 'hello'); // 在途保存（结果由 flush 断言）
      await vi.advanceTimersByTimeAsync(0); // fs 写完成，进入收尾等待（在途）
      expect(ctx.refs.isSaving.value).toBe(true);
      expect(ctx.mocks.writeFileIfUnchanged).toHaveBeenCalledWith('/note.md', 'hello', null);

      // 内容已确认（!isDirty 快路径）：flush 应挂起等待在途保存而非立刻返回
      ctx.refs.isDirty.value = false;
      let flushResult: boolean | undefined;
      const flushPromise = ctx.pipeline.flushPendingCurrentSave().then((result) => {
        flushResult = result;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(ctx.mocks.syncCurrentContentFromEditor).toHaveBeenCalledTimes(1);
      expect(flushResult).toBeUndefined();

      await vi.advanceTimersByTimeAsync(500);
      await flushPromise;
      expect(flushResult).toBe(true);
      expect(ctx.refs.isSaving.value).toBe(false);
      expect(ctx.refs.saveError.value).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
