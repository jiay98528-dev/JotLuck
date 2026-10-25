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
const idleWriteTasks = new Map<string, () => void>();
let idleWriteCancel: (() => void) | null = null;
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
  // 空闲批量任务可能尚未进入 mutation 队列；先同步落盘再等待全部队列，
  // 保证 await 之后信号/指标等状态确实已写入 localStorage。
  flushCompletionIdleWrites();
  await Promise.all([...mutationQueues.values()]);
}

export const flushCompletionStorageMutationsForTests = flushCompletionStorageMutations;

/**
 * 每键全量读改写（约 230KB/键 × 800 条稳态）不适合逐事件执行：学习信号与
 * 指标先在内存累积，登记空闲批量落盘任务；同资源重复登记只保留最新任务。
 */
export function enqueueCompletionIdleWrite(resource: string, task: () => void): void {
  idleWriteTasks.set(resource, task);
  if (idleWriteCancel) return;
  idleWriteCancel = scheduleCompletionIdleCallback(() => {
    idleWriteCancel = null;
    runCompletionIdleWrites();
  });
}

export function flushCompletionIdleWrites(): void {
  if (idleWriteCancel) {
    idleWriteCancel();
    idleWriteCancel = null;
  }
  runCompletionIdleWrites();
}

export function hasPendingCompletionIdleWrites(): boolean {
  return idleWriteTasks.size > 0;
}

/** 指定资源（如 `signals:<scope>`）是否还有未落盘的空闲批量任务。 */
export function hasPendingCompletionIdleWrite(resource: string): boolean {
  return idleWriteTasks.has(resource);
}

/**
 * 测试隔离专用：丢弃全部挂起的空闲批量任务（含未落盘累积态所属模块的
 * 各自 reset 一并调用）。生产代码禁止调用。
 */
export function resetCompletionIdleWritesForTests(): void {
  if (idleWriteCancel) {
    idleWriteCancel();
    idleWriteCancel = null;
  }
  idleWriteTasks.clear();
}

function runCompletionIdleWrites(): void {
  if (idleWriteTasks.size === 0) return;
  const tasks = [...idleWriteTasks.values()];
  idleWriteTasks.clear();
  for (const task of tasks) task();
}

function scheduleCompletionIdleCallback(callback: () => void): () => void {
  const requestIdle =
    typeof window === 'undefined' ? undefined : window.requestIdleCallback?.bind(window);
  if (requestIdle) {
    const handle = requestIdle(() => callback(), { timeout: 2_000 });
    const cancelIdle =
      typeof window === 'undefined' ? undefined : window.cancelIdleCallback?.bind(window);
    return () => cancelIdle?.(handle);
  }
  const timer = setTimeout(() => callback(), 500);
  return () => clearTimeout(timer);
}

export function parseJsonSafely(value: string | null): unknown | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function ensureStorageObservers(): void {
  if (observersReady || typeof window === 'undefined') return;
  observersReady = true;
  window.addEventListener('storage', (event) => {
    if (event.key) bumpStorageRevision(event.key);
  });
  // 页面隐藏或退出前必须把空闲批量累积的学习状态落盘，避免丢最后一批信号。
  window.addEventListener('pagehide', () => flushCompletionIdleWrites());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushCompletionIdleWrites();
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
