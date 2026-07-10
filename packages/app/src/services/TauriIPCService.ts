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
import { listen, type UnlistenFn as TauriUnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import type {
  IFileSystemService,
  DirEntry,
  FileStat,
  FileChangeEvent,
  NotebookHandle,
  UnwatchFn,
} from '@/types';
import { isMarkdownLikeFile } from '@/utils/note-files';

// ── Rust DirEntry wire format ──

interface RustDirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified_at: number; // Unix epoch seconds
}

interface RustFileChangeEvent {
  kind: 'create' | 'modify' | 'remove' | 'rename';
  path: string;
  old_path?: string | null;
}

// ── Recent notebooks cache key ──

const RECENT_KEY = 'jotluck-recent-notebooks';

export function isLikelySystemNotebookScope(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  if (!normalized) return false;
  if (/^[a-z]:$/.test(normalized)) return true;
  if (/^[a-z]:\/users\/[^/]+$/.test(normalized)) return true;
  if (/^[a-z]:\/users\/[^/]+\/(desktop|downloads)$/.test(normalized)) return true;
  if (/^\/users\/[^/]+$/.test(normalized)) return true;
  if (/^\/users\/[^/]+\/(desktop|downloads)$/.test(normalized)) return true;
  return false;
}

export function sanitizeRecentNotebookPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    if (typeof path !== 'string' || !path.trim()) continue;
    const normalizedKey = path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    if (seen.has(normalizedKey) || isLikelySystemNotebookScope(path)) continue;
    seen.add(normalizedKey);
    result.push(path);
  }
  return result;
}

// ── TauriIPCService ──

export class TauriIPCService implements IFileSystemService {
  private unwatchFns: TauriUnlistenFn[] = [];
  private activeWatchRoot: string | null = null;
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
    return this.openNotebookAt(selected);
  }

  async openNotebookAt(path: string): Promise<NotebookHandle> {
    const root = await invoke<string>('open_notebook', { path });
    this.saveRecent(root);
    return { rootPath: root, name: this.displayNameFromPath(root) };
  }

  async openDefaultNotebook(): Promise<NotebookHandle> {
    const root = await invoke<string>('open_sample_notebook');
    this.saveRecent(root);
    return { rootPath: root, name: this.displayNameFromPath(root) };
  }

  async getRecentNotebooks(): Promise<string[]> {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      const list: string[] = raw ? JSON.parse(raw) : [];
      const sanitized = sanitizeRecentNotebookPaths(list);
      if (sanitized.length !== list.length) {
        localStorage.setItem(RECENT_KEY, JSON.stringify(sanitized));
      }
      return sanitized;
    } catch (e) {
      // localStorage 读取失败时静默降级为空列表，不阻断应用启动
      // eslint-disable-next-line no-console
      console.warn('[TauriIPCService] getRecentNotebooks localStorage 解析失败:', e);
      return [];
    }
  }

  private saveRecent(root: string): void {
    if (isLikelySystemNotebookScope(root)) return;
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      const list: string[] = raw ? JSON.parse(raw) : [];
      const filtered = sanitizeRecentNotebookPaths(list).filter((p) => p !== root);
      filtered.unshift(root);
      localStorage.setItem(RECENT_KEY, JSON.stringify(filtered.slice(0, 10)));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[TauriIPCService] saveRecent 失败', e);
    }
  }

  private displayNameFromPath(path: string): string {
    const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
    return normalized.split('/').pop() || normalized || 'Notebook';
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
    return invoke('write_binary_file', { relativePath: path, base64 });
  }

  async readBinary(path: string): Promise<string> {
    return invoke<string>('read_binary_file', { relativePath: path });
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
    if (isMarkdownLikeFile(fileName)) return 'text/markdown';
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
  // File Watching
  // ====================================================================

  async watch(rootPath: string, callback: (event: FileChangeEvent) => void): Promise<UnwatchFn> {
    await this.unwatchAll();
    await invoke('start_file_watcher', { rootPath });
    this.activeWatchRoot = rootPath;
    const unlisten = await listen<RustFileChangeEvent>('file-change', (event) => {
      const payload = event.payload;
      callback({
        type: this.mapChangeKind(payload.kind),
        path: payload.path.startsWith('/') ? payload.path : `/${payload.path}`,
        oldPath: payload.old_path
          ? payload.old_path.startsWith('/')
            ? payload.old_path
            : `/${payload.old_path}`
          : undefined,
      });
    });
    this.unwatchFns.push(unlisten);
    return () => {
      unlisten();
      this.unwatchFns = this.unwatchFns.filter((fn) => fn !== unlisten);
      if (this.activeWatchRoot === rootPath) {
        this.activeWatchRoot = null;
        void invoke('stop_file_watcher').catch((error) => {
          // eslint-disable-next-line no-console
          console.warn('[TauriIPCService] stop_file_watcher failed:', error);
        });
      }
    };
  }

  async unwatchAll(): Promise<void> {
    for (const unwatch of this.unwatchFns.splice(0)) {
      unwatch();
    }
    if (this.activeWatchRoot) {
      this.activeWatchRoot = null;
      await invoke('stop_file_watcher').catch((error) => {
        // eslint-disable-next-line no-console
        console.warn('[TauriIPCService] stop_file_watcher failed:', error);
      });
    }
  }

  private mapChangeKind(kind: RustFileChangeEvent['kind']): FileChangeEvent['type'] {
    if (kind === 'create') return 'created';
    if (kind === 'modify') return 'modified';
    if (kind === 'remove') return 'deleted';
    return 'renamed';
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
