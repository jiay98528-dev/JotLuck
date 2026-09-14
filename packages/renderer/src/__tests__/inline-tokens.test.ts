/**
 * WO-D2 行内 token 导出测试 — lexInlineTokens 分段法词法
 *
 * 覆盖：marked 段（强调/嵌套/代码/链接/图片/转义）、wiki/tag 合成 token、
 * 行内代码优先、wiki 锚点单列、混合嵌套位置。
 */
import { describe, expect, it } from 'vitest';
import { lexInlineTokens } from '../inline-tokens';
import type { InlineToken } from '../inline-tokens';

describe('lexInlineTokens：marked 段（无 wiki/tag）', () => {
  it('纯文本', () => {
    expect(lexInlineTokens('hello')).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('粗体与斜体', () => {
    expect(lexInlineTokens('**粗**')).toEqual([
      { type: 'strong', children: [{ type: 'text', text: '粗' }] },
    ]);
    expect(lexInlineTokens('*斜*')).toEqual([
      { type: 'em', children: [{ type: 'text', text: '斜' }] },
    ]);
  });

  it('***粗斜*** 为强/斜两层嵌套（先后层次不指定）', () => {
    const tokens = lexInlineTokens('***粗斜***');
    expect(tokens).toHaveLength(1);
    const root = tokens[0]!;
    expect(root.type === 'strong' || root.type === 'em').toBe(true);
    if (root.type === 'strong' || root.type === 'em') {
      expect(root.children).toHaveLength(1);
      const inner = root.children[0]!;
      expect(inner.type === 'strong' || inner.type === 'em').toBe(true);
      if (inner.type === 'strong' || inner.type === 'em') {
        expect(inner.children).toEqual([{ type: 'text', text: '粗斜' }]);
      }
    }
  });

  it('嵌套 **a *b* c**', () => {
    expect(lexInlineTokens('**a *b* c**')).toEqual([
      {
        type: 'strong',
        children: [
          { type: 'text', text: 'a ' },
          { type: 'em', children: [{ type: 'text', text: 'b' }] },
          { type: 'text', text: ' c' },
        ],
      },
    ]);
  });

  it('行内代码：单反引号与双反引号包裹单反引号', () => {
    expect(lexInlineTokens('`code`')).toEqual([{ type: 'codespan', text: 'code' }]);
    // `` `x` ``：等长 run 配对，内容去掉首尾各一个空格
    expect(lexInlineTokens('`` `x` ``')).toEqual([{ type: 'codespan', text: '`x`' }]);
  });

  it('链接与图片', () => {
    expect(lexInlineTokens('[文字](https://u)')).toEqual([
      {
        type: 'link',
        text: '文字',
        href: 'https://u',
        children: [{ type: 'text', text: '文字' }],
      },
    ]);
    expect(lexInlineTokens('![alt](u)')).toEqual([{ type: 'image', alt: 'alt', href: 'u' }]);
    // title 属性（`![alt](u "悬停标题")` 的悬停文本）透传——DOCX 导出 `[Image: title]` 依赖它
    expect(lexInlineTokens('![alt](u "悬停标题")')).toEqual([
      { type: 'image', alt: 'alt', href: 'u', title: '悬停标题' },
    ]);
    // 行内 HTML 剥标签只留文字（旧导出链 html case 同口径，R1 m-D1）
    expect(lexInlineTokens('前<b>粗</b>后')).toEqual([
      { type: 'text', text: '前' },
      { type: 'text', text: '粗' },
      { type: 'text', text: '后' },
    ]);
  });

  it('转义 a\\*b 产 escape token', () => {
    expect(lexInlineTokens('a\\*b')).toEqual([
      { type: 'text', text: 'a' },
      { type: 'escape', text: '*' },
      { type: 'text', text: 'b' },
    ]);
  });
});

describe('lexInlineTokens：wiki/tag 合成 token', () => {
  it('[[目标|别名]] / [[目标]] / [[目标#锚点]]（锚点单列）', () => {
    expect(lexInlineTokens('[[目标|别名]]')).toEqual([
      { type: 'wikiLink', target: '目标', alias: '别名', raw: '[[目标|别名]]' },
    ]);
    expect(lexInlineTokens('[[目标]]')).toEqual([
      { type: 'wikiLink', target: '目标', raw: '[[目标]]' },
    ]);
    expect(lexInlineTokens('[[目标#锚点]]')).toEqual([
      { type: 'wikiLink', target: '目标', anchor: '锚点', raw: '[[目标#锚点]]' },
    ]);
  });

  it('#标签 合成 tag token，周围文本保留', () => {
    expect(lexInlineTokens('#标签')).toEqual([{ type: 'tag', tag: '标签', raw: '#标签' }]);
    expect(lexInlineTokens('a #t b')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'tag', tag: 't', raw: '#t' },
      { type: 'text', text: ' b' },
    ]);
  });

  it('wiki 优先于内部 #：[[a#b]] 不产出 tag', () => {
    expect(lexInlineTokens('[[a#b]]')).toEqual([
      { type: 'wikiLink', target: 'a', anchor: 'b', raw: '[[a#b]]' },
    ]);
  });

  it('wiki/tag 在行内代码内不生效', () => {
    expect(lexInlineTokens('`[[x]] #t`')).toEqual([{ type: 'codespan', text: '[[x]] #t' }]);
  });

  it('混合段落 **粗 [[链接|别名]] #标签**：与 renderMarkdown 渲染口径一致', () => {
    // 既有词法（TAG_TOKEN_RE/TAG_GLOBAL_RE 同源 `^#([^\\s#]+)`）贪婪吞尾随标点：
    // `#标签**` 的标签匹配含结尾 `**`，strong 因此不闭合——HTML 渲染（marked
    // tag 扩展）同样不粗体。lexInlineTokens 与渲染同口径，此处固化 parity。
    expect(lexInlineTokens('**粗 [[链接|别名]] #标签**')).toEqual([
      { type: 'text', text: '**粗 ' },
      { type: 'wikiLink', target: '链接', alias: '别名', raw: '[[链接|别名]]' },
      { type: 'text', text: ' ' },
      { type: 'tag', tag: '标签**', raw: '#标签**' },
    ]);
  });

  it('strong 内 wiki 嵌套正常（无尾随标点干扰时）', () => {
    expect(lexInlineTokens('**粗 [[链接|别名]] 结尾**')).toEqual([
      {
        type: 'strong',
        children: [
          { type: 'text', text: '粗 ' },
          { type: 'wikiLink', target: '链接', alias: '别名', raw: '[[链接|别名]]' },
          { type: 'text', text: ' 结尾' },
        ],
      },
    ]);
  });

  it('空切片返回空数组', () => {
    expect(lexInlineTokens('')).toEqual([]);
  });
});

describe('lexInlineTokens：token 形状', () => {
  it('联合类型字段完备（TS 编译期保证，此处 smoke 消费面）', () => {
    const tokens: InlineToken[] = lexInlineTokens('**x** [[y]] #z `c`');
    expect(tokens.map((t) => t.type)).toEqual([
      'strong',
      'text',
      'wikiLink',
      'text',
      'tag',
      'text',
      'codespan',
    ]);
  });
});
