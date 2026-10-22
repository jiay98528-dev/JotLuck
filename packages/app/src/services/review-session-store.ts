/**
 * review-session-store — 改稿（审批/批注）模式会话纯逻辑
 *
 * 三块职责（全部纯函数 / 无 Vue 依赖，可独立单测）：
 *  1. 会话暂存持久化：localStorage `jotluck:review:<root>:<path>`，
 *     值为 ReviewSessionSnapshot JSON；损坏值吞掉返回 null；
 *  2. hunk 应用/回滚：applyHunkToSource（批准 → 写入源稿）、
 *     revertHunkInWorking（丢弃 → 工作稿回滚为源稿原文）；
 *  3. hunk → 源码态马克笔映射：leftMarksFromHunks（左栏红笔）、
 *     rightMarksFromHunks（右栏绿笔）。
 *
 * 坐标约定（见 review-types.ts）：所有区间为所在文档全文的 UTF-16 半开区间。
 * cross 侧定位（insert 的源稿锚点 / delete 的工作稿锚点）在 hunk 自身缺坐标时，
 * 用 hunk 全集的累计位移推算（mapRightPositionToLeft / mapLeftPositionToWorking）。
 */

import type { ReviewHunk, ReviewSessionSnapshot } from '@/utils/review-types';
import type { ReviewMarkRange } from '@/utils/review-marks';

// ---- 持久化 ----

/** 暂存 key：jotluck:review:<root>:<path>（与 NotebookHome 草稿暂存同一命名族） */
export function reviewSessionStorageKey(root: string, path: string): string {
  return `jotluck:review:${root}:${path}`;
}

function isReviewSessionSnapshot(value: unknown): value is ReviewSessionSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const snap = value as Partial<ReviewSessionSnapshot>;
  return (
    typeof snap.sourceRevision === 'string' &&
    typeof snap.workingText === 'string' &&
    typeof snap.savedAt === 'number' &&
    Number.isFinite(snap.savedAt)
  );
}

/** 读取暂存：缺失 / JSON 损坏 / 结构不符 → null（不抛错） */
export function loadReviewSession(root: string, path: string): ReviewSessionSnapshot | null {
  try {
    const raw = localStorage.getItem(reviewSessionStorageKey(root, path));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isReviewSessionSnapshot(parsed) ? parsed : null;
  } catch (error) {
    // 产品决策保持：损坏值吞掉——改稿会话可丢，不可阻断打开；仅补可观测性（不弹 toast）
    // eslint-disable-next-line no-console
    console.warn('[review-session-store] discard corrupt snapshot', root, path, error);
    return null;
  }
}

/** 写入暂存：配额满 / 序列化异常静默失败（暂存只是进度保险） */
export function saveReviewSession(
  root: string,
  path: string,
  snapshot: ReviewSessionSnapshot,
): void {
  try {
    localStorage.setItem(reviewSessionStorageKey(root, path), JSON.stringify(snapshot));
  } catch (error) {
    // 产品决策保持：静默降级——暂存失败不影响内存中的改稿进度；仅补可观测性（不弹 toast）
    // eslint-disable-next-line no-console
    console.warn('[review-session-store] persist snapshot failed', root, path, error);
  }
}

/** 清除暂存 */
export function clearReviewSession(root: string, path: string): void {
  try {
    localStorage.removeItem(reviewSessionStorageKey(root, path));
  } catch (error) {
    // 产品决策保持：静默降级——清除失败不阻断主流程；仅补可观测性（不弹 toast）
    // eslint-disable-next-line no-console
    console.warn('[review-session-store] clear snapshot failed', root, path, error);
  }
}

// ---- 坐标换算（cross 侧锚点推算） ----

/** hunk 左侧（源稿）锚点：leftRange.from；insert 无 leftRange 时读扩展字段 leftAnchor */
function hunkLeftStart(hunk: ReviewHunk): number | null {
  if (hunk.leftRange) return hunk.leftRange.from;
  // review-types 契约暂未包含 leftAnchor；S1 若补充该字段则优先采纳（防御式读取）
  const anchor = (hunk as { leftAnchor?: unknown }).leftAnchor;
  return typeof anchor === 'number' && Number.isFinite(anchor) ? anchor : null;
}

