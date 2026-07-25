/** A window-scoped startup session supplied by the desktop host. */
export type WindowSessionMode = 'workspace' | 'external-readonly' | 'external-edit';

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

export type WindowBootstrapPayload = WorkspaceBootstrapPayload | ExternalWindowBootstrapPayload;

export interface PromotedNotebookPayload {
  rootPath: string;
  name: string;
  initialRelativePath: string;
}
