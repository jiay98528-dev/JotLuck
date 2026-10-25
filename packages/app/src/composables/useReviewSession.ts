/**
 * useReviewSession — 改稿（审批/批注）模式会话状态编排
 *
 * 职责：
 *  - 进入会话时按 localStorage 暂存恢复工作稿（sourceRevision 匹配才采纳；
 *    不匹配说明源稿已被外部改动，丢弃暂存、以源稿为工作稿起点）；
 *  - workingText 变更 → 防抖重算 hunks（computeReviewDiff）；
 *  - adopt(hunk)：批准 → 乐观并发写回源稿（writeFileIfUnchanged），
 *    conflict 时由调用方弹「以最新源稿重开」对话框并 rebaseSource；
 *  - discard(hunk)：丢弃 → 工作稿该处回滚为源稿原文（单事务替换由组件层
 *    经 MarkdownEditor 的 model-value 同步机制完成）；
 *  - adoptAll()/discardAll()：批量裁决——全部 hunk 内存降序合并后一次写盘
 *    / 工作稿整体回滚为源稿，均只做一次 computeNow + persistNow；
 *  - 裁决入口（adopt/adoptAll/discard/discardAll）统一先冲刷待算 diff：
 *    防抖窗口内的编辑不得用陈旧 hunk 坐标裁决（会静默改坏）；
 *  - adoptAll 同锚点多处 insert 按原文档序拼接为一次插入（裸插会倒序）；
 *  - workingText 防抖 800ms 暂存 localStorage。
 */

import { getCurrentInstance, onUnmounted, ref, watch } from 'vue';
import type { Ref } from 'vue';
import type { ReviewHunk, ReviewRange } from '@/utils/review-types';
import type { IFileSystemService } from '@/types/file-system';
import { computeReviewDiff } from '@/utils/review-diff';
import {
  applyHunkToSource,
  clearReviewSession,
  loadReviewSession,
  mapRightPositionToLeft,
  revertHunkInWorking,
  saveReviewSession,
} from '@/services/review-session-store';

/** adopt 结果：成功 / 外部修改冲突 / IO 错误 */
export type ReviewAdoptResult =
  | { ok: true; revision: string }
  | { ok: false; reason: 'conflict'; actualRevision: string | null }
  | { ok: false; reason: 'io'; message: string };

export interface UseReviewSessionOptions {
  fs: IFileSystemService;
  root: string;
  path: string;
  /** 会话开始时的源稿快照（content + revision，来自 TextFileSnapshot） */
  initialSnapshot: { content: string; revision: string };
  /** workingText 变更 → 重算 hunks 的防抖毫秒数，默认 400 */
  diffDebounceMs?: number;
  /** workingText → localStorage 暂存的防抖毫秒数，默认 800 */
  persistDebounceMs?: number;
}

function rangeEquals(a: ReviewRange | undefined, b: ReviewRange | undefined): boolean {
  if ((a === undefined) !== (b === undefined)) return false;
  if (a === undefined || b === undefined) return true;
  return a.from === b.from && a.to === b.to;
}

/**
 * hunk 集合结构等价比较（纯函数，供 recomputeHunks 引用稳定化与单测使用）。
 * 注意 leftRange/rightRange 必须字段级深比较（from/to 数值逐一相等）：computeReviewDiff
 * 每轮返回全新嵌套对象（review-diff.ts 的 { ...range } 展开 toDocRange 新字面量），
 * 引用 === 会使等价集合永远判不等、稳定化形同虚设。
 */
export function reviewHunksEqual(a: readonly ReviewHunk[], b: readonly ReviewHunk[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.id !== y.id || x.type !== y.type) return false;
    if ((x.leftAnchor ?? null) !== (y.leftAnchor ?? null)) return false;
    if ((x.blockLevelInsert ?? false) !== (y.blockLevelInsert ?? false)) return false;
    if ((x.blockLevelDelete ?? false) !== (y.blockLevelDelete ?? false)) return false;
    if (x.leftText !== y.leftText || x.rightText !== y.rightText) return false;
    if (!rangeEquals(x.leftRange, y.leftRange) || !rangeEquals(x.rightRange, y.rightRange)) {
      return false;
    }
  }
  return true;
}

