import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CompletionTrainingService,
  DEFAULT_TRAINING_META,
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

function predictorPrivate(predictor: MarkdownPredictor) {
  return predictor as unknown as {
    notebookLong: Map<string, Map<string, number>>;
    notebookLongSupport: Map<string, Map<string, number>>;
    documentContributions: Map<string, unknown>;
    getNotebookLongTable(): Map<string, Map<string, number>>;
  };
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

    const boundaryCleaned = stripUntrainableMarkdown(
      '---\r\ntitle: hidden\r\n---\r\nvisible\r\n   ~~~~ts\r\nhidden\r\n   ~~~~~\r\nafter',
    );
    expect(boundaryCleaned).toBe('visible\nafter');
    expect(stripUntrainableMarkdown('---\r\ntitle: unclosed\r\nsecret')).toBe('');
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

  it('rebuilds memory-only N2 in a new session even when persisted metadata is unchanged', async () => {
    const text = '甲乙丙丁戊甲乙丙丁戊甲乙丙丁戊';
    const fs = mockFs({ '/a.md': text });
    const entries: DirEntry[] = [
      {
        path: '/a.md',
        name: 'a.md',
        isFile: true,
        isDirectory: false,
        size: text.length,
        mtime: 1,
      },
    ];
    await new CompletionTrainingService(fs, new MarkdownPredictor()).trainNotebook(entries);
    vi.mocked(fs.readFile).mockClear();
    const nextPredictor = new MarkdownPredictor();

    await new CompletionTrainingService(fs, nextPredictor).trainNotebook(entries);

    expect(fs.readFile).toHaveBeenCalledWith('/a.md');
    expect(nextPredictor.hasDocumentContribution('/a.md')).toBe(true);
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

  it('clears corrupt or schema-invalid training metadata without blocking completion', () => {
    const key = trainingMetaKeyForScope('workspace-a');
    localStorage.setItem(key, '{broken');

    expect(loadTrainingMeta('workspace-a')).toEqual(DEFAULT_TRAINING_META);
    expect(localStorage.getItem(key)).toBeNull();

    localStorage.setItem(
      key,
      JSON.stringify({
        version: 2,
        status: 'done',
        trainedPaths: { '/a.md': { mtime: 'yesterday', size: -1 } },
        updatedAt: 1,
        successCount: 1,
        failureCount: 0,
        failedPaths: {},
      }),
    );
    expect(loadTrainingMeta('workspace-a')).toEqual(DEFAULT_TRAINING_META);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('replays the current filesystem fact snapshot even when persisted meta is corrupt', async () => {
    const fs = mockFs({
      '/current-a.md': 'Project status needs careful review.',
      '/current-b.md': 'Project status needs careful review.',
    });
    const predictor = new MarkdownPredictor();
    predictor.setStorageScope('workspace-facts');
    let replayProvider:
      | ((
          scope: string,
          signal: AbortSignal,
        ) =>
          | Promise<Iterable<{ path: string; content: string }>>
          | Iterable<{ path: string; content: string }>)
      | undefined;
    vi.spyOn(predictor, 'setHybridRetrievalReplayProvider').mockImplementation((provider) => {
      replayProvider = provider;
    });
    const service = new CompletionTrainingService(fs, predictor);
    await service.trainNotebook([
      {
        path: '/current-a.md',
        name: 'current-a.md',
        isFile: true,
        isDirectory: false,
        size: 36,
        mtime: 1,
      },
      {
        path: '/current-b.md',
        name: 'current-b.md',
        isFile: true,
        isDirectory: false,
        size: 36,
        mtime: 1,
      },
    ]);
    localStorage.setItem(trainingMetaKeyForScope('workspace-facts'), '{corrupt');

    const replayed = [
      ...(await replayProvider?.('workspace-facts', new AbortController().signal))!,
    ];

    expect(replayed.map(({ path }) => path)).toEqual(['/current-a.md', '/current-b.md']);
    expect(fs.readFile).toHaveBeenCalledWith('/current-a.md');
    expect(fs.readFile).toHaveBeenCalledWith('/current-b.md');
  });

  it('updates replay facts on save, rename, remove and reset', async () => {
    const fs = mockFs({
      '/a.md': 'Saved content.',
      '/renamed.md': 'Renamed content.',
      '/reset.md': 'Reset content.',
    });
    const predictor = new MarkdownPredictor();
    let replayProvider:
      | ((
          scope: string,
          signal: AbortSignal,
        ) =>
          | Promise<Iterable<{ path: string; content: string }>>
          | Iterable<{ path: string; content: string }>)
      | undefined;
    vi.spyOn(predictor, 'setHybridRetrievalReplayProvider').mockImplementation((provider) => {
      replayProvider = provider;
    });
    const service = new CompletionTrainingService(fs, predictor);
    const replayPaths = async () =>
      [...(await replayProvider?.('unscoped', new AbortController().signal))!].map(
        ({ path }) => path,
      );

    await service.trainFile('/a.md', 'Saved content.');
    expect(await replayPaths()).toEqual(['/a.md']);

    service.renamePath('/a.md', '/renamed.md');
    expect(await replayPaths()).toEqual(['/renamed.md']);

    service.removePath('/renamed.md');
    expect(await replayPaths()).toEqual([]);

    await service.trainFile('/reset.md', 'Reset content.');
    service.resetContributions();
    expect(await replayPaths()).toEqual([]);
  });

  it('cancels an old workspace run before a delayed file read can write contributions', async () => {
    let resolveRead: ((value: string) => void) | undefined;
    const fs = mockFs({});
    vi.mocked(fs.readFile).mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const predictor = new MarkdownPredictor();
    predictor.setStorageScope('workspace-a');
    const service = new CompletionTrainingService(fs, predictor);
    const run = service.trainNotebook([
      { path: '/late.md', name: 'late.md', isFile: true, isDirectory: false, size: 40, mtime: 1 },
    ]);
    await vi.waitFor(() => expect(fs.readFile).toHaveBeenCalledWith('/late.md'));

    service.cancelCurrentRun();
    resolveRead?.('延迟读取的正文不应写入旧工作区贡献。');
    await run;

    expect(predictor.hasDocumentContribution('/late.md')).toBe(false);
  });

  it('lets a newer notebook snapshot supersede an in-flight run', async () => {
    let resolveOldRead: ((value: string) => void) | undefined;
    const fs = mockFs({ '/new.md': 'new snapshot phrase new snapshot phrase' });
    vi.mocked(fs.readFile).mockImplementation((path) => {
      if (path === '/old.md') {
        return new Promise<string>((resolve) => {
          resolveOldRead = resolve;
        });
      }
      return Promise.resolve('new snapshot phrase new snapshot phrase');
    });
    const predictor = new MarkdownPredictor();
    const service = new CompletionTrainingService(fs, predictor);
    const oldRun = service.trainNotebook([
      { path: '/old.md', name: 'old.md', isFile: true, isDirectory: false, size: 32, mtime: 1 },
    ]);
    await vi.waitFor(() => expect(fs.readFile).toHaveBeenCalledWith('/old.md'));

    const newRun = service.trainNotebook([
      { path: '/new.md', name: 'new.md', isFile: true, isDirectory: false, size: 40, mtime: 2 },
    ]);
    resolveOldRead?.('stale snapshot phrase stale snapshot phrase');
    await Promise.all([oldRun, newRun]);

    expect(predictor.hasDocumentContribution('/old.md')).toBe(false);
    expect(predictor.hasDocumentContribution('/new.md')).toBe(true);
  });

  it('drops notebook contributions renamed to an unsupported extension', async () => {
    const predictor = new MarkdownPredictor();
    const service = new CompletionTrainingService(mockFs({}), predictor);
    await service.trainFile('/note.md', 'supported note phrase supported note phrase');

    service.renamePath('/note.md', '/note.png');

    expect(predictor.hasDocumentContribution('/note.md')).toBe(false);
    expect(predictor.hasDocumentContribution('/note.png')).toBe(false);
  });

  it('measures UTF-8 bytes when file metadata is missing or stale', async () => {
    const predictor = new MarkdownPredictor();
    const service = new CompletionTrainingService(mockFs({}), predictor);
    const oversized = '界'.repeat(180_000);

    await service.trainFile('/large.md', oversized, { mtime: 1, size: 1 });

    expect(predictor.hasDocumentContribution('/large.md')).toBe(false);
  });

  it('replaces per-path contribution idempotently and retracts edited content', async () => {
    const predictor = new MarkdownPredictor();
    const service = new CompletionTrainingService(mockFs({}), predictor);
    const oldText = '甲乙丙丁戊甲乙丙丁戊甲乙丙丁戊';
    const newText = '甲乙丙丁己甲乙丙丁己甲乙丙丁己';

    await service.trainFile('/a.md', oldText, { mtime: 1, size: oldText.length });
    const firstCount = predictorPrivate(predictor).notebookLong.get('甲乙丙丁')?.get('戊');
    await service.trainFile('/a.md', oldText, { mtime: 1, size: oldText.length });
    const repeatedCount = predictorPrivate(predictor).notebookLong.get('甲乙丙丁')?.get('戊');
    await service.trainFile('/a.md', newText, { mtime: 2, size: newText.length });

    expect(firstCount).toBeGreaterThan(0);
    expect(repeatedCount).toBe(firstCount);
    expect(predictorPrivate(predictor).notebookLong.get('甲乙丙丁')?.get('戊')).toBeUndefined();
    expect(predictorPrivate(predictor).notebookLong.get('甲乙丙丁')?.get('己')).toBeGreaterThan(0);
  });

  it('subtracts only the removed path contribution from shared aggregate counts', async () => {
    const predictor = new MarkdownPredictor();
    const service = new CompletionTrainingService(mockFs({}), predictor);
    const text = '甲乙丙丁戊甲乙丙丁戊甲乙丙丁戊';

    await service.trainFile('/a.md', text, { mtime: 1, size: text.length });
    const oneFileCount = predictorPrivate(predictor).notebookLong.get('甲乙丙丁')?.get('戊');
    await service.trainFile('/b.md', text, { mtime: 1, size: text.length });
    const twoFileCount = predictorPrivate(predictor).notebookLong.get('甲乙丙丁')?.get('戊');
    service.removePath('/a.md');

    expect(twoFileCount).toBe((oneFileCount ?? 0) * 2);
    expect(predictorPrivate(predictor).notebookLong.get('甲乙丙丁')?.get('戊')).toBe(oneFileCount);
  });

  it('aggregates one-off transitions across documents before notebook pruning', async () => {
    const predictor = new MarkdownPredictor();
    const service = new CompletionTrainingService(mockFs({}), predictor);
    const text = '甲乙丙丁戊';

    await service.trainFile('/a.md', text, { mtime: 1, size: text.length });
    expect(predictorPrivate(predictor).notebookLong.get('甲乙丙丁')?.get('戊')).toBe(1);
    expect(predictorPrivate(predictor).notebookLongSupport.get('甲乙丙丁')?.get('戊')).toBe(1);
    expect(predictorPrivate(predictor).getNotebookLongTable().has('甲乙丙丁')).toBe(false);

    await service.trainFile('/b.md', text, { mtime: 1, size: text.length });
    expect(predictorPrivate(predictor).notebookLong.get('甲乙丙丁')?.get('戊')).toBe(2);
    expect(predictorPrivate(predictor).notebookLongSupport.get('甲乙丙丁')?.get('戊')).toBe(2);
    expect(predictorPrivate(predictor).getNotebookLongTable().get('甲乙丙丁')?.get('戊')).toBe(2);

    service.removePath('/b.md');
    expect(predictorPrivate(predictor).getNotebookLongTable().has('甲乙丙丁')).toBe(false);
  });

  it('removes, renames and resets in-memory notebook contributions', async () => {
    const predictor = new MarkdownPredictor();
    const service = new CompletionTrainingService(mockFs({}), predictor);
    const text = '项目计划继续项目计划继续项目计划继续';
    await service.trainFile('/a.md', text, { mtime: 1, size: text.length });

    service.renamePath('/a.md', '/renamed.md');
    expect(predictor.hasDocumentContribution('/a.md')).toBe(false);
    expect(predictor.hasDocumentContribution('/renamed.md')).toBe(true);
    expect(loadTrainingMeta().trainedPaths['/renamed.md']).toBeDefined();

    service.removePath('/renamed.md');
    expect(predictor.hasDocumentContribution('/renamed.md')).toBe(false);
    expect(predictorPrivate(predictor).notebookLong.size).toBe(0);

    await service.trainFile('/b.md', text, { mtime: 1, size: text.length });
    service.resetContributions();
    expect(predictorPrivate(predictor).documentContributions.size).toBe(0);
    expect(loadTrainingMeta().fileCount).toBe(0);
  });
});
