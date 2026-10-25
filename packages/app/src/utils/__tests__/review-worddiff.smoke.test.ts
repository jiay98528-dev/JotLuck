import { describe, expect, it } from 'vitest';

import { diffSequences, diffWordPaired, diffWordSpans, tokenizeText } from '../review-worddiff';

describe('tokenizeText', () => {
  it('Han 逐字、拉丁连写、空白成段', () => {
    const tokens = tokenizeText('今天 hello  世界!');
    expect(tokens.map((t) => t.text)).toEqual(['今', '天', ' ', 'hello', '  ', '世', '界', '!']);
    expect(tokens[3]).toMatchObject({ from: 3, to: 8 });
  });

  it('代理对 token 偏移按 UTF-16 计', () => {
    const tokens = tokenizeText('😀字');
    expect(tokens.map((t) => t.text)).toEqual(['😀', '字']);
    expect(tokens[0]).toMatchObject({ from: 0, to: 2 });
    expect(tokens[1]).toMatchObject({ from: 2, to: 3 });
  });
});

describe('diffWordSpans', () => {
  it('相同文本零区间', () => {
    expect(diffWordSpans('abc def', 'abc def')).toEqual({ left: [], right: [] });
  });

  it('中文单字替换：两侧区间精确到字', () => {
    const { left, right } = diffWordSpans('今天天气很好', '今天天气很差');
    expect(left).toEqual([{ from: 5, to: 6 }]);
    expect(right).toEqual([{ from: 5, to: 6 }]);
  });

  it('英文换词：区间贴词不含边缘空白', () => {
    const { left, right } = diffWordSpans('hello world foo', 'hello world bar');
    expect(left.length).toBe(1);
    expect('hello world foo'.slice(left[0]!.from, left[0]!.to)).toBe('foo');
    expect(right.length).toBe(1);
    expect('hello world bar'.slice(right[0]!.from, right[0]!.to)).toBe('bar');
  });

  it('两词换位的歧义对齐退化为整段替换（记录行为）', () => {
    const { left, right } = diffWordSpans('hello world foo', 'hello brave world');
    expect(left.length).toBe(1);
    expect('hello world foo'.slice(left[0]!.from, left[0]!.to)).toContain('foo');
    expect('hello brave world'.slice(right[0]!.from, right[0]!.to)).toContain('brave');
  });

  it('微间隔合并：两处近距离改动合为一处（mergeGap）', () => {
    const a = '一二三四五';
    const b = '九二八四五'; // 改 一→九 与 三→八，中间只隔一个「二」
    const { left } = diffWordSpans(a, b, { mergeGap: 2 });
    expect(left.length).toBe(1);
    expect(a.slice(left[0]!.from, left[0]!.to)).toBe('一二三');
  });

  it('含 emoji（代理对）文档不炸且区间对齐', () => {
    const a = '😀😀 开会';
    const b = '😀 开会啦';
    const { left, right } = diffWordSpans(a, b);
    expect(a.slice(left[0]!.from, left[0]!.to)).toContain('😀');
    expect(b.slice(right[0]!.from, right[0]!.to)).toBe('啦');
  });

  it('一侧为空：另一侧整段标出', () => {
    const { left, right } = diffWordSpans('', '全新内容');
    expect(left).toEqual([]);
    expect(right).toEqual([{ from: 0, to: 4 }]);
  });
});

