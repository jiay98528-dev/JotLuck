import { describe, expect, it, vi } from 'vitest';
import type { IFileSystemService } from '@/types';
import { resolvePreviewImagePath, usePreviewImageResolver } from '../usePreviewImageResolver';

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

  it('routes external session images through the authorized asset command', async () => {
    const readBinary = vi.fn();
    const readExternalAsset = vi.fn().mockResolvedValue('aGVsbG8=');
    const resolver = usePreviewImageResolver(mockFileSystem(readBinary, readExternalAsset));
    resolver.setNotePath('/note.md', 'D:/docs', { accessToken: 'token-a' });

    expect(resolver.resolveImageSrc('./assets/pixel.png')).toBeNull();
    expect(readExternalAsset).toHaveBeenCalledWith('token-a', '/assets/pixel.png');
    expect(readBinary).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(resolver.resolveImageSrc('./assets/pixel.png')).toBe('data:image/png;base64,aGVsbG8='),
    );
    expect(readExternalAsset).toHaveBeenCalledTimes(1);
  });

  it('invalidates the external image cache when the session token changes', async () => {
    const readExternalAsset = vi
      .fn()
      .mockResolvedValueOnce('Zmlyc3Q=')
      .mockResolvedValueOnce('c2Vjb25k');
    const resolver = usePreviewImageResolver(mockFileSystem(vi.fn(), readExternalAsset));
    resolver.setNotePath('/note.md', 'scope-a', { accessToken: 'token-a' });

    resolver.resolveImageSrc('./pixel.png');
    await vi.waitFor(() =>
      expect(resolver.resolveImageSrc('./pixel.png')).toBe('data:image/png;base64,Zmlyc3Q='),
    );

    resolver.setNotePath('/note.md', 'scope-b', { accessToken: 'token-b' });
    expect(resolver.resolveImageSrc('./pixel.png')).toBeNull();
    await vi.waitFor(() => expect(readExternalAsset).toHaveBeenCalledTimes(2));
    expect(readExternalAsset).toHaveBeenLastCalledWith('token-b', '/pixel.png');
    expect(resolver.resolveImageSrc('./pixel.png')).toBe('data:image/png;base64,c2Vjb25k');
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
});
