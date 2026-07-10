import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CompletionTrainingService,
  loadTrainingMeta,
  stripUntrainableMarkdown,
  TRAINING_META_KEY,
  trainingMetaKeyForScope,
} from '../CompletionTrainingService';
import { MarkdownPredictor } from '../MarkdownPredictor';
import type { DirEntry, IFileSystemService } from '@/types';

function setupLocalStorageMock() {
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      Object.keys(store).forEach((key) => delete store[key]);
    }),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: false } as Response)),
  );
  vi.stubGlobal('requestIdleCallback', (cb: IdleRequestCallback) => {
    cb({ didTimeout: false, timeRemaining: () => 10 });
    return 1;
  });
  return store;
}

function mockFs(files: Record<string, string>): IFileSystemService {
  return {
    readFile: vi.fn((path: string) => Promise.resolve(files[path] ?? '')),
    writeFile: vi.fn(),
    writeBinary: vi.fn(),
    readBinary: vi.fn(),
    isBinaryPath: vi.fn(() => false),
    deleteFile: vi.fn(),
    renameFile: vi.fn(),
    createDirectory: vi.fn(),
    listDirectory: vi.fn(),
    statFile: vi.fn((path: string) =>
      Promise.resolve({
        path,
        size: files[path]?.length ?? 0,
        mtime: 1,
        isFile: true,
        isDirectory: false,
      }),
    ),
    watch: vi.fn(),
    unwatchAll: vi.fn(),
    resolvePath: vi.fn(),
    isPathInNotebook: vi.fn(),
    openNotebook: vi.fn(),
    getRecentNotebooks: vi.fn(),
  } as unknown as IFileSystemService;
}

describe('CompletionTrainingService', () => {
  beforeEach(() => {
    setupLocalStorageMock();
  });

  it('strips code blocks and inline code before training', () => {
    const cleaned = stripUntrainableMarkdown(
      'a\n```ts\nconst x = 1\n```\ntext `code`\n![x](a.png)',
    );
    expect(cleaned).toContain('text');
    expect(cleaned).not.toContain('const x');
    expect(cleaned).not.toContain('`code`');
    expect(cleaned).not.toContain('![x]');
  });

  it('trains only eligible changed text files and writes meta', async () => {
    const fs = mockFs({
      '/a.md': '这是一个项目记录。为了更好验证，需要多写几句。',
      '/assets/img.png': 'binary',
      '/huge.md': 'x',
    });
    const predictor = new MarkdownPredictor();
    const service = new CompletionTrainingService(fs, predictor);
    const entries: DirEntry[] = [
      { path: '/a.md', name: 'a.md', isFile: true, isDirectory: false, size: 80, mtime: 1 },
      {
        path: '/assets/img.png',
        name: 'img.png',
        isFile: true,
        isDirectory: false,
        size: 10,
        mtime: 1,
      },
      {
        path: '/huge.md',
        name: 'huge.md',
        isFile: true,
        isDirectory: false,
        size: 999999,
        mtime: 1,
      },
    ];

    await service.trainNotebook(entries);

    expect(fs.readFile).toHaveBeenCalledWith('/a.md');
    expect(fs.readFile).not.toHaveBeenCalledWith('/assets/img.png');
    expect(fs.readFile).not.toHaveBeenCalledWith('/huge.md');
    const meta = loadTrainingMeta();
    expect(meta.status).toBe('done');
    expect(meta.fileCount).toBe(1);
    expect(meta.trainedPaths['/a.md']).toEqual({ mtime: 1, size: 80 });
    expect(localStorage.getItem(trainingMetaKeyForScope())).not.toBeNull();
  });

  it('records partial training failures without reporting done', async () => {
    const fs = mockFs({
      '/ok.md': '为了验证训练部分失败，这里写入一段普通文本。',
      '/bad.md': 'unreadable',
    });
    vi.mocked(fs.readFile).mockImplementation((path: string) => {
      if (path === '/bad.md') return Promise.reject(new Error('permission denied'));
      return Promise.resolve('/ok.md content 为了验证训练部分失败');
    });
    const service = new CompletionTrainingService(fs, new MarkdownPredictor());
    const entries: DirEntry[] = [
      { path: '/ok.md', name: 'ok.md', isFile: true, isDirectory: false, size: 40, mtime: 1 },
      { path: '/bad.md', name: 'bad.md', isFile: true, isDirectory: false, size: 40, mtime: 1 },
    ];

    await service.trainNotebook(entries);

    const meta = loadTrainingMeta();
    expect(meta.status).toBe('partial');
    expect(meta.successCount).toBe(1);
    expect(meta.failureCount).toBe(1);
    expect(meta.failedPaths['/bad.md']).toContain('permission denied');
  });

  it('removePath updates persisted meta', () => {
    localStorage.setItem(
      TRAINING_META_KEY,
      JSON.stringify({
        version: 1,
        status: 'done',
        trainedPaths: { '/a.md': { mtime: 1, size: 2 } },
        fileCount: 1,
        updatedAt: 1,
      }),
    );
    const service = new CompletionTrainingService(mockFs({}), new MarkdownPredictor());
    service.removePath('/a.md');
    expect(loadTrainingMeta().fileCount).toBe(0);
  });

  it('does not reuse the default trainedPaths object after localStorage is cleared', async () => {
    const service = new CompletionTrainingService(mockFs({}), new MarkdownPredictor());
    await service.trainFile('/a.md', '为了验证默认元数据隔离，写入一段普通文本。', {
      mtime: 1,
      size: 24,
    });

    localStorage.clear();

    expect(loadTrainingMeta().trainedPaths).toEqual({});
    expect(loadTrainingMeta().fileCount).toBe(0);
  });
});
