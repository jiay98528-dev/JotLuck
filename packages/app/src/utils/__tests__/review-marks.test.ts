import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';

import {
  reviewMarksExtension,
  reviewMarksField,
  setReviewMarks,
  type ReviewMarkRange,
} from '../review-marks';

const mounted: EditorView[] = [];

function mountEditor(doc: string): EditorView {
  const host = document.createElement('div');
  document.body.append(host);
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [reviewMarksExtension()] }),
    parent: host,
  });
  mounted.push(view);
  return view;
}

interface CollectedDeco {
  from: number;
  to: number;
  cls: string;
}

function collectDecorations(view: EditorView): CollectedDeco[] {
  const out: CollectedDeco[] = [];
  const cursor = view.state.field(reviewMarksField).iter();
  while (cursor.value !== null) {
    const spec = cursor.value.spec as { class?: string } | null;
    out.push({ from: cursor.from, to: cursor.to, cls: spec?.class ?? '' });
    cursor.next();
  }
  return out;
}

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.destroy();
  document.body.replaceChildren();
});

describe('reviewMarksExtension — text mark', () => {
  it('del 侧区间与类名正确', () => {
    const view = mountEditor('hello world');
    setReviewMarks(view, [{ from: 6, to: 11, side: 'del', kind: 'text' }]);
    expect(collectDecorations(view)).toEqual([{ from: 6, to: 11, cls: 'cm-review-mark-del' }]);
  });

  it('add 侧类名为 cm-review-mark-add', () => {
    const view = mountEditor('hello world');
    setReviewMarks(view, [{ from: 0, to: 5, side: 'add', kind: 'text' }]);
    expect(collectDecorations(view)).toEqual([{ from: 0, to: 5, cls: 'cm-review-mark-add' }]);
  });

  it('active 叠加 cm-review-mark-active', () => {
    const view = mountEditor('hello world');
    setReviewMarks(view, [{ from: 6, to: 11, side: 'add', kind: 'text', active: true }]);
    expect(collectDecorations(view)).toEqual([
      { from: 6, to: 11, cls: 'cm-review-mark-add cm-review-mark-active' },
    ]);
  });

  it('跨行 mark 按行拆分且各段不含换行', () => {
    // 位置：0a 1b 2\n 3c 4d 5\n 6e 7f → [1,5) 拆为 (1,2) 与 (3,5)
    const view = mountEditor('ab\ncd\nef');
    setReviewMarks(view, [{ from: 1, to: 5, side: 'del', kind: 'text' }]);
    expect(collectDecorations(view)).toEqual([
      { from: 1, to: 2, cls: 'cm-review-mark-del' },
      { from: 3, to: 5, cls: 'cm-review-mark-del' },
    ]);
    for (const { from, to } of collectDecorations(view)) {
      expect(view.state.doc.sliceString(from, to)).not.toContain('\n');
    }
  });

  it('越界钳制到文档长度、倒置与空区间丢弃', () => {
    const view = mountEditor('abc');
    const ranges: ReviewMarkRange[] = [
      { from: 2, to: 99, side: 'del', kind: 'text' }, // 钳到 [2,3)
      { from: 10, to: 20, side: 'add', kind: 'text' }, // 完全越界：丢弃
      { from: 1, to: 1, side: 'add', kind: 'text' }, // 空区间：丢弃
      { from: 2, to: 0, side: 'del', kind: 'text' }, // 起止倒置：丢弃
    ];
    setReviewMarks(view, ranges);
    expect(collectDecorations(view)).toEqual([{ from: 2, to: 3, cls: 'cm-review-mark-del' }]);
  });

  it('二次 dispatch 全量替换（清空生效）', () => {
    const view = mountEditor('abc');
    setReviewMarks(view, [{ from: 0, to: 3, side: 'del', kind: 'text' }]);
    expect(collectDecorations(view)).toHaveLength(1);
    setReviewMarks(view, []);
    expect(collectDecorations(view)).toEqual([]);
    setReviewMarks(view, [{ from: 1, to: 2, side: 'add', kind: 'text' }]);
    expect(collectDecorations(view)).toEqual([{ from: 1, to: 2, cls: 'cm-review-mark-add' }]);
  });

  it('mark 在 CM DOM 内渲染出对应类名的 span', () => {
    const view = mountEditor('hello world');
    setReviewMarks(view, [{ from: 6, to: 11, side: 'del', kind: 'text' }]);
    const span = view.dom.querySelector<HTMLElement>('.cm-review-mark-del');
    expect(span).not.toBeNull();
    expect(span!.textContent).toBe('world');
  });
});

describe('reviewMarksExtension — line mark', () => {
  it('from=to=行首：单行 line 装饰生效', () => {
    // 位置：0a 1\n 2b 3\n 4c
    const view = mountEditor('a\nb\nc');
    setReviewMarks(view, [{ from: 2, to: 2, side: 'add', kind: 'line' }]);
    expect(collectDecorations(view)).toEqual([{ from: 2, to: 2, cls: 'cm-review-line-add' }]);
  });

  it('from<to：染区间覆盖的全部行（右端开区间）', () => {
    // [0,4) 覆盖行1(a) 与行2(b)；位置 4 的行3(c) 不在区间内
    const view = mountEditor('a\nb\nc');
    setReviewMarks(view, [{ from: 0, to: 4, side: 'del', kind: 'line' }]);
    expect(collectDecorations(view)).toEqual([
      { from: 0, to: 0, cls: 'cm-review-line-del' },
      { from: 2, to: 2, cls: 'cm-review-line-del' },
    ]);
  });

  it('line 装饰 active 叠加 cm-review-mark-active', () => {
    const view = mountEditor('a\nb\nc');
    setReviewMarks(view, [{ from: 0, to: 0, side: 'del', kind: 'line', active: true }]);
    expect(collectDecorations(view)).toEqual([
      { from: 0, to: 0, cls: 'cm-review-line-del cm-review-mark-active' },
    ]);
  });

  it('区间末行钳制：to 超出文档长度时按末行收口', () => {
    const view = mountEditor('a\nb\nc');
    setReviewMarks(view, [{ from: 2, to: 99, side: 'del', kind: 'line' }]);
    expect(collectDecorations(view)).toEqual([
      { from: 2, to: 2, cls: 'cm-review-line-del' },
      { from: 4, to: 4, cls: 'cm-review-line-del' },
    ]);
  });

  it('line 装饰渲染到 .cm-line 元素上', () => {
    const view = mountEditor('a\nb\nc');
    setReviewMarks(view, [{ from: 2, to: 2, side: 'add', kind: 'line' }]);
    const lines = [...view.dom.querySelectorAll<HTMLElement>('.cm-line')];
    expect(lines.some((line) => line.classList.contains('cm-review-line-add'))).toBe(true);
  });
});

describe('reviewMarksExtension — text 与 line 混装', () => {
  it('混合输入按位置排序共存于同一 DecorationSet', () => {
    const view = mountEditor('ab\ncd');
    setReviewMarks(view, [
      { from: 3, to: 5, side: 'del', kind: 'text' },
      { from: 0, to: 0, side: 'add', kind: 'line' },
    ]);
    expect(collectDecorations(view)).toEqual([
      { from: 0, to: 0, cls: 'cm-review-line-add' },
      { from: 3, to: 5, cls: 'cm-review-mark-del' },
    ]);
  });
});
