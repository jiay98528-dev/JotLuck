import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyHunkToSource,
  clearReviewSession,
  leftMarksFromHunks,
  loadReviewSession,
  mapLeftPositionToWorking,
  mapRightPositionToLeft,
  reviewSessionStorageKey,
  revertHunkInWorking,
  rightMarksFromHunks,
  saveReviewSession,
} from '../review-session-store';
import type { ReviewHunk } from '@/utils/review-types';
import { computeReviewDiff } from '@/utils/review-diff';

/** 构造 hunk 的最小便利函数（未填字段取类型默认语义） */
function makeHunk(partial: Partial<ReviewHunk> & Pick<ReviewHunk, 'id'>): ReviewHunk {
  return { type: 'modify', leftText: '', rightText: '', ...partial };
}

describe('块级新增采纳的收敛性（回归：e2e 05 幻影批注）', () => {
  it('采纳块级 insert 后重算 diff 为空（不粘连、无幻影）', () => {
    const source = [
      '# 改稿验收笔记',
      '',
      '第一段原始内容，讨论今天的会议安排。',
      '',
      '第二段保持不变的内容。',
    ].join('\n');
    const working = `${source}\n\n这段修改将被批准并入源稿。`;
    const hunks = computeReviewDiff(source, working);
    expect(hunks).toHaveLength(1);
    const insert = hunks[0]!;
    expect(insert.type).toBe('insert');
    expect(insert.blockLevelInsert).toBe(true);
    const adopted = applyHunkToSource(source, insert, hunks);
    // 采纳结果与工作稿一致 → 会话收敛
    expect(adopted).toBe(working);
    expect(computeReviewDiff(adopted, working)).toEqual([]);
  });

  it('文首新增（锚点 0）不加前导空行', () => {
    const source = '正文一段。';
    const working = `全新开头段。\n\n${source}`;
    const hunks = computeReviewDiff(source, working);
    const insert = hunks.find((h) => h.type === 'insert');
    expect(insert).toBeDefined();
    const adopted = applyHunkToSource(source, insert!, hunks);
    expect(adopted).toBe(working);
    expect(computeReviewDiff(adopted, working)).toEqual([]);
  });
});

describe('词级新增采纳的精确锚点与收敛（回归：采纳错位永不收敛）', () => {
  it('段中词级新增：采纳落在用户输入位置（非段首）且重算 diff 为空', () => {
    const source = '甲乙丙丁戊己庚辛';
    const working = '甲乙丙丁新戊己庚辛';
    const hunks = computeReviewDiff(source, working);
    expect(hunks).toHaveLength(1);
    const ins = hunks[0]!;
    expect(ins.type).toBe('insert');
    expect(ins.rightText).toBe('新');
    // 词级新增非块级：裸插入（不带块级旗标）
    expect(ins.blockLevelInsert).toBeUndefined();
    const adopted = applyHunkToSource(source, ins, hunks);
    // 采纳逐字节还原工作稿（历史近似锚点=配对块起点，会得到「新甲乙丙丁…」）
    expect(adopted).toBe(working);
    expect(computeReviewDiff(adopted, working)).toEqual([]);
  });

  it('多块词级新增：按 adoptAll 降序口径全部采纳后逐字节还原工作稿', () => {
    const source = '第一段甲乙\n\n第二段丙丁';
    const working = '第一段甲新乙\n\n第二段丙丁末';
    const hunks = computeReviewDiff(source, working);
    expect(hunks.map((h) => h.type)).toEqual(['insert', 'insert']);
    // 降序应用（源稿锚点从右向左）：左侧 hunk 坐标不因右侧改动漂移
    let adopted = source;
    for (const h of [...hunks].sort((a, b) => (b.leftAnchor ?? -1) - (a.leftAnchor ?? -1))) {
      adopted = applyHunkToSource(adopted, h, hunks);
    }
    expect(adopted).toBe(working);
    expect(computeReviewDiff(adopted, working)).toEqual([]);
  });

  it('拉丁词带空格新增：采纳文本保留边缘空格（insertText 未收缩字节）', () => {
    const source = 'hello world';
    const working = 'hello brave world';
    const hunks = computeReviewDiff(source, working);
    const ins = hunks.find((h) => h.type === 'insert');
    expect(ins).toBeDefined();
    const adopted = applyHunkToSource(source, ins!, hunks);
    // 收缩文本（'brave'）会丢空格拼成 'hellobrave world' → 幻影批注不收敛
    expect(adopted).toBe(working);
    expect(computeReviewDiff(adopted, working)).toEqual([]);
  });
});

