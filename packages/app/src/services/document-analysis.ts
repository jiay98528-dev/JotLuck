import {
  parseDocument,
  updateDocumentAsync,
  extractWikiLinkOccurrences,
  type WikiLinkOccurrence,
  type DocumentAst,
} from '@jotluck/renderer/analysis';
import { preparePreviewFragments, type PreviewFragment } from '@jotluck/renderer/progressive';

export function isLargeDocument(source: string, lines?: number): boolean {
  if (source.length > 120_000) return true;
  // A single enormous paragraph needs bounded rendering even below the total-size threshold.
  if (source.length > 16_384) {
    let start = 0;
    while (start < source.length) {
      const end = source.indexOf('\n', start);
      if ((end < 0 ? source.length : end) - start > 16_384) return true;
      if (end < 0) break;
      start = end + 1;
    }
  }
  if (lines !== undefined) return lines > 3_000;
  let count = 1;
  for (let i = 0; i < source.length; i++)
    if (source.charCodeAt(i) === 10 && ++count > 3_000) return true;
  return false;
}

export interface DocumentAnalysisResult {
  revision: number;
  ast: DocumentAst;
  wordCount: number;
  wikiLinks?: WikiLinkOccurrence[];
}

/** One owner per open document. Never writes source or participates in saving. */
export class DocumentAnalysis {
  get version(): number {
    return this.revision;
  }
  source = '';
  result: DocumentAnalysisResult | null = null;
  error: Error | null = null;
  fragments: PreviewFragment[] | null = null;
  previewComplete = false;
  private previewWanted = false;
  private previewRequestRevision = -1;
  private previewListeners = new Set<(fragments: PreviewFragment[]) => void>();
  priorityFragments: PreviewFragment[] = [];
  private priorityListeners = new Set<(fragments: PreviewFragment[]) => void>();
  private priorityWorker: Worker | null = null;
  private priorityJob = 0;
  private definitions = '';
  private requestedPriorityPosition: number | null = null;

