import type { CompletionLanguageHint, CompletionTextEdit } from './types';

export const V24_OPTIMIZATION_PROTOCOL_VERSION = 2;
export const V24_CACHE_MAX_DOCUMENT_SESSIONS = 4;
export const V24_CACHE_MAX_BYTES = 48 * 1024 * 1024;
export const V24_WORKER_PEAK_MEMORY_LIMIT_BYTES = 192 * 1024 * 1024;
export const V24_STATIC_ASSET_LIMIT_BYTES = 24 * 1024 * 1024;
export const V24_WRITING_MTP_ENGINE_ID = 'public-v2.4-writing-mtp-v1';
export const V24_WRITING_MTP_MANIFEST_SCHEMA = 'jotluck.autocomplete.public-v2.4-writing-mtp.v1';

export type V24SearchMode = 'fixed-1' | 'fixed-4' | 'adaptive-1-to-4';
export type V24CompletionRoute = 'format' | 'code' | 'writing' | 'silence';

export interface RoutedDecoderRequestV2 {
  editorSessionId: string;
  documentSessionId: string;
  documentRevision: number;
  searchMode: V24SearchMode;
}

export interface DecoderRuntimeDiagnostics {
  cacheStatus: 'hit' | 'miss' | 'invalidated';
  reusedTokens: number;
  computedTokens: number;
  invalidationReason?: string;
  finalBeamWidth: 1 | 4;
  escalationStep?: number;
  escalationReasons: string[];
}

export interface V24CacheIdentity {
  candidateId: string;
  modelSha256: string;
  tokenizerSha256: string;
  contextProtocol: string;
  route: 'code' | 'writing';
  language: Exclude<CompletionLanguageHint, 'mixed' | 'unknown'>;
  workspaceScope: string;
  editorSessionId: string;
  documentSessionId: string;
}

export interface V24CacheEntryMetadata {
  identity: V24CacheIdentity;
  tokenCount: number;
  bytes: number;
  lastUsedAt: number;
}

export interface V24CompletionEditCandidate {
  candidateId: string;
  route: Exclude<V24CompletionRoute, 'silence'>;
  edit: CompletionTextEdit;
  text: string;
  validatorReason: string;
}

export interface V24ThresholdObservation {
  top1Probability: number;
  top2Probability: number;
  fixedBeam1Usable: boolean;
  fixedBeam4Usable: boolean;
  p90Ms: number;
}

export interface V24AdaptiveThresholds {
  floor: 0.2 | 0.25 | 0.3 | 0.35 | 0.4;
  marginFloor: 0.1 | 0.2 | 0.3 | 0.4 | 0.5;
}

const FLOOR_VALUES = [0.2, 0.25, 0.3, 0.35, 0.4] as const;
const MARGIN_VALUES = [0.1, 0.2, 0.3, 0.4, 0.5] as const;

export function createV24CacheIdentityKey(identity: V24CacheIdentity): string {
  return [
    identity.candidateId,
    identity.modelSha256,
    identity.tokenizerSha256,
    identity.contextProtocol,
    identity.route,
    identity.language,
    identity.workspaceScope,
    identity.editorSessionId,
    identity.documentSessionId,
  ]
    .map(encodeIdentityPart)
    .join('|');
}

export function createEmptyDecoderRuntimeDiagnostics(): DecoderRuntimeDiagnostics {
  return {
    cacheStatus: 'miss',
    reusedTokens: 0,
    computedTokens: 0,
    finalBeamWidth: 1,
    escalationReasons: [],
  };
}

export function shouldEscalateAdaptiveBeam(
  top1Probability: number,
  top2Probability: number,
  thresholds: V24AdaptiveThresholds,
): boolean {
  if (!isProbability(top1Probability) || !isProbability(top2Probability)) return true;
  return (
    top1Probability < thresholds.floor || top1Probability - top2Probability < thresholds.marginFloor
  );
}

