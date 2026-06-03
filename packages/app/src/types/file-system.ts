// ============================================================
// MarkLuck — File System Abstraction Types
// ============================================================
// Source: spec/types/file-system.ts

/** 目录条目（文件或文件夹） */
export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  size?: number;
  mtime?: number;
}

/** 文件 stat 信息 */
export interface FileStat {
  size: number;
  mtime: number;
  isDirectory: boolean;
  isFile: boolean;
}

/** 文件系统变更事件 */
export interface FileChangeEvent {
  type: 'created' | 'modified' | 'deleted' | 'renamed';
  path: string;
  oldPath?: string;
}

/** 打开笔记本后返回的句柄 */
export interface NotebookHandle {
  rootPath: string;
  rootHandle?: FileSystemDirectoryHandle;
}

/** 取消文件监听的函数 */
export type UnwatchFn = () => void;

/**
 * 文件系统服务抽象接口。
 *
 * 所有业务逻辑通过此接口访问文件系统，不直接依赖
 * 浏览器 File System Access API 或 Tauri IPC。
 */
export interface IFileSystemService {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  renameFile(oldPath: string, newPath: string): Promise<void>;
  createDirectory(path: string): Promise<void>;
  listDirectory(path: string): Promise<DirEntry[]>;
  statFile(path: string): Promise<FileStat>;
  watch(rootPath: string, callback: (event: FileChangeEvent) => void): Promise<UnwatchFn>;
  unwatchAll(): Promise<void>;
  resolvePath(root: string, ...segments: string[]): string;
  isPathInNotebook(root: string, path: string): Promise<boolean>;
  openNotebook(): Promise<NotebookHandle>;
  getRecentNotebooks(): Promise<string[]>;
}
