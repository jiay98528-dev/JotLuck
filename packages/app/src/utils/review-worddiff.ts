/**
 * 改稿模式共享：词级 diff 与序列对齐（token→BMP 字符映射 + diff-match-patch）。
 *
 * 两个坐标系共用：
 *   - review-diff.ts 在「源码坐标」上做块内词级 diff（马克笔 Decoration 区间来源）；
 *   - review-dom-annotator.ts 在「可见文本坐标」上做同样的事（渲染结果内嵌标记来源）。
 *
 * 实现要点：
 *   - token 化：Han/假名逐字、拉丁词连写、空白与标点各自成段；
 *   - 唯一 token 映射到 BMP 单字符（避开代理区），dmp 的 diff 粒度天然落在
 *     token 级、绝不切进 token 内部；
 *   - 唯一 token 数超上限时回退「整删+整增」两段（极端长文档兜底）；
 *   - 遍历 mapped diff 按「码点」步进（for...of），代理对安全；
 *   - 相邻变更段之间 ≤ mergeGap 个等价 token 时对称合并，避免马克笔碎片化；
 *   - span 投影在下标空间完成后再转偏移，边缘收缩不包纯空白 token。
 */

import { diff_match_patch, DIFF_DELETE, DIFF_INSERT } from './vendor/diff_match_patch.js';

/** 半开区间 [from, to)，坐标为传入文本自身的 UTF-16 偏移 */
export interface WordDiffSpan {
  from: number;
  to: number;
}

export interface WordDiffSpans {
  /** a 侧（左侧/源稿）被改动或删除的区间，升序不重叠 */
  left: WordDiffSpan[];
  /** b 侧（右侧/工作稿）被改动或新增的区间，升序不重叠 */
  right: WordDiffSpan[];
}

interface Token {
  text: string;
  from: number;
  to: number;
}

/** 序列 diff 的对齐段：op∈{-1 删,0 等,1 增}，区间为两侧数组下标（半开） */
export interface SeqDiffSegment {
  op: -1 | 0 | 1;
  aFrom: number;
  aTo: number;
  bFrom: number;
  bTo: number;
}

const DMP = new diff_match_patch();
DMP.Diff_Timeout = 5;

/** token 化正则：Han/假名逐字 → 拉丁词（含撇号/连字符）→ 空白段 → 其余单字符成段 */
const TOKEN_RE =
  /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*|\s+|[^\s]/gu;

/** 映射字符区间：[0x0100, 0xFFFF]，中间跳过代理区 0xD800-0xDFFF */
const MAP_START = 0x0100;
const MAP_LIMIT = 0xffff;

export function tokenizeText(text: string): Token[] {
  const tokens: Token[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    tokens.push({ text: m[0], from: m.index, to: m.index + m[0].length });
  }
  return tokens;
}

/**
 * 通用序列对齐：把序列项按 keyOf 映射成单字符后交给 dmp。
 * 返回段序列覆盖两侧全部下标（等价段与变更段交替，相邻同向已合并）。
 */
export function diffSequences<T>(
  a: readonly T[],
  b: readonly T[],
  keyOf: (item: T) => string,
): SeqDiffSegment[] {
  if (a.length === 0 && b.length === 0) return [];
  const alphabet = new Map<string, number>();
  let next = MAP_START;
  const encode = (items: readonly T[]): string | null => {
    let out = '';
    for (const item of items) {
      let code = alphabet.get(keyOf(item));
      if (code === undefined) {
        if (next > MAP_LIMIT) return null;
        code = next++;
        if (code === 0xd800) {
          code = 0xe000;
          next = 0xe001;
        }
        alphabet.set(keyOf(item), code);
      }
      out += String.fromCharCode(code);
    }
    return out;
  };
  const charsA = encode(a);
  const charsB = encode(b);
  // 字母表超容（唯一 token 过多）：整体替换兜底，保证调用方拿到可用结果
  if (charsA === null || charsB === null) {
    const segments: SeqDiffSegment[] = [];
    if (a.length > 0) segments.push({ op: -1, aFrom: 0, aTo: a.length, bFrom: 0, bTo: 0 });
    if (b.length > 0)
      segments.push({ op: 1, aFrom: a.length, aTo: a.length, bFrom: 0, bTo: b.length });
    return segments;
  }
  // 上游 master 的 Diff 实例是 {0,1} 类数组对象（非真数组，元素不可解构/迭代），
  // 此处经下标访问转成真元组，后续代码即可安全解构。
  const raw = DMP.diff_main(charsA, charsB, false);
  DMP.diff_cleanupSemantic(raw);
  const diffs: Array<[-1 | 0 | 1, string]> = [];
  for (let i = 0; i < raw.length; i++) {
    const d = raw[i]!;
    diffs.push([d[0], d[1]]);
  }
  const segments: SeqDiffSegment[] = [];
  let ia = 0;
  let ib = 0;
  for (const [op, text] of diffs) {
    const count = [...text].length;
    if (op === DIFF_DELETE) {
      segments.push({ op: -1, aFrom: ia, aTo: ia + count, bFrom: ib, bTo: ib });
      ia += count;
    } else if (op === DIFF_INSERT) {
      segments.push({ op: 1, aFrom: ia, aTo: ia, bFrom: ib, bTo: ib + count });
      ib += count;
    } else {
      segments.push({ op: 0, aFrom: ia, aTo: ia + count, bFrom: ib, bTo: ib + count });
      ia += count;
      ib += count;
    }
  }
  return mergeAdjacent(segments);
}

