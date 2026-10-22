import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportFormat } from '@/types';
import { exportNote } from '../Exporter';

describe('Exporter CSV safety', () => {
  let capturedBlob: Blob | null = null;
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;

  beforeEach(() => {
    capturedBlob = null;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((blob: Blob | MediaSource) => {
        capturedBlob = blob as Blob;
        return 'blob:jotluck-test';
      }),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(() => undefined),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalCreateObjectUrl) {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: originalCreateObjectUrl,
      });
    } else {
      Reflect.deleteProperty(URL, 'createObjectURL');
    }
    if (originalRevokeObjectUrl) {
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: originalRevokeObjectUrl,
      });
    } else {
      Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
  });

  it('prefixes dangerous table cells to prevent spreadsheet formula execution', async () => {
    await exportNote('| A | B |\n| --- | --- |\n| =cmd | +sum |\n| -x | @user |', 'table', {
      format: ExportFormat.CSV,
    });

    expect(capturedBlob).not.toBeNull();
    const csv = await capturedBlob!.text();
    expect(csv).toContain("'=cmd");
    expect(csv).toContain("'+sum");
    expect(csv).toContain("'-x");
    expect(csv).toContain("'@user");
  });

  it('protects whole-document single-cell CSV export too', async () => {
    await exportNote('=HYPERLINK("https://example.test")', 'note', {
      format: ExportFormat.CSV,
    });

    expect(capturedBlob).not.toBeNull();
    expect(await capturedBlob!.text()).toBe(`"'=HYPERLINK(""https://example.test"")"`);
  });

  it('does not trigger a download when the export is already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      exportNote('# cancelled', 'cancelled', {
        format: ExportFormat.CSV,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    expect(capturedBlob).toBeNull();
  });

  it('rejects empty markdown with export.empty before any download side effect', async () => {
    const result = await exportNote('', 'empty-note', { format: ExportFormat.CSV });

    expect(result).toMatchObject({
      success: false,
      format: ExportFormat.CSV,
      error: '笔记内容为空',
    });
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    expect(capturedBlob).toBeNull();
  });
});

describe('Exporter MD format and stage callback', () => {
  let capturedBlob: Blob | null = null;
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;

  beforeEach(() => {
    capturedBlob = null;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((blob: Blob | MediaSource) => {
        capturedBlob = blob as Blob;
        return 'blob:jotluck-test';
      }),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(() => undefined),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalCreateObjectUrl) {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: originalCreateObjectUrl,
      });
    } else {
      Reflect.deleteProperty(URL, 'createObjectURL');
    }
    if (originalRevokeObjectUrl) {
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: originalRevokeObjectUrl,
      });
    } else {
      Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
  });

  it('exports preprocessed markdown (frontmatter kept, wiki-links converted) as UTF-8 blob', async () => {
    const result = await exportNote(
      '---\ntitle: 示例\n---\n\n首段 [[目标|别名]] 收尾。',
      'md-note',
      { format: ExportFormat.MD },
    );

    expect(result).toMatchObject({
      success: true,
      format: ExportFormat.MD,
      fileName: 'md-note.md',
    });
    expect(capturedBlob).not.toBeNull();
    // Blob 规范将 type 归一化为 ASCII 小写：源码传入 charset=UTF-8，读取恒为 utf-8
    expect(capturedBlob!.type).toBe('text/markdown;charset=utf-8');
    const text = await capturedBlob!.text();
    // 导出选项语义照 TXT 惯例：默认保留 frontmatter
    expect(text).toContain('---\ntitle: 示例\n---');
    // 默认 includeWikiLinks=true：[[目标|别名]] → [别名](目标)
    expect(text).toContain('[别名](目标)');
  });

  it('strips frontmatter when includeFrontmatter is false', async () => {
    await exportNote('---\ntitle: 示例\n---\n\n正文段。', 'md-no-fm', {
      format: ExportFormat.MD,
      includeFrontmatter: false,
    });

    const text = await capturedBlob!.text();
    expect(text).not.toContain('title');
    expect(text).toContain('正文段。');
  });

  it('reports the rendering stage and never packing for MD', async () => {
    const onStage = vi.fn();
    await exportNote('# MD 阶段', 'md-stage', { format: ExportFormat.MD, onStage });

    expect(onStage).toHaveBeenCalledWith('rendering');
    // MD 无打包步骤——不应回报 packing
    expect(onStage).not.toHaveBeenCalledWith('packing');
  });
});

