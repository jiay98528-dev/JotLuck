import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearLearningSignals,
  getLearningSignalAdjustment,
  getLearningSignalKey,
  LEARNING_SIGNALS_STORAGE_KEY,
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
    localStorage.setItem(LEARNING_SIGNALS_STORAGE_KEY, '{bad json');
    expect(loadLearningSignals().entries).toEqual({});
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
    const weak = candidate({ providerId: 'short-english', sourceLayer: 'fallback' });
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

  it('clears persisted learning signals', () => {
    localStorage.setItem(LEARNING_SIGNALS_STORAGE_KEY, JSON.stringify(loadLearningSignals()));
    clearLearningSignals();
    expect(localStorage.getItem(LEARNING_SIGNALS_STORAGE_KEY)).toBeNull();
  });
});
