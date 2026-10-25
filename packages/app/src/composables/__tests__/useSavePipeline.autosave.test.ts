import { ref } from 'vue';
import type { Ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSavePipeline } from '../useSavePipeline';
import type { SavePipelineOpenedFile, UseSavePipelineOptions } from '../useSavePipeline';
import type { ConditionalWriteResult, IFileSystemService } from '@/types';

/**
 * useSavePipeline 自动保存设置契约（设置页「自动保存」区下发）：
 * - autoSaveEnabled=false：不排程；运行中翻闸时已排程任务即时失效；
 * - autoSaveDelay 经管线钳制到滑杆边界（500–10000ms），非法值兜底 600ms；
 * - 重复排程顶替旧句柄；手动保存路径（flush/retry/debounced*）不受本门影响
 *   （isSaving 指示器熄灭地板为展示语义，不在本组断言范围内）。
 */
describe('useSavePipeline autosave gate and delay clamping', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createPipeline(overrides?: { enabled?: Ref<boolean>; delayMs?: () => number }) {
    const options: UseSavePipelineOptions = {
      currentContent: ref(''),
      activePath: ref('/note.md'),
      activeNotebookRoot: ref('/root'),
      externalFile: ref<SavePipelineOpenedFile | null>(null),
      isDirty: ref(false),
      isSaving: ref(false),
      saveError: ref<string | null>(null),
      showScratchExitDialog: ref(false),
      wikiLinkRevision: ref(0),
      editorRef: ref(null),
      fs: {} as IFileSystemService,
      indexStore: {} as UseSavePipelineOptions['indexStore'],
      notebookDataGeneration: () => 0,
      forcedE2ESaveFailure: { get: () => null, set: () => undefined },
      autoSaveEnabled: overrides?.enabled ?? ref(true),
      autoSaveDelayMs: overrides?.delayMs ?? (() => 600),
      isExternalEditing: ref(false),
      isExternalReadonly: ref(false),
      isGuidedSampleSession: ref(false),
      isScratchSession: ref(false),
      isWorkspaceUnbound: ref(false),
      isNotebookOpening: ref(false),
      externalFileKey: () => '',
      writeExternalNoteFileIfUnchanged: async () =>
        ({ status: 'saved', revision: 'r' }) as ConditionalWriteResult,
      syncCurrentContentFromEditor: () => undefined,
      persistGuidedSampleCurrent: () => undefined,
      requestWorkspaceForGuidedSave: () => true,
      saveScratchAs: async () => true,
      requireBoundWorkspace: () => true,
      trainCurrentFile: async () => undefined,
      userErrorMessage: (error: unknown) => String(error),
      toast: {
        show: () => undefined,
        success: () => undefined,
        warning: () => undefined,
        error: () => undefined,
        info: () => undefined,
        dismiss: () => undefined,
      },
      t: (key: string) => key,
    };
    return useSavePipeline(options);
  }

  it('按设置延迟排程：600ms 前 1ms 不触发，600ms 到点触发', () => {
    const pipeline = createPipeline();
    const callback = vi.fn();
    pipeline.scheduleSave(callback);

    vi.advanceTimersByTime(599);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('autoSaveEnabled=false：不排程（远超延迟窗口后仍零触发）', () => {
    const pipeline = createPipeline({ enabled: ref(false), delayMs: () => 600 });
    const callback = vi.fn();
    pipeline.scheduleSave(callback);

    vi.advanceTimersByTime(60000);
    expect(callback).not.toHaveBeenCalled();
  });

  it('运行中关闸：已排程任务即时失效（撤旧句柄，不再触发）', () => {
    const enabled = ref(true);
    const pipeline = createPipeline({ enabled, delayMs: () => 600 });
    const callback = vi.fn();
    pipeline.scheduleSave(callback);
    enabled.value = false;

    vi.advanceTimersByTime(60000);
    expect(callback).not.toHaveBeenCalled();
  });

  it('延迟钳制：低于 500 抬到 500，高于 10000 压到 10000，非法值兜底 600', () => {
    const tooFast = createPipeline({ delayMs: () => 100 });
    const fastCallback = vi.fn();
    tooFast.scheduleSave(fastCallback);
    vi.advanceTimersByTime(499);
    expect(fastCallback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fastCallback).toHaveBeenCalledTimes(1);

    const tooSlow = createPipeline({ delayMs: () => 999999 });
    const slowCallback = vi.fn();
    tooSlow.scheduleSave(slowCallback);
    vi.advanceTimersByTime(10000);
    expect(slowCallback).toHaveBeenCalledTimes(1);

    const invalid = createPipeline({ delayMs: () => Number.NaN });
    const fallbackCallback = vi.fn();
    invalid.scheduleSave(fallbackCallback);
    vi.advanceTimersByTime(599);
    expect(fallbackCallback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fallbackCallback).toHaveBeenCalledTimes(1);
  });

  it('重复排程顶替旧句柄：只有最后一次回调触发', () => {
    const pipeline = createPipeline();
    const first = vi.fn();
    const second = vi.fn();
    pipeline.scheduleSave(first);
    pipeline.scheduleSave(second);

    vi.advanceTimersByTime(600);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('关闸后重新开闸：后续排程恢复生效', () => {
    const enabled = ref(false);
    const pipeline = createPipeline({ enabled, delayMs: () => 600 });
    const suppressed = vi.fn();
    pipeline.scheduleSave(suppressed);
    enabled.value = true;

    const resumed = vi.fn();
    pipeline.scheduleSave(resumed);
    vi.advanceTimersByTime(600);
    expect(suppressed).not.toHaveBeenCalled();
    expect(resumed).toHaveBeenCalledTimes(1);
  });
});
