/**
 * review-dom-annotator — 改稿模式渲染结果内嵌马克笔标注器
 *
 * 即时渲染态下，块级 widget / 预览面板里的已渲染 HTML 不经过 CM6 Decoration
 * 管线；本模块直接在这些 DOM 片段上按「可见文本坐标」做马克笔包裹。
 *
 * 坐标系：root 子树的聚合可见文本 = 树序遍历全部 text node 的 data 串接
 *        （等价于 document order 的 textContent，标签与属性不参与计数）。
 *
 * 契约与防御（契约侧见 review-types.ts VisibleTextMark）：
 *  - 调用方保证区间升序且互不重叠；本模块仍做防御：
 *    越界钳制到 [0, total)、空/倒置区间丢弃、乱序输入按 from 排序、
 *    与前一段重叠的区间整段丢弃；
 *  - 只切分 text node 并用 <mark> 包裹对应段，不增删、不重排任何字符
 *    （包裹前后 root.textContent 逐字节一致）；
 *  - 假定对同一 DOM 只跑一次（重复跑会在旧 mark 内再包一层）；
 *  - 已位于 mark 元素内的 text node 与普通节点同等处理（正常包裹）。
 */

import type { ReviewMarkSide, VisibleTextMark } from './review-types';
import { diffWordSpans } from './review-worddiff';

/** 行内马克笔类名（del=源稿红笔，add=工作稿绿笔） */
const MARK_CLASS: Record<ReviewMarkSide, string> = {
  del: 'review-mark-del',
  add: 'review-mark-add',
};

/** 整块底色类名 */
const BLOCK_CLASS: Record<ReviewMarkSide, string> = {
  del: 'review-block-del',
  add: 'review-block-add',
};

/** 聚合可见文本中的一个 text node 及其区间 */
interface TextNodeSpan {
  node: Text;
  /** 节点首字符在聚合可见文本中的偏移 */
  start: number;
  end: number;
}

/** 树序（document order）收集 root 下全部非空 text node 及其聚合偏移 */
function collectTextSpans(root: ParentNode): TextNodeSpan[] {
  const spans: TextNodeSpan[] = [];
  const ownerDoc = root.ownerDocument ?? document;
  const walker = ownerDoc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = 0;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    if (text.data.length > 0) {
      spans.push({ node: text, start: offset, end: offset + text.data.length });
    }
    offset += text.data.length;
  }
  return spans;
}

/**
 * 把 text node 内 [localFrom, localTo) 的段用 <mark> 包裹。
 * 先 splitText 切出精确段，再原位包裹：节点其余部分与兄弟顺序保持不变。
 */
function wrapTextSegment(
  node: Text,
  localFrom: number,
  localTo: number,
  side: ReviewMarkSide,
): void {
  const parent = node.parentNode;
  if (parent === null) return;
  let segment = node;
  if (localFrom > 0) segment = node.splitText(localFrom);
  if (localTo - localFrom < segment.data.length) segment.splitText(localTo - localFrom);
  const mark = (node.ownerDocument ?? document).createElement('mark');
  mark.className = MARK_CLASS[side];
  parent.insertBefore(mark, segment);
  mark.appendChild(segment);
}

/**
 * 在 root 的聚合可见文本上应用马克笔区间：每个区间命中的 text node 段
 * 用 <mark class="review-mark-del|-add"> 包裹。见文件头契约说明。
 */
export function annotateRenderedFragment(root: ParentNode, marks: VisibleTextMark[]): void {
  if (marks.length === 0) return;
  const spans = collectTextSpans(root);
  const total = spans.length > 0 ? spans[spans.length - 1]!.end : 0;
  if (total === 0) return;

  // 防御：钳制 + 过滤 + 排序 + 重叠整段丢弃（契约外的输入也不至于染花 DOM）
  const valid: VisibleTextMark[] = [];
  const sorted = [...marks].sort((a, b) => a.from - b.from);
  for (const mark of sorted) {
    if (!Number.isFinite(mark.from) || !Number.isFinite(mark.to)) continue;
    const from = Math.max(0, Math.trunc(mark.from));
    const to = Math.min(total, Math.trunc(mark.to));
    if (from >= to) continue; // 空区间 / 完全越界
    const prev = valid[valid.length - 1];
    if (prev !== undefined && from < prev.to) continue; // 与前一段重叠：整段丢弃
    valid.push({ from, to, side: mark.side });
  }
  if (valid.length === 0) return;

  // 从右往左处理：右侧区间的切分与包裹不改变左侧 text node 的已记录偏移
  //（splitText 只截短当前节点并在其后插入兄弟节点，前缀数据不动）。
  for (let i = valid.length - 1; i >= 0; i--) {
    const { from, to, side } = valid[i]!;
    for (let j = spans.length - 1; j >= 0; j--) {
      const span = spans[j]!;
      if (span.end <= from) break; // spans 升序：再往左必然不相交
      if (span.start >= to) continue; // 该节点整段位于区间右侧
      wrapTextSegment(
        span.node,
        Math.max(0, from - span.start),
        Math.min(span.end, to) - span.start,
        side,
      );
    }
  }
}

/** 给整块元素加删除/新增底色类（渲染态的块级 tint） */
export function applyBlockTint(el: Element, side: ReviewMarkSide): void {
  el.classList.add(BLOCK_CLASS[side]);
}

/**
 * 在可见文本坐标上做词级 diff 并按侧取区间：
 * side='del' 取 a 侧（源稿被改动/删除），side='add' 取 b 侧（工作稿修改/新增）。
 */
export function computeVisibleDiffMarks(
  textA: string,
  textB: string,
  side: ReviewMarkSide,
): VisibleTextMark[] {
  const spans = diffWordSpans(textA, textB);
  const list = side === 'del' ? spans.left : spans.right;
  return list.map((span) => ({ from: span.from, to: span.to, side }));
}
