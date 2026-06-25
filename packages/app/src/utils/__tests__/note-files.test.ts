import { describe, expect, it } from 'vitest';
import {
  isMarkdownLikeFile,
  isSupportedNoteFile,
  stripSupportedNoteExtension,
  supportedNoteExtensionsLabel,
} from '../note-files';

describe('note file helpers', () => {
  it('recognizes editable note formats', () => {
    expect(isSupportedNoteFile('readme.md')).toBe(true);
    expect(isSupportedNoteFile('long-form.markdown')).toBe(true);
    expect(isSupportedNoteFile('component.mdx')).toBe(true);
    expect(isSupportedNoteFile('plain.txt')).toBe(true);

    expect(isSupportedNoteFile('image.png')).toBe(false);
    expect(isSupportedNoteFile('export.pdf')).toBe(false);
    expect(isSupportedNoteFile('readme.md.bak')).toBe(false);
  });

  it('separates markdown-like notes from plain text notes', () => {
    expect(isMarkdownLikeFile('readme.md')).toBe(true);
    expect(isMarkdownLikeFile('component.mdx')).toBe(true);
    expect(isMarkdownLikeFile('plain.txt')).toBe(false);
  });

  it('strips only supported note extensions', () => {
    expect(stripSupportedNoteExtension('readme.md')).toBe('readme');
    expect(stripSupportedNoteExtension('long-form.markdown')).toBe('long-form');
    expect(stripSupportedNoteExtension('component.mdx')).toBe('component');
    expect(stripSupportedNoteExtension('plain.txt')).toBe('plain');
    expect(stripSupportedNoteExtension('archive.md.bak')).toBe('archive.md.bak');
  });

  it('exposes a stable user-facing extension label', () => {
    expect(supportedNoteExtensionsLabel()).toBe('.md/.markdown/.mdx/.txt');
  });
});
