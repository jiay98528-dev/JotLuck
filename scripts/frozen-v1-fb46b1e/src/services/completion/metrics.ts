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
  version: 3;
  providers: Record<string, ProviderMetrics>;
  layers: Record<string, ProviderMetrics>;
  syntaxTypes: Record<string, ProviderMetrics>;
  updatedAt: number;
}

export function recordProviderShown(candidate: CompletionCandidate, latencyMs: number): void {
  updateMetrics(candidate.providerId, candidate.sourceLayer, candidate.syntaxType, (metrics) => {
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
  syntaxType: string | undefined,
  savedChars: number,
): void {
  if (!providerId) return;
  updateMetrics(providerId, sourceLayer, syntaxType, (metrics) => {
    metrics.accepted++;
    metrics.savedChars += Math.max(0, savedChars);
  });
}

export function recordProviderRejected(
  providerId: string | null,
  sourceLayer?: CompletionSourceLayer,
  syntaxType?: string,
): void {
  if (!providerId) return;
  updateMetrics(providerId, sourceLayer, syntaxType, (metrics) => {
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
  syntaxType: string | undefined,
  updater: (metrics: ProviderMetrics) => void,
): void {
  try {
    const store = loadMetrics();
    updater((store.providers[providerId] ??= createProviderMetrics()));
    updater(
      (store.layers[getLayerMetricsKey(providerId, sourceLayer)] ??= createProviderMetrics()),
    );
    updater(
      (store.syntaxTypes[getSyntaxMetricsKey(providerId, sourceLayer, syntaxType)] ??=
        createProviderMetrics()),
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
  const parsed = JSON.parse(raw) as {
    version?: number;
    providers?: MetricsStore['providers'];
    layers?: MetricsStore['layers'];
    syntaxTypes?: MetricsStore['syntaxTypes'];
    updatedAt?: number;
  };
  if ((parsed.version !== 2 && parsed.version !== 3) || !parsed.providers) {
    return createMetricsStore();
  }
  return {
    version: 3,
    providers: parsed.providers,
    layers: parsed.layers ?? {},
    syntaxTypes: parsed.syntaxTypes ?? {},
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
      version: 3,
      providers: parsed.providers,
      layers: {},
      syntaxTypes: {},
      updatedAt: parsed.updatedAt ?? 0,
    };
  } catch {
    return createMetricsStore();
  }
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
