/**
 * TauriIPCService — Tauri IPC 文件系统实现
 *
 * M6-08: 实现 IFileSystemService，通过 Tauri IPC 桥接 Rust 后端。
 * 替代 MockFSService 用于桌面/移动端真实文件系统操作。
 *
 * @module TauriIPCService
 * @see milestones.md M6-08
 */

import type {
  IFileSystemService,
  DirEntry,
  FileStat,
  FileChangeEvent,
  NotebookHandle,
  UnwatchFn,
  SearchResult,
} from '@/types';

/** IPC 返回的目录条目 */
interface IpcDirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified_at: number;
}

/** IPC 文件变更事件 */
interface IpcFileChangeEvent {
  kind: string;
  path: string;
  old_path?: string;
}

/** IPC 搜索结果 */
interface IpcSearchResult {
  note_path: string;
  note_title: string;
  snippet: string;
  score: number;
}

export class TauriIPCService implements IFileSystemService {
  private currentRoot: string | null = null;
  private unlisteners: Array<() => void> = [];

  // --- File Operations ---

  async readFile(path: string): Promise<string> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('read_file', { relativePath: path });
  }

  async writeFile(path: string, content: string): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('write_file', { relativePath: path, content });
  }

  // --- 二进制文件操作 (P2-1: 图片上传支持) ---

  async writeBinary(path: string, base64: string): Promise<void> {
    // Tauri 端：将 base64 数据写入文件
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('write_file', { relativePath: path, content: base64 });
  }

  async readBinary(path: string): Promise<string> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('read_file', { relativePath: path });
  }

  isBinaryPath(path: string): boolean {
    return /\.(png|jpe?g|gif|svg|webp|ico|bmp|pdf)(\?.*)?$/i.test(path);
  }

  async deleteFile(path: string): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('delete_file', { relativePath: path });
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    const content = await this.readFile(oldPath);
    await this.writeFile(newPath, content);
    await this.deleteFile(oldPath);
  }

  async createDirectory(_path: string): Promise<void> {
    // Parent directories are auto-created by Rust write_file
  }

  async listDirectory(path: string): Promise<DirEntry[]> {
    const { invoke } = await import('@tauri-apps/api/core');
    const entries = await invoke<IpcDirEntry[]>('list_directory', { relativePath: path });
    return entries.map((e) => ({
      name: e.name,
      path: e.path,
      isDirectory: e.is_dir,
      isFile: !e.is_dir,
      size: e.size,
      mtime: e.modified_at,
    }));
  }

  async statFile(path: string): Promise<FileStat> {
    const { invoke } = await import('@tauri-apps/api/core');
    const meta = await invoke<IpcDirEntry>('get_file_meta', { relativePath: path });
    return {
      size: meta.size,
      mtime: meta.modified_at,
      isFile: !meta.is_dir,
      isDirectory: meta.is_dir,
    };
  }

  // --- File Watching (M6-05) ---

  async watch(_rootPath: string, callback: (event: FileChangeEvent) => void): Promise<UnwatchFn> {
    const { invoke } = await import('@tauri-apps/api/core');
    const { listen } = await import('@tauri-apps/api/event');

    if (this.currentRoot) {
      await invoke('start_file_watcher', { rootPath: this.currentRoot });
    }

    const unlisten = await listen<IpcFileChangeEvent>('file-change', (event) => {
      const typeMap: Record<string, 'created' | 'modified' | 'deleted' | 'renamed'> = {
        create: 'created',
        modify: 'modified',
        remove: 'deleted',
        rename: 'renamed',
      };
      callback({
        type: typeMap[event.payload.kind] ?? 'modified',
        path: event.payload.path,
        oldPath: event.payload.old_path ?? undefined,
      });
    });

    this.unlisteners.push(unlisten);

    return () => {
      unlisten();
      this.unlisteners = this.unlisteners.filter((u) => u !== unlisten);
    };
  }

  async unwatchAll(): Promise<void> {
    for (const unlisten of this.unlisteners) {
      unlisten();
    }
    this.unlisteners = [];
  }

  // --- Path Utilities ---

  resolvePath(root: string, ...segments: string[]): string {
    const joined = segments.join('/').replace(/\\/g, '/');
    return root.replace(/\/$/, '') + '/' + joined.replace(/^\//, '');
  }

  async isPathInNotebook(_root: string, path: string): Promise<boolean> {
    if (!this.currentRoot) return false;
    const normalized = path.replace(/\\/g, '/');
    const rootNormalized = this.currentRoot.replace(/\\/g, '/');
    return normalized.startsWith(rootNormalized);
  }

  // --- Notebook Management ---

  async openNotebook(): Promise<NotebookHandle> {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ directory: true, multiple: false, title: '选择笔记本文件夹' });
    if (!selected || typeof selected !== 'string') {
      throw new Error('未选择文件夹');
    }

    const { invoke } = await import('@tauri-apps/api/core');
    const rootPath = await invoke<string>('open_notebook', { path: selected });
    this.currentRoot = rootPath;

    return { rootPath };
  }

  async getRecentNotebooks(): Promise<string[]> {
    try {
      const stored = localStorage.getItem('markluck-recent-notebooks');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  // --- Search (M6-04) ---

  async buildIndex(): Promise<number> {
    if (!this.currentRoot) return 0;
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<number>('build_index', { rootPath: this.currentRoot });
  }

  async searchIndex(query: string): Promise<SearchResult[]> {
    const { invoke } = await import('@tauri-apps/api/core');
    const results = await invoke<IpcSearchResult[]>('search_index', { query });
    return results.map((r) => ({
      notePath: r.note_path,
      noteTitle: r.note_title,
      matches: [],
      score: r.score,
    }));
  }

  async updateIndexDocument(filePath: string): Promise<void> {
    if (!this.currentRoot) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('update_index_document', { filePath, rootPath: this.currentRoot });
  }

  // --- Template (M6-06) ---

  async renderTemplate(template: string): Promise<string> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('render_template', { template });
  }

  async getBuiltinTemplate(type: string): Promise<string> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('get_builtin_template', { templateType: type });
  }
}
