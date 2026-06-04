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
  /** base64-encoded binary data (images, etc.) */
  base64?: string;
  /** MIME type for binary files */
  mimeType?: string;
  mtime: number;
  size: number;
}

export class MockFSService implements IFileSystemService {
  /** 内存文件树：路径 → 节点 */
  private tree = new Map<string, VirtualNode>();
  /** 模拟延迟（ms），暴露竞态条件 */
  private delay: number;

  private storageKey = 'markluck-mock-fs';
  /** 数据版本 — 递增以触发旧缓存迁移 */
  private static readonly DATA_VERSION = 2;

  constructor(delay = 50) {
    this.delay = delay;
    // 尝试从 localStorage 恢复（带版本检查）
    if (!this.loadFromStorage()) {
      this.initSampleNotebook();
      this.saveToStorage();
    }
  }

  /** 从 localStorage 恢复文件树（带版本检查） */
  private loadFromStorage(): boolean {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return false;
      const data = JSON.parse(raw) as Record<
        string,
        | {
            type: 'file' | 'directory';
            content?: string;
            base64?: string;
            mimeType?: string;
            mtime: number;
            size: number;
          }
        | number
      >;

      // 版本检查：旧版本数据清空，重新初始化
      if (data['__version__'] !== MockFSService.DATA_VERSION) {
        localStorage.removeItem(this.storageKey);
        return false;
      }
      delete data['__version__'];

      for (const [path, node] of Object.entries(data)) {
        if (typeof node === 'object' && node.type) {
          this.tree.set(path, { ...node } as VirtualNode);
        }
      }
      // Only count .md files, not directories
      const fileCount = [...this.tree.values()].filter((n) => n.type === 'file').length;
      return fileCount > 0;
    } catch {
      return false;
    }
  }

  /** 持久化文件树到 localStorage */
  private saveToStorage(): void {
    try {
      const data: Record<string, unknown> = {};
      for (const [path, node] of this.tree) {
        data[path] = {
          type: node.type,
          content: node.content,
          base64: node.base64,
          mimeType: node.mimeType,
          mtime: node.mtime,
          size: node.size,
        };
      }
      data['__version__'] = MockFSService.DATA_VERSION;
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch {
      // Storage full or unavailable — silent fail
    }
  }

  private async wait(): Promise<void> {
    if (this.delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delay));
    }
  }

  /** 初始化示例笔记本结构（多级目录 + 多种文件类型） */
  private initSampleNotebook(): void {
    const now = Date.now();

    // --- 根目录 ---
    this.tree.set('/', { type: 'directory', mtime: now, size: 0 });

    // --- 欢迎笔记 ---
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
- **链接** — 访问 [MarkLuck 官网](https://markluck.dev) 了解更多

## 快速开始

1. 在左侧文件树浏览笔记
2. 点击笔记开始编辑
3. 按 \`Ctrl+S\` 保存
`;
    this.tree.set('/欢迎.md', { type: 'file', content: welcome, mtime: now, size: welcome.length });

    // --- 快速入门 ---
    const quickstart = `# 快速入门

这是一个 #tutorial 笔记。

## 第一步

打开文件夹开始记笔记。

## 第二步

使用 [[Wiki-link]] 连接笔记。

## 参考链接

- Markdown 语法: https://www.markdownguide.org
- 项目仓库: https://github.com/markluck/markluck
`;
    this.tree.set('/快速入门.md', {
      type: 'file',
      content: quickstart,
      mtime: now,
      size: quickstart.length,
    });

    // --- 子目录: work/ ---
    this.tree.set('/work', { type: 'directory', mtime: now, size: 0 });

    const meeting = `# 会议纪要

**日期**: {{date}}
**参与者**: 张三, 李四

## 议题

1. 项目进度回顾
2. 下一阶段计划
3. ~~旧方案讨论~~ 新方案确定

## 决议

- [x] 完成 M1 核心渲染
- [ ] 完成 M2 索引搜索
- [ ] 发布 v0.1.0
`;
    this.tree.set('/work/会议纪要.md', {
      type: 'file',
      content: meeting,
      mtime: now,
      size: meeting.length,
    });

    const report = `# 周报 — {{date}}

## 本周完成

- 实现了 **Live Preview** 块级渲染
- 修复了 #bug 搜索正则表达式的 BUG
- 优化了文件树 [[快速入门|导航体验]]

## 下周计划

1. 实现图片上传功能
2. 完善文件管理器
3. 主题切换增强

> 注：本周代码提交 12 次，测试覆盖率 85%
`;
    this.tree.set('/work/周报.md', {
      type: 'file',
      content: report,
      mtime: now,
      size: report.length,
    });

    // --- 子目录: assets/ ---
    this.tree.set('/assets', { type: 'directory', mtime: now, size: 0 });

    // --- 文本文件示例 ---
    this.tree.set('/README.txt', {
      type: 'file',
      content: 'This is a sample README file.\n\nMarkLuck stores all notes as plain text files.',
      mtime: now,
      size: 80,
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
    this.saveToStorage();
  }

  // --- 二进制文件操作 (P2-1: 图片上传支持) ---

  async writeBinary(path: string, base64: string): Promise<void> {
    await this.wait();
    const mimeType = this.detectMimeType(path, base64);
    this.tree.set(path, {
      type: 'file',
      content: '__BINARY__', // 标记为二进制，防止 readFile 误读
      base64,
      mimeType,
      mtime: Date.now(),
      size: base64.length,
    });
    // 确保父目录存在
    const parentDir = path.substring(0, path.lastIndexOf('/'));
    if (parentDir && !this.tree.has(parentDir)) {
      this.tree.set(parentDir, { type: 'directory', mtime: Date.now(), size: 0 });
    }
    this.saveToStorage();
  }

  async readBinary(path: string): Promise<string> {
    await this.wait();
    const node = this.tree.get(path);
    if (!node || node.type !== 'file') {
      throw new Error(`文件不存在: ${path}`);
    }
    if (!node.base64) {
      throw new Error(`不是二进制文件: ${path}`);
    }
    return node.base64;
  }

  isBinaryPath(path: string): boolean {
    return /\.(png|jpe?g|gif|svg|webp|ico|bmp|pdf)(\?.*)?$/i.test(path);
  }

  /** 从路径或 base64 头检测 MIME 类型 */
  private detectMimeType(path: string, base64: string): string {
    // 优先从 base64 data URI 头检测
    const headerMatch = base64.match(/^data:(image\/\w+);base64,/);
    if (headerMatch) return headerMatch[1]!;
    // 从文件扩展名推断
    const ext = path.split('.').pop()?.toLowerCase();
    const mimeMap: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      webp: 'image/webp',
      ico: 'image/x-icon',
      bmp: 'image/bmp',
      pdf: 'application/pdf',
    };
    return mimeMap[ext ?? ''] ?? 'application/octet-stream';
  }

  async deleteFile(path: string): Promise<void> {
    await this.wait();
    if (!this.tree.has(path)) {
      throw new Error(`文件不存在: ${path}`);
    }
    this.tree.delete(path);
    this.saveToStorage();
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
        mimeType: node.mimeType,
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
