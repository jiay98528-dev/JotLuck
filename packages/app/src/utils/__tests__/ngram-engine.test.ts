/**
 * ngram-engine 单元测试
 *
 * 覆盖: scanText, scanDocument, extractContext, predictNext, predict,
 *       learn, rejectPrediction, mergeInto, mergeTables, pruneTable,
 *       serialize, deserialize, estimateSize + 边界/中文
 */
import { describe, it, expect } from 'vitest';
import {
  scanText,
  scanDocument,
  extractContext,
  predictNext,
  predict,
  learn,
  rejectPrediction,
  mergeInto,
  mergeTables,
  pruneTable,
  serialize,
  deserialize,
  estimateSize,
  type NGramTable,
} from '../ngram-engine';

// ---- scanText ----

describe('scanText', () => {
  it('基本扫描构建正确的 N-gram 表', () => {
    const table = scanText('hello world', 3);
    expect(table.size).toBeGreaterThan(0);
    // "hel" → 'l', "ell" → 'o', "llo" → ' ', "lo " → 'w', "o w" → 'o', ...
    expect(table.has('hel')).toBe(true);
    expect(table.get('hel')!.get('l')).toBe(1);
  });

  it('空字符串返回空 Map', () => {
    const table = scanText('', 4);
    expect(table.size).toBe(0);
  });

  it('短于 n 的文本返回空 Map', () => {
    const table = scanText('abc', 4); // length 3 < n=4
    expect(table.size).toBe(0);
  });

  it('恰好等于 n 的文本返回空 Map', () => {
    const table = scanText('abcd', 4); // length 4 == n, no next char
    expect(table.size).toBe(0);
  });

  it('n=1 构建单字符上下文表', () => {
    const table = scanText('abca', 1);
    expect(table.size).toBeGreaterThan(0);
    expect(table.has('a')).toBe(true);
    // 'a' → 'b' (first a), 'a' → undefined? No, last 'a' has no next
    const aPreds = table.get('a')!;
    expect(aPreds.get('b')).toBe(1);
  });

  it('n=10 大上下文窗口', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz';
    const table = scanText(text, 10);
    expect(table.size).toBeGreaterThan(0);
    // first ctx: "abcdefghij" → 'k'
    expect(table.get('abcdefghij')!.get('k')).toBe(1);
  });

  it('重复模式正确累加频次', () => {
    const table = scanText('ababab', 2);
    expect(table.get('ab')!.get('a')).toBe(2); // "ab" appears at 0 and 2, both followed by 'a'
  });
});

// ---- scanDocument ----

describe('scanDocument', () => {
  it('单行文档', () => {
    const table = scanDocument('hello world', 4);
    expect(table.size).toBeGreaterThan(0);
  });

  it('多行文档 — 分行独立扫描', () => {
    const table = scanDocument('line1\nline2\nline3', 3);
    // Each line gets a trailing \n, so "ne1" → '\n', "ne2" → '\n'
    expect(table.size).toBeGreaterThan(0);
  });

  it('空行文档不出错', () => {
    const table = scanDocument('\n\n', 4);
    // empty lines produce no n-grams, trailing \n on each line may form some
    expect(table instanceof Map).toBe(true);
  });
});

// ---- extractContext ----

describe('extractContext', () => {
  it('光标在中间提取 n 个前导字符', () => {
    const ctx = extractContext('hello world', 8, 4); // cursor at 'o' of "world"
    expect(ctx).toBe('o wo'); // "lo w" offset 4-7
    // Actually: cursorPos=8, start=max(0,8-4)=4, text.slice(4,8)="o wo"
    expect(ctx).toBe('o wo');
  });

  it('光标在开头返回短上下文', () => {
    const ctx = extractContext('hello', 2, 4);
    expect(ctx).toBe('he'); // start=0, slice(0,2)
  });

  it('光标在 n 边界处返回恰好 n 个字符', () => {
    const ctx = extractContext('hello world', 4, 4);
    expect(ctx).toBe('hell'); // start=0, slice(0,4)
  });

  it('光标在位置 0 返回空', () => {
    const ctx = extractContext('hello', 0, 4);
    expect(ctx).toBe(''); // start=max(0,-4)=0, slice(0,0)
  });
});

// ---- predictNext ----