/**
 * 冲刷重算后，在最新 hunks 中重定位调用方传入的批注对象。
 * 调用方（批注面板/工作台）持有的 hunk 来自冲刷前的渲染轮次；编辑只动
 * workingText，源稿侧字段（leftRange/leftAnchor/两侧文本）在重算间稳定，
 * 据此优先匹配最新对象以拿到随编辑推进的工作稿坐标（rightRange）。
 * 源稿键未命中（批注本身被用户新输入改写，如改动段内追打文字并入同一
 * 批注）时按区间重叠度定位同类最新批注——裁决必须落在最新批注上才收敛，
 * 陈旧坐标裁决会静默改坏且产生幻影批注；无任何重叠则原样返回兜底。
 */
export function resolveFreshHunk(hunk: ReviewHunk, current: readonly ReviewHunk[]): ReviewHunk {
  if (current.includes(hunk)) return hunk;
  const sameSourceKey = (h: ReviewHunk): boolean =>
    h.type === hunk.type &&
    h.leftText === hunk.leftText &&
    h.rightText === hunk.rightText &&
    rangeEquals(h.leftRange, hunk.leftRange) &&
    (h.leftAnchor ?? null) === (hunk.leftAnchor ?? null) &&
    (h.blockLevelInsert ?? false) === (hunk.blockLevelInsert ?? false) &&
    (h.blockLevelDelete ?? false) === (hunk.blockLevelDelete ?? false);
  const byKey = current.find(sameSourceKey);
  if (byKey) return byKey;
  // 重叠度兜底：modify/insert 用工作稿区间（rightRange），delete 无工作稿
  // 区间时退回源稿区间（leftRange，两侧同为源稿坐标空间）。坐标随编辑
  // 漂移下重叠只是近似，但此路径仅在批注文本已被改写时触达
  const spanFrom = hunk.rightRange?.from ?? hunk.leftRange?.from;
  const spanTo = hunk.rightRange?.to ?? hunk.leftRange?.to;
  if (spanFrom === undefined || spanTo === undefined) return hunk;
  let best: ReviewHunk | undefined;
  let bestOverlap = 0;
  for (const h of current) {
    if (h.type !== hunk.type) continue;
    const range = h.rightRange ?? h.leftRange;
    if (!range) continue;
    const overlap = Math.min(spanTo, range.to) - Math.max(spanFrom, range.from);
    if (overlap > bestOverlap) {
      best = h;
      bestOverlap = overlap;
    }
  }
  return best ?? hunk;
}

/**
 * 同锚点 insert 运行（原文档序）→ 一次拼接插入的合成 hunk。
 * rightText = 各成员 rightText 以工作稿真实间隙（相邻 rightRange 之间的
 * 字节，保留块间空行/列表单换行等原始形态）拼接；blockLevelInsert 仅当
 * 全部成员为块级新增时保留。逐个裸插在降序应用下后应用者排前（段落静默
 * 倒序）且块间分隔失真（粘连 → 幻影批注不收敛），故必须拼接为一次插入。
 */
export function mergeSameAnchorInserts(
  run: readonly ReviewHunk[],
  anchor: number,
  working: string,
): ReviewHunk {
  if (run.length === 1) return run[0]!;
  let rightText = '';
  for (let i = 0; i < run.length; i++) {
    if (i > 0) {
      const prev = run[i - 1]!;
      const cur = run[i]!;
      // 成员缺 rightRange（防御式）：无间隙可取，直接顺序裸拼
      if (prev.rightRange && cur.rightRange) {
        rightText += working.slice(prev.rightRange.to, cur.rightRange.from);
      }
    }
    rightText += run[i]!.rightText;
  }
  const first = run[0]!;
  const last = run[run.length - 1]!;
  return {
    id: run.map((h) => h.id).join('+'),
    type: 'insert',
    ...(first.rightRange && last.rightRange
      ? { rightRange: { from: first.rightRange.from, to: last.rightRange.to } }
      : {}),
    ...(anchor >= 0 ? { leftAnchor: anchor } : {}),
    ...(run.every((h) => h.blockLevelInsert === true) ? { blockLevelInsert: true } : {}),
    leftText: '',
    rightText,
  };
}

