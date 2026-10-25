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
 * L3 补账（工单 H）增补：debouncedExternalSave 外部快照键时效校验、
 * conflict/missing→恢复弹窗链、retryCurrentSave 分支矩阵。
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
  // L3 补账：三守卫回调升 vi.fn，供 retryCurrentSave 分支断言委托关系
  const requestWorkspaceForGuidedSave = vi.fn(() => false);
  const saveScratchAs = vi.fn(async () => true);
  const requireBoundWorkspace = vi.fn(() => true);
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
    // 自动保存设置（设置页下发，接线后为必填）：测试取默认口径——开 + 600ms
    // （对齐接线前 600ms 硬编码调度值，保持既有用例的排程语义不变）
    autoSaveEnabled: ref(true),
    autoSaveDelayMs: () => 600,
    isExternalEditing,
    isExternalReadonly,
    isGuidedSampleSession,
    isScratchSession,
    isWorkspaceUnbound,
    isNotebookOpening,
    // 外部快照键照页面实现（NotebookHome.vue externalFileKey）从载荷派生，
    // 使「会话已切换后旧快照到达」场景在测试内可构造
    externalFileKey: (file) => (file ? `${file.notebookRoot}${file.relativePath}` : ''),
    writeExternalNoteFileIfUnchanged,
    syncCurrentContentFromEditor,
    persistGuidedSampleCurrent: () => undefined,
    requestWorkspaceForGuidedSave,
    saveScratchAs,
    requireBoundWorkspace,
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
      externalFile,
      isDirty,
      isSaving,
      saveError,
      showScratchExitDialog,
      isExternalEditing,
      isExternalReadonly,
      isGuidedSampleSession,
      isScratchSession,
      isWorkspaceUnbound,
      isNotebookOpening,
    },
    mocks: {
      writeFileIfUnchanged,
      writeExternalNoteFileIfUnchanged,
      refreshDocument,
      syncCurrentContentFromEditor,
      trainCurrentFile,
      toastShow,
      t,
      requestWorkspaceForGuidedSave,
      saveScratchAs,
      requireBoundWorkspace,
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
      // 磁盘写挂在 200ms 定时器上：制造真正在途的保存，flush 必须等它结束
      ctx.mocks.writeFileIfUnchanged.mockImplementation(
        () =>
          new Promise<ConditionalWriteResult>((resolve) =>
            setTimeout(() => resolve({ status: 'saved', revision: 'sha256:unit' }), 200),
          ),
      );
      ctx.refs.isDirty.value = true;
      void ctx.pipeline.debouncedSave('/note.md', 'hello'); // 在途保存（结果由 flush 断言）
      await vi.advanceTimersByTimeAsync(0); // fs 写仍在途（200ms 定时器未到）
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
      expect(flushResult).toBeUndefined(); // 写盘仍在途：flush 尚未返回

      // 写盘完成（start+200ms）：flush 立即返回，不再被 500ms 地板阻塞；
      // isSaving 指示器仍亮——地板只延后指示器熄灭时机
      await vi.advanceTimersByTimeAsync(200);
      await flushPromise;
      expect(flushResult).toBe(true);
      expect(ctx.refs.isSaving.value).toBe(true);

      // start+500ms 地板到期：指示器熄灭（多放 300ms 余量，规避 Date 真伪时钟差）
      await vi.advanceTimersByTimeAsync(600);
      expect(ctx.refs.isSaving.value).toBe(false);
      expect(ctx.refs.saveError.value).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('debouncedExternalSave 时效校验：外部快照键变化时静默拒绝写盘；键命中走外部条件写并清 dirty', async () => {
    const ctx = createPipeline();
    const opened: SavePipelineOpenedFile = {
      absolutePath: 'C:/tmp/report.docx.md',
      notebookRoot: 'C:/tmp',
      relativePath: '/report.docx.md',
    };

    // 当前会话已切到另一外部文件：旧快照的保存任务到达时键不匹配 → 不触盘不报错
    ctx.refs.externalFile.value = { ...opened, relativePath: '/other.md' };
    ctx.refs.isDirty.value = true;
    const rejected = await ctx.pipeline.debouncedExternalSave('# 旧内容', opened, 3);
    expect(rejected).toBe(false);
    expect(ctx.mocks.writeExternalNoteFileIfUnchanged).not.toHaveBeenCalled();
    expect(ctx.pipeline.saveIssue.value).toBeNull();
    expect(ctx.refs.saveError.value).toBeNull();
    expect(ctx.refs.isDirty.value).toBe(true);

    // 键命中：以 currentDiskRevision 为期望 revision 条件写，成功后清 dirty 并推进基线
    ctx.refs.externalFile.value = opened;
    ctx.pipeline.currentDiskRevision.value = 'sha256:base';
    const saved = await ctx.pipeline.debouncedExternalSave('# 新内容', { ...opened });
    expect(saved).toBe(true);
    expect(ctx.mocks.writeExternalNoteFileIfUnchanged).toHaveBeenCalledWith(
      opened,
      '# 新内容',
      'sha256:base',
    );
    expect(ctx.refs.isDirty.value).toBe(false);
    expect(ctx.pipeline.currentDiskRevision.value).toBe('sha256:unit');
  });

  it('conflict/missing 条件写结果经 reportSaveIssue 打开恢复弹窗（workspace 与 external 双源）', async () => {
    // workspace 源：磁盘 revision 前移（actualRevision 非空）→ conflict，弹恢复弹窗
    const conflict = createPipeline();
    conflict.refs.isDirty.value = true;
    conflict.refs.showScratchExitDialog.value = false;
    conflict.mocks.writeFileIfUnchanged.mockResolvedValue({
      status: 'conflict',
      actualRevision: 'sha256:disk-new',
    });
    const saved = await conflict.pipeline.debouncedSave('/note.md', '# x', 0, '/root', 0);
    expect(saved).toBe(false);
    expect(conflict.pipeline.saveIssue.value).toMatchObject({
      kind: 'conflict',
      source: 'workspace',
      path: '/note.md',
      actualRevision: 'sha256:disk-new',
    });
    expect(conflict.refs.showScratchExitDialog.value).toBe(true);
    expect(conflict.pipeline.unsavedDialogIntent.value).toBe('recover');
    expect(conflict.refs.isDirty.value).toBe(true); // 冲突不清 dirty：恢复入口保留

    // external 源：磁盘文件被外部删除（actualRevision 为 null）→ missing，同样弹恢复
    const missing = createPipeline();
    const opened: SavePipelineOpenedFile = {
      absolutePath: 'C:/tmp/a.md',
      notebookRoot: 'C:/tmp',
      relativePath: '/a.md',
    };
    missing.refs.externalFile.value = opened;
    missing.refs.showScratchExitDialog.value = false;
    missing.mocks.writeExternalNoteFileIfUnchanged.mockResolvedValue({
      status: 'conflict',
      actualRevision: null,
    });
    const savedExt = await missing.pipeline.debouncedExternalSave('# x', opened);
    expect(savedExt).toBe(false);
    expect(missing.pipeline.saveIssue.value).toMatchObject({
      kind: 'missing',
      source: 'external',
      path: '/a.md',
    });
    expect(missing.refs.showScratchExitDialog.value).toBe(true);
    expect(missing.refs.saveError.value).toBe('notebook.unsaved.missingIssue');
  });

  it('retryCurrentSave 分支矩阵：conflict 拦截、guided/scratch/unbound/readonly 守卫、无路径与授权失效 toast、io 失败 toast', async () => {
    // 1) conflict/missing 拦截：不触盘，重开恢复弹窗并把意图拉回 recover
    const conflict = createPipeline();
    conflict.pipeline.reportSaveIssue(
      { kind: 'conflict', source: 'workspace', path: '/note.md', message: '冲突' },
      false,
    );
    conflict.refs.showScratchExitDialog.value = false;
    conflict.pipeline.unsavedDialogIntent.value = 'close';
    await expect(conflict.pipeline.retryCurrentSave()).resolves.toBe(false);
    expect(conflict.refs.showScratchExitDialog.value).toBe(true);
    expect(conflict.pipeline.unsavedDialogIntent.value).toBe('recover');
    expect(conflict.mocks.writeFileIfUnchanged).not.toHaveBeenCalled();

    // 2) guided 守卫：委托「请求绑定工作区」并透传其结果
    const guided = createPipeline();
    guided.refs.isGuidedSampleSession.value = true;
    guided.mocks.requestWorkspaceForGuidedSave.mockReturnValue(true);
    await expect(guided.pipeline.retryCurrentSave()).resolves.toBe(true);
    expect(guided.mocks.requestWorkspaceForGuidedSave).toHaveBeenCalledTimes(1);
    expect(guided.mocks.writeFileIfUnchanged).not.toHaveBeenCalled();

    // 3) scratch 守卫：委托「另存为」并透传其结果
    const scratch = createPipeline();
    scratch.refs.isScratchSession.value = true;
    scratch.mocks.saveScratchAs.mockResolvedValue(false);
    await expect(scratch.pipeline.retryCurrentSave()).resolves.toBe(false);
    expect(scratch.mocks.saveScratchAs).toHaveBeenCalledTimes(1);

    // 4) unbound 守卫：要求绑定工作区（带保存动作文案）后放弃
    const unbound = createPipeline();
    unbound.refs.isWorkspaceUnbound.value = true;
    await expect(unbound.pipeline.retryCurrentSave()).resolves.toBe(false);
    expect(unbound.mocks.requireBoundWorkspace).toHaveBeenCalledWith('notebook.actions.saveNote');

    // 5) 外部只读会话：静默放弃（不弹 toast、不触盘）
    const readonly = createPipeline();
    readonly.refs.isExternalReadonly.value = true;
    await expect(readonly.pipeline.retryCurrentSave()).resolves.toBe(false);
    expect(readonly.mocks.toastShow).not.toHaveBeenCalled();
    expect(readonly.mocks.writeFileIfUnchanged).not.toHaveBeenCalled();

    // 6) 普通会话但无可存笔记 → noSavableNote 提示
    const noPath = createPipeline();
    noPath.refs.activePath.value = '';
    await expect(noPath.pipeline.retryCurrentSave()).resolves.toBe(false);
    expect(noPath.mocks.toastShow).toHaveBeenCalledWith(
      'notebook.toast.noSavableNote',
      'info',
      2500,
    );

    // 7) 外部编辑但授权失效 → externalAccessExpired 报错提示
    const expired = createPipeline();
    expired.refs.isExternalEditing.value = true;
    expired.refs.externalFile.value = null;
    await expect(expired.pipeline.retryCurrentSave()).resolves.toBe(false);
    expect(expired.mocks.toastShow).toHaveBeenCalledWith(
      'notebook.toast.externalAccessExpired',
      'error',
      4000,
    );

    // 8) io 失败：写盘抛错落 io issue，收尾报 retrySaveFailed toast
    const io = createPipeline();
    io.refs.isDirty.value = true;
    io.setForcedSaveFailure('磁盘满');
    await expect(io.pipeline.retryCurrentSave()).resolves.toBe(false);
    expect(io.pipeline.saveIssue.value).toMatchObject({
      kind: 'io',
      source: 'workspace',
      path: '/note.md',
      message: 'Error: 磁盘满',
    });
    expect(io.mocks.toastShow).toHaveBeenCalledWith(
      'notebook.toast.retrySaveFailed:{"error":"Error: 磁盘满"}',
      'error',
      4000,
    );
  });
});
