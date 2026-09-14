/**
 * BUG-055 渲染侧闭环：fence 感知的全角 Markdown 归一化测试。
 *
 * 覆盖契约 R2（fence 内容不归一）+ R5（典型归一用例）+ R6（原函数行为不变）。
 */
import { describe, expect, it } from 'vitest';
import {
  normalizeFullwidthMarkdownSyntax,
  normalizeFullwidthMarkdownSyntaxForRender,
  renderMarkdown,
} from '../index';

describe('normalizeFullwidthMarkdownSyntaxForRender', () => {
  it('归一化块级与行内全角定界符', () => {
    expect(
      normalizeFullwidthMarkdownSyntaxForRender(
        '＃ 标题\n\n＞ 引用\n\n－ 项目\n\n｜ 列1 ｜ 列2 ｜\n｜ --- ｜ --- ｜\n｜ a ｜ b ｜',
      ),
    ).toBe('# 标题\n\n> 引用\n\n- 项目\n\n| 列1 | 列2 |\n| --- | --- |\n| a | b |');
  });

  it('归一行内强调与删除线', () => {
    expect(normalizeFullwidthMarkdownSyntaxForRender('＊＊粗体＊＊')).toBe('**粗体**');
    expect(normalizeFullwidthMarkdownSyntaxForRender('＊斜体＊')).toBe('*斜体*');
    expect(normalizeFullwidthMarkdownSyntaxForRender('～～删除～～')).toBe('~~删除~~');
  });

  it('fence 内容行不做全角替换', () => {
    const source = ['```js', '＃ 不是标题', '＞ 不是引用', '＊ 不是强调 ＊', '```'].join('\n');
    expect(normalizeFullwidthMarkdownSyntaxForRender(source)).toBe(source);
  });

  it('全角 ｀｀｀ fence 能被归一为半角并正常开闭', () => {
    const source = ['｀｀｀js', '＃ not a heading', '```'].join('\n');
    const normalized = normalizeFullwidthMarkdownSyntaxForRender(source);
    expect(normalized).toBe(['```js', '＃ not a heading', '```'].join('\n'));
  });

  it('全角 ～～～ fence 同样能开闭', () => {
    const source = ['～～～rust', 'let ＃ = 1;', '～～～'].join('\n');
    const normalized = normalizeFullwidthMarkdownSyntaxForRender(source);
    expect(normalized).toBe(['~~~rust', 'let ＃ = 1;', '~~~'].join('\n'));
  });

  it('fence 起始行保留 info string 原样', () => {
    expect(normalizeFullwidthMarkdownSyntaxForRender('｀｀｀c＃ info\n内容\n｀｀｀')).toBe(
      '```c＃ info\n内容\n```',
    );
  });

  it('闭合围栏使用更长同型字符仍能闭合', () => {
    const source = ['```', 'x', '````'].join('\n');
    expect(normalizeFullwidthMarkdownSyntaxForRender(source)).toBe(source);
  });

  it('不同字符的围栏不会互相闭合（``` 不被 ~~~ 关闭）', () => {
    const source = ['```', '~~~ not close ~~~', '```'].join('\n');
    expect(normalizeFullwidthMarkdownSyntaxForRender(source)).toBe(source);
  });

  it('围栏未闭合时其后所有内容视为围栏内容', () => {
    const source = ['```', '＃ 标题', '－ 列表', '＞ 引用'].join('\n');
    expect(normalizeFullwidthMarkdownSyntaxForRender(source)).toBe(source);
  });

  it('多个围栏段各自独立', () => {
    const source = [
      '＃ 外部标题',
      '```',
      '＃ 内部标题',
      '```',
      '－ 外部列表',
      '~~~',
      '－ 内部列表',
      '~~~',
    ].join('\n');
    expect(normalizeFullwidthMarkdownSyntaxForRender(source)).toBe(
      ['# 外部标题', '```', '＃ 内部标题', '```', '- 外部列表', '~~~', '－ 内部列表', '~~~'].join(
        '\n',
      ),
    );
  });
});

describe('renderMarkdown 全角 Markdown 闭环', () => {
  it('全角 ＃ 标题 渲染为 <h1>', () => {
    expect(renderMarkdown('＃ 标题')).toContain('<h1 id="heading-标题">标题</h1>');
  });

  it('全角 ＞ 引用 渲染为 blockquote', () => {
    const html = renderMarkdown('＞ 引用文字');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('引用文字');
  });

  it('全角 － 项目 渲染为 ul/li', () => {
    const html = renderMarkdown('－ 第一项');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>第一项</li>');
  });

  it('全角 ｜ 表格行（配分隔行）渲染为 table', () => {
    const html = renderMarkdown(
      ['｜ 列1 ｜ 列2 ｜', '｜ --- ｜ --- ｜', '｜ A ｜ B ｜'].join('\n'),
    );
    expect(html).toContain('<table>');
    expect(html).toContain('<th>列1</th>');
    expect(html).toContain('<td>A</td>');
  });

  it('行内 ＊＊粗＊＊ 渲染为 strong', () => {
    expect(renderMarkdown('＊＊粗体＊＊')).toContain('<strong>粗体</strong>');
  });

  it('fence 内的 ＃ 保持原文出现在 <code> 中', () => {
    const html = renderMarkdown(['```', '＃ not a heading', '```'].join('\n'));
    expect(html).toContain('＃ not a heading');
    expect(html).not.toContain('<h1');
    expect(html).toMatch(/<code[^>]*>[\s\S]*?＃ not a heading[\s\S]*?<\/code>/);
  });

  it('全角 ｀｀｀ fence 能正常开闭并保留原始内容', () => {
    const html = renderMarkdown(['｀｀｀', '＃ raw ＃', '｀｀｀'].join('\n'));
    expect(html).toContain('＃ raw ＃');
    expect(html).toMatch(/<pre><code[^>]*>[\s\S]*?＃ raw ＃[\s\S]*?<\/code><\/pre>/);
    expect(html).not.toContain('<h1');
  });

  it('不改动源文件字节：归一仅作用于 renderMarkdown 的内存副本', () => {
    const source = '＃ 标题';
    renderMarkdown(source);
    expect(source).toBe('＃ 标题');
  });
});

describe('normalizeFullwidthMarkdownSyntax 行为兼容性（R6）', () => {
  it('原函数对纯围栏外内容的行为不变', () => {
    expect(normalizeFullwidthMarkdownSyntax('＃ 标题\n＊＊粗体＊＊')).toBe('# 标题\n**粗体**');
  });

  it('原函数仍会把围栏内的 ＃ 替换为 #（live preview 行内编辑保持原行为）', () => {
    expect(normalizeFullwidthMarkdownSyntax('```\n＃ raw\n```')).toBe('```\n# raw\n```');
  });

  it('全角 ｜ → | 与原函数一致', () => {
    expect(normalizeFullwidthMarkdownSyntaxForRender('｜ 列 ｜')).toBe(
      normalizeFullwidthMarkdownSyntax('｜ 列 ｜'),
    );
  });
});
