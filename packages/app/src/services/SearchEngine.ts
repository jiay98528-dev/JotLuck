/**
 * SearchEngine — minisearch 全文搜索引擎封装
 *
 * M2-08, M2-09: 全文本检索 + 高级搜索语法。
 * 支持：纯文本 / 正则 / tag:xxx / date:from..to / folder:xxx
 *
 * @module SearchEngine
 * @see milestones.md M2-08, M2-09
 */

import MiniSearch, { type SearchResult as MiniSearchResult } from 'minisearch';
import type { SearchQuery, SearchResult, DocumentEntry } from '@/types';

/** 搜索字段权重配置 */
const SEARCH_OPTIONS = {
  fields: ['title', 'content'] as string[],
  boost: { title: 3 },
  prefix: true,
  fuzzy: 0.2,
};

/** 文档元数据缓存（minisearch 不暴露内部 store） */
interface DocMeta {
  path: string;
  title: string;
  tags: string[];
}

/** 高级查询解析结果 */
interface ParsedQuery {
  text: string;
  regex: RegExp | null;
  tags: string[];
  dateStart: string | null;
  dateEnd: string | null;
  folder: string | null;
}

export class SearchEngine {
  private engine: MiniSearch | null = null;
  private contentCache = new Map<string, string>();
  private metaCache = new Map<string, DocMeta>();

  /** 构建搜索索引 */
  buildIndex(documents: Record<string, DocumentEntry>): void {
    this.engine = new MiniSearch({
      fields: ['title', 'content'],
      storeFields: ['path', 'title', 'tags'],
      searchOptions: SEARCH_OPTIONS,
    });

    for (const [path, doc] of Object.entries(documents)) {
      this.addToEngine(path, doc.title, doc.tags, '');
    }
  }

  /** 预加载文档内容到索引 */
  async preloadContent(
    documents: Record<string, DocumentEntry>,
    contentProvider: (path: string) => Promise<string>,
  ): Promise<void> {
    for (const path of Object.keys(documents)) {
      try {
        const content = await contentProvider(path);
        this.contentCache.set(path, content);
        const doc = documents[path];
        if (doc && this.engine) {
          try {
            this.engine.discard(path);
          } catch {
            /* new doc */
          }
          this.addToEngine(path, doc.title, doc.tags, content.slice(0, 10000));
        }
      } catch {
        // skip unreadable files
      }
    }
  }

  /** 执行搜索 */
  search(query: SearchQuery): SearchResult[] {
    if (!this.engine) return [];

    const parsed = this.parseAdvancedQuery(query.text);

    // Step 1: 全文搜索（仅有过滤条件时获取全部文档）
    const hasFilters = !!(
      parsed.regex ||
      parsed.tags.length > 0 ||
      parsed.dateStart ||
      parsed.dateEnd ||
      parsed.folder
    );
    let results: MiniSearchResult[];
    if (parsed.text.trim()) {
      results = this.engine.search(parsed.text, SEARCH_OPTIONS);
    } else if (hasFilters) {
      // 无文本但有过滤条件 → 获取全部文档再过滤
      results = this.getAllDocResults();
    } else {
      results = [];
    }

    // Step 2: 正则过滤
    if (parsed.regex) {
      results = results.filter((r) => {
        const content = this.contentCache.get(r.id) ?? '';
        return parsed.regex!.test(content);
      });
    }

    // Step 3: 标签过滤
    if (parsed.tags.length > 0) {
      results = results.filter((r) => {
        const meta = this.metaCache.get(r.id);
        const docTags = meta?.tags ?? [];
        return parsed.tags.every((t) =>
          docTags.map((dt) => dt.toLowerCase()).includes(t.toLowerCase()),
        );
      });
    }

    // Step 4: 日期过滤
    if (parsed.dateStart || parsed.dateEnd) {
      results = results.filter((r) => {
        const content = this.contentCache.get(r.id) ?? '';
        const fm = /^---\s*\n[\s\S]*?\n---\s*\n/.exec(content);
        if (!fm) return false;
        const dateMatch = /(?:created|date):\s*(\d{4}-\d{2}-\d{2})/.exec(fm[0]);
        if (!dateMatch?.[1]) return false;
        const docDate = dateMatch[1];
        if (parsed.dateStart && docDate < parsed.dateStart) return false;
        if (parsed.dateEnd && docDate > parsed.dateEnd) return false;
        return true;
      });
    }

    // Step 5: 文件夹过滤
    if (parsed.folder) {
      const prefix = parsed.folder.startsWith('/') ? parsed.folder : `/${parsed.folder}`;
      results = results.filter((r) => {
        const meta = this.metaCache.get(r.id);
        const path = meta?.path ?? r.id;
        return path.startsWith(prefix);
      });
    }

    // 转换为 SearchResult 格式
    const limit = query.limit ?? 20;
    return results.slice(0, limit).map((r) => {
      const meta = this.metaCache.get(r.id);
      return {
        notePath: meta?.path ?? r.id,
        noteTitle: meta?.title ?? r.id,
        matches: [
          {
            line: 0,
            column: 0,
            text: parsed.text,
            context: this.extractContext(this.contentCache.get(r.id) ?? '', parsed.text),
          },
        ],
        score: r.score,
      };
    });
  }

