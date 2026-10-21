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
    if (x.leftText !== y.leftText || x.rightText !== y.rightText) return false;
    if (!rangeEquals(x.leftRange, y.leftRange) || !rangeEquals(x.rightRange, y.rightRange)) {
      return false;
    }
  }
  return true;
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
    const newSource = applyHunkToSource(sourceText.value, hunk, hunks.value);
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
    const next = revertHunkInWorking(workingText.value, hunk, hunks.value);
    workingText.value = next;
    computeNow();
    schedulePersist();
    return next;
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
    rebaseSource,
    dispose,
  };
}
