/**
 * 手写类型声明 — vendored 原文件不带类型，仅覆盖宿主用到的公共面。
 * 常量为字面量类型（DIFF_DELETE=-1 / DIFF_INSERT=1 / DIFF_EQUAL=0）。
 */

export type DiffOp = -1 | 0 | 1;
/**
 * 注意：上游 master 分支用 new diff_match_patch.Diff(op, text) 构造元组，
 * 运行时是带 {0, 1} 数字键的类数组对象，不是真数组——只能下标访问（d[0]/d[1]），
 * 不能对元素解构或迭代。需要真元组时在宿主侧自行转换（见 review-worddiff.ts）。
 */
export type Diff = readonly [DiffOp, string];

export declare const DIFF_DELETE: -1;
export declare const DIFF_INSERT: 1;
export declare const DIFF_EQUAL: 0;

export declare class diff_match_patch {
  /** 超过该秒数（float）后放弃 refine，直接给出可行 diff。默认 1.0。 */
  Diff_Timeout: number;
  diff_main(text1: string, text2: string, opt_checklines?: boolean, opt_deadline?: number): Diff[];
  diff_cleanupSemantic(diffs: Diff[]): void;
  diff_cleanupEfficiency(diffs: Diff[]): void;
  diff_cleanupMerge(diffs: Diff[]): void;
  diff_linesToChars(
    text1: string,
    text2: string,
  ): { chars1: string; chars2: string; lineArray: string[] };
  diff_charsToLines(diffs: Diff[], lineArray: string[]): void;
}
