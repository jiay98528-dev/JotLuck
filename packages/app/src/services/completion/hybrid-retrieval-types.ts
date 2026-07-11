/**
 * JSON-serializable protocol shared by the Web Worker and native retrieval
 * adapters. The protocol deliberately contains no Map, Set, class instance,
 * callback, or platform-specific handle.
 */
export type HybridRetrievalLanguageHint = 'zh' | 'en' | 'mixed' | 'unknown';

export type HybridRetrievalSourceLayer = 'notebook';

export interface HybridRetrievalBudget {
  maxDocuments: number;
  maxDocumentInputBytes: number;
  maxTotalInputBytes: number;
  maxDocumentEntries: number;
  maxTotalDocumentEntries: number;
}

export interface HybridRetrievalDiagnostics {
  workspaceScope: string;
  documentCount: number;
  fingerprintCount: number;
  inputBytes: number;
  retainedContentBytes: 0;
  documentEntries: number;
  budgetRejections: number;
  budget: HybridRetrievalBudget;
}

export type HybridRetrievalBackendKind = 'worker' | 'tauri' | 'local-test' | 'disabled';

export type HybridRetrievalHealthStatus = 'ready' | 'warming' | 'degraded' | 'disabled';

export interface HybridRetrievalHealthDiagnostics {
  backendKind: HybridRetrievalBackendKind;
  workspaceScope: string;
  status: HybridRetrievalHealthStatus;
  committedRevision: number;
  pendingMutations: number;
  pendingMutationBatches: number;
  rebuildCount: number;
  lastBuildDurationMs: number;
  totalBuildDurationMs: number;
  inputBytes: number;
  estimatedIndexBytes: number;
  longTasksOver50Ms: number;
}

export interface HybridRetrievalCandidate {
  text: string;
  confidence: number;
  support: number;
  documentSupport: number;
  providerId: 'hybrid-retrieval-zh' | 'hybrid-retrieval-en';
  sourceLayer: HybridRetrievalSourceLayer;
}

interface HybridRetrievalScopedRequest {
  workspaceScope: string;
}

export interface HybridRetrievalReplaceRequest extends HybridRetrievalScopedRequest {
  operation: 'replace';
  path: string;
  content: string;
}

export interface HybridRetrievalRemoveRequest extends HybridRetrievalScopedRequest {
  operation: 'remove';
  path: string;
}

export interface HybridRetrievalRenameRequest extends HybridRetrievalScopedRequest {
  operation: 'rename';
  oldPath: string;
  newPath: string;
}

export interface HybridRetrievalClearRequest extends HybridRetrievalScopedRequest {
  operation: 'clear';
}

export interface HybridRetrievalQueryRequest extends HybridRetrievalScopedRequest {
  operation: 'query';
  contextBeforeCursor: string;
  languageHint: HybridRetrievalLanguageHint;
  maxCandidates: number;
}

export type HybridRetrievalDocumentMutationRequest =
  | HybridRetrievalReplaceRequest
  | HybridRetrievalRemoveRequest
  | HybridRetrievalRenameRequest
  | HybridRetrievalClearRequest;

export interface HybridRetrievalBatchRequest extends HybridRetrievalScopedRequest {
  operation: 'batch';
  /** All mutations belong to workspaceScope and become visible under one revision. */
  mutations: HybridRetrievalDocumentMutationRequest[];
}

export type HybridRetrievalMutationRequest =
  | HybridRetrievalDocumentMutationRequest
  | HybridRetrievalBatchRequest;

export type HybridRetrievalRequest = HybridRetrievalMutationRequest | HybridRetrievalQueryRequest;

export interface HybridRetrievalMutationResponse {
  operation: HybridRetrievalMutationRequest['operation'];
  changed: boolean;
  documentCount: number;
  /** Required at process boundaries; optional only for the in-memory core adapter. */
  revision?: number;
}

export interface HybridRetrievalQueryResponse {
  operation: 'query';
  candidates: HybridRetrievalCandidate[];
  /** Required at process boundaries; optional only for the in-memory core adapter. */
  committedRevision?: number;
  pendingMutations?: number;
  warming?: boolean;
}

export type HybridRetrievalResponse =
  | HybridRetrievalMutationResponse
  | HybridRetrievalQueryResponse;