describe('整块删除丢弃的块分隔（回归：段落粘连 + 幻影批注不收敛）', () => {
  const source = 'P1 内容一\n\nP2 内容二\n\nP3 内容三';
  const cases: Array<[string, string]> = [
    ['丢弃中段', 'P1 内容一\n\nP3 内容三'],
    ['丢弃首段', 'P2 内容二\n\nP3 内容三'],
    ['丢弃末段', 'P1 内容一\n\nP2 内容二'],
  ];
  for (const [name, working] of cases) {
    it(`${name}：回插原文、段落结构保持、重算 diff 为空`, () => {
      const hunks = computeReviewDiff(source, working);
      expect(hunks).toHaveLength(1);
      const del = hunks[0]!;
      expect(del.type).toBe('delete');
      expect(del.blockLevelDelete).toBe(true);
      const next = revertHunkInWorking(working, del, hunks);
      // 逐字节还原源稿（裸回插会与相邻段粘连，如 'P1 内容一P2 内容二'）
      expect(next).toBe(source);
      expect(computeReviewDiff(source, next)).toEqual([]);
    });
  }

  it('列表项整块删除：丢弃后即使分隔形态非原文也必须收敛（空块不产 hunk）', () => {
    const source = '- 买酱油\n- 买食盐\n- 买醋';
    const working = '- 买酱油\n- 买醋';
    const hunks = computeReviewDiff(source, working);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.blockLevelDelete).toBe(true);
    const next = revertHunkInWorking(working, hunks[0]!, hunks);
    expect(computeReviewDiff(source, next)).toEqual([]);
  });

  it('块内词级删除：不带块级旗标，裸回插原位收敛', () => {
    const source = '今天天气真的很不错';
    const working = '今天天气很不错';
    const hunks = computeReviewDiff(source, working);
    expect(hunks).toHaveLength(1);
    const del = hunks[0]!;
    expect(del.type).toBe('delete');
    expect(del.blockLevelDelete).toBeUndefined();
    expect(revertHunkInWorking(working, del, hunks)).toBe(source);
  });
});

describe('review-session-store 持久化', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('storage key 形如 jotluck:review:<root>:<path>', () => {
    expect(reviewSessionStorageKey('rootA', 'notes/x.md')).toBe('jotluck:review:rootA:notes/x.md');
  });

  it('save 后 load 恢复同一快照', () => {
    const snapshot = { sourceRevision: 'sha256:abc', workingText: '# 改到一半', savedAt: 123 };
    saveReviewSession('rootA', 'notes/x.md', snapshot);
    expect(loadReviewSession('rootA', 'notes/x.md')).toEqual(snapshot);
  });

  it('缺失 / 损坏 JSON / 结构不符 → null', () => {
    expect(loadReviewSession('rootA', 'notes/x.md')).toBeNull();
    localStorage.setItem('jotluck:review:rootA:notes/x.md', '{broken json');
    expect(loadReviewSession('rootA', 'notes/x.md')).toBeNull();
    localStorage.setItem('jotluck:review:rootA:notes/x.md', JSON.stringify({ foo: 1 }));
    expect(loadReviewSession('rootA', 'notes/x.md')).toBeNull();
    localStorage.setItem(
      'jotluck:review:rootA:notes/x.md',
      JSON.stringify({ sourceRevision: 'r', workingText: 3, savedAt: 1 }),
    );
    expect(loadReviewSession('rootA', 'notes/x.md')).toBeNull();
  });

  it('clear 后 load 返回 null', () => {
    saveReviewSession('rootA', 'notes/x.md', {
      sourceRevision: 'r',
      workingText: 'x',
      savedAt: 1,
    });
    clearReviewSession('rootA', 'notes/x.md');
    expect(loadReviewSession('rootA', 'notes/x.md')).toBeNull();
  });
});