  /** 更新单个文档 */
  updateDocument(path: string, doc: DocumentEntry, content: string): void {
    if (!this.engine) return;
    this.contentCache.set(path, content);
    try {
      this.engine.discard(path);
    } catch {
      /* new doc */
    }
    this.addToEngine(path, doc.title, doc.tags, content.slice(0, 10000));
  }

  /** 移除文档 */
  removeDocument(path: string): void {
    if (!this.engine) return;
    this.contentCache.delete(path);
    this.metaCache.delete(path);
    try {
      this.engine.discard(path);
    } catch {
      /* ignore */
    }
  }

  /** 销毁引擎 */
  destroy(): void {
    this.engine = null;
    this.contentCache.clear();
    this.metaCache.clear();
  }

  // ---- Private ----

  private addToEngine(path: string, title: string, tags: readonly string[], content: string): void {
    if (!this.engine) return;
    this.engine.add({
      id: path,
      path,
      title,
      tags: [...tags],
      content,
    });
    this.metaCache.set(path, { path, title, tags: [...tags] });
  }

  /** 解析高级搜索语法 */
  private parseAdvancedQuery(raw: string): ParsedQuery {
    let text = raw;
    let regex: RegExp | null = null;
    const tags: string[] = [];
    let dateStart: string | null = null;
    let dateEnd: string | null = null;
    let folder: string | null = null;

    // tag:xxx
    const tagRe = /tag:(\S+)/gi;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(raw)) !== null) {
      tags.push(m[1] ?? '');
      text = text.replace(m[0], '');
    }

    // date:YYYY-MM..YYYY-MM
    const dateRe = /date:(\d{4}-\d{2}(?:-\d{2})?)(?:\.\.(\d{4}-\d{2}(?:-\d{2})?))?/i;
    const dateMatch = dateRe.exec(text);
    if (dateMatch) {
      dateStart = dateMatch[1] ?? null;
      dateEnd = dateMatch[2] ?? null;
      text = text.replace(dateMatch[0], '');
    }

    // folder:xxx
    const folderRe = /folder:(\S+)/i;
    const folderMatch = folderRe.exec(text);
    if (folderMatch) {
      folder = folderMatch[1] ?? null;
      text = text.replace(folderMatch[0], '');
    }

    // /regex/flags
    const trimmedText = text.trim();
    const regexRe = /^\/(.+?)\/([gimsu]*)$/;
    const regexMatch = regexRe.exec(trimmedText);
    if (regexMatch) {
      try {
        regex = new RegExp(regexMatch[1] ?? '', regexMatch[2] ?? '');
        text = '';
      } catch {
        // invalid regex, keep as text
      }
    }

    return { text: text.trim(), regex, tags, dateStart, dateEnd, folder };
  }

  /** 获取所有文档的伪搜索结果（用于纯过滤查询） */
  private getAllDocResults(): MiniSearchResult[] {
    const results: MiniSearchResult[] = [];
    for (const [id] of this.metaCache) {
      results.push({
        id,
        score: 1,
        terms: [],
        match: {},
        queryTerms: [],
      });
    }
    return results;
  }

  /** 提取上下文（前后 30 字符） */
  private extractContext(content: string, query: string): string {
    if (!query) return content.slice(0, 60);
    const idx = content.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return content.slice(0, 60);
    const start = Math.max(0, idx - 30);
    const end = Math.min(content.length, idx + query.length + 30);
    let ctx = content.slice(start, end);
    if (start > 0) ctx = '...' + ctx;
    if (end < content.length) ctx = ctx + '...';
    return ctx;
  }
}
