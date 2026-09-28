import { describe, expect, it } from 'vitest';
import { parseDocument } from '../ast';
import { extractWikiLinkOccurrences } from '../inline';
import { normalizeFullwidthMarkdownSyntaxForRender } from '../syntax';

describe('wiki reference source ranges', () => {
  it('keeps repeated references, aliases, anchors and original UTF-16 offsets', () => {
    const source = '＃ 标题\n\n＞ 😀 **[[笔记#章节|别名]]** 与 [[笔记]]\n- [[笔记]]';
    const refs = extractWikiLinkOccurrences(parseDocument(source));
    expect(refs.map((item) => item.target)).toEqual(['笔记', '笔记', '笔记']);
    expect(refs.map((item) => item.lineNumber)).toEqual([3, 3, 4]);
    expect(refs[0]).toMatchObject({ anchor: '章节', alias: '别名', from: source.indexOf('[[') });
    for (const ref of refs) expect(source.slice(ref.from, ref.to)).toBe(ref.raw);
  });
  it('excludes metadata, fences, reference definitions and equal-run inline code', () => {
    const source =
      '---\nx: [[metadata]]\n---\n\n[[real]] ``a ` [[hidden]] b`` [[last]]\n\n~~~\n[[fenced]]\n~~~\n\n[ref]: /[[definition]]';
    expect(extractWikiLinkOccurrences(parseDocument(source)).map((item) => item.target)).toEqual([
      'real',
      'last',
    ]);
  });
  it('leaves references inside unclosed code fences excluded', () => {
    expect(
      extractWikiLinkOccurrences(parseDocument('[[first]]\n\n```\n[[last]]')).map(
        (item) => item.target,
      ),
    ).toEqual(['first']);
  });
  it('excludes references in fullwidth inline code without shifting following offsets', () => {
    const source = '＃   标题 ｀[[隐藏]]｀ [[保留]]';
    const refs = extractWikiLinkOccurrences(parseDocument(source));
    expect(refs.map((item) => item.target)).toEqual(['保留']);
    expect(refs[0]!.from).toBe(source.indexOf('[[保留]]'));
  });
  it('normalizes a dense book without exceeding the argument stack limit', () => {
    const source = '正文\n\n'.repeat(90000);
    expect(normalizeFullwidthMarkdownSyntaxForRender(source)).toBe(source);
  });
  it('does not index escaped references or treat an escaped opening backtick as code', () => {
    const source = '\\[[hidden]] \\` [[real]] `tail';
    expect(extractWikiLinkOccurrences(parseDocument(source)).map((item) => item.target)).toEqual([
      'real',
    ]);
  });
});
