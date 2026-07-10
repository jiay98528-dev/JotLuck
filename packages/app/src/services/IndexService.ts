/**
 * IndexService — 索引构建与查询服务
 *
 * 全量扫描笔记本 → 构建 SearchIndex → 提取标签/Wiki-link/最近笔记
 *
 * @see migration-map.md §4
 */
import type { IFileSystemService, SearchIndex, DocumentEntry, BacklinkEntry } from '@/types';
import { isSupportedNoteFile, stripSupportedNoteExtension } from '@/utils/note-files';
import { SearchEngine } from './SearchEngine';
import { parseFrontmatter, extractTitle } from './YAMLParser';

const MAX_INDEXED_NOTE_FILES = 2000;
const INDEX_LIMIT_ERROR = 'JOTLUCK_INDEX_LIMIT_EXCEEDED';
const INDEX_FILE_CONCURRENCY = 16;

async function runLimited<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      if (item !== undefined) await worker(item);
    }
  });
  await Promise.all(workers);
}

export class IndexService {
  private fs: IFileSystemService;
  private engine: SearchEngine;
  private wikiOutgoing: Map<string, string[]> = new Map();
  private wikiIncoming: Map<string, string[]> = new Map();
  private recentNotesList: Array<{ path: string; title: string; lastOpenedAt: number }> = [];
  private tagIndex: Map<string, string[]> = new Map();
  private allDocuments: Record<string, DocumentEntry> = {};
  private documentContents: Map<string, string> = new Map();
  private indexedNoteCount = 0;
  private populateRecent: boolean;

  private normalizePath(path: string): string {
    const normalized = path.replace(/\\/g, '/');
    if (normalized === '/') return '/';
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  }

  private clearIndexesForPaths(pathsToRemove: string[]): void {
    if (pathsToRemove.length === 0) return;

    const removeSet = new Set(pathsToRemove.map((p) => this.normalizePath(p)));
    const searchIndexPaths = new Set<string>(removeSet);

    for (const path of Object.keys(this.allDocuments)) {
      if (removeSet.has(this.normalizePath(path))) {
        delete this.allDocuments[path];
        searchIndexPaths.add(path);
      }
    }

    for (const [tag, paths] of this.tagIndex) {
      const next = paths.filter((path) => !removeSet.has(this.normalizePath(path)));
      if (next.length === 0) {
        this.tagIndex.delete(tag);
      } else {
        this.tagIndex.set(tag, next);
      }
    }

    for (const [path, outgoing] of this.wikiOutgoing) {
      if (removeSet.has(this.normalizePath(path))) {
        this.wikiOutgoing.delete(path);
      } else {
        const next = outgoing.filter((target) => !removeSet.has(this.normalizePath(target)));
        this.wikiOutgoing.set(path, next);
      }
    }

    for (const [target, sources] of this.wikiIncoming) {
      if (removeSet.has(this.normalizePath(target))) {
        this.wikiIncoming.delete(target);
      } else {
        const next = sources.filter((source) => !removeSet.has(this.normalizePath(source)));
        if (next.length === 0) {
          this.wikiIncoming.delete(target);
        } else {
          this.wikiIncoming.set(target, next);
        }
      }
    }

    this.recentNotesList = this.recentNotesList.filter(
      (note) => !removeSet.has(this.normalizePath(note.path)),
    );

    for (const removed of searchIndexPaths) {
      this.engine.removeDocument(removed);
      this.documentContents.delete(removed);
    }
  }

  synchronizeFromFileTree(filePaths: string[]): void {
    const existing = new Set(filePaths.map((p) => this.normalizePath(p)));
    const knownPaths = new Set<string>();

    Object.keys(this.allDocuments).forEach((path) => knownPaths.add(path));
    this.recentNotesList.forEach((note) => knownPaths.add(note.path));
    for (const paths of this.tagIndex.values()) {
      paths.forEach((path) => knownPaths.add(path));
    }
    for (const path of this.wikiOutgoing.keys()) {
      knownPaths.add(path);
    }
    for (const sources of this.wikiIncoming.values()) {
      sources.forEach((path) => knownPaths.add(path));
    }

    const stale = [...knownPaths].filter((path) => !existing.has(this.normalizePath(path)));
    this.clearIndexesForPaths(stale);
  }

