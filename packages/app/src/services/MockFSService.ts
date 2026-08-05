/**
 * MockFSService - in-memory virtual file system for Web/E2E.
 *
 * The mock mirrors the Tauri IPC file-system contract: notebook-rooted paths use
 * `/` as the root marker, and every note is plain text. Browser persistence is
 * opt-in so normal Web previews do not silently become a note database.
 */
import type {
  DirEntry,
  FileChangeEvent,
  FileStat,
  IFileSystemService,
  NotebookHandle,
  TextFileSnapshot,
  ConditionalWriteResult,
  UnwatchFn,
} from '@/types';
import { isMarkdownLikeFile, isSupportedNoteFile } from '@/utils/note-files';
import { createLocaleCollator, currentLocale } from '@/i18n';
import { createCommandError } from './command-errors';
import { createSampleNotebookSeed } from './SampleSeed';

const STORAGE_KEY = 'jotluck-mockfs';
const STORAGE_VERSION = 4;
const DEFAULT_DELAY = 50;

interface StoredFile {
  content: string;
  mtime: number;
  size: number;
}

interface MockFSData {
  version: number;
  files: Record<string, StoredFile>;
  dirs: Record<string, string[]>;
}

export interface MockFSServiceOptions {
  persist?: boolean;
  /** Test-only recent notebook roots. Defaults to the sample notebook. */
  recentNotebooks?: readonly string[];
  /** Test-only picker result. Null models an explicit user cancellation. */
  pickerResult?: NotebookHandle | null;
  /** Test-only picker/open failure message. */
  pickerError?: string;
  /** Test-only roots that fail when opened from the recent list. */
  unavailableNotebookPaths?: readonly string[];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePath(path: string): string {
  const normalized = (path || '/').replace(/\\/g, '/').replace(/\/+/g, '/');
  if (normalized === '/') return '/';
  return normalized.startsWith('/') ? normalized.replace(/\/+$/, '') : `/${normalized}`;
}

function encodeSize(content: string): number {
  return new TextEncoder().encode(content).length;
}

async function textRevision(content: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(content),
  );
  return `sha256:${Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

function createLocalizedSampleNotebook(): MockFSData {
  const now = Date.now();
  const seed = createSampleNotebookSeed();
  const files: Record<string, StoredFile> = {};
  const directoryEntries = new Map<string, Set<string>>([['/', new Set()]]);

  const ensureDirectory = (path: string): void => {
    const normalized = normalizePath(path);
    if (directoryEntries.has(normalized)) return;
    const parent = normalized.slice(0, normalized.lastIndexOf('/')) || '/';
    ensureDirectory(parent);
    directoryEntries.set(normalized, new Set());
    directoryEntries.get(parent)?.add(normalized.split('/').pop() ?? '');
  };

  seed.files.forEach((seedFile, index) => {
    const path = normalizePath(seedFile.path);
    const parent = path.slice(0, path.lastIndexOf('/')) || '/';
    ensureDirectory(parent);
    const content = seedFile.content;
    files[path] = {
      content,
      mtime: now - index * 60_000,
      size: encodeSize(content),
    };
    directoryEntries.get(parent)?.add(path.split('/').pop() ?? '');
  });

  return {
    version: STORAGE_VERSION,
    files,
    dirs: Object.fromEntries(
      [...directoryEntries.entries()].map(([path, entries]) => [path, [...entries]]),
    ),
  };
}

export class MockFSService implements IFileSystemService {
  private data: MockFSData;
  private readonly latency: number;
  private readonly persistToLocalStorage: boolean;
  private readonly recentNotebooks: readonly string[];
  private readonly pickerResult: NotebookHandle | null;
  private readonly pickerError: string | null;
  private readonly unavailableNotebookPaths: ReadonlySet<string>;

  constructor(latencyMs = DEFAULT_DELAY, options: MockFSServiceOptions = {}) {
    this.latency = latencyMs;
    this.persistToLocalStorage = options.persist ?? false;
    const sampleName = createSampleNotebookSeed().directoryName;
    this.recentNotebooks = options.recentNotebooks ?? ['/'];
    this.pickerResult =
      options.pickerResult === undefined
        ? { rootPath: '/', name: sampleName }
        : options.pickerResult;
    this.pickerError = options.pickerError ?? null;
    this.unavailableNotebookPaths = new Set(options.unavailableNotebookPaths ?? []);
    this.data = this.load();
  }

  private load(): MockFSData {
    if (!this.persistToLocalStorage) return createLocalizedSampleNotebook();

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as MockFSData;
        if (parsed.version === STORAGE_VERSION) return parsed;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[MockFSService] localStorage data is invalid, resetting sample notebook:', e);
    }

    const sample = createLocalizedSampleNotebook();
    this.persist(sample);
    return sample;
  }

  private persist(data?: MockFSData): void {
    if (data) this.data = data;
    if (!this.persistToLocalStorage) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
  }

  private parentDir(path: string): string {
    const segs = normalizePath(path).split('/').filter(Boolean);
    segs.pop();
    return segs.length ? `/${segs.join('/')}` : '/';
  }

  private basename(path: string): string {
    return normalizePath(path).split('/').pop() ?? '';
  }

  async readFile(path: string): Promise<string> {
    await delay(this.latency);
    const normalized = normalizePath(path);
    const file = this.data.files[normalized];
    if (!file) throw createCommandError('not_found', undefined, normalized);
    return file.content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    const normalized = normalizePath(path);
    const now = Date.now();
    this.data.files[normalized] = {
      content,
      mtime: now,
      size: encodeSize(content),
    };

    const parent = this.parentDir(normalized);
    if (!this.data.dirs[parent]) this.data.dirs[parent] = [];
    const name = this.basename(normalized);
    if (!this.data.dirs[parent].includes(name)) this.data.dirs[parent].push(name);
    this.persist();
    await delay(this.latency);
  }

  async readFileSnapshot(path: string): Promise<TextFileSnapshot> {
    await delay(this.latency);
    const normalized = normalizePath(path);
    const file = this.data.files[normalized];
    if (!file) throw createCommandError('not_found', undefined, normalized);
    const content = file.content;
    return { content, revision: await textRevision(content) };
  }

  async writeFileIfUnchanged(
    path: string,
    content: string,
    expectedRevision: string | null,
  ): Promise<ConditionalWriteResult> {
    const normalized = normalizePath(path);
    const nextRevision = await textRevision(content);
    await delay(this.latency);

    // Hashing yields to the event loop. Recheck the exact observed content before
    // committing so a concurrent mock write cannot slip between compare and replace.
    for (;;) {
      const observedContent = this.data.files[normalized]?.content;
      const actualRevision =
        observedContent === undefined ? null : await textRevision(observedContent);
      if (this.data.files[normalized]?.content !== observedContent) continue;
      if (actualRevision !== expectedRevision) {
        return { status: 'conflict', actualRevision };
      }

      const now = Date.now();
      this.data.files[normalized] = {
        content,
        mtime: now,
        size: encodeSize(content),
      };
      const parent = this.parentDir(normalized);
      if (!this.data.dirs[parent]) this.data.dirs[parent] = [];
      const name = this.basename(normalized);
      if (!this.data.dirs[parent].includes(name)) this.data.dirs[parent].push(name);
      this.persist();
      await delay(this.latency);
      return { status: 'saved', revision: nextRevision };
    }
  }

  async writeBinary(path: string, base64: string): Promise<void> {
    await this.writeFile(path, base64);
  }

  async readBinary(path: string): Promise<string> {
    return this.readFile(path);
  }

  isBinaryPath(path: string): boolean {
    const ext = path.split('.').pop()?.toLowerCase();
    return [
      'png',
      'jpg',
      'jpeg',
      'gif',
      'webp',
      'svg',
      'bmp',
      'ico',
      'pdf',
      'docx',
      'xlsx',
    ].includes(ext ?? '');
  }

  async deleteFile(path: string): Promise<void> {
    await delay(this.latency);
    const normalized = normalizePath(path);
    delete this.data.files[normalized];
    const parent = this.parentDir(normalized);
    const name = this.basename(normalized);
    if (this.data.dirs[parent]) {
      this.data.dirs[parent] = this.data.dirs[parent].filter((entry) => entry !== name);
    }
    this.persist();
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    await delay(this.latency);
    const oldNormalized = normalizePath(oldPath);
    const newNormalized = normalizePath(newPath);
    const file = this.data.files[oldNormalized];
    if (!file) throw createCommandError('not_found', undefined, oldNormalized);

    if (oldNormalized === newNormalized) return;
    if (this.data.files[newNormalized] || this.data.dirs[newNormalized]) {
      throw createCommandError('already_exists', undefined, newNormalized);
    }

    delete this.data.files[oldNormalized];
    this.data.files[newNormalized] = { ...file, mtime: Date.now() };

    const oldParent = this.parentDir(oldNormalized);
    const oldName = this.basename(oldNormalized);
    if (this.data.dirs[oldParent]) {
      this.data.dirs[oldParent] = this.data.dirs[oldParent].filter((entry) => entry !== oldName);
    }

    const newParent = this.parentDir(newNormalized);
    const newName = this.basename(newNormalized);
    if (!this.data.dirs[newParent]) this.data.dirs[newParent] = [];
    if (!this.data.dirs[newParent].includes(newName)) this.data.dirs[newParent].push(newName);
    this.persist();
  }

  async createDirectory(path: string): Promise<void> {
    await delay(this.latency);
    const normalized = normalizePath(path);
    if (!this.data.dirs[normalized]) this.data.dirs[normalized] = [];

    const parent = this.parentDir(normalized);
    const name = this.basename(normalized);
    if (!this.data.dirs[parent]) this.data.dirs[parent] = [];
    if (name && !this.data.dirs[parent].includes(name)) this.data.dirs[parent].push(name);
    this.persist();
  }

  async listDirectory(path: string): Promise<DirEntry[]> {
    await delay(this.latency);
    const normalized = normalizePath(path);
    const entries = this.data.dirs[normalized] ?? [];
    return entries
      .filter((name) => {
        if (name.startsWith('.')) return false;
        const fullPath = normalized === '/' ? `/${name}` : `${normalized}/${name}`;
        return fullPath in this.data.dirs || isSupportedNoteFile(name);
      })
      .map((name) => {
        const fullPath = normalized === '/' ? `/${name}` : `${normalized}/${name}`;
        const isDirectory = fullPath in this.data.dirs;
        const file = this.data.files[fullPath];
        return {
          name,
          path: fullPath,
          isDirectory,
          isFile: !isDirectory,
          size: file?.size ?? 0,
          mtime: file?.mtime ?? 0,
          mimeType: isMarkdownLikeFile(name)
            ? 'text/markdown'
            : name.endsWith('.txt')
              ? 'text/plain'
              : undefined,
        } satisfies DirEntry;
      })
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return createLocaleCollator({}, currentLocale.value).compare(a.name, b.name);
      });
  }

  async statFile(path: string): Promise<FileStat> {
    await delay(this.latency);
    const normalized = normalizePath(path);
    const file = this.data.files[normalized];
    const isDirectory = normalized in this.data.dirs;
    if (!file && !isDirectory) throw createCommandError('not_found', undefined, normalized);
    return {
      path: normalized,
      size: file?.size ?? 0,
      mtime: file?.mtime ?? 0,
      isDirectory,
      isFile: !isDirectory,
    };
  }

  async watch(
    _rootPath: string,
    _callback: (events: FileChangeEvent | FileChangeEvent[]) => void,
  ): Promise<UnwatchFn> {
    return () => {};
  }

  async unwatchAll(): Promise<void> {
    // no-op
  }

  resolvePath(root: string, ...segments: string[]): string {
    return normalizePath([root, ...segments].join('/'));
  }

  async isPathInNotebook(root: string, path: string): Promise<boolean> {
    const notebookRoot = normalizePath(root);
    const candidate = normalizePath(path);
    return candidate === notebookRoot || candidate.startsWith(`${notebookRoot}/`);
  }

  async selectNotebook(): Promise<NotebookHandle | null> {
    await delay(this.latency);
    if (this.pickerError)
      throw createCommandError('permission_denied', undefined, this.pickerError);
    return this.pickerResult ? { ...this.pickerResult } : null;
  }

  async openNotebook(): Promise<NotebookHandle | null> {
    const selected = await this.selectNotebook();
    return selected ? this.openNotebookAt(selected.rootPath) : null;
  }

  async openNotebookAt(path: string): Promise<NotebookHandle> {
    await delay(this.latency);
    if (this.unavailableNotebookPaths.has(path)) {
      throw createCommandError('not_found', undefined, path);
    }
    const rootPath = path || '/';
    const name =
      rootPath === '/'
        ? createSampleNotebookSeed().directoryName
        : (rootPath
            .replace(/[\\/]+$/u, '')
            .split(/[\\/]/u)
            .pop() ?? rootPath);
    return { rootPath, name };
  }

  async getRecentNotebooks(): Promise<string[]> {
    await delay(this.latency);
    return [...this.recentNotebooks];
  }
}
