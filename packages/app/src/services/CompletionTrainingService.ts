import type { DirEntry, IFileSystemService } from '@/types';
import type { MarkdownPredictor } from './MarkdownPredictor';

export const TRAINING_META_KEY = 'jotluck:autocomplete:trainingMeta';
export const TRAINING_META_EVENT = 'jotluck:autocomplete:trainingMetaChanged';
export const TRAINING_META_VERSION = 2;
const MAX_TRAINING_FILE_SIZE = 512 * 1024;

export interface CompletionTrainingFileMeta {
  mtime: number;
  size: number;
}

export interface CompletionTrainingMeta {
  version: number;
  status: 'idle' | 'training' | 'done' | 'partial' | 'error';
  trainedPaths: Record<string, CompletionTrainingFileMeta>;
  fileCount: number;
  updatedAt: number;
  lastError?: string;
  successCount: number;
  failureCount: number;
  failedPaths: Record<string, string>;
  lastRunId?: string;
}

export const DEFAULT_TRAINING_META: CompletionTrainingMeta = {
  version: TRAINING_META_VERSION,
  status: 'idle',
  trainedPaths: {},
  fileCount: 0,
  updatedAt: 0,
  successCount: 0,
  failureCount: 0,
  failedPaths: {},
};

function normalizeTrainingScope(scope: string): string {
  const normalized = scope
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-');
  return normalized || 'unscoped';
}

export function trainingMetaKeyForScope(scope = 'unscoped'): string {
  return `jotluck:scope:${normalizeTrainingScope(scope)}:autocomplete:trainingMeta`;
}

function migrateLegacyTrainingMeta(scopedKey: string): void {
  if (localStorage.getItem(scopedKey) === null) {
    const legacy = localStorage.getItem(TRAINING_META_KEY);
    if (legacy !== null) localStorage.setItem(scopedKey, legacy);
  }
  localStorage.removeItem(TRAINING_META_KEY);
}

export function loadTrainingMeta(scope = 'unscoped'): CompletionTrainingMeta {
  const scopedKey = trainingMetaKeyForScope(scope);
  try {
    migrateLegacyTrainingMeta(scopedKey);
    const raw = localStorage.getItem(scopedKey);
    if (!raw) return createDefaultTrainingMeta();
    const parsed = parseTrainingMeta(raw);
    if (parsed) return parsed;
  } catch {
    // Corrupt or inaccessible storage must never block completion.
  }
  try {
    localStorage.removeItem(scopedKey);
  } catch {
    // Storage may be unavailable; the in-memory default is still safe.
  }
  return createDefaultTrainingMeta();
}

function createDefaultTrainingMeta(): CompletionTrainingMeta {
  return { ...DEFAULT_TRAINING_META, trainedPaths: {}, failedPaths: {} };
}

function parseTrainingMeta(raw: string): CompletionTrainingMeta | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed) || (parsed.version !== 1 && parsed.version !== TRAINING_META_VERSION)) {
    return null;
  }
  if (!isTrainingStatus(parsed.status)) return null;
  const trainedPaths = parseTrainedPaths(parsed.trainedPaths);
  if (!trainedPaths) return null;
  const failedPaths =
    parsed.version === 1 && parsed.failedPaths === undefined
      ? {}
      : parseFailedPaths(parsed.failedPaths);
  if (!failedPaths) return null;
  if (!isFiniteNonNegative(parsed.updatedAt)) return null;
  if (parsed.lastError !== undefined && typeof parsed.lastError !== 'string') return null;
  if (parsed.lastRunId !== undefined && typeof parsed.lastRunId !== 'string') return null;
  const successCount = parsed.version === 1 ? 0 : parseCount(parsed.successCount);
  const failureCount = parsed.version === 1 ? 0 : parseCount(parsed.failureCount);
  if (successCount === null || failureCount === null) return null;
  return {
    version: TRAINING_META_VERSION,
    status: parsed.status,
    trainedPaths,
    fileCount: Object.keys(trainedPaths).length,
    updatedAt: parsed.updatedAt,
    lastError: parsed.lastError,
    successCount,
    failureCount,
    failedPaths,
    lastRunId: parsed.lastRunId,
  };
}

function parseTrainedPaths(value: unknown): Record<string, CompletionTrainingFileMeta> | null {
  if (!isRecord(value)) return null;
  const entries: Array<[string, CompletionTrainingFileMeta]> = [];
  for (const [filePath, item] of Object.entries(value)) {
    if (
      !filePath ||
      !isRecord(item) ||
      !isFiniteNonNegative(item.mtime) ||
      !isFiniteNonNegative(item.size)
    ) {
      return null;
    }
    entries.push([filePath, { mtime: item.mtime, size: item.size }]);
  }
  return Object.fromEntries(entries);
}

