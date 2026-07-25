/**
 * Desktop-window bootstrap contract. The backend derives the owner window
 * from Tauri invocation context; renderers never submit a window label.
 */
export type WindowSessionMode = 'workspace' | 'external-readonly' | 'external-edit';

export interface ExternalFileAuthorization {
  /** Normalized, case-normalized absolute path owned by this window session. */
  filePath: string;
  /** Supported file type, used to select Markdown or plain-text reading. */
  kind: 'markdown' | 'text';
}

export interface WorkspaceWindowBootstrapPayload {
  mode: 'workspace';
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

export type WindowBootstrapPayload =
  | WorkspaceWindowBootstrapPayload
  | ExternalReadonlyWindowBootstrapPayload
  | ExternalEditWindowBootstrapPayload;
