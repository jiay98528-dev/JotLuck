import type { PredictionResult } from '@/utils/ngram-engine';
import type { CompletionRequestDiagnostics } from '@/services/MarkdownPredictor';
import type { CompletionAblationMode } from '@/services/completion/types';
import type { HybridRetrievalHealthDiagnostics } from '@/services/completion/hybrid-retrieval-types';

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
  getVisiblePredictionDiagnostics: () => {
    prediction: PredictionResult;
    elapsedMs: number;
    cursor: number;
    documentLength: number;
  } | null;
  requestCompletionDiagnostics: (
    content: string,
    cursorOffset?: number,
    deadlineMs?: number,
  ) => Promise<CompletionRequestDiagnostics>;
  seedCompletionCorpus: (excerpts: string[]) => void;
  seedWorkspaceDocuments: (documents: Array<{ path: string; content: string }>) => Promise<void>;
  getHybridRetrievalHealth: () => HybridRetrievalHealthDiagnostics;
  seedPersonalCompletion: (context: string, acceptedText: string) => Promise<void>;
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
  listNotePaths?: () => string[];
  selectNote?: (path: string) => Promise<void>;
}

export function isJotLuckE2EBridgeEnabled(): boolean {
  return import.meta.env.MODE === 'e2e' || import.meta.env.MODE === 'autocomplete-v2r-evaluation';
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
