/** A window-scoped startup session supplied by the desktop host. */
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

export interface ExternalOpenedFile {
  absolutePath: string;
  relativePath: string;
  accessToken: string;
}

export interface WorkspaceBootstrapPayload {
  mode: 'workspace';
  initialRelativePath?: string;
}

export interface ExternalWindowBootstrapPayload {
  mode: 'external-readonly' | 'external-edit';
  openedFile: ExternalOpenedFile;
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
  | WorkspaceBootstrapPayload
  | ExternalWindowBootstrapPayload
  | DocumentImportBootstrapPayload;

export interface PromotedNotebookPayload {
  rootPath: string;
  name: string;
  initialRelativePath: string;
}

export interface SaveExternalNoteAsRequest {
  defaultFileName: string;
  dialogTitle: string;
  filterName: string;
  content: string;
}

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

export interface DocumentConversionAssetPayload {
  bytes: number[];
  mediaType: string;
  fileName: string;
}

export interface SaveConvertedDocumentDialogRequest {
  defaultFileName: string;
  dialogTitle: string;
  filterName: string;
  originalPreservationConfirmed: boolean;
}

export interface DocumentEditorCandidate {
  handlerId?: string;
  displayName: string;
  available: boolean;
  fallbackToOpenWith: boolean;
}

export interface DocumentEditorLaunchResult {
  displayName: string;
  usedOpenWith: boolean;
}

export type AssociationApplicationState = 'applied' | 'partial' | 'not-applied' | 'unsupported';

export interface AssociationGroupStatus {
  id: 'markdown' | 'text' | 'word' | 'pdf' | 'excel';
  extensions: string[];
  state: AssociationApplicationState;
  activeProgIds: Array<string | null>;
}

export interface WindowsAssociationStatus {
  supported: boolean;
  groups: AssociationGroupStatus[];
}
