import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IFileSystemService } from '@/types';
import { resolvePreviewImagePath, usePreviewImageResolver } from '../usePreviewImageResolver';
import { installObjectUrlStub, type ObjectUrlStub } from '../../test/object-url-stub';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function mockFileSystem(
  readBinary: IFileSystemService['readBinary'],
  readExternalAsset?: IFileSystemService['readExternalAsset'],
): IFileSystemService {
  return { readBinary, readExternalAsset } as IFileSystemService;
}

/** 'pix' 的 UTF-8 字节：外部会话二进制回流的典型小载荷。 */
const PIX_BYTES = new Uint8Array([0x70, 0x69, 0x78]);

describe('resolvePreviewImagePath', () => {
  it('normalizes note-relative, parent-relative and notebook-root image paths', () => {
    expect(resolvePreviewImagePath('/notes/day/note.md', './assets/pixel.png')).toEqual({
      path: '/notes/day/assets/pixel.png',
      mime: 'image/png',
    });
    expect(resolvePreviewImagePath('/notes/day/note.md', '../assets/photo.JPG')).toEqual({
      path: '/notes/assets/photo.JPG',
      mime: 'image/jpeg',
    });
    expect(resolvePreviewImagePath('/notes/day/note.md', '/assets/pixel.webp')).toEqual({
      path: '/assets/pixel.webp',
      mime: 'image/webp',
    });
  });

  it('rejects notebook traversal, malformed encoding and non-local sources', () => {
    for (const source of [
      '../../../escape.png',
      '%2e%2e/%2e%2e/%2e%2e/escape.png',
      'https://example.com/image.png',
      'data:image/png;base64,abc',
      'blob:https://example.com/id',
      '#preview',
      '//cdn.example.com/image.png',
      '%E0%A4%A.png',
    ]) {
      expect(resolvePreviewImagePath('/notes/day/note.md', source)).toBeNull();
    }
  });

  it('resolves Windows absolute note paths against the real parent directory', () => {
    // 带盘符路径取真实父目录，不得拼出 “/D:/docs/...” 畸形前缀。
    expect(resolvePreviewImagePath('D:/docs/note.md', './assets/pixel.png')).toEqual({
      path: 'D:/docs/assets/pixel.png',
      mime: 'image/png',
    });
    expect(resolvePreviewImagePath('D:\\docs\\sub\\note.md', '../photo.JPG')).toEqual({
      path: 'D:/docs/photo.JPG',
      mime: 'image/jpeg',
    });
    // 根引用落到盘根而非笔记本根标记。
    expect(resolvePreviewImagePath('D:/docs/note.md', '/root.webp')).toEqual({
      path: 'D:/root.webp',
      mime: 'image/webp',
    });
    // 越过盘根的 traversal 仍然拒绝。
    expect(resolvePreviewImagePath('D:/docs/note.md', '../../escape.png')).toBeNull();
  });
});

