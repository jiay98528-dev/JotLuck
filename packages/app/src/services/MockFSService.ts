/**
 * MockFSService — 内存虚拟文件系统实现
 *
 * 模拟文件读写延迟 (50ms) 以暴露竞态条件。
 * 数据持久化到 localStorage。
 * 内置示例笔记本数据。
 *
 * @see migration-map.md §4 — implements IFileSystemService
 */
import type {
  IFileSystemService,
  DirEntry,
  FileStat,
  FileChangeEvent,
  NotebookHandle,
  UnwatchFn,
} from '@/types';

const STORAGE_KEY = 'markluck-mockfs';
const STORAGE_VERSION = 2;
const DEFAULT_DELAY = 50;

interface StoredFile {
  content: string;
  mtime: number;
  size: number;
}

interface MockFSData {
  version: number;
  files: Record<string, StoredFile>;
  dirs: Record<string, string[]>;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function createSampleNotebook(): MockFSData {
  const now = Date.now();
  // Use a non-constant expression to prevent esbuild constant-folding the backtick
  // (which would inline it into the template literal and terminate it early)
  const bt = String.fromCharCode(93 + 3); // backtick = char code 96
  const bt3 = bt + bt + bt; // triple backtick for code fences
  return {
    version: STORAGE_VERSION,
    files: {
      '/快速入门.md': {
        content: `---
title: 快速入门
tags:
  - 入门
  - markdown
created: 2026-06-01
---

# 欢迎使用 MarkLuck

MarkLuck 是一个轻量化的 Markdown 笔记工具。

## 基本语法

- **粗体文字** 使用 ${bt}**文字**${bt}
- *斜体文字* 使用 ${bt}*文字*${bt}
- ${bt}行内代码${bt} 使用反引号

## 代码块

${bt3}typescript
function hello(): string {
  return "Hello, MarkLuck!";
}
${bt3}

## 链接

- Wiki-link: [[项目规划]]
- 外部链接: [MarkLuck GitHub](https://github.com)

## 标签

在笔记中使用 #标签 来分类，例如 #前端 #设计。

> 这是一段引用文字。MarkLuck 让你的笔记管理变得简单。
`,
        mtime: now,
        size: 0,
      },
      '/项目规划.md': {
        content: `---
title: 项目规划
tags:
  - 规划
  - 项目管理
created: 2026-06-02
---

# 项目规划

## 里程碑

- [x] M0: 项目脚手架
- [x] M1: 核心渲染与编辑
- [ ] M2: 索引与搜索
- [ ] M3: 导出与分享

## 设计方向

参考 [[设计笔记]] 了解更多。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + Vite |
| 桌面 | Tauri v2 |
| 渲染 | marked + DOMPurify |
`,
        mtime: now - 3600000,
        size: 0,
      },
      '/设计笔记.md': {
        content: `---
title: 设计笔记
tags:
  - 设计
  - UI
  - UX
created: 2026-06-03
---

# 设计笔记

## 设计哲学

**功能即装饰 (Function as Ornament)**

拒绝"为了让界面好看而加装饰"。

## 纸张隐喻

新的设计系统采用纸张隐喻：
- 暖纸背景
- 墨色文字
- 单一冷蓝强调色

## 参考

- [[快速入门]] — 基础使用
- [[项目规划]] — 开发计划

## 标签索引

#设计 #前端 #UI #UX #笔记工具
`,
        mtime: now - 7200000,
        size: 0,
      },
      '/子文件夹/笔记A.md': {
        content: `# 子文件夹笔记\n\n这是一条放在子文件夹里的笔记。\n\n链接回 [[快速入门]]。\n`,
        mtime: now - 10800000,
        size: 0,
      },
    },
    dirs: {
      '/': ['快速入门.md', '项目规划.md', '设计笔记.md', '子文件夹'],
      '/子文件夹': ['笔记A.md'],
    },
  };
}

export class MockFSService implements IFileSystemService {
  private data: MockFSData;
  private latency: number;

  constructor(latencyMs = DEFAULT_DELAY) {
    this.latency = latencyMs;
    this.data = this.load();
  }

