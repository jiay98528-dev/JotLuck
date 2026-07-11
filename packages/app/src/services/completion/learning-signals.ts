import type { CompletionCandidate, CompletionContext } from './types';
import {
  normalizeCompletionScope,
  parseJsonSafely,
  readStorage,
  removeStorage,
  runCompletionStorageMutation,
  scopedCompletionStorageKey,
  writeStorage,
} from './learning-repository';

/** @deprecated v1 global key, read once for migration only. */
export const LEARNING_SIGNALS_STORAGE_KEY = 'jotluck:autocomplete:learningSignals:v1';

const MAX_SIGNAL_ENTRIES = 800;

export interface LearningSignalEntry {
  shown: number;
  accepted: number;
  rejected: number;
  savedChars: number;
  lastShown: number;
  lastAccepted: number;
  lastRejected: number;
}

export interface LearningSignalStore {
  version: 2;
  entries: Record<string, LearningSignalEntry>;
  updatedAt: number;
}

export function learningSignalsStorageKey(scope = 'unscoped'): string {
  return scopedCompletionStorageKey(scope, 'learning-signals:v2');
}

export function loadLearningSignals(scope = 'unscoped'): LearningSignalStore {
  const targetKey = learningSignalsStorageKey(scope);
  const current = normalizeStore(parseJsonSafely(readStorage(targetKey)), false);
  if (current) return pruneLearningSignals(current);
  if (readStorage(targetKey) !== null) removeStorage(targetKey);

  const normalizedScope = normalizeCompletionScope(scope);
  const legacyKeys = [
    scopedCompletionStorageKey(normalizedScope, 'learning-signals:v1'),
    LEARNING_SIGNALS_STORAGE_KEY,
  ];
  for (const legacyKey of legacyKeys) {
    const migrated = normalizeStore(parseJsonSafely(readStorage(legacyKey)), true);
    if (!migrated) continue;
    saveLearningSignals(migrated, normalizedScope);
    removeStorage(...legacyKeys);
    return pruneLearningSignals(migrated);
  }
  return createLearningSignalStore();
}

export function saveLearningSignals(store: LearningSignalStore, scope = 'unscoped'): void {
  writeStorage(learningSignalsStorageKey(scope), JSON.stringify(pruneLearningSignals(store)));
}

export function persistLearningSignalEvent(
  scope: string,
  key: string,
  event: 'shown' | 'accepted' | 'rejected',
  savedChars = 0,
): void {
  const normalizedScope = normalizeCompletionScope(scope);
  runCompletionStorageMutation(`signals:${normalizedScope}`, () => {
    let latest = loadLearningSignals(normalizedScope);
    latest =
      event === 'shown'
        ? recordSignalShown(latest, key)
        : event === 'accepted'
          ? recordSignalAccepted(latest, key, savedChars)
          : recordSignalRejected(latest, key);
    saveLearningSignals(latest, normalizedScope);
  });
}

export function clearLearningSignals(scope = 'unscoped'): void {
  const normalizedScope = normalizeCompletionScope(scope);
  runCompletionStorageMutation(`signals:${normalizedScope}`, () => {
    removeStorage(
      learningSignalsStorageKey(normalizedScope),
      scopedCompletionStorageKey(normalizedScope, 'learning-signals:v1'),
      ...(normalizedScope === 'unscoped' ? [LEARNING_SIGNALS_STORAGE_KEY] : []),
    );
  });
}

export function createLearningSignalStore(): LearningSignalStore {
  return {
    version: 2,
    entries: {},
    updatedAt: 0,
  };
}

export function getLearningSignalKey(
  candidate: CompletionCandidate,
  context: CompletionContext,
): string {
  const contextSignature = hashString(
    [
      context.languageHint,
      context.blockType,
      context.syntax.type,
      normalizeContextText(context.sentencePrefix || context.line?.beforeCursor || ''),
      context.recentTokens.slice(-3).join('|'),
    ].join('|'),
  );
  const suggestionSignature = hashString(normalizeSuggestion(candidate.text));
  return [
    candidate.syntaxType,
    context.blockType,
    context.languageHint,
    contextSignature,
    suggestionSignature,
  ].join('|');
}

export function recordSignalShown(store: LearningSignalStore, key: string): LearningSignalStore {
  return updateSignal(store, key, (entry, now) => {
    entry.shown++;
    entry.lastShown = now;
  });
}

export function recordSignalAccepted(
  store: LearningSignalStore,
  key: string,
  savedChars: number,
): LearningSignalStore {
  return updateSignal(store, key, (entry, now) => {
    entry.accepted++;
    entry.savedChars += Math.max(0, savedChars);
    entry.lastAccepted = now;
  });
}

