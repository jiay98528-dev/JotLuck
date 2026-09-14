/**
 * WO-B1 块级 AST 测试 — parseDocument / blockAtLine / 源码偏移契约
 *
 * 覆盖：frontmatter、ATX/setext heading、code fence、裸 JSON、blockquote、
 * 列表、表格、hr、refDefinition、blank、paragraph、lineMap 与全角偏移专测。
 */
import { describe, expect, it } from 'vitest';
import { blockAtLine, parseDocument } from '../ast';
import type { BlockquoteNode, CodeFenceNode, HeadingNode, ListItemNode, TableNode } from '../ast';
import { splitTableCells } from '../syntax';

function blockTypes(source: string): string[] {
  return parseDocument(source).blocks.map((block) => block.type);
}

describe('frontmatter', () => {
  it('闭合 frontmatter：contentRange 与 rawContent 正确', () => {
    const source = '---\ntitle: x\n---\n# H';
    const ast = parseDocument(source);
    const fm = ast.frontmatter;
    expect(fm).not.toBeNull();
    expect(fm!.closed).toBe(true);
    expect(fm!.lineFrom).toBe(0);
    expect(fm!.lineTo).toBe(2);
    expect(fm!.rawContent).toBe('title: x');
    expect(source.slice(fm!.contentRange.from, fm!.contentRange.to)).toBe('title: x');
    expect(ast.blocks[0]!.type).toBe('frontmatter');
    expect(ast.blocks[1]!.type).toBe('heading');
  });

  it('未闭合 frontmatter 吞到 EOF 且 closed:false', () => {
    const source = '---\na\nb';
    const fm = parseDocument(source).frontmatter;
    expect(fm!.closed).toBe(false);
    expect(fm!.lineTo).toBe(2);
    expect(fm!.rawContent).toBe('a\nb');
  });

  it('非首行 --- 判为 hr（空行隔断）', () => {
    expect(blockTypes('text\n\n---')).toEqual(['paragraph', 'blank', 'horizontalRule']);
  });

  it('text 紧邻 --- 判为 setext 规则线', () => {
    const ast = parseDocument('text\n---');
    const heading = ast.blocks[0] as HeadingNode;
    expect(heading.type).toBe('heading');
    expect(heading.setext).toBe(true);
    expect(heading.level).toBe(2);
  });
});

