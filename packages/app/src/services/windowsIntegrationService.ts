/**
 * windowsIntegrationService — Windows 集成 IPC 收口层
 *
 * 收编 windows_integration 全族四命令（Rust lib.rs 注册于
 * windows_integration 模块）：专业文档编辑器候选/唤起、系统默认应用
 * 关联状态与系统设置页打开。全部经 TauriIPCService.invokeCommand 走
 * normalizeCommandError，页面层不再直调 @tauri-apps/api/core。
 */
import type {
  DocumentEditorCandidate,
  DocumentEditorLaunchResult,
  WindowsAssociationStatus,
} from '@/types';
import { invokeCommand } from './TauriIPCService';

/** 当前文档导入源可用的专业编辑器候选（无候选时回退「打开方式」）。 */
export async function getDocumentEditorCandidate(): Promise<DocumentEditorCandidate> {
  return invokeCommand<DocumentEditorCandidate>('get_document_editor_candidate');
}

/** 用候选（或系统「打开方式」）唤起当前文档导入源的专业编辑器。 */
export async function openDocumentSourceInEditor(
  handlerId: string | undefined,
): Promise<DocumentEditorLaunchResult> {
  return invokeCommand<DocumentEditorLaunchResult>('open_document_source_in_editor', {
    handlerId,
  });
}

/** 查询 Markdown/文本/Word/PDF/Excel 五组默认应用关联状态。 */
export async function getWindowsAssociationStatus(): Promise<WindowsAssociationStatus> {
  return invokeCommand<WindowsAssociationStatus>('get_windows_association_status');
}

/** 打开 Windows「默认应用」设置页（用户手动确认关联）。 */
export async function openJotluckDefaultAppsSettings(): Promise<void> {
  return invokeCommand<void>('open_jotluck_default_apps_settings');
}
