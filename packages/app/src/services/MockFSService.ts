/**
 * MockFSService — 内存虚拟文件系统
 *
 * M1-16: 模拟文件系统操作，用于前端先行开发阶段。
 * 在 Tauri 接入前（M6），所有文件操作通过此 Mock 实现。
 *
 * @module MockFSService
 * @see TAD.md §9.4
 */

import type {
  IFileSystemService,
  DirEntry,
  FileStat,
  FileChangeEvent,
  NotebookHandle,
  UnwatchFn,
} from '@/types';

/** 虚拟文件节点 */
interface VirtualNode {
  type: 'file' | 'directory';
  content?: string;
  mtime: number;
  size: number;
}

export class MockFSService implements IFileSystemService {
  /** 内存文件树：路径 → 节点 */
  private tree = new Map<string, VirtualNode>();
  /** 模拟延迟（ms），暴露竞态条件 */
  private delay: number;

  constructor(delay = 50) {
    this.delay = delay;
    // 初始化一个示例笔记本
    this.initSampleNotebook();
  }

  private async wait(): Promise<void> {
    if (this.delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delay));
    }
  }

  /** 初始化示例笔记本结构 */
  private initSampleNotebook(): void {
    const welcome = `---
title: 欢迎使用 MarkLuck
tags: [markluck, welcome]
created: 2026-06-03
---

# 欢迎使用 MarkLuck

这是一条示例笔记。你可以自由编辑或删除它。

## 特性

- **纯文本** — 每条笔记就是一个 \`.md\` 文件
- **Wiki-link** — 试试 [[快速入门]]
- **标签** — 使用 #tag 组织你的笔记

## 快速开始

1. 在左侧文件树浏览笔记
2. 点击笔记开始编辑
3. 按 \`Ctrl+S\` 保存
`;
    this.tree.set('/', { type: 'directory', mtime: Date.now(), size: 0 });
    this.tree.set('/欢迎.md', {
      type: 'file',
      content: welcome,
      mtime: Date.now(),
      size: welcome.length,
    });
    this.tree.set('/快速入门.md', {
      type: 'file',
      content:
        '# 快速入门\n\n这是一个 #tutorial 笔记。\n\n## 第一步\n\n打开文件夹开始记笔记。\n\n## 第二步\n\n使用 [[Wiki-link]] 连接笔记。\n',
      mtime: Date.now(),
      size: 100,
    });
  }

  // --- 基础文件操作 ---

  async readFile(path: string): Promise<string> {
    await this.wait();
    const node = this.tree.get(path);
    if (!node || node.type !== 'file') {
      throw new Error(`文件不存在: ${path}`);
    }
    return node.content ?? '';
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.wait();
    this.tree.set(path, {
      type: 'file',
      content,
      mtime: Date.now(),
      size: content.length,
    });
  }

  async deleteFile(path: string): Promise<void> {
    await this.wait();
    if (!this.tree.has(path)) {
      throw new Error(`文件不存在: ${path}`);
    }
    this.tree.delete(path);
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    await this.wait();
    const node = this.tree.get(oldPath);
    if (!node) throw new Error(`文件不存在: ${oldPath}`);
    this.tree.delete(oldPath);
    this.tree.set(newPath, node);
  }

  // --- 目录操作 ---

  async createDirectory(path: string): Promise<void> {
    await this.wait();
    this.tree.set(path, { type: 'directory', mtime: Date.now(), size: 0 });
  }

  async listDirectory(path: string): Promise<DirEntry[]> {
    await this.wait();
    const entries: DirEntry[] = [];
    const prefix = path === '/' ? '/' : path + '/';

    for (const [p, node] of this.tree) {
      if (p === path) continue;
      if (!p.startsWith(prefix)) continue;

      const relative = p.slice(prefix.length);
      // Only immediate children
      if (relative.includes('/')) continue;

      entries.push({
        name: relative,
        path: p,
        isDirectory: node.type === 'directory',
        isFile: node.type === 'file',
        size: node.size,
        mtime: node.mtime,
      });
    }

    return entries;
  }

  // --- 元数据 ---

  async statFile(path: string): Promise<FileStat> {
    await this.wait();
    const node = this.tree.get(path);
    if (!node) throw new Error(`文件不存在: ${path}`);
    return {
      size: node.size,
      mtime: node.mtime,
      isDirectory: node.type === 'directory',
      isFile: node.type === 'file',
    };
  }

  // --- 文件监控（Mock 不支持实时监控） ---

  async watch(_rootPath: string, _callback: (event: FileChangeEvent) => void): Promise<UnwatchFn> {
    return () => {
      // no-op unwatch
    };
  }

  async unwatchAll(): Promise<void> {
    // no-op
  }

  // --- 路径工具 ---

  resolvePath(root: string, ...segments: string[]): string {
    return [root, ...segments].join('/').replace(/\/+/g, '/');
  }

  async isPathInNotebook(_root: string, _path: string): Promise<boolean> {
    return true;
  }

  // --- 笔记本管理 ---

  async openNotebook(): Promise<NotebookHandle> {
    await this.wait();
    return { rootPath: '/mock-notebook' };
  }

  async getRecentNotebooks(): Promise<string[]> {
    return ['/mock-notebook'];
  }
}
