/**
 * TauriIPCService — Tauri 桌面端文件系统实现
 *
 * 通过 Tauri IPC 调用 Rust 后端，访问真实文件系统。
 * 实现 IFileSystemService 接口，与 MockFSService 可互换。
 *
 * @see IFileSystemService — 接口定义
 * @see MockFSService — Web/E2E 测试的虚拟实现
 * @see fs_ops.rs — Rust 后端文件操作命令
 */
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type {
  IFileSystemService,
  DirEntry,
  FileStat,
  FileChangeEvent,
  NotebookHandle,
  UnwatchFn,
} from '@/types';

// ── Rust DirEntry wire format ──

interface RustDirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified_at: number; // Unix epoch seconds
}

// ── Recent notebooks cache key ──

const RECENT_KEY = 'markluck-recent-notebooks';

// ── TauriIPCService ──

export class TauriIPCService implements IFileSystemService {
  // ====================================================================
  // Notebook Management
  // ====================================================================

  async openNotebook(): Promise<NotebookHandle> {
    const selected = await open({
      directory: true,
      multiple: false,
      title: '选择笔记本文件夹',
    });
    if (!selected) throw new Error('用户取消了文件夹选择');
    const root = await invoke<string>('open_notebook', { path: selected });
    this.saveRecent(root);
    return { rootPath: root };
  }

  async getRecentNotebooks(): Promise<string[]> {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      // localStorage 读取失败时静默降级为空列表，不阻断应用启动
      // eslint-disable-next-line no-console
      console.warn('[TauriIPCService] getRecentNotebooks localStorage 解析失败:', e);
      return [];
    }
  }

  private saveRecent(root: string): void {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      const list: string[] = raw ? JSON.parse(raw) : [];
      const filtered = list.filter((p) => p !== root);
      filtered.unshift(root);
      localStorage.setItem(RECENT_KEY, JSON.stringify(filtered.slice(0, 10)));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[TauriIPCService] saveRecent 失败', e);
    }
  }

  // ====================================================================
  // File Operations
  // ====================================================================

  async readFile(path: string): Promise<string> {
    return invoke<string>('read_file', { relativePath: path });
  }

  async writeFile(path: string, content: string): Promise<void> {
    return invoke('write_file', { relativePath: path, content });
  }

  async writeBinary(path: string, base64: string): Promise<void> {
    return this.writeFile(path, base64);
  }

  async readBinary(path: string): Promise<string> {
    return this.readFile(path);
  }

  isBinaryPath(path: string): boolean {
    const ext = path.split('.').pop()?.toLowerCase();
    return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'pdf', 'docx', 'xlsx'].includes(
      ext ?? '',
    );
  }

  async deleteFile(path: string): Promise<void> {
    return invoke('delete_file', { relativePath: path });
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    return invoke('rename_file', {
      oldRelativePath: oldPath,
      newRelativePath: newPath,
    });
  }

  async createDirectory(path: string): Promise<void> {
    return invoke('create_directory', { relativePath: path });
  }

  // ====================================================================
  // Directory Listing
  // ====================================================================

  async listDirectory(path: string): Promise<DirEntry[]> {
    const entries = await invoke<RustDirEntry[]>('list_directory', { relativePath: path });
    return entries.map((e) => ({
      name: e.name,
      path: e.path,
      isDirectory: e.is_dir,
      isFile: !e.is_dir,
      size: e.size,
      mtime: e.modified_at * 1000, // seconds → milliseconds
      mimeType: this.detectMimeType(e.name),
    }));
  }

  private detectMimeType(fileName: string): string | undefined {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (ext === 'txt') return 'text/plain';
    return undefined;
  }

  // ====================================================================
  // Metadata
  // ====================================================================

  async statFile(path: string): Promise<FileStat> {
    const meta = await invoke<RustDirEntry>('get_file_meta', { relativePath: path });
    return {
      size: meta.size,
      mtime: meta.modified_at * 1000,
      isDirectory: meta.is_dir,
      isFile: !meta.is_dir,
    };
  }

  // ====================================================================
  // File Watching (stub — Tauri event system adaptation needed)
  // ====================================================================

  watch(_rootPath: string, _callback: (event: FileChangeEvent) => void): Promise<UnwatchFn> {
    return Promise.resolve(() => {});
  }

  async unwatchAll(): Promise<void> {
    /* no-op */
  }

  // ====================================================================
  // Path Utilities
  // ====================================================================

  resolvePath(root: string, ...segments: string[]): string {
    const joined = segments.join('/').replace(/\/+/g, '/');
    return root.endsWith('/') ? root + joined : root + '/' + joined;
  }

  async isPathInNotebook(root: string, path: string): Promise<boolean> {
    return path.startsWith(root);
  }
}
