import type { CompletionCandidate, CompletionContext } from './types';
import {
  enqueueCompletionIdleWrite,
  normalizeCompletionScope,
  parseJsonSafely,
  readStorage,
  removeStorage,
  resetCompletionIdleWritesForTests,
  runCompletionStorageMutation,
  scopedCompletionStorageKey,
  writeStorage,
} from './learning-repository';

/** @deprecated v1 global key, read once for migration only. */
export const LEARNING_SIGNALS_STORAGE_KEY = 'jotluck:autocomplete:learningSignals:v1';

const MAX_SIGNAL_ENTRIES = 800;

/**
 * 空闲批量层：事件先累积在内存，落盘推迟到空闲时点。键为规范化 scope，
 * 读侧（loadLearningSignals）优先返回未落盘的内存态，语义保持一致。
 */
const pendingSignalStores = new Map<string, LearningSignalStore>();

export interface LearningSignalEntry {
  shown: number;
  accepted: number;
  retained: number;
  modified: number;
  reverted: number;
  explicitRejected: number;
  abandoned: number;
  legacyAccepted: number;
  rejected: number;
  savedChars: number;
  lastShown: number;
  lastAccepted: number;
  lastRetained: number;
  lastRejected: number;
}

export interface LearningSignalStore {
  version: 3;
  entries: Record<string, LearningSignalEntry>;
  updatedAt: number;
}

export function learningSignalsStorageKey(scope = 'unscoped'): string {
  return scopedCompletionStorageKey(scope, 'learning-signals:v3');
}

export function loadLearningSignals(scope = 'unscoped'): LearningSignalStore {
  // 读侧优先返回未落盘的内存累积态，避免批量窗口内读到过期计数。
  const pending = pendingSignalStores.get(normalizeCompletionScope(scope));
  if (pending) return cloneLearningSignalStore(pending);
  const targetKey = learningSignalsStorageKey(scope);
  const current = normalizeStore(parseJsonSafely(readStorage(targetKey)), false);
  if (current) return pruneLearningSignals(current);
  if (readStorage(targetKey) !== null) removeStorage(targetKey);

  const normalizedScope = normalizeCompletionScope(scope);
  const legacyKeys = [
    scopedCompletionStorageKey(normalizedScope, 'learning-signals:v2'),
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

/** 测试隔离专用：清空未落盘累积态与挂起的空闲任务。生产代码禁止调用。 */
export function resetLearningSignalsForTests(): void {
  pendingSignalStores.clear();
  resetCompletionIdleWritesForTests();
}

export function persistLearningSignalEvent(
  scope: string,
  key: string,
  event:
    | 'shown'
    | 'accepted'
    | 'retained'
    | 'modified'
    | 'reverted'
    | 'explicitRejected'
    | 'abandoned',
  savedChars = 0,
): void {
  const normalizedScope = normalizeCompletionScope(scope);
  // 内存累积替代每键全量读改写；多次事件合并为一次空闲落盘。
  const latest = recordSignalEvent(
    pendingSignalStores.get(normalizedScope) ?? loadLearningSignals(normalizedScope),
    key,
    event,
    savedChars,
  );
  pendingSignalStores.set(normalizedScope, latest);
  enqueueCompletionIdleWrite(`signals:${normalizedScope}`, () => {
    runCompletionStorageMutation(`signals:${normalizedScope}`, () => {
      // 清除操作可能已丢弃累积态；任务运行时再次确认，避免复活已清数据。
      const pending = pendingSignalStores.get(normalizedScope);
      if (!pending) return;
      pendingSignalStores.delete(normalizedScope);
      saveLearningSignals(pending, normalizedScope);
    });
  });
}

export function clearLearningSignals(scope = 'unscoped'): void {
  const normalizedScope = normalizeCompletionScope(scope);
  runCompletionStorageMutation(`signals:${normalizedScope}`, () => {
    // 丢弃未落盘的累积态，防止空闲任务在清除后把旧数据写回。
    pendingSignalStores.delete(normalizedScope);
    removeStorage(
      learningSignalsStorageKey(normalizedScope),
      scopedCompletionStorageKey(normalizedScope, 'learning-signals:v2'),
      scopedCompletionStorageKey(normalizedScope, 'learning-signals:v1'),
      ...(normalizedScope === 'unscoped' ? [LEARNING_SIGNALS_STORAGE_KEY] : []),
    );
  });
}

export function createLearningSignalStore(): LearningSignalStore {
  return {
    version: 3,
    entries: {},
    updatedAt: 0,
  };
}

/** 读侧返回快照，避免调用方持有并意外改动内存累积态。 */
function cloneLearningSignalStore(store: LearningSignalStore): LearningSignalStore {
  const entries: Record<string, LearningSignalEntry> = {};
  for (const [key, value] of Object.entries(store.entries)) {
    entries[key] = { ...value };
  }
  return { version: store.version, entries, updatedAt: store.updatedAt };
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
    entry.lastAccepted = now;
    void savedChars;
  });
}

