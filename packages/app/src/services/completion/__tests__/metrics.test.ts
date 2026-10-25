import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCompletionMetrics,
  completionMetricsStorageKey,
  loadCompletionMetrics,
  recordProviderAccepted,
  recordProviderRejected,
  recordProviderRetained,
  recordProviderShown,
} from '../metrics';
import { flushCompletionStorageMutationsForTests } from '../learning-repository';
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

    expect(loadCompletionMetrics('a')).toMatchObject({ version: 4, providers: {} });
    expect(localStorage.getItem(completionMetricsStorageKey('a'))).toBeNull();
  });

  it('records provider, layer and syntax metrics in one scope only', async () => {
    recordProviderShown(candidate(), 12.4, 'a');
    recordProviderAccepted('ngram', 'l2', 'general', 8, 'a');
    recordProviderRetained('ngram', 'l2', 'general', 8, 'a');
    recordProviderRejected('ngram', 'l2', 'general', 'a');

    const metrics = loadCompletionMetrics('a');
    expect(metrics.providers.ngram).toMatchObject({
      shown: 1,
      accepted: 1,
      retained: 1,
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
    // 排空空闲批量，避免累积态泄漏到后续用例。
    await flushCompletionStorageMutationsForTests();
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
    expect(migrated.version).toBe(4);
    expect(migrated.providers.ngram).toMatchObject({
      shown: 2,
      accepted: 0,
      legacyAccepted: 0,
      rejected: 0,
      savedChars: 5,
      latencies: [1, 3],
    });
    expect(localStorage.getItem(completionMetricsStorageKey('notebook-a'))).not.toBeNull();
    expect(localStorage.getItem('jotluck:autocomplete:providerMetrics:v2')).toBeNull();
  });

  it('clears only the selected notebook scope', async () => {
    recordProviderShown(candidate(), 5, 'a');
    recordProviderShown(candidate(), 6, 'b');
    // 先到达空闲落盘时点，再验证清除只影响目标 scope 的持久化键。
    await flushCompletionStorageMutationsForTests();

    clearCompletionMetrics('a');

    expect(localStorage.getItem(completionMetricsStorageKey('a'))).toBeNull();
    expect(localStorage.getItem(completionMetricsStorageKey('b'))).not.toBeNull();
  });

  it('merges repeated metric records into a single storage write at the idle flush point', async () => {
    recordProviderShown(candidate(), 5, 'batch');
    recordProviderShown(candidate(), 6, 'batch');
    recordProviderAccepted('ngram', 'l2', 'general', 4, 'batch');

    // 批量窗口内：读侧已可见最新计数，但目标键尚未产生任何落盘写。
    expect(loadCompletionMetrics('batch').providers.ngram).toMatchObject({
      shown: 2,
      accepted: 1,
    });
    const targetWrites = () =>
      vi
        .mocked(localStorage.setItem)
        .mock.calls.filter(([key]) => key === completionMetricsStorageKey('batch'));
    expect(targetWrites()).toHaveLength(0);

    await flushCompletionStorageMutationsForTests();

    // 三次记录合并为单次写，且内容包含全部累积计数。
    expect(targetWrites()).toHaveLength(1);
    const persisted = JSON.parse(
      localStorage.getItem(completionMetricsStorageKey('batch')) as string,
    ) as {
      providers: Record<string, { shown: number; accepted: number; latencies: number[] }>;
    };
    expect(persisted.providers.ngram).toMatchObject({
      shown: 2,
      accepted: 1,
      latencies: [5, 6],
    });
  });

  it('drops unflushed metrics instead of resurrecting them after a clear', async () => {
    recordProviderShown(candidate(), 5, 'resurrect');
    clearCompletionMetrics('resurrect');
    await flushCompletionStorageMutationsForTests();

    expect(localStorage.getItem(completionMetricsStorageKey('resurrect'))).toBeNull();
    expect(loadCompletionMetrics('resurrect').providers).toEqual({});
  });
});
