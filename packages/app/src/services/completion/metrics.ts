import type { CompletionCandidate, CompletionSourceLayer } from './types';
import {
  normalizeCompletionScope,
  parseJsonSafely,
  readStorage,
  removeStorage,
  runCompletionStorageMutation,
  scopedCompletionStorageKey,
  writeStorage,
} from './learning-repository';

const LEGACY_METRICS_KEY = 'jotluck:autocomplete:providerMetrics:v1';
const GLOBAL_METRICS_KEY = 'jotluck:autocomplete:providerMetrics:v2';
const MAX_LATENCY_SAMPLES = 40;

export interface ProviderMetrics {
  shown: number;
  accepted: number;
  rejected: number;
  savedChars: number;
  latencies: number[];
}

export interface MetricsStore {
  version: 3;
  providers: Record<string, ProviderMetrics>;
  layers: Record<string, ProviderMetrics>;
  syntaxTypes: Record<string, ProviderMetrics>;
  updatedAt: number;
}

export function completionMetricsStorageKey(scope = 'unscoped'): string {
  return scopedCompletionStorageKey(scope, 'metrics:v2');
}

export function recordProviderShown(
  candidate: CompletionCandidate,
  latencyMs: number,
  scope = 'unscoped',
): void {
  updateMetrics(
    candidate.providerId,
    candidate.sourceLayer,
    candidate.syntaxType,
    scope,
    (metrics) => {
      metrics.shown++;
      metrics.latencies.push(Math.max(0, Math.round(latencyMs)));
      if (metrics.latencies.length > MAX_LATENCY_SAMPLES) {
        metrics.latencies.splice(0, metrics.latencies.length - MAX_LATENCY_SAMPLES);
      }
    },
  );
}

export function recordProviderAccepted(
  providerId: string | null,
  sourceLayer: CompletionSourceLayer | undefined,
  syntaxType: string | undefined,
  savedChars: number,
  scope = 'unscoped',
): void {
  if (!providerId) return;
  updateMetrics(providerId, sourceLayer, syntaxType, scope, (metrics) => {
    metrics.accepted++;
    metrics.savedChars += Math.max(0, savedChars);
  });
}

export function recordProviderRejected(
  providerId: string | null,
  sourceLayer?: CompletionSourceLayer,
  syntaxType?: string,
  scope = 'unscoped',
): void {
  if (!providerId) return;
  updateMetrics(providerId, sourceLayer, syntaxType, scope, (metrics) => {
    metrics.rejected++;
  });
}

export function loadCompletionMetrics(scope = 'unscoped'): MetricsStore {
  return loadMetrics(scope);
}

export function clearCompletionMetrics(scope = 'unscoped'): void {
  const normalizedScope = normalizeCompletionScope(scope);
  runCompletionStorageMutation(`metrics:${normalizedScope}`, () => {
    removeStorage(
      completionMetricsStorageKey(normalizedScope),
      ...(normalizedScope === 'unscoped' ? [GLOBAL_METRICS_KEY, LEGACY_METRICS_KEY] : []),
    );
  });
}

function updateMetrics(
  providerId: string,
  sourceLayer: CompletionSourceLayer | undefined,
  syntaxType: string | undefined,
  scope: string,
  updater: (metrics: ProviderMetrics) => void,
): void {
  const normalizedScope = normalizeCompletionScope(scope);
  runCompletionStorageMutation(`metrics:${normalizedScope}`, () => {
    const store = loadMetrics(normalizedScope);
    updater((store.providers[providerId] ??= createProviderMetrics()));
    updater(
      (store.layers[getLayerMetricsKey(providerId, sourceLayer)] ??= createProviderMetrics()),
    );
    updater(
      (store.syntaxTypes[getSyntaxMetricsKey(providerId, sourceLayer, syntaxType)] ??=
        createProviderMetrics()),
    );
    store.updatedAt = Date.now();
    writeStorage(completionMetricsStorageKey(normalizedScope), JSON.stringify(store));
  });
}

function loadMetrics(scope: string): MetricsStore {
  const targetKey = completionMetricsStorageKey(scope);
  const targetRaw = readStorage(targetKey);
  const current = normalizeMetricsStore(parseJsonSafely(targetRaw), false);
  if (current) return current;
  if (targetRaw !== null) removeStorage(targetKey);

  const normalizedScope = normalizeCompletionScope(scope);
  const legacyKeys = [
    scopedCompletionStorageKey(normalizedScope, 'providerMetrics:v2'),
    GLOBAL_METRICS_KEY,
    LEGACY_METRICS_KEY,
  ];
  for (const legacyKey of legacyKeys) {
    const migrated = normalizeMetricsStore(parseJsonSafely(readStorage(legacyKey)), true);
    if (!migrated) continue;
    writeStorage(targetKey, JSON.stringify(migrated));
    removeStorage(...legacyKeys);
    return migrated;
  }
  return createMetricsStore();
}

function normalizeMetricsStore(value: unknown, allowLegacy: boolean): MetricsStore | null {
  if (!value || typeof value !== 'object') return null;
  const parsed = value as Partial<MetricsStore> & { version?: number };
  if (parsed.version !== 3 && !(allowLegacy && (parsed.version === 1 || parsed.version === 2))) {
    return null;
  }
  if (
    !parsed.providers ||
    typeof parsed.providers !== 'object' ||
    Array.isArray(parsed.providers)
  ) {
    return null;
  }
  return {
    version: 3,
    providers: normalizeMetricsMap(parsed.providers),
    layers: normalizeMetricsMap(parsed.layers),
    syntaxTypes: normalizeMetricsMap(parsed.syntaxTypes),
    updatedAt: normalizeNonNegativeInteger(parsed.updatedAt),
  };
}

function normalizeMetricsMap(value: unknown): Record<string, ProviderMetrics> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized: Record<string, ProviderMetrics> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!key || key.length > 192 || !entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const source = entry as Partial<ProviderMetrics>;
    normalized[key] = {
      shown: normalizeNonNegativeInteger(source.shown),
      accepted: normalizeNonNegativeInteger(source.accepted),
      rejected: normalizeNonNegativeInteger(source.rejected),
      savedChars: normalizeNonNegativeInteger(source.savedChars),
      latencies: Array.isArray(source.latencies)
        ? source.latencies
            .filter((sample): sample is number => Number.isFinite(sample) && sample >= 0)
            .map((sample) => Math.round(sample))
            .slice(-MAX_LATENCY_SAMPLES)
        : [],
    };
  }
  return normalized;
}

function normalizeNonNegativeInteger(value: unknown): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function createMetricsStore(): MetricsStore {
  return {
    version: 3,
    providers: {},
    layers: {},
    syntaxTypes: {},
    updatedAt: 0,
  };
}

function createProviderMetrics(): ProviderMetrics {
  return {
    shown: 0,
    accepted: 0,
    rejected: 0,
    savedChars: 0,
    latencies: [],
  };
}

function getLayerMetricsKey(
  providerId: string,
  sourceLayer: CompletionSourceLayer | undefined,
): string {
  return `${providerId}:${sourceLayer ?? 'unknown'}`;
}

function getSyntaxMetricsKey(
  providerId: string,
  sourceLayer: CompletionSourceLayer | undefined,
  syntaxType: string | undefined,
): string {
  return `${providerId}:${sourceLayer ?? 'unknown'}:${syntaxType ?? 'unknown'}`;
}
