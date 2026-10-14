import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

// review-version-naming 属并行工单；以确定性 mock 驱动组件流程断言
const nextReviewVersionFileNameMock = vi.hoisted(() => vi.fn());
const formatReviewVersionPreviewMock = vi.hoisted(() => vi.fn());
vi.mock('@/utils/review-version-naming', () => ({
  nextReviewVersionFileName: nextReviewVersionFileNameMock,
  formatReviewVersionPreview: formatReviewVersionPreviewMock,
}));

import ReviewExportDialog from '../ReviewExportDialog.vue';
import type { IFileSystemService } from '@/types/file-system';

formatReviewVersionPreviewMock.mockImplementation(
  (stem: string, rule: { prefix: string; padding: number; includeDate: boolean }, num: number) =>
    `${stem} ${rule.prefix}${String(num).padStart(rule.padding, '0')}${
      rule.includeDate ? ' 2026-01-02' : ''
    }.md`,
);

function createFsMock(
  listDirectory: IFileSystemService['listDirectory'],
  writeFile: IFileSystemService['writeFile'],
): IFileSystemService {
  return { listDirectory, writeFile } as unknown as IFileSystemService;
}

function mountDialog(fs: IFileSystemService) {
  return mount(ReviewExportDialog, {
    props: {
      visible: true,
      fs,
      root: 'rootA',
      notePath: 'notes/idea.md',
      workingText: '# 改后全文',
    },
    attachTo: document.body,
  });
}

function findExportButton(): HTMLButtonElement {
  const button = document.body.querySelector<HTMLButtonElement>('[data-review-export-confirm]');
  if (!button) throw new Error('导出按钮未找到');
  return button;
}

describe('ReviewExportDialog', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    nextReviewVersionFileNameMock.mockReset();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('规则联动实时预览（以起始号预览）', async () => {
    const wrapper = mountDialog(createFsMock(vi.fn(), vi.fn()));
    const preview = () => document.body.querySelector('.rule-preview-name')?.textContent ?? '';

    // 默认规则 V / 1 / 位数 1 / 无日期 → "idea V1.md"
    expect(preview()).toBe('idea V1.md');

    const prefixInput = document.body.querySelector<HTMLInputElement>('.rule-input-prefix')!;
    prefixInput.value = 'R';
    prefixInput.dispatchEvent(new Event('input'));
    await nextTick();
    expect(preview()).toBe('idea R1.md');

    const startInput = document.body.querySelector<HTMLInputElement>('input[type="number"]')!;
    startInput.value = '3';
    startInput.dispatchEvent(new Event('input'));
    await nextTick();
    expect(preview()).toBe('idea R3.md');

    const paddingOptions = [
      ...document.body.querySelectorAll<HTMLButtonElement>('.rule-padding-option'),
    ];
    paddingOptions[1]!.click(); // 位数 2 → V01
    await nextTick();
    expect(preview()).toBe('idea R03.md');

    const toggle = document.body.querySelector<HTMLElement>('.toggle-track')!;
    toggle.click(); // 含日期
    await nextTick();
    expect(preview()).toBe('idea R03 2026-01-02.md');
    wrapper.unmount();
  });

  it('导出成功：listDirectory → nextReviewVersionFileName → writeFile，成功态显示新文件名', async () => {
    const listDirectory = vi
      .fn()
      .mockResolvedValue([
        { name: 'idea V1.md', path: 'notes/idea V1.md', isDirectory: false, isFile: true },
      ]);
    const writeFile = vi.fn().mockResolvedValue(undefined);
    nextReviewVersionFileNameMock.mockReturnValue('idea V2.md');
    const wrapper = mountDialog(createFsMock(listDirectory, writeFile));

    findExportButton().click();
    await flushPromises();

    expect(listDirectory).toHaveBeenCalledWith('notes');
    expect(nextReviewVersionFileNameMock).toHaveBeenCalledWith(
      'idea',
      ['idea V1.md'],
      expect.objectContaining({ prefix: 'V', start: 1, padding: 1, includeDate: false }),
    );
    expect(writeFile).toHaveBeenCalledWith('notes/idea V2.md', '# 改后全文');
    expect(document.body.textContent).toContain('idea V2.md');
    expect(wrapper.emitted('exported')).toEqual([['notes/idea V2.md', 'idea V2.md']]);
    wrapper.unmount();
  });

  it('极端并发重名：首个名字写入失败 → 名字 +1 重试一次成功', async () => {
    const listDirectory = vi
      .fn()
      .mockResolvedValue([{ name: 'idea V1.md', path: 'x', isDirectory: false, isFile: true }]);
    const writeFile = vi
      .fn()
      .mockRejectedValueOnce(new Error('file exists'))
      .mockResolvedValueOnce(undefined);
    nextReviewVersionFileNameMock
      .mockReturnValueOnce('idea V2.md')
      .mockImplementationOnce((_stem: string, names: readonly string[]) =>
        names.includes('idea V2.md') ? 'idea V3.md' : 'idea V9.md',
      );
    const wrapper = mountDialog(createFsMock(listDirectory, writeFile));

    findExportButton().click();
    await flushPromises();

    expect(nextReviewVersionFileNameMock).toHaveBeenCalledTimes(2);
    // 重试调用的名字表包含首次尝试的名字
    expect(nextReviewVersionFileNameMock.mock.calls[1]?.[1]).toContain('idea V2.md');
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(writeFile).toHaveBeenLastCalledWith('notes/idea V3.md', '# 改后全文');
    expect(document.body.textContent).toContain('idea V3.md');
    wrapper.unmount();
  });

  it('两次写入都失败 → 失败态显示错误', async () => {
    const listDirectory = vi.fn().mockResolvedValue([]);
    const writeFile = vi.fn().mockRejectedValue(new Error('磁盘不可用'));
    nextReviewVersionFileNameMock.mockReturnValue('idea V1.md');
    const wrapper = mountDialog(createFsMock(listDirectory, writeFile));

    findExportButton().click();
    await flushPromises();

    expect(document.body.querySelector('.error-text')).not.toBeNull();
    expect(document.body.textContent).toContain('磁盘不可用');
    // 失败态可重试（导出按钮回到可用）
    expect(findExportButton().disabled).toBe(false);
    wrapper.unmount();
  });
});
