/**
 * MockFSService - in-memory virtual file system for Web/E2E.
 *
 * The mock mirrors the Tauri IPC file-system contract: notebook-rooted paths use
 * `/` as the root marker, every note is plain text, and the sample notebook is
 * persisted to localStorage between page reloads.
 */
import type {
  DirEntry,
  FileChangeEvent,
  FileStat,
  IFileSystemService,
  NotebookHandle,
  UnwatchFn,
} from '@/types';
import { isMarkdownLikeFile, isSupportedNoteFile } from '@/utils/note-files';

const STORAGE_KEY = 'markluck-mockfs';
const STORAGE_VERSION = 4;
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
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePath(path: string): string {
  const normalized = (path || '/').replace(/\\/g, '/').replace(/\/+/g, '/');
  if (normalized === '/') return '/';
  return normalized.startsWith('/') ? normalized.replace(/\/+$/, '') : `/${normalized}`;
}

function encodeSize(content: string): number {
  return new TextEncoder().encode(content).length;
}

function createSampleNotebook(): MockFSData {
  const now = Date.now();
  const files: Record<string, StoredFile> = {
    '/快速入门.md': {
      content: `---
title: 快速入门
tags:
  - 入门
  - markdown
created: 2026-06-01
---

# 欢迎使用 MarkLuck

MarkLuck 是一款轻量、本地优先、离线可用的 Markdown 笔记工具。每一条笔记都是普通的 .md 文件，文件夹就是笔记本。

## 从这里开始

- 在左侧书签中切换常用笔记。
- 点击文件抽屉浏览当前文件夹。
- 使用 Ctrl+K 搜索笔记、标签和正文。
- 通过 [[格式示例]] 查看常用 Markdown 写法。
- 关联项目资料：[[项目规划]]。
- 外部链接示例：[MarkLuck GitHub](https://github.com)。

## 文件就是数据

你可以用任意文本编辑器打开这些文件，也可以把文件夹放进 Git、OneDrive 或移动硬盘中同步。

> MarkLuck 只增强写作体验，不接管你的数据。
`,
      mtime: now,
      size: 0,
    },
    '/格式示例.md': {
      content: `---
title: 格式示例
tags:
  - markdown
  - 示例
created: 2026-06-01
---

# 格式示例

## 文本样式

普通正文、**粗体**、*斜体*、~~删除线~~、\`行内代码\`。

## 列表

- 无序列表
- 支持嵌套
  - 子项目

1. 有序列表
2. 第二项

## 任务

- [x] 打开示例文档
- [ ] 创建第一条自己的笔记
- [ ] 试试导出功能

## 引用

> 纯文本是可靠的长期格式。

## 代码块

~~~ts
function hello(name: string): string {
  return \`Hello, \${name}\`;
}
~~~

## 表格

| 功能 | 状态 |
| --- | --- |
| 本地文件 | 支持 |
| Wiki-link | 支持 |
| 离线补全 | 支持 |

## 链接

关联到 [[快速入门]]，也可以写外部链接：[Markdown Guide](https://www.markdownguide.org/)。
`,
      mtime: now - 60000,
      size: 0,
    },
    '/项目规划.md': {
      content: `---
title: 项目规划
tags:
  - 规划
  - 项目
created: 2026-06-02
---

# 项目规划

## 本周目标

- [x] 整理笔记结构
- [ ] 写一份会议纪要
- [ ] 回顾 [[设计笔记]]

## 里程碑

| 阶段 | 目标 |
| --- | --- |
| M1 | 建立笔记体系 |
| M2 | 完成资料归档 |
| M3 | 输出复盘文档 |
`,
      mtime: now - 3600000,
      size: 0,
    },
    '/设计笔记.md': {
      content: `---
title: 设计笔记
tags:
  - 设计
  - 写作
created: 2026-06-03
---

# 设计笔记

MarkLuck 的界面应该退到内容之后。文件树、编辑器、预览和大纲是工作结构，不是装饰。

## 原则

- 结构清晰
- 操作直接
- 结果可见

参考 [[快速入门]] 和 [[格式示例]]。
`,
      mtime: now - 7200000,
      size: 0,
    },
    '/子文件夹/笔记A.md': {
      content: `# 子文件夹笔记

这是一条放在子文件夹里的笔记。

链接回 [[快速入门]]。
`,
      mtime: now - 10800000,
      size: 0,
    },
  };

  for (const file of Object.values(files)) {
    file.size = encodeSize(file.content);
  }

  return {
    version: STORAGE_VERSION,
    files,
    dirs: {
      '/': ['快速入门.md', '格式示例.md', '项目规划.md', '设计笔记.md', '子文件夹'],
      '/子文件夹': ['笔记A.md'],
    },
  };
}

