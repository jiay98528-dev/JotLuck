/**
 * IndexService — 索引构建与查询服务
 *
 * 全量扫描笔记本 → 构建 SearchIndex → 提取标签/Wiki-link/最近笔记
 *
 * @see migration-map.md §4
 */
import type { IFileSystemService, SearchIndex, DocumentEntry, BacklinkEntry } from '@/types';
import { SearchEngine } from './SearchEngine';
import { parseFrontmatter, extractTitle } from './YAMLParser';

export class IndexService {
  private fs: IFileSystemService;
  private engine: SearchEngine;
  private wikiOutgoing: Map<string, string[]> = new Map();
  private wikiIncoming: Map<string, string[]> = new Map();
  private recentNotesList: Array<{ path: string; title: string; lastOpenedAt: number }> = [];
  private tagIndex: Map<string, string[]> = new Map();
  private allDocuments: Record<string, DocumentEntry> = {};

  constructor(fs: IFileSystemService) {
    this.fs = fs;
    this.engine = new SearchEngine();
  }

  getEngine(): SearchEngine {
    return this.engine;
  }

  async buildFullIndex(): Promise<SearchIndex> {
    this.allDocuments = {};
    this.wikiOutgoing.clear();
    this.wikiIncoming.clear();
    this.tagIndex.clear();
    this.recentNotesList = [];

    const documents: Record<string, DocumentEntry> = {};
    await this.scanDirectory('/');

    // Build forward index
    for (const [path, doc] of Object.entries(this.allDocuments)) {
      documents[path] = doc;
    }

    // Build incoming wiki-link map from already-extracted outgoing links (done in indexFile)
    for (const [source, outgoing] of this.wikiOutgoing) {
      for (const target of outgoing) {
        if (!this.wikiIncoming.has(target)) this.wikiIncoming.set(target, []);
        this.wikiIncoming.get(target)!.push(source);
      }
    }

    // Populate initial recentNotes from scanned documents
    this.recentNotesList = Object.entries(this.allDocuments)
      .map(([path, entry]) => ({
        path,
        title: entry.title,
        lastOpenedAt: entry.created ?? Date.now(),
      }))
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);

