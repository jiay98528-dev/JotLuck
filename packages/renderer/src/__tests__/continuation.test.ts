import { describe, expect, it } from 'vitest';
import { parseDocument, parseDocumentAsync, updateDocumentAsync } from '../ast';

function hint(source: string, line = source.split('\n').length - 1) {
  return parseDocument(source).lineMap[line]?.continuation;
}

describe('source-positioned continuation hints', () => {
  it.each([
    ['009、内容', '010、'],
    ['（００９）内容', '（０１０）'],
    ['(1) 内容', '(2) '],
    ['（1）内容', '（2）'],
    ['９． 内容', '１０． '],
    ['１）内容', null],
    ['九、内容', '十、'],
    ['（十九）内容', '（二十）'],
    ['(九十九) 内容', '(一百) '],
    ['一百零九、内容', '一百一十、'],
    ['九百九十九、内容', '一千、'],
    ['一千零九、内容', '一千零一十、'],
    ['九千九百九十九、内容', null],
    ['①内容', '②'],
    ['⑲ 内容', '⑳ '],
    ['⑳内容', null],
    ...['•', '·', '●', '○', '▪', '■'].map((bullet): [string, string] => [
      `${bullet}  内容`,
      `${bullet}  `,
    ]),
    ['a. 甲\nb. 乙', 'c. '],
    ['A) 甲\nB) 乙', 'C) '],
    ['y. 甲\nz. 乙', null],
    ['i. 甲\nii. 乙', 'iii. '],
    ['I) 甲\nII) 乙', 'III) '],
    ['iii. 甲\niv. 乙', 'v. '],
    ['H. 甲\nI. 乙', 'J. '],
    ['MMMCMXCVIII. 甲\nMMMCMXCIX. 乙', null],
    ['> > 一、内容', '二、'],
    ['> - 内容', '- '],
    ['> 2. 内容', '3. '],
    ['> - [x] 内容', '- [ ] '],
    ['2. [x] 内容', '3. [ ] '],
    ['> 2. [x] 内容', '3. [ ] '],
    ['> ＞ －　内容', '- '],
    // R1-C7 有序任务（GFM `1. [x] foo`）补：起手 1 也算有序任务
    ['1. [x] 甲', '2. [ ] '],
    ['1. [ ] 甲', '2. [ ] '],
    ['> 1. [x] 甲', '2. [ ] '],
    ['9) [x] 甲', '10) [ ] '],
  ])('%s produces %s', (source, next) => {
    if (source === '１）内容') expect(hint(source!)).toBeUndefined();
    else expect(hint(source!)?.nextMarker).toBe(next);
  });

  it.each([
    'a. 正文',
    'a. 甲\nc. 乙',
    'a. 甲\n\nb. 乙',
    'a. 甲\n  b. 乙',
    'a. 甲\nB. 乙',
    'a. 甲\n# 标题\nb. 乙',
    'a. 甲\n普通文字\nb. 乙',
    '2026-09-22',
    'v1.2.3',
    '1.23',
    'https://example.com',
    '\\①文字',
    '\\- 内容',
    '零、文字',
    '二三、文字',
    '一万、文字',
    '＃ 标题',
    '---\n一、元数据\n---',
    '```\n一、代码',
    '    一、缩进代码',
    '> ```text\n> - code',
    '> ```\n> > - still code',
    '>     - indented code',
    '- ```text\n  - code',
    '- ```text\n  > - code',
    '- ```text\n  一、代码',
    '- 父项\n\n      - 缩进代码',
    '> - 父项\n>\n>       一、代码',
  ])('does not infer a list from %s', (source) => expect(hint(source)).toBeUndefined());

  it('preserves literal prefix ranges and nested indentation', () => {
    const source = '> - 父项\n>   - 子项';
    const value = hint(source)!;
    expect(value.prefix).toBe('>   ');
    expect(source.slice(value.markerRange.from, value.markerRange.to)).toBe('- ');
    expect(hint('> - 父项\n>   - [ ] ')?.isEmpty).toBe(true);
    expect(hint('＞－　内容')?.prefix).toBe('> ');
    expect(hint('> - 父项\n>\n>     - 子项')?.prefix).toBe('>     ');
  });

  it('stops excluding code after a valid close or after leaving the container', () => {
    expect(hint('> ```\n> - code\n> ```\n> - text')?.nextMarker).toBe('- ');
    expect(hint('> ```\n> - code\n1、text')?.nextMarker).toBe('2、');
    expect(hint('- ```\n  - code\n1、text')?.nextMarker).toBe('2、');
    expect(hint('- ```\n  - code\n> - text')?.nextMarker).toBe('- ');
    expect(hint('> 2. [x] ```\n>    - code')).toBeUndefined();
  });

  it('keeps text numbering as paragraphs and uses the same async scanner', async () => {
    const source = '一、内容\n二、内容\n\n> - [x] 中文';
    const ast = parseDocument(source);
    expect(ast.blocks[0]?.type).toBe('paragraph');
    expect(await parseDocumentAsync(source, () => false)).toEqual(ast);
  });

  it('maps hints through earlier edits without changing the previous version', async () => {
    const source = '普通正文\n\n> - 内容\n\na. 甲\nb. 乙';
    const before = parseDocument(source);
    const position = before.lineMap[2]!.continuation!.markerRange.from;
    const after = await updateDocumentAsync(
      before,
      source.replace('普通', '更多普通'),
      () => false,
    );
    expect(after).toEqual(parseDocument(after.source));
    expect(before.lineMap[2]!.continuation!.markerRange.from).toBe(position);
    expect(after.lineMap[2]!.continuation!.markerRange.from).toBe(position + 2);
  });
});
