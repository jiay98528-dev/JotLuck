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
  /** 索引写入时预计算的小写形式，评分热路径免做全文 toLowerCase */
  titleLC: string;
  contentLC: string;
}

interface LocatedMatch {
  index: number;
  text: string;
}

/** 查询期一次预编译的词项：term 用于 includes 判定，regex 用于出现次数计数 */
interface CompiledTerm {
  term: string;
  regex: RegExp;
}

export class SearchEngine {
  private docs: Map<string, IndexedDoc> = new Map();
  private destroyed = false;

  /** 索引写入唯一入口：小写缓存随写入同步失效并重建 */
  private createDoc(entry: DocumentEntry, content: string): IndexedDoc {
    return {
      entry,
      content,
      titleLC: entry.title.toLowerCase(),
      contentLC: content.toLowerCase(),
    };
  }

  buildIndex(documents: Record<string, DocumentEntry>): void {
    this.docs.clear();
    for (const [path, entry] of Object.entries(documents)) {
      this.docs.set(path, this.createDoc(entry, ''));
    }
  }

  async preloadContent(
    documents: Record<string, DocumentEntry>,
    contentProvider: (path: string) => Promise<string>,
  ): Promise<void> {
    for (const [path, entry] of Object.entries(documents)) {
      try {
        const content = await contentProvider(path);
        this.docs.set(path, this.createDoc(entry, content));
      } catch (e) {
        // 读取文件内容失败时静默降级为空内容，索引仍可基于标题匹配
        // eslint-disable-next-line no-console
        console.error('[SearchEngine] preloadContent 读取文件失败，使用空内容:', path, e);
        this.docs.set(path, this.createDoc(entry, ''));
      }
    }
  }

  search(query: SearchQuery): SearchResult[] {
    if (this.destroyed) return [];

    // 零中间数组：直接迭代 Map entries 构建候选列表（原实现经 [...entries()].map 双数组展开）
    let candidates: Array<{ path: string; doc: IndexedDoc }> = [];
    for (const [path, doc] of this.docs.entries()) {
      candidates.push({ path, doc });
    }

    // Tag filter
    if (query.tags && query.tags.length > 0) {
      candidates = candidates.filter((c) =>
        query.tags!.every((t) =>
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

    // Regex is the primary inclusion rule. Free text outside the literal is
    // retained only as an auxiliary relevance signal.
    if (query.regex) {
      let regex: RegExp;
      try {
        const flags = (query.regexFlags ?? 'i').replace(/[gy]/g, '');
        regex = new RegExp(query.regex, flags);
      } catch {
        // Invalid regex is normal while the user is typing. Fail closed without
        // leaking a noisy exception into the editor console.
        return [];
      }

      // 辅助词项与正则一样按查询预编译一次，避免每 candidate 重复 split + RegExp
      const auxiliaryTerms = query.text.trim()
        ? this.compileTerms(query.text.trim().toLowerCase().split(/\s+/))
        : null;

      const ranked = candidates
        .map((candidate) => {
          const contentMatch = this.findRegexMatch(candidate.doc.content, regex);
          const titleMatch = this.findRegexMatch(candidate.doc.entry.title, regex);
          if (!contentMatch && !titleMatch) return null;
          const auxiliaryScore = auxiliaryTerms ? this.scoreText(candidate.doc, auxiliaryTerms) : 0;
          return {
            ...candidate,
            contentMatch,
            score: (titleMatch ? 10 : 0) + (contentMatch ? 1 : 0) + auxiliaryScore,
          };
        })
        .filter(
          (
            candidate,
          ): candidate is {
            path: string;
            doc: IndexedDoc;
            contentMatch: LocatedMatch | null;
            score: number;
          } => candidate !== null,
        )
        .sort((a, b) => b.score - a.score);

      return ranked.map((candidate) =>
        this.toResult(candidate.path, candidate.doc, candidate.contentMatch, candidate.score),
      );
    }

    // Text search
    if (query.text && query.text.trim()) {
      // 词项每查询预编译一次（原实现每 doc×term 现场构造 RegExp）
      const compiled = this.compileTerms(query.text.trim().toLowerCase().split(/\s+/));
      const scored = candidates
        .map((c) => {
          const score = this.scoreText(c.doc, compiled);
          return {
            ...c,
            score,
            contentMatch: this.findFirstTextMatch(c.doc, compiled),
          };
        })
        .filter((c) => c.score > 0)
        .sort((a, b) => b.score - a.score);

      return scored.map((c) => this.toResult(c.path, c.doc, c.contentMatch, c.score));
    }

    // No text query — return all filtered candidates
    return candidates.map((c) => this.toResult(c.path, c.doc, null, 0));
  }

  /** 词项预编译：空 term 跳过，与原 scoreText 内 `if (!term) continue` 语义一致 */
  private compileTerms(terms: string[]): CompiledTerm[] {
    const compiled: CompiledTerm[] = [];
    for (const term of terms) {
      if (!term) continue;
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      compiled.push({ term, regex: new RegExp(escaped, 'g') });
    }
    return compiled;
  }

  private scoreText(doc: IndexedDoc, compiled: CompiledTerm[]): number {
    let score = 0;
    const titleLC = doc.titleLC;
    const contentLC = doc.contentLC;
    for (const { term, regex } of compiled) {
      if (titleLC.includes(term)) score += 10;
      // 带 g 标志的 RegExp 复用安全：String.match 每次调用前按规范重置 lastIndex
      score += (contentLC.match(regex) || []).length;
    }
    return score;
  }

  private findRegexMatch(content: string, regex: RegExp): LocatedMatch | null {
    if (!content) return null;
    regex.lastIndex = 0;
    const match = regex.exec(content);
    if (!match || match.index < 0) return null;
    return { index: match.index, text: match[0] ?? '' };
  }

  private findFirstTextMatch(doc: IndexedDoc, compiled: CompiledTerm[]): LocatedMatch | null {
    const content = doc.content;
    if (!content) return null;
    const contentLC = doc.contentLC;
    let best: LocatedMatch | null = null;
    for (const { term } of compiled) {
      const index = contentLC.indexOf(term);
      if (index < 0 || (best && best.index <= index)) continue;
      best = { index, text: content.slice(index, index + term.length) };
    }
    return best;
  }

  private toResult(
    path: string,
    doc: IndexedDoc,
    located: LocatedMatch | null,
    score: number,
  ): SearchResult {
    const matches: SearchMatch[] = [];

    if (located) {
      const start = Math.max(0, located.index - 30);
      const end = Math.min(doc.content.length, located.index + located.text.length + 30);
      const context =
        (start > 0 ? '…' : '') +
        doc.content.slice(start, end) +
        (end < doc.content.length ? '…' : '');
      const before = doc.content.slice(0, located.index);
      const lastNewline = before.lastIndexOf('\n');

      matches.push({
        line: before.split('\n').length,
        column: located.index - lastNewline,
        text: located.text,
        context,
      });
    }

    return {
      notePath: path,
      noteTitle: doc.entry.title,
      matches,
      score,
    };
  }

  updateDocument(path: string, doc: DocumentEntry, content: string): void {
    this.docs.set(path, this.createDoc(doc, content));
  }

  removeDocument(path: string): void {
    this.docs.delete(path);
  }

  destroy(): void {
    this.destroyed = true;
    this.docs.clear();
  }
}