  constructor(fs: IFileSystemService, options: { populateRecent?: boolean } = {}) {
    this.fs = fs;
    this.engine = new SearchEngine();
    this.populateRecent = options.populateRecent ?? true;
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
    this.documentContents.clear();
    this.indexedNoteCount = 0;

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

    // Populate initial recentNotes from scanned documents only for real notebook sessions.
    this.recentNotesList = this.populateRecent
      ? Object.entries(this.allDocuments)
          .map(([path, entry]) => ({
            path,
            title: entry.title,
            lastOpenedAt: entry.created ?? Date.now(),
          }))
          .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
      : [];

    this.engine.buildIndex(documents);
    // Reuse content already read during indexing. Falling back keeps the contract
    // intact for documents added by future alternate scanners.
    await this.engine.preloadContent(
      documents,
      async (path) => this.documentContents.get(path) ?? this.fs.readFile(path),
    );
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
      const noteEntries = entries.filter(
        (entry) => entry.isFile && isSupportedNoteFile(entry.name),
      );
      if (this.indexedNoteCount + noteEntries.length > MAX_INDEXED_NOTE_FILES) {
        throw new Error(
          `${INDEX_LIMIT_ERROR}: 当前文件夹包含超过 ${MAX_INDEXED_NOTE_FILES} 个笔记文件，请选择更精确的笔记本文件夹。`,
        );
      }
      this.indexedNoteCount += noteEntries.length;

      await runLimited(noteEntries, INDEX_FILE_CONCURRENCY, (entry) => this.indexFile(entry.path));

      for (const entry of entries) {
        if (entry.isDirectory) await this.scanDirectory(entry.path);
      }
    } catch (e) {
      if (String(e).includes(INDEX_LIMIT_ERROR)) throw e;
      // eslint-disable-next-line no-console
      console.error('[IndexService] scanDirectory 失败:', e);
    }
  }

  private async indexFile(path: string): Promise<void> {
    try {
      const content = await this.fs.readFile(path);
      this.documentContents.set(path, content);
      const fm = parseFrontmatter(content);
      const title =
        fm.data.title ||
        extractTitle(content) ||
        stripSupportedNoteExtension(path.split('/').pop() ?? '');

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
        this.documentContents.set(path, content);
        this.engine.updateDocument(path, entry, content);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[IndexService] updateDocument 读取文件内容失败，使用空内容更新索引:', e);
        this.engine.updateDocument(path, entry, '');
      }
    }
    // 更新 recentNotesList（新建/编辑笔记后书签圆点需要显示）
    this.recentNotesList = this.recentNotesList.filter((n) => n.path !== path);
    this.recentNotesList.unshift({
      path,
      title: entry?.title ?? stripSupportedNoteExtension(path.split('/').pop() ?? ''),
      lastOpenedAt: Date.now(),
    });
    this.recentNotesList.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    if (this.recentNotesList.length > 20) {
      this.recentNotesList = this.recentNotesList.slice(0, 20);
    }
  }

  removeDocument(path: string): void {
    this.clearIndexesForPaths([path]);
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
    const noteName = stripSupportedNoteExtension(notePath.split('/').pop() ?? '');
    const incoming = this.wikiIncoming.get(noteName) ?? [];
    const alsoByName = this.wikiIncoming.get(stripSupportedNoteExtension(notePath)) ?? [];
    const allSources = [...new Set([...incoming, ...alsoByName])];

    return allSources.map((source) => ({
      notePath: source,
      noteTitle:
        this.allDocuments[source]?.title ??
        stripSupportedNoteExtension(source.split('/').pop() ?? ''),
      context: '',
      lineNumber: 0,
    }));
  }

  getRecentNotes(limit = 20) {
    return this.recentNotesList.slice(0, limit);
  }
}
