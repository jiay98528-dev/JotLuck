import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const exportNoteMock = vi.hoisted(() => vi.fn());
vi.mock('@/services/Exporter', () => ({ exportNote: exportNoteMock }));

import ExportDialog from '../ExportDialog.vue';
import { translate } from '@/i18n';

function findButton(label: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`Button not found: ${label}`);
  return button;
}

describe('ExportDialog error recovery', () => {
  beforeEach(() => {
    exportNoteMock.mockReset();
    document.body.replaceChildren();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('unlocks cancel and retry after exportNote rejects, then can succeed', async () => {
    exportNoteMock.mockRejectedValueOnce(new Error('磁盘空间不足'));
    const wrapper = mount(ExportDialog, {
      props: {
        visible: true,
        noteTitle: '测试笔记',
        markdownContent: '# 可导出内容',
      },
      attachTo: document.body,
    });

    findButton('导出').click();
    await flushPromises();

    expect(document.body.textContent).toContain('导出失败');
    expect(document.body.textContent).toContain(translate('dialogs.export.unknownError'));
    expect(document.body.textContent).not.toContain('磁盘空间不足');
    expect(document.body.textContent).not.toContain('正在导出...');
    expect(findButton('取消').disabled).toBe(false);
    expect(findButton('导出').disabled).toBe(false);

    exportNoteMock.mockResolvedValueOnce({
      success: true,
      fileName: '测试笔记.pdf',
      message: '打印对话框已关闭，请确认 PDF 已保存到所选位置。',
    });
    findButton('导出').click();
    await flushPromises();

    expect(exportNoteMock).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain('打印流程已结束');
    expect(document.body.textContent).toContain('请确认 PDF 已保存');
    wrapper.unmount();
  });

  it('uses a safe message for non-Error rejections', async () => {
    exportNoteMock.mockRejectedValueOnce({ internalPath: 'private' });
    const wrapper = mount(ExportDialog, {
      props: { visible: true, markdownContent: 'content' },
      attachTo: document.body,
    });

    findButton('导出').click();
    await flushPromises();

    expect(document.body.textContent).toContain('导出过程中发生未知错误');
    expect(document.body.textContent).not.toContain('private');
    wrapper.unmount();
  });

  it('ignores a duplicate submission while the first export is pending', async () => {
    let resolveExport!: (value: { success: boolean; fileName: string }) => void;
    exportNoteMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveExport = resolve;
        }),
    );
    const wrapper = mount(ExportDialog, {
      props: { visible: true, markdownContent: 'content' },
      attachTo: document.body,
    });

    const exportButton = findButton('导出');
    exportButton.click();
    exportButton.click();
    expect(exportNoteMock).toHaveBeenCalledTimes(1);

    resolveExport({ success: true, fileName: 'note.pdf' });
    await flushPromises();
    wrapper.unmount();
  });

  it('aborts a closed run and ignores its late result after the dialog reopens', async () => {
    let resolveFirst!: (value: { success: boolean; message: string }) => void;
    let resolveSecond!: (value: { success: boolean; message: string }) => void;
    exportNoteMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );
    const wrapper = mount(ExportDialog, {
      props: { visible: true, markdownContent: 'content' },
      attachTo: document.body,
    });

    findButton('导出').click();
    const firstSignal = exportNoteMock.mock.calls[0]?.[2]?.signal as AbortSignal;
    expect(firstSignal.aborted).toBe(false);
    await flushPromises();
    findButton('取消导出').click();
    expect(firstSignal.aborted).toBe(true);

    await wrapper.setProps({ visible: false });
    await wrapper.setProps({ visible: true });
    findButton('导出').click();
    resolveFirst({ success: true, message: '过期任务完成' });
    await flushPromises();

    expect(document.body.textContent).toContain(translate('dialogs.export.exporting'));
    expect(document.body.textContent).not.toContain('过期任务完成');

    resolveSecond({ success: true, message: '当前任务完成' });
    await flushPromises();
    expect(document.body.textContent).toContain('当前任务完成');
    wrapper.unmount();
  });

  it('aborts the active exporter when unmounted', () => {
    exportNoteMock.mockImplementationOnce(() => new Promise(() => undefined));
    const wrapper = mount(ExportDialog, {
      props: { visible: true, markdownContent: 'content' },
      attachTo: document.body,
    });

    findButton('导出').click();
    const signal = exportNoteMock.mock.calls[0]?.[2]?.signal as AbortSignal;
    wrapper.unmount();

    expect(signal.aborted).toBe(true);
  });
});
