// ============================================================
// JotLuck — Notebook / File System Types
// ============================================================
// Source: spec/types/notebook.ts

/** 笔记相对路径（统一使用 / 分隔符） */
export type NotePath = string;

/** 索引构建状态 */
export type IndexStatus = 'idle' | 'scanning' | 'indexing' | 'ready' | 'error';

/** 笔记本实体 */
export interface Notebook {
  id: string;
  name: string;
  path: string;
  notes: NotePath[];
  subfolders: string[];
  indexStatus: IndexStatus;
}

/** 文件树的统一节点类型 */
export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children: FileTreeNode[];
  isOpen: boolean;
}

/** 笔记本索引元数据（.jotluck_index.json） */
export interface NotebookMeta {
  version: string;
  lastIndexed: string;
  fileCount: number;
  tagCount: number;
}

/** 最近笔记条目 */
export interface RecentNote {
  path: NotePath;
  title: string;
  lastOpenedAt: number;
}
