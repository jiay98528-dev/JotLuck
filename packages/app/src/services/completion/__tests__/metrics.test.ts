import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCompletionMetrics,
  completionMetricsStorageKey,
  loadCompletionMetrics,
  recordProviderAccepted,
  recordProviderRejected,
  recordProviderShown,
} from '../metrics';
import type { CompletionCandidate } from '../types';

function setupLocalStorageMock() {
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
  });
  return store;
}

function candidate(): CompletionCandidate {
  return {
    text: 'owner review',
    confidence: 0.8,
    from: 0,
    providerId: 'ngram',
    source: 'ngram',
    sourceLayer: 'l2',
    syntaxType: 'general',
    learnable: true,
    priority: 50,
  };
}

describe('completion metrics', () => {
  beforeEach(() => {
    setupLocalStorageMock();
  });

  it('falls back to an empty store and removes malformed JSON', () => {
    localStorage.setItem(completionMetricsStorageKey('a'), '{bad json');

    expect(loadCompletionMetrics('a')).toMatchObject({ version: 3, providers: {} });
    expect(localStorage.getItem(completionMetricsStorageKey('a'))).toBeNull();
  });

  it('records provider, layer and syntax metrics in one scope only', () => {
    recordProviderShown(candidate(), 12.4, 'a');
    recordProviderAccepted('ngram', 'l2', 'general', 8, 'a');
    recordProviderRejected('ngram', 'l2', 'general', 'a');

    const metrics = loadCompletionMetrics('a');
    expect(metrics.providers.ngram).toMatchObject({
      shown: 1,
      accepted: 1,
      rejected: 1,
      savedChars: 8,
      latencies: [12],
    });
    expect(metrics.layers['ngram:l2']).toMatchObject({ shown: 1, accepted: 1, rejected: 1 });
    expect(metrics.syntaxTypes['ngram:l2:general']).toMatchObject({
      shown: 1,
      accepted: 1,
      rejected: 1,
    });
    expect(loadCompletionMetrics('b').providers).toEqual({});
  });

  it('migrates v2 global metrics and normalizes invalid values', () => {
    localStorage.setItem(
      'jotluck:autocomplete:providerMetrics:v2',
      JSON.stringify({
        version: 2,
        providers: {
          ngram: {
            shown: 2,
            accepted: 1.2,
            rejected: -1,
            savedChars: 5,
            latencies: [1, -1, 2.6, 'bad'],
          },
        },
        layers: {},
        syntaxTypes: {},
        updatedAt: 10,
      }),
    );

    const migrated = loadCompletionMetrics('notebook-a');
    expect(migrated.version).toBe(3);
    expect(migrated.providers.ngram).toMatchObject({
      shown: 2,
      accepted: 0,
      rejected: 0,
      savedChars: 5,
      latencies: [1, 3],
    });
    expect(localStorage.getItem(completionMetricsStorageKey('notebook-a'))).not.toBeNull();
    expect(localStorage.getItem('jotluck:autocomplete:providerMetrics:v2')).toBeNull();
  });

  it('clears only the selected notebook scope', () => {
    recordProviderShown(candidate(), 5, 'a');
    recordProviderShown(candidate(), 6, 'b');

    clearCompletionMetrics('a');

    expect(localStorage.getItem(completionMetricsStorageKey('a'))).toBeNull();
    expect(localStorage.getItem(completionMetricsStorageKey('b'))).not.toBeNull();
  });
});
