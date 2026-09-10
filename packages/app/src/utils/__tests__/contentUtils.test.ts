import { describe, expect, it } from 'vitest';
import { normalizeNoteTitle } from '../contentUtils';

describe('normalizeNoteTitle (NFC normalization for macOS NFD filenames)', () => {
  it('matches an NFC wiki link target against an NFD-stored filename', () => {
    // '프로젝트' (Hangul, canonical decomposition applies on APFS names)
    const nfdName = '프로젝트'.normalize('NFD');
    expect(nfdName).not.toBe('프로젝트'); // sanity: the fixture truly differs byte-wise
    expect(normalizeNoteTitle(nfdName)).toBe(normalizeNoteTitle('프로젝트'));

    const nfdAccented = 'café'.normalize('NFD');
    expect(nfdAccented).not.toBe('café');
    expect(normalizeNoteTitle(nfdAccented)).toBe(normalizeNoteTitle('café'));
  });

  it('keeps CJK ideographs and plain ASCII untouched', () => {
    expect(normalizeNoteTitle('项目笔记')).toBe('项目笔记');
    expect(normalizeNoteTitle('hello.md')).toBe('hello.md');
  });
});
