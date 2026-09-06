import type {
  CompletionBlockType,
  CompletionCandidate,
  CompletionLanguageHint,
  CompletionSourceKind,
} from './types';

/**
 * The production application owns exactly one optional public-L3 slot. This
 * contract is intentionally model-agnostic: stopped model manifests, worker
 * protocols and runtimes belong to their archived experiment, not this seam.
 */
export const PUBLIC_ENGINE_MAX_CANDIDATES = 32;
export const PUBLIC_ENGINE_PROVIDER_PRIORITY = 35;
export const PUBLIC_ENGINE_PROTOCOL_VERSION = 1;
export const PUBLIC_ENGINE_CONTEXT_MAX_UTF8_BYTES = 256;
export const PUBLIC_ENGINE_SUFFIX_MAX_UTF8_BYTES = 256;
export const PUBLIC_ENGINE_MAX_OUTPUT_CODE_POINTS = 48;
export const PUBLIC_V25_ENGINE_ID_PREFIX = 'public-v2.5-';

export type PublicEngineSourceKind = Extract<CompletionSourceKind, 'ngram' | 'neural'>;

export type PublicEngineCursorBoundary = 'word' | 'space' | 'punctuation' | 'other';
export type PublicEngineSearchMode = 'fixed-1' | 'fixed-4' | 'adaptive-1-to-4';
export type PublicEngineHealthStatus =
  | 'idle'
  | 'warming'
  | 'ready'
  | 'degraded'
  | 'disabled'
  | 'disposed';

export interface PublicEngineContextCapsule {
  schemaVersion: 1;
  maxTokens: number;
  languageHint: CompletionLanguageHint;
  headingTrail: readonly string[];
  currentParagraph: string;
  previousParagraphTail: string;
  /** Content only. No file path or workspace identity is permitted. */
  retrievalSnippet: string;
}

export interface PublicEngineGenerateRequest {
  engineEpoch: number;
  workspaceScope: string;
  documentVersion: string;
  cursorPos: number;
  /** Host-trimmed UTF-8 suffix. It must never contain the full document by default. */
  contextTail: string;
  contextTailUtf8Bytes: number;
  /** Host-trimmed text after the cursor on the current line; used only to validate FIM edits. */
  contextSuffix?: string;
  /** Optional V2.2 bounded capsule. Legacy public engines ignore this field. */
  contextCapsule?: PublicEngineContextCapsule;
  languageHint: CompletionLanguageHint;
  blockType: CompletionBlockType;
  /** Canonical fenced-code language and cursor lexical state, derived by the host. */
  codeLanguage?: string;
  codeLexicalContext?: 'code' | 'string' | 'comment' | 'unknown';
  cursorBoundary: PublicEngineCursorBoundary;
  maxCandidates: number;
  /** Optional V2.4 evaluation-only identity and search controls. */
  editorSessionId?: string;
  documentSessionId?: string;
  documentRevision?: number;
  searchMode?: PublicEngineSearchMode;
  /** Absolute Unix time in milliseconds. */
  deadlineAt: number;
}

/**
 * Untrusted model/Worker output. The engine cannot choose insertion position,
 * provider attribution, source layer, priority or learning policy.
 */
export interface PublicEngineRawCandidate {
  candidateId: string;
  text: string;
  confidence: number;
  /** Probability-like language-model score, normalized to [0, 1]. */
  modelScore: number;
  /** Calibrated visibility-gate score, normalized to [0, 1]. */
  gateScore: number;
  language: 'zh' | 'en';
}

export interface PublicEngineGenerateResponse {
  protocolVersion: number;
  engineEpoch: number;
  workspaceScope: string;
  documentVersion: string;
  cursorPos: number;
  candidates: readonly PublicEngineRawCandidate[];
  diagnostics?: PublicEngineRuntimeDiagnostics;
}

export interface PublicEngineRuntimeDiagnostics {
  cacheStatus: 'hit' | 'miss' | 'invalidated';
  reusedTokens: number;
  computedTokens: number;
  invalidationReason?: string;
  finalBeamWidth: 1 | 4 | 32;
  escalationStep?: number;
  escalationReasons: readonly string[];
}

export interface PublicEngineVisibilityCalibrationInput {
  route: 'writing' | 'code';
  language: 'zh' | 'en';
  modelScore: number;
  searchMode?: PublicEngineSearchMode;
}

export interface PublicCompletionCandidate extends CompletionCandidate {
  candidateId: string;
  source: PublicEngineSourceKind;
  sourceLayer: 'l3';
  language: 'zh' | 'en';
  modelScore: number;
  gateScore: number;
}

export interface PublicEngineAssetDiagnostics {
  manifestBytes: number;
  modelBytes: number;
  auxiliaryBytes: number;
  runtimeBytes: number;
  modelDataBytes: number;
  staticDeltaBytes: number;
}

export interface PublicEngineRequestProbe {
  /** First 16 hex chars of a stable hash over the serialized context capsule. */
  capsuleSha: string;
  /** Leading characters of the serialized capsule, for E2E forensics. */
  capsuleHead: string;
  maxTokens: number;
  searchMode: string;
  languageHint: string;
  blockType: string;
}

export interface PublicEngineDiagnostics {
  engineId: string;
  backendKind: string;
  status: PublicEngineHealthStatus;
  epoch: number;
  profile: string | null;
  lastError: string | null;
  warmupDurationMs: number;
  lastInferenceDurationMs: number;
  visibleInferenceP90Ms: number;
  generateRequests: number;
  generatedCandidates: number;
  cancellations: number;
  deadlineExpirations: number;
  lateResponses: number;
  invalidResponses: number;
  workerErrors: number;
  /** Requests the worker dropped as superseded or deadline-expired without a response frame. */
  staleResponses: number;
  /** Summary of the most recent request handed to the worker adapter, for E2E forensics. */
  lastRequestProbe: PublicEngineRequestProbe | null;
  assets: PublicEngineAssetDiagnostics;
}

export interface CompletionPublicEngine {
  readonly id: string;
  readonly protocolVersion: number;
  readonly sourceKind: PublicEngineSourceKind;
  readonly maxOutputCodePoints: number;
  warmup(signal?: AbortSignal): Promise<boolean>;
  generate(
    request: PublicEngineGenerateRequest,
    signal?: AbortSignal,
  ): Promise<PublicEngineGenerateResponse>;
  /**
   * Trusted adapter-side calibration bound to the installed V2.5 manifest,
   * route, search mode and hardware profile. Worker-provided gate scores are
   * never used for a V2.5 display decision.
   */
  calibrateVisibility?(input: PublicEngineVisibilityCalibrationInput): number;
  /** Route/search/hardware-specific display threshold from the same signed manifest. */
  visibilityThreshold?(input: PublicEngineVisibilityCalibrationInput): number;
  diagnostics(): PublicEngineDiagnostics;
  dispose(): void | Promise<void>;
}

export function createEmptyPublicEngineAssetDiagnostics(): PublicEngineAssetDiagnostics {
  return {
    manifestBytes: 0,
    modelBytes: 0,
    auxiliaryBytes: 0,
    runtimeBytes: 0,
    modelDataBytes: 0,
    staticDeltaBytes: 0,
  };
}
