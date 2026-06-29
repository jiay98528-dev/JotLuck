export interface MarkluckE2EOpenedFile {
  absolutePath?: string;
  absolute_path?: string;
  notebookRoot?: string;
  notebook_root?: string;
  relativePath?: string;
  relative_path?: string;
}

export interface MarkluckE2EEditorBridge {
  id: string;
  getContent: () => string;
  seedCompletionCorpus: (excerpts: string[]) => void;
}

export interface MarkluckE2EBridge {
  editor?: MarkluckE2EEditorBridge;
  mockOpenedFile?: MarkluckE2EOpenedFile;
  externalFiles?: Record<string, string>;
  externalWrites?: Array<{ absolutePath: string; content: string; time: number }>;
}

export function isMarkluckE2EBridgeEnabled(): boolean {
  return import.meta.env.MODE === 'e2e';
}

export function getMarkluckE2EBridge(): MarkluckE2EBridge | null {
  if (!isMarkluckE2EBridgeEnabled()) return null;
  window.__markluck_e2e = window.__markluck_e2e ?? {};
  return window.__markluck_e2e;
}

export function peekMarkluckE2EBridge(): MarkluckE2EBridge | null {
  if (!isMarkluckE2EBridgeEnabled()) return null;
  return window.__markluck_e2e ?? null;
}
