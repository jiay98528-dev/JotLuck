import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_COMPLETION_SETTINGS } from '@/services/CompletionSettings';
import type { MarkdownPredictor } from '@/services/MarkdownPredictor';
import { ghostTextPlugin } from '../cm6-ghost-text';

const mountedViews: EditorView[] = [];

function mountGhostEditor(overrides: Record<string, unknown> = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const predictor = {
    getGhostText: vi.fn((cursor: number) => ({
      text: ' because',
      confidence: 0.9,
      from: cursor,
      source: 'ngram' as const,
      sourceLayer: 'l2',
      syntaxType: 'general',
      providerId: 'ngram',
      learnable: true,
      feedbackToken: 'prediction-1',
    })),
    acceptCompletion: vi.fn(),
    rejectCompletion: vi.fn(),
    ...overrides,
  } as unknown as MarkdownPredictor;
  const doc = 'reason is';
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: ghostTextPlugin(predictor, DEFAULT_COMPLETION_SETTINGS),
    }),
    parent: host,
  });
  mountedViews.push(view);
  view.focus();
  return { view, predictor, doc };
}

async function waitForGhost(view: EditorView): Promise<void> {
  await vi.waitFor(() => {
    expect(view.dom.querySelector('.cm-ghost-text')).not.toBeNull();
  });
}

afterEach(() => {
  vi.useRealTimers();
  while (mountedViews.length > 0) mountedViews.pop()?.destroy();
  document.body.replaceChildren();
});

describe('cm6 ghost text focus and Tab contract', () => {
  it('exposes internal visible latency without using the test polling duration', async () => {
    const { view, doc } = mountGhostEditor();
    await waitForGhost(view);

    const diagnostics = (
      view.dom as HTMLElement & {
        __jotluckGetVisibleGhostDiagnostics?: () => {
          prediction: { text: string };
          elapsedMs: number;
          cursor: number;
          documentLength: number;
        } | null;
      }
    ).__jotluckGetVisibleGhostDiagnostics?.();

    expect(diagnostics).toMatchObject({
      prediction: { text: ' because' },
      cursor: doc.length,
      documentLength: doc.length,
    });
    expect(diagnostics?.elapsedMs).toBeGreaterThanOrEqual(0);

    view.contentDOM.dispatchEvent(new FocusEvent('blur'));
    expect(
      (
        view.dom as HTMLElement & {
          __jotluckGetVisibleGhostDiagnostics?: () => unknown;
        }
      ).__jotluckGetVisibleGhostDiagnostics?.(),
    ).toBeNull();
  });

  it('blur only clears ghost text and never changes the document', async () => {
    const { view, predictor, doc } = mountGhostEditor();
    await waitForGhost(view);

    view.contentDOM.dispatchEvent(new FocusEvent('blur'));

    expect(view.state.doc.toString()).toBe(doc);
    expect(predictor.acceptCompletion).not.toHaveBeenCalled();
    expect(view.dom.querySelector('.cm-ghost-text')).toBeNull();
  });

  it('window blur only clears ghost text and pending interaction state', async () => {
    const { view, predictor, doc } = mountGhostEditor();
    await waitForGhost(view);

    window.dispatchEvent(new FocusEvent('blur'));

    expect(view.state.doc.toString()).toBe(doc);
    expect(predictor.acceptCompletion).not.toHaveBeenCalled();
    expect(view.dom.querySelector('.cm-ghost-text')).toBeNull();
  });

  it('does not accept ghost text on Shift+Tab', async () => {
    const { view, predictor, doc } = mountGhostEditor();
    await waitForGhost(view);

    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    );

    expect(view.state.doc.toString()).toBe(doc);
    expect(predictor.acceptCompletion).not.toHaveBeenCalled();
  });

  it('accepts ghost text on an unmodified Tab while the editor owns focus', async () => {
    const { view, predictor } = mountGhostEditor();
    await waitForGhost(view);

    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );

    expect(view.state.doc.toString()).toBe('reason is because');
    expect(predictor.acceptCompletion).toHaveBeenCalledTimes(1);
    expect(predictor.acceptCompletion).toHaveBeenCalledWith(
      'n is',
      ' because',
      expect.objectContaining({ feedbackToken: 'prediction-1' }),
    );
  });

  it('treats continued typing as neither acceptance nor rejection', async () => {
    const { view, predictor, doc } = mountGhostEditor();
    await waitForGhost(view);

    view.dispatch({ changes: { from: doc.length, insert: 'x' } });

    expect(view.state.doc.toString()).toBe(`${doc}x`);
    expect(predictor.acceptCompletion).not.toHaveBeenCalled();
    expect(predictor.rejectCompletion).not.toHaveBeenCalled();
  });

  it('cancels scheduled prediction work when the editor is destroyed', () => {
    vi.useFakeTimers();
    const { view, predictor } = mountGhostEditor();
    const callsBeforeDestroy = vi.mocked(predictor.getGhostText).mock.calls.length;

    view.destroy();
    mountedViews.splice(mountedViews.indexOf(view), 1);
    vi.runAllTimers();

    expect(predictor.getGhostText).toHaveBeenCalledTimes(callsBeforeDestroy);
  });

  it('aborts and discards an in-flight async result after the document changes', async () => {
    let resolveRequest: ((value: ReturnType<MarkdownPredictor['getGhostText']>) => void) | null =
      null;
    const observedSignals: AbortSignal[] = [];
    const requestGhostText = vi.fn(
      (
        _cursor: number,
        _doc: string,
        options: { signal?: AbortSignal },
      ): Promise<ReturnType<MarkdownPredictor['getGhostText']>> => {
        if (options.signal) observedSignals.push(options.signal);
        return new Promise((resolve) => {
          resolveRequest = resolve;
        });
      },
    );
    const { view, doc } = mountGhostEditor({ requestGhostText });
    await vi.waitFor(() => expect(requestGhostText).toHaveBeenCalledTimes(1));

    view.dispatch({ changes: { from: doc.length, insert: 'x' } });
    expect(observedSignals[0]?.aborted).toBe(true);
    const resolve = resolveRequest as
      | ((value: ReturnType<MarkdownPredictor['getGhostText']>) => void)
      | null;
    resolve?.({
      text: ' stale',
      confidence: 0.9,
      from: doc.length,
      source: 'ngram',
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(view.dom.querySelector('.cm-ghost-text')).toBeNull();
    expect(view.state.doc.toString()).toBe(`${doc}x`);
  });
});
