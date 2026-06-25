// ============================================================
// spec/types/file-system.ts — 文件系统抽象层类型
// ============================================================

// ===== 目录条目 =====

/** 目录条目（文件或文件夹） */
export interface DirEntry {
  /** 文件/文件夹名 */
  name: string;
  /** 相对路径（使用 / 分隔符） */
  path: string;
  /** 是否为目录 */
  isDirectory: boolean;
  /** 是否为文件 */
  isFile: boolean;
  /** 文件大小（字节），仅文件有效 */
  size?: number;
  /** 最后修改时间 (Unix ms)，仅文件有效 */
  mtime?: number;
}

// ===== 文件元数据 =====

/** 文件 stat 信息 */
export interface FileStat {
  /** 文件大小（字节） */
  size: number;
  /** 最后修改时间 (Unix ms) */
  mtime: number;
  /** 是否为目录 */
  isDirectory: boolean;
  /** 是否为文件 */
  isFile: boolean;
}

// ===== 文件变更事件 =====

/** 文件系统变更事件 */
export interface FileChangeEvent {
  /** 变更类型 */
  type: 'created' | 'modified' | 'deleted' | 'renamed';
  /** 受影响的文件/文件夹相对路径 */
  path: string;
  /** 旧路径（仅 renamed 事件） */
  oldPath?: string;
}

// ===== 笔记本句柄 =====

/** 打开笔记本后返回的句柄 */
export interface NotebookHandle {
  /** 根目录路径（或 Web 端的显示名称） */
  rootPath: string;
  /** 显示名称，通常为目录名 */
  name?: string;
  /** Web 端目录句柄（File System Access API） */
  rootHandle?: FileSystemDirectoryHandle;
}

// ===== 取消监听函数 =====

/** 取消文件监听的函数 */
export type UnwatchFn = () => void;

// ===== 文件系统抽象接口 =====

/**
 * 文件系统服务抽象接口。
 *
 * 所有业务逻辑通过此接口访问文件系统，不直接依赖
 * 浏览器 File System Access API 或 Tauri IPC。
 * 在 Web / Tauri Desktop / Mock 三种环境下有各自的实现。
 */
export interface IFileSystemService {
  // --- 基础文件操作 ---

  /** 读取文本文件内容 */
  readFile(path: string): Promise<string>;
  /** 写入文本文件（原子写入：.tmp → rename） */
  writeFile(path: string, content: string): Promise<void>;
  /** 删除文件 */
  deleteFile(path: string): Promise<void>;
  /** 重命名/移动文件 */
  renameFile(oldPath: string, newPath: string): Promise<void>;

  // --- 目录操作 ---

  /** 创建目录 */
  createDirectory(path: string): Promise<void>;
  /** 列出目录内容（仅返回支持的笔记文件和子目录） */
  listDirectory(path: string): Promise<DirEntry[]>;

  // --- 元数据 ---

  /** 获取文件/文件夹元数据 */
  statFile(path: string): Promise<FileStat>;

  // --- 文件监控 ---

  /**
   * 启动文件监控。
   *
   * @param rootPath - 监控的根目录
   * @param callback - 收到文件变更事件时的回调
   * @returns 取消监听的函数
   */
  watch(rootPath: string, callback: (event: FileChangeEvent) => void): Promise<UnwatchFn>;

  /** 取消所有文件监控 */
  unwatchAll(): Promise<void>;

  // --- 路径工具 ---

  /**
   * 拼接路径。所有输入使用 / 分隔，返回使用 / 分隔。
   */
  resolvePath(root: string, ...segments: string[]): string;

  /**
   * 安全检查：确认 targetPath 在 root 目录内，防止路径遍历攻击。
   */
  isPathInNotebook(root: string, path: string): Promise<boolean>;

  // --- 笔记本管理 ---

  /** 弹出文件夹选择器，打开笔记本根目录 */
  openNotebook(): Promise<NotebookHandle>;

  /** 使用已知目录路径打开笔记本，不弹出系统选择器。桌面端文件关联使用此入口。 */
  openNotebookAt(path: string): Promise<NotebookHandle>;

  /** 获取最近使用的笔记本路径列表 */
  getRecentNotebooks(): Promise<string[]>;
}
