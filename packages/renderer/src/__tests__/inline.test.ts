/**
 * WO-B1 行内提取测试 — wiki-link / #tag 索引事实与 stripToPlainText
 */
import { describe, expect, it } from 'vitest';
import { parseDocument } from '../ast';
import { findTagStart, parseWikiLinkTarget } from '../syntax';
import { extractIndexFacts, extractTags, stripToPlainText } from '../inline';

describe('parseWikiLinkTarget', () => {
  it('按第一个 | 切 alias、第一个 # 切 anchor', () => {
    expect(parseWikiLinkTarget('a#b|c')).toEqual({ note: 'a', anchor: 'b', alias: 'c' });
  });

  it('note trim；空 anchor 归 null；alias 原样', () => {
    expect(parseWikiLinkTarget(' note ')).toEqual({ note: 'note', anchor: null, alias: null });
    expect(parseWikiLinkTarget('a#')).toEqual({ note: 'a', anchor: null, alias: null });
    expect(parseWikiLinkTarget('a|x|y')).toEqual({ note: 'a', anchor: null, alias: 'x|y' });
  });
});

describe('findTagStart / extractTags 边界', () => {
  it('findTagStart 返回首个候选下标（i=0 放行，边界由 tokenizer 层终裁）', () => {
    // 两层分工：本函数只过滤「i>0 且前字符为 \w」；i=0 候选放行，
    // 真实前字符由 tag tokenizer 从已产出 token 尾字符还原校验（R1-C2 复审定论）
    expect(findTagStart('#lead')).toBe(0);
    expect(findTagStart('a#b')).toBeUndefined(); // '#' 在 i=1 且前字符为 \w，被过滤
    expect(findTagStart('ab #x')).toBe(3);
    expect(findTagStart('abc#def')).toBeUndefined();
    expect(findTagStart(' #x')).toBe(1);
  });

  it('tag 边界：abc#def 不中、中文#标签 中、行首中', () => {
    expect(extractTags('abc#def')).toEqual([]);
    expect(extractTags('中文#标签')).toEqual(['标签']);
    expect(extractTags('#lead')).toEqual(['lead']);
  });
});

describe('extractIndexFacts', () => {
  it('跳过 frontmatter / codeFence / jsonBlock / 行内 code', () => {
    const source = [
      '---',
      "tags: '#fm'",
      '---',
      '# H #tag1',
      '`#code`',
      '[[Note A]] and [[b#c|d]] #tag2',
      '```',
      '#fencetag',
      '```',
      '{"x": 1}',
    ].join('\n');
    const facts = extractIndexFacts(parseDocument(source));
    expect(facts.wikiLinkTargets).toEqual(['Note A', 'b']);
    expect(facts.tags).toEqual(['tag1', 'tag2']);
  });

  it('跳过 refDefinition：URL 中的 #frag 不再当标签，正文 #标签 仍产出（WO-D2）', () => {
    const source = '[a]: http://x#y\n\n正文 #ok';
    const facts = extractIndexFacts(parseDocument(source));
    expect(facts.tags).toEqual(['ok']);
  });

  it('跳过 refDefinition：引用定义块不参与 wiki 索引', () => {
    const source = '[a]: /url\n\n[[Note]]';
    const facts = extractIndexFacts(parseDocument(source));
    expect(facts.wikiLinkTargets).toEqual(['Note']);
  });
});

describe('stripToPlainText', () => {
  it('嵌套强调剥净', () => {
    expect(stripToPlainText('**粗 *斜* 粗**')).toBe('粗 斜 粗');
    expect(stripToPlainText('~~删~~')).toBe('删');
    expect(stripToPlainText('`码`')).toBe('码');
  });

  it('图片占位回调与默认 alt', () => {
    expect(stripToPlainText('![图](url)')).toBe('图');
    expect(stripToPlainText('![图](url)', { imagePlaceholder: () => '[图片]' })).toBe('[图片]');
  });

  it('链接保留文本', () => {
    expect(stripToPlainText('[文字](http://x)')).toBe('文字');
  });

  it('行首 heading / blockquote 前缀剥除（含全角与多级）', () => {
    expect(stripToPlainText('# 标题')).toBe('标题');
    expect(stripToPlainText('＃＃　标题')).toBe('标题');
    expect(stripToPlainText('> 引用')).toBe('引用');
    expect(stripToPlainText('>> a')).toBe('a');
  });

  it('stripListMarkers 开关', () => {
    expect(stripToPlainText('- item')).toBe('- item');
    expect(stripToPlainText('- item', { stripListMarkers: true })).toBe('item');
    expect(stripToPlainText('1) x', { stripListMarkers: true })).toBe('x');
    expect(stripToPlainText('- [ ] task', { stripListMarkers: true })).toBe('task');
    expect(stripToPlainText('a\n- b', { stripListMarkers: true })).toBe('a\nb');
  });
});
