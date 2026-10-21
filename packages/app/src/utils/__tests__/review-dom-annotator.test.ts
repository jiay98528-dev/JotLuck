import { afterEach, describe, expect, it } from 'vitest';

import {
  annotateBlockBySourceRanges,
  annotateRenderedFragment,
  applyBlockTint,
  visibleTextOf,
} from '../review-dom-annotator';

function mountFragment(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

function marksOf(root: ParentNode, side: 'del' | 'add'): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(`mark.review-mark-${side}`)];
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('annotateRenderedFragment', () => {
  it('单文本节点：区间段被 mark 包裹，其余文本留在原节点', () => {
    const root = mountFragment('<p>今天天气很好</p>');
    annotateRenderedFragment(root, [{ from: 4, to: 6, side: 'del' }]);
    const marks = marksOf(root, 'del');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe('很好');
    expect(marks[0]!.className).toBe('review-mark-del');
    expect(root.textContent).toBe('今天天气很好');
  });

  it('add 侧类名为 review-mark-add', () => {
    const root = mountFragment('<p>今天天气很差</p>');
    annotateRenderedFragment(root, [{ from: 5, to: 6, side: 'add' }]);
    const marks = marksOf(root, 'add');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe('差');
    expect(marks[0]!.className).toBe('review-mark-add');
  });

  it('多文本节点跨节点区间：逐节点切分并分别包裹', () => {
    const root = mountFragment('<p><strong>甲乙</strong>丙丁</p>');
    annotateRenderedFragment(root, [{ from: 1, to: 3, side: 'del' }]);
    const marks = marksOf(root, 'del');
    expect(marks.map((m) => m.textContent)).toEqual(['乙', '丙']);
    // 各自包裹在自己的父元素内，顺序不变
    expect(marks[0]!.parentNode).toBe(root.querySelector('strong'));
    expect(marks[1]!.parentNode).toBe(root.querySelector('p'));
    expect(root.querySelector('strong')!.textContent).toBe('甲乙');
    expect(root.textContent).toBe('甲乙丙丁');
  });

  it('区间起止落在节点边界：只包裹命中的整节点', () => {
    const root = mountFragment('<p><strong>a</strong>b</p>');
    annotateRenderedFragment(root, [{ from: 1, to: 2, side: 'add' }]);
    const marks = marksOf(root, 'add');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe('b');
    expect(root.querySelector('strong mark')).toBeNull();
    expect(root.querySelector('strong')!.textContent).toBe('a');
    expect(root.textContent).toBe('ab');
  });

  it('贴边区间（覆盖全部文本）：整节点包裹且不产生空文本节点', () => {
    const root = mountFragment('<p><strong>ab</strong>cd</p>');
    annotateRenderedFragment(root, [{ from: 0, to: 4, side: 'del' }]);
    const marks = marksOf(root, 'del');
    expect(marks.map((m) => m.textContent)).toEqual(['ab', 'cd']);
    const strong = root.querySelector('strong')!;
    const p = root.querySelector('p')!;
    expect(strong.childNodes).toHaveLength(1);
    expect(strong.firstChild).toBe(marks[0]);
    expect(p.childNodes).toHaveLength(2); // strong + mark，无游离文本
    expect(p.lastChild).toBe(marks[1]);
    expect(root.textContent).toBe('abcd');
  });

  it('嵌套结构跨多节点：textContent 与顺序逐字节保持', () => {
    const root = mountFragment(
      '<div><p>第一段</p><ul><li>项目 <strong>加粗</strong></li></ul></div>',
    );
    const before = root.textContent;
    annotateRenderedFragment(root, [{ from: 3, to: 8, side: 'add' }]);
    expect(marksOf(root, 'add').map((m) => m.textContent)).toEqual(['项目 ', '加粗']);
    expect(root.textContent).toBe(before);
    expect(root.textContent).toBe('第一段项目 加粗');
  });

  it('已是 mark 元素内的文本节点正常包裹（嵌套 mark）', () => {
    const root = mountFragment('<p>前<mark class="hl">中段</mark>后</p>');
    annotateRenderedFragment(root, [{ from: 1, to: 4, side: 'del' }]);
    const marks = marksOf(root, 'del');
    expect(marks.map((m) => m.textContent)).toEqual(['中段', '后']);
    expect(marks[0]!.parentNode).toBe(root.querySelector('mark.hl'));
    expect(marks[1]!.parentNode).toBe(root.querySelector('p'));
    expect(root.textContent).toBe('前中段后');
  });

  it('越界钳制与空区间跳过', () => {
    const root = mountFragment('<p>abcde</p>');
    annotateRenderedFragment(root, [
      { from: 3, to: 99, side: 'del' }, // 钳到 [3,5)
      { from: 10, to: 20, side: 'del' }, // 完全越界：跳过
      { from: 1, to: 1, side: 'del' }, // 空区间：跳过
      { from: -5, to: 1, side: 'del' }, // 负起点钳到 [0,1)
    ]);
    expect(marksOf(root, 'del').map((m) => m.textContent)).toEqual(['a', 'de']);
    expect(root.textContent).toBe('abcde');
  });

  it('乱序输入按 from 排序后全部应用', () => {
    const root = mountFragment('<p>abcdef</p>');
    annotateRenderedFragment(root, [
      { from: 4, to: 6, side: 'del' },
      { from: 0, to: 2, side: 'del' },
    ]);
    expect(marksOf(root, 'del').map((m) => m.textContent)).toEqual(['ab', 'ef']);
    expect(root.textContent).toBe('abcdef');
  });

  it('与前一段重叠的区间整段丢弃（防御）', () => {
    const root = mountFragment('<p>abcdef</p>');
    annotateRenderedFragment(root, [
      { from: 0, to: 5, side: 'del' },
      { from: 4, to: 6, side: 'del' },
    ]);
    expect(marksOf(root, 'del').map((m) => m.textContent)).toEqual(['abcde']);
    expect(root.textContent).toBe('abcdef');
  });

  it('无可见文本或空区间列表：不抛错不改动', () => {
    const root = mountFragment('<p></p>');
    annotateRenderedFragment(root, [{ from: 0, to: 5, side: 'del' }]);
    expect(root.querySelectorAll('mark')).toHaveLength(0);
    annotateRenderedFragment(root, []);
    expect(root.querySelectorAll('mark')).toHaveLength(0);
    expect(root.textContent).toBe('');
  });

  it('跳过装饰节点：列表 bullet 槽不参与可见坐标，mark 不包裹 bullet', () => {
    // 按 renderBlockHtml 的真实结构：cm-list-marker-slot 包 bullet、cm-list-content 包内容
    const root = mountFragment(
      '<span><span class="cm-list-marker-slot"><span class="cm-list-marker">•</span></span>' +
        '<span class="cm-list-content">项目内容</span></span>',
    );
    expect(visibleTextOf(root)).toBe('项目内容'); // bullet 被跳过
    annotateRenderedFragment(root, [{ from: 0, to: 2, side: 'add' }]);
    const marks = marksOf(root, 'add');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe('项目');
    expect(marks[0]!.closest('.cm-list-content')).not.toBeNull();
    expect(root.querySelector('.cm-list-marker')!.textContent).toBe('•'); // bullet 原样
  });
});

