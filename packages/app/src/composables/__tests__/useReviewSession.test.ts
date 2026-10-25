import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

// computeReviewDiff 属并行工单（S1）；composable 单测以 mock 驱动，不依赖其实现
const computeReviewDiffMock = vi.hoisted(() => vi.fn());
vi.mock('@/utils/review-diff', () => ({ computeReviewDiff: computeReviewDiffMock }));

import {
  mergeSameAnchorInserts,
  resolveFreshHunk,
  reviewHunksEqual,
  useReviewSession,
} from '../useReviewSession';
import type { ReviewAdoptResult } from '../useReviewSession';
import type { IFileSystemService } from '@/types/file-system';
import type { ReviewHunk } from '@/utils/review-types';
import { loadReviewSession, reviewSessionStorageKey } from '@/services/review-session-store';

function createFsMock(
  writeFileIfUnchanged: IFileSystemService['writeFileIfUnchanged'] = vi.fn(),
): IFileSystemService {
  return {
    writeFileIfUnchanged,
    readFileSnapshot: vi.fn(),
    writeFile: vi.fn(),
    listDirectory: vi.fn(),
  } as unknown as IFileSystemService;
}

function makeHunk(partial: Partial<ReviewHunk> & Pick<ReviewHunk, 'id'>): ReviewHunk {
  return { type: 'modify', leftText: '', rightText: '', ...partial };
}

const MODIFY_HUNK = makeHunk({
  id: 'm1',
  type: 'modify',
  leftRange: { from: 0, to: 5 },
  rightRange: { from: 0, to: 5 },
  leftText: 'Hello',
  rightText: 'Hallo',
});

const DELETE_HUNK = makeHunk({
  id: 'd1',
  type: 'delete',
  leftRange: { from: 6, to: 11 },
  leftText: 'World',
  rightText: '',
});

const SOURCE = 'Hello World';
const REVISION = 'sha256:aaa';