/** 相邻且下标连续的同向段合并 */
function mergeAdjacent(segments: SeqDiffSegment[]): SeqDiffSegment[] {
  const out: SeqDiffSegment[] = [];
  for (const seg of segments) {
    const prev = out[out.length - 1];
    if (prev && prev.op === seg.op && prev.aTo === seg.aFrom && prev.bTo === seg.bFrom) {
      prev.aTo = seg.aTo;
      prev.bTo = seg.bTo;
    } else {
      out.push({ ...seg });
    }
  }
  return out;
}

/**
 * 成对词级 diff：按变更段顺序给出左右区间配对（hunk 构造用）。
 * replace 段两侧都有；纯删除段只有 left；纯新增段只有 right。
 */
export interface PairedWordDiff {
  left?: WordDiffSpan;
  right?: WordDiffSpan;
  /**
   * 纯新增段（无 left）的 a 侧精确插入点（a 文本 UTF-16 偏移）：
   * = 段级对齐下标处 a 侧 token 的起点（对齐点在 a 末尾时取 a.length）。
   * 采纳（applyHunkToSource 的 insert 路径）用它把新增文字落在用户实际
   * 输入位置，而不是退化为配对块起点（近似值会导致采纳错位、diff 不收敛）。
   */
  insertAt?: number;
  /**
   * 纯新增段的未收缩插入字节（含段边缘空白，b 文本原文切片）。
   * right span 被 shrink 收缩掉边缘空白（马克笔贴词），采纳若用收缩文本
   * 会丢失空白导致拼贴粘连；insertText 保证逐字节还原 b 侧 → 采纳收敛。
   */
  insertText?: string;
}

export function diffWordPaired(
  a: string,
  b: string,
  opts: { mergeGap?: number } = {},
): PairedWordDiff[] {
  return computePaired(a, b, opts.mergeGap ?? 2);
}

/**
 * 词级 diff：返回两侧各自应打马克笔的区间（a 侧=删除/修改处，b 侧=修改/新增处）。
 * mergeGap：两处变更之间的等价 token 数 ≤ 该值时合并为一处（默认 2）。
 */
export function diffWordSpans(
  a: string,
  b: string,
  opts: { mergeGap?: number } = {},
): WordDiffSpans {
  const paired = computePaired(a, b, opts.mergeGap ?? 2);
  const left: WordDiffSpan[] = [];
  const right: WordDiffSpan[] = [];
  for (const pair of paired) {
    if (pair.left) left.push(pair.left);
    if (pair.right) right.push(pair.right);
  }
  return { left, right };
}

function computePaired(a: string, b: string, mergeGap: number): PairedWordDiff[] {
  if (a === b) return [];
  const tokensA = tokenizeText(a);
  const tokensB = tokenizeText(b);
  const segments = diffSequences(tokensA, tokensB, (t) => t.text);

  // 把夹在两段变更之间、长度 ≤ mergeGap 的等价段对称并入前段，
  // 随后相邻变更段按连续性拼接（替换段 = 删段+增段共有的区间投影）。
  const merged: SeqDiffSegment[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (seg.op === 0) {
      const prev = merged[merged.length - 1];
      const next = segments[i + 1];
      const microBetween =
        prev !== undefined &&
        prev.op !== 0 &&
        next !== undefined &&
        next.op !== 0 &&
        seg.aTo - seg.aFrom <= mergeGap;
      if (microBetween) {
        prev.aTo = seg.aTo;
        prev.bTo = seg.bTo;
        continue;
      }
      merged.push({ ...seg });
      continue;
    }
    const prev = merged[merged.length - 1];
    if (prev !== undefined && prev.op !== 0 && prev.aTo === seg.aFrom && prev.bTo === seg.bFrom) {
      prev.aTo = seg.aTo;
      prev.bTo = seg.bTo;
    } else {
      merged.push({ ...seg });
    }
  }

  // 成对输出：按变更段逐一投影（不做跨段合并，保证左右配对精确对应）
  const shrink = (tokens: Token[], from: number, to: number): WordDiffSpan | undefined => {
    let i = from;
    let j = to;
    while (j > i && tokens[j - 1]!.text.trim() === '') j--;
    while (j > i && tokens[i]!.text.trim() === '') i++;
    if (j <= i) return undefined;
    return { from: tokens[i]!.from, to: tokens[j - 1]!.to };
  };

  const paired: PairedWordDiff[] = [];
  for (const seg of merged) {
    if (seg.op === 0) continue;
    const left = shrink(tokensA, seg.aFrom, seg.aTo);
    const right = shrink(tokensB, seg.bFrom, seg.bTo);
    if (!left && !right) continue;
    // 纯新增段（left 缺失，aFrom===aTo 恒成立——吸收过等价微段的段 a 侧
    // 非退化、必然带上 left 走 modify 路径）：附精确插入点 + 未收缩字节。
    // b = a 前缀 + insertText + a 后缀（dmp 等价段文本逐字相等），在
    // insertAt 处裸插 insertText 可逐字节还原 b。
    paired.push(
      left
        ? { left, right }
        : {
            right,
            insertAt: seg.aFrom < tokensA.length ? tokensA[seg.aFrom]!.from : a.length,
            insertText: b.slice(tokensB[seg.bFrom]!.from, tokensB[seg.bTo - 1]!.to),
          },
    );
  }
  return paired;
}