function hunkLeftLength(hunk: ReviewHunk): number {
  if (hunk.type === 'insert') return 0;
  return hunk.leftRange ? hunk.leftRange.to - hunk.leftRange.from : 0;
}

function hunkRightLength(hunk: ReviewHunk): number {
  if (hunk.type === 'delete') return 0;
  return hunk.rightRange ? hunk.rightRange.to - hunk.rightRange.from : 0;
}

/**
 * 左侧（源稿）坐标 → 右侧（工作稿）坐标：对起点严格早于 pos 的 hunk 累计
 * 位移（modify ±长度差、insert +新增长、delete -删除长）。
 * 起点等于 pos 的 hunk 不计入（pos 处于该改动边界，边界前位移已计）。
 */
export function mapLeftPositionToWorking(pos: number, hunks: readonly ReviewHunk[]): number {
  let delta = 0;
  for (const hunk of hunks) {
    const start = hunkLeftStart(hunk);
    if (start === null || start >= pos) continue;
    delta += hunkRightLength(hunk) - hunkLeftLength(hunk);
  }
  return pos + delta;
}

/**
 * 右侧（工作稿）坐标 → 左侧（源稿）坐标：mapLeftPositionToWorking 的逆运算。
 * 工作稿坐标 = 源稿坐标 + 累计位移，故源稿坐标 = 工作稿坐标 - 累计位移。
 */
export function mapRightPositionToLeft(pos: number, hunks: readonly ReviewHunk[]): number {
  let delta = 0;
  for (const hunk of hunks) {
    const start = hunk.rightRange ? hunk.rightRange.from : null;
    if (start === null || start >= pos) continue;
    delta += hunkRightLength(hunk) - hunkLeftLength(hunk);
  }
  return pos - delta;
}

/** 把位置钳进 [0, length] 并取整 */
function clampPos(pos: number, length: number): number {
  return Math.max(0, Math.min(length, Math.trunc(pos)));
}

/**
 * 块级插入的空行分隔补足：数锚点前已有的连续换行（上限 2），不足「空行
 * 分隔」（两个换行）的差额用 \n 补齐；锚点在文档首（at<=0）不需要前缀。
 */
function blockSeparatorBefore(source: string, at: number): string {
  if (at <= 0) return '';
  let newlines = 0;
  let i = at;
  while (i > 0 && source[i - 1] === '\n' && newlines < 2) {
    newlines++;
    i--;
  }
  if (newlines >= 2) return '';
  if (newlines === 1) return '\n';
  return '\n\n';
}

/** 同 blockSeparatorBefore，但看锚点之后跟随的文本（文首插入时后侧补分隔） */
function blockSeparatorAfter(source: string, at: number): string {
  const rest = source.slice(at);
  if (rest === '') return '';
  let newlines = 0;
  let i = 0;
  while (i < rest.length && rest[i] === '\n' && newlines < 2) {
    newlines++;
    i++;
  }
  if (newlines >= 2) return '';
  if (newlines === 1) return '\n';
  return '\n\n';
}

// ---- hunk 应用 / 回滚 ----

/**
 * 批准一处批注：把该 hunk 的改动写入源稿文本。
 *  - modify：leftRange 区间替换为 rightText；
 *  - delete：leftRange 区间替换为空（删除）；
 *  - insert：在 leftAnchor（或零宽 leftRange / 全集位移推算的锚点）插入 rightText。
 * 缺必要坐标（无法定位）抛 Error。
 *
 * @param allHunks 当前 diff 全集（insert 锚点推算用；缺省仅凭 hunk 自身坐标）
 */