describe('applyHunkToSource（批准 → 写入源稿）', () => {
  it('modify：leftRange 区间替换为 rightText', () => {
    const hunk = makeHunk({
      id: 'h1',
      type: 'modify',
      leftRange: { from: 6, to: 11 },
      rightRange: { from: 6, to: 10 },
      leftText: 'brave',
      rightText: 'bold',
    });
    expect(applyHunkToSource('Hello brave world', hunk)).toBe('Hello bold world');
  });

  it('delete：leftRange 区间替换为空（rightText 为空串）', () => {
    const hunk = makeHunk({
      id: 'h2',
      type: 'delete',
      leftRange: { from: 5, to: 11 },
      leftText: ' brave',
      rightText: '',
    });
    expect(applyHunkToSource('Hello brave world', hunk)).toBe('Hello world');
  });

  it('insert：leftAnchor（扩展字段）锚点插入 rightText', () => {
    const hunk = makeHunk({
      id: 'h3',
      type: 'insert',
      rightRange: { from: 1, to: 2 },
      rightText: 'X',
    });
    (hunk as { leftAnchor?: number }).leftAnchor = 1;
    expect(applyHunkToSource('AB', hunk)).toBe('AXB');
  });

  it('insert：零宽 leftRange（from===to）作为插入点', () => {
    const hunk = makeHunk({
      id: 'h4',
      type: 'insert',
      leftRange: { from: 2, to: 2 },
      rightRange: { from: 2, to: 5 },
      rightText: 'XYZ',
    });
    expect(applyHunkToSource('AB', hunk)).toBe('ABXYZ');
  });

  it('insert：缺自身坐标时用全集位移反推锚点', () => {
    const hunk = makeHunk({
      id: 'h5',
      type: 'insert',
      rightRange: { from: 1, to: 2 },
      rightText: 'X',
    });
    // 无 leftAnchor / leftRange → mapRightPositionToLeft(1, [hunk]) = 1
    expect(applyHunkToSource('AB', hunk, [hunk])).toBe('AXB');
  });

  it('insert：位移反推受前置 modify 影响', () => {
    const first = makeHunk({
      id: 'm1',
      type: 'modify',
      leftRange: { from: 0, to: 2 },
      rightRange: { from: 0, to: 4 },
      leftText: 'AB',
      rightText: 'ABCD',
    });
    const insert = makeHunk({
      id: 'i1',
      type: 'insert',
      rightRange: { from: 5, to: 6 },
      rightText: '-',
    });
    // 工作稿坐标 5 = 源稿坐标 5 - 前置位移(+2) = 3
    expect(applyHunkToSource('0123456', insert, [first, insert])).toBe('012-3456');
  });

  it('缺必要坐标抛 Error', () => {
    const insert = makeHunk({ id: 'x1', type: 'insert', rightText: 'X' });
    expect(() => applyHunkToSource('AB', insert)).toThrow(/anchor/);
    const modify = makeHunk({ id: 'x2', type: 'modify', rightText: 'Y' });
    expect(() => applyHunkToSource('AB', modify)).toThrow(/range/);
  });

  it('区间倒置抛 Error；越界区间被钳制', () => {
    const inverted = makeHunk({
      id: 'x3',
      type: 'modify',
      leftRange: { from: 4, to: 2 },
      rightText: 'Y',
    });
    expect(() => applyHunkToSource('AB', inverted)).toThrow(/inverted/);
    const overflow = makeHunk({
      id: 'x4',
      type: 'modify',
      leftRange: { from: 1, to: 99 },
      rightText: 'Y',
    });
    expect(applyHunkToSource('AB', overflow)).toBe('AY');
  });
});

describe('revertHunkInWorking（丢弃 → 工作稿回滚）', () => {
  it('modify：rightRange 区间替换回 leftText', () => {
    const hunk = makeHunk({
      id: 'r1',
      type: 'modify',
      leftRange: { from: 6, to: 11 },
      rightRange: { from: 6, to: 10 },
      leftText: 'brave',
      rightText: 'bold',
    });
    expect(revertHunkInWorking('Hello bold world', hunk)).toBe('Hello brave world');
  });

  it('insert：rightRange 区间替换回空（纯删除新增内容）', () => {
    const hunk = makeHunk({
      id: 'r2',
      type: 'insert',
      rightRange: { from: 1, to: 2 },
      leftText: '',
      rightText: 'X',
    });
    expect(revertHunkInWorking('AXB', hunk)).toBe('AB');
  });

  it('delete：无 rightRange 时以全集位移反推锚点回插 leftText', () => {
    const del = makeHunk({
      id: 'r3',
      type: 'delete',
      leftRange: { from: 1, to: 2 },
      leftText: 'B',
      rightText: '',
    });
    expect(revertHunkInWorking('AC', del, [del])).toBe('ABC');
  });

  it('delete：反推锚点计入前置 modify 的位移', () => {
    const modify = makeHunk({
      id: 'm1',
      type: 'modify',
      leftRange: { from: 0, to: 1 },
      rightRange: { from: 0, to: 1 },
      leftText: 'A',
      rightText: 'Z',
    });
    const del = makeHunk({
      id: 'd1',
      type: 'delete',
      leftRange: { from: 1, to: 2 },
      leftText: 'B',
      rightText: '',
    });
    // 工作稿 'ZC'：源稿位置 1 → 工作稿位置 1（前置 modify 等长）→ 回插 B
    expect(revertHunkInWorking('ZC', del, [modify, del])).toBe('ZBC');
  });

  it('缺必要坐标抛 Error', () => {
    const del = makeHunk({ id: 'e1', type: 'delete', leftText: 'B' });
    expect(() => revertHunkInWorking('AC', del)).toThrow(/anchor/);
    const modify = makeHunk({ id: 'e2', type: 'modify', leftText: 'A', rightText: 'Z' });
    expect(() => revertHunkInWorking('ZC', modify)).toThrow(/range/);
  });
});

