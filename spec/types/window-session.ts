/**
 * Desktop-window bootstrap contract. The backend derives the owner window
 * from Tauri invocation context; renderers never submit a window label.
 * Spec version: v1.1 (2026-08-04).
 */
export type WindowSessionMode =
  | 'workspace'
  | 'external-readonly'
  | 'document-import-readonly'
  | 'external-edit';

export type ImportedDocumentKind = 'docx' | 'pdf' | 'xlsx' | 'xls';

export interface SourceRevision {
  sha256: string;
  size: number;
  modifiedAtMs: number;
}

export interface ExternalFileAuthorization {
  /** Normalized, case-normalized absolute path owned by this window session. */
  filePath: string;
  /** Supported file type, used to select Markdown or plain-text reading. */
  kind: 'markdown' | 'text';
  /** External bootstrap is read-only; only enable_external_edit can change it. */
  access: 'read' | 'read-write';
}

export interface WorkspaceWindowBootstrapPayload {
  mode: 'workspace';
  /** Present only after opening a notebook or promote_external_file_to_notebook. */
  workspaceRoot?: string;
  /** Optional target selected after opening or promoting a notebook. */
  initialFilePath?: string;
}

export interface ExternalReadonlyWindowBootstrapPayload {
  mode: 'external-readonly';
  externalFile: ExternalFileAuthorization;
}

export interface ExternalEditWindowBootstrapPayload {
  mode: 'external-edit';
  externalFile: ExternalFileAuthorization;
}

export interface DocumentImportBootstrapPayload {
  mode: 'document-import-readonly';
  source: {
    fileName: string;
    kind: ImportedDocumentKind;
    revision: SourceRevision;
  };
}

export type WindowBootstrapPayload =
  | WorkspaceWindowBootstrapPayload
  | ExternalReadonlyWindowBootstrapPayload
  | ExternalEditWindowBootstrapPayload
  | DocumentImportBootstrapPayload;

export type DocumentProgressUnit = 'bytes' | 'pages' | 'sheets' | 'rows' | 'blocks' | 'assets';

export type DocumentConversionEvent =
  | {
      type: 'phase';
      phase: string;
      unit?: DocumentProgressUnit;
      completed?: number;
      total?: number;
    }
  | { type: 'chunk'; sequence: number; markdown: string }
  | { type: 'asset'; assetId: string; fileName: string; mediaType: string; bytes: number }
  | { type: 'warning'; code: string; message: string; context?: string }
  | {
      type: 'complete';
      conversionId: string;
      revision: SourceRevision;
      markdownBytes: number;
    }
  | { type: 'stale'; revision: SourceRevision }
  | { type: 'cancelled' }
  | { type: 'error'; code: string; message: string };
