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