export function applyHunkToSource(
  source: string,
  hunk: ReviewHunk,
  allHunks: readonly ReviewHunk[] = [hunk],
): string {
  if (hunk.type === 'insert') {
    let anchor = hunkLeftStart(hunk);
    if (anchor === null && hunk.rightRange) {
      anchor = mapRightPositionToLeft(hunk.rightRange.from, allHunks);
    }
    if (anchor === null) {
      throw new Error(`review hunk ${hunk.id} (insert) missing source anchor`);
    }
    const at = clampPos(anchor, source.length);
    // 块级新增只携带段内文字：按锚点前后相邻文本的换行情况补足空行分隔，
    // 否则采纳后与相邻段粘连成一段，重算 diff 会产生幻影批注（无法收敛）
    let insertion = hunk.rightText;
    if (hunk.blockLevelInsert) {
      insertion = blockSeparatorBefore(source, at) + insertion + blockSeparatorAfter(source, at);
    }
    return source.slice(0, at) + insertion + source.slice(at);
  }

  const range = hunk.leftRange;
  if (!range) {
    throw new Error(`review hunk ${hunk.id} (${hunk.type}) missing source range`);
  }
  // 倒置检查须在钳制之前：先钳制会把越界倒置（如 4→2 钳成 2→2）抹平漏检
  if (range.to < range.from) {
    throw new Error(`review hunk ${hunk.id} (${hunk.type}) inverted source range`);
  }
  const from = clampPos(range.from, source.length);
  const to = clampPos(range.to, source.length);
  return source.slice(0, from) + hunk.rightText + source.slice(to);
}

/**
 * 丢弃一处批注：把工作稿中该处回滚为源稿原文。
 *  - modify：rightRange 区间替换回 leftText；
 *  - insert：rightRange 区间替换回空（纯删除新增内容）；
 *  - delete：源稿被删文本不在工作稿中 → 在推算的工作稿锚点重新插入 leftText
 *    （优先 hunk.rightRange 起点；缺失时用全集位移从 leftRange.from 反推）。
 * 缺必要坐标抛 Error。
 *
 * @param allHunks 当前 diff 全集（delete 锚点推算用；缺省仅凭 hunk 自身坐标）
 */
export function revertHunkInWorking(
  working: string,
  hunk: ReviewHunk,
  allHunks: readonly ReviewHunk[] = [hunk],
): string {
  if (hunk.type === 'delete') {
    let anchor: number | null = hunk.rightRange
      ? Math.min(hunk.rightRange.from, hunk.rightRange.to)
      : null;
    if (anchor === null && hunk.leftRange) {
      anchor = mapLeftPositionToWorking(hunk.leftRange.from, allHunks);
    }
    if (anchor === null) {
      throw new Error(`review hunk ${hunk.id} (delete) missing working anchor`);
    }
    const at = clampPos(anchor, working.length);
    return working.slice(0, at) + hunk.leftText + working.slice(at);
  }

  const range = hunk.rightRange;
  if (!range) {
    throw new Error(`review hunk ${hunk.id} (${hunk.type}) missing working range`);
  }
  // 倒置检查须在钳制之前（同 applyHunkToSource）
  if (range.to < range.from) {
    throw new Error(`review hunk ${hunk.id} (${hunk.type}) inverted working range`);
  }
  const from = clampPos(range.from, working.length);
  const to = clampPos(range.to, working.length);
  return working.slice(0, from) + hunk.leftText + working.slice(to);
}

// ---- hunk → 源码态马克笔 ----

/**
 * 左栏（源稿）红笔：modify/delete 的 leftRange → side 'del'。
 * 基本钳制（负值归零、取整）+ 空区间过滤；文档长度侧钳制由 review-marks 字段兜底。
 */
export function leftMarksFromHunks(hunks: readonly ReviewHunk[]): ReviewMarkRange[] {
  const marks: ReviewMarkRange[] = [];
  for (const hunk of hunks) {
    if (hunk.type === 'insert') continue;
    const range = hunk.leftRange;
    if (!range) continue;
    const from = Math.max(0, Math.trunc(range.from));
    const to = Math.max(0, Math.trunc(range.to));
    if (from >= to) continue;
    marks.push({ from, to, side: 'del', kind: 'text' });
  }
  return marks;
}

/**
 * 右栏（工作稿）绿笔：modify/insert 的 rightRange → side 'add'。
 * 钳制与空区间过滤同 leftMarksFromHunks。
 */
export function rightMarksFromHunks(hunks: readonly ReviewHunk[]): ReviewMarkRange[] {
  const marks: ReviewMarkRange[] = [];
  for (const hunk of hunks) {
    if (hunk.type === 'delete') continue;
    const range = hunk.rightRange;
    if (!range) continue;
    const from = Math.max(0, Math.trunc(range.from));
    const to = Math.max(0, Math.trunc(range.to));
    if (from >= to) continue;
    marks.push({ from, to, side: 'add', kind: 'text' });
  }
  return marks;
}
