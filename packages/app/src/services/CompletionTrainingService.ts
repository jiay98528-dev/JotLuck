import type { DirEntry, IFileSystemService } from '@/types';
import type { MarkdownPredictor } from './MarkdownPredictor';

export const TRAINING_META_KEY = 'markluck:autocomplete:trainingMeta';
export const TRAINING_META_EVENT = 'markluck:autocomplete:trainingMetaChanged';
export const TRAINING_META_VERSION = 1;
const MAX_TRAINING_FILE_SIZE = 512 * 1024;

export interface CompletionTrainingFileMeta {
  mtime: number;
  size: number;
}

export interface CompletionTrainingMeta {
  version: number;
  status: 'idle' | 'training' | 'done' | 'error';
  trainedPaths: Record<string, CompletionTrainingFileMeta>;
  fileCount: number;
  updatedAt: number;
  lastError?: string;
}

export const DEFAULT_TRAINING_META: CompletionTrainingMeta = {
  version: TRAINING_META_VERSION,
  status: 'idle',
  trainedPaths: {},
  fileCount: 0,
  updatedAt: 0,
};

export function loadTrainingMeta(): CompletionTrainingMeta {
  try {
    const raw = localStorage.getItem(TRAINING_META_KEY);
    if (!raw) return createDefaultTrainingMeta();
    const parsed = JSON.parse(raw) as Partial<CompletionTrainingMeta>;
    if (parsed.version !== TRAINING_META_VERSION) {
      return createDefaultTrainingMeta();
    }
    return {
      ...DEFAULT_TRAINING_META,
      ...parsed,
      trainedPaths: parsed.trainedPaths ?? {},
      fileCount: Object.keys(parsed.trainedPaths ?? {}).length,
    };
  } catch {
    return createDefaultTrainingMeta();
  }
}

function createDefaultTrainingMeta(): CompletionTrainingMeta {
  return { ...DEFAULT_TRAINING_META, trainedPaths: {} };
}

export function saveTrainingMeta(meta: CompletionTrainingMeta): void {
  const normalized = normalizeMeta(meta);
  localStorage.setItem(TRAINING_META_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(TRAINING_META_EVENT, { detail: normalized }));
}

export function subscribeTrainingMeta(
  listener: (meta: CompletionTrainingMeta) => void,
): () => void {
  const handler = (event: Event) => {
    listener((event as CustomEvent<CompletionTrainingMeta>).detail ?? loadTrainingMeta());
  };
  window.addEventListener(TRAINING_META_EVENT, handler);
  const storageHandler = (event: StorageEvent) => {
    if (event.key === TRAINING_META_KEY) listener(loadTrainingMeta());
  };
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener(TRAINING_META_EVENT, handler);
    window.removeEventListener('storage', storageHandler);
  };
}

export class CompletionTrainingService {
  private running = false;

  constructor(
    private readonly fs: IFileSystemService,
    private readonly predictor: MarkdownPredictor,
  ) {}

  async trainNotebook(entries: DirEntry[]): Promise<void> {
    if (this.running) return;
    this.running = true;
    let meta: CompletionTrainingMeta = {
      ...loadTrainingMeta(),
      status: 'training',
      lastError: undefined,
    };
    saveTrainingMeta(meta);

    try {
      await this.predictor.initialize();
      const candidates = entries.filter((entry) => this.shouldTrainEntry(entry, meta));
      for (let i = 0; i < candidates.length; i += 4) {
        const batch = candidates.slice(i, i + 4);
        await Promise.all(batch.map((entry) => this.trainEntry(entry, meta)));
        meta = normalizeMeta({ ...meta, status: 'training', updatedAt: Date.now() });
        saveTrainingMeta(meta);
        await idleDelay();
      }
      saveTrainingMeta(normalizeMeta({ ...meta, status: 'done', updatedAt: Date.now() }));
    } catch (error) {
      saveTrainingMeta(
        normalizeMeta({
          ...meta,
          status: 'error',
          updatedAt: Date.now(),
          lastError: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      this.running = false;
    }
  }

  async trainFile(path: string, content: string, stat?: CompletionTrainingFileMeta): Promise<void> {
    if (!this.isTrainablePath(path)) return;
    const size = stat?.size ?? content.length;
    if (size > MAX_TRAINING_FILE_SIZE) return;
    await this.predictor.initialize();
    this.predictor.ingestDocument(path, stripUntrainableMarkdown(content), true);
    const meta = loadTrainingMeta();
    meta.trainedPaths[path] = {
      mtime: stat?.mtime ?? Date.now(),
      size,
    };
    saveTrainingMeta(normalizeMeta({ ...meta, status: 'done', updatedAt: Date.now() }));
  }

  removePath(path: string): void {
    const meta = loadTrainingMeta();
    if (!(path in meta.trainedPaths)) return;
    delete meta.trainedPaths[path];
    saveTrainingMeta(normalizeMeta({ ...meta, status: 'done', updatedAt: Date.now() }));
  }

  private async trainEntry(entry: DirEntry, meta: CompletionTrainingMeta): Promise<void> {
    try {
      const content = await this.fs.readFile(entry.path);
      await this.trainFile(entry.path, content, {
        mtime: entry.mtime ?? Date.now(),
        size: entry.size ?? content.length,
      });
      meta.trainedPaths[entry.path] = {
        mtime: entry.mtime ?? Date.now(),
        size: entry.size ?? content.length,
      };
    } catch {
      // Skip unreadable files, the editor remains usable without them.
    }
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
    return /\.(md|markdown|txt)$/.test(normalized);
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
  return {
    version: TRAINING_META_VERSION,
    status: meta.status,
    trainedPaths,
    fileCount: Object.keys(trainedPaths).length,
    updatedAt: meta.updatedAt,
    lastError: meta.lastError,
  };
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
