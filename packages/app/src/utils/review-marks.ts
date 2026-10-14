/**
 * review-marks — 改稿模式 CM6 源码态马克笔标记扩展
 *
 * 源码态（分栏左=只读源稿 / 右=可编辑工作稿）用 Decoration 在 CM6 内画
 * 马克笔；即时渲染态的内嵌 <mark> 标注见 review-dom-annotator。
 *
 * 范式同 cm6-ghost-text：StateField<DecorationSet> + 内部 StateEffect 全量
 * 替换；文档变更且未携带 effect 的旧集合随 tr.changes 映射（调用方每轮
 * diff 后重新 setReviewMarks 全量覆盖，映射仅作过渡保底）。
 *
 * 规则：
 *  - kind 'text'：Decoration.mark，class 为 cm-review-mark-del / -add（active
 *    再叠 cm-review-mark-active）。Decoration.mark 不允许跨行边界，一律按
 *    行拆分（同 cm6-live-preview 内 splitRangeByLine 的约定）；
 *  - kind 'line'：Decoration.line，from=to=行首（from<to 时染区间覆盖的全部
 *    行），class 为 cm-review-line-del / -add；
 *  - 区间钳制到 [0, doc.length]；倒置区间与 text 空区间丢弃。
 */

import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { StateEffect, StateField, type Extension, type Range, type Text } from '@codemirror/state';

import type { ReviewMarkSide } from './review-types';

/** 一处源码态马克笔：半开区间 [from, to)，UTF-16 偏移 */
export interface ReviewMarkRange {
  from: number;
  to: number;
  side: ReviewMarkSide;
  kind: 'text' | 'line';
  /** 激活态（当前定位的 hunk）：叠加 cm-review-mark-active */
  active?: boolean;
}

/** 内部 effect：全量替换当前标注集合 */
const setReviewMarksEffect = StateEffect.define<ReviewMarkRange[]>();

const TEXT_MARK_CLASS: Record<ReviewMarkSide, string> = {
  del: 'cm-review-mark-del',
  add: 'cm-review-mark-add',
};

const LINE_MARK_CLASS: Record<ReviewMarkSide, string> = {
  del: 'cm-review-line-del',
  add: 'cm-review-line-add',
};

/**
 * Decoration.mark 不允许跨行边界：把 [from, to) 拆成不越界的行内段。
 * （cm6-live-preview 内同名函数未导出，此处按同一约定实现。）
 */
function splitRangeByLine(
  doc: Text,
  from: number,
  to: number,
): Array<{ from: number; to: number }> {
  const parts: Array<{ from: number; to: number }> = [];
  let pos = from;
  while (pos < to) {
    const line = doc.lineAt(pos);
    const end = Math.min(to, line.to);
    parts.push({ from: pos, to: end });
    pos = end === line.to ? end + 1 : end;
  }
  return parts;
}

/** 把位置钳进 [0, length] 并取整 */
function clampPos(pos: number, length: number): number {
  return Math.max(0, Math.min(length, Math.trunc(pos)));
}

/** 区间列表 → DecorationSet（text 按行拆分；line 染覆盖的全部行） */
function buildReviewDecorations(doc: Text, ranges: readonly ReviewMarkRange[]): DecorationSet {
  const parts: Array<Range<Decoration>> = [];
  for (const range of ranges) {
    if (!Number.isFinite(range.from) || !Number.isFinite(range.to)) continue;
    const from = clampPos(range.from, doc.length);
    const to = clampPos(range.to, doc.length);
    if (to < from) continue; // 起止倒置：丢弃
    const active = range.active === true ? ' cm-review-mark-active' : '';
    if (range.kind === 'line') {
      // line 装饰允许 from===to（= 行首单行）；from<to 时染 [from,to) 覆盖的行
      const first = doc.lineAt(from);
      const last = to > from ? doc.lineAt(to - 1) : first;
      const cls = LINE_MARK_CLASS[range.side] + active;
      for (let n = first.number; n <= last.number; n++) {
        parts.push(Decoration.line({ class: cls }).range(doc.line(n).from));
      }
      continue;
    }
    if (to === from) continue; // text 空区间：丢弃
    const cls = TEXT_MARK_CLASS[range.side] + active;
    for (const part of splitRangeByLine(doc, from, to)) {
      parts.push(Decoration.mark({ class: cls }).range(part.from, part.to));
    }
  }
  // line 与 mark 混装无法保证构造序有序，交给 Decoration.set 排序
  return Decoration.set(parts, true);
}

/** 标注集合 field（导出供测试与消费方读取 DecorationSet） */
export const reviewMarksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setReviewMarksEffect)) {
        return buildReviewDecorations(tr.state.doc, effect.value);
      }
    }
    return tr.docChanged ? value.map(tr.changes) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** 源码态马克笔扩展：装配进只读源稿 / 工作稿两侧编辑器 */
export function reviewMarksExtension(): Extension {
  return reviewMarksField;
}

/** 全量替换当前标注集合（每轮 diff 后由工作台调用） */
export function setReviewMarks(view: EditorView, ranges: ReviewMarkRange[]): void {
  view.dispatch({ effects: setReviewMarksEffect.of(ranges) });
}
