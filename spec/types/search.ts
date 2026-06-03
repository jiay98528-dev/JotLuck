/**
 * MarkLuck — 搜索相关 TypeScript 类型定义
 *
 * 涵盖：搜索查询、搜索结果、搜索匹配、倒排索引结构、日期范围过滤。
 * 索引数据存储在笔记本根目录的 `.markluck_index.json` 中。
 *
 * @module spec/types/search
 */

// ---------------------------------------------------------------------------
// DateRange
// ---------------------------------------------------------------------------

/**
 * 日期范围过滤条件。
 * 用于限定搜索的时间窗口，start/end 均可选：
 * - 仅 start → 从指定日期开始至今
 * - 仅 end   → 截止到指定日期
 * - 两者都填 → 闭区间
 */
export interface DateRange {
  /** 起始日期（ISO 8601 格式，如 "2026-01-01" 或 "2026-01-01T00:00:00Z"） */
  readonly start?: string;
  /** 结束日期（ISO 8601 格式） */
  readonly end?: string;
}

// ---------------------------------------------------------------------------
// SearchQuery
// ---------------------------------------------------------------------------

/**
 * 一次搜索请求的完整参数。
 *
 * 文本查询与过滤条件可以任意组合。如果同时提供 text 和 regex，
 * 优先使用 regex（text 降级为辅助关键词）。
 */
export interface SearchQuery {
  /** 全文搜索的关键词文本 */
  readonly text: string;

  /** 正则表达式模式（作为字符串传递，由搜索后端编译）。置空则退化为文本搜索 */
  readonly regex?: string;

  /** 限定标签列表 —— 结果笔记必须包含 **所有** 指定标签 */
  readonly tags?: readonly string[];

  /** 按创建/修改日期范围过滤 */
  readonly dateRange?: DateRange;

  /** 限定搜索范围到某个子文件夹（相对于笔记本根目录的路径） */
  readonly folder?: string;

  /** 返回结果的最大条数（分页用，默认 20） */
  readonly limit?: number;

  /** 结果偏移量（分页用，默认 0） */
  readonly offset?: number;
}

// ---------------------------------------------------------------------------
// SearchMatch
// ---------------------------------------------------------------------------

/**
 * 单条命中记录，描述关键词在笔记中出现的位置与上下文。
 */
export interface SearchMatch {
  /** 命中的行号（从 1 开始计数） */
  readonly line: number;

  /** 命中的列号（从 1 开始计数） */
  readonly column: number;

  /** 匹配到的原文片段 */
  readonly text: string;

  /**
   * 命中行的前后上下文文本（用于搜索结果预览）。
   * 建议长度：命中位置前后各 40 字符。
   */
  readonly context: string;
}

// ---------------------------------------------------------------------------
// SearchResult
// ---------------------------------------------------------------------------

/**
 * 搜索返回的单条结果，对应一篇命中的笔记及其匹配详情。
 */
export interface SearchResult {
  /** 笔记文件路径（相对于笔记本根目录） */
  readonly notePath: string;

  /** 笔记标题（从 frontmatter 的 title 或首个 h1 提取，降级为文件名） */
  readonly noteTitle: string;

  /** 该笔记中的所有命中位置 */
  readonly matches: readonly SearchMatch[];

  /**
   * 相关性评分（0-1），由搜索后端根据 TF-IDF / BM25 等算法计算。
   * 结果列表按此字段降序排列。
   */
  readonly score: number;
}

// ---------------------------------------------------------------------------
// 倒排索引 — SearchIndex (存储在 .markluck_index.json 中)
// ---------------------------------------------------------------------------

/**
 * 倒排索引中的单条过帐记录。
 *
 * 一条过帐记录代表某个词条（Term）在某一篇文档中的出现情况：
 * - docPath   → 文档引用
 * - positions → 该词条在这篇文档中出现的位置列表（字符偏移量）
 * - termFrequency → 该词条在这篇文档中出现的总次数
 */
export interface Posting {
  /** 文档路径（对应 DocumentEntry.path） */
  readonly docPath: string;

  /** 该词条在此文档中出现的总次数（用于 TF-IDF / BM25 计分） */
  readonly termFrequency: number;

  /** 该词条在此文档中出现的位置列表（字符偏移量，从 0 开始） */
  readonly positions: readonly number[];
}

/**
 * 倒排索引中一个词条的入口。
 *
 * 每个词条维护一条过帐列表（Posting List），
 * 记录包含该词条的所有文档及位置信息。
 */
export interface TermEntry {
  /** 过帐列表 —— 包含此词条的所有文档 */
  readonly postings: readonly Posting[];
}

/**
 * 索引中的单篇文档元数据。
 *
 * 记录每篇笔记的结构化信息，用于搜索结果展示和过滤（标签、日期、文件夹）。
 * 由索引构建器在扫描 .md 文件时提取。
 */
export interface DocumentEntry {
  /** 笔记文件相对路径（作为文档唯一标识） */
  readonly path: string;

  /** 笔记标题（提取优先级：frontmatter.title > 首个 h1 > 文件名去扩展名） */
  readonly title: string;

  /** 综合标签列表（frontmatter tags + 正文内 #tag 合并去重） */
  readonly tags: readonly string[];

  /** 创建日期（ISO 8601），从 frontmatter.created 或文件创建时间获取 */
  readonly createdAt: string;

  /** 最后修改日期（ISO 8601），从 frontmatter.modified 或文件修改时间获取 */
  readonly modifiedAt: string;

  /** 总字数（用于结果排序和索引统计） */
  readonly wordCount: number;

  /** 出链列表 —— 该笔记中所有 [[wiki-link]] 指向的目标笔记名 */
  readonly outgoingLinks: readonly string[];
}

/**
 * 完整的搜索倒排索引结构。
 *
 * 持久化到笔记本根目录的 `.markluck_index.json` 中。
 * 包含两部分核心数据：
 * 1. `documents`     — 文档元数据索引（按路径查找文档信息）
 * 2. `invertedIndex` — 词条 → 过帐列表（支持快速全文检索）
 *
 * 索引构建策略（增量更新）：
 * - 通过 notify crate 监听文件系统变更
 * - 仅重新扫描已变更的 .md 文件
 * - 合并增量结果到现有索引
 * - 提供"重建索引"按钮以修复不一致
 *
 * 序列化注意事项：
 * - positions 数组可能较大（长文档中高频词），JSON 序列化时考虑压缩
 * - 对于 1000 篇以下笔记的规模，完整 JSON 反序列化到内存是可接受的
 */
export interface SearchIndex {
  /** 索引格式版本号（用于向前兼容，当前为 "1.0"） */
  readonly version: string;

  /** 索引最后更新时间（ISO 8601） */
  readonly lastUpdated: string;

  /** 文档元数据字典 —— key 为文档相对路径 */
  readonly documents: Record<string, DocumentEntry>;

  /** 倒排索引 —— key 为归一化后的词条，value 为该词条的过帐列表 */
  readonly invertedIndex: Record<string, TermEntry>;
}