  private load(): MockFSData {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as MockFSData;
        if (parsed.version === STORAGE_VERSION) return parsed;
      }
    } catch (e) {
      // localStorage 解析失败或版本不匹配 → 静默降级到示例数据，不阻断应用启动
      // eslint-disable-next-line no-console
      console.error('[MockFSService] localStorage 数据损坏，降级使用示例数据:', e);
    }
    const sample = createSampleNotebook();
    // recalculate sizes
    for (const [, file] of Object.entries(sample.files)) {
      file.size = new TextEncoder().encode(file.content).length;
    }
    this.persist(sample);
    return sample;
  }

  private persist(data?: MockFSData): void {
    if (data) this.data = data;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
  }

  private parentDir(path: string): string {
    const segs = path.split('/').filter(Boolean);
    segs.pop();
    return '/' + segs.join('/');
  }

  // === IFileSystemService Implementation ===

  async readFile(path: string): Promise<string> {
    await delay(this.latency);
    const file = this.data.files[path];
    if (!file) throw new Error(`文件不存在: ${path}`);
    return file.content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    await delay(this.latency);
    const now = Date.now();
    const size = new TextEncoder().encode(content).length;
    this.data.files[path] = { content, mtime: now, size };

    // Ensure directory entry exists
    const parent = this.parentDir(path);
    if (!this.data.dirs[parent]) {
      this.data.dirs[parent] = [];
    }
    const name = path.split('/').pop()!;
    if (!this.data.dirs[parent].includes(name)) {
      this.data.dirs[parent].push(name);
    }
    this.persist();
  }

  async writeBinary(path: string, base64: string): Promise<void> {
    await this.writeFile(path, base64);
  }

  async readBinary(path: string): Promise<string> {
    return this.readFile(path);
  }

  isBinaryPath(_path: string): boolean {
    const ext = _path.split('.').pop()?.toLowerCase();
    return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'pdf'].includes(ext ?? '');
  }

  async deleteFile(path: string): Promise<void> {
    await delay(this.latency);
    delete this.data.files[path];
    const parent = this.parentDir(path);
    const name = path.split('/').pop()!;
    if (this.data.dirs[parent]) {
      this.data.dirs[parent] = this.data.dirs[parent].filter((n) => n !== name);
    }
    this.persist();
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    await delay(this.latency);
    const file = this.data.files[oldPath];
    if (!file) throw new Error(`文件不存在: ${oldPath}`);
    delete this.data.files[oldPath];
    this.data.files[newPath] = file;

    const oldParent = this.parentDir(oldPath);
    const oldName = oldPath.split('/').pop()!;
    if (this.data.dirs[oldParent]) {
      this.data.dirs[oldParent] = this.data.dirs[oldParent].filter((n) => n !== oldName);
    }

    const newParent = this.parentDir(newPath);
    const newName = newPath.split('/').pop()!;
    if (!this.data.dirs[newParent]) this.data.dirs[newParent] = [];
    if (!this.data.dirs[newParent].includes(newName)) {
      this.data.dirs[newParent].push(newName);
    }

    this.persist();
  }

  async createDirectory(path: string): Promise<void> {
    await delay(this.latency);
    if (!this.data.dirs[path]) this.data.dirs[path] = [];
    const parent = this.parentDir(path);
    const name = path.split('/').pop()!;
    if (!this.data.dirs[parent]) this.data.dirs[parent] = [];
    if (!this.data.dirs[parent].includes(name)) {
      this.data.dirs[parent].push(name);
    }
    this.persist();
  }

  async listDirectory(path: string): Promise<DirEntry[]> {
    await delay(this.latency);
    const entries = this.data.dirs[path] ?? [];
    return entries
      .filter((name) => !name.startsWith('.'))
      .map((name) => {
        const fullPath = path === '/' ? `/${name}` : `${path}/${name}`;
        const isDir = fullPath in this.data.dirs;
        const file = this.data.files[fullPath];
        return {
          name,
          path: fullPath,
          isDirectory: isDir,
          isFile: !isDir,
          size: file?.size ?? 0,
          mtime: file?.mtime ?? 0,
          mimeType: name.endsWith('.txt') ? 'text/plain' : undefined,
        } satisfies DirEntry;
      })
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name, 'zh-CN');
      });
  }

  async statFile(path: string): Promise<FileStat> {
    await delay(this.latency);
    const file = this.data.files[path];
    const isDir = path in this.data.dirs;
    if (!file && !isDir) throw new Error(`路径不存在: ${path}`);
    return {
      path,
      size: file?.size ?? 0,
      isFile: !isDir,
      mtime: file?.mtime ?? 0,
      isDirectory: isDir,
    };
  }

  async watch(
    _rootPath: string,
    _callback: (events: FileChangeEvent[]) => void,
  ): Promise<UnwatchFn> {
    // Mock: no real file watching
    return () => {};
  }

  async unwatchAll(): Promise<void> {
    // no-op
  }

  resolvePath(_root: string, ...segments: string[]): string {
    return '/' + segments.filter(Boolean).join('/');
  }

  async isPathInNotebook(_root: string, _path: string): Promise<boolean> {
    return true;
  }

  async openNotebook(): Promise<NotebookHandle> {
    return { rootPath: '/', name: '示例笔记本' };
  }

  async getRecentNotebooks(): Promise<string[]> {
    return ['示例笔记本'];
  }
}
