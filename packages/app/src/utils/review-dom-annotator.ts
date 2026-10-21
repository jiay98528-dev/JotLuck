/**
 * review-dom-annotator — 改稿模式渲染结果内嵌马克笔标注器
 *
 * 即时渲染态下，块级 widget / 预览面板里的已渲染 HTML 不经过 CM6 Decoration
 * 管线；本模块直接在这些 DOM 片段上做马克笔包裹。
 *
 * 坐标系：root 子树的聚合可见文本 = 树序遍历全部「非装饰」text node 的 data
 *        串接（跳过 DECORATIVE_NODE_SELECTOR 命中子树——列表 bullet 槽、按钮、
 *        远程图占位、任务复选框；与 editor-source-map mapDomText 共享同一常量，
 *        两套坐标任一侧单独增删跳过项都会整体漂移）。
 *
 * 契约与防御（契约侧见 review-types.ts VisibleTextMark）：
 *  - 调用方保证区间升序且互不重叠；本模块仍做防御：
 *    越界钳制到 [0, total)、空/倒置区间丢弃、乱序输入按 from 排序、
 *    与前一段重叠的区间整段丢弃；
 *  - 只切分 text node 并用 <mark> 包裹对应段，不增删、不重排任何字符
 *    （包裹前后聚合可见文本逐字节一致）；
 *  - 假定对同一 DOM 只跑一次（重复跑会在旧 mark 内再包一层）；
 *  - 已位于 mark 元素内的 text node 与普通节点同等处理（正常包裹）。
 *
 * 源码坐标 → 可见坐标投影：annotateBlockBySourceRanges（见其注释）。
 */

import type { ReviewMarkSide, VisibleTextMark } from './review-types';
import { DECORATIVE_NODE_SELECTOR, inlineSourceMap } from './editor-source-map';

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

/** 树序（document order）收集 root 下全部非装饰、非空 text node 及其聚合偏移 */
function collectTextSpans(root: ParentNode): TextNodeSpan[] {
  const spans: TextNodeSpan[] = [];
  const ownerDoc = root.ownerDocument ?? document;
  const walker = ownerDoc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = 0;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    if (text.parentElement?.closest(DECORATIVE_NODE_SELECTOR)) continue;
    if (text.data.length > 0) {
      spans.push({ node: text, start: offset, end: offset + text.data.length });
      offset += text.data.length;
    }
  }
  return spans;
}

/** root 的聚合可见文本（与 collectTextSpans 同一跳过规则），供全等校验与测试共用 */
export function visibleTextOf(root: ParentNode): string {
  let out = '';
  for (const span of collectTextSpans(root)) out += span.node.data;
  return out;
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

/** annotateBlockBySourceRanges 的投影输入 */
export interface SourceRangeProjection {
  /** 块内容源码切片（文档中自 contentFrom 起）；inlineSourceMap 以它为词法输入 */
  blockSource: string;
  /** blockSource 首字符的文档 UTF-16 偏移（map.starts 与 ranges 同一坐标空间） */
  contentFrom: number;
  /** 整行字面渲染（code 围栏内容行 / json 行 / frontmatter 行）：无行内语法 */
  literal: boolean;
  /**
   * 全文引用式链接/图片定义（[r]: url 逐行串接）。renderer 的 lexer 仅在
   * definitions 非空时注入 links（renderer index.ts inlineSourceTokens），
   * 缺省则 [text][ref] 不解析、map.text 含字面方括号而 DOM 只显 text——
   * 下方全等校验因此失败回退。必须透传。
   */
  definitions: string;
  /** 文档源码坐标区间集合（无需升序，逐区间独立判定） */
  ranges: Array<{ from: number; to: number }>;
  side: ReviewMarkSide;
}

/**
 * 源码坐标区间 → 渲染 DOM 的词级马克笔投影。返回是否成功：
 *  - 先用 inlineSourceMap 构造「可见文本 ↔ 源码偏移」映射，再比对
 *    visibleTextOf(root) === map.text（逐字符全等，仅豁免尾部纯空白——
 *    renderMarkdown 块 HTML 的尾随换行 artifact）。不全等说明词法投影与
 *    真实 DOM 存在位移型分歧（缺 definitions 的 ref 链接、inline HTML、
 *    未预见分歧）——直接 return false 交调用方 tint 兜底，宁降级不错位。
 *    已知残余：全等但字符对位不同的理论情形（文本置排列）未防，实际概率
 *    可忽略。
 *  - 全等时按「可见字符 i 的源码偏移 map.starts[i] 落在任一区间内」投影，
 *    连续命中段合并为一个 mark（annotateRenderedFragment 应用）。
 *  - 投影为空（纯语法改动等）也 return false：交调用方 tint 兜底。
 */
export function annotateBlockBySourceRanges(
  root: ParentNode,
  input: SourceRangeProjection,
): boolean {
  let map;
  try {
    map = inlineSourceMap(input.blockSource, input.contentFrom, input.literal, input.definitions);
  } catch {
    return false; // 词法异常：不赌坐标，交 tint 兜底
  }
  const visibleText = visibleTextOf(root);
  // 尾部纯空白豁免：renderMarkdown 的块 HTML 带尾随换行（如 `<p>x</p>\n`），
  // DOMPurify 将其保留为空白 text node——属渲染管线固定 artifact，不是内容、
  // 也不影响其前任何可见字符的坐标。首部空白不豁免（会平移全部坐标），
  // 中段分歧照旧拦截。
  if (
    visibleText !== map.text &&
    visibleText.replace(/\s+$/, '') !== map.text.replace(/\s+$/, '')
  ) {
    return false;
  }

  const visible: VisibleTextMark[] = [];
  let runFrom = -1;
  let runTo = -1;
  const flush = (): void => {
    if (runFrom >= 0 && runTo > runFrom) {
      visible.push({ from: runFrom, to: runTo, side: input.side });
    }
    runFrom = -1;
    runTo = -1;
  };
  for (let i = 0; i < map.text.length; i++) {
    const at = map.starts[i]!;
    const hit = input.ranges.some((range) => at >= range.from && at < range.to);
    if (hit) {
      if (runFrom < 0) runFrom = i;
      runTo = i + 1;
    } else if (runFrom >= 0) {
      flush();
    }
  }
  flush();
  if (visible.length === 0) return false;
  annotateRenderedFragment(root, visible);
  return true;
}