export function useReviewSession(options: UseReviewSessionOptions) {
  const { fs, root, path, initialSnapshot } = options;
  const diffDebounceMs = options.diffDebounceMs ?? 400;
  const persistDebounceMs = options.persistDebounceMs ?? 800;

  const sourceText = ref(initialSnapshot.content);
  const sourceRevision = ref(initialSnapshot.revision);
  const workingText = ref(initialSnapshot.content);
  const hunks: Ref<ReviewHunk[]> = ref([]);
  /** true = 有一次重算已排期/进行中（防抖窗口内）；同步重算完成后回 false */
  const diffComputing = ref(false);
  /** 本次会话是否从暂存恢复了未完成的工作稿 */
  const restoredFromDraft = ref(false);

  // ── 进入会话：暂存恢复（revision 匹配才可用） ──
  const snapshot = loadReviewSession(root, path);
  if (
    snapshot &&
    snapshot.sourceRevision === initialSnapshot.revision &&
    snapshot.workingText !== initialSnapshot.content
  ) {
    workingText.value = snapshot.workingText;
    restoredFromDraft.value = true;
  } else if (snapshot) {
    // 基线已变（源稿被外部修改）：旧暂存对应不存在的基线，直接丢弃
    clearReviewSession(root, path);
  }

  // ── hunks 重算 ──
  let diffTimer: ReturnType<typeof setTimeout> | null = null;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  function recomputeHunks(): void {
    diffComputing.value = true;
    try {
      const next = computeReviewDiff(sourceText.value, workingText.value);
      // 引用稳定化：结构等价则保持 hunks.value 原引用（跳过赋值），下游
      // computed（左右马克笔、渲染 HTML、annotate 签名）缓存不失效；不等价
      // 才整体替换。computeReviewDiff 每轮全新嵌套对象，等价判定见
      // reviewHunksEqual 的字段级深比较。
      if (!reviewHunksEqual(hunks.value, next)) hunks.value = next;
    } catch {
      if (hunks.value.length > 0) hunks.value = []; // diff 内部异常：降级为「无批注」，不阻断编辑
    } finally {
      diffComputing.value = false;
    }
  }

  function scheduleDiff(): void {
    if (diffTimer !== null) clearTimeout(diffTimer);
    diffComputing.value = true;
    diffTimer = setTimeout(() => {
      diffTimer = null;
      recomputeHunks();
    }, diffDebounceMs);
  }

  /**
   * 立即重算（跳过防抖）。V1 口径：聚焦块即时重算的入口已预留，
   * 现阶段仅在 adopt/discard/rebase 后内部调用；编辑路径仍走 400ms 防抖，
   * 聚焦块本身在即时渲染态显示源码（绿标由 reviewMarks 覆盖），不依赖即时 hunks。
   */
  function computeNow(): void {
    if (diffTimer !== null) {
      clearTimeout(diffTimer);
      diffTimer = null;
    }
    recomputeHunks();
  }

  // ── 暂存 ──
  function persistNow(): void {
    if (persistTimer !== null) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    if (workingText.value === sourceText.value) {
      clearReviewSession(root, path); // 工作稿与源稿一致：无需暂存
      return;
    }
    saveReviewSession(root, path, {
      sourceRevision: sourceRevision.value,
      workingText: workingText.value,
      savedAt: Date.now(),
    });
  }

  function schedulePersist(): void {
    if (persistTimer !== null) clearTimeout(persistTimer);
    persistTimer = setTimeout(persistNow, persistDebounceMs);
  }

  watch(workingText, () => {
    scheduleDiff();
    schedulePersist();
  });

  // 初始 diff：同步算一次（无防抖），保证首屏批注面板/马克笔可用
  recomputeHunks();

  // ── 批准 / 丢弃 / 重开 ──

  /** 批准一处批注：写入源稿文件（乐观并发写）。冲突/IO 错误不改变本地状态。 */
  async function adopt(hunk: ReviewHunk): Promise<ReviewAdoptResult> {
    // 裁决入口先冲刷待算 diff：防抖窗口内的编辑不得用陈旧 hunk 坐标裁决
    //（insert 锚点的全集位移反推尤其敏感），冲刷后重定位到最新 hunks
    computeNow();
    const fresh = resolveFreshHunk(hunk, hunks.value);
    const newSource = applyHunkToSource(sourceText.value, fresh, hunks.value);
    try {
      const result = await fs.writeFileIfUnchanged(path, newSource, sourceRevision.value);
      if (result.status === 'conflict') {
        return { ok: false, reason: 'conflict', actualRevision: result.actualRevision };
      }
      sourceText.value = newSource;
      sourceRevision.value = result.revision;
      computeNow();
      persistNow(); // 基线里程碑：立即暂存（而非防抖）
      return { ok: true, revision: result.revision };
    } catch (error) {
      return {
        ok: false,
        reason: 'io',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 丢弃一处批注：工作稿该处回滚为源稿原文，返回新工作稿全文。
   * 单事务替换由组件层完成：workingText ref 变化 → MarkdownEditor 的
   * model-value watch 一次性 dispatch 全文替换（既有同步机制）。
   */
  function discard(hunk: ReviewHunk): string {
    // 同 adopt：先冲刷重算并重定位——rightRange（工作稿坐标）会随编辑漂移，
    // 直接用陈旧区间替换会静默改坏工作稿
    computeNow();
    const fresh = resolveFreshHunk(hunk, hunks.value);
    const next = revertHunkInWorking(workingText.value, fresh, hunks.value);
    workingText.value = next;
    computeNow();
    schedulePersist();
    return next;
  }

  /**
   * 批准全部批注：全部 hunk 在内存按源稿锚点降序（从右向左）合并后一次
   * writeFileIfUnchanged 落盘——N 处批注只写一次文件、一次 computeNow +
   * persistNow（禁止逐条循环 adopt 的 N 次写盘）。降序应用使左侧 hunk 的
   * 源稿坐标不因右侧改动漂移；hunks 互不重叠时合并终态与逐条 adopt 等价。
   * 同锚点多处 insert（同一变更运行区的多个整块新增）按原文档序拼接为
   * 一次插入——降序逐个裸插会后应用者排前（段落静默倒序）且块间分隔失真。
   * 冲突/IO 语义与单条 adopt 一致；applyHunkToSource 缺坐标抛错同样向上传播。
   */
  async function adoptAll(): Promise<ReviewAdoptResult> {
    // 裁决入口先冲刷（同 adopt）：以最新 hunks 的坐标合并
    computeNow();
    // 源稿锚点排序键：leftRange 优先；insert 缺左区间时按全集位移从
    // rightRange 反推（与 applyHunkToSource 内的锚点推算同口径）
    const anchorOf = (hunk: ReviewHunk): number | null =>
      hunk.leftRange?.from ??
      hunk.leftAnchor ??
      (hunk.rightRange ? mapRightPositionToLeft(hunk.rightRange.from, hunks.value) : null);
    // 降序（从右向左）应用；同锚点细分：区间类（modify/delete）先于 insert
    //（先插文本会使区间类的源稿坐标漂移），同锚 insert 按原文档序排列
    const sorted = [...hunks.value].sort((a, b) => {
      const anchorDiff = (anchorOf(b) ?? -1) - (anchorOf(a) ?? -1);
      if (anchorDiff !== 0) return anchorDiff;
      const rank = (h: ReviewHunk): number => (h.type === 'insert' ? 1 : 0);
      const rankDiff = rank(a) - rank(b);
      if (rankDiff !== 0) return rankDiff;
      return (a.rightRange?.from ?? 0) - (b.rightRange?.from ?? 0);
    });
    let newSource = sourceText.value;
    let i = 0;
    while (i < sorted.length) {
      // 同锚点分组处理（排序后同锚点连续）
      const anchor = anchorOf(sorted[i]!) ?? -1;
      let j = i;
      while (j < sorted.length && (anchorOf(sorted[j]!) ?? -1) === anchor) j++;
      const group = sorted.slice(i, j);
      // 区间类先应用（源稿区间互不重叠，同锚至多一个）
      for (const hunk of group) {
        if (hunk.type !== 'insert') newSource = applyHunkToSource(newSource, hunk, hunks.value);
      }
      // 同锚 insert 切分为「原文档序相邻且间隙纯空白」的运行；间隙含正文
      //（罕见，如中间夹了被精确消解的等价块）不合并。多运行倒序应用：
      // 同锚后应用者排前，倒序使原文档序得以保持
      const runs: ReviewHunk[][] = [];
      for (const hunk of group) {
        if (hunk.type !== 'insert') continue;
        const prevRun = runs[runs.length - 1];
        const prev = prevRun?.[prevRun.length - 1];
        const gap =
          prev && prev.rightRange && hunk.rightRange
            ? workingText.value.slice(prev.rightRange.to, hunk.rightRange.from)
            : '';
        if (prevRun && prev && /^\s*$/.test(gap)) prevRun.push(hunk);
        else runs.push([hunk]);
      }
      for (const run of runs.reverse()) {
        newSource = applyHunkToSource(
          newSource,
          mergeSameAnchorInserts(run, anchor, workingText.value),
          hunks.value,
        );
      }
      i = j;
    }
    try {
      const result = await fs.writeFileIfUnchanged(path, newSource, sourceRevision.value);
      if (result.status === 'conflict') {
        return { ok: false, reason: 'conflict', actualRevision: result.actualRevision };
      }
      sourceText.value = newSource;
      sourceRevision.value = result.revision;
      computeNow();
      persistNow(); // 基线里程碑：立即暂存（而非防抖）
      return { ok: true, revision: result.revision };
    } catch (error) {
      return {
        ok: false,
        reason: 'io',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 丢弃全部批注：工作稿整体回滚为源稿（全部改动一次撤销，不经逐条
   * revert），入口冲刷 + 回滚后各一次 computeNow、一次 persistNow；回滚后
   * 工作稿与源稿一致，persistNow 会顺带清除 localStorage 暂存。
   */
  function discardAll(): string {
    // 裁决入口统一先冲刷：整体回滚虽不依赖 hunk 坐标，保持四个入口契约一致
    computeNow();
    workingText.value = sourceText.value;
    computeNow();
    persistNow();
    return workingText.value;
  }

  /** 冲突后以最新源稿重开：重设基线、保留工作稿、重算批注。 */
  function rebaseSource(newSnapshot: { content: string; revision: string }): void {
    sourceText.value = newSnapshot.content;
    sourceRevision.value = newSnapshot.revision;
    computeNow();
    schedulePersist();
  }

  /** 退出会话：清 diff 计时器并冲刷暂存（退出确认文案承诺「进度已自动暂存」） */
  function dispose(): void {
    if (diffTimer !== null) {
      clearTimeout(diffTimer);
      diffTimer = null;
    }
    persistNow();
    diffComputing.value = false;
  }

  if (getCurrentInstance()) onUnmounted(dispose);

  return {
    sourceText,
    sourceRevision,
    workingText,
    hunks,
    diffComputing,
    restoredFromDraft,
    computeNow,
    adopt,
    discard,
    adoptAll,
    discardAll,
    rebaseSource,
    dispose,
  };
}