export function searchAdaptiveBeamThresholds(
  observations: readonly V24ThresholdObservation[],
): V24AdaptiveThresholds | null {
  if (observations.length === 0) return null;
  const fixedUsable = observations.filter((item) => item.fixedBeam4Usable).length;
  if (fixedUsable === 0) return null;
  const viable = [] as Array<{
    thresholds: V24AdaptiveThresholds;
    upgrades: number;
    p90Ms: number;
  }>;
  for (const floor of FLOOR_VALUES) {
    for (const marginFloor of MARGIN_VALUES) {
      const thresholds = { floor, marginFloor };
      const upgradedObservations = observations.filter((item) =>
        shouldEscalateAdaptiveBeam(item.top1Probability, item.top2Probability, thresholds),
      );
      const upgrades = upgradedObservations.length;
      const recall =
        observations.filter((item) =>
          shouldEscalateAdaptiveBeam(item.top1Probability, item.top2Probability, thresholds)
            ? item.fixedBeam4Usable
            : item.fixedBeam1Usable,
        ).length / observations.length;
      if (recall < 0.95 || upgrades / observations.length > 0.6) continue;
      const p90Values = observations.map((item) => item.p90Ms).filter(Number.isFinite);
      const p90Ms = p90Values.length === 0 ? Number.POSITIVE_INFINITY : percentile(p90Values, 0.9);
      viable.push({ thresholds, upgrades, p90Ms });
    }
  }
  viable.sort(
    (left, right) =>
      left.upgrades - right.upgrades ||
      left.p90Ms - right.p90Ms ||
      left.thresholds.floor - right.thresholds.floor ||
      left.thresholds.marginFloor - right.thresholds.marginFloor,
  );
  return viable[0]?.thresholds ?? null;
}

export interface WritingMtpManifest {
  schema: typeof V24_WRITING_MTP_MANIFEST_SCHEMA;
  format: 'JLFDQ05';
  engine: typeof V24_WRITING_MTP_ENGINE_ID;
  candidateId: string;
  candidateArtifactSha256: string;
  route: 'writing';
  blockSize: 2 | 4;
  modelSha256: string;
  tokenizerSha256: string;
  parameterCount: number;
  additionalParameterCount: number;
  staticAssetBytes: number;
  adaptiveThresholds: V24AdaptiveThresholds;
  evaluationOnly: true;
}

export function parseWritingMtpManifest(value: unknown): WritingMtpManifest {
  if (!isRecord(value)) throw new Error('Writing MTP manifest must be an object.');
  const thresholds = isRecord(value.adaptiveThresholds) ? value.adaptiveThresholds : null;
  const blockSize = value.blockSize;
  const parameterCount = value.parameterCount;
  const additionalParameterCount = value.additionalParameterCount;
  const staticAssetBytes = value.staticAssetBytes;
  if (
    value.schema !== V24_WRITING_MTP_MANIFEST_SCHEMA ||
    value.format !== 'JLFDQ05' ||
    value.engine !== V24_WRITING_MTP_ENGINE_ID ||
    value.route !== 'writing' ||
    !isCandidateId(value.candidateId) ||
    !isSha256(value.candidateArtifactSha256) ||
    !isSha256(value.modelSha256) ||
    !isSha256(value.tokenizerSha256) ||
    !isBlockSize(blockSize) ||
    !isNonNegativeSafeInteger(parameterCount) ||
    !isNonNegativeSafeInteger(additionalParameterCount) ||
    !isNonNegativeSafeInteger(staticAssetBytes) ||
    value.evaluationOnly !== true ||
    !isAdaptiveThresholds(thresholds)
  ) {
    throw new Error('Writing MTP manifest contract is invalid.');
  }
  const maximumAdditionalParameters = blockSize === 2 ? 600_000 : 1_700_000;
  if (additionalParameterCount > maximumAdditionalParameters) {
    throw new Error('Writing MTP additional parameters exceed the experiment budget.');
  }
  if (staticAssetBytes > V24_STATIC_ASSET_LIMIT_BYTES) {
    throw new Error('Writing MTP static assets exceed the 24 MiB budget.');
  }
  return {
    schema: V24_WRITING_MTP_MANIFEST_SCHEMA,
    format: 'JLFDQ05',
    engine: V24_WRITING_MTP_ENGINE_ID,
    candidateId: value.candidateId,
    candidateArtifactSha256: value.candidateArtifactSha256,
    route: 'writing',
    blockSize,
    modelSha256: value.modelSha256,
    tokenizerSha256: value.tokenizerSha256,
    parameterCount,
    additionalParameterCount,
    staticAssetBytes,
    adaptiveThresholds: {
      floor: thresholds.floor,
      marginFloor: thresholds.marginFloor,
    },
    evaluationOnly: true,
  };
}

function encodeIdentityPart(value: string): string {
  return `${value.length}:${value.replace(/[|\\]/gu, (character) => `\\${character}`)}`;
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? Number.POSITIVE_INFINITY;
}

function isProbability(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCandidateId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,95}$/u.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function isBlockSize(value: unknown): value is 2 | 4 {
  return value === 2 || value === 4;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isAdaptiveThresholds(
  value: Record<string, unknown> | null,
): value is Record<string, unknown> & V24AdaptiveThresholds {
  return (
    value !== null &&
    FLOOR_VALUES.includes(value.floor as (typeof FLOOR_VALUES)[number]) &&
    MARGIN_VALUES.includes(value.marginFloor as (typeof MARGIN_VALUES)[number])
  );
}
