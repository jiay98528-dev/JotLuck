/**
 * Small, synchronous repository for notebook-scoped autocomplete state.
 * Model text never belongs here; this module is only for bounded personal
 * feedback, metrics and metadata stored in localStorage.
 */

interface CompletionStorageMessage {
  key: string;
}

interface NavigatorWithLocks {
  locks?: {
    request<T>(name: string, callback: () => T | Promise<T>): Promise<T>;
  };
}

const keyRevisions = new Map<string, number>();
const mutationQueues = new Map<string, Promise<void>>();
let observersReady = false;
let broadcastChannel: BroadcastChannel | null = null;

export function normalizeCompletionScope(scope: string): string {
  const normalized = scope
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-');
  return normalized || 'unscoped';
}

export function scopedCompletionStorageKey(scope: string, suffix: string): string {
  return `jotluck:scope:${normalizeCompletionScope(scope)}:autocomplete:${suffix}`;
}

export function readStorage(key: string): string | null {
  ensureStorageObservers();
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): boolean {
  ensureStorageObservers();
  try {
    localStorage.setItem(key, value);
    announceStorageChange(key);
    return true;
  } catch {
    return false;
  }
}

export function removeStorage(...keys: string[]): void {
  ensureStorageObservers();
  for (const key of keys) {
    try {
      localStorage.removeItem(key);
      announceStorageChange(key);
    } catch {
      // Personal learning is best-effort and must never block prediction.
    }
  }
}

/**
 * Serializes a read-modify-write operation per notebook resource. Web Locks
 * provides cross-tab exclusion; the promise queue preserves order within the
 * current tab. Browsers without Web Locks execute synchronously as a safe,
 * deterministic best-effort fallback.
 */
export function runCompletionStorageMutation(
  resource: string,
  mutation: () => void | Promise<void>,
): void {
  const locks =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as unknown as NavigatorWithLocks).locks;
  if (!locks?.request) {
    void mutation();
    return;
  }

  const previous = mutationQueues.get(resource) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => locks.request(`jotluck-autocomplete:${resource}`, mutation))
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      if (mutationQueues.get(resource) === next) mutationQueues.delete(resource);
    });
  mutationQueues.set(resource, next);
}

export function getStorageKeyRevision(key: string): number {
  ensureStorageObservers();
  return keyRevisions.get(key) ?? 0;
}

export function hasPendingCompletionStorageMutation(resource: string): boolean {
  return mutationQueues.has(resource);
}

export async function flushCompletionStorageMutations(): Promise<void> {
  await Promise.all([...mutationQueues.values()]);
}

export const flushCompletionStorageMutationsForTests = flushCompletionStorageMutations;

export function parseJsonSafely(value: string | null): unknown | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function migrateFirstValidLegacyValue(args: {
  targetKey: string;
  legacyKeys: readonly string[];
  isValid: (value: unknown) => boolean;
}): string | null {
  const current = readStorage(args.targetKey);
  if (current !== null) return current;

  for (const legacyKey of args.legacyKeys) {
    const raw = readStorage(legacyKey);
    if (raw === null || !args.isValid(parseJsonSafely(raw))) continue;
    if (writeStorage(args.targetKey, raw)) {
      removeStorage(...args.legacyKeys);
      return raw;
    }
  }
  return null;
}

function ensureStorageObservers(): void {
  if (observersReady || typeof window === 'undefined') return;
  observersReady = true;
  window.addEventListener('storage', (event) => {
    if (event.key) bumpStorageRevision(event.key);
  });
  const Channel = window.BroadcastChannel;
  if (!Channel) return;
  broadcastChannel = new Channel('jotluck-autocomplete-storage-v1');
  broadcastChannel.addEventListener('message', (event: MessageEvent<CompletionStorageMessage>) => {
    if (event.data?.key) bumpStorageRevision(event.data.key);
  });
}

function announceStorageChange(key: string): void {
  bumpStorageRevision(key);
  try {
    broadcastChannel?.postMessage({ key } satisfies CompletionStorageMessage);
  } catch {
    // Cross-tab refresh is best-effort; storage remains the source of truth.
  }
}

function bumpStorageRevision(key: string): void {
  keyRevisions.set(key, (keyRevisions.get(key) ?? 0) + 1);
}