describe('useReviewSession 进入会话（暂存恢复）', () => {
  beforeEach(() => {
    localStorage.clear();
    computeReviewDiffMock.mockReset();
    computeReviewDiffMock.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('无暂存：workingText = 源稿，初始 diff 同步计算一次', () => {
    const session = useReviewSession({
      fs: createFsMock(),
      root: 'rootA',
      path: 'notes/x.md',
      initialSnapshot: { content: SOURCE, revision: REVISION },
    });
    expect(session.workingText.value).toBe(SOURCE);
    expect(session.restoredFromDraft.value).toBe(false);
    expect(computeReviewDiffMock).toHaveBeenCalledTimes(1);
    expect(computeReviewDiffMock).toHaveBeenCalledWith(SOURCE, SOURCE);
  });

  it('revision 匹配的暂存：恢复 workingText 并以恢复稿计算 diff', () => {
    localStorage.setItem(
      reviewSessionStorageKey('rootA', 'notes/x.md'),
      JSON.stringify({ sourceRevision: REVISION, workingText: 'Hallo Welt', savedAt: 1 }),
    );
    const session = useReviewSession({
      fs: createFsMock(),
      root: 'rootA',
      path: 'notes/x.md',
      initialSnapshot: { content: SOURCE, revision: REVISION },
    });
    expect(session.workingText.value).toBe('Hallo Welt');
    expect(session.restoredFromDraft.value).toBe(true);
    expect(computeReviewDiffMock).toHaveBeenCalledWith(SOURCE, 'Hallo Welt');
  });

  it('revision 不匹配的暂存：丢弃恢复且清除暂存', () => {
    localStorage.setItem(
      reviewSessionStorageKey('rootA', 'notes/x.md'),
      JSON.stringify({ sourceRevision: 'sha256:other', workingText: 'Hallo Welt', savedAt: 1 }),
    );
    const session = useReviewSession({
      fs: createFsMock(),
      root: 'rootA',
      path: 'notes/x.md',
      initialSnapshot: { content: SOURCE, revision: REVISION },
    });
    expect(session.workingText.value).toBe(SOURCE);
    expect(session.restoredFromDraft.value).toBe(false);
    expect(loadReviewSession('rootA', 'notes/x.md')).toBeNull();
  });
});

describe('useReviewSession adopt/discard', () => {
  beforeEach(() => {
    localStorage.clear();
    computeReviewDiffMock.mockReset();
    computeReviewDiffMock.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adopt 成功：写入文件、基线前移、hunks 重算、暂存立即落盘', async () => {
    computeReviewDiffMock.mockReturnValueOnce([]).mockReturnValueOnce([]);
    const write = vi.fn().mockResolvedValue({ status: 'saved', revision: 'sha256:bbb' });
    const session = useReviewSession({
      fs: createFsMock(write),
      root: 'rootA',
      path: 'notes/x.md',
      initialSnapshot: { content: SOURCE, revision: REVISION },
    });

    const result: ReviewAdoptResult = await session.adopt(MODIFY_HUNK);
    expect(result).toEqual({ ok: true, revision: 'sha256:bbb' });
    expect(write).toHaveBeenCalledWith('notes/x.md', 'Hallo World', REVISION);
    expect(session.sourceText.value).toBe('Hallo World');
    expect(session.sourceRevision.value).toBe('sha256:bbb');
    // 暂存立即以新基线落盘
    expect(loadReviewSession('rootA', 'notes/x.md')?.sourceRevision).toBe('sha256:bbb');
  });

  it('adopt 冲突：返回 conflict 且本地基线不动', async () => {
    const write = vi.fn().mockResolvedValue({
      status: 'conflict',
      actualRevision: 'sha256:extern',
    });
    const session = useReviewSession({
      fs: createFsMock(write),
      root: 'rootA',
      path: 'notes/x.md',
      initialSnapshot: { content: SOURCE, revision: REVISION },
    });

    const result = await session.adopt(MODIFY_HUNK);
    expect(result).toEqual({ ok: false, reason: 'conflict', actualRevision: 'sha256:extern' });
    expect(session.sourceText.value).toBe(SOURCE);
    expect(session.sourceRevision.value).toBe(REVISION);
  });

  it('adopt IO 错误：返回 io 且本地状态不动', async () => {
    const write = vi.fn().mockRejectedValue(new Error('磁盘不可用'));
    const session = useReviewSession({
      fs: createFsMock(write),
      root: 'rootA',
      path: 'notes/x.md',
      initialSnapshot: { content: SOURCE, revision: REVISION },
    });

    const result = await session.adopt(MODIFY_HUNK);
    expect(result).toEqual({ ok: false, reason: 'io', message: '磁盘不可用' });
    expect(session.sourceText.value).toBe(SOURCE);
  });

  it('discard delete：工作稿回插源稿原文并重算', () => {
    computeReviewDiffMock.mockReturnValueOnce([DELETE_HUNK]).mockReturnValueOnce([]);
    const session = useReviewSession({
      fs: createFsMock(),
      root: 'rootA',
      path: 'notes/x.md',
      initialSnapshot: { content: SOURCE, revision: REVISION },
    });
    // 模拟工作稿已删掉 World
    session.workingText.value = 'Hello ';
    const next = session.discard(DELETE_HUNK);
    expect(next).toBe('Hello World');
    expect(session.workingText.value).toBe('Hello World');
    expect(session.hunks.value).toEqual([]);
  });

  it('rebaseSource：重设基线、保留工作稿', () => {
    const session = useReviewSession({
      fs: createFsMock(),
      root: 'rootA',
      path: 'notes/x.md',
      initialSnapshot: { content: SOURCE, revision: REVISION },
    });
    session.workingText.value = 'Hallo Welt';
    session.rebaseSource({ content: 'Hello World v2', revision: 'sha256:new' });
    expect(session.sourceText.value).toBe('Hello World v2');
    expect(session.sourceRevision.value).toBe('sha256:new');
    expect(session.workingText.value).toBe('Hallo Welt');
  });
});

describe('useReviewSession adoptAll/discardAll', () => {
  beforeEach(() => {
    localStorage.clear();
    computeReviewDiffMock.mockReset();
    computeReviewDiffMock.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // 长度变化的 modify（Hello→Hi 变短 / World→Welt! 变长）+ insert：
  // 若按数组序（从左到右）应用，先行改动会使后续 hunk 的源稿坐标漂移，
  // 此组专门钉住 adoptAll「按源稿锚点降序合并」的语义（终态 = Hi Welt! END）
  const SHORTEN_HUNK = makeHunk({
    id: 'b1',
    type: 'modify',
    leftRange: { from: 0, to: 5 },
    rightRange: { from: 0, to: 2 },
    leftText: 'Hello',
    rightText: 'Hi',
  });

  const LENGTHEN_HUNK = makeHunk({
    id: 'b2',
    type: 'modify',
    leftRange: { from: 6, to: 11 },
    rightRange: { from: 6, to: 11 },
    leftText: 'World',
    rightText: 'Welt!',
  });

  const INSERT_HUNK = makeHunk({
    id: 'b3',
    type: 'insert',
    leftAnchor: 11,
    rightRange: { from: 11, to: 15 },
    leftText: '',
    rightText: ' END',
  });

  it('adoptAll 成功：全部 hunk 内存合并后仅一次 writeFileIfUnchanged，暂存立即落盘', async () => {
    computeReviewDiffMock.mockReturnValue([SHORTEN_HUNK, LENGTHEN_HUNK, INSERT_HUNK]);
    const write = vi.fn().mockResolvedValue({ status: 'saved', revision: 'sha256:bulk' });
    const session = useReviewSession({
      fs: createFsMock(write),
      root: 'rootA',
      path: 'notes/x.md',
      initialSnapshot: { content: SOURCE, revision: REVISION },
    });

    const result = await session.adoptAll();
    expect(result).toEqual({ ok: true, revision: 'sha256:bulk' });
    // 一次写盘：降序合并终态（Hi + Welt! + ' END'），升序错序会漂移成错误文本
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('notes/x.md', 'Hi Welt! END', REVISION);
    expect(session.sourceText.value).toBe('Hi Welt! END');
    expect(session.sourceRevision.value).toBe('sha256:bulk');
    expect(loadReviewSession('rootA', 'notes/x.md')?.sourceRevision).toBe('sha256:bulk');
  });

  it('adoptAll 冲突：一次写盘后返回 conflict 且本地基线不动', async () => {
    computeReviewDiffMock.mockReturnValue([SHORTEN_HUNK]);
    const write = vi.fn().mockResolvedValue({
      status: 'conflict',
      actualRevision: 'sha256:extern',
    });
    const session = useReviewSession({
      fs: createFsMock(write),
      root: 'rootA',
      path: 'notes/x.md',
      initialSnapshot: { content: SOURCE, revision: REVISION },
    });

    const result = await session.adoptAll();
    expect(result).toEqual({ ok: false, reason: 'conflict', actualRevision: 'sha256:extern' });
    expect(write).toHaveBeenCalledTimes(1);
    expect(session.sourceText.value).toBe(SOURCE);
    expect(session.sourceRevision.value).toBe(REVISION);
  });

  it('discardAll：工作稿整体回滚为源稿、hunks 重算清空、暂存清除', () => {
    // 初始 diff 有一处批注；discardAll 内的 computeNow 重算返回空 → hunks 清空
    computeReviewDiffMock.mockReturnValueOnce([DELETE_HUNK]).mockReturnValue([]);
    const session = useReviewSession({
      fs: createFsMock(),
      root: 'rootA',
      path: 'notes/x.md',
      initialSnapshot: { content: SOURCE, revision: REVISION },
    });
    session.workingText.value = 'Hallo Welt';
    localStorage.setItem(
      reviewSessionStorageKey('rootA', 'notes/x.md'),
      JSON.stringify({ sourceRevision: REVISION, workingText: 'Hallo Welt', savedAt: 1 }),
    );
    expect(session.hunks.value).toHaveLength(1);

    const next = session.discardAll();
    expect(next).toBe(SOURCE);
    expect(session.workingText.value).toBe(SOURCE);
    expect(session.hunks.value).toEqual([]);
    // 回滚后工作稿与源稿一致 → persistNow 清除暂存
    expect(loadReviewSession('rootA', 'notes/x.md')).toBeNull();
  });
});

describe('useReviewSession adoptAll 同锚点多处 insert（原文档序拼接）', () => {
  beforeEach(() => {
    localStorage.clear();
    computeReviewDiffMock.mockReset();
    computeReviewDiffMock.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // 真实 computeReviewDiff 对「同锚双整块新增」的产出形态（手工镜像）：
  // 两个 insert 共享锚点 9（para one 后空行块 range.to），rightRange 按工作稿坐标
  const SAME_ANCHOR_SOURCE = 'para one\n\npara two';
  const SAME_ANCHOR_WORKING = 'para one\n\nNEW A\n\nNEW B\n\npara two';

  function buildSameAnchorHunks(): ReviewHunk[] {
    return [
      makeHunk({
        id: 'hunk-1',
        type: 'insert',
        leftAnchor: 9,
        rightRange: { from: 10, to: 15 },
        blockLevelInsert: true,
        leftText: '',
        rightText: 'NEW A',
      }),
      makeHunk({
        id: 'hunk-2',
        type: 'insert',
        leftAnchor: 9,
        rightRange: { from: 17, to: 22 },
        blockLevelInsert: true,
        leftText: '',
        rightText: 'NEW B',
      }),
    ];
  }

  it('同锚双整块新增：一次写盘且终态=工作稿（段落顺序不颠倒）', async () => {
    const hunks = buildSameAnchorHunks();
    computeReviewDiffMock.mockReturnValue(hunks);
    const write = vi.fn().mockResolvedValue({ status: 'saved', revision: 'sha256:order' });
    const session = useReviewSession({
      fs: createFsMock(write),
      root: 'rootA',
      path: 'notes/x.md',
      initialSnapshot: { content: SAME_ANCHOR_SOURCE, revision: REVISION },
    });
    // 工作稿供拼接取块间真实间隙（'\n\n'）
    session.workingText.value = SAME_ANCHOR_WORKING;

    const result = await session.adoptAll();
    expect(result).toEqual({ ok: true, revision: 'sha256:order' });
    // 降序逐个裸插会得到倒序（'…NEW B\n\nNEW A…'）——必须拼接为一次插入
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('notes/x.md', SAME_ANCHOR_WORKING, REVISION);
    expect(session.sourceText.value).toBe(SAME_ANCHOR_WORKING);
    session.dispose();
  });

  it('mergeSameAnchorInserts：rightText 以工作稿真实间隙相连，块级旗标全员才保留', () => {
    const merged = mergeSameAnchorInserts(buildSameAnchorHunks(), 9, SAME_ANCHOR_WORKING);
    expect(merged.type).toBe('insert');
    expect(merged.leftAnchor).toBe(9);
    expect(merged.rightRange).toEqual({ from: 10, to: 22 });
    expect(merged.rightText).toBe('NEW A\n\nNEW B');
    expect(merged.blockLevelInsert).toBe(true);
    // 混入词级新增（无块级旗标）→ 整体按裸插入处理
    const mixed = mergeSameAnchorInserts(
      [
        makeHunk({ id: 'a', type: 'insert', leftAnchor: 0, rightText: '甲' }),
        makeHunk({ id: 'b', type: 'insert', leftAnchor: 0, rightText: '乙' }),
      ],
      0,
      '',
    );
    expect(mixed.blockLevelInsert).toBeUndefined();
    expect(mixed.rightText).toBe('甲乙');
    // 单成员原样返回
    const single = buildSameAnchorHunks()[0]!;
    expect(mergeSameAnchorInserts([single], 9, '')).toBe(single);
  });
});

describe('useReviewSession 裁决入口冲刷（防抖窗口内陈旧坐标）', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    computeReviewDiffMock.mockReset();
    computeReviewDiffMock.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('防抖窗口内编辑后 discard：先冲刷重算，以新 hunk 坐标裁决', async () => {
    const source = 'Hello World';
    // 初始批注（旧坐标：'Hallo' 在 [0,5)）；文首插入 '!!' 后重算，
    // 同一批注 rightRange 漂移为 [2,7)（源稿侧字段稳定不变）
    const staleHunk = makeHunk({
      id: 'hunk-1',
      type: 'modify',
      leftRange: { from: 0, to: 5 },
      rightRange: { from: 0, to: 5 },
      leftText: 'Hello',
      rightText: 'Hallo',
    });
    const freshHunk = makeHunk({
      id: 'hunk-1',
      type: 'modify',
      leftRange: { from: 0, to: 5 },
      rightRange: { from: 2, to: 7 },
      leftText: 'Hello',
      rightText: 'Hallo',
    });
    computeReviewDiffMock.mockReturnValueOnce([staleHunk]).mockReturnValue([freshHunk]);
    const session = useReviewSession({
      fs: createFsMock(),
      root: 'rootA',
      path: 'notes/x.md',
      initialSnapshot: { content: source, revision: REVISION },
    });
    // 防抖窗口内编辑（400ms 计时未到，hunks 仍是旧坐标）
    session.workingText.value = '!!Hallo World';
    await nextTick();
    computeReviewDiffMock.mockClear();

    const next = session.discard(staleHunk);
    // 冲刷：以最新 workingText 立即重算（不等 400ms 计时）
    expect(computeReviewDiffMock).toHaveBeenCalledWith(source, '!!Hallo World');
    // 以新坐标 [2,7) 回滚：保留 '!!' 前缀。陈旧坐标 [0,5) 会静默改坏成
    // 'Hellolo World'（替换掉 '!','!','H','a' 并留下半个 'llo'）
    expect(next).toBe('!!Hello World');
    expect(session.workingText.value).toBe('!!Hello World');
    session.dispose();
  });

  it('防抖窗口内编辑后 adopt：入口先冲刷（新 hunks 参与锚点推算与裁决）', async () => {
    const write = vi.fn().mockResolvedValue({ status: 'saved', revision: 'sha256:bbb' });
    const session = useReviewSession({
      fs: createFsMock(write),
      root: 'rootA',
      path: 'notes/x.md',
      initialSnapshot: { content: SOURCE, revision: REVISION },
    });
    session.workingText.value = 'Hallo Welt';
    await nextTick();
    computeReviewDiffMock.mockClear();

    await session.adopt(MODIFY_HUNK);
    // 入口冲刷：写盘前先以最新 workingText 重算
    expect(computeReviewDiffMock).toHaveBeenCalledWith(SOURCE, 'Hallo Welt');
    expect(write).toHaveBeenCalledWith('notes/x.md', 'Hallo World', REVISION);
    session.dispose();
  });

  it('resolveFreshHunk：身份 / 源稿键 / 区间重叠兜底 / 无重叠兜底原对象', () => {
    const stale = makeHunk({
      id: 'hunk-1',
      type: 'modify',
      leftRange: { from: 0, to: 5 },
      rightRange: { from: 0, to: 5 },
      leftText: 'Hello',
      rightText: 'Hallo',
    });
    const fresh = makeHunk({
      id: 'hunk-1',
      type: 'modify',
      leftRange: { from: 0, to: 5 },
      rightRange: { from: 2, to: 7 },
      leftText: 'Hello',
      rightText: 'Hallo',
    });
    expect(resolveFreshHunk(fresh, [fresh])).toBe(fresh);
    // rightRange 漂移不影响匹配（工作稿侧坐标允许变）
    expect(resolveFreshHunk(stale, [fresh])).toBe(fresh);
    // 批注文本被用户新输入改写（'!!' 并入同一批注）→ 按重叠度定位最新批注：
    // 裁决必须落在最新批注上才收敛（陈旧坐标会静默改坏）
    const rewritten = makeHunk({
      id: 'hunk-1',
      type: 'modify',
      leftRange: { from: 0, to: 5 },
      rightRange: { from: 0, to: 7 },
      leftText: 'Hello',
      rightText: '!!Hallo',
    });
    expect(resolveFreshHunk(stale, [rewritten])).toBe(rewritten);
    // 无任何重叠（或空集）→ 原样返回兜底
    const elsewhere = makeHunk({
      id: 'hunk-9',
      type: 'modify',
      leftRange: { from: 20, to: 25 },
      rightRange: { from: 20, to: 25 },
      leftText: 'other',
      rightText: 'text',
    });
    expect(resolveFreshHunk(stale, [elsewhere])).toBe(stale);
    expect(resolveFreshHunk(stale, [])).toBe(stale);
  });
});

describe('useReviewSession hunks 引用稳定化', () => {
  // computeReviewDiff 每轮返回全新嵌套对象（review-diff.ts 的 { ...range } 展开
  // 与 toDocRange 新字面量），下述用例刻意用「每次调用现造新字面量」复刻该行为；
  // reviewHunksEqual 对 leftRange/rightRange 做字段级深比较（from/to 数值逐一
  // 相等），引用比较会让稳定化形同虚设。
  beforeEach(() => {
    localStorage.clear();
    computeReviewDiffMock.mockReset();
    computeReviewDiffMock.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** 每次调用构造结构等价但全新嵌套对象的 hunk 数组 */
  const buildFreshHunks = (): ReviewHunk[] => [
    makeHunk({
      id: 'hunk-1',
      type: 'modify',
      leftRange: { from: 0, to: 5 },
      rightRange: { from: 0, to: 6 },
      leftText: 'Hello',
      rightText: 'Hallo!',
    }),
    makeHunk({
      id: 'hunk-2',
      type: 'insert',
      rightRange: { from: 10, to: 20 },
      leftAnchor: 10,
      blockLevelInsert: true,
      leftText: '',
      rightText: '新增段落',
    }),
  ];

  it('computeReviewDiff 返回结构等价的全新嵌套对象 → hunks.value 保持同一引用', () => {
    computeReviewDiffMock.mockImplementation(buildFreshHunks);
    const session = useReviewSession({
      fs: createFsMock(),
      root: 'rootA',
      path: 'notes/x.md',
      initialSnapshot: { content: SOURCE, revision: REVISION },
    });
    const first = session.hunks.value;
    expect(first).toEqual(buildFreshHunks());

    session.workingText.value = 'Hallo Welt'; // 触发一轮重算（此处直接 computeNow）
    session.computeNow();
    expect(computeReviewDiffMock).toHaveBeenCalledTimes(2);
    // 两次结果结构等价但为全新嵌套对象 → 引用稳定化必须保住 first
    expect(Object.is(session.hunks.value, first)).toBe(true);
  });

  it('内容变化 → hunks.value 换新引用（下游 computed 缓存失效）', () => {
    computeReviewDiffMock.mockImplementation(buildFreshHunks);
    const session = useReviewSession({
      fs: createFsMock(),
      root: 'rootA',
      path: 'notes/x.md',
      initialSnapshot: { content: SOURCE, revision: REVISION },
    });
    const first = session.hunks.value;

    computeReviewDiffMock.mockReturnValue([
      makeHunk({
        id: 'hunk-9',
        type: 'modify',
        leftRange: { from: 0, to: 5 },
        rightRange: { from: 0, to: 7 }, // 区间数值变化
        leftText: 'Hello',
        rightText: 'Hallo!!',
      }),
    ]);
    session.computeNow();
    expect(Object.is(session.hunks.value, first)).toBe(false);
    expect(session.hunks.value[0]?.id).toBe('hunk-9');
  });

  it('reviewHunksEqual：区间字段级深比较（新字面量等价 → true），数值差异 → false', () => {
    const a = buildFreshHunks();
    const b = buildFreshHunks();
    expect(a[0]?.leftRange).not.toBe(b[0]?.leftRange); // 确非同一引用
    expect(reviewHunksEqual(a, b)).toBe(true);
    expect(reviewHunksEqual([], [])).toBe(true);

    const c = buildFreshHunks();
    c[0]!.rightRange = { from: 0, to: 5 }; // 与 a 的 rightRange.to 差 1
    expect(reviewHunksEqual(a, c)).toBe(false);

    const d = buildFreshHunks();
    delete d[1]!.blockLevelInsert;
    expect(reviewHunksEqual(a, d)).toBe(false);

    const e = buildFreshHunks();
    e[1]!.leftAnchor = 3;
    expect(reviewHunksEqual(a, e)).toBe(false);
  });
});

describe('useReviewSession 防抖（fake timers）', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    computeReviewDiffMock.mockReset();
    computeReviewDiffMock.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('workingText 变更 → 400ms 后重算 hunks，800ms 后暂存', async () => {
    const session = useReviewSession({
      fs: createFsMock(),
      root: 'rootA',
      path: 'notes/x.md',
      initialSnapshot: { content: SOURCE, revision: REVISION },
    });
    computeReviewDiffMock.mockClear();

    session.workingText.value = 'Hallo Welt';
    await nextTick();
    expect(computeReviewDiffMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(400);
    expect(computeReviewDiffMock).toHaveBeenCalledWith(SOURCE, 'Hallo Welt');

    vi.advanceTimersByTime(400);
    expect(loadReviewSession('rootA', 'notes/x.md')?.workingText).toBe('Hallo Welt');
    session.dispose();
  });

  it('computeNow 跳过防抖立即重算', async () => {
    const session = useReviewSession({
      fs: createFsMock(),
      root: 'rootA',
      path: 'notes/x.md',
      initialSnapshot: { content: SOURCE, revision: REVISION },
    });
    computeReviewDiffMock.mockClear();

    session.workingText.value = 'abc';
    await nextTick();
    session.computeNow();
    expect(computeReviewDiffMock).toHaveBeenCalledWith(SOURCE, 'abc');
    session.dispose();
  });

  it('dispose 冲刷暂存（退出前 800ms 内的编辑不丢失）', async () => {
    const session = useReviewSession({
      fs: createFsMock(),
      root: 'rootA',
      path: 'notes/x.md',
      initialSnapshot: { content: SOURCE, revision: REVISION },
    });
    session.workingText.value = 'draft';
    await nextTick();
    session.dispose();
    expect(loadReviewSession('rootA', 'notes/x.md')?.workingText).toBe('draft');
  });

  it('工作稿与源稿一致时 dispose 清除暂存', () => {
    const session = useReviewSession({
      fs: createFsMock(),
      root: 'rootA',
      path: 'notes/x.md',
      initialSnapshot: { content: SOURCE, revision: REVISION },
    });
    session.dispose();
    expect(loadReviewSession('rootA', 'notes/x.md')).toBeNull();
  });
});
