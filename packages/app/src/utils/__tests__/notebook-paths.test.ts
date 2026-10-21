import { describe, expect, it } from 'vitest';
import {
  basenameFromPath,
  displayNameFromPath,
  encodeContentSize,
  ensureMarkdownExtension,
  hashString,
  joinPath,
  normalizeDir,
  normalizeOsPath,
  normalizePath,
  notebookRootsEqual,
  parentDirFromPath,
  splitAbsoluteFilePath,
} from '../notebook-paths';

describe('normalizeOsPath', () => {
  it('keeps the drive-letter root as-is', () => {
    expect(normalizeOsPath('C:/')).toBe('C:/');
    expect(normalizeOsPath('C:\\')).toBe('C:/');
  });

  it('trims trailing slashes but preserves the posix root', () => {
    expect(normalizeOsPath('/a/b/')).toBe('/a/b');
    expect(normalizeOsPath('/a///')).toBe('/a');
    expect(normalizeOsPath('/')).toBe('/');
  });
});

describe('notebookRootsEqual', () => {
  it('is case-insensitive for Windows drive paths', () => {
    expect(notebookRootsEqual('c:/Notes', 'C:\\notes\\')).toBe(true);
  });

  it('stays case-sensitive for non-Windows roots', () => {
    expect(notebookRootsEqual('/Notes', '/notes')).toBe(false);
    expect(notebookRootsEqual('/notes/a', '/notes/b')).toBe(false);
  });
});

describe('splitAbsoluteFilePath', () => {
  it('derives the parent dir as root plus leading-slash relative path', () => {
    expect(splitAbsoluteFilePath('C:/notes/a/b.md')).toEqual({
      root: 'C:/notes/a',
      relativePath: '/b.md',
    });
  });

  it('falls back to the posix root for top-level files', () => {
    expect(splitAbsoluteFilePath('/b.md')).toEqual({ root: '/', relativePath: '/b.md' });
  });
});

describe('joinPath', () => {
  it('joins without doubling the root slash', () => {
    expect(joinPath('/', 'a.md')).toBe('/a.md');
    expect(joinPath('/a/b', 'c.md')).toBe('/a/b/c.md');
  });
});

describe('normalizeDir', () => {
  it('maps an empty dir to the root', () => {
    expect(normalizeDir('')).toBe('/');
  });

  it('trims trailing slashes', () => {
    expect(normalizeDir('/a/b/')).toBe('/a/b');
  });
});

describe('hashString', () => {
  it('returns a deterministic non-negative value', () => {
    expect(hashString('abc')).toBe(96354);
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('')).toBe(0);
  });
});

describe('ensureMarkdownExtension', () => {
  it('appends .md only when no extension exists', () => {
    expect(ensureMarkdownExtension('a.md')).toBe('a.md');
    expect(ensureMarkdownExtension('note')).toBe('note.md');
    expect(ensureMarkdownExtension('C:/notes/readme')).toBe('C:/notes/readme.md');
  });
});

describe('displayNameFromPath', () => {
  it('returns the segment after the last slash on either separator', () => {
    expect(displayNameFromPath('C:\\notes\\我的笔记.md')).toBe('我的笔记.md');
  });

  it('falls back to Notebook for a bare root', () => {
    expect(displayNameFromPath('/')).toBe('Notebook');
  });
});

describe('encodeContentSize', () => {
  it('counts UTF-8 bytes instead of code units', () => {
    expect(encodeContentSize('abc')).toBe(3);
    expect(encodeContentSize('中文')).toBe(6);
  });
});

describe('parentDirFromPath', () => {
  it('returns the directory portion and the root for top-level files', () => {
    expect(parentDirFromPath('/a/b/c.md')).toBe('/a/b');
    expect(parentDirFromPath('/a.md')).toBe('/');
  });
});

describe('basenameFromPath', () => {
  it('returns the last path segment after normalization', () => {
    expect(basenameFromPath('/a/b.md')).toBe('b.md');
    expect(basenameFromPath('a\\b.md')).toBe('b.md');
  });
});

describe('normalizePath', () => {
  it('converts backslashes and trims one trailing slash', () => {
    expect(normalizePath('C:\\a\\b\\')).toBe('C:/a/b');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('')).toBe('');
  });
});
