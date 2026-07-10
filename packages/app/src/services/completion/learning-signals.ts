import type { CompletionCandidate, CompletionContext } from './types';

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
  version: 1;
  entries: Record<string, LearningSignalEntry>;
  updatedAt: number;
}

export function loadLearningSignals(): LearningSignalStore {
  try {
    const raw = localStorage.getItem(LEARNING_SIGNALS_STORAGE_KEY);
    if (!raw) return createLearningSignalStore();
    const parsed = JSON.parse(raw) as Partial<LearningSignalStore>;
    if (parsed.version !== 1 || !parsed.entries || typeof parsed.entries !== 'object') {
      return createLearningSignalStore();
    }
    return {
      version: 1,
      entries: normalizeEntries(parsed.entries),
      updatedAt: Number.isFinite(parsed.updatedAt) ? Number(parsed.updatedAt) : 0,
    };
  } catch {
    return createLearningSignalStore();
  }
}

export function saveLearningSignals(store: LearningSignalStore): void {
  try {
    localStorage.setItem(LEARNING_SIGNALS_STORAGE_KEY, JSON.stringify(pruneLearningSignals(store)));
  } catch {
    // Learning signals are best-effort personalization data.
  }
}

export function clearLearningSignals(): void {
  try {
    localStorage.removeItem(LEARNING_SIGNALS_STORAGE_KEY);
  } catch {
    // Learning signals are best-effort personalization data.
  }
}

export function createLearningSignalStore(): LearningSignalStore {
  return {
    version: 1,
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
    candidate.providerId,
    candidate.sourceLayer ?? 'unknown',
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
    version: 1,
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
    if (!value || typeof value !== 'object') continue;
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
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
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
