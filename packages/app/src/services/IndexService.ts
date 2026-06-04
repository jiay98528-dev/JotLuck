/**
 * IndexService — 笔记本索引服务
 *
 * M2-01, M2-03: 管理 .markluck_index.json 的构建、持久化和增量更新。
 * 在 Web 阶段使用 localStorage 持久化，M6 切换为文件系统存储。
 *
 * @module IndexService
 * @see milestones.md M2-01, M2-03
 */

import type { IFileSystemService, DocumentEntry, SearchIndex } from '@/types';
import { parseFrontmatter, extractTitle, type FrontmatterData } from './YAMLParser';

/** 索引版本号 */
const INDEX_VERSION = '1.0.0';

/** localStorage key */
const INDEX_STORAGE_KEY = 'markluck-index';

/** Wiki-link 正则：[[name]], [[name|alias]], [[name#anchor|alias]] */
const WIKI_LINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;

/** 内联 #tag 正则（不在代码块/链接内的标签） */
const INLINE_TAG_RE = /(?:^|\s)#([a-zA-Z一-鿿㐀-䶿][\w一-鿿㐀-䶿-]*)/g;

export class IndexService {
  private fs: IFileSystemService;
  private index: SearchIndex | null = null;

  constructor(fs: IFileSystemService) {
    this.fs = fs;
    this.loadFromStorage();
  }

  /** 获取当前索引 */
  getIndex(): SearchIndex | null {
    return this.index;
  }

  /** 构建全量索引 */
  async buildFullIndex(): Promise<SearchIndex> {
    const entries = await this.fs.listDirectory('/');
    const documents: Record<string, DocumentEntry> = {};
    const allTags = new Set<string>();

    for (const entry of entries) {
      if (!entry.isFile || !entry.name.endsWith('.md')) continue;

      try {
        const content = await this.fs.readFile(entry.path);
        const doc = this.indexDocument(entry.path, content, entry.mtime ?? Date.now());
        documents[entry.path] = doc;
        doc.tags.forEach((t) => allTags.add(t));
      } catch {
        // 跳过无法读取的文件
      }
    }

    this.index = {
      version: INDEX_VERSION,
      lastUpdated: new Date().toISOString(),
      documents,
      invertedIndex: {},
    };

    this.saveToStorage();
    return this.index;
  }

  /** 增量更新：重新索引单个文件 */
  async updateDocument(path: string): Promise<void> {
    if (!this.index) return;

    try {
      const content = await this.fs.readFile(path);
      const stat = await this.fs.statFile(path);
      this.index = {
        ...this.index,
        documents: {
          ...this.index.documents,
          [path]: this.indexDocument(path, content, stat.mtime),
        },
        lastUpdated: new Date().toISOString(),
      };
      this.saveToStorage();
    } catch {
      // 文件可能已被删除，从索引中移除
      const { [path]: _removed, ...restDocs } = this.index.documents;
      this.index = { ...this.index, documents: restDocs, lastUpdated: new Date().toISOString() };
    }
  }

  /** 从索引中移除文档 */
  removeDocument(path: string): void {
    if (!this.index) return;
    const { [path]: _removed, ...restDocs } = this.index.documents;
    this.index = { ...this.index, documents: restDocs, lastUpdated: new Date().toISOString() };
    this.saveToStorage();
  }

