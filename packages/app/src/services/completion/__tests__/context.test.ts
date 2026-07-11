import { describe, expect, it } from 'vitest';
import {
  buildCompletionContext,
  detectOpenFormat,
  detectSyntaxContext,
  extractContext,
  getLineAt,
  getLocalLanguageHint,
  isInFencedCode,
  isInFrontmatter,
} from '../context';
import { DEFAULT_COMPLETION_SETTINGS } from '../../CompletionSettings';

function context(doc: string, cursorPos = doc.length) {
  return buildCompletionContext({
    doc,
    cursorPos,
    settings: DEFAULT_COMPLETION_SETTINGS,
    indexData: null,
    n: 4,
  });
}

describe('completion markdown context', () => {
  it('normalizes CRLF line content without changing document offsets', () => {
    const doc = 'first\r\nsecond\r\nthird';
    const line = getLineAt(doc.indexOf('second') + 3, doc);

    expect(line).toMatchObject({
      text: 'second',
      from: 7,
      to: 13,
      cursorColumn: 3,
      beforeCursor: 'sec',
    });
    expect(context('first\r\n\r\nsecond').paragraphBeforeCursor).toBe('second');
  });

  it('extracts N-gram context by Unicode code point', () => {
    expect(extractContext('ab😀cd'.length, 'ab😀cd', 3)).toBe('😀cd');
  });

  it('requires a meaningful local English anchor inside mixed writing', () => {
    const technical = context('项目 update');
    const proseGlue = context('他笑着说 the');

    expect(technical.languageHint).toBe('mixed');
    expect(getLocalLanguageHint(technical)).toBe('en');
    expect(proseGlue.languageHint).toBe('mixed');
    expect(getLocalLanguageHint(proseGlue)).toBe('unknown');
  });

  it('supports CommonMark backtick and tilde fences with matching close length', () => {
    const tilde = ['before', '   ~~~~ts', 'inside', '   ~~~~~', 'after'].join('\r\n');
    expect(isInFencedCode(tilde.indexOf('inside') + 2, tilde)).toBe(true);
    expect(isInFencedCode(tilde.indexOf('after') + 2, tilde)).toBe(false);

    const shortClose = ['````', 'inside', '```', 'still fenced'].join('\n');
    expect(isInFencedCode(shortClose.indexOf('still fenced') + 2, shortClose)).toBe(true);
    expect(isInFencedCode(2, '    ```\nnot a fence')).toBe(false);
  });

  it('treats unclosed frontmatter as disabled through end of file', () => {
    const unclosed = '---\r\ntitle: Draft\r\nbody';
    expect(isInFrontmatter(unclosed.indexOf('body'), unclosed)).toBe(true);
    expect(context(unclosed).blockType).toBe('frontmatter');

    const closed = '---\r\ntitle: Draft\r\n---\r\nbody';
    expect(isInFrontmatter(closed.indexOf('body'), closed)).toBe(false);
    expect(context(closed).blockType).toBe('paragraph');
  });

  it('ignores escaped wiki, tag, path and format markers', () => {
    expect(detectSyntaxContext(8, String.raw`\[[note`)).toEqual({ type: 'general', prefix: '' });
    expect(detectSyntaxContext(10, String.raw`text \#tag`)).toEqual({
      type: 'general',
      prefix: '',
    });
    expect(detectSyntaxContext(12, String.raw`\[label](./x`)).toEqual({
      type: 'general',
      prefix: '',
    });
    expect(detectOpenFormat(String.raw`\**bold`, 7)).toBeNull();
  });

  it('recognizes ordered list structure with at most three leading spaces', () => {
    expect(detectSyntaxContext(5, '   1.')).toEqual({
      type: 'markdown-structure',
      prefix: '1.',
    });
    expect(detectSyntaxContext(6, '    1.')).toEqual({ type: 'general', prefix: '' });
    expect(context('12. item').blockType).toBe('list');
    expect(context('# heading').blockType).toBe('heading');
    expect(context('| a | b |').blockType).toBe('table');
  });
});
