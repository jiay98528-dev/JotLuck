import type { PredictionResult } from '@/utils/ngram-engine';
import type { CompletionAblationMode } from '@/services/completion/types';

export interface JotLuckE2EOpenedFile {
  absolutePath?: string;
  absolute_path?: string;
  notebookRoot?: string;
  notebook_root?: string;
  relativePath?: string;
  relative_path?: string;
}

export interface JotLuckE2EEditorBridge {
  id: string;
  getContent: () => string;
  setContent: (content: string) => void;
  getCursor: () => number;
  getPrediction: () => PredictionResult | null;
  seedCompletionCorpus: (excerpts: string[]) => void;
  setCompletionAblationMode: (mode: CompletionAblationMode) => void;
}

export interface JotLuckE2EBridge {
  editor?: JotLuckE2EEditorBridge;
  mockOpenedFile?: JotLuckE2EOpenedFile;
  externalFiles?: Record<string, string>;
  externalWrites?: Array<{ absolutePath: string; content: string; time: number }>;
  debugState?: () => {
    activePath: string;
    currentContent: string;
    externalSessionMode: string;
    isDirty: boolean;
    isExternalEditing: boolean;
  };
}

export function isJotLuckE2EBridgeEnabled(): boolean {
  return import.meta.env.MODE === 'e2e';
}

export function getJotLuckE2EBridge(): JotLuckE2EBridge | null {
  if (!isJotLuckE2EBridgeEnabled()) return null;
  window.__jotluck_e2e = window.__jotluck_e2e ?? {};
  return window.__jotluck_e2e;
}

export function peekJotLuckE2EBridge(): JotLuckE2EBridge | null {
  if (!isJotLuckE2EBridgeEnabled()) return null;
  return window.__jotluck_e2e ?? null;
}