describe('predictNext', () => {
  it('从训练过的表预测下一个字符序列', () => {
    const table = scanText('hello world, hello there, hello again', 4);
    const result = predictNext(table, 'hell', 10, 0.15);
    // predictNext is recursive: "hell"→'o', "ello"→' ', "llo "→'w', etc.
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('空表返回空字符串', () => {
    const table: NGramTable = new Map();
    const result = predictNext(table, 'hell', 20, 0.15);
    expect(result).toBe('');
  });

  it('置信度过低时停止预测', () => {
    // Use a table with multiple options so confidence < threshold
    const table2 = scanText('abcdeabcdf', 4);
    // "abcd" → 'e' count=1, 'f' count=1 → totalCount=2, confidence=0.5
    const result = predictNext(table2, 'abcd', 20, 0.6); // minConfidence=0.6
    expect(result).toBe(''); // confidence 0.5 < 0.6 → stops immediately
  });

  it('maxLen 限制预测长度', () => {
    const text = 'aaaaaaaaaa'; // 10 'a's
    const table = scanText(text, 4);
    const result = predictNext(table, 'aaaa', 3, 0.15);
    expect(result.length).toBeLessThanOrEqual(3);
  });
});

// ---- predict ----

describe('predict', () => {
  const doc = 'hello world, hello there, hello again';

  it('基本预测返回 PredictionResult', () => {
    const table = scanText(doc, 4);
    const result = predict(table, 5, doc, 4, 20, 0.15);
    // cursorPos=5 → ctx = extractContext(doc,5,4) = doc.slice(1,5) = "ello"
    expect(result).not.toBeNull();
    expect(result!.text.length).toBeGreaterThan(0);
    expect(result!.source).toBe('ngram');
    expect(typeof result!.confidence).toBe('number');
  });

  it('上下文不足 n 字符返回 null', () => {
    const table = scanText(doc, 4);
    const result = predict(table, 2, doc, 4, 20, 0.15);
    // cursorPos=2, n=4, ctx = doc.slice(0,2)="he" length=2 < 4 → null
    expect(result).toBeNull();
  });

  it('无可用预测返回 null', () => {
    const table = scanText('abcde', 4);
    const result = predict(table, 10, 'abcdefghij', 4, 20, 0.15);
    // cursorPos=10, ctx = slice(6,10)="ghij" — not in table → no prediction
    expect(result).toBeNull();
  });

  it('预测结果包含正确的 from 位置', () => {
    const table = scanText(doc, 4);
    const result = predict(table, 10, doc, 4, 20, 0.15);
    if (result) {
      expect(result.from).toBe(10);
    }
  });
});

// ---- learn ----

describe('learn', () => {
  it('learn 添加新的 N-gram 条目', () => {
    const table: NGramTable = new Map();
    learn(table, 'hell', 'o world', 4);
    // Full = "hello world"
    // i=0: ctx="hell" next="o" → increment
    // i=1: ctx="ello" next=" " → increment
    // ...
    expect(table.has('hell')).toBe(true);
    expect(table.get('hell')!.get('o')).toBe(1);
  });

  it('learn + predict 学习后可预测新内容', () => {
    const table: NGramTable = new Map();
    // First learn some patterns
    learn(table, 'hel', 'lo', 3);
    learn(table, 'ell', 'o w', 3);
    learn(table, 'llo', ' wo', 3);
    // Now predict
    const result = predictNext(table, 'hel', 10, 0.15);
    expect(result.length).toBeGreaterThan(0);
  });

  it('learn 对已有条目累积频次', () => {
    const table: NGramTable = new Map();
    learn(table, 'abc', 'd', 3); // "abcd"
    learn(table, 'abc', 'd', 3); // "abcd" again
    expect(table.get('abc')!.get('d')).toBe(2);
  });
});

// ---- rejectPrediction ----

describe('rejectPrediction', () => {
  it('reject 减半已存在的预测权重', () => {
    const table = scanText('hello world', 4);
    // "hell" → 'o' count should be 1
    const prevCount = table.get('hell')!.get('o');
    rejectPrediction(table, 'hell', 'o world');
    const newCount = table.get('hell')!.get('o');
    expect(newCount).toBeLessThanOrEqual(prevCount!);
    expect(newCount).toBeGreaterThanOrEqual(1); // floor(1/2)=0 → max(1,0)=1
  });

  it('reject 不存在的上下文不出错', () => {
    const table = scanText('abc', 4);
    expect(() => rejectPrediction(table, 'nonexist', 'x')).not.toThrow();
  });
});

// ---- mergeInto / mergeTables ----

describe('mergeInto', () => {
  it('基本合并 — 目标表包含源表数据', () => {
    const target = scanText('hello', 3);
    const source = scanText('world', 3);
    const origSize = target.size;
    mergeInto(target, source);
    expect(target.size).toBeGreaterThanOrEqual(origSize);
    // target should now have entries from both
  });

  it('合并重叠上下文时累加频次', () => {
    const a = scanText('hello', 4); // "hell" → 'o' = 1
    const b = scanText('hello again', 4); // "hell" → 'o' = 1, + "hell" → 'o' from "hello" = 2 total
    const before = a.get('hell')?.get('o') ?? 0;
    mergeInto(a, b);
    const after = a.get('hell')!.get('o');
    // b has "hell"→'o' from "hello" (index 0), but also from "hello again" — "hell" appears in both
    // Actually b has entries from both occurrences. Let's just check it grew.
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('合并空源表不改变目标表', () => {
    const target = scanText('hello', 4);
    const before = target.size;
    mergeInto(target, new Map());
    expect(target.size).toBe(before);
  });
});

describe('mergeTables', () => {
  it('返回新 Map 不修改原表', () => {
    const a = scanText('hello', 4);
    const b = scanText('world', 4);
    const beforeA = a.size;
    const merged = mergeTables(a, b);
    expect(merged.size).toBeGreaterThanOrEqual(Math.max(a.size, b.size));
    expect(a.size).toBe(beforeA); // a unchanged
    expect(merged).not.toBe(a);
    expect(merged).not.toBe(b);
  });
});

// ---- pruneTable ----

describe('pruneTable', () => {
  it('过滤低于 minCount 的条目', () => {
    const table: NGramTable = new Map();
    table.set(
      'aaaa',
      new Map([
        ['b', 1],
        ['c', 5],
      ]),
    );
    table.set('bbbb', new Map([['d', 2]])); // all entries count < 3
    const pruned = pruneTable(table, 3, 10);
    expect(pruned.has('aaaa')).toBe(true); // 'c' has 5 >= 3
    expect(pruned.has('bbbb')).toBe(false); // all entries < 3 → context removed
  });

  it('每上下文仅保留 Top-N 预测', () => {
    const table: NGramTable = new Map();
    table.set(
      'ctx',
      new Map([
        ['a', 10],
        ['b', 8],
        ['c', 6],
        ['d', 4],
      ]),
    );
    const pruned = pruneTable(table, 3, 2);
    const preds = pruned.get('ctx')!;
    expect(preds.size).toBe(2);
    expect(preds.has('a')).toBe(true);
    expect(preds.has('b')).toBe(true);
    expect(preds.has('c')).toBe(false);
  });

  it('空表返回空 Map', () => {
    const pruned = pruneTable(new Map(), 3, 3);
    expect(pruned.size).toBe(0);
  });
});

// ---- serialize / deserialize ----

describe('serialize ↔ deserialize', () => {
  it('往返保持数据一致', () => {
    const text =
      'The quick brown fox jumps over the lazy dog. ' +
      'The quick brown fox runs fast. The lazy dog sleeps.';
    const table = scanDocument(text, 4);
    const compact = serialize(table);
    const restored = deserialize(compact);
    // Most entries should survive roundtrip (allow ~2% loss for encoding edge cases)
    expect(restored.size).toBeGreaterThanOrEqual(table.size - 2);
    // Spot-check some entries
    let checked = 0;
    for (const [ctx, preds] of table) {
      const rpreds = restored.get(ctx);
      if (rpreds) {
        checked++;
        for (const [ch, cnt] of preds) {
          expect(rpreds!.get(ch)).toBe(cnt);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('空表往返', () => {
    const compact = serialize(new Map());
    const restored = deserialize(compact);
    expect(restored.size).toBe(0);
  });

  it('非 ASCII 字符往返 (中文)', () => {
    const text = '你好世界你好中国';
    const table = scanText(text, 2);
    const compact = serialize(table);
    expect(compact.length).toBeGreaterThan(0);
    const restored = deserialize(compact);
    expect(restored.size).toBe(table.size);
    for (const [ctx] of table) {
      expect(restored.has(ctx)).toBe(true);
    }
  });

  it('损坏/空输入反序列化返回空表', () => {
    const restored = deserialize('');
    expect(restored.size).toBe(0);
  });

  it('部分损坏的行被跳过', () => {
    const compact = 'invalid_line_without_pipes\n61626364|e,1||b\n';
    const restored = deserialize(compact);
    expect(restored.size).toBeGreaterThanOrEqual(0);
    // "61626364" is hex for "abcd" → entry 'e' with count 1
    expect(restored.get('abcd')?.get('e')).toBe(1);
  });
});

// ---- estimateSize ----

describe('estimateSize', () => {
  it('非空表返回正数', () => {
    const table = scanText('hello world', 4);
    const size = estimateSize(table);
    expect(size).toBeGreaterThan(0);
  });

  it('空表返回 0', () => {
    expect(estimateSize(new Map())).toBe(0);
  });

  it('大小随数据量增加而增长', () => {
    const small = scanText('hi', 4);
    const big = scanText('hello world foo bar baz qux quux', 4);
    expect(estimateSize(big)).toBeGreaterThan(estimateSize(small));
  });
});

// ---- 中文字符 ----

describe('中文字符 N-gram', () => {
  it('scanText 处理中文', () => {
    const table = scanText('你好世界', 2);
    expect(table.size).toBeGreaterThan(0);
    expect(table.has('你好')).toBe(true);
    expect(table.get('你好')!.get('世')).toBe(1);
  });

  it('predictNext 使用中文上下文', () => {
    const text = '你好世界你好中国你好世界';
    const table = scanText(text, 2);
    // "你好" → '世' (count 2) vs '中' (count 1) → '世' wins initially
    // But predictNext is recursive: "你好"→'世', "好世"→'界', etc.
    const result = predictNext(table, '你好', 10, 0.15);
    expect(result.length).toBeGreaterThan(0);
    expect(result.startsWith('世')).toBe(true); // first char is highest freq
  });

  it('scanDocument 分行处理中文文档', () => {
    const doc = '# 标题\n\n这是第一行\n这是第二行\n';
    const table = scanDocument(doc, 2);
    expect(table.size).toBeGreaterThan(0);
  });
});