    this.engine.buildIndex(documents);
    // Load full file content into the search engine for content-based matching
    await this.engine.preloadContent(documents, (path) => this.fs.readFile(path));
    return {
      version: '1',
      lastUpdated: new Date().toISOString(),
      documents,
      invertedIndex: {},
      termIndex: {},
      wikiLinks: Object.fromEntries(this.wikiOutgoing),
      tagIndex: Object.fromEntries(this.tagIndex),
    } satisfies SearchIndex;
  }

  private async scanDirectory(dir: string): Promise<void> {
    try {
      const entries = await this.fs.listDirectory(dir);
      for (const entry of entries) {
        if (entry.isDirectory) {
          await this.scanDirectory(entry.path);
        } else if (entry.name.endsWith('.md')) {
          await this.indexFile(entry.path);
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[IndexService] scanDirectory 失败:', e);
    }
  }

  private async indexFile(path: string): Promise<void> {
    try {
      const content = await this.fs.readFile(path);
      const fm = parseFrontmatter(content);
      const title =
        fm.data.title || extractTitle(content) || path.split('/').pop()?.replace(/\.md$/, '') || '';

      // Frontmatter tags
      const fmTags: string[] = Array.isArray(fm.data.tags)
        ? fm.data.tags
        : typeof fm.data.tags === 'string'
          ? fm.data.tags.split(/[,，]/).map((t) => t.trim())
          : [];

      // Inline #tag — strip code/headings first to avoid false positives
      const body = content.replace(/^---[\s\S]*?^---/m, ''); // remove frontmatter block
      const bodyClean = body
        .replace(/^```[\s\S]*?^```/gm, '') // fenced code blocks
        .replace(/`[^`]+`/g, '') // inline code
        .replace(/^#{1,6}\s+/gm, ''); // ATX headings
      const inlineTags = [...bodyClean.matchAll(/(?<!\w)#([^\s#]+)/g)].map((m) => m[1]!);

      // Merge & deduplicate
      const allTags = [...new Set([...fmTags, ...inlineTags])];

      // Wiki-link extraction (reuse already-loaded content — avoids separate read in buildFullIndex)
      this.wikiOutgoing.delete(path);
      const wikiRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
      const outgoing: string[] = [];
      let wm: RegExpExecArray | null;
      while ((wm = wikiRegex.exec(content)) !== null) {
        const target = wm[1]?.trim() ?? '';
        if (target) outgoing.push(target);
      }
      this.wikiOutgoing.set(path, outgoing);

      const created = fm.data.created ? new Date(fm.data.created).getTime() : undefined;

      const folder = path.substring(0, path.lastIndexOf('/') + 1) || '/';

      const entry: DocumentEntry = { path, title, tags: allTags, created, folder };
      this.allDocuments[path] = entry;

      // Clear old tag associations for this path (idempotent re-index)
      for (const [, paths] of this.tagIndex) {
        const idx = paths.indexOf(path);
        if (idx >= 0) paths.splice(idx, 1);
      }

      // Tag index
      for (const tag of allTags) {
        if (!this.tagIndex.has(tag)) this.tagIndex.set(tag, []);
        this.tagIndex.get(tag)!.push(path);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[IndexService] indexFile 失败:', e);
    }
  }

  async updateDocument(path: string): Promise<void> {
    await this.indexFile(path);
    // Sync updated content into the search engine
    const entry = this.allDocuments[path];
    if (entry) {
      try {
        const content = await this.fs.readFile(path);
        this.engine.updateDocument(path, entry, content);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[IndexService] updateDocument 读取文件内容失败，使用空内容更新索引:', e);
        this.engine.updateDocument(path, entry, '');
      }
    }
  }

  removeDocument(path: string): void {
    // Clean up tag index
    for (const [tag, paths] of this.tagIndex) {
      const idx = paths.indexOf(path);
      if (idx >= 0) {
        paths.splice(idx, 1);
        if (paths.length === 0) this.tagIndex.delete(tag);
      }
    }
    // Clean up wiki-link maps
    this.wikiOutgoing.delete(path);
    for (const [, paths] of this.wikiIncoming) {
      const idx = paths.indexOf(path);
      if (idx >= 0) paths.splice(idx, 1);
    }

    delete this.allDocuments[path];
    this.engine.removeDocument(path);
  }

  /** 获取所有已索引文档的标题列表 (用于结构化补全) */
  getAllNoteTitles(): string[] {
    return Object.values(this.allDocuments)
      .map((d) => d.title)
      .filter((t): t is string => !!t && t.length > 0);
  }

  /** 获取所有已索引文档条目 (用于 excerpt 提取等) */
  getAllDocuments(): Record<string, DocumentEntry> {
    return { ...this.allDocuments };
  }

  getAllTags(): Array<{ name: string; count: number }> {
    return [...this.tagIndex.entries()]
      .map(([name, paths]) => ({ name, count: paths.length }))
      .sort((a, b) => b.count - a.count);
  }

  getWikiLinkGraph() {
    return {
      outgoing: Object.fromEntries(this.wikiOutgoing),
      incoming: Object.fromEntries(this.wikiIncoming),
      deadLinks: [] as Array<{ source: string; target: string }>,
    };
  }

  getBacklinks(notePath: string): BacklinkEntry[] {
    const noteName = notePath.split('/').pop()?.replace(/\.md$/, '') ?? '';
    const incoming = this.wikiIncoming.get(noteName) ?? [];
    const alsoByName = this.wikiIncoming.get(notePath.replace(/\.md$/, '')) ?? [];
    const allSources = [...new Set([...incoming, ...alsoByName])];

    return allSources.map((source) => ({
      notePath: source,
      noteTitle:
        this.allDocuments[source]?.title ?? source.split('/').pop()?.replace(/\.md$/, '') ?? '',
      context: '',
      lineNumber: 0,
    }));
  }

  getRecentNotes(limit = 20) {
    return this.recentNotesList.slice(0, limit);
  }
}
