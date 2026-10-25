/**
 * WO-B7 渲染内部收口测试 — marked-extensions 消费 syntax.ts 单点规则 +
 * addHeadingIds 消费 parseDocument AST。
 *
 * 覆盖：
 * - tag 边界（abc#def 不渲染；中文#标签、行首 #tag 渲染）
 * - wiki-link token 形状（data-note / data-anchor / 文本）含 trim 收紧
 * - 同名 heading occurrence 递增（heading-概要 / heading-概要-2）
 * - 全角 ＃ 标题 → 带 id 的 h1（既有全角闭环不被破坏）
 */
import { describe, expect, it } from 'vitest';
import { renderMarkdown, finalizePreparedHtml } from '../index';
import { parseDocument, type HeadingNode } from '../ast';

describe('tag 边界（renderer 复用 findTagStart）', () => {
  it('abc#def 不渲染 md-tag（# 紧跟 \\w 不算边界）', () => {
    const html = renderMarkdown('abc#def');
    expect(html).not.toContain('md-tag');
    expect(html).not.toContain('<a class="md-tag"');
    // 但正文里 #def 字面量仍要原样渲染
    expect(html).toContain('abc#def');
  });

  it('abc#def 后续追加 #realTag：第一个 # 不渲染，第二个渲染', () => {
    const html = renderMarkdown('abc#def #realTag');
    expect(html).not.toContain('md-tag" data-tag="def');
    expect(html).toContain('md-tag" data-tag="realTag"');
  });

  it('中文#标签 渲染 md-tag（中文不是 \\w）', () => {
    const html = renderMarkdown('中文#标签');
    expect(html).toContain('<a class="md-tag" data-tag="标签">#标签</a>');
  });

  it('行首 #tag 渲染 md-tag', () => {
    const html = renderMarkdown('#lead');
    expect(html).toContain('<a class="md-tag" data-tag="lead">#lead</a>');
  });

  it('空白分隔的 #tag 渲染 md-tag', () => {
    const html = renderMarkdown('paragraph #tag1 and #tag2');
    expect(html).toContain('md-tag" data-tag="tag1"');
    expect(html).toContain('md-tag" data-tag="tag2"');
  });
});

describe('wiki-link token 形状（renderer 复用 parseWikiLinkTarget）', () => {
  it('[[note#sec|别名]]：data-note / data-anchor / 文本三件套', () => {
    const html = renderMarkdown('[[note#sec|别名]]');
    expect(html).toContain(
      '<a class="wikilink wikilink--dead" data-note="note" data-anchor="sec">别名</a>',
    );
  });

  it('[[ note ]]：note trim（与索引端对齐）', () => {
    const html = renderMarkdown('[[ note ]]');
    // data-note 必须是 trim 后的 "note"，不能带前后空格
    expect(html).toContain('data-note="note"');
    expect(html).not.toContain('data-note=" note "');
    // anchor 为空 → 空 data-anchor，文本 = trim 后的 note
    expect(html).toContain('data-anchor=""');
    expect(html).toContain('>note</a>');
  });

  it('[[ note#sec ]] 无 alias：text 退化到 trimmed note', () => {
    const html = renderMarkdown('[[ note#sec ]]');
    expect(html).toContain('data-note="note"');
    expect(html).toContain('data-anchor="sec"');
    expect(html).toContain('>note</a>');
  });

  it('[[a#b|c]] 语义不变（无空白场景，回归基线）', () => {
    const html = renderMarkdown('[[a#b|c]]');
    expect(html).toContain(
      '<a class="wikilink wikilink--dead" data-note="a" data-anchor="b">c</a>',
    );
  });

  it('[[#同页锚点]]：空 note 形态渲染活链（可见锚文本、data-anchor 保留）', () => {
    const html = renderMarkdown('[[#同页锚点]]');
    // 修复前：text 空 → 空 <a> 死链；修复后：活链样式 + 可见锚文本
    expect(html).toContain('<a class="wikilink" data-note="" data-anchor="同页锚点">#同页锚点</a>');
    expect(html).not.toContain('wikilink--dead');
  });

  it('[[#同页锚点|别名]]：alias 可见文本 + 活链样式', () => {
    const html = renderMarkdown('[[#同页锚点|别名]]');
    expect(html).toContain('<a class="wikilink" data-note="" data-anchor="同页锚点">别名</a>');
  });

  it('wikiLinkExists resolver 不把同页锚点判死（存在性按 note 判定）', () => {
    const html = finalizePreparedHtml('<a class="wikilink" data-note="" data-anchor="锚">x</a>', {
      wikiLinkExists: () => false,
    });
    expect(html).toContain('class="wikilink"');
    expect(html).not.toContain('wikilink--dead');
  });
});

