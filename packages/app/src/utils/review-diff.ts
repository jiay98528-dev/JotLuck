/**
 * 改稿模式 diff 引擎 — 块级对齐 + 块内词级 diff，产出 ReviewHunk[]。
 *
 * 管线：
 *   1. 两侧 parseDocument 得块序列，块文本 = 块区间源码切片（不含行尾换行符）；
 *   2. diffSequences(块文本) 对齐，等价段整段跳过；
 *   3. 变更运行区（连续 delete/insert 段）内，第 i 个被删块与第 i 个被插入块
 *      配对做 diffWordPaired，成对区间 + 块起点换算为全文偏移 → 每对一个 hunk
 *      （两侧都有 → modify；仅左 → delete；仅右 → insert）；
 *      多余未配对块生成整块 delete/insert hunk（range = 块 range，文本 = 块文本）。
 *
 * 防御与降噪：
 *   - 单块文本超过 20000 字符时跳过词级 diff，整块退化为单个 modify hunk；
 *   - 空行块作为整块多余块时块文本为空串，不产生空文本 hunk（词级配对的
 *     shrink 已保证不会给出双侧皆空的区间，此处口径对齐）。
 *
 * insert 锚点（leftAnchor，采纳新增批注时在源稿中的插入位置）：
 *   - 块级整块新增 = 变更运行区前最后一个等价块的 range.to（无前块则 0）；
 *   - 块内纯新增段 = 配对块 range.from（近似值，见代码注释）。
 */

import { parseDocument, type BlockNode } from '@jotluck/renderer';
import type { ReviewHunk, ReviewRange } from './review-types';
import { diffSequences, diffWordPaired, type WordDiffSpan } from './review-worddiff';

/** 单块文本超过该长度时跳过词级 diff（防超大块拖垮交互延迟） */
const WORD_DIFF_BLOCK_TEXT_LIMIT = 20000;

/** 块文本 = 块区间源码切片 */
function blockTextOf(doc: string, block: BlockNode): string {
  return doc.slice(block.range.from, block.range.to);
}

/** 块内相对偏移区间 → 全文偏移区间（+ 块起点） */
function toDocRange(blockFrom: number, span: WordDiffSpan): ReviewRange {
  return { from: blockFrom + span.from, to: blockFrom + span.to };
}

