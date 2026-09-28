/**
 * IndexService — 索引构建与查询服务
 *
 * 全量扫描笔记本 → 构建 SearchIndex → 提取标签/Wiki-link/最近笔记
 */
import type { IFileSystemService, SearchIndex, DocumentEntry, BacklinkEntry } from '@/types';
import { translate } from '@/i18n';
import {
  isIgnoredNotebookDirectory,
  isSupportedNoteFile,
  stripSupportedNoteExtension,
} from '@/utils/note-files';
import { SearchEngine } from './SearchEngine';
import { editorSource } from '@/utils/editor-source';
import { parseFrontmatter, extractTitle } from './YAMLParser';
import {
  extractIndexFacts,
  extractWikiLinkOccurrences,
  stripToPlainText,
  parseDocument,
  type WikiLinkOccurrence,
} from '@jotluck/renderer';

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
  private occurrences = new Map<string, WikiLinkOccurrence[]>();
  private contentRevisions = new Map<string, number>();
  private targetLookup: Map<string, string> | null = null;
  private backlinks: Map<string, BacklinkEntry[]> | null = null;

  private invalidateReferences(): void {
    this.targetLookup = null;
    this.backlinks = null;
  }

  /** Forward navigation and backlinks resolve a target using exactly the same rules. */
  resolveWikiLink(target: string): DocumentEntry | undefined {
    target = target.trim().replace(/\\/g, '/');
    if (!this.targetLookup) {
      const lookup = new Map<string, string>();
      const documents = Object.values(this.allDocuments);
      for (const doc of documents)
        if (doc.title && !lookup.has(doc.title)) lookup.set(doc.title, doc.path);
      for (const doc of documents) {
        const name = stripSupportedNoteExtension(doc.path.split('/').pop() ?? '');
        if (!lookup.has(name)) lookup.set(name, doc.path);
        lookup.set(`path:${stripSupportedNoteExtension(this.normalizePath(doc.path))}`, doc.path);
      }
      this.targetLookup = lookup;
    }
    let key = target;
    if (target.includes('/')) {
      const parts: string[] = [];
      for (const part of target.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') {
          if (!parts.length) return undefined;
          parts.pop();
        } else parts.push(part);
      }
      key = `path:${stripSupportedNoteExtension('/' + parts.join('/'))}`;
    }
    const path = this.targetLookup.get(key);
    return path ? this.allDocuments[path] : undefined;
  }
  /**
   * Monotonic per-path operation revisions. Any async read must still own the
   * latest revision before it is allowed to mutate an index.
   */
  private pathRevisions: Map<string, number> = new Map();
  private indexedNoteCount = 0;
  private populateRecent: boolean;

  private normalizePath(path: string): string {
    const normalized = path.replace(/\\/g, '/');
    if (normalized === '/') return '/';
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  }

  private beginPathMutation(path: string): number {
    const normalized = this.normalizePath(path);
    const revision = (this.pathRevisions.get(normalized) ?? 0) + 1;
    this.pathRevisions.set(normalized, revision);
    return revision;
  }

  private ownsPathMutation(path: string, revision: number): boolean {
    return this.pathRevisions.get(this.normalizePath(path)) === revision;
  }

  private clearIndexesForPaths(pathsToRemove: string[]): void {
    if (pathsToRemove.length === 0) return;

    const removeSet = new Set(pathsToRemove.map((p) => this.normalizePath(p)));
    this.invalidateReferences();
    for (const path of removeSet) {
      this.occurrences.delete(path);
      this.contentRevisions.delete(path);
    }
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
    stale.forEach((path) => this.beginPathMutation(path));
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
    // Invalidate every read started by an earlier incremental operation. Paths
    // found by this scan receive a fresh revision below.
    for (const path of this.pathRevisions.keys()) {
      this.beginPathMutation(path);
    }
    this.allDocuments = {};
    this.wikiOutgoing.clear();
    this.wikiIncoming.clear();
    this.tagIndex.clear();
    this.recentNotesList = [];
    this.documentContents.clear();
    this.occurrences.clear();
    this.contentRevisions.clear();
    this.invalidateReferences();
    this.indexedNoteCount = 0;

    const documents: Record<string, DocumentEntry> = {};
    await this.scanDirectory('/');

    // Build forward index
    for (const [path, doc] of Object.entries(this.allDocuments)) {
      documents[path] = doc;
    }

    // Build incoming wiki-link map from already-extracted outgoing links (done in indexFile)
    this.wikiIncoming.clear();
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
        (entry) => entry.isFile && !entry.name.startsWith('.') && isSupportedNoteFile(entry.name),
      );
      if (this.indexedNoteCount + noteEntries.length > MAX_INDEXED_NOTE_FILES) {
        throw new Error(
          `${INDEX_LIMIT_ERROR}: ${translate('program.indexTooLarge', { limit: MAX_INDEXED_NOTE_FILES })}`,
        );
      }
      this.indexedNoteCount += noteEntries.length;

      await runLimited(noteEntries, INDEX_FILE_CONCURRENCY, async (entry) => {
        const revision = this.beginPathMutation(entry.path);
        await this.indexFile(entry.path, revision);
      });

      for (const entry of entries) {
        if (entry.isDirectory && !isIgnoredNotebookDirectory(entry.name)) {
          await this.scanDirectory(entry.path);
        }
      }
    } catch (e) {
      if (String(e).includes(INDEX_LIMIT_ERROR)) throw e;
      // eslint-disable-next-line no-console
      console.error('[IndexService] scanDirectory failed:', e);
    }
  }

  private async indexFile(path: string, revision: number): Promise<string | null> {
    try {
      const content = await this.fs.readFile(path);
      if (!this.ownsPathMutation(path, revision)) return null;
      if (this.documentContents.get(path) === content && this.allDocuments[path]) return content;
      if (this.documentContents.get(path) !== content) this.contentRevisions.set(path, revision);
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

      // Inline #tag 与 wiki-link 提取统一消费 AST（@jotluck/renderer）：
      // 天然跳过 frontmatter / codeFence / 裸 JSON，并先剥行内 code 与
      // 行首 heading/blockquote 前缀，避免 ATX `#` 误判为 tag。
      const ast = parseDocument(editorSource(content));
      const occurrences = extractWikiLinkOccurrences(ast);
      this.occurrences.set(path, occurrences);
      const facts = extractIndexFacts(ast, occurrences);
      const inlineTags = facts.tags;

      // Merge & deduplicate
      const allTags = [...new Set([...fmTags, ...inlineTags])];

      // Wiki-link 目标已由 AST 侧剥离 `#anchor`（明示收紧：反链图按 note 名建立）。
      this.wikiOutgoing.delete(path);
      const outgoing = facts.wikiLinkTargets;
      this.wikiOutgoing.set(path, outgoing);

      // Incremental updates must keep backlinks in lockstep with outgoing links.
      this.wikiIncoming.clear();
      for (const [source, targets] of this.wikiOutgoing) {
        for (const target of targets) {
          if (!this.wikiIncoming.has(target)) this.wikiIncoming.set(target, []);
          this.wikiIncoming.get(target)!.push(source);
        }
      }

      const created = fm.data.created ? new Date(fm.data.created).getTime() : undefined;

      const folder = path.substring(0, path.lastIndexOf('/') + 1) || '/';

      const entry: DocumentEntry = { path, title, tags: allTags, created, folder };
      this.allDocuments[path] = entry;
      this.invalidateReferences();

      // Clear old tag associations for this path (idempotent re-index)
      for (const [tag, paths] of this.tagIndex) {
        const idx = paths.indexOf(path);
        if (idx >= 0) paths.splice(idx, 1);
        if (paths.length === 0) this.tagIndex.delete(tag);
      }

      // Tag index
      for (const tag of allTags) {
        if (!this.tagIndex.has(tag)) this.tagIndex.set(tag, []);
        this.tagIndex.get(tag)!.push(path);
      }
      return content;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[IndexService] indexFile 失败:', e);
      return null;
    }
  }

  async updateDocument(path: string): Promise<void> {
    const normalizedPath = this.normalizePath(path);
    const previousContent = this.documentContents.get(normalizedPath);
    const revision = this.beginPathMutation(normalizedPath);
    const content = await this.indexFile(normalizedPath, revision);
    if (!this.ownsPathMutation(normalizedPath, revision) || content === null) return;
    // Sync updated content into the search engine
    const entry = this.allDocuments[normalizedPath];
    if (entry && previousContent !== content) {
      this.engine.updateDocument(normalizedPath, entry, content);
    }
    // 更新 recentNotesList（新建/编辑笔记后书签圆点需要显示）
    this.recentNotesList = this.recentNotesList.filter((n) => n.path !== normalizedPath);
    this.recentNotesList.unshift({
      path: normalizedPath,
      title: entry?.title ?? stripSupportedNoteExtension(normalizedPath.split('/').pop() ?? ''),
      lastOpenedAt: Date.now(),
    });
    this.recentNotesList.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    if (this.recentNotesList.length > 20) {
      this.recentNotesList = this.recentNotesList.slice(0, 20);
    }
  }

  removeDocument(path: string): void {
    const normalizedPath = this.normalizePath(path);
    this.beginPathMutation(normalizedPath);
    this.clearIndexesForPaths([normalizedPath]);
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
    if (!this.backlinks) {
      this.backlinks = new Map();
      for (const [source, occurrences] of this.occurrences) {
        for (const occurrence of occurrences) {
          const target = this.resolveWikiLink(occurrence.target);
          if (!target) continue;
          const entries = this.backlinks.get(target.path) ?? [];
          entries.push({
            notePath: source,
            noteTitle:
              this.allDocuments[source]?.title ??
              stripSupportedNoteExtension(source.split('/').pop() ?? ''),
            context: stripToPlainText(
              occurrence.before + (occurrence.alias ?? occurrence.target) + occurrence.after,
            )
              .replace(/\s+/g, ' ')
              .trim(),
            lineNumber: occurrence.lineNumber,
            location: { ...occurrence, revision: this.contentRevisions.get(source) ?? 0 },
          });
          this.backlinks.set(target.path, entries);
        }
      }
      for (const entries of this.backlinks.values())
        entries.sort(
          (a, b) => a.notePath.localeCompare(b.notePath) || a.location!.from - b.location!.from,
        );
    }
    return this.backlinks.get(this.normalizePath(notePath)) ?? [];
  }

  isBacklinkCurrent(entry: BacklinkEntry, source: string): boolean {
    return (
      entry.location?.revision === this.contentRevisions.get(entry.notePath) &&
      this.documentContents.get(entry.notePath) === source
    );
  }

  getRecentNotes(limit = 20) {
    return this.recentNotesList.slice(0, limit);
  }
}
