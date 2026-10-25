import { describe, expect, it } from 'vitest';

import { computeReviewDiff } from '../review-diff';
import { applyHunkToSource } from '../../services/review-session-store';

describe('computeReviewDiff', () => {
  it('完全相同 → 空数组', () => {
    const doc = '# 标题\n\n第一段文字\n\n- 项目 A\n- 项目 B\n';
    expect(computeReviewDiff(doc, doc)).toEqual([]);
  });

  it('两侧都是空文档 → 空数组', () => {
    expect(computeReviewDiff('', '')).toEqual([]);
  });

  it('段内改词 → 单 modify hunk 且 slice 回切文本正确', () => {
    const source = '今天天气真的很不错';
    const working = '今天天气真的很糟糕';
    const hunks = computeReviewDiff(source, working);
    expect(hunks).toHaveLength(1);
    const hunk = hunks[0]!;
    expect(hunk.type).toBe('modify');
    expect(hunk.id).toBe('hunk-1');
    expect(hunk.leftText).toBe('不错');
    expect(hunk.rightText).toBe('糟糕');
    expect(source.slice(hunk.leftRange!.from, hunk.leftRange!.to)).toBe('不错');
    expect(working.slice(hunk.rightRange!.from, hunk.rightRange!.to)).toBe('糟糕');
  });

  it('段内两处远距离改动 → 2 个 hunk', () => {
    const source = '开头我们讨论第一个话题，中间有大量的填充内容，最后我们收尾最后一个话题。';
    const working = '开头我们聊聊第一个话题，中间有大量的填充内容，最后我们总结最后一个话题。';
    const hunks = computeReviewDiff(source, working);
    expect(hunks).toHaveLength(2);
    expect(hunks.map((h) => h.type)).toEqual(['modify', 'modify']);
    expect(hunks.map((h) => h.id)).toEqual(['hunk-1', 'hunk-2']);
    expect(hunks[0]!.leftText).toBe('讨论');
    expect(hunks[0]!.rightText).toBe('聊聊');
    expect(hunks[1]!.leftText).toBe('收尾');
    expect(hunks[1]!.rightText).toBe('总结');
  });

  it('整段新增 → 整块 insert hunk，锚点 = 前等价块 range.to', () => {
    const source = 'para one\n\npara two';
    const working = 'para one\n\npara two\n\npara three';
    const hunks = computeReviewDiff(source, working);
    expect(hunks).toHaveLength(1);
    const hunk = hunks[0]!;
    expect(hunk.type).toBe('insert');
    expect(hunk.leftText).toBe('');
    expect(hunk.rightText).toBe('para three');
    expect(hunk.leftRange).toBeUndefined();
    expect(working.slice(hunk.rightRange!.from, hunk.rightRange!.to)).toBe('para three');
    // 前等价块（para two）的 range.to = 'para two' 结束位置
    expect(hunk.leftAnchor).toBe(source.length);
  });

  it('段中插入新块 → leftAnchor = 前一个等价块的 range.to', () => {
    const source = 'para one\n\npara two';
    const working = 'para one\n\nNEW PARA\n\npara two';
    const hunks = computeReviewDiff(source, working);
    expect(hunks).toHaveLength(1);
    const hunk = hunks[0]!;
    expect(hunk.type).toBe('insert');
    expect(hunk.rightText).toBe('NEW PARA');
    // 前等价块 = para one 后的空行块，其 range.to = 空行结束（'para two' 前一位）
    expect(hunk.leftAnchor).toBe(source.indexOf('para two') - 1);
  });

  it('文档开头新增块 → leftAnchor = 0', () => {
    const source = 'para one\n\npara two';
    const working = 'NEW HEAD\n\npara one\n\npara two';
    const hunks = computeReviewDiff(source, working);
    expect(hunks).toHaveLength(1);
    const hunk = hunks[0]!;
    expect(hunk.type).toBe('insert');
    expect(hunk.rightText).toBe('NEW HEAD');
    expect(hunk.leftAnchor).toBe(0);
  });

  it('整段删除 → 整块 delete hunk（带 blockLevelDelete 旗标）', () => {
    const source = 'para one\n\npara two\n\npara three';
    const working = 'para one\n\npara two';
    const hunks = computeReviewDiff(source, working);
    expect(hunks).toHaveLength(1);
    const hunk = hunks[0]!;
    expect(hunk.type).toBe('delete');
    expect(hunk.leftText).toBe('para three');
    expect(hunk.rightText).toBe('');
    expect(hunk.rightRange).toBeUndefined();
    // 块级整块删除：丢弃时按块语义补空行分隔（与 insert 侧 blockLevelInsert 对称）
    expect(hunk.blockLevelDelete).toBe(true);
    expect(source.slice(hunk.leftRange!.from, hunk.leftRange!.to)).toBe('para three');
  });

  it('标题修改 → 词级 modify', () => {
    const source = '# 旧标题\n\n正文内容';
    const working = '# 新标题\n\n正文内容';
    const hunks = computeReviewDiff(source, working);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.type).toBe('modify');
    expect(hunks[0]!.leftText).toBe('旧');
    expect(hunks[0]!.rightText).toBe('新');
    expect(source.slice(hunks[0]!.leftRange!.from, hunks[0]!.leftRange!.to)).toBe('旧');
  });

  it('列表项改动 → 仅该列表项所在块出 hunk', () => {
    const source = '- 买酱油\n- 买食盐\n- 买醋';
    const working = '- 买酱油\n- 买精盐\n- 买醋';
    const hunks = computeReviewDiff(source, working);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.type).toBe('modify');
    expect(source.slice(hunks[0]!.leftRange!.from, hunks[0]!.leftRange!.to)).toBe('食');
    expect(working.slice(hunks[0]!.rightRange!.from, hunks[0]!.rightRange!.to)).toBe('精');
  });

  it('表格内容改动 → modify hunk 且全文偏移正确', () => {
    const source = '| 项目 | 数量 |\n| --- | --- |\n| 苹果 | 3 |\n| 香蕉 | 5 |';
    const working = '| 项目 | 数量 |\n| --- | --- |\n| 苹果 | 3 |\n| 车厘子 | 5 |';
    const hunks = computeReviewDiff(source, working);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.type).toBe('modify');
    expect(hunks[0]!.leftText).toBe('香蕉');
    expect(hunks[0]!.rightText).toBe('车厘子');
    expect(source.slice(hunks[0]!.leftRange!.from, hunks[0]!.leftRange!.to)).toBe('香蕉');
    expect(working.slice(hunks[0]!.rightRange!.from, hunks[0]!.rightRange!.to)).toBe('车厘子');
  });

  it('代码围栏内容改动 → 围栏块内词级 modify', () => {
    const source = '```ts\nconst a = 1;\nconst b = 2;\n```';
    const working = '```ts\nconst a = 1;\nconst b = 20;\n```';
    const hunks = computeReviewDiff(source, working);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.type).toBe('modify');
    expect(hunks[0]!.leftText).toBe('2');
    expect(hunks[0]!.rightText).toBe('20');
  });

  it('围栏不变时不受他处改动影响', () => {
    const fence = '```ts\nconst a = 1;\n```';
    const source = `${fence}\n\n导语段落`;
    const working = `${fence}\n\n导语段落（已修订）`;
    const hunks = computeReviewDiff(source, working);
    expect(hunks).toHaveLength(1);
    const hunk = hunks[0]!;
    expect(hunk.type).toBe('insert');
    expect(hunk.leftText).toBe('');
    expect(hunk.rightText).toBe('（已修订）');
    expect(working.slice(hunk.rightRange!.from, hunk.rightRange!.to)).toBe('（已修订）');
    // 块内纯新增段（段尾新增）：精确锚点 = 配对块起点 + 段级对齐下标，
    // 段尾对齐点即块末尾（历史近似实现曾退化为块起点，采纳错位不收敛）
    const paraFrom = source.indexOf('导语段落');
    const paraTo = paraFrom + '导语段落'.length;
    expect(hunk.leftAnchor).toBe(paraTo);
  });

  it('块内段中词级新增 → leftAnchor = 块起点 + 段级对齐下标（精确插入位）', () => {
    const source = '第一段甲乙\n\n第二段丙丁';
    const working = '第一段甲新乙\n\n第二段丙丁';
    const hunks = computeReviewDiff(source, working);
    expect(hunks).toHaveLength(1);
    const hunk = hunks[0]!;
    expect(hunk.type).toBe('insert');
    expect(hunk.rightText).toBe('新');
    // 「新」在「甲」与「乙」之间：块起点 0 + 对齐下标 4（词级新增非块级）
    expect(hunk.leftAnchor).toBe(4);
    expect(hunk.blockLevelInsert).toBeUndefined();
  });

  it('frontmatter 变化 → 词级 modify', () => {
    const source = '---\ntitle: 旧题\n---\n\n正文段落';
    const working = '---\ntitle: 新题\n---\n\n正文段落';
    const hunks = computeReviewDiff(source, working);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.type).toBe('modify');
    expect(hunks[0]!.leftText).toBe('旧');
    expect(hunks[0]!.rightText).toBe('新');
    expect(source.slice(hunks[0]!.leftRange!.from, hunks[0]!.leftRange!.to)).toBe('旧');
  });

  it('工作稿一侧为空串 → 整批 delete hunks', () => {
    const source = 'para one\n\npara two';
    const hunks = computeReviewDiff(source, '');
    expect(hunks.map((h) => h.type)).toEqual(['delete', 'delete']);
    expect(hunks.map((h) => h.leftText)).toEqual(['para one', 'para two']);
    for (const hunk of hunks) {
      expect(source.slice(hunk.leftRange!.from, hunk.leftRange!.to)).toBe(hunk.leftText);
      expect(hunk.rightRange).toBeUndefined();
      expect(hunk.rightText).toBe('');
      expect(hunk.leftAnchor).toBeUndefined();
    }
  });

  it('源稿一侧为空串 → 整批 insert hunks', () => {
    const working = 'para one\n\npara two';
    const hunks = computeReviewDiff('', working);
    expect(hunks.map((h) => h.type)).toEqual(['insert', 'insert']);
    expect(hunks.map((h) => h.rightText)).toEqual(['para one', 'para two']);
    for (const hunk of hunks) {
      expect(working.slice(hunk.rightRange!.from, hunk.rightRange!.to)).toBe(hunk.rightText);
      expect(hunk.leftRange).toBeUndefined();
      expect(hunk.leftText).toBe('');
    }
  });

  it('emoji（代理对）偏移按 UTF-16 码元计', () => {
    const source = '😀😀 待办';
    const working = '😀 待办！';
    const hunks = computeReviewDiff(source, working);
    expect(hunks).toHaveLength(2);
    const [delHunk, insHunk] = hunks;
    expect(delHunk!.type).toBe('delete');
    expect(delHunk!.leftText).toBe('😀');
    expect(delHunk!.leftRange).toEqual({ from: 0, to: 2 });
    expect(source.slice(delHunk!.leftRange!.from, delHunk!.leftRange!.to)).toBe('😀');
    expect(insHunk!.type).toBe('insert');
    expect(working.slice(insHunk!.rightRange!.from, insHunk!.rightRange!.to)).toBe('！');
  });

  it('中文多段混合场景 → hunk 全序正确（from 递增）', () => {
    const source = [
      '第一段讨论内容甲。',
      '',
      '第二段保持不变。',
      '',
      '第三段讨论内容乙。',
      '',
      '第四段整段删除。',
      '',
      '第五段保持不变。',
    ].join('\n');
    const working = [
      '第一段讨论内容丙。',
      '',
      '第二段保持不变。',
      '',
      '第三段讨论内容丁。',
      '',
      '第五段保持不变。',
      '',
      '第六段全新增加。',
    ].join('\n');
    const hunks = computeReviewDiff(source, working);
    expect(hunks.map((h) => h.type)).toEqual(['modify', 'modify', 'delete', 'insert']);
    expect(hunks.map((h) => h.id)).toEqual(['hunk-1', 'hunk-2', 'hunk-3', 'hunk-4']);
    expect(hunks[0]!.leftText).toBe('甲');
    expect(hunks[0]!.rightText).toBe('丙');
    expect(hunks[1]!.leftText).toBe('乙');
    expect(hunks[1]!.rightText).toBe('丁');
    expect(hunks[2]!.leftText).toBe('第四段整段删除。');
    expect(hunks[3]!.rightText).toBe('第六段全新增加。');
    // 全序：左稿侧 from 递增、右稿侧 from 递增（insert/delete hunk 只带单侧区间，按侧过滤）
    const leftFroms = hunks.filter((h) => h.leftRange !== undefined).map((h) => h.leftRange!.from);
    expect([...leftFroms].sort((a, b) => a - b)).toEqual(leftFroms);
    const rightFroms = hunks
      .filter((h) => h.rightRange !== undefined)
      .map((h) => h.rightRange!.from);
    expect([...rightFroms].sort((a, b) => a - b)).toEqual(rightFroms);
    // 所有区间 slice 回切与摘录一致
    for (const hunk of hunks) {
      if (hunk.leftRange) {
        expect(source.slice(hunk.leftRange.from, hunk.leftRange.to)).toBe(hunk.leftText);
      }
      if (hunk.rightRange) {
        expect(working.slice(hunk.rightRange.from, hunk.rightRange.to)).toBe(hunk.rightText);
      }
    }
  });

  it('混合运行区（改一段+加一段）→ 整块新增锚点 = 末配对块 range.to 而非区首', () => {
    const source = '甲段落\n\n末段落';
    const working = '乙段落\n\n新增段落\n\n末段落';
    const hunks = computeReviewDiff(source, working);
    // 运行区：配对（甲段落↔乙段落）出词级 modify，多余整块「新增段落」出 insert
    expect(hunks.map((h) => h.type)).toEqual(['modify', 'insert']);
    const insertHunk = hunks[1]!;
    expect(insertHunk.rightText).toBe('新增段落');
    expect(insertHunk.blockLevelInsert).toBe(true);
    // 锚点 = 末配对块（甲段落）的 range.to（=3），而非运行区起点（regionAnchor=0）：
    // 锚在区首会把新块插到被改块之前，与工作稿顺序（乙段落在新增段落之前）相悖
    expect(insertHunk.leftAnchor).toBe('甲段落'.length);
  });

  it('混合运行区（前有等价块）：整块新增锚点仍 = 末配对块 range.to', () => {
    const source = '前段落\n\n甲段落\n\n末段落';
    const working = '前段落\n\n乙段落\n\n新增段落\n\n末段落';
    const hunks = computeReviewDiff(source, working);
    expect(hunks.map((h) => h.type)).toEqual(['modify', 'insert']);
    const insertHunk = hunks[1]!;
    // 末配对块 = 甲段落（而非运行区前等价块「前段落」）→ 锚点为甲段落 range.to
    const pairedFrom = source.indexOf('甲段落');
    expect(insertHunk.leftAnchor).toBe(pairedFrom + '甲段落'.length);
    expect(insertHunk.leftAnchor).not.toBe(source.indexOf('前段落') + '前段落'.length);
  });

  it('混合运行区整块新增：按锚点降序采纳全部 hunk → 逐字节还原工作稿且重算 diff 收敛', () => {
    const source = '甲段落\n\n末段落';
    const working = '乙段落\n\n新增段落\n\n末段落';
    const hunks = computeReviewDiff(source, working);
    // adoptAll 口径：按源稿锚点降序（从右向左）应用，左侧坐标不因右侧改动漂移
    const anchorOf = (hunk: (typeof hunks)[number]): number =>
      hunk.leftRange?.from ?? hunk.leftAnchor ?? 0;
    const sorted = [...hunks].sort((a, b) => anchorOf(b) - anchorOf(a));
    let adopted = source;
    for (const hunk of sorted) adopted = applyHunkToSource(adopted, hunk, hunks);
    expect(adopted).toBe(working);
    // 收敛承诺：采纳后重算 diff 为 0 hunks（旧区首锚点会得到「NEW 在前」
    // 的错序源稿，重算产生幻影批注不收敛）
    expect(computeReviewDiff(adopted, working)).toEqual([]);
  });

  it('块内空白区间被改写 → modify hunk 替换保真（非纯新增裸插），采纳后收敛', () => {
    // 双空格 → 「 x 」：删除侧全空白，词级配对退化为整段替换（见
    // review-worddiff 的全空白删除段分支），采纳逐字节还原工作稿
    const source = 'A  B';
    const working = 'A x B';
    const hunks = computeReviewDiff(source, working);
    expect(hunks).toHaveLength(1);
    const hunk = hunks[0]!;
    expect(hunk.type).toBe('modify');
    expect(hunk.leftText).toBe('  ');
    expect(hunk.rightText).toBe(' x ');
    const adopted = applyHunkToSource(source, hunk, hunks);
    expect(adopted).toBe(working);
    expect(computeReviewDiff(adopted, working)).toEqual([]);
  });

  it('单块文本超过 20000 字符 → 整块退化为单个 modify hunk', () => {
    const big = 'x'.repeat(20001);
    const source = `${big}.`;
    const working = `y${big}`;
    const hunks = computeReviewDiff(source, working);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.type).toBe('modify');
    expect(hunks[0]!.leftText).toBe(source);
    expect(hunks[0]!.rightText).toBe(working);
    expect(hunks[0]!.leftRange).toEqual({ from: 0, to: source.length });
    expect(hunks[0]!.rightRange).toEqual({ from: 0, to: working.length });
  });
});