export function recordSignalRetained(
  store: LearningSignalStore,
  key: string,
  savedChars: number,
): LearningSignalStore {
  return updateSignal(store, key, (entry, now) => {
    entry.retained++;
    entry.savedChars += Math.max(0, savedChars);
    entry.lastRetained = now;
  });
}

export function recordSignalModified(store: LearningSignalStore, key: string): LearningSignalStore {
  return updateSignal(store, key, (entry) => entry.modified++);
}

export function recordSignalReverted(store: LearningSignalStore, key: string): LearningSignalStore {
  return updateSignal(store, key, (entry) => entry.reverted++);
}

export function recordSignalAbandoned(
  store: LearningSignalStore,
  key: string,
): LearningSignalStore {
  return updateSignal(store, key, (entry) => entry.abandoned++);
}

export function recordSignalRejected(store: LearningSignalStore, key: string): LearningSignalStore {
  return updateSignal(store, key, (entry, now) => {
    entry.rejected++;
    entry.explicitRejected++;
    entry.lastRejected = now;
  });
}

function recordSignalEvent(
  store: LearningSignalStore,
  key: string,
  event:
    | 'shown'
    | 'accepted'
    | 'retained'
    | 'modified'
    | 'reverted'
    | 'explicitRejected'
    | 'abandoned',
  savedChars: number,
): LearningSignalStore {
  switch (event) {
    case 'shown':
      return recordSignalShown(store, key);
    case 'accepted':
      return recordSignalAccepted(store, key, savedChars);
    case 'retained':
      return recordSignalRetained(store, key, savedChars);
    case 'modified':
      return recordSignalModified(store, key);
    case 'reverted':
      return recordSignalReverted(store, key);
    case 'explicitRejected':
      return recordSignalRejected(store, key);
    case 'abandoned':
      return recordSignalAbandoned(store, key);
  }
}

export function getLearningSignalAdjustment(
  store: LearningSignalStore,
  key: string,
  candidate: CompletionCandidate,
): number {
  const entry = store.entries[key];
  if (!entry || entry.shown < 2) return 0;

  const accepted = entry.retained + entry.legacyAccepted * 0.5;
  const rejected = entry.explicitRejected;
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
    version: 3,
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
  const recent = Math.max(
    entry.lastShown,
    entry.lastAccepted,
    entry.lastRetained,
    entry.lastRejected,
  );
  return (
    entry.retained * 8 +
    entry.legacyAccepted * 4 +
    entry.explicitRejected * 2 +
    entry.shown +
    recent / 1_000_000_000_000
  );
}

function createEntry(): LearningSignalEntry {
  return {
    shown: 0,
    accepted: 0,
    retained: 0,
    modified: 0,
    reverted: 0,
    explicitRejected: 0,
    abandoned: 0,
    legacyAccepted: 0,
    rejected: 0,
    savedChars: 0,
    lastShown: 0,
    lastAccepted: 0,
    lastRetained: 0,
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
      retained: normalizeCount(value.retained),
      modified: normalizeCount(value.modified),
      reverted: normalizeCount(value.reverted),
      explicitRejected: normalizeCount(value.explicitRejected ?? value.rejected),
      abandoned: normalizeCount(value.abandoned),
      legacyAccepted: normalizeCount(value.legacyAccepted),
      rejected: normalizeCount(value.rejected),
      savedChars: normalizeCount(value.savedChars),
      lastShown: normalizeCount(value.lastShown),
      lastAccepted: normalizeCount(value.lastAccepted),
      lastRetained: normalizeCount(value.lastRetained),
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
  const parsed = value as {
    version?: number;
    entries?: unknown;
    updatedAt?: unknown;
  };
  if (parsed.version !== 3 && !(allowLegacy && (parsed.version === 1 || parsed.version === 2))) {
    return null;
  }
  if (!parsed.entries || typeof parsed.entries !== 'object' || Array.isArray(parsed.entries)) {
    return null;
  }
  const entries = normalizeEntries(parsed.entries as Record<string, LearningSignalEntry>);
  if (parsed.version === 1 || parsed.version === 2) {
    for (const entry of Object.values(entries)) entry.legacyAccepted = entry.accepted;
  }
  return {
    version: 3,
    entries,
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
