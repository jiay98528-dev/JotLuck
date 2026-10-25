/**
 * 改稿（审批/批注）模式共享契约 — 主线程钉死的接口层。
 * S1 review-diff / S2 review-marks + review-dom-annotator / S3+S4 工作台与会话按此实现，
 * 改动本文件需同步全部消费方。
 */

/** 批注类型：modify=两侧对应块内文字改动；insert=右侧新增块；delete=右侧删除的源稿块 */
export type ReviewHunkType = 'modify' | 'insert' | 'delete';

/** 半开区间 [from, to)，坐标为所在文档全文的 UTF-16 偏移 */
export interface ReviewRange {
  from: number;
  to: number;
}

/** 一处批注（一个 diff 改动单元），id 在一次 diff 计算内稳定 */
export interface ReviewHunk {
  id: string;
  type: ReviewHunkType;
  /** 源稿侧区间；delete 与 modify 必有，insert 无 */
  leftRange?: ReviewRange;
  /** 工作稿侧区间；insert 与 modify 必有，delete 无 */
  rightRange?: ReviewRange;
  /** insert 类 hunk 采纳时在源稿中的插入锚点（源稿全文偏移）。对齐位置 = 变更运行区前最后一个等价块的 range.to（无前块则 0）。仅 type='insert' 且无 leftRange 时使用。 */
  leftAnchor?: number;
  /**
   * 块级整块新增（type='insert'）：采纳时需按 Markdown 块语义补足空行分隔
   * （rightText 只是段内文字，不含块间空行）；块内词级新增为 false（裸插入）。
   */
  blockLevelInsert?: boolean;
  /**
   * 块级整块删除（type='delete'）：丢弃时需按 Markdown 块语义补足空行分隔
   * （leftText 只是段内文字，不含块间空行），与 blockLevelInsert 对称；
   * 块内词级删除为 false（裸回插，落在段内原位置）。
   */
  blockLevelDelete?: boolean;
  /** 展示用摘录（面板预览）；无该侧内容时为空串 */
  leftText: string;
  rightText: string;
}

/** 马克笔侧别：del=源稿侧红笔（改动/删除的原文），add=工作稿侧绿笔（修改/新增的文字） */
export type ReviewMarkSide = 'del' | 'add';

/** 渲染结果内嵌标记：区间基于目标 DOM 根的聚合可见文本（树序 textContent）坐标 */
export interface VisibleTextMark {
  from: number;
  to: number;
  side: ReviewMarkSide;
}

/** 版本化导出命名规则（导出卡片可自定义） */
export interface ReviewVersionRule {
  /** 版本号前缀，默认 'V' */
  prefix: string;
  /** 首个版本号（默认 1；目录内已有更大号则取最大+1） */
  start: number;
  /** 位数补零：1 → V1，2 → V01，3 → V001 */
  padding: 1 | 2 | 3;
  /** 命名中是否含日期段（YYYY-MM-DD，置于版本号前） */
  includeDate: boolean;
}

export const DEFAULT_REVIEW_VERSION_RULE: ReviewVersionRule = {
  prefix: 'V',
  start: 1,
  padding: 1,
  includeDate: false,
};

/** 会话暂存（localStorage jotluck:review:<path>） */
export interface ReviewSessionSnapshot {
  /** 会话开始时源稿的 revision（sha256:<hex>，来自 TextFileSnapshot） */
  sourceRevision: string;
  /** 工作副本全文 */
  workingText: string;
  savedAt: number;
}