function parseFailedPaths(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const entries: Array<[string, string]> = [];
  for (const [filePath, error] of Object.entries(value)) {
    if (!filePath || typeof error !== 'string') return null;
    entries.push([filePath, error]);
  }
  return Object.fromEntries(entries);
}

function parseCount(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTrainingStatus(value: unknown): value is CompletionTrainingMeta['status'] {
  return (
    typeof value === 'string' &&
    (['idle', 'training', 'done', 'partial', 'error'] as string[]).includes(value)
  );
}

export function saveTrainingMeta(meta: CompletionTrainingMeta, scope = 'unscoped'): void {
  const normalized = normalizeMeta(meta);
  const normalizedScope = normalizeTrainingScope(scope);
  localStorage.setItem(trainingMetaKeyForScope(normalizedScope), JSON.stringify(normalized));
  localStorage.removeItem(TRAINING_META_KEY);
  window.dispatchEvent(
    new CustomEvent(TRAINING_META_EVENT, { detail: { scope: normalizedScope, meta: normalized } }),
  );
}

export function subscribeTrainingMeta(
  listener: (meta: CompletionTrainingMeta) => void,
  getScope: () => string = () => 'unscoped',
): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ scope?: string; meta?: CompletionTrainingMeta }>).detail;
    const scope = normalizeTrainingScope(getScope());
    if (detail?.meta && normalizeTrainingScope(detail.scope ?? '') === scope) {
      listener(detail.meta);
      return;
    }
    listener(loadTrainingMeta(scope));
  };
  window.addEventListener(TRAINING_META_EVENT, handler);
  const storageHandler = (event: StorageEvent) => {
    const scope = normalizeTrainingScope(getScope());
    if (event.key === trainingMetaKeyForScope(scope)) listener(loadTrainingMeta(scope));
  };
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener(TRAINING_META_EVENT, handler);
    window.removeEventListener('storage', storageHandler);
  };
}

export class CompletionTrainingService {
  private running = false;
  private generation = 0;
  /** Current filesystem fact source, intentionally independent of persisted training meta. */
  private readonly currentFilePathsByScope = new Map<string, Set<string>>();

  constructor(
    private readonly fs: IFileSystemService,
    private readonly predictor: MarkdownPredictor,
  ) {
    this.predictor.setHybridRetrievalReplayProvider((scope, signal) =>
      this.readReplayDocuments(scope, signal),
    );
  }

  private get storageScope(): string {
    return this.predictor.getStorageScope();
  }

  async trainNotebook(entries: DirEntry[]): Promise<void> {
    this.captureCurrentFileFacts(this.storageScope, entries);
    // A newer filesystem snapshot supersedes an in-flight scan. Advancing the
    // generation makes every stale read/result a no-op while this call starts
    // the replacement run immediately.
    if (this.running) {
      this.generation++;
      this.running = false;
    }
    this.running = true;
    const generation = this.generation;
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let meta: CompletionTrainingMeta = {
      ...loadTrainingMeta(this.storageScope),
      status: 'training',
      lastError: undefined,
      successCount: 0,
      failureCount: 0,
      failedPaths: {},
      lastRunId: runId,
    };
    if (!this.isCurrentGeneration(generation)) return;
    saveTrainingMeta(meta, this.storageScope);

    try {
      await this.predictor.initialize();
      if (!this.isCurrentGeneration(generation)) return;
      const retainedPaths = entries
        .filter(
          (entry) =>
            entry.isFile &&
            this.isTrainablePath(entry.path) &&
            (entry.size === undefined || entry.size <= MAX_TRAINING_FILE_SIZE),
        )
        .map((entry) => entry.path);
      this.predictor.retainDocumentContributions(retainedPaths);
      const candidates = entries.filter((entry) => this.shouldTrainEntry(entry, meta));
      for (let i = 0; i < candidates.length; i += 4) {
        if (!this.isCurrentGeneration(generation)) return;
        const batch = candidates.slice(i, i + 4);
        const results = await Promise.all(
          batch.map((entry) => this.trainEntry(entry, meta, generation)),
        );
        if (!this.isCurrentGeneration(generation)) return;
        for (const result of results) {
          if (result.ok) {
            meta.successCount++;
          } else {
            meta.failureCount++;
            meta.failedPaths[result.path] = result.error;
          }
        }
        meta = normalizeMeta({ ...meta, status: 'training', updatedAt: Date.now() });
        saveTrainingMeta(meta, this.storageScope);
        await idleDelay();
      }
      if (!this.isCurrentGeneration(generation)) return;
      const status = meta.failureCount === 0 ? 'done' : meta.successCount > 0 ? 'partial' : 'error';
      saveTrainingMeta(
        normalizeMeta({
          ...meta,
          status,
          updatedAt: Date.now(),
          lastError:
            meta.failureCount > 0
              ? `${meta.failureCount} file(s) failed during autocomplete training`
              : undefined,
        }),
        this.storageScope,
      );
    } catch (error) {
      if (!this.isCurrentGeneration(generation)) return;
      saveTrainingMeta(
        normalizeMeta({
          ...meta,
          status: 'error',
          updatedAt: Date.now(),
          lastError: error instanceof Error ? error.message : String(error),
        }),
        this.storageScope,
      );
    } finally {
      if (this.isCurrentGeneration(generation)) this.running = false;
    }
  }

