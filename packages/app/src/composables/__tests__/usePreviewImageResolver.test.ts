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

function mockFileSystem(readBinary: IFileSystemService['readBinary']): IFileSystemService {
  return { readBinary } as IFileSystemService;
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
});