describe('diffWordPaired', () => {
  it('替换段两侧配对、区间可回切原文', () => {
    const a = '甲乙丙丁戊';
    const b = '甲X丁戊';
    const paired = diffWordPaired(a, b);
    expect(paired).toHaveLength(1);
    expect(a.slice(paired[0]!.left!.from, paired[0]!.left!.to)).toBe('乙丙');
    expect(b.slice(paired[0]!.right!.from, paired[0]!.right!.to)).toBe('X');
  });

  it('纯删除段只有 left、纯新增段只有 right', () => {
    const paired = diffWordPaired('甲乙丙丁', '甲丁');
    expect(paired).toHaveLength(1);
    expect('甲乙丙丁'.slice(paired[0]!.left!.from, paired[0]!.left!.to)).toBe('乙丙');
    expect(paired[0]!.right).toBeUndefined();
    const paired2 = diffWordPaired('甲丁', '甲乙丙丁');
    expect(paired2[0]!.left).toBeUndefined();
    expect('甲乙丙丁'.slice(paired2[0]!.right!.from, paired2[0]!.right!.to)).toBe('乙丙');
  });

  it('纯新增段附精确插入点与未收缩字节：insertAt 处裸插 insertText 逐字节还原 b', () => {
    const a = '甲乙丙';
    const b = '甲乙新丙';
    const paired = diffWordPaired(a, b);
    expect(paired).toHaveLength(1);
    const p = paired[0]!;
    expect(p.left).toBeUndefined();
    // 对齐下标 = 「新」插入点（「乙」后 = a 偏移 2），insertText 为段内原文
    expect(p.insertAt).toBe(2);
    expect(p.insertText).toBe('新');
    expect(a.slice(0, p.insertAt!) + p.insertText! + a.slice(p.insertAt!)).toBe(b);
  });

  it('带边缘空白的拉丁新增：right span 收缩贴词，insertText 保留空格', () => {
    const a = 'hello world';
    const b = 'hello  brave world';
    const paired = diffWordPaired(a, b);
    const p = paired.find((x) => x.insertText !== undefined)!;
    expect(p).toBeDefined();
    // 马克笔区间收缩（right 不含边缘空格），采纳文本不收缩（含全部空格）
    expect(b.slice(p.right!.from, p.right!.to)).toBe('brave');
    expect(p.insertText).toBe('  brave');
    expect(a.slice(0, p.insertAt!) + p.insertText! + a.slice(p.insertAt!)).toBe(b);
  });

  it('replace 段不携带 insertAt/insertText（仅纯新增段暴露）', () => {
    const paired = diffWordPaired('甲乙丙丁戊', '甲X丁戊');
    expect(paired).toHaveLength(1);
    expect(paired[0]!.left).toBeDefined();
    expect(paired[0]!.insertAt).toBeUndefined();
    expect(paired[0]!.insertText).toBeUndefined();
  });

  it('a 侧全空白删除段：退化为整段替换而非纯新增裸插（空白不重复）', () => {
    // 删除段（全空白 token）与插入段合并后 a 侧 shrink 为空但区间非零宽
    //（aFrom<aTo）——注释不变量「纯新增段 aFrom===aTo」的反例。旧路径按
    // 纯新增裸插 insertText，被删空白仍留在源稿，采纳得 'A x   B'（空白
    // 重复、违背逐字节还原契约）；修复后按替换处理，左右均取未收缩区间。
    const a = 'A  B';
    const b = 'A x B';
    const paired = diffWordPaired(a, b);
    expect(paired).toHaveLength(1);
    const p = paired[0]!;
    expect(p.left).toEqual({ from: 1, to: 3 });
    expect(p.right).toEqual({ from: 1, to: 4 });
    expect(p.insertAt).toBeUndefined();
    expect(p.insertText).toBeUndefined();
    // 替换语义逐字节还原 b
    expect(
      a.slice(0, p.left!.from) + b.slice(p.right!.from, p.right!.to) + a.slice(p.left!.to),
    ).toBe(b);
  });

  it('双侧全空白差异段仍不出对（纯空白改动对批注不可见）', () => {
    // 'A  B' → 'A B'：删除双空格 + 插入单空格，两侧 shrink 皆空 → 无配对
    const paired = diffWordPaired('A  B', 'A B');
    expect(paired).toEqual([]);
  });
});

describe('diffSequences', () => {
  it('序列对齐给出等价/删/增段且覆盖全部下标', () => {
    const a = ['A', 'B', 'C', 'D'];
    const b = ['A', 'X', 'C', 'D'];
    const segs = diffSequences(a, b, (s) => s);
    expect(segs[0]).toMatchObject({ op: 0, aFrom: 0, aTo: 1, bFrom: 0, bTo: 1 });
    expect(segs.some((s) => s.op === -1 && s.aFrom === 1 && s.aTo === 2)).toBe(true);
    expect(segs.some((s) => s.op === 1 && s.bFrom === 1 && s.bTo === 2)).toBe(true);
    const last = segs[segs.length - 1]!;
    expect(last).toMatchObject({ op: 0, aTo: 4, bTo: 4 });
  });

  it('超字母表容量回退整删整增', () => {
    const a = Array.from({ length: 70000 }, (_, i) => `t${i}`);
    const b = ['x'];
    const segs = diffSequences(a, b, (s) => s);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ op: -1, aFrom: 0, aTo: 70000 });
    expect(segs[1]).toMatchObject({ op: 1, bFrom: 0, bTo: 1 });
  });
});