  cancelCurrentRun(): void {
    this.generation++;
    this.running = false;
  }

  async trainFile(path: string, content: string, stat?: CompletionTrainingFileMeta): Promise<void> {
    if (!this.isTrainablePath(path)) {
      this.removePath(path);
      return;
    }
    const actualSize = utf8ByteLength(content);
    const size = Math.max(stat?.size ?? 0, actualSize);
    if (size > MAX_TRAINING_FILE_SIZE) {
      this.removePath(path);
      return;
    }
    this.getCurrentFileFacts(this.storageScope).add(path);
    this.predictor.replaceDocumentContribution(path, stripUntrainableMarkdown(content));
    const meta = loadTrainingMeta(this.storageScope);
    meta.trainedPaths[path] = {
      mtime: stat?.mtime ?? Date.now(),
      size,
    };
    saveTrainingMeta(
      normalizeMeta({ ...meta, status: 'done', updatedAt: Date.now() }),
      this.storageScope,
    );
  }

  removePath(path: string): void {
    this.getCurrentFileFacts(this.storageScope).delete(path);
    this.predictor.removeDocumentContribution(path);
    const meta = loadTrainingMeta(this.storageScope);
    if (!(path in meta.trainedPaths)) return;
    delete meta.trainedPaths[path];
    saveTrainingMeta(
      normalizeMeta({ ...meta, status: 'done', updatedAt: Date.now() }),
      this.storageScope,
    );
  }

  renamePath(oldPath: string, newPath: string): void {
    const facts = this.getCurrentFileFacts(this.storageScope);
    facts.delete(oldPath);
    const newPathIsTrainable = this.isTrainablePath(newPath);
    if (newPathIsTrainable) {
      facts.add(newPath);
      this.predictor.renameDocumentContribution(oldPath, newPath);
    } else {
      this.predictor.removeDocumentContribution(oldPath);
    }
    const meta = loadTrainingMeta(this.storageScope);
    const previous = meta.trainedPaths[oldPath];
    if (!previous) return;
    delete meta.trainedPaths[oldPath];
    if (newPathIsTrainable) meta.trainedPaths[newPath] = previous;
    saveTrainingMeta(
      normalizeMeta({ ...meta, status: 'done', updatedAt: Date.now() }),
      this.storageScope,
    );
  }

  resetContributions(): void {
    this.cancelCurrentRun();
    this.currentFilePathsByScope.set(this.storageScope, new Set());
    this.predictor.resetNotebookContributions();
    saveTrainingMeta(createDefaultTrainingMeta(), this.storageScope);
  }