describe('坐标换算纯函数', () => {
  it('mapLeftPositionToWorking 累计前置位移', () => {
    const hunks: ReviewHunk[] = [
      makeHunk({
        id: 'a',
        type: 'modify',
        leftRange: { from: 0, to: 2 },
        rightRange: { from: 0, to: 5 },
        leftText: 'ab',
        rightText: 'abcde',
      }),
      makeHunk({
        id: 'b',
        type: 'delete',
        leftRange: { from: 4, to: 6 },
        leftText: 'xy',
        rightText: '',
      }),
    ];
    // 源稿位置 7（两处改动之后）：+3（modify 净增）-2（delete）= 8
    expect(mapLeftPositionToWorking(7, hunks)).toBe(8);
    // 源稿位置 3（仅 modify 之后、delete 之前）：+3 = 6
    expect(mapLeftPositionToWorking(3, hunks)).toBe(6);
    // 源稿位置 0：0
    expect(mapLeftPositionToWorking(0, hunks)).toBe(0);
  });

  it('mapRightPositionToLeft 是 mapLeftPositionToWorking 的逆运算', () => {
    const hunks: ReviewHunk[] = [
      makeHunk({
        id: 'a',
        type: 'insert',
        leftRange: { from: 2, to: 2 },
        rightRange: { from: 2, to: 4 },
        rightText: 'XY',
      }),
    ];
    expect(mapRightPositionToLeft(4, hunks)).toBe(2);
    expect(mapLeftPositionToWorking(2, hunks)).toBe(2); // 锚点本身不受影响
  });
});

describe('marks 映射', () => {
  const hunks: ReviewHunk[] = [
    makeHunk({
      id: 'm',
      type: 'modify',
      leftRange: { from: 2, to: 6 },
      rightRange: { from: 2, to: 8 },
      leftText: '旧文',
      rightText: '新文字',
    }),
    makeHunk({
      id: 'i',
      type: 'insert',
      rightRange: { from: 10, to: 12 },
      rightText: '新增',
    }),
    makeHunk({
      id: 'd',
      type: 'delete',
      leftRange: { from: 20, to: 24 },
      leftText: '被删',
      rightText: '',
    }),
  ];

  it('leftMarksFromHunks：modify/delete 的 leftRange → del', () => {
    expect(leftMarksFromHunks(hunks)).toEqual([
      { from: 2, to: 6, side: 'del', kind: 'text' },
      { from: 20, to: 24, side: 'del', kind: 'text' },
    ]);
  });

  it('rightMarksFromHunks：modify/insert 的 rightRange → add', () => {
    expect(rightMarksFromHunks(hunks)).toEqual([
      { from: 2, to: 8, side: 'add', kind: 'text' },
      { from: 10, to: 12, side: 'add', kind: 'text' },
    ]);
  });

  it('空区间 / 倒置区间 / 负坐标被钳制过滤', () => {
    const broken: ReviewHunk[] = [
      makeHunk({
        id: 'z1',
        type: 'modify',
        leftRange: { from: 3, to: 3 },
        rightRange: { from: 0, to: 1 },
        leftText: 'a',
        rightText: 'b',
      }),
      makeHunk({
        id: 'z2',
        type: 'delete',
        leftRange: { from: 5, to: 2 },
        leftText: 'b',
        rightText: '',
      }),
      makeHunk({
        id: 'z3',
        type: 'modify',
        leftRange: { from: -4, to: 2 },
        rightRange: { from: 0, to: 1 },
        leftText: 'c',
        rightText: 'd',
      }),
    ];
    expect(leftMarksFromHunks(broken)).toEqual([{ from: 0, to: 2, side: 'del', kind: 'text' }]);
    expect(rightMarksFromHunks(broken)).toEqual([
      { from: 0, to: 1, side: 'add', kind: 'text' },
      { from: 0, to: 1, side: 'add', kind: 'text' },
    ]);
  });
});
