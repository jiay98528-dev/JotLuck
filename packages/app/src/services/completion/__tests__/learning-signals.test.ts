import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearLearningSignals,
  getLearningSignalAdjustment,
  getLearningSignalKey,
  LEARNING_SIGNALS_STORAGE_KEY,
  learningSignalsStorageKey,
  loadLearningSignals,
  recordSignalAccepted,
  recordSignalRejected,
  recordSignalShown,
  saveLearningSignals,
} from '../learning-signals';
import type { CompletionCandidate, CompletionContext } from '../types';

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
    clear: vi.fn(() => {
      Object.keys(store).forEach((key) => delete store[key]);
    }),
  });
  return store;
}

function candidate(overrides: Partial<CompletionCandidate> = {}): CompletionCandidate {
  return {
    text: 'owner review',
    confidence: 0.7,
    from: 0,
    providerId: 'ngram',
    source: 'ngram',
    sourceLayer: 'l2',
    syntaxType: 'general',
    learnable: true,
    priority: 50,
    ...overrides,
  };
}

function context(overrides: Partial<CompletionContext> = {}): CompletionContext {
  return {
    doc: 'Release risk is',
    cursorPos: 'Release risk is'.length,
    line: {
      text: 'Release risk is',
      from: 0,
      to: 'Release risk is'.length,
      cursorColumn: 'Release risk is'.length,
      beforeCursor: 'Release risk is',
    },
    syntax: { type: 'general', prefix: '' },
    settings: {
      enabled: true,
      aggressiveness: 'balanced',
      backgroundTraining: true,
      minConfidence: 0.15,
      maxSuggestionLength: 20,
      showDebugStats: false,
    },
    indexData: null,
    n: 4,
    disabled: false,
    emptyLine: false,
    atEndOfLine: true,
    languageHint: 'en',
    blockType: 'paragraph',
    paragraphBeforeCursor: 'Release risk is',
    paragraphStart: 0,
    sentencePrefix: 'Release risk is',
    recentTokens: ['Release', 'risk'],
    ...overrides,
  };
}

describe('learning signals', () => {
  beforeEach(() => {
    setupLocalStorageMock();
  });

  it('loads an empty store when localStorage is missing or corrupted', () => {
    expect(loadLearningSignals().entries).toEqual({});
    localStorage.setItem(learningSignalsStorageKey(), '{bad json');
    expect(loadLearningSignals().entries).toEqual({});
    expect(localStorage.getItem(learningSignalsStorageKey())).toBeNull();
  });

  it('records shown, accepted and rejected counts under a stable context key', () => {
    const key = getLearningSignalKey(candidate(), context());
    let store = loadLearningSignals();
    store = recordSignalShown(store, key);
    store = recordSignalAccepted(store, key, 6);
    store = recordSignalRejected(store, key);
    saveLearningSignals(store);

    const loaded = loadLearningSignals();
    expect(loaded.entries[key]).toMatchObject({
      shown: 1,
      accepted: 1,
      rejected: 1,
      savedChars: 6,
    });
  });

  it('boosts accepted strong sources and penalizes repeatedly rejected weak sources', () => {
    const strong = candidate({ sourceLayer: 'l2' });
    const weak = candidate({
      text: 'configuration drift',
      providerId: 'short-english',
      sourceLayer: 'fallback',
    });
    const strongKey = getLearningSignalKey(strong, context());
    const weakKey = getLearningSignalKey(weak, context());
    let store = loadLearningSignals();

    store = recordSignalShown(store, strongKey);
    store = recordSignalShown(store, strongKey);
    store = recordSignalAccepted(store, strongKey, 12);
    store = recordSignalAccepted(store, strongKey, 10);

    store = recordSignalShown(store, weakKey);
    store = recordSignalShown(store, weakKey);
    store = recordSignalRejected(store, weakKey);
    store = recordSignalRejected(store, weakKey);

    expect(getLearningSignalAdjustment(store, strongKey, strong)).toBeGreaterThan(0);
    expect(getLearningSignalAdjustment(store, weakKey, weak)).toBeLessThan(0);
  });

  it('shares suggestion feedback across provider attribution', () => {
    const first = getLearningSignalKey(candidate({ providerId: 'phrase-slot' }), context());
    const second = getLearningSignalKey(
      candidate({ providerId: 'ngram', sourceLayer: 'l3' }),
      context(),
    );
    expect(first).toBe(second);
  });

  it('clears persisted learning signals', () => {
    localStorage.setItem(learningSignalsStorageKey(), JSON.stringify(loadLearningSignals()));
    clearLearningSignals();
    expect(localStorage.getItem(learningSignalsStorageKey())).toBeNull();
  });

  it('isolates learning signals by notebook scope', () => {
    const key = getLearningSignalKey(candidate(), context());
    const notebookA = recordSignalAccepted(
      recordSignalShown(loadLearningSignals('a'), key),
      key,
      8,
    );
    saveLearningSignals(notebookA, 'a');

    expect(loadLearningSignals('a').entries[key]?.accepted).toBe(1);
    expect(loadLearningSignals('b').entries[key]).toBeUndefined();
    expect(localStorage.getItem(learningSignalsStorageKey('a'))).not.toBeNull();
    expect(localStorage.getItem(learningSignalsStorageKey('b'))).toBeNull();
  });

  it('migrates the legal v1 store once and drops malformed counts', () => {
    localStorage.setItem(
      LEARNING_SIGNALS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        entries: {
          valid: {
            shown: 3,
            accepted: 1,
            rejected: -2,
            savedChars: 4.5,
            lastShown: 10,
            lastAccepted: 11,
            lastRejected: 0,
          },
        },
        updatedAt: 12,
      }),
    );

    const migrated = loadLearningSignals('notebook-a');
    expect(migrated.version).toBe(2);
    expect(migrated.entries.valid).toMatchObject({
      shown: 3,
      accepted: 1,
      rejected: 0,
      savedChars: 0,
    });
    expect(localStorage.getItem(LEARNING_SIGNALS_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(learningSignalsStorageKey('notebook-a'))).not.toBeNull();
  });
});
