/**
 * SearchEngine — 全文检索引擎 (基于 minisearch 理念的轻量实现)
 *
 * 支持: 文本搜索、正则搜索、标签过滤、日期范围、文件夹过滤
 *
 * @see migration-map.md §4
 */
import type { SearchResult, SearchQuery, DocumentEntry, SearchMatch } from '@/types';

interface IndexedDoc {
  entry: DocumentEntry;
  content: string;
}

export class SearchEngine {
  private docs: Map<string, IndexedDoc> = new Map();
  private destroyed = false;

  buildIndex(documents: Record<string, DocumentEntry>): void {
    this.docs.clear();
    for (const [path, entry] of Object.entries(documents)) {
      this.docs.set(path, { entry, content: '' });
    }
  }

  async preloadContent(
    documents: Record<string, DocumentEntry>,
    contentProvider: (path: string) => Promise<string>,
  ): Promise<void> {
    for (const [path, entry] of Object.entries(documents)) {
      try {
        const content = await contentProvider(path);
        this.docs.set(path, { entry, content });
      } catch (e) {
        // 读取文件内容失败时静默降级为空内容，索引仍可基于标题匹配
        // eslint-disable-next-line no-console
        console.error('[SearchEngine] preloadContent 读取文件失败，使用空内容:', path, e);
        this.docs.set(path, { entry, content: '' });
      }
    }
  }

  search(query: SearchQuery): SearchResult[] {
    if (this.destroyed) return [];

    let candidates: Array<{ path: string; doc: IndexedDoc }> = [...this.docs.entries()].map(
      ([path, doc]) => ({ path, doc }),
    );

    // Tag filter
    if (query.tags && query.tags.length > 0) {
      candidates = candidates.filter((c) =>
        query.tags!.some((t) =>
          c.doc.entry.tags.some((dt) => dt.toLowerCase() === t.toLowerCase()),
        ),
      );
    }

    // Date range filter
    if (query.dateRange) {
      const { from, to } = query.dateRange;
      candidates = candidates.filter((c) => {
        const ts = c.doc.entry.created ?? 0;
        if (from && ts < from.getTime()) return false;
        if (to && ts > to.getTime()) return false;
        return true;
      });
    }

    // Folder filter
    if (query.folder && query.folder.length > 0) {
      candidates = candidates.filter((c) => c.doc.entry.folder?.startsWith(query.folder!));
    }

    // Regex search
    if (query.regex) {
      try {
        const flags = (query.regexFlags ?? 'i').replace(/[gy]/g, '');
        const re = new RegExp(query.regex, flags);
        candidates = candidates.filter((c) => re.test(c.doc.content) || re.test(c.doc.entry.title));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[SearchEngine] 无效正则表达式', e);
      }
    }

    // Text search
    if (query.text && query.text.trim()) {
      const terms = query.text.trim().toLowerCase().split(/\s+/);
      const scored = candidates
        .map((c) => {
          let score = 0;
          const titleLC = c.doc.entry.title.toLowerCase();
          const contentLC = c.doc.content.toLowerCase();
          for (const term of terms) {
            if (titleLC.includes(term)) score += 10;
            const contentMatches = (
              contentLC.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []
            ).length;
            score += contentMatches;
          }
          return { ...c, score };
        })
        .filter((c) => c.score > 0)
        .sort((a, b) => b.score - a.score);

      return scored.map((c) => this.toResult(c.path, c.doc, query.text!, c.score));
    }

    // No text query — return all filtered candidates
    return candidates.map((c) => this.toResult(c.path, c.doc, '', 0));
  }

  private toResult(path: string, doc: IndexedDoc, queryText: string, score: number): SearchResult {
    const matches: SearchMatch[] = [];

    if (queryText && doc.content) {
      const queryLC = queryText.toLowerCase();
      const contentLC = doc.content.toLowerCase();
      const idx = contentLC.indexOf(queryLC);
      if (idx >= 0) {
        const start = Math.max(0, idx - 30);
        const end = Math.min(doc.content.length, idx + queryText.length + 30);
        const context =
          (start > 0 ? '…' : '') +
          doc.content.slice(start, end) +
          (end < doc.content.length ? '…' : '');

        matches.push({
          line: 0,
          column: idx,
          text: queryText,
          context,
        });
      }
    }

    return {
      notePath: path,
      noteTitle: doc.entry.title,
      matches,
      score,
    };
  }

  updateDocument(path: string, doc: DocumentEntry, content: string): void {
    this.docs.set(path, { entry: doc, content });
  }

  removeDocument(path: string): void {
    this.docs.delete(path);
  }

  destroy(): void {
    this.destroyed = true;
    this.docs.clear();
  }
}