describe('addHeadingIds 消费 AST', () => {
  it('同名 heading occurrence 递增', () => {
    const html = renderMarkdown('## 概要\n\n## 概要\n');
    expect(html).toContain('<h2 id="heading-概要">概要</h2>');
    expect(html).toContain('<h2 id="heading-概要-2">概要</h2>');
    // 恰好两次，不多不少
    expect(html.match(/id="heading-概要(?:-\d+)?"/g)).toHaveLength(2);
  });

  it('三级混合同名 + 不同级同名：occurrence 与级数解耦', () => {
    const html = renderMarkdown('## Foo\n\n### Foo\n\n## Foo');
    expect(html).toContain('<h2 id="heading-foo">Foo</h2>');
    expect(html).toContain('<h3 id="heading-foo-2">Foo</h3>');
    expect(html).toContain('<h2 id="heading-foo-3">Foo</h2>');
  });

  it('全角 ＃ 标题 渲染带 id 的 h1（既有全角闭环不被破坏）', () => {
    const html = renderMarkdown('＃ 标题');
    expect(html).toContain('<h1 id="heading-标题">标题</h1>');
  });

  it('全角 ＃ 标题 与同名半角标题连续：occurrence 跨形式累加', () => {
    const html = renderMarkdown('＃ 概要\n\n# 概要\n');
    expect(html).toContain('<h1 id="heading-概要">概要</h1>');
    expect(html).toContain('<h1 id="heading-概要-2">概要</h1>');
  });

  it('fence 内伪标题不计入 heading id（与 AST 解析对齐）', () => {
    const html = renderMarkdown(['# Real', '```', '# NotAReal', '```'].join('\n'));
    // 真正的 h1 拿到 id，fence 内的 "# NotAReal" 不会变成 h1
    expect(html).toContain('<h1 id="heading-real">Real</h1>');
    expect(html).not.toContain('id="heading-notareal"');
    // fence 内的伪标题保留字面量在 <code> 中
    expect(html).toMatch(/<code[^>]*>[\s\S]*?# NotAReal[\s\S]*?<\/code>/);
  });

  it('AST heading id 与渲染 id 严格一致（同名 occurrence 同步）', () => {
    const source = '# 基础\n\n正文\n\n# 基础\n\n## 其他';
    const html = renderMarkdown(source);
    const astIds = parseDocument(source)
      .blocks.filter((block) => block.type === 'heading')
      .map((block) => (block as HeadingNode).id);
    expect(astIds).toEqual(['heading-基础', 'heading-基础-2', 'heading-其他']);
    for (const id of astIds) expect(html).toContain(`id="${id}"`);
  });
});

describe('原生 HTML 标题不抢 markdown 标题 id（LA 回归）', () => {
  it('网页粘贴的裸 <h2> 不抢后续 markdown 标题 id，自身不注入 id', () => {
    const source = '<h2>网页粘贴标题</h2>\n\n## 真标题';
    const html = renderMarkdown(source);
    // markdown 标题拿到自己的 id（修复前被 html h2 抢走、只能拿 fallback）
    expect(html).toContain('<h2 id="heading-真标题">真标题</h2>');
    // 原生 HTML 标题保持源码原样，不注入任何 id
    expect(html).toContain('<h2>网页粘贴标题</h2>');
    expect(html).not.toContain('heading-网页粘贴标题');
  });

  it('带属性/自带 id 的原生 HTML 标题：属性保留且同样不抢配对位', () => {
    const source = '<h2 class="pasted">带属性</h2>\n\n<h3 id="自有">自带锚</h3>\n\n## 真标题';
    const html = renderMarkdown(source);
    expect(html).toContain('<h2 class="pasted">带属性</h2>');
    expect(html).toContain('id="自有"'); // 自带 id 不被覆写
    expect(html).toContain('<h2 id="heading-真标题">真标题</h2>');
  });

  it('引用块内混排：引用内 markdown 标题、引用内网页标题与顶层标题按文档序配对', () => {
    const source = ['> ## 引用内标题', '>', '> <h3>引用内网页标题</h3>', '', '## 顶层标题'].join(
      '\n',
    );
    const html = renderMarkdown(source);
    expect(html).toContain('<h2 id="heading-引用内标题">引用内标题</h2>');
    expect(html).toContain('<h3>引用内网页标题</h3>');
    expect(html).toContain('<h2 id="heading-顶层标题">顶层标题</h2>');
    expect(html).not.toContain('id="heading-引用内网页标题"');
  });

  it('原生 HTML 标题在前不推移同名 markdown 标题的 occurrence（与 AST 一致）', () => {
    const source = '<h2>概要</h2>\n\n## 概要\n\n## 概要';
    const html = renderMarkdown(source);
    // occurrence 只按 markdown 标题累计（AST 不感知 html 标题）：
    // 两个 markdown 概要分别是 1 号与 2 号，不被前面的 html 概要推移。
    expect(html).toContain('<h2 id="heading-概要">概要</h2>');
    expect(html).toContain('<h2 id="heading-概要-2">概要</h2>');
    const astIds = parseDocument(source)
      .blocks.filter((block) => block.type === 'heading')
      .map((block) => (block as HeadingNode).id);
    expect(astIds).toEqual(['heading-概要', 'heading-概要-2']);
  });
});
describe('R1 互审修复回归', () => {
  // C2：marked 行内切词在「恰好 1 个词字符前缀」场景不得漏判边界
  it('a#b / C#7 不渲染 md-tag（单字符词前缀）', () => {
    expect(renderMarkdown('a#b')).not.toContain('md-tag');
    expect(renderMarkdown('C#7')).not.toContain('md-tag');
    expect(renderMarkdown('x #y')).toContain('md-tag');
  });

  // C3：heading id 注入跟随渲染引擎 token 序列（含引用内嵌标题）
  it('引用内嵌标题与顶层标题按渲染序配对 id（同引擎对齐）', () => {
    const html = renderMarkdown('> # A\n\n# B');
    // marked 把引用内的 # A 也渲染为 h1；id 必须按 DOM 序对应 text，不得张冠李戴
    expect(html).toContain('<h1 id="heading-a">A</h1>');
    expect(html).toContain('<h1 id="heading-b">B</h1>');
  });
});

describe('R1 焦点复审回归（C2 词边界两层分工）', () => {
  it('相邻标签不丢失：#tag1 #tag2 两个都渲染', () => {
    const html = renderMarkdown('#tag1 #tag2');
    expect(html).toContain('data-tag="tag1"');
    expect(html).toContain('data-tag="tag2"');
  });

  it('wiki-link 后的标签不丢失：[[x]] #tag', () => {
    const html = renderMarkdown('[[x]] #tag');
    expect(html).toContain('class="wikilink');
    expect(html).toContain('data-tag="tag"');
  });

  it('行内格式后的标签不丢失：**b** #tag', () => {
    const html = renderMarkdown('**b** #tag');
    expect(html).toContain('<strong>b</strong>');
    expect(html).toContain('data-tag="tag"');
  });

  it('词字符紧邻仍不误判：a#b / C#7 / abc#def', () => {
    expect(renderMarkdown('a#b')).not.toContain('md-tag');
    expect(renderMarkdown('C#7')).not.toContain('md-tag');
    expect(renderMarkdown('abc#def')).not.toContain('md-tag');
  });
});