describe('Exporter PDF terminal states', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  function mockPrintWindow(print: () => void): void {
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue({
      focus: vi.fn(),
      print,
    } as unknown as Window);
  }

  function currentIframe(): HTMLIFrameElement {
    const iframe = document.querySelector('iframe');
    if (!(iframe instanceof HTMLIFrameElement)) throw new Error('PDF iframe was not created');
    return iframe;
  }

  it('fails and cleans up when the print page never loads', async () => {
    const resultPromise = exportNote('# PDF', 'timeout', { format: ExportFormat.PDF });
    const iframe = currentIframe();
    // JSDOM 会为 srcdoc 自动派发 load；清除处理器以模拟浏览器始终未触发 load。
    iframe.onload = null;

    await vi.advanceTimersByTimeAsync(5000);

    await expect(resultPromise).resolves.toMatchObject({
      success: false,
      format: ExportFormat.PDF,
      error: 'PDF 打印页面准备超时，请重试',
    });
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('fails and cleans up when the print page reports a load error', async () => {
    const resultPromise = exportNote('# PDF', 'load-error', { format: ExportFormat.PDF });
    currentIframe().dispatchEvent(new Event('error'));

    await expect(resultPromise).resolves.toMatchObject({
      success: false,
      error: 'PDF 打印页面加载失败，请重试',
    });
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('fails when the iframe has no printable window', async () => {
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue(null);
    const resultPromise = exportNote('# PDF', 'no-window', { format: ExportFormat.PDF });
    currentIframe().dispatchEvent(new Event('load'));

    await expect(resultPromise).resolves.toMatchObject({
      success: false,
      error: 'PDF 打印页面不可用，请重试',
    });
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('fails when print throws and ignores a late repeated load', async () => {
    const print = vi.fn(() => {
      throw new Error('print unavailable');
    });
    mockPrintWindow(print);
    const resultPromise = exportNote('# PDF', 'print-error', { format: ExportFormat.PDF });
    const iframe = currentIframe();
    iframe.dispatchEvent(new Event('load'));

    await expect(resultPromise).resolves.toMatchObject({
      success: false,
      error: '无法打开 PDF 打印对话框',
    });
    iframe.dispatchEvent(new Event('load'));
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('settles once after print returns and communicates the real outcome', async () => {
    const print = vi.fn();
    mockPrintWindow(print);
    const resultPromise = exportNote('# PDF', 'success', { format: ExportFormat.PDF });
    const iframe = currentIframe();
    iframe.dispatchEvent(new Event('load'));

    await expect(resultPromise).resolves.toMatchObject({
      success: true,
      format: ExportFormat.PDF,
      fileName: 'success.pdf',
      message: '打印对话框已关闭，请确认 PDF 已保存到所选位置。',
    });
    iframe.dispatchEvent(new Event('load'));
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.querySelector('iframe')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts PDF preparation through the shared cleanup path', async () => {
    const print = vi.fn();
    mockPrintWindow(print);
    const controller = new AbortController();
    const resultPromise = exportNote('# PDF', 'cancelled', {
      format: ExportFormat.PDF,
      signal: controller.signal,
    });
    const iframe = currentIframe();
    const rejection = expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' });

    controller.abort();
    await rejection;

    iframe.dispatchEvent(new Event('load'));
    expect(print).not.toHaveBeenCalled();
    expect(document.querySelector('iframe')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
