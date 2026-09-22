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
