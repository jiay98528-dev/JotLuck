import type { Channel } from '@tauri-apps/api/core';
import type {
  ConditionalWriteResult,
  DocumentConversionAssetPayload,
  DocumentConversionEvent,
  ExternalOpenedFile,
  PromotedNotebookPayload,
  SaveConvertedDocumentDialogRequest,
  SaveExternalNoteAsRequest,
  TextFileSnapshot,
  WindowBootstrapPayload,
} from '@/types';
import { invokeCommand } from './TauriIPCService';

/**
 * 窗口会话与文档导入 IPC 收口层（window_session + document_import 全族）。
 *
 * BootstrapPage 与 NotebookHome 冷启动都需要 get_window_bootstrap；
 * 各自 invoke 会串行发起两次 IPC。这里缓存同一份 Promise，窗口内
 * 第二个调用方立即复用结果；失败不缓存，下次调用自动重试。
 */
let cached: Promise<WindowBootstrapPayload> | null = null;

export function getWindowBootstrap(): Promise<WindowBootstrapPayload> {
  if (!cached) {
    const startedAt = performance.now();
    const request = invokeCommand<WindowBootstrapPayload>('get_window_bootstrap');
    cached = request;
    void request
      .then((payload) => {
        performance.mark('jotluck:bootstrap-ipc-resolved', {
          detail: { mode: payload.mode, ms: Math.round(performance.now() - startedAt) },
        });
      })
      .catch(() => {
        // 仅当失败请求仍是当前缓存条目时清空，避免失效后旧请求的迟到失败误清新缓存。
        if (cached === request) cached = null;
      });
  }
  return cached;
}

/**
 * 显式失效窗口级缓存。
 *
 * enable_external_edit / promote_external_file_to_notebook 成功后，后端窗口身份
 * 已切换，旧 bootstrap 结果不再可信；使下一次 getWindowBootstrap 重新发起
 * IPC。重复调用幂等（缓存已清空时再清一次无副作用）。
 */
export function invalidateWindowBootstrap(): void {
  cached = null;
}

// ── 窗口身份（身份切换成功后统一失效窗口级缓存） ────────────────────────

/**
 * 把只读外链窗口切换为可编辑。成功后后端窗口身份已切换，此处统一失效
 * 冷启动缓存，调用方无须再手动 invalidateWindowBootstrap。
 */
export async function enableExternalEdit(): Promise<void> {
  await invokeCommand<void>('enable_external_edit');
  invalidateWindowBootstrap();
}

/**
 * 把外链文件升级为其父目录笔记本。成功后后端窗口身份已切换，此处统一
 * 失效冷启动缓存，调用方无须再手动 invalidateWindowBootstrap。
 */
export async function promoteExternalFileToNotebook(): Promise<PromotedNotebookPayload> {
  const promoted = await invokeCommand<PromotedNotebookPayload>(
    'promote_external_file_to_notebook',
  );
  invalidateWindowBootstrap();
  return promoted;
}

/** 撤销某外链文件的访问授权（窗口拆除路径，失败由调用方吞掉）。 */
export async function revokeExternalAccess(accessToken: string): Promise<void> {
  return invokeCommand<void>('revoke_external_access', { accessToken });
}

/**
 * 强制销毁当前窗口。前端保存守卫完成后调用；close() 会再次触发
 * CloseRequested 重入守卫，故走 destroy。
 */
export async function destroyCurrentWindow(): Promise<void> {
  return invokeCommand<void>('destroy_current_window');
}

// ── 文档导入转换（无缓存失效语义，纯类型化包装；Channel 透传） ──────────

/** 启动当前窗口的文档转换任务，事件经调用方持有的 Channel 回流。 */
export async function startDocumentConversion(
  channel: Channel<DocumentConversionEvent>,
): Promise<string> {
  return invokeCommand<string>('start_document_conversion', { channel });
}

/** 取消指定转换任务（幂等；窗口清理路径会兜底终止 worker）。 */
export async function cancelDocumentConversion(conversionId: string): Promise<void> {
  return invokeCommand<void>('cancel_document_conversion', { conversionId });
}

/** 读取转换产物资源（图片等二进制，按字节数组回流）。 */
export async function readDocumentConversionAsset(
  conversionId: string,
  assetId: string,
): Promise<DocumentConversionAssetPayload> {
  return invokeCommand<DocumentConversionAssetPayload>('read_document_conversion_asset', {
    conversionId,
    assetId,
  });
}

/** 把转换出的 Markdown 另存为副本（系统保存对话框；取消返回 null）。 */
export async function saveConvertedDocumentAs(
  conversionId: string,
  dialogRequest: SaveConvertedDocumentDialogRequest,
): Promise<ExternalOpenedFile | null> {
  return invokeCommand<ExternalOpenedFile | null>('save_converted_document_as', {
    conversionId,
    dialogRequest,
  });
}

/** 校验转换源文件是否仍与转换时一致（false = 已过期）。 */
export async function refreshDocumentSourceRevision(conversionId: string): Promise<boolean> {
  return invokeCommand<boolean>('refresh_document_source_revision', { conversionId });
}

// ── 外链笔记文件（external_note_file / save_external_note_as；纯类型化包装） ──

/** save_external_note_as 的返回载荷：新外链笔记定位（notebookRoot 供进入笔记本）。 */
export interface OpenedFilePayload {
  absolutePath: string;
  notebookRoot: string;
  relativePath: string;
  accessToken?: string;
}

/** 读取外链笔记文件快照（内容 + 磁盘修订号；授权过期由调用方兜底提示）。 */
export function readExternalNoteFileSnapshot(
  accessToken: string,
  relativePath: string,
): Promise<TextFileSnapshot> {
  return invokeCommand<TextFileSnapshot>('read_external_note_file_snapshot', {
    accessToken,
    relativePath,
  });
}

/** 条件写外链笔记文件（revision 不一致时返回 conflict，由保存管线裁决）。 */
export function writeExternalNoteFileIfUnchanged(
  accessToken: string,
  relativePath: string,
  content: string,
  expectedRevision: string | null,
): Promise<ConditionalWriteResult> {
  return invokeCommand<ConditionalWriteResult>('write_external_note_file_if_unchanged', {
    accessToken,
    relativePath,
    content,
    expectedRevision,
  });
}

/** 经系统另存对话框把内容存为新外链笔记（用户取消返回 null）。 */
export function saveExternalNoteAs(
  request: SaveExternalNoteAsRequest,
): Promise<OpenedFilePayload | null> {
  return invokeCommand<OpenedFilePayload | null>('save_external_note_as', { request });
}

/** 读取当前窗口绑定的笔记本根目录（未绑定为 null）。 */
export function getNotebookRoot(): Promise<string | null> {
  return invokeCommand<string | null>('get_notebook_root');
}

/** 只读读取外链文件全文（ExternalReaderPage 冷启动主路径）。 */
export function readExternalNoteFile(accessToken: string, relativePath: string): Promise<string> {
  return invokeCommand<string>('read_external_note_file', { accessToken, relativePath });
}
