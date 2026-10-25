// 与 useReviewSession.test.ts 的 mock 驱动互补：本文件走真实 computeReviewDiff +
// 真实 review-session-store 应用逻辑，钉「采纳全部后重算 diff 收敛（0 hunks）」
// 的端到端承诺（终审 W1：混合变更运行区的整块新增锚点场景）。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useReviewSession } from '../useReviewSession';
import type { ReviewAdoptResult } from '../useReviewSession';
import type { IFileSystemService } from '@/types/file-system';

const REVISION = 'sha256:aaa';

function createFsMock(): { fs: IFileSystemService; write: ReturnType<typeof vi.fn> } {
  const write = vi.fn().mockResolvedValue({ status: 'saved', revision: 'sha256:bulk' });
  return {
    write,
    fs: {
      writeFileIfUnchanged: write,
      readFileSnapshot: vi.fn(),
      writeFile: vi.fn(),
      listDirectory: vi.fn(),
    } as unknown as IFileSystemService,
  };
}

/**
 * 全流程断言：以真实 diff 引擎驱动 adoptAll，写盘内容逐字节 = 工作稿，
 * 且采纳后的会话 hunks 收敛为空（重算 0 hunks，无幻影批注）。
 */
async function adoptAllConverges(source: string, working: string): Promise<void> {
  const { fs, write } = createFsMock();
  const session = useReviewSession({
    fs,
    root: 'rootA',
    path: 'notes/x.md',
    initialSnapshot: { content: source, revision: REVISION },
  });
  session.workingText.value = working;

  const result: ReviewAdoptResult = await session.adoptAll();
  expect(result).toEqual({ ok: true, revision: 'sha256:bulk' });
  expect(write).toHaveBeenCalledTimes(1);
  // 逐字节还原工作稿：锚点错位/分隔失真都会在这里露馅
  expect(write).toHaveBeenCalledWith('notes/x.md', working, REVISION);
  expect(session.sourceText.value).toBe(working);
  // 收敛：采纳后（源稿 = 工作稿）重算 diff 为 0 hunks
  expect(session.hunks.value).toEqual([]);
  session.dispose();
}

describe('useReviewSession adoptAll 收敛（真实 diff 引擎）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('混合运行区：改一段+加一段 → 一次写盘逐字节还原工作稿且 hunks 清空', async () => {
    // 终审 W1 场景：整块新增若锚在运行区起点（而非末配对块 range.to），
    // 新块会插到被改块之前，与工作稿顺序相悖 → 重算产生幻影批注不收敛
    await adoptAllConverges('甲段落\n\n末段落', '乙段落\n\n新增段落\n\n末段落');
  });

  it('混合运行区（前有等价块）：锚点取末配对块而非区前等价块', async () => {
    await adoptAllConverges('前段落\n\n甲段落\n\n末段落', '前段落\n\n乙段落\n\n新增段落\n\n末段落');
  });

  it('混合运行区同锚双整块新增：拼接为一次插入，段落顺序不颠倒', async () => {
    // 末配对块后跟两个多余新增块 → 同锚（末配对块 range.to）run，
    // 必须经 mergeSameAnchorInserts 按原文档序拼接，逐个裸插会倒序
    await adoptAllConverges('甲段落\n\n末段落', '乙段落\n\n新1段\n\n新2段\n\n末段落');
  });

  it('混合运行区：块内词级新增（段尾）与整块新增同锚合并插入', async () => {
    // 配对块尾词级新增（A段落→A段落!）的精确锚点 = 块尾，与整块新增锚点
    // 重合 → 同组 run 以工作稿真实间隙（'\n\n'）拼接，裸插逐字节还原
    await adoptAllConverges('A段落\n\n末段落', 'A段落!\n\n新增段落\n\n末段落');
  });

  it('逐条 adopt（先整块新增后改段）：两条写盘后同样收敛', async () => {
    const source = '甲段落\n\n末段落';
    const working = '乙段落\n\n新增段落\n\n末段落';
    const { fs, write } = createFsMock();
    const session = useReviewSession({
      fs,
      root: 'rootA',
      path: 'notes/x.md',
      initialSnapshot: { content: source, revision: REVISION },
    });
    session.workingText.value = working;
    session.computeNow(); // 冲刷防抖：初始 diff 在 setup 时以源稿算过一次
    expect(session.hunks.value.map((h) => h.type)).toEqual(['modify', 'insert']);

    // 先采纳整块新增：锚点错位（区首）会得到「新增段落在甲段落之前」的源稿
    const insertHunk = session.hunks.value.find((h) => h.type === 'insert')!;
    const first: ReviewAdoptResult = await session.adopt(insertHunk);
    expect(first.ok).toBe(true);
    expect(write).toHaveBeenCalledWith('notes/x.md', '甲段落\n\n新增段落\n\n末段落', REVISION);

    // 再采纳改段：终态 = 工作稿，hunks 收敛清空。首次写盘成功后基线已
    // 前移为 mock 返回的 'sha256:bulk'，第二次乐观并发写携带新基线（而非
    // 初始 REVISION）
    const modifyHunk = session.hunks.value.find((h) => h.type === 'modify')!;
    const second: ReviewAdoptResult = await session.adopt(modifyHunk);
    expect(second.ok).toBe(true);
    expect(write).toHaveBeenLastCalledWith('notes/x.md', working, 'sha256:bulk');
    expect(session.sourceRevision.value).toBe('sha256:bulk');
    expect(session.sourceText.value).toBe(working);
    expect(session.hunks.value).toEqual([]);
    session.dispose();
  });
});