  subscribePriority(listener: (fragments: PreviewFragment[]) => void): () => void {
    this.priorityListeners.add(listener);
    return () => this.priorityListeners.delete(listener);
  }
  cancelPriority(): void {
    this.requestedPriorityPosition = null;
    this.priorityWorker?.postMessage({ job: ++this.priorityJob });
  }
  /** A bounded, separate worker can prepare the target while the full-document lexer is busy. */
  requestRange(position: number): void {
    const result = this.result;
    if (
      this.destroyed ||
      !result ||
      result.ast.source !== this.source ||
      typeof Worker === 'undefined'
    )
      return;
    if (this.fragments?.some((part) => position >= part.from && position < part.to)) return;
    if (this.requestedPriorityPosition === position) return;
    this.requestedPriorityPosition = position;
    const blocks = result.ast.blocks;
    let low = 0,
      high = blocks.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (blocks[mid]!.range.to < position) low = mid + 1;
      else high = mid;
    }
    const start = blocks[low];
    if (!start) return;
    let last = low;
    while (
      last + 1 < blocks.length &&
      last < low + 40 &&
      blocks[last + 1]!.range.to - start.range.from <= 16_384
    )
      last++;
    const end = blocks[last]!.range.to;
    const worker = this.preparePriorityWorker();
    if (!worker) return;
    worker.postMessage({
      job: ++this.priorityJob,
      revision: this.revision,
      from: start.range.from,
      source: this.source.slice(start.range.from, end),
      definitions: this.definitions,
      headings: blocks
        .slice(low, last + 1)
        .flatMap((block) => (block.type === 'heading' ? [block.id] : [])),
    });
  }
  private preparePriorityWorker(): Worker | null {
    if (this.destroyed || typeof Worker === 'undefined') return null;
    if (!this.priorityWorker) {
      try {
        this.priorityWorker = new Worker(
          new URL('./document-priority.worker.ts', import.meta.url),
          { type: 'module' },
        );
      } catch {
        this.requestedPriorityPosition = null;
        return null;
      }
      const worker = this.priorityWorker;
      worker.onerror = () => {
        if (this.priorityWorker !== worker) return;
        worker.terminate();
        this.priorityWorker = null;
        this.requestedPriorityPosition = null;
      };
      worker.onmessage = ({
        data,
      }: MessageEvent<{ job: number; revision: number; fragments: PreviewFragment[] }>) => {
        if (
          this.destroyed ||
          this.priorityWorker !== worker ||
          data.job !== this.priorityJob ||
          data.revision !== this.revision
        )
          return;
        this.priorityFragments = data.fragments;
        for (const listener of this.priorityListeners) listener(data.fragments);
      };
    }
    return this.priorityWorker;
  }
  private revision = 0;
  private worker: Worker | null = null;
  private destroyed = false;
  private listeners = new Set<(result: DocumentAnalysisResult) => void>();

  subscribe(listener: (result: DocumentAnalysisResult) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribePreview(listener: (fragments: PreviewFragment[]) => void): () => void {
    this.previewListeners.add(listener);
    this.previewWanted = true;
    return () => {
      this.previewListeners.delete(listener);
      this.previewWanted = this.previewListeners.size > 0;
    };
  }

  requestPreview(): void {
    if (this.destroyed) return;
    if (isLargeDocument(this.source)) this.preparePriorityWorker();
    if (this.fragments) {
      for (const listener of this.previewListeners) listener(this.fragments);
      if (this.previewComplete) return;
    }
    if (this.previewRequestRevision === this.revision) return;
    this.previewRequestRevision = this.revision;
    if (this.worker)
      this.worker.postMessage({ source: this.source, revision: this.revision, preview: true });
    else void this.prepareLocally(this.source, this.revision);
  }

  update(source: string): void {
    if (this.destroyed || (source === this.source && (this.result || this.revision > 0))) return;
    this.cancelPriority();
    this.priorityFragments = [];
    this.source = source;
    this.fragments = null;
    this.previewComplete = false;
    this.error = null;
    const revision = ++this.revision;
    this.previewRequestRevision = this.previewWanted ? revision : -1;
    if (!isLargeDocument(source)) {
      this.worker?.postMessage({ revision, cancel: true });
      const ast = parseDocument(source);
      this.accept({
        revision,
        ast,
        wordCount: countWords(source),
        wikiLinks: extractWikiLinkOccurrences(ast),
      });
      if (this.previewWanted) void this.prepareLocally(source, revision);
      return;
    }
    if (!this.worker && typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./document-analysis.worker.ts', import.meta.url), {
          type: 'module',
        });
        this.worker.onmessage = (
          event: MessageEvent<
            | DocumentAnalysisResult
            | { revision: number; error: string }
            | {
                revision: number;
                fragments: PreviewFragment[];
                append?: boolean;
                complete?: boolean;
              }
          >,
        ) => {
          if ('error' in event.data) {
            if (event.data.revision === this.revision) this.error = new Error(event.data.error);
          } else if ('fragments' in event.data)
            this.acceptPreview(
              event.data.fragments,
              event.data.revision,
              event.data.append,
              event.data.complete,
            );
          else this.accept(event.data);
        };
        this.worker.onerror = () => {
          this.worker?.terminate();
          this.worker = null;
          this.error = new Error('Background document analysis failed');
          void this.analyzeLocally(this.source, this.revision);
        };
      } catch {
        this.worker = null;
      }
    }
    if (this.worker) this.worker.postMessage({ source, revision, preview: this.previewWanted });
    else void this.analyzeLocally(source, revision);
  }

  retry(): void {
    if (this.destroyed) return;
    this.revision++;
    this.error = null;
    const source = this.source;
    this.source = '\0';
    this.update(source);
  }

  reset(): void {
    this.cancelPriority();
    this.priorityWorker?.terminate();
    this.priorityWorker = null;
    this.priorityFragments = [];
    this.revision++;
    this.worker?.postMessage({ revision: this.revision, cancel: true });
    this.source = '\0';
    this.result = null;
    this.fragments = null;
    this.previewComplete = false;
    this.previewRequestRevision = -1;
  }

  /** Only explicit editing commands may synchronously request an exact snapshot. */
  exact(source: string): DocumentAst {
    if (this.result?.ast.source === source) return this.result.ast;
    const ast = parseDocument(source);
    if (source === this.source)
      this.result = {
        revision: this.revision,
        ast,
        wordCount: countWords(source),
        wikiLinks: extractWikiLinkOccurrences(ast),
      };
    return ast;
  }

  destroy(): void {
    this.destroyed = true;
    this.revision++;
    this.worker?.terminate();
    this.priorityWorker?.terminate();
    this.priorityWorker = null;
    this.priorityListeners.clear();
    this.priorityFragments = [];
    this.worker = null;
    this.listeners.clear();
    this.previewListeners.clear();
    this.fragments = null;
    this.result = null;
    this.source = '';
  }

  private async analyzeLocally(source: string, revision: number): Promise<void> {
    try {
      const ast = await updateDocumentAsync(
        this.result?.ast ?? null,
        source,
        () => this.destroyed || revision !== this.revision,
      );
      this.accept({
        revision,
        ast,
        wordCount: countWords(source),
        wikiLinks: extractWikiLinkOccurrences(ast),
      });
      if (this.previewWanted) void this.prepareLocally(source, revision);
    } catch (error) {
      if (!this.destroyed && revision === this.revision)
        this.error = error instanceof Error ? error : new Error(String(error));
    }
  }

  private async prepareLocally(source: string, revision: number): Promise<void> {
    try {
      await preparePreviewFragments(
        source,
        () => this.destroyed || revision !== this.revision,
        (fragments, complete) => this.acceptPreview(fragments, revision, true, complete),
      );
    } catch (error) {
      if (!this.destroyed && revision === this.revision) this.error = new Error(String(error));
    }
  }

  private acceptPreview(
    fragments: PreviewFragment[],
    revision: number,
    append = false,
    complete = true,
  ): void {
    if (this.destroyed || revision !== this.revision) return;
    this.fragments = append ? [...(this.fragments ?? []), ...fragments] : fragments;
    this.previewComplete = complete;
    for (const listener of this.previewListeners) listener(this.fragments);
  }

  private accept(result: DocumentAnalysisResult): void {
    if (this.destroyed || result.revision !== this.revision || result.ast.source !== this.source)
      return;
    this.result = result;
    this.definitions = result.ast.blocks
      .filter((block) => block.type === 'refDefinition')
      .map((block) => result.ast.source.slice(block.range.from, block.range.to))
      .join('\n');
    this.error = null;
    for (const listener of this.listeners) listener(result);
  }
}

export function countWords(source: string): number {
  let count = 0;
  const words = /\S+/g;
  while (words.exec(source)) count++;
  return count;
}
