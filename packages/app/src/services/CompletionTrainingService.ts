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
  try {
    const scopedKey = trainingMetaKeyForScope(scope);
    migrateLegacyTrainingMeta(scopedKey);
    const raw = localStorage.getItem(scopedKey);
    if (!raw) return createDefaultTrainingMeta();
    const parsed = JSON.parse(raw) as Partial<CompletionTrainingMeta>;
    if (parsed.version !== 1 && parsed.version !== TRAINING_META_VERSION) {
      return createDefaultTrainingMeta();
    }
    return normalizeMeta({
      ...DEFAULT_TRAINING_META,
      ...parsed,
      trainedPaths: parsed.trainedPaths ?? {},
      failedPaths: parsed.failedPaths ?? {},
      fileCount: Object.keys(parsed.trainedPaths ?? {}).length,
    } as CompletionTrainingMeta);
  } catch {
    return createDefaultTrainingMeta();
  }
}

function createDefaultTrainingMeta(): CompletionTrainingMeta {
  return { ...DEFAULT_TRAINING_META, trainedPaths: {}, failedPaths: {} };
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

  constructor(
    private readonly fs: IFileSystemService,
    private readonly predictor: MarkdownPredictor,
  ) {}

  private get storageScope(): string {
    return this.predictor.getStorageScope();
  }

  async trainNotebook(entries: DirEntry[]): Promise<void> {
    if (this.running) return;
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
      this.running = false;
    }
  }

  cancelCurrentRun(): void {
    this.generation++;
    this.running = false;
  }

  async trainFile(path: string, content: string, stat?: CompletionTrainingFileMeta): Promise<void> {
    if (!this.isTrainablePath(path)) return;
    const size = stat?.size ?? content.length;
    if (size > MAX_TRAINING_FILE_SIZE) return;
    await this.predictor.initialize();
    this.predictor.ingestDocument(path, stripUntrainableMarkdown(content), true);
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
    const meta = loadTrainingMeta(this.storageScope);
    if (!(path in meta.trainedPaths)) return;
    delete meta.trainedPaths[path];
    saveTrainingMeta(
      normalizeMeta({ ...meta, status: 'done', updatedAt: Date.now() }),
      this.storageScope,
    );
  }

  private async trainEntry(
    entry: DirEntry,
    meta: CompletionTrainingMeta,
    generation: number,
  ): Promise<{ ok: true; path: string } | { ok: false; path: string; error: string }> {
    try {
      const content = await this.fs.readFile(entry.path);
      if (!this.isCurrentGeneration(generation)) return { ok: true, path: entry.path };
      this.predictor.ingestDocument(entry.path, stripUntrainableMarkdown(content), true);
      meta.trainedPaths[entry.path] = {
        mtime: entry.mtime ?? Date.now(),
        size: entry.size ?? content.length,
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
    if ((entry.size ?? 0) > MAX_TRAINING_FILE_SIZE) return false;
    const prev = meta.trainedPaths[entry.path];
    if (!prev) return true;
    return prev.mtime !== (entry.mtime ?? 0) || prev.size !== (entry.size ?? 0);
  }

  private isTrainablePath(path: string): boolean {
    const normalized = path.replace(/\\/g, '/').toLowerCase();
    if (normalized.includes('/assets/')) return false;
    return /\.(md|markdown|mdx|txt)$/.test(normalized);
  }
}

export function stripUntrainableMarkdown(content: string): string {
  return content
    .replace(/^---[\s\S]*?\n---/m, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('!['))
    .join('\n');
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