export function computeReviewDiff(source: string, working: string): ReviewHunk[] {
  // 全等快速路径：免解析直接返回（每次全量重算，无跨版本状态）
  if (source === working) return [];

  const leftBlocks = parseDocument(source).blocks;
  const rightBlocks = parseDocument(working).blocks;
  const leftTexts = leftBlocks.map((block) => blockTextOf(source, block));
  const rightTexts = rightBlocks.map((block) => blockTextOf(working, block));

  // 块文本序列对齐：等价段跳过，只有变更运行区进入 hunk 构造
  const segments = diffSequences(leftTexts, rightTexts, (text) => text);

  // 精确匹配预消解：同一文本的被删块与被插块互相抵消（内容上无差异，至多
  // 是位置变化）。否则 dmp 在「删一段 + 隔行加一段」的并列增删场景会按最小
  // 编辑距离把同文本块拆进相邻运行区，经按位配对产生两组假 modify（把真实
  // 的 delete/insert 对成了「旧段→相同文本段」「相同文本段→新段」）。贪婪
  // 匹配按文本精确相等；空白块不参与；被消解的下标两侧都跳过，不产生 hunk
  //（位置漂移对词级批注不可见，且不影响剩余 hunk 各自侧内的全序）。
  const cancelledLeft = new Set<number>();
  const cancelledRight = new Set<number>();
  {
    const pool = new Map<string, number[]>();
    for (const seg of segments) {
      if (seg.op !== -1) continue;
      for (let i = seg.aFrom; i < seg.aTo; i++) {
        const text = leftTexts[i]!;
        if (text === '') continue;
        const queue = pool.get(text);
        if (queue) queue.push(i);
        else pool.set(text, [i]);
      }
    }
    for (const seg of segments) {
      if (seg.op !== 1) continue;
      for (let j = seg.bFrom; j < seg.bTo; j++) {
        const queue = pool.get(rightTexts[j]!);
        if (queue && queue.length > 0) {
          cancelledLeft.add(queue.shift()!);
          cancelledRight.add(j);
        }
      }
    }
  }

  const hunks: ReviewHunk[] = [];
  const pushHunk = (hunk: Omit<ReviewHunk, 'id'>): void => {
    hunks.push({ id: `hunk-${hunks.length + 1}`, ...hunk });
  };

  // 变更运行区累计：连续 delete/insert 段的两侧块下标（各自按文档序）
  let regionLeft: number[] = [];
  let regionRight: number[] = [];
  // 最近一个等价段末块的 range.to（文档开头无等价块时为 0）→ 新区运行区的插入锚点
  let lastEqualLeftTo = 0;
  let regionAnchor = 0;

  /** 输出一个变更运行区：先配对块（词级），再多出的整块 delete/insert */
  const emitRegion = (): void => {
    const pairCount = Math.min(regionLeft.length, regionRight.length);
    for (let i = 0; i < pairCount; i++) {
      const li = regionLeft[i]!;
      const ri = regionRight[i]!;
      const leftBlock = leftBlocks[li]!;
      const rightBlock = rightBlocks[ri]!;
      const leftBlockText = leftTexts[li]!;
      const rightBlockText = rightTexts[ri]!;
      // 性能防御：超大块不做词级 diff，整块视为一处 modify
      if (
        leftBlockText.length > WORD_DIFF_BLOCK_TEXT_LIMIT ||
        rightBlockText.length > WORD_DIFF_BLOCK_TEXT_LIMIT
      ) {
        pushHunk({
          type: 'modify',
          leftRange: { ...leftBlock.range },
          rightRange: { ...rightBlock.range },
          leftText: leftBlockText,
          rightText: rightBlockText,
        });
        continue;
      }
      for (const pair of diffWordPaired(leftBlockText, rightBlockText)) {
        const { left: leftSpan, right: rightSpan } = pair;
        if (!leftSpan && !rightSpan) continue;
        const type: ReviewHunk['type'] =
          leftSpan && rightSpan ? 'modify' : leftSpan ? 'delete' : 'insert';
        pushHunk({
          type,
          ...(leftSpan ? { leftRange: toDocRange(leftBlock.range.from, leftSpan) } : {}),
          ...(rightSpan ? { rightRange: toDocRange(rightBlock.range.from, rightSpan) } : {}),
          // 块内纯新增段的锚点：diffWordPaired 的配对结果不携带左块 token 对齐
          // 下标（段级 aFrom），精确插入点拿不到，此处退化为配对块起点（近似值，
          // 恒落在块区间内）；后续 review-worddiff 暴露段信息时再升级为精确锚点。
          ...(type === 'insert' ? { leftAnchor: leftBlock.range.from } : {}),
          leftText: leftSpan ? leftBlockText.slice(leftSpan.from, leftSpan.to) : '',
          rightText: rightSpan ? rightBlockText.slice(rightSpan.from, rightSpan.to) : '',
        });
      }
    }
    // 多余被删块：整块 delete（空行块无可见内容，跳过以免空文本噪声）
    for (let i = pairCount; i < regionLeft.length; i++) {
      const li = regionLeft[i]!;
      const text = leftTexts[li]!;
      if (text === '') continue;
      pushHunk({
        type: 'delete',
        leftRange: { ...leftBlocks[li]!.range },
        leftText: text,
        rightText: '',
      });
    }
    // 多余被插入块：整块 insert（同样跳过空行块）。锚点 = 运行区前最后
    // 一个等价块的 range.to（文档开头新增时无前块 → 0）。
    for (let i = pairCount; i < regionRight.length; i++) {
      const ri = regionRight[i]!;
      const text = rightTexts[ri]!;
      if (text === '') continue;
      pushHunk({
        type: 'insert',
        rightRange: { ...rightBlocks[ri]!.range },
        leftAnchor: regionAnchor,
        // 块级新增：采纳时需补足块间空行分隔（见 review-session-store）
        blockLevelInsert: true,
        leftText: '',
        rightText: text,
      });
    }
    regionLeft = [];
    regionRight = [];
  };

  for (const segment of segments) {
    if (segment.op === 0) {
      emitRegion();
      lastEqualLeftTo = leftBlocks[segment.aTo - 1]!.range.to;
      continue;
    }
    // 运行区首个变更段到达时定格锚点（此后 lastEqualLeftTo 只在区间的
    // 等价段上推进，不会污染本区取值）
    if (regionLeft.length === 0 && regionRight.length === 0) regionAnchor = lastEqualLeftTo;
    if (segment.op === -1) {
      for (let i = segment.aFrom; i < segment.aTo; i++) {
        if (!cancelledLeft.has(i)) regionLeft.push(i);
      }
    } else {
      for (let j = segment.bFrom; j < segment.bTo; j++) {
        if (!cancelledRight.has(j)) regionRight.push(j);
      }
    }
  }
  emitRegion();

  return hunks;
}