export function recordSignalRejected(store: LearningSignalStore, key: string): LearningSignalStore {
  return updateSignal(store, key, (entry, now) => {
    entry.rejected++;
    entry.lastRejected = now;
  });
}

export function getLearningSignalAdjustment(
  store: LearningSignalStore,
  key: string,
  candidate: CompletionCandidate,
): number {
  const entry = store.entries[key];
  if (!entry || entry.shown < 2) return 0;

  const accepted = entry.accepted;
  const rejected = entry.rejected;
  const shown = Math.max(1, entry.shown);
  const acceptRate = accepted / shown;
  const rejectRate = rejected / shown;
  const weakSource = isWeakSource(candidate);

  if (rejected >= 2 && accepted === 0) return weakSource ? -0.22 : -0.16;
  if (weakSource && shown >= 5 && acceptRate < 0.15) return -0.12;
  if (weakSource && rejectRate >= 0.4) return -0.1;
  if (!weakSource && accepted >= 2 && acceptRate >= 0.5) return 0.08;
  if ((candidate.sourceLayer === 'l2' || candidate.sourceLayer === 'short-l2') && accepted > 0) {
    return 0.05;
  }
  return 0;
}

export function isWeakLearningSource(candidate: CompletionCandidate): boolean {
  return isWeakSource(candidate);
}

function updateSignal(
  store: LearningSignalStore,
  key: string,
  updater: (entry: LearningSignalEntry, now: number) => void,
): LearningSignalStore {
  const now = Date.now();
  const next: LearningSignalStore = {
    version: 2,
    entries: { ...store.entries },
    updatedAt: now,
  };
  const entry = next.entries[key] ?? createEntry();
  updater(entry, now);
  next.entries[key] = entry;
  return pruneLearningSignals(next);
}

function pruneLearningSignals(store: LearningSignalStore): LearningSignalStore {
  const entries = Object.entries(store.entries);
  if (entries.length <= MAX_SIGNAL_ENTRIES) return store;

  const sorted = entries.sort(([, a], [, b]) => getEntryScore(b) - getEntryScore(a));
  return {
    ...store,
    entries: Object.fromEntries(sorted.slice(0, MAX_SIGNAL_ENTRIES)),
  };
}

function getEntryScore(entry: LearningSignalEntry): number {
  const recent = Math.max(entry.lastShown, entry.lastAccepted, entry.lastRejected);
  return entry.accepted * 8 + entry.rejected * 2 + entry.shown + recent / 1_000_000_000_000;
}

function createEntry(): LearningSignalEntry {
  return {
    shown: 0,
    accepted: 0,
    rejected: 0,
    savedChars: 0,
    lastShown: 0,
    lastAccepted: 0,
    lastRejected: 0,
  };
}

function normalizeEntries(
  entries: Record<string, LearningSignalEntry>,
): Record<string, LearningSignalEntry> {
  const normalized: Record<string, LearningSignalEntry> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (!key || key.length > 256 || !value || typeof value !== 'object') continue;
    normalized[key] = {
      shown: normalizeCount(value.shown),
      accepted: normalizeCount(value.accepted),
      rejected: normalizeCount(value.rejected),
      savedChars: normalizeCount(value.savedChars),
      lastShown: normalizeCount(value.lastShown),
      lastAccepted: normalizeCount(value.lastAccepted),
      lastRejected: normalizeCount(value.lastRejected),
    };
  }
  return normalized;
}

function normalizeCount(value: unknown): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function normalizeStore(value: unknown, allowLegacy: boolean): LearningSignalStore | null {
  if (!value || typeof value !== 'object') return null;
  const parsed = value as Partial<LearningSignalStore> & { version?: number };
  if (parsed.version !== 2 && !(allowLegacy && parsed.version === 1)) return null;
  if (!parsed.entries || typeof parsed.entries !== 'object' || Array.isArray(parsed.entries)) {
    return null;
  }
  return {
    version: 2,
    entries: normalizeEntries(parsed.entries as Record<string, LearningSignalEntry>),
    updatedAt: normalizeCount(parsed.updatedAt),
  };
}

function isWeakSource(candidate: CompletionCandidate): boolean {
  return (
    candidate.sourceLayer === 'fallback' ||
    candidate.sourceLayer === 'l3' ||
    candidate.providerId === 'short-chinese-fallback' ||
    candidate.providerId === 'short-english'
  );
}

function normalizeContextText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').slice(-40).toLowerCase();
}

function normalizeSuggestion(text: string): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, 40).toLowerCase();
}

function hashString(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
