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
export const PUBLIC_ENGINE_MAX_OUTPUT_CODE_POINTS = 48;

export type PublicEngineSourceKind = Extract<CompletionSourceKind, 'ngram' | 'neural'>;

export type PublicEngineCursorBoundary = 'word' | 'space' | 'punctuation' | 'other';
export type PublicEngineHealthStatus =
  | 'idle'
  | 'warming'
  | 'ready'
  | 'degraded'
  | 'disabled'
  | 'disposed';

export interface PublicEngineGenerateRequest {
  engineEpoch: number;
  workspaceScope: string;
  documentVersion: string;
  cursorPos: number;
  /** Host-trimmed UTF-8 suffix. It must never contain the full document by default. */
  contextTail: string;
  contextTailUtf8Bytes: number;
  languageHint: CompletionLanguageHint;
  blockType: CompletionBlockType;
  cursorBoundary: PublicEngineCursorBoundary;
  maxCandidates: number;
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
