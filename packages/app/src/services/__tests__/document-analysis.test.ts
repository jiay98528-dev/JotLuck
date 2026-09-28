import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { DocumentAnalysis } from '../document-analysis';
import {
  documentAnalysisFacet,
  getDocumentAst,
  peekDocumentAst,
} from '@/utils/cm6-document-analysis';
import { parseDocument } from '@jotluck/renderer/analysis';

const sessions: DocumentAnalysis[] = [];
afterEach(() => {
  sessions.splice(0).forEach((session) => session.destroy());
  vi.unstubAllGlobals();
});
function create() {
  const session = new DocumentAnalysis();
  sessions.push(session);
  return session;
}

describe('document analysis ownership', () => {
  it('prepares a priority worker when large reading begins and releases it on file reset', () => {
    const workers: Array<{ terminate: ReturnType<typeof vi.fn>; onerror?: () => void }> = [];
    vi.stubGlobal(
      'Worker',
      class {
        terminate = vi.fn();
        onerror?: () => void;
        postMessage() {}
        constructor() {
          workers.push(this);
        }
      },
    );
    const analysis = create();
    analysis.update('长文正文'.repeat(40_000));
    expect(workers).toHaveLength(1);
    analysis.requestPreview();
    analysis.requestPreview();
    expect(workers).toHaveLength(2);
    const priority = workers[1]!;
    analysis.reset();
    expect(priority.terminate).toHaveBeenCalledOnce();
    analysis.update('另一篇长文'.repeat(40_000));
    analysis.requestPreview();
    expect(workers).toHaveLength(3);
    priority.onerror?.();
    expect(workers[2]!.terminate).not.toHaveBeenCalled();
  });
  it('discards cancelled priority ranges and releases their worker', () => {
    const workers: Array<{
      onmessage?: (event: { data: unknown }) => void;
      messages: Array<Record<string, unknown>>;
      terminate: ReturnType<typeof vi.fn>;
    }> = [];
    vi.stubGlobal(
      'Worker',
      class {
        onmessage?: (event: { data: unknown }) => void;
        messages: Array<Record<string, unknown>> = [];
        terminate = vi.fn();
        constructor() {
          workers.push(this);
        }
        postMessage(message: Record<string, unknown>) {
          this.messages.push(message);
        }
      },
    );
    const analysis = create();
    analysis.update('# First\n\ntext\n\n## Last');
    const accepted = vi.fn();
    analysis.subscribePriority(accepted);
    analysis.requestRange(analysis.source.indexOf('##'));
    const worker = workers[0]!;
    const old = worker.messages.at(-1)!;
    analysis.cancelPriority();
    worker.onmessage?.({ data: { ...old, fragments: [] } });
    expect(accepted).not.toHaveBeenCalled();
    analysis.requestRange(0);
    const current = worker.messages.at(-1)!;
    worker.onmessage?.({ data: { ...current, fragments: [] } });
    expect(accepted).toHaveBeenCalledOnce();
    analysis.destroy();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('shares one exact snapshot across selection-only editor states', () => {
    const analysis = create();
    analysis.update('# Title\n\ntext');
    const state = EditorState.create({
      doc: analysis.source,
      extensions: [documentAnalysisFacet.of(analysis)],
    });
    const ast = getDocumentAst(state);
    const moved = state.update({ selection: { anchor: 4 } }).state;
    expect(getDocumentAst(moved)).toBe(ast);
    expect(analysis.result?.ast).toBe(ast);
  });
  it('does not use a stale snapshot for a mutating command', () => {
    const analysis = create();
    analysis.update('# Old');
    const state = EditorState.create({
      doc: '# New',
      extensions: [documentAnalysisFacet.of(analysis)],
    });
    expect(peekDocumentAst(state)).toBeNull();
    expect(getDocumentAst(state).source).toBe('# New');
  });
  it('rejects out-of-order worker results and terminates workers on disposal', () => {
    const workers: FakeWorker[] = [];
    class FakeWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: (() => void) | null = null;
      messages: Array<{ revision: number; source: string }> = [];
      terminate = vi.fn();
      constructor() {
        workers.push(this);
      }
      postMessage(message: { revision: number; source: string }) {
        this.messages.push(message);
      }
    }
    vi.stubGlobal('Worker', FakeWorker);
    const analysis = create();
    const received = vi.fn();
    analysis.subscribe(received);
    analysis.update('old '.repeat(31000));
    analysis.update('new '.repeat(31000));
    const worker = workers[0]!;
    const old = worker.messages[0]!;
    const next = worker.messages[1]!;
    worker.onmessage?.({
      data: { revision: old.revision, ast: parseDocument(old.source), wordCount: 1 },
    });
    expect(received).not.toHaveBeenCalled();
    worker.onmessage?.({
      data: { revision: next.revision, ast: parseDocument(next.source), wordCount: 2 },
    });
    expect(received).toHaveBeenCalledTimes(1);
    analysis.destroy();
    worker.onmessage?.({
      data: { revision: next.revision, ast: parseDocument(next.source), wordCount: 2 },
    });
    expect(received).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
