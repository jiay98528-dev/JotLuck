import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { IFileSystemService } from '@/types';
import {
  useImageUpload,
  type ImageUploadCleanupFailure,
  type ImageUploadOwner,
} from '../useImageUpload';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createFileSystem(overrides: Partial<IFileSystemService> = {}): IFileSystemService {
  return {
    listDirectory: vi.fn().mockResolvedValue([
      {
        name: 'assets',
        path: '/assets',
        isDirectory: true,
        isFile: false,
      },
    ]),
    createDirectory: vi.fn().mockResolvedValue(undefined),
    writeBinary: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as IFileSystemService;
}

const mountedViews: Array<{ view: EditorView; host: HTMLElement }> = [];

function createView(doc = '', cursor = doc.length): EditorView {
  const host = document.createElement('div');
  document.body.append(host);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
    }),
    parent: host,
  });
  mountedViews.push({ view, host });
  return view;
}

function imageFile(name: string, byte = 1): File {
  return new File([new Uint8Array([byte])], name, { type: 'image/png' });
}

function pasteEvent(file: File): ClipboardEvent {
  return {
    clipboardData: {
      items: [
        {
          kind: 'file',
          getAsFile: () => file,
        },
      ],
    },
  } as unknown as ClipboardEvent;
}

afterEach(() => {
  for (const { view, host } of mountedViews.splice(0)) {
    view.destroy();
    host.remove();
  }
  vi.restoreAllMocks();
});

describe('useImageUpload', () => {
  it('同步接管图片粘贴，并按入队时的笔记路径插入相对链接', async () => {
    const fs = createFileSystem();
    const view = createView('start', 5);
    const owner: ImageUploadOwner = {
      workspaceEpoch: 7,
      notePath: '/folder/note.md',
      view,
    };
    const upload = useImageUpload(fs, () => owner);

    const handled = upload.handlePaste(pasteEvent(imageFile('pixel.png')));

    expect(handled).toBe(true);
    expect(upload.pendingCount.value).toBe(1);
    expect(upload.isUploading.value).toBe(true);
    await upload.waitForIdle();

    expect(view.state.doc.toString()).toMatch(
      /^start!\[pixel\]\(\.\.\/assets\/img_\d+_[a-z0-9]+\.png\)$/,
    );
    expect(fs.writeBinary).toHaveBeenCalledWith(
      expect.stringMatching(/^\/assets\/img_\d+_[a-z0-9]+\.png$/),
      'AQ==',
    );
    expect(upload.pendingCount.value).toBe(0);
    expect(upload.isUploading.value).toBe(false);
  });

  it('严格串行两个上传，第一个完成后第二个仍令 busy 保持为真', async () => {
    const gates: Array<ReturnType<typeof deferred<void>>> = [];
    const writeBinary = vi.fn().mockImplementation(() => {
      const gate = deferred<void>();
      gates.push(gate);
      return gate.promise;
    });
    const fs = createFileSystem({ writeBinary });
    const view = createView('note');
    const owner: ImageUploadOwner = {
      workspaceEpoch: 1,
      notePath: '/note.md',
      view,
    };
    const upload = useImageUpload(fs, () => owner);

    expect(upload.queueImageFile(imageFile('first.png', 1))).toBe(true);
    expect(upload.queueImageFile(imageFile('second.png', 2))).toBe(true);
    expect(upload.pendingCount.value).toBe(2);
    await vi.waitFor(() => expect(writeBinary).toHaveBeenCalledTimes(1));

    gates[0]?.resolve();
    await vi.waitFor(() => expect(writeBinary).toHaveBeenCalledTimes(2));

    expect(upload.pendingCount.value).toBe(1);
    expect(upload.isUploading.value).toBe(true);
    gates[1]?.resolve();
    await upload.waitForIdle();

    expect(upload.pendingCount.value).toBe(0);
    expect(upload.isUploading.value).toBe(false);
    const document = view.state.doc.toString();
    expect(document).toContain('![first](');
    expect(document).toContain('![second](');
    expect(document.indexOf('![first](')).toBeLessThan(document.indexOf('![second]('));

    view.dispatch({ selection: EditorSelection.cursor(0) });
    expect(upload.queueImageFile(imageFile('later.png', 3))).toBe(true);
    await vi.waitFor(() => expect(writeBinary).toHaveBeenCalledTimes(3));
    gates[2]?.resolve();
    await upload.waitForIdle();
    expect(view.state.doc.toString().indexOf('![later](')).toBe(0);
  });

  it('所有权切换并销毁旧编辑器后不串写，且删除已落盘的孤儿图片', async () => {
    const writeGate = deferred<void>();
    const writeBinary = vi.fn().mockReturnValue(writeGate.promise);
    const deleteFile = vi.fn().mockResolvedValue(undefined);
    const onImageUploaded = vi.fn();
    const fs = createFileSystem({ writeBinary, deleteFile });
    const oldView = createView('old note');
    const newView = createView('new note');
    let owner: ImageUploadOwner = {
      workspaceEpoch: 10,
      notePath: '/old.md',
      view: oldView,
    };
    const upload = useImageUpload(fs, () => owner, onImageUploaded);

    upload.queueImageFile(imageFile('late.png'));
    await vi.waitFor(() => expect(writeBinary).toHaveBeenCalledTimes(1));
    owner = {
      workspaceEpoch: 11,
      notePath: '/new.md',
      view: newView,
    };
    oldView.destroy();
    writeGate.resolve();
    await upload.waitForIdle();

    const writtenPath = writeBinary.mock.calls[0]?.[0] as string;
    expect(deleteFile).toHaveBeenCalledWith(writtenPath);
    expect(oldView.state.doc.toString()).toBe('old note');
    expect(newView.state.doc.toString()).toBe('new note');
    expect(onImageUploaded).not.toHaveBeenCalled();
    expect(upload.uploadError.value).toContain('已清理');
  });

  it('孤儿图片清理失败时保留资源路径并显式通知宿主', async () => {
    const writeGate = deferred<void>();
    const writeBinary = vi.fn().mockReturnValue(writeGate.promise);
    const deleteFile = vi.fn().mockRejectedValue(new Error('文件被占用'));
    const cleanupFailures: ImageUploadCleanupFailure[] = [];
    const fs = createFileSystem({ writeBinary, deleteFile });
    const oldView = createView('old');
    const newView = createView('new');
    let owner: ImageUploadOwner = {
      workspaceEpoch: 20,
      notePath: '/old.md',
      view: oldView,
    };
    const upload = useImageUpload(
      fs,
      () => owner,
      undefined,
      (failure) => {
        cleanupFailures.push(failure);
      },
    );

    upload.queueImageFile(imageFile('orphan.png'));
    await vi.waitFor(() => expect(writeBinary).toHaveBeenCalledTimes(1));
    owner = {
      workspaceEpoch: 21,
      notePath: '/new.md',
      view: newView,
    };
    writeGate.resolve();
    await upload.waitForIdle();

    const writtenPath = writeBinary.mock.calls[0]?.[0] as string;
    expect(cleanupFailures).toHaveLength(1);
    expect(cleanupFailures[0]).toMatchObject({ path: writtenPath });
    expect(cleanupFailures[0]?.message).toContain('文件被占用');
    expect(upload.uploadError.value).toContain(writtenPath);
    expect(upload.uploadError.value).toContain('无法清理');
  });
});