  /** 获取所有标签（按频率排序） */
  getAllTags(): Array<{ name: string; count: number }> {
    if (!this.index) return [];

    const tagCounts = new Map<string, number>();
    for (const doc of Object.values(this.index.documents)) {
      for (const tag of doc.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }

    return [...tagCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  /** 获取 Wiki-link 图（出链 + 入链） */
  getWikiLinkGraph(): {
    outgoing: Record<string, string[]>;
    incoming: Record<string, string[]>;
    deadLinks: Array<{ source: string; target: string }>;
  } {
    const outgoing: Record<string, string[]> = {};
    const incoming: Record<string, string[]> = {};
    const allPaths = new Set(Object.keys(this.index?.documents ?? {}));

    for (const doc of Object.values(this.index?.documents ?? {})) {
      outgoing[doc.path] = doc.outgoingLinks as string[];

      for (const link of doc.outgoingLinks) {
        if (!incoming[link]) {
          incoming[link] = [];
        }
        incoming[link].push(doc.path);
      }
    }

    // 死链检测
    const deadLinks: Array<{ source: string; target: string }> = [];
    for (const [source, links] of Object.entries(outgoing)) {
      for (const link of links) {
        // 构造可能的文件路径
        const candidatePaths = [
          `/${link}.md`,
          `/${link}`,
          link.startsWith('/') ? link : `/${link}`,
        ];
        const exists = candidatePaths.some((p) => allPaths.has(p) || allPaths.has(p + '.md'));
        if (!exists) {
          deadLinks.push({ source, target: link });
        }
      }
    }

    return { outgoing, incoming, deadLinks };
  }

  /** 获取反向链接 */
  getBacklinks(
    notePath: string,
  ): Array<{ notePath: string; noteTitle: string; context: string; lineNumber: number }> {
    const graph = this.getWikiLinkGraph();
    const sources = graph.incoming[notePath] ?? [];
    const noteName = notePath.replace(/\.md$/, '').replace(/^\//, '');

    // 也检查不带 .md 后缀的引用
    const altSources = graph.incoming[noteName] ?? [];
    const allSources = [...new Set([...sources, ...altSources])];

    return allSources.map((source) => ({
      notePath: source,
      noteTitle: this.index?.documents[source]?.title ?? source,
      context: '', // 上下文由前端在打开时提取
      lineNumber: 0,
    }));
  }

  /** 获取最近笔记（按修改时间倒序） */
  getRecentNotes(limit = 20): Array<{ path: string; title: string; lastOpenedAt: number }> {
    if (!this.index) return [];

    return Object.values(this.index.documents)
      .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
      .slice(0, limit)
      .map((doc) => ({
        path: doc.path,
        title: doc.title,
        lastOpenedAt: new Date(doc.modifiedAt).getTime(),
      }));
  }

  /** 索引单个文档 */
  private indexDocument(path: string, content: string, mtime: number): DocumentEntry {
    const fm = parseFrontmatter(content);
    const title = fm.data.title ?? extractTitle(content);
    const tags = this.extractAllTags(content, fm.data);
    const outgoingLinks = this.extractWikiLinks(content);

    return {
      path,
      title,
      tags,
      createdAt: fm.data.created ?? new Date(mtime).toISOString(),
      modifiedAt: fm.data.updated ?? new Date(mtime).toISOString(),
      wordCount: content.length,
      outgoingLinks,
    };
  }

  /** 提取所有标签（frontmatter + 内联 #tag） */
  private extractAllTags(content: string, fm: FrontmatterData): string[] {
    const tags = new Set<string>();

    // Frontmatter 中的 tags
    if (fm.tags) {
      for (const tag of fm.tags) {
        tags.add(tag.toLowerCase());
      }
    }

    // 内联 #tag
    const body = content.replace(/^---[\s\S]*?---\s*\n/, ''); // 跳过 frontmatter
    // 跳过代码块
    const withoutCodeBlocks = body.replace(/```[\s\S]*?```/g, '');
    let match: RegExpExecArray | null;
    while ((match = INLINE_TAG_RE.exec(withoutCodeBlocks)) !== null) {
      tags.add((match[1] ?? '').toLowerCase());
    }

    return [...tags];
  }

  /** 提取 Wiki-link */
  private extractWikiLinks(content: string): string[] {
    const links = new Set<string>();
    const body = content.replace(/^---[\s\S]*?---\s*\n/, '');
    // 跳过代码块
    const withoutCodeBlocks = body.replace(/```[\s\S]*?```/g, '');

    let match: RegExpExecArray | null;
    while ((match = WIKI_LINK_RE.exec(withoutCodeBlocks)) !== null) {
      links.add(match[1] ?? '');
    }

    return [...links];
  }

  /** 从 localStorage 加载索引 */
  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(INDEX_STORAGE_KEY);
      if (raw) {
        this.index = JSON.parse(raw) as SearchIndex;
      }
    } catch {
      this.index = null;
    }
  }

  /** 持久化索引到 localStorage */
  private saveToStorage(): void {
    try {
      localStorage.setItem(INDEX_STORAGE_KEY, JSON.stringify(this.index));
    } catch {
      // Storage full — silent fail
    }
  }
}
