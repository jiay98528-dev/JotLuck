/**
 * IFileSystemService — 文件系统抽象层接口
 *
 * M1-16: 接口定义 + 服务注入模式。
 * 所有业务代码通过此接口访问文件系统。
 *
 * @module IFileSystemService
 * @see TAD.md §9
 */

export type { IFileSystemService } from '@/types';

/** 服务注入 key，用于 Vue provide/inject */
export const FS_SERVICE_KEY = Symbol('fsService');
