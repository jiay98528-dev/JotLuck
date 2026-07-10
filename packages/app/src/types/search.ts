// ============================================================
// JotLuck — Search Types
// ============================================================
// Source: spec/types/search.ts

/** 日期范围过滤条件 */
export interface DateRange {
  readonly from?: Date;
  readonly to?: Date;
}

/** 一次搜索请求的完整参数 */
export interface SearchQuery {
  readonly text: string;
  readonly regex?: string;
  readonly regexFlags?: string;
  readonly tags?: readonly string[];
  readonly dateRange?: DateRange;
  readonly folder?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/** 单条命中记录 */
export interface SearchMatch {
  readonly line: number;
  readonly column: number;
  readonly text: string;
  readonly context: string;
}

/** 搜索返回的单条结果 */
export interface SearchResult {
  readonly notePath: string;
  readonly noteTitle: string;
  readonly matches: readonly SearchMatch[];
  readonly score: number;
}

/** 倒排索引中的单条过帐记录 */
export interface Posting {
  readonly docPath: string;
  readonly termFrequency: number;
  readonly positions: readonly number[];
}

/** 倒排索引中一个词条的入口 */
export interface TermEntry {
  readonly postings: readonly Posting[];
}

/** 索引中的单篇文档元数据 */
export interface DocumentEntry {
  readonly path: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly created?: number;
  readonly folder?: string;
}

/** 完整的搜索倒排索引结构 */
export interface SearchIndex {
  readonly version: string;
  readonly lastUpdated: string;
  readonly documents: Record<string, DocumentEntry>;
  readonly invertedIndex: Record<string, TermEntry>;
  readonly termIndex?: Record<string, string[]>;
  readonly wikiLinks?: Record<string, string[]>;
  readonly tagIndex?: Record<string, string[]>;
}
