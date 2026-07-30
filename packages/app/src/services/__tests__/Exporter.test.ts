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
      error: '无法打开 PDF 打印对话框：print unavailable',
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
});
