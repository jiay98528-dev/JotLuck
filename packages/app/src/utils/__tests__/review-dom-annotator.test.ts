import { afterEach, describe, expect, it } from 'vitest';

import {
  annotateRenderedFragment,
  applyBlockTint,
  computeVisibleDiffMarks,
} from '../review-dom-annotator';
import { diffWordSpans } from '../review-worddiff';

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

describe('computeVisibleDiffMarks', () => {
  it('del 侧与 diffWordSpans.left 一致', () => {
    const a = '今天天气很好';
    const b = '今天天气很差';
    expect(computeVisibleDiffMarks(a, b, 'del')).toEqual(
      diffWordSpans(a, b).left.map((s) => ({ from: s.from, to: s.to, side: 'del' as const })),
    );
  });

  it('add 侧与 diffWordSpans.right 一致且区间可回切原文', () => {
    const a = '甲乙丙丁';
    const b = '甲X丁';
    const marks = computeVisibleDiffMarks(a, b, 'add');
    expect(marks).toEqual(
      diffWordSpans(a, b).right.map((s) => ({ from: s.from, to: s.to, side: 'add' as const })),
    );
    expect(b.slice(marks[0]!.from, marks[0]!.to)).toBe('X');
  });

  it('相同文本两侧均为空', () => {
    expect(computeVisibleDiffMarks('同文', '同文', 'del')).toEqual([]);
    expect(computeVisibleDiffMarks('同文', '同文', 'add')).toEqual([]);
  });
});