describe('ATX heading', () => {
  it('识别 1-6 级', () => {
    const source = '# h1\n## h2\n### h3\n#### h4\n##### h5\n###### h6';
    const ast = parseDocument(source);
    expect(ast.blocks.map((b) => (b as HeadingNode).level)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(ast.blocks.every((b) => b.type === 'heading')).toBe(true);
  });

  it('去除尾随 #', () => {
    const heading = parseDocument('## Title ##').blocks[0] as HeadingNode;
    expect(heading.text).toBe('Title');
    expect(heading.level).toBe(2);
  });

  it('同名 id occurrence 递增', () => {
    const ast = parseDocument('# Foo\n\n# Foo');
    expect((ast.blocks[0] as HeadingNode).id).toBe('heading-foo');
    expect((ast.blocks[2] as HeadingNode).id).toBe('heading-foo-2');
  });

  it('全角 ＃ 标题可识别且 contentRange 为源码偏移', () => {
    const source = '＃ 标题';
    const heading = parseDocument(source).blocks[0] as HeadingNode;
    expect(heading.type).toBe('heading');
    expect(heading.level).toBe(1);
    expect(heading.text).toBe('标题');
    expect(source.slice(heading.contentRange.from, heading.contentRange.to)).toBe('标题');
  });

  it('不允许前导缩进的 ATX', () => {
    expect(blockTypes('  # not heading')).toEqual(['paragraph']);
  });

  it('tab 分隔的 ATX：contentRange 不退化（R1-C4 回归）', () => {
    const source = '#\tTabbed';
    const heading = parseDocument(source).blocks[0] as HeadingNode;
    expect(heading.type).toBe('heading');
    expect(source.slice(heading.contentRange.from, heading.contentRange.to)).toBe('Tabbed');
  });

  it('全角尾随 ＃＃ 不剥离（与 marked/useHeadings 口径一致，R1-C5 回归）', () => {
    const source = '## T ＃＃';
    const heading = parseDocument(source).blocks[0] as HeadingNode;
    // text 与 contentRange 切片一致，且均保留全角尾随（与渲染端 marked 行为对齐）
    expect(heading.text).toBe('T ＃＃');
    expect(source.slice(heading.contentRange.from, heading.contentRange.to)).toBe(heading.text);
  });
});

describe('setext heading', () => {
  it('= 级 1、- 级 2，跨两行 range', () => {
    const source = 'Title One\n===\nTitle Two\n---';
    const ast = parseDocument(source);
    const h1 = ast.blocks[0] as HeadingNode;
    const h2 = ast.blocks[1] as HeadingNode;
    expect(h1.level).toBe(1);
    expect(h2.level).toBe(2);
    expect(h1.setext).toBe(true);
    expect(h1.lineTo).toBe(1);
    expect(source.slice(h1.range.from, h1.range.to)).toBe('Title One\n===');
    expect(source.slice(h1.setextRuleRange!.from, h1.setextRuleRange!.to)).toBe('===');
  });

  it('fence 内行不误判 setext', () => {
    const source = '```\nTitle\n===\n```';
    const ast = parseDocument(source);
    expect(ast.blocks[0]!.type).toBe('codeFence');
    expect(ast.blocks).toHaveLength(1);
  });

  it('结构性行不做 setext 文本：列表 + 空项不被吞成标题', () => {
    // '- foo\n- '：旧行扫描器会把首行当 setext 文本、'- ' 当规则线（误判 H2）；
    // 守卫后 = 两个无序列表项（第二项为空），与 GFM/marked 一致
    const ast = parseDocument('- foo\n- ');
    expect(ast.blocks.every((block) => block.type === 'listItem')).toBe(true);
    expect(ast.blocks).toHaveLength(2);
  });

  it('结构性行不做 setext 文本：引用行 + --- 是引用 + 分隔线', () => {
    const ast = parseDocument('> quote\n---');
    expect(ast.blocks[0]!.type).toBe('blockquote');
    expect(ast.blocks[1]!.type).toBe('horizontalRule');
  });

  it('结构性行不做 setext 文本：管道行 + --- 不成标题', () => {
    const ast = parseDocument('| a |\n---');
    expect(ast.blocks.some((block) => block.type === 'heading')).toBe(false);
  });
});

describe('code fence', () => {
  it('``` 与 lang', () => {
    const fence = parseDocument('```js\ncode\n```').blocks[0] as CodeFenceNode;
    expect(fence.type).toBe('codeFence');
    expect(fence.lang).toBe('js');
    expect(fence.marker).toBe('```');
    expect(fence.closed).toBe(true);
    expect(fence.openLine).toBe(0);
    expect(fence.closeLine).toBe(2);
    expect(fence.lineTo).toBe(2);
  });

  it('~~~ fence', () => {
    const fence = parseDocument('~~~rust\nx\n~~~').blocks[0] as CodeFenceNode;
    expect(fence.closed).toBe(true);
    expect(fence.marker).toBe('~~~');
  });

  it('≤3 缩进记录 indent', () => {
    const fence = parseDocument('  ```\nx\n  ```').blocks[0] as CodeFenceNode;
    expect(fence.indent).toBe(2);
    expect(fence.closed).toBe(true);
  });

  it('更长同型闭合围栏可闭合', () => {
    const fence = parseDocument('````\nx\n``````').blocks[0] as CodeFenceNode;
    expect(fence.closed).toBe(true);
    expect(fence.closeLine).toBe(2);
  });

  it('异型围栏不互相闭合', () => {
    const fence = parseDocument('~~~\n``` not close\n~~~').blocks[0] as CodeFenceNode;
    expect(fence.closed).toBe(true);
    expect(fence.closeLine).toBe(2);
  });

  it('未闭合吞 EOF', () => {
    const fence = parseDocument('```\na\nb').blocks[0] as CodeFenceNode;
    expect(fence.closed).toBe(false);
    expect(fence.closeLine).toBeNull();
    expect(fence.lineTo).toBe(2);
  });

  it('末行开围栏：contentRange 不越 EOF（R1-C6 回归）', () => {
    const source = 'text\n```js';
    const fence = parseDocument(source).blocks[1] as CodeFenceNode;
    expect(fence.closed).toBe(false);
    expect(fence.contentRange!.from).toBeLessThanOrEqual(source.length);
    expect(fence.contentRange!.to).toBeLessThanOrEqual(source.length);
  });
});

describe('裸 JSON 块', () => {
  it('多行 JSON 范围', () => {
    const source = 'before\n\n{"a": 1,\n"b": [1, 2]}\n\nafter';
    const ast = parseDocument(source);
    expect(blockTypes(source)).toEqual(['paragraph', 'blank', 'jsonBlock', 'blank', 'paragraph']);
    const json = ast.blocks[2]!;
    expect(json.lineFrom).toBe(2);
    expect(json.lineTo).toBe(3);
  });

  it('fence 内的 JSON 不算裸 JSON', () => {
    const source = '```\n{"a": 1}\n```';
    expect(blockTypes(source)).toEqual(['codeFence']);
  });
});

describe('blockquote', () => {
  it('连续行成组、单级', () => {
    const source = '> a\n> b';
    const bq = parseDocument(source).blocks[0] as BlockquoteNode;
    expect(bq.type).toBe('blockquote');
    expect(bq.lineTo).toBe(1);
    expect(bq.depth).toBe(1);
    expect(bq.lines).toHaveLength(2);
    expect(bq.lines[1]!.lineNumber).toBe(1);
  });

  it('多级 >> 与 normalizedMarker', () => {
    const source = '>> nested';
    const bq = parseDocument(source).blocks[0] as BlockquoteNode;
    expect(bq.depth).toBe(2);
    const line = bq.lines[0]!;
    expect(source.slice(line.markerRange.from, line.markerRange.to)).toBe('>> ');
    expect(source.slice(line.contentRange.from, line.contentRange.to)).toBe('nested');
    expect(line.normalizedMarker).toBe('>> ');
  });

  it('空引用行 isEmpty', () => {
    const bq = parseDocument('>').blocks[0] as BlockquoteNode;
    expect(bq.lines[0]!.isEmpty).toBe(true);
    expect(bq.lines[0]!.depth).toBe(1);
  });

  it('全角 ＞引用：markerRange 为源码偏移', () => {
    const source = '＞引用';
    const bq = parseDocument(source).blocks[0] as BlockquoteNode;
    const line = bq.lines[0]!;
    expect(source.slice(line.markerRange.from, line.markerRange.to)).toBe('＞');
    expect(line.markerRange.to - line.markerRange.from).toBe(1);
    expect(source.slice(line.contentRange.from, line.contentRange.to)).toBe('引用');
    expect(line.normalizedMarker).toBe('> ');
  });

  it('不允许缩进', () => {
    expect(blockTypes('  > not quote')).toEqual(['paragraph']);
  });
});

describe('列表', () => {
  it('三种 bullet 成组、itemIndex 递增', () => {
    const source = '- a\n* b\n+ c';
    const ast = parseDocument(source);
    expect(ast.blocks).toHaveLength(3);
    const items = ast.blocks as ListItemNode[];
    expect(items.map((item) => item.kind)).toEqual(['unordered', 'unordered', 'unordered']);
    expect(items.map((item) => item.marker)).toEqual(['-', '*', '+']);
    expect(items.map((item) => item.itemIndex)).toEqual([1, 2, 3]);
    const groupRange = items[0]!.groupRange;
    expect(source.slice(groupRange.from, groupRange.to)).toBe(source);
  });

  it('有序 1. 与 1) 都认并记录 delimiter', () => {
    const source = '1. one\n2) two';
    const items = parseDocument(source).blocks as ListItemNode[];
    expect(items.map((item) => item.kind)).toEqual(['ordered', 'ordered']);
    expect(items[0]!.delimiter).toBe('.');
    expect(items[1]!.delimiter).toBe(')');
    expect(items[1]!.number).toBe(2);
    expect(items[1]!.itemIndex).toBe(2);
  });

  it('任务列表 [ ] / [x] / [X]', () => {
    const source = '- [ ] todo\n- [x] done\n- [X] done2';
    const items = parseDocument(source).blocks as ListItemNode[];
    expect(items.map((item) => item.kind)).toEqual(['task', 'task', 'task']);
    expect(items.map((item) => item.checked)).toEqual([false, true, true]);
  });

  it('任务项 contentRange 精确（R1-C1 回归：`]` 不被重复计算）', () => {
    const single = parseDocument('- [x] d').blocks[0] as ListItemNode;
    expect(single.isEmpty).toBe(false);
    expect('- [x] d'.slice(single.contentRange.from, single.contentRange.to)).toBe('d');
    expect('- [x] d'.slice(single.markerRange.from, single.markerRange.to)).toBe('- [x]');

    const empty = parseDocument('- [ ]').blocks[0] as ListItemNode;
    expect(empty.isEmpty).toBe(true);
    // 空任务项不得出现 from > to 的倒置区间
    expect(empty.contentRange.from).toBeLessThanOrEqual(empty.contentRange.to);
  });

  it('缩进与 isEmpty', () => {
    // 注意：'- ' 会被 setext 规则线吞掉（现行行扫描优先级 quirk，AST 复刻），故用 '* ' 做空项
    const source = '  - indented\n* ';
    const items = parseDocument(source).blocks as ListItemNode[];
    expect(items[0]!.indent).toBe(2);
    expect(items[1]!.isEmpty).toBe(true);
  });

  it('－＋两个全角空格：markerRange/contentRange 源码偏移正确', () => {
    const source = '－　　foo';
    const item = parseDocument(source).blocks[0] as ListItemNode;
    expect(item.kind).toBe('unordered');
    expect(item.marker).toBe('-');
    expect(source.slice(item.markerRange.from, item.markerRange.to)).toBe('－');
    expect(source.slice(item.contentRange.from, item.contentRange.to)).toBe('foo');
  });

  it('全角 ＊ bullet', () => {
    const source = '＊ bar';
    const item = parseDocument(source).blocks[0] as ListItemNode;
    expect(item.kind).toBe('unordered');
    expect(item.marker).toBe('*');
    expect(source.slice(item.contentRange.from, item.contentRange.to)).toBe('bar');
  });
});

describe('表格', () => {
  it('基本组：分隔行、表头、对齐', () => {
    const source = '| a | b | c |\n| :- | :-: | -: |\n| 1 | 2 | 3 |';
    const table = parseDocument(source).blocks[0] as TableNode;
    expect(table.type).toBe('table');
    expect(table.rows).toHaveLength(3);
    expect(table.separatorIndex).toBe(1);
    expect(table.hasSeparator).toBe(true);
    expect(table.columnCount).toBe(3);
    expect(table.rows[0]!.isHeader).toBe(true);
    expect(table.rows[1]!.isSeparator).toBe(true);
    expect(table.rows[2]!.isHeader).toBe(false);
    expect(table.alignments).toEqual(['left', 'center', 'right']);
  });

  it('无分隔行 hasSeparator=false', () => {
    const source = '| a | b |\n| c | d |';
    const table = parseDocument(source).blocks[0] as TableNode;
    expect(table.hasSeparator).toBe(false);
    expect(table.separatorIndex).toBeNull();
    expect(table.rows.every((row) => !row.isHeader)).toBe(true);
    expect(table.alignments).toEqual(['left', 'left']);
  });

  it('foo | bar 非组首；配分隔行即成组', () => {
    expect(blockTypes('foo | bar')).toEqual(['paragraph']);
    const source = 'foo | bar\n--|--';
    const table = parseDocument(source).blocks[0] as TableNode;
    expect(table.type).toBe('table');
    expect(table.columnCount).toBe(2);
  });

  it('全角管道与全角 － 分隔格（isSeparator 修复）', () => {
    const source = '｜ a ｜ b ｜\n｜ － ｜ － ｜\n｜ c ｜ d ｜';
    const table = parseDocument(source).blocks[0] as TableNode;
    expect(table.hasSeparator).toBe(true);
    expect(table.separatorIndex).toBe(1);
    expect(table.rows[1]!.isSeparator).toBe(true);
    expect(table.rows[0]!.cells.map((cell) => cell.text)).toEqual(['a', 'b']);
  });

  it('参差格数 columnCount 取最大', () => {
    const source = '| a | b |\n| --- | --- |\n| c |';
    const table = parseDocument(source).blocks[0] as TableNode;
    expect(table.columnCount).toBe(2);
    expect(table.rows[2]!.cells).toHaveLength(1);
  });

  it('组内 cell 源码 range', () => {
    const source = '| ab | cd |';
    const table = parseDocument(source).blocks[0] as TableNode;
    const cells = table.rows[0]!.cells;
    expect(source.slice(cells[0]!.range.from, cells[0]!.range.to)).toBe('ab');
    expect(source.slice(cells[1]!.range.from, cells[1]!.range.to)).toBe('cd');
  });

  it('splitTableCells：未转义切分点跳过，保留原始切片（含反斜杠）', () => {
    expect(splitTableCells('| a\\|b | c |')).toEqual(['a\\|b', 'c']);
  });

  it('splitTableCells：无转义表格行为不变', () => {
    expect(splitTableCells('| a | b |')).toEqual(['a', 'b']);
    expect(splitTableCells('a | b')).toEqual(['a', 'b']);
  });

  it('splitTableCells：全角 ｜ 照切（无转义概念）', () => {
    expect(splitTableCells('a ｜ b ｜ c')).toEqual(['a', 'b', 'c']);
    expect(splitTableCells('｜ a ｜ b ｜')).toEqual(['a', 'b']);
  });

  it('splitTableCells：行首转义 | 是内容不切，行尾转义 | 不切', () => {
    expect(splitTableCells('\\|a | b')).toEqual(['\\|a', 'b']);
    expect(splitTableCells('a | b \\|')).toEqual(['a', 'b \\|']);
  });

  it('splitTableCells：偶数反斜杠 = 未转义，仍切分', () => {
    // `\\|`（两个反斜杠）不转义，照常切
    expect(splitTableCells('a \\\\| b')).toEqual(['a \\\\', 'b']);
  });

  it('splitTableCellsWithRanges：转义 | 不切，range 与文本一一对应', () => {
    const source = '| a\\|b | c |\n| --- | --- |';
    const table = parseDocument(source).blocks[0] as TableNode;
    expect(table.type).toBe('table');
    expect(table.rows[0]!.cells.map((cell) => cell.text)).toEqual(['a\\|b', 'c']);
    for (const cell of table.rows[0]!.cells) {
      expect(source.slice(cell.range.from, cell.range.to)).toBe(cell.text);
    }
    // 分隔行不受影响
    expect(table.rows[1]!.cells.map((cell) => cell.text)).toEqual(['---', '---']);
  });

  it('splitTableCellsWithRanges：行首转义 | 作为首格内容', () => {
    const source = '\\|a | b\n--|--';
    const table = parseDocument(source).blocks[0] as TableNode;
    expect(table.type).toBe('table');
    expect(table.rows[0]!.cells.map((cell) => cell.text)).toEqual(['\\|a', 'b']);
    for (const cell of table.rows[0]!.cells) {
      expect(source.slice(cell.range.from, cell.range.to)).toBe(cell.text);
    }
  });
});

describe('hr / refDefinition / blank / paragraph', () => {
  it('hr 三种', () => {
    expect(blockTypes('***')).toEqual(['horizontalRule']);
    expect(blockTypes('___')).toEqual(['horizontalRule']);
    expect(blockTypes('---')).toEqual(['frontmatter']); // 首行 --- 是 frontmatter
    expect(blockTypes('a\n\n---')).toContain('horizontalRule');
  });

  it('refDefinition 识别（含 title 与裸 url）', () => {
    const ast = parseDocument('[ref]: https://example.com "T"\n\n[bare]: /url');
    const first = ast.blocks[0]!;
    const second = ast.blocks[2]!;
    expect(first.type).toBe('refDefinition');
    if (first.type === 'refDefinition') {
      expect(first.label).toBe('ref');
      expect(first.url).toBe('https://example.com');
      expect(first.title).toBe('T');
    }
    expect(second.type).toBe('refDefinition');
    if (second.type === 'refDefinition') {
      expect(second.title).toBeUndefined();
    }
  });

  it('blank 与 paragraph 多行聚合', () => {
    const source = 'line one\nline two\n\nend';
    const ast = parseDocument(source);
    expect(ast.blocks.map((b) => b.type)).toEqual(['paragraph', 'blank', 'paragraph']);
    const para = ast.blocks[0]!;
    expect(para.lineTo).toBe(1);
    if (para.type === 'paragraph') {
      expect(para.text).toBe('line one\nline two');
    }
    expect(source.slice(para.range.from, para.range.to)).toBe('line one\nline two');
  });

  it('paragraph 被 heading 截断', () => {
    expect(blockTypes('text\n# H')).toEqual(['paragraph', 'heading']);
  });
});

describe('lineMap / blockAtLine', () => {
  it('行号到块映射（含 table rowIndex）', () => {
    const source = 'a\n\n# H\n- x\n| p | q |\n| - | - |\n| 1 | 2 |';
    const ast = parseDocument(source);
    expect(blockAtLine(ast, 0)!.type).toBe('paragraph');
    expect(blockAtLine(ast, 1)!.type).toBe('blank');
    expect(blockAtLine(ast, 2)!.type).toBe('heading');
    expect(blockAtLine(ast, 3)!.type).toBe('listItem');
    const rowInfo = ast.lineMap[5]!;
    expect(rowInfo.rowIndex).toBe(1);
    expect(blockAtLine(ast, 5)!.type).toBe('table');
    expect(blockAtLine(ast, -1)).toBeNull();
    expect(blockAtLine(ast, 99)).toBeNull();
  });

  it('多行块覆盖其全部行', () => {
    const ast = parseDocument('> a\n> b');
    expect(blockAtLine(ast, 0)!.type).toBe('blockquote');
    expect(blockAtLine(ast, 1)!.type).toBe('blockquote');
    expect(blockAtLine(ast, 0)).toBe(blockAtLine(ast, 1));
  });
});

describe('偏移专测：全角序列下 range 均为源码偏移', () => {
  it('5 个节点的 range 切片与源码一致', () => {
    const source = ['＃ 标题', '', '＞ 引用', '－　　foo', '｜ a ｜ b ｜', '｜ － ｜ － ｜'].join(
      '\n',
    );
    const ast = parseDocument(source);
    const heading = ast.blocks[0] as HeadingNode;
    const quote = ast.blocks[2] as BlockquoteNode;
    const item = ast.blocks[3] as ListItemNode;
    const table = ast.blocks[4] as TableNode;

    // 1. heading 整行 range
    expect(source.slice(heading.range.from, heading.range.to)).toBe('＃ 标题');
    // 2. heading contentRange
    expect(source.slice(heading.contentRange.from, heading.contentRange.to)).toBe('标题');
    // 3. blockquote 全角标记 range（含尾随空白）
    expect(source.slice(quote.lines[0]!.markerRange.from, quote.lines[0]!.markerRange.to)).toBe(
      '＞ ',
    );
    // 4. 列表标记与内容 range
    expect(source.slice(item.markerRange.from, item.markerRange.to)).toBe('－');
    expect(source.slice(item.contentRange.from, item.contentRange.to)).toBe('foo');
    // 5. 表格全角管道内 cell range
    const cells = table.rows[0]!.cells;
    expect(source.slice(cells[0]!.range.from, cells[0]!.range.to)).toBe('a');
    expect(source.slice(cells[1]!.range.from, cells[1]!.range.to)).toBe('b');
    // blank 行也不越界
    expect(ast.blocks[1]!.type).toBe('blank');
  });
});
