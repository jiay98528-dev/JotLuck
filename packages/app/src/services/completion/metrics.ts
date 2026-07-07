import type { CompletionCandidate, CompletionSourceLayer } from './types';

const LEGACY_METRICS_KEY = 'markluck:autocomplete:providerMetrics:v1';
const METRICS_KEY = 'markluck:autocomplete:providerMetrics:v2';
const MAX_LATENCY_SAMPLES = 40;

export interface ProviderMetrics {
  shown: number;
  accepted: number;
  rejected: number;
  savedChars: number;
  latencies: number[];
}

export interface MetricsStore {
  version: 2;
  providers: Record<string, ProviderMetrics>;
  layers: Record<string, ProviderMetrics>;
  updatedAt: number;
}

export function recordProviderShown(candidate: CompletionCandidate, latencyMs: number): void {
  updateMetrics(candidate.providerId, candidate.sourceLayer, (metrics) => {
    metrics.shown++;
    metrics.latencies.push(Math.max(0, Math.round(latencyMs)));
    if (metrics.latencies.length > MAX_LATENCY_SAMPLES) {
      metrics.latencies.splice(0, metrics.latencies.length - MAX_LATENCY_SAMPLES);
    }
  });
}

export function recordProviderAccepted(
  providerId: string | null,
  sourceLayer: CompletionSourceLayer | undefined,
  savedChars: number,
): void {
  if (!providerId) return;
  updateMetrics(providerId, sourceLayer, (metrics) => {
    metrics.accepted++;
    metrics.savedChars += Math.max(0, savedChars);
  });
}

export function recordProviderRejected(
  providerId: string | null,
  sourceLayer?: CompletionSourceLayer,
): void {
  if (!providerId) return;
  updateMetrics(providerId, sourceLayer, (metrics) => {
    metrics.rejected++;
  });
}

export function loadCompletionMetrics(): MetricsStore {
  return loadMetrics();
}

export function clearCompletionMetrics(): void {
  try {
    localStorage.removeItem(METRICS_KEY);
    localStorage.removeItem(LEGACY_METRICS_KEY);
  } catch {
    // Metrics are local best-effort diagnostics.
  }
}

function updateMetrics(
  providerId: string,
  sourceLayer: CompletionSourceLayer | undefined,
  updater: (metrics: ProviderMetrics) => void,
): void {
  try {
    const store = loadMetrics();
    updater((store.providers[providerId] ??= createProviderMetrics()));
    updater(
      (store.layers[getLayerMetricsKey(providerId, sourceLayer)] ??= createProviderMetrics()),
    );
    store.updatedAt = Date.now();
    localStorage.setItem(METRICS_KEY, JSON.stringify(store));
  } catch {
    // Metrics are local best-effort diagnostics.
  }
}

function loadMetrics(): MetricsStore {
  const raw = localStorage.getItem(METRICS_KEY);
  if (!raw) return loadLegacyMetrics();
  const parsed = JSON.parse(raw) as Partial<MetricsStore>;
  if (parsed.version !== 2 || !parsed.providers) return createMetricsStore();
  return {
    version: 2,
    providers: parsed.providers,
    layers: parsed.layers ?? {},
    updatedAt: parsed.updatedAt ?? 0,
  };
}

function loadLegacyMetrics(): MetricsStore {
  const raw = localStorage.getItem(LEGACY_METRICS_KEY);
  if (!raw) return createMetricsStore();
  try {
    const parsed = JSON.parse(raw) as Partial<{
      version: number;
      providers: MetricsStore['providers'];
      updatedAt: number;
    }>;
    if (parsed.version !== 1 || !parsed.providers) return createMetricsStore();
    return {
      version: 2,
      providers: parsed.providers,
      layers: {},
      updatedAt: parsed.updatedAt ?? 0,
    };
  } catch {
    return createMetricsStore();
  }
}

function createMetricsStore(): MetricsStore {
  return {
    version: 2,
    providers: {},
    layers: {},
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