export class MockFSService implements IFileSystemService {
  private data: MockFSData;
  private readonly latency: number;

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
      // eslint-disable-next-line no-console
      console.error('[MockFSService] localStorage data is invalid, resetting sample notebook:', e);
    }

    const sample = createSampleNotebook();
    this.persist(sample);
    return sample;
  }

  private persist(data?: MockFSData): void {
    if (data) this.data = data;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
  }

  private parentDir(path: string): string {
    const segs = normalizePath(path).split('/').filter(Boolean);
    segs.pop();
    return segs.length ? `/${segs.join('/')}` : '/';
  }

  private basename(path: string): string {
    return normalizePath(path).split('/').pop() ?? '';
  }

  async readFile(path: string): Promise<string> {
    await delay(this.latency);
    const normalized = normalizePath(path);
    const file = this.data.files[normalized];
    if (!file) throw new Error(`文件不存在: ${normalized}`);
    return file.content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    const normalized = normalizePath(path);
    const now = Date.now();
    this.data.files[normalized] = {
      content,
      mtime: now,
      size: encodeSize(content),
    };

    const parent = this.parentDir(normalized);
    if (!this.data.dirs[parent]) this.data.dirs[parent] = [];
    const name = this.basename(normalized);
    if (!this.data.dirs[parent].includes(name)) this.data.dirs[parent].push(name);
    this.persist();
    await delay(this.latency);
  }

  async writeBinary(path: string, base64: string): Promise<void> {
    await this.writeFile(path, base64);
  }

  async readBinary(path: string): Promise<string> {
    return this.readFile(path);
  }

  isBinaryPath(path: string): boolean {
    const ext = path.split('.').pop()?.toLowerCase();
    return [
      'png',
      'jpg',
      'jpeg',
      'gif',
      'webp',
      'svg',
      'bmp',
      'ico',
      'pdf',
      'docx',
      'xlsx',
    ].includes(ext ?? '');
  }

  async deleteFile(path: string): Promise<void> {
    await delay(this.latency);
    const normalized = normalizePath(path);
    delete this.data.files[normalized];
    const parent = this.parentDir(normalized);
    const name = this.basename(normalized);
    if (this.data.dirs[parent]) {
      this.data.dirs[parent] = this.data.dirs[parent].filter((entry) => entry !== name);
    }
    this.persist();
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    await delay(this.latency);
    const oldNormalized = normalizePath(oldPath);
    const newNormalized = normalizePath(newPath);
    const file = this.data.files[oldNormalized];
    if (!file) throw new Error(`文件不存在: ${oldNormalized}`);

    delete this.data.files[oldNormalized];
    this.data.files[newNormalized] = { ...file, mtime: Date.now() };

    const oldParent = this.parentDir(oldNormalized);
    const oldName = this.basename(oldNormalized);
    if (this.data.dirs[oldParent]) {
      this.data.dirs[oldParent] = this.data.dirs[oldParent].filter((entry) => entry !== oldName);
    }

    const newParent = this.parentDir(newNormalized);
    const newName = this.basename(newNormalized);
    if (!this.data.dirs[newParent]) this.data.dirs[newParent] = [];
    if (!this.data.dirs[newParent].includes(newName)) this.data.dirs[newParent].push(newName);
    this.persist();
  }

  async createDirectory(path: string): Promise<void> {
    await delay(this.latency);
    const normalized = normalizePath(path);
    if (!this.data.dirs[normalized]) this.data.dirs[normalized] = [];

    const parent = this.parentDir(normalized);
    const name = this.basename(normalized);
    if (!this.data.dirs[parent]) this.data.dirs[parent] = [];
    if (name && !this.data.dirs[parent].includes(name)) this.data.dirs[parent].push(name);
    this.persist();
  }

  async listDirectory(path: string): Promise<DirEntry[]> {
    await delay(this.latency);
    const normalized = normalizePath(path);
    const entries = this.data.dirs[normalized] ?? [];
    return entries
      .filter((name) => {
        if (name.startsWith('.')) return false;
        const fullPath = normalized === '/' ? `/${name}` : `${normalized}/${name}`;
        return fullPath in this.data.dirs || isSupportedNoteFile(name);
      })
      .map((name) => {
        const fullPath = normalized === '/' ? `/${name}` : `${normalized}/${name}`;
        const isDirectory = fullPath in this.data.dirs;
        const file = this.data.files[fullPath];
        return {
          name,
          path: fullPath,
          isDirectory,
          isFile: !isDirectory,
          size: file?.size ?? 0,
          mtime: file?.mtime ?? 0,
          mimeType: isMarkdownLikeFile(name)
            ? 'text/markdown'
            : name.endsWith('.txt')
              ? 'text/plain'
              : undefined,
        } satisfies DirEntry;
      })
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name, 'zh-CN');
      });
  }

  async statFile(path: string): Promise<FileStat> {
    await delay(this.latency);
    const normalized = normalizePath(path);
    const file = this.data.files[normalized];
    const isDirectory = normalized in this.data.dirs;
    if (!file && !isDirectory) throw new Error(`路径不存在: ${normalized}`);
    return {
      path: normalized,
      size: file?.size ?? 0,
      mtime: file?.mtime ?? 0,
      isDirectory,
      isFile: !isDirectory,
    };
  }

  async watch(
    _rootPath: string,
    _callback: (events: FileChangeEvent | FileChangeEvent[]) => void,
  ): Promise<UnwatchFn> {
    return () => {};
  }

  async unwatchAll(): Promise<void> {
    // no-op
  }

  resolvePath(root: string, ...segments: string[]): string {
    return normalizePath([root, ...segments].join('/'));
  }

  async isPathInNotebook(_root: string, _path: string): Promise<boolean> {
    return true;
  }

  async openNotebook(): Promise<NotebookHandle> {
    return { rootPath: '/', name: '示例笔记本' };
  }

  async openNotebookAt(_path: string): Promise<NotebookHandle> {
    return this.openNotebook();
  }

  async getRecentNotebooks(): Promise<string[]> {
    return ['示例笔记本'];
  }
}