describe('usePreviewImageResolver', () => {
  let urlStub: ObjectUrlStub;

  beforeEach(() => {
    // jsdom 29.1.1 实证缺失 URL.createObjectURL/revokeObjectURL：必须显式注桩
    //（外部会话分支经 Blob 零拷贝 mint objectURL）。
    urlStub = installObjectUrlStub();
  });

  afterEach(() => {
    urlStub.restore();
  });

  it('loads once, caches a controlled data URL and increments the revision', async () => {
    const readBinary = vi.fn().mockResolvedValue('aGVsbG8=');
    const resolver = usePreviewImageResolver(mockFileSystem(readBinary));
    resolver.setNotePath('/notes/note.md');
    const afterScopeChange = resolver.imageRevision.value;

    expect(resolver.resolveImageSrc('./assets/pixel.png')).toBeNull();
    expect(resolver.resolveImageSrc('./assets/pixel.png')).toBeNull();
    expect(readBinary).toHaveBeenCalledTimes(1);
    expect(readBinary).toHaveBeenCalledWith('/notes/assets/pixel.png');

    await vi.waitFor(() => expect(resolver.imageRevision.value).toBe(afterScopeChange + 1));
    expect(resolver.resolveImageSrc('./assets/pixel.png')).toBe('data:image/png;base64,aGVsbG8=');
    expect(readBinary).toHaveBeenCalledTimes(1);
  });

  it('passes supported external sources through without reading the notebook', () => {
    const readBinary = vi.fn();
    const resolver = usePreviewImageResolver(mockFileSystem(readBinary));
    resolver.setNotePath('/notes/note.md');

    for (const source of [
      'https://example.com/image.png',
      'data:image/png;base64,aGVsbG8=',
      'blob:https://example.com/id',
      '#preview',
      '//cdn.example.com/image.png',
    ]) {
      expect(resolver.resolveImageSrc(source)).toBe(source);
    }
    expect(resolver.resolveImageSrc('../../../outside.png')).toBeNull();
    expect(resolver.resolveImageSrc('file:///secret.png')).toBeNull();
    expect(readBinary).not.toHaveBeenCalled();
  });

  it('keeps external sources renderable in an unbound single-file session', () => {
    const readBinary = vi.fn();
    const resolver = usePreviewImageResolver(mockFileSystem(readBinary));

    expect(resolver.resolveImageSrc('https://example.com/image.png')).toBe(
      'https://example.com/image.png',
    );
    expect(resolver.resolveImageSrc('data:image/png;base64,aGVsbG8=')).toBe(
      'data:image/png;base64,aGVsbG8=',
    );
    expect(resolver.resolveImageSrc('./assets/private.png')).toBeNull();
    expect(readBinary).not.toHaveBeenCalled();
  });

  it('does not let a late read from the previous note populate the new note cache', async () => {
    const oldRead = deferred<string>();
    const readBinary = vi.fn().mockImplementation(() => oldRead.promise);
    const resolver = usePreviewImageResolver(mockFileSystem(readBinary));
    resolver.setNotePath('/old/note.md');
    expect(resolver.resolveImageSrc('./assets/pixel.png')).toBeNull();

    resolver.setNotePath('/new/note.md');
    const revisionAfterSwitch = resolver.imageRevision.value;
    oldRead.resolve('b2xk');
    await oldRead.promise;
    await Promise.resolve();

    expect(resolver.imageRevision.value).toBe(revisionAfterSwitch);
    expect(resolver.resolveImageSrc('./assets/pixel.png')).toBeNull();
    expect(readBinary).toHaveBeenLastCalledWith('/new/assets/pixel.png');
  });

  it('invalidates a same-path image cache when the notebook workspace changes', async () => {
    const readBinary = vi.fn().mockResolvedValueOnce('b2xk').mockResolvedValueOnce('bmV3');
    const resolver = usePreviewImageResolver(mockFileSystem(readBinary));
    resolver.setNotePath('/notes/note.md', 'C:/old-notebook');
    resolver.resolveImageSrc('./assets/pixel.png');
    await vi.waitFor(() =>
      expect(resolver.resolveImageSrc('./assets/pixel.png')).toBe('data:image/png;base64,b2xk'),
    );

    resolver.setNotePath('/notes/note.md', 'C:/new-notebook');
    expect(resolver.resolveImageSrc('./assets/pixel.png')).toBeNull();
    await vi.waitFor(() =>
      expect(resolver.resolveImageSrc('./assets/pixel.png')).toBe('data:image/png;base64,bmV3'),
    );
    expect(readBinary).toHaveBeenCalledTimes(2);
  });

  it('lets an upload prime retry a path that previously failed', async () => {
    const readBinary = vi
      .fn()
      .mockRejectedValueOnce(new Error('not written yet'))
      .mockResolvedValueOnce('cGl4ZWw=');
    const resolver = usePreviewImageResolver(mockFileSystem(readBinary));
    resolver.setNotePath('/notes/note.md');

    expect(resolver.resolveImageSrc('./assets/new.png')).toBeNull();
    await vi.waitFor(() => expect(readBinary).toHaveBeenCalledTimes(1));
    await resolver.prime('./assets/new.png');

    expect(readBinary).toHaveBeenCalledTimes(2);
    expect(resolver.resolveImageSrc('./assets/new.png')).toBe('data:image/png;base64,cGl4ZWw=');
  });

  it('routes external session images through the binary asset command as blob object URLs', async () => {
    const readBinary = vi.fn();
    const readExternalAsset = vi.fn().mockResolvedValue(PIX_BYTES);
    const resolver = usePreviewImageResolver(mockFileSystem(readBinary, readExternalAsset));
    resolver.setNotePath('/note.md', 'D:/docs', { accessToken: 'token-a' });

    expect(resolver.resolveImageSrc('./assets/pixel.png')).toBeNull();
    expect(readExternalAsset).toHaveBeenCalledWith('token-a', '/assets/pixel.png');
    expect(readBinary).not.toHaveBeenCalled();
    // 二进制回流 → Blob 零拷贝 objectURL（无 base64 膨胀）。
    await vi.waitFor(() =>
      expect(resolver.resolveImageSrc('./assets/pixel.png')).toBe('blob:mock-1'),
    );
    expect(readExternalAsset).toHaveBeenCalledTimes(1);
    expect(urlStub.created).toEqual(['blob:mock-1']);
  });

  it('invalidates the external image cache when the session token changes', async () => {
    const readExternalAsset = vi
      .fn()
      .mockResolvedValueOnce(new Uint8Array([1]))
      .mockResolvedValueOnce(new Uint8Array([2]));
    const resolver = usePreviewImageResolver(mockFileSystem(vi.fn(), readExternalAsset));
    resolver.setNotePath('/note.md', 'scope-a', { accessToken: 'token-a' });

    resolver.resolveImageSrc('./pixel.png');
    await vi.waitFor(() => expect(resolver.resolveImageSrc('./pixel.png')).toBe('blob:mock-1'));

    resolver.setNotePath('/note.md', 'scope-b', { accessToken: 'token-b' });
    expect(resolver.resolveImageSrc('./pixel.png')).toBeNull();
    await vi.waitFor(() => expect(readExternalAsset).toHaveBeenCalledTimes(2));
    expect(readExternalAsset).toHaveBeenLastCalledWith('token-b', '/pixel.png');
    expect(resolver.resolveImageSrc('./pixel.png')).toBe('blob:mock-2');
  });

  it('invalidates the external image cache when only the access token changes', async () => {
    // 同 notePath + 同 scopeKey、仅 token 轮换：102-104 行的短路守卫不得吸收
    // 该变化——token 是授权身份的一部分，旧 token 的 blob: 缓存必须作废。
    const readExternalAsset = vi
      .fn()
      .mockResolvedValueOnce(new Uint8Array([1]))
      .mockResolvedValueOnce(new Uint8Array([2]));
    const resolver = usePreviewImageResolver(mockFileSystem(vi.fn(), readExternalAsset));
    resolver.setNotePath('/note.md', 'scope-a', { accessToken: 'token-a' });

    resolver.resolveImageSrc('./pixel.png');
    await vi.waitFor(() => expect(resolver.resolveImageSrc('./pixel.png')).toBe('blob:mock-1'));

    resolver.setNotePath('/note.md', 'scope-a', { accessToken: 'token-b' });
    // 缓存已清：首次 resolve 为 null，并以 token-b 重读。
    expect(resolver.resolveImageSrc('./pixel.png')).toBeNull();
    await vi.waitFor(() => expect(readExternalAsset).toHaveBeenCalledTimes(2));
    expect(readExternalAsset).toHaveBeenLastCalledWith('token-b', '/pixel.png');
    expect(resolver.resolveImageSrc('./pixel.png')).toBe('blob:mock-2');
    expect(urlStub.created).toEqual(['blob:mock-1', 'blob:mock-2']);
  });

  it('falls back to the workspace channel after the external session ends', async () => {
    const readBinary = vi.fn().mockResolvedValue('d29yaw==');
    const readExternalAsset = vi.fn();
    const resolver = usePreviewImageResolver(mockFileSystem(readBinary, readExternalAsset));
    resolver.setNotePath('/note.md', 'scope', { accessToken: 'token-a' });
    resolver.setNotePath('/note.md', 'scope');

    resolver.resolveImageSrc('./pixel.png');
    expect(readExternalAsset).not.toHaveBeenCalled();
    expect(readBinary).toHaveBeenCalledWith('/pixel.png');
    await vi.waitFor(() =>
      expect(resolver.resolveImageSrc('./pixel.png')).toBe('data:image/png;base64,d29yaw=='),
    );
  });

  it('revokes cached blob object URLs when the session scope flips', async () => {
    const readExternalAsset = vi.fn().mockResolvedValue(PIX_BYTES);
    const resolver = usePreviewImageResolver(mockFileSystem(vi.fn(), readExternalAsset));
    resolver.setNotePath('/note.md', 'scope-a', { accessToken: 'token-a' });

    resolver.resolveImageSrc('./pixel.png');
    await vi.waitFor(() => expect(urlStub.created).toEqual(['blob:mock-1']));
    expect(urlStub.live).toEqual(new Set(['blob:mock-1']));

    // 换代清缓存必须撤销已 mint 的 object URL，防 blob 泄漏。
    resolver.setNotePath('/note.md', 'scope-b', { accessToken: 'token-b' });
    expect(urlStub.revoked).toContain('blob:mock-1');
    expect(urlStub.live).toEqual(new Set());
  });

  it('rejects svg sources in an external session without issuing the doomed IPC', async () => {
    // 桌面闸门（fs_ops.rs 位图白名单）刻意排除 svg：不预拒则必发必败 IPC
    // 后静默裂图。预拒=视同 unsupported 直接登记失败，恒 null、零请求。
    const readExternalAsset = vi.fn();
    const resolver = usePreviewImageResolver(mockFileSystem(vi.fn(), readExternalAsset));
    resolver.setNotePath('/note.md', 'scope-a', { accessToken: 'token-a' });

    expect(resolver.resolveImageSrc('./vector.svg')).toBeNull();
    expect(resolver.resolveImageSrc('./vector.svg')).toBeNull();
    expect(readExternalAsset).not.toHaveBeenCalled();
    expect(urlStub.created).toEqual([]);
    // 工作区通道（readBinary 无白名单）svg 仍合法渲染，不受外部预拒影响。
    const readBinary = vi.fn().mockResolvedValue('PHN2Zy8+');
    const workspaceResolver = usePreviewImageResolver(mockFileSystem(readBinary));
    workspaceResolver.setNotePath('/note.md', 'scope-a');
    workspaceResolver.resolveImageSrc('./vector.svg');
    await vi.waitFor(() =>
      expect(workspaceResolver.resolveImageSrc('./vector.svg')).toBe(
        'data:image/svg+xml;base64,PHN2Zy8+',
      ),
    );
  });
});