  private async trainEntry(
    entry: DirEntry,
    meta: CompletionTrainingMeta,
    generation: number,
  ): Promise<{ ok: true; path: string } | { ok: false; path: string; error: string }> {
    try {
      const content = await this.fs.readFile(entry.path);
      if (!this.isCurrentGeneration(generation)) return { ok: true, path: entry.path };
      const actualSize = utf8ByteLength(content);
      if (actualSize > MAX_TRAINING_FILE_SIZE) {
        this.predictor.removeDocumentContribution(entry.path);
        delete meta.trainedPaths[entry.path];
        return { ok: true, path: entry.path };
      }
      this.predictor.replaceDocumentContribution(entry.path, stripUntrainableMarkdown(content));
      meta.trainedPaths[entry.path] = {
        mtime: entry.mtime ?? Date.now(),
        size: Math.max(entry.size ?? 0, actualSize),
      };
      return { ok: true, path: entry.path };
    } catch (error) {
      return {
        ok: false,
        path: entry.path,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private isCurrentGeneration(generation: number): boolean {
    return generation === this.generation;
  }

  private shouldTrainEntry(entry: DirEntry, meta: CompletionTrainingMeta): boolean {
    if (!entry.isFile || !this.isTrainablePath(entry.path)) return false;
    if (entry.size !== undefined && entry.size > MAX_TRAINING_FILE_SIZE) return false;
    if (entry.size === undefined) return true;
    const prev = meta.trainedPaths[entry.path];
    if (!prev || !this.predictor.hasDocumentContribution(entry.path)) return true;
    return prev.mtime !== (entry.mtime ?? 0) || prev.size !== (entry.size ?? 0);
  }

  private isTrainablePath(path: string): boolean {
    const normalized = path.replace(/\\/g, '/').toLowerCase();
    if (normalized.includes('/assets/')) return false;
    return /\.(md|markdown|mdx|txt)$/.test(normalized);
  }

  private async readReplayDocuments(
    scope: string,
    signal: AbortSignal,
  ): Promise<Array<{ path: string; content: string }>> {
    const paths = [...(this.currentFilePathsByScope.get(normalizeTrainingScope(scope)) ?? [])].sort(
      (a, b) => a.localeCompare(b, 'en'),
    );
    const documents: Array<{ path: string; content: string }> = [];
    for (const path of paths) {
      if (
        signal.aborted ||
        normalizeTrainingScope(this.storageScope) !== normalizeTrainingScope(scope)
      ) {
        break;
      }
      if (!this.isTrainablePath(path)) continue;
      try {
        const content = await this.fs.readFile(path);
        if (signal.aborted) break;
        if (new TextEncoder().encode(content).byteLength > MAX_TRAINING_FILE_SIZE) continue;
        documents.push({ path, content: stripUntrainableMarkdown(content) });
      } catch {
        // A file may disappear between the saved training meta and recovery.
        // Replaying the remaining current files keeps recovery deterministic.
      }
    }
    return documents;
  }

  private captureCurrentFileFacts(scope: string, entries: readonly DirEntry[]): void {
    const paths = entries
      .filter(
        (entry) =>
          entry.isFile &&
          this.isTrainablePath(entry.path) &&
          (entry.size === undefined || entry.size <= MAX_TRAINING_FILE_SIZE),
      )
      .map((entry) => entry.path);
    this.currentFilePathsByScope.set(normalizeTrainingScope(scope), new Set(paths));
  }

  private getCurrentFileFacts(scope: string): Set<string> {
    const normalized = normalizeTrainingScope(scope);
    let facts = this.currentFilePathsByScope.get(normalized);
    if (!facts) {
      facts = new Set();
      this.currentFilePathsByScope.set(normalized, facts);
    }
    return facts;
  }
}

export function stripUntrainableMarkdown(content: string): string {
  const lines = content.replace(/\r\n?/gu, '\n').split('\n');
  let start = 0;
  if (/^---[ \t]*$/u.test(lines[0] ?? '')) {
    const close = lines.findIndex((line, index) => index > 0 && /^---[ \t]*$/u.test(line));
    if (close < 0) return '';
    start = close + 1;
  }

  const output: string[] = [];
  let fence: { marker: '`' | '~'; length: number } | null = null;
  for (const line of lines.slice(start)) {
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u.exec(line)?.[1];
      if (close && close[0] === fence.marker && close.length >= fence.length) fence = null;
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line)?.[1];
    if (open) {
      fence = { marker: open[0] as '`' | '~', length: open.length };
      continue;
    }
    if (line.trimStart().startsWith('![')) continue;
    output.push(line.replace(/(?<!\\)`[^`\n]*`/gu, ''));
  }
  return output.join('\n');
}

function utf8ByteLength(content: string): number {
  return new TextEncoder().encode(content).byteLength;
}

function normalizeMeta(meta: CompletionTrainingMeta): CompletionTrainingMeta {
  const trainedPaths = meta.trainedPaths ?? {};
  const failedPaths = meta.failedPaths ?? {};
  return {
    version: TRAINING_META_VERSION,
    status: normalizeStatus(meta.status),
    trainedPaths,
    fileCount: Object.keys(trainedPaths).length,
    updatedAt: meta.updatedAt,
    lastError: meta.lastError,
    successCount: Number.isFinite(meta.successCount) ? meta.successCount : 0,
    failureCount: Number.isFinite(meta.failureCount) ? meta.failureCount : 0,
    failedPaths,
    lastRunId: meta.lastRunId,
  };
}

function normalizeStatus(
  status: CompletionTrainingMeta['status'],
): CompletionTrainingMeta['status'] {
  return ['idle', 'training', 'done', 'partial', 'error'].includes(status) ? status : 'idle';
}

function idleDelay(): Promise<void> {
  return new Promise((resolve) => {
    const requestIdle = window.requestIdleCallback;
    if (requestIdle) {
      requestIdle(() => resolve(), { timeout: 250 });
    } else {
      setTimeout(resolve, 16);
    }
  });
}