describe('visibleTextOf', () => {
  it('聚合非装饰 text node、跳过按钮/复选框/远程图占位', () => {
    const root = mountFragment(
      '<div>甲<button>点击</button><span class="cm-task-toggle">☑</span>' +
        '<span class="remote-image">图占位</span>乙</div>',
    );
    expect(visibleTextOf(root)).toBe('甲乙');
  });
});

describe('applyBlockTint', () => {
  it('按侧别添加整块底色类', () => {
    const root = mountFragment('<p>整块文字</p>');
    const p = root.querySelector('p')!;
    applyBlockTint(p, 'del');
    expect(p.classList.contains('review-block-del')).toBe(true);
    expect(p.classList.contains('review-block-add')).toBe(false);
    applyBlockTint(p, 'add');
    expect(p.classList.contains('review-block-add')).toBe(true);
    expect(p.textContent).toBe('整块文字');
  });
});

describe('annotateBlockBySourceRanges', () => {
  it('纯文本 1:1：源码区间投影到可见文本并包裹', () => {
    const root = mountFragment('<p>今天天气很好</p>');
    const ok = annotateBlockBySourceRanges(root, {
      blockSource: '今天天气很好',
      contentFrom: 100, // 任意文档内偏移（如块前有其他内容）
      literal: false,
      definitions: '',
      ranges: [{ from: 104, to: 106 }], // '很好'
      side: 'del',
    });
    expect(ok).toBe(true);
    expect(marksOf(root, 'del').map((m) => m.textContent)).toEqual(['很好']);
  });

  it('加粗：标记符不在可见文本内，改动词 mark 只包内容', () => {
    const root = mountFragment('<p><strong>加粗词</strong>尾</p>');
    const ok = annotateBlockBySourceRanges(root, {
      blockSource: '**加粗词**尾',
      contentFrom: 0,
      literal: false,
      definitions: '',
      ranges: [{ from: 2, to: 5 }], // 源码中的 加粗词（跳过 ** 标记符）
      side: 'add',
    });
    expect(ok).toBe(true);
    const marks = marksOf(root, 'add');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe('加粗词');
    expect(marks[0]!.textContent).not.toContain('*');
  });

  it('wiki-link：[[笔记|别名]] 投影到别名', () => {
    const root = mountFragment('<p>前别名后</p>');
    const ok = annotateBlockBySourceRanges(root, {
      blockSource: '前[[笔记|别名]]后',
      contentFrom: 0,
      literal: false,
      definitions: '',
      ranges: [{ from: 1, to: 10 }], // 整个 wiki-link 源码区间 '[[笔记|别名]]'
      side: 'add',
    });
    expect(ok).toBe(true);
    const marks = marksOf(root, 'add');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe('别名');
  });

  it('HTML 实体：解码后坐标仍对齐', () => {
    const root = mountFragment('<p>a&b</p>');
    const ok = annotateBlockBySourceRanges(root, {
      blockSource: 'a&amp;b',
      contentFrom: 0,
      literal: false,
      definitions: '',
      ranges: [{ from: 1, to: 6 }], // &amp; 实体整体
      side: 'del',
    });
    expect(ok).toBe(true);
    expect(marksOf(root, 'del').map((m) => m.textContent)).toEqual(['&']);
  });

  it('纯语法区间（只覆盖标记符）：投影空 → return false 不动 DOM', () => {
    const root = mountFragment('<p>加粗</p>');
    const ok = annotateBlockBySourceRanges(root, {
      blockSource: '**加粗**',
      contentFrom: 0,
      literal: false,
      definitions: '',
      ranges: [{ from: 0, to: 2 }], // 只覆盖开头 **
      side: 'add',
    });
    expect(ok).toBe(false);
    expect(root.querySelectorAll('mark')).toHaveLength(0);
  });

  it('列表项 DOM：bullet 槽被跳过，mark 精确包裹内容词（contentFrom 契约）', () => {
    // renderBlockHtml :800-803 真实结构；doc 行 '- 列表项内容与改动词'：
    // contentFrom=2（AST contentRange.from，'- ' 之后）→ blockSource 不含 '- '，
    // mark 不含 bullet 也不含标记后空白。
    const root = mountFragment(
      '<span class="cm-live-block">' +
        '<span class="cm-list-marker-slot"><span class="cm-list-marker">•</span></span>' +
        '<span class="cm-list-content">列表项内容与改动词</span></span>',
    );
    const ok = annotateBlockBySourceRanges(root, {
      blockSource: '列表项内容与改动词',
      contentFrom: 2,
      literal: false,
      definitions: '',
      ranges: [{ from: 2 + 6, to: 2 + 9 }], // '改动词'（blockSource 内 [6,9)，文档坐标 +2）
      side: 'add',
    });
    expect(ok).toBe(true);
    const marks = marksOf(root, 'add');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe('改动词');
    expect(marks[0]!.textContent).not.toContain('-');
    expect(marks[0]!.textContent).not.toContain('•');
  });

  it('ref 链接（传 definitions）：解析为链接文本后投影命中', () => {
    const root = mountFragment('<p>见 文本 尾</p>');
    const ok = annotateBlockBySourceRanges(root, {
      blockSource: '见 [文本][r1] 尾',
      contentFrom: 0,
      literal: false,
      definitions: '[r1]: https://x',
      ranges: [{ from: 2, to: 10 }], // 链接 token '[文本][r1]'（[2,10)，尾空格/尾字不在内）
      side: 'add',
    });
    expect(ok).toBe(true);
    const marks = marksOf(root, 'add');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe('文本');
  });

  it('ref 链接（缺 definitions）：map.text 含字面方括号，全等校验失败 → return false', () => {
    const root = mountFragment('<p>见 文本 尾</p>');
    const ok = annotateBlockBySourceRanges(root, {
      blockSource: '见 [文本][r1] 尾',
      contentFrom: 0,
      literal: false,
      definitions: '', // 未透传 → lexer.links 未注入 → [文本][r1] 不解析
      ranges: [{ from: 2, to: 10 }],
      side: 'add',
    });
    expect(ok).toBe(false);
    expect(root.querySelectorAll('mark')).toHaveLength(0);
  });

  it('尾随换行 artifact（renderBlock 的 `<p>x</p>\\n`）被豁免，投影照常命中', () => {
    // 真实管线：renderMarkdown 输出块 HTML 带尾随换行，DOMPurify 保留为空白
    // text node——visibleTextOf 比 map.text 多一个 '\n'，须豁免而非 tint
    const root = document.createElement('div');
    root.innerHTML = '<p>第一段已被改写的措辞。</p>\n';
    document.body.append(root);
    const ok = annotateBlockBySourceRanges(root, {
      blockSource: '第一段已被改写的措辞。',
      contentFrom: 10,
      literal: false,
      definitions: '',
      ranges: [{ from: 10 + 8, to: 10 + 10 }], // '措辞'（blockSource 内 [8,10)）
      side: 'add',
    });
    expect(ok).toBe(true);
    expect(marksOf(root, 'add').map((m) => m.textContent)).toEqual(['措辞']);
  });

  it('首部空白分歧不豁免：坐标会整体平移 → return false', () => {
    const root = mountFragment('<p> 内容</p>');
    const ok = annotateBlockBySourceRanges(root, {
      blockSource: '内容',
      contentFrom: 0,
      literal: false,
      definitions: '',
      ranges: [{ from: 0, to: 2 }],
      side: 'add',
    });
    expect(ok).toBe(false);
    expect(root.querySelectorAll('mark')).toHaveLength(0);
  });

  it('inline HTML 文本分歧（map 与 DOM 可见文本不一致）→ return false', () => {
    // 真实管线中 DOMPurify 会剥离 <script> 及其内容，而词法 map 仍计入其
    // 文本 token（editor-source-map 只跳过 html 标签 token、不剥内容文本）——
    // 两侧聚合文本不全等，全等校验对称兜底（宁降级不错位）。
    const root = mountFragment('<p>前</p>');
    const ok = annotateBlockBySourceRanges(root, {
      blockSource: '前<script>恶意()</script>',
      contentFrom: 0,
      literal: false,
      definitions: '',
      ranges: [{ from: 0, to: 1 }],
      side: 'add',
    });
    expect(ok).toBe(false);
    expect(root.querySelectorAll('mark')).toHaveLength(0);
  });
});
