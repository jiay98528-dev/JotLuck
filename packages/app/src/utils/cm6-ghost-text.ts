/**
 * cm6-ghost-text — CodeMirror 6 Ghost Text 补全插件
 *
 * 双平面幽灵文本管道：结构化立即触发，正文预测 40ms 防抖，Tab 执行精确 TextEdit。
 *
 * @see spec/frontend/autocomplete-spec.md
 */

import {
  Decoration,
  ViewPlugin,
  WidgetType,
  EditorView,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { Prec, StateEffect, StateField, type Extension } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import type { MarkdownPredictor } from '@/services/MarkdownPredictor';
import type { CompletionSettings } from '@/services/CompletionSettings';
import {
  completionDocumentContextField,
  getCompletionDocumentContext,
} from '@/services/completion/document-context';
import type { CompletionMode, CompletionTextEdit } from '@/services/completion/types';
import { isDesktopRuntime } from './runtime';

// ---- Ghost Text Widget ----

const setGhostDecorations = StateEffect.define<DecorationSet>();
let editorSessionSequence = 0;

const ghostDecorationField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setGhostDecorations)) return effect.value;
    }
    return tr.docChanged ? value.map(tr.changes) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

class GhostTextWidget extends WidgetType {
  readonly text: string;

  constructor(text: string) {
    super();
    this.text = text;
  }

  override eq(other: GhostTextWidget): boolean {
    return this.text === other.text;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-ghost-text';
    span.textContent = this.text;
    span.setAttribute('aria-hidden', 'true');
    return span;
  }

  override ignoreEvent(): boolean {
    return true; // 不拦截任何事件
  }

  /** 估算 widget 的视觉宽度（字符数） */
  get estimatedLength(): number {
    return this.text.length;
  }
}

// ---- 防抖状态 ----

interface DebounceState {
  timer: ReturnType<typeof setTimeout> | null;
}

interface PendingAcceptedCompletion {
  token: string;
  context: string;
  text: string;
  from: number;
  to: number;
  learn: boolean;
}

function isUnmodifiedTab(event: KeyboardEvent): boolean {
  return !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
}

interface GhostDebugHost extends HTMLElement {
  __jotluckClearGhostText?: () => void;
  __jotluckSettlePendingAccepted?: () => void;
  __jotluckGetVisibleGhostPrediction?: () => ReturnType<MarkdownPredictor['getGhostText']>;
  __jotluckGetVisibleGhostDiagnostics?: () => {
    prediction: NonNullable<ReturnType<MarkdownPredictor['getGhostText']>>;
    elapsedMs: number;
    cursor: number;
    documentLength: number;
  } | null;
}

// ---- ViewPlugin ----

function createGhostTextPlugin(predictor: MarkdownPredictor, settings: CompletionSettings) {
  void settings;
  const debounce: DebounceState = { timer: null };

  return ViewPlugin.fromClass(
    class {
      /** 当前 ghost text 内容，用于 Tab 接受时获取 */
      currentGhostText: string = '';
      private currentPredictionLearnable = false;
      private currentContext = '';
      private currentPredictionCursor: number | null = null;
      private currentFeedbackToken: string | null = null;
      private currentPredictionResult: ReturnType<MarkdownPredictor['getGhostText']> = null;
      private currentPredictionEdit: CompletionTextEdit | null = null;
      private pendingAcceptedCompletion: PendingAcceptedCompletion | null = null;
      private visiblePredictionDiagnostics: ReturnType<
        NonNullable<GhostDebugHost['__jotluckGetVisibleGhostDiagnostics']>
      > = null;
      private predictionScheduledAt: number | null = null;
      private acceptingGhost = false;
      private editorInteractionActive = false;
      private suppressedGhostAt: { revision: number; cursor: number } | null = null;
      private decorationClearQueued = false;
      /** True during IME composition — skip prediction scheduling */
      private isComposing = false;
      private editorView: EditorView | null = null;
      private compositionPredictTimer: ReturnType<typeof setTimeout> | null = null;
      private predictionAbortController: AbortController | null = null;
      private activeRequestKey: string | null = null;
      private predictionEpoch = 0;
      private destroyed = false;
      private readonly editorSessionId = `editor-${++editorSessionSequence}`;
      // IME listener refs for cleanup in destroy()
      private __compStart: ((e: Event) => void) | null = null;
      private __compEnd: ((e: Event) => void) | null = null;
      private __focus: ((e: FocusEvent) => void) | null = null;
      private __blur: ((e: FocusEvent) => void) | null = null;
      private __keydown: ((e: KeyboardEvent) => void) | null = null;
      private __rootKeydown: ((e: Event) => void) | null = null;
      private __rootPointerdown: ((e: Event) => void) | null = null;
      private __editorPointerdown: ((e: PointerEvent) => void) | null = null;
      private __windowBlur: ((e: FocusEvent) => void) | null = null;

      constructor(view: EditorView) {
        this.editorView = view;
        (view.dom as GhostDebugHost).__jotluckClearGhostText = () => {
          this.clearPendingTimers();
          this.clearGhost(view, true, true);
        };
        (view.dom as GhostDebugHost).__jotluckSettlePendingAccepted = () =>
          this.settlePendingAcceptedAtBoundary(view);
        (view.dom as GhostDebugHost).__jotluckGetVisibleGhostPrediction = () =>
          this.currentPredictionResult;
        (view.dom as GhostDebugHost).__jotluckGetVisibleGhostDiagnostics = () =>
          this.visiblePredictionDiagnostics;

        // ── IME composition guard ────────────────────────────
        const onCompStart = () => {
          this.settlePendingAcceptedAtBoundary(view);
          this.isComposing = true;
          this.clearPendingTimers();
          this.clearGhost(view, true, true);
        };
        const onCompEnd = () => {
          this.isComposing = false;
          this.scheduleAfterComposition(view);
        };
        view.contentDOM.addEventListener('compositionstart', onCompStart, { passive: true });
        view.contentDOM.addEventListener('compositionend', onCompEnd, { passive: true });
        this.__compStart = onCompStart;
        this.__compEnd = onCompEnd;

        const onFocus = () => {
          this.editorInteractionActive = true;
          if (this.isImeActive(view)) return;
          this.schedulePredict(view);
        };
        const onBlur = () => {
          this.settlePendingAcceptedAtBoundary(view);
          this.editorInteractionActive = false;
          this.clearPendingTimers();
          this.clearGhost(view, true, true);
        };
        view.contentDOM.addEventListener('focus', onFocus);
        view.contentDOM.addEventListener('blur', onBlur);
        this.__focus = onFocus;
        this.__blur = onBlur;

        const onWindowBlur = () => {
          this.settlePendingAcceptedAtBoundary(view);
          this.editorInteractionActive = false;
          this.clearPendingTimers();
          this.clearGhost(view, true, true);
        };
        view.dom.ownerDocument.defaultView?.addEventListener('blur', onWindowBlur);
        this.__windowBlur = onWindowBlur;

        const onEditorPointerDown = () => {
          this.editorInteractionActive = true;
        };
        view.dom.addEventListener('pointerdown', onEditorPointerDown);
        this.__editorPointerdown = onEditorPointerDown;

        const onKeyDown = (event: KeyboardEvent) => {
          if (view.composing || view.compositionStarted || event.defaultPrevented) return;
          if (
            event.key === 'Tab' &&
            isUnmodifiedTab(event) &&
            this.canAcceptGhost(view, event.target)
          ) {
            event.preventDefault();
            this.acceptGhost(view, event.target);
          }
          if (event.key === 'Escape' && this.currentGhostText) {
            event.preventDefault();
            this.rejectGhost(view);
          }
        };
        view.dom.addEventListener('keydown', onKeyDown, { capture: true });
        this.__keydown = onKeyDown;

        const onRootPointerDown = (event: Event) => {
          const target = event.target;
          if (target instanceof Node && view.dom.contains(target)) return;
          this.settlePendingAcceptedAtBoundary(view);
          this.editorInteractionActive = false;
          this.clearPendingTimers();
          this.clearGhost(view, true, true);
        };
        (view.root as unknown as EventTarget).addEventListener('pointerdown', onRootPointerDown, {
          capture: true,
        });
        this.__rootPointerdown = onRootPointerDown;

        const onRootKeyDown = (event: Event) => {
          if (!(event instanceof KeyboardEvent)) return;
          if (view.composing || view.compositionStarted || event.defaultPrevented) return;
          if (
            event.key === 'Tab' &&
            isUnmodifiedTab(event) &&
            this.canAcceptGhost(view, event.target)
          ) {
            event.preventDefault();
            this.acceptGhost(view, event.target);
          }
          if (event.key === 'Escape' && this.canRejectGhost(view, event.target)) {
            event.preventDefault();
            this.rejectGhost(view);
          }
        };
        (view.root as unknown as EventTarget).addEventListener('keydown', onRootKeyDown, {
          capture: true,
        });
        this.__rootKeydown = onRootKeyDown;

        this.schedulePredict(view);
      }

      update(update: ViewUpdate) {
        if (this.acceptingGhost && update.docChanged) {
          this.clearPendingTimers();
          this.clearGhost(update.view, false);
          return;
        }
        if (update.docChanged && this.pendingAcceptedCompletion) {
          this.settlePendingAcceptedAfterChange(update);
        }
        // Skip during IME composition to avoid corrupting composition state
        if (this.isImeActive(update.view, update)) {
          this.clearPendingTimers();
          this.clearGhost(update.view, false);
          return;
        }
        if (update.focusChanged && !update.view.hasFocus) {
          this.settlePendingAcceptedAtBoundary(update.view);
          this.editorInteractionActive = false;
          this.clearPendingTimers();
          this.clearGhost(update.view, false);
          this.deferClearGhostDecorations(update.view);
          return;
        }
        const mainSelection = update.view.state.selection.main;
        const selectionInvalidatesGhost =
          update.selectionSet &&
          (!mainSelection.empty || mainSelection.head !== this.currentPredictionCursor);
        if (update.docChanged || selectionInvalidatesGhost) {
          // Backspace immediately after compositionend must cancel both the
          // normal debounce and the delayed composition prediction. Otherwise
          // two predictions race and reinsert/flicker a stale widget.
          this.clearPendingTimers();

          // 如果文档或选区变化 → 清除当前 ghost text
          this.suppressedGhostAt = null;
          this.clearGhost(update.view, false);
          this.deferClearGhostDecorations(update.view);

          // 防抖后重新预测
          this.schedulePredict(update.view);
        }
      }

      schedulePredict(view: EditorView) {
        if (this.isImeActive(view)) return;
        if (!view.state.selection.main.empty) return;
        const snapshot = getCompletionDocumentContext(view.state);
        const requestKey = `structured:${snapshot.documentRevision}:${snapshot.cursor}`;
        if (this.activeRequestKey === requestKey) return;
        if (debounce.timer) clearTimeout(debounce.timer);
        this.predictionScheduledAt = performance.now();
        void this.doPredict(view, 'structured', true);
      }

      private schedulePredictive(view: EditorView) {
        if (this.isImeActive(view)) return;
        if (debounce.timer) clearTimeout(debounce.timer);
        debounce.timer = setTimeout(() => {
          debounce.timer = null;
          void this.doPredict(view, 'predictive');
        }, 40);
      }

      async doPredict(view: EditorView, mode: CompletionMode, schedulePredictiveOnEmpty = false) {
        if (this.isImeActive(view)) {
          this.clearGhost(view);
          return;
        }
        const snapshot = getCompletionDocumentContext(view.state);
        const doc = snapshot.documentWindow.text;
        const cursor = snapshot.cursor;
        const documentRevision = snapshot.documentRevision;
        const requestKey = `${mode}:${documentRevision}:${cursor}`;
        const scheduledAt = this.predictionScheduledAt ?? performance.now();

        // 只有光标在文档末尾或单光标无选区时预测
        if (!view.state.selection.main.empty) {
          this.clearGhost(view);
          return;
        }

        if (
          this.suppressedGhostAt?.revision === documentRevision &&
          this.suppressedGhostAt.cursor === cursor
        ) {
          this.clearGhost(view);
          return;
        }
        this.predictionAbortController?.abort('superseded');
        const controller = new AbortController();
        this.predictionAbortController = controller;
        this.activeRequestKey = requestKey;
        const requestEpoch = ++this.predictionEpoch;
        let result: ReturnType<MarkdownPredictor['getGhostText']>;
        try {
          result =
            typeof predictor.requestGhostText === 'function'
              ? await predictor.requestGhostText(cursor, doc, {
                  signal: controller.signal,
                  deadlineMs: isDesktopRuntime() ? 80 : 110,
                  documentRevision,
                  documentVersion: `revision:${documentRevision}`,
                  editorSessionId: this.editorSessionId,
                  mode,
                  contextSnapshot: snapshot,
                })
              : predictor.getGhostText(cursor - snapshot.documentWindow.from, doc);
        } catch {
          if (this.predictionAbortController === controller) {
            this.predictionAbortController = null;
            this.activeRequestKey = null;
          }
          return;
        }
        // A synchronous structured provider may finish while CodeMirror is
        // still executing this plugin's update() callback. Cross one microtask
        // boundary before dispatching decorations, then re-check all stale
        // guards below. This keeps the structural plane immediate without
        // re-entering EditorView.update().
        await Promise.resolve();
        if (
          this.destroyed ||
          controller.signal.aborted ||
          requestEpoch !== this.predictionEpoch ||
          this.editorView !== view ||
          getCompletionDocumentContext(view.state).documentRevision !== documentRevision ||
          view.state.selection.main.head !== cursor ||
          !view.state.selection.main.empty ||
          !view.hasFocus ||
          this.isImeActive(view)
        ) {
          if (this.predictionAbortController === controller) {
            this.predictionAbortController = null;
            this.activeRequestKey = null;
          }
          return;
        }
        if (this.predictionAbortController === controller) {
          this.predictionAbortController = null;
          this.activeRequestKey = null;
        }
        if (result && result.text) {
          // BUG-030: 防止重复预测同一文本导致的预测级联
          if ((result.displayText ?? result.text) === this.currentGhostText) {
            const nextFeedbackToken = result.feedbackToken ?? null;
            if (this.currentFeedbackToken && this.currentFeedbackToken !== nextFeedbackToken) {
              predictor.abandonCompletion?.(this.currentFeedbackToken);
            }
            this.currentPredictionResult = result;
            this.currentPredictionEdit = result.edit ?? {
              from: result.from,
              to: result.to ?? result.from,
              insertText: result.insertText ?? result.text,
            };
            this.currentFeedbackToken = nextFeedbackToken;
            this.visiblePredictionDiagnostics = {
              prediction: result,
              elapsedMs: Math.max(0, performance.now() - scheduledAt),
              cursor,
              documentLength: view.state.doc.length,
            };
            return;
          }

          // When cursor is mid-line (not at end of text), the N-gram predictor
          // can match patterns spanning multiple lines, causing ghost text to
          // render on the WRONG line (typically the line below).
          // Guard: mid-line only shows STRUCTURED completions (format closure,
          // Wiki-link close, etc.) which have deterministic correctness.
          // N-gram predictions mid-line are suppressed to avoid false positives.
          const atEndOfLine = snapshot.atEndOfLine;
          const isStructured = result.source === 'structured';
          if (!atEndOfLine && !isStructured) return;

          const displayText = result.displayText ?? result.text;
          const edit = result.edit ?? {
            from: result.from,
            to: result.to ?? result.from,
            insertText: result.insertText ?? result.text,
          };
          const nextFeedbackToken = result.feedbackToken ?? null;
          if (this.currentFeedbackToken && this.currentFeedbackToken !== nextFeedbackToken) {
            predictor.abandonCompletion?.(this.currentFeedbackToken);
          }
          this.currentGhostText = displayText;
          this.currentPredictionEdit = edit;
          this.currentPredictionLearnable = result.learnable ?? result.source !== 'structured';
          this.currentContext = Array.from(snapshot.currentParagraph.text).slice(-4).join('');
          this.currentPredictionCursor = cursor;
          this.currentFeedbackToken = nextFeedbackToken;
          this.currentPredictionResult = result;
          view.dispatch({
            effects: setGhostDecorations.of(
              Decoration.set([
                Decoration.widget({
                  widget: new GhostTextWidget(displayText),
                  side: 1,
                }).range(cursor),
              ]),
            ),
          });
          this.visiblePredictionDiagnostics = {
            prediction: result,
            elapsedMs: Math.max(0, performance.now() - scheduledAt),
            cursor,
            documentLength: view.state.doc.length,
          };
        } else {
          this.clearGhost(view);
          if (mode === 'structured' && schedulePredictiveOnEmpty) {
            this.schedulePredictive(view);
          }
        }
      }

      clearGhost(view: EditorView, shouldDispatch = true, forceDispatch = false) {
        const currentDecorations = view.state.field(ghostDecorationField, false);
        const hasRenderedGhost = Boolean(currentDecorations?.size);
        const shouldClearDecorations = forceDispatch || this.currentGhostText || hasRenderedGhost;

        const feedbackToken = this.currentFeedbackToken;
        this.currentGhostText = '';
        this.currentPredictionLearnable = false;
        this.currentContext = '';
        this.currentPredictionCursor = null;
        this.currentFeedbackToken = null;
        this.currentPredictionResult = null;
        this.currentPredictionEdit = null;
        this.visiblePredictionDiagnostics = null;
        this.predictionScheduledAt = null;
        if (feedbackToken) predictor.abandonCompletion?.(feedbackToken);

        if (shouldDispatch && shouldClearDecorations) {
          view.dispatch({ effects: setGhostDecorations.of(Decoration.none) });
        }
      }

      private settlePendingAcceptedAfterChange(update: ViewUpdate): void {
        const pending = this.pendingAcceptedCompletion;
        if (!pending) return;
        let overlapsAcceptedRange = false;
        update.changes.iterChangedRanges((fromA, toA) => {
          if (fromA === toA) {
            if (fromA > pending.from && fromA < pending.to) overlapsAcceptedRange = true;
            return;
          }
          if (fromA < pending.to && toA > pending.from) overlapsAcceptedRange = true;
        });

        const mappedFrom = update.changes.mapPos(pending.from, -1);
        const mappedTo = update.changes.mapPos(pending.to, 1);
        const exactTextRetained =
          mappedFrom >= 0 &&
          mappedFrom + pending.text.length <= update.state.doc.length &&
          update.state.doc.sliceString(mappedFrom, mappedFrom + pending.text.length) ===
            pending.text;
        this.pendingAcceptedCompletion = null;

        if (overlapsAcceptedRange) {
          const wasUndo = update.transactions.some((transaction) =>
            transaction.isUserEvent('undo'),
          );
          const remaining = update.state.doc.sliceString(
            Math.max(0, mappedFrom),
            Math.max(Math.max(0, mappedFrom), Math.min(update.state.doc.length, mappedTo)),
          );
          if (wasUndo || (!exactTextRetained && remaining.length === 0)) {
            predictor.revertAcceptedCompletion?.(pending.token);
          } else {
            predictor.modifyAcceptedCompletion?.(pending.token);
          }
          return;
        }

        if (exactTextRetained) {
          predictor.retainCompletion?.(pending.context, pending.text, {
            learn: pending.learn,
            feedbackToken: pending.token,
          });
        } else {
          predictor.modifyAcceptedCompletion?.(pending.token);
        }
      }

      private settlePendingAcceptedAtBoundary(view: EditorView): void {
        const pending = this.pendingAcceptedCompletion;
        if (!pending) return;
        this.pendingAcceptedCompletion = null;
        const exactTextRetained =
          pending.from >= 0 &&
          pending.to <= view.state.doc.length &&
          view.state.doc.sliceString(pending.from, pending.to) === pending.text;
        if (exactTextRetained) {
          predictor.retainCompletion?.(pending.context, pending.text, {
            learn: pending.learn,
            feedbackToken: pending.token,
          });
          return;
        }
        const remaining = view.state.doc.sliceString(
          Math.max(0, Math.min(pending.from, view.state.doc.length)),
          Math.max(0, Math.min(pending.to, view.state.doc.length)),
        );
        if (remaining.length === 0) predictor.revertAcceptedCompletion?.(pending.token);
        else predictor.modifyAcceptedCompletion?.(pending.token);
      }

      private isImeActive(view: EditorView, update?: ViewUpdate): boolean {
        void update;
        return this.isComposing || view.composing || view.compositionStarted;
      }

      canAcceptGhost(view: EditorView, eventTarget?: EventTarget | null): boolean {
        if (!this.currentGhostText) return false;
        if (this.isImeActive(view)) return false;
        if (!view.state.selection.main.empty) return false;
        if (this.currentPredictionCursor !== view.state.selection.main.head) return false;

        const activeElement = view.root.activeElement;
        const editorHasDomFocus =
          activeElement === view.contentDOM ||
          (activeElement instanceof Node && view.contentDOM.contains(activeElement));
        if (
          eventTarget &&
          (!(eventTarget instanceof Node) || !view.contentDOM.contains(eventTarget))
        ) {
          return false;
        }
        return view.hasFocus || editorHasDomFocus;
      }

      canRejectGhost(view: EditorView, eventTarget?: EventTarget | null): boolean {
        if (!this.currentGhostText) return false;
        if (this.isImeActive(view)) return false;

        const activeElement = view.root.activeElement;
        const activeElementInModal =
          activeElement instanceof Element && !!activeElement.closest('.modal-overlay');
        if (activeElementInModal) return false;

        const editorHasDomFocus =
          activeElement === view.contentDOM ||
          (activeElement instanceof Node && view.dom.contains(activeElement));
        const eventCameFromEditor = eventTarget instanceof Node && view.dom.contains(eventTarget);

        return (
          view.hasFocus || editorHasDomFocus || eventCameFromEditor || this.editorInteractionActive
        );
      }

      private clearPendingTimers(): void {
        this.predictionEpoch += 1;
        if (this.predictionAbortController) {
          this.predictionAbortController.abort('cancelled');
          this.predictionAbortController = null;
        }
        this.activeRequestKey = null;
        if (debounce.timer) {
          clearTimeout(debounce.timer);
          debounce.timer = null;
        }
        if (this.compositionPredictTimer) {
          clearTimeout(this.compositionPredictTimer);
          this.compositionPredictTimer = null;
        }
        this.predictionScheduledAt = null;
      }

      private deferClearGhostDecorations(view: EditorView): void {
        if (this.decorationClearQueued) return;
        this.decorationClearQueued = true;
        queueMicrotask(() => {
          this.decorationClearQueued = false;
          if (this.destroyed || this.editorView !== view) return;
          view.dispatch({ effects: setGhostDecorations.of(Decoration.none) });
        });
      }

      private scheduleAfterComposition(view: EditorView): void {
        this.clearPendingTimers();
        this.compositionPredictTimer = setTimeout(() => {
          this.compositionPredictTimer = null;
          if (this.isImeActive(view)) return;
          this.schedulePredict(view);
        }, 80);
      }

      /** 接受当前 ghost text */
      acceptGhost(view: EditorView, eventTarget?: EventTarget | null): boolean {
        if (!this.canAcceptGhost(view, eventTarget)) return false;

        const cursor = view.state.selection.main.head;
        const edit = this.currentPredictionEdit ?? {
          from: cursor,
          to: cursor,
          insertText: this.currentGhostText,
        };
        if (edit.from < 0 || edit.to < edit.from || edit.to > view.state.doc.length) return false;
        const text = edit.insertText;
        const predictionLearnable = this.currentPredictionLearnable;
        const feedbackToken = this.currentFeedbackToken;
        const snapshot = getCompletionDocumentContext(view.state);
        const ctx =
          this.currentContext || Array.from(snapshot.currentParagraph.text).slice(-4).join('');

        // Clear plugin state before dispatch: dispatch synchronously triggers
        // update(), and stale ghost state can otherwise re-enter prediction.
        this.clearPendingTimers();
        this.acceptingGhost = true;
        this.suppressedGhostAt = null;
        this.currentGhostText = '';
        this.currentPredictionLearnable = false;
        this.currentContext = '';
        this.currentPredictionCursor = null;
        this.currentFeedbackToken = null;
        this.currentPredictionResult = null;
        this.currentPredictionEdit = null;
        this.visiblePredictionDiagnostics = null;

        // V2.2: the edit is the sole authoritative body mutation.
        view.dispatch({
          changes: { from: edit.from, to: edit.to, insert: text },
          selection: { anchor: edit.from + text.length },
          annotations: isolateHistory.of('full'),
          effects: setGhostDecorations.of(Decoration.none),
        });
        this.acceptingGhost = false;

        // Structured completions are deterministic editor assistance, not user prose.
        // Feeding them into N-gram creates loops such as `**` -> `********`.
        predictor.acceptCompletion(ctx, text, {
          learn: predictionLearnable,
          feedbackToken: feedbackToken ?? undefined,
        });
        if (feedbackToken) {
          this.pendingAcceptedCompletion = {
            token: feedbackToken,
            context: ctx,
            text,
            from: edit.from,
            to: edit.from + text.length,
            learn: predictionLearnable,
          };
        }

        return true;
      }

      /** Escape 拒绝 */
      rejectGhost(view: EditorView): boolean {
        if (!this.currentGhostText) return false;

        const cursor = view.state.selection.main.head;
        const snapshot = getCompletionDocumentContext(view.state);
        const ctx =
          this.currentContext || Array.from(snapshot.currentParagraph.text).slice(-4).join('');
        const predictionLearnable = this.currentPredictionLearnable;
        const feedbackToken = this.currentFeedbackToken;
        const rejectedText = this.currentPredictionEdit?.insertText ?? this.currentGhostText;

        this.clearPendingTimers();
        this.suppressedGhostAt = { revision: snapshot.documentRevision, cursor };
        predictor.rejectCompletion(ctx, rejectedText, {
          learn: predictionLearnable,
          feedbackToken: feedbackToken ?? undefined,
        });
        this.clearGhost(view);
        return true;
      }

      destroy() {
        this.destroyed = true;
        this.clearPendingTimers();
        if (this.editorView) {
          this.settlePendingAcceptedAtBoundary(this.editorView);
          // destroy() runs inside the transaction that removes this plugin.
          // Dispatching here re-enters CodeMirror while it is still updating.
          // The compartment removal already removes ghostDecorationField, so
          // only clear the plugin-owned state and let the outer transaction
          // dispose the decorations.
          this.clearGhost(this.editorView, false);
          delete (this.editorView.dom as GhostDebugHost).__jotluckClearGhostText;
          delete (this.editorView.dom as GhostDebugHost).__jotluckSettlePendingAccepted;
          delete (this.editorView.dom as GhostDebugHost).__jotluckGetVisibleGhostPrediction;
          delete (this.editorView.dom as GhostDebugHost).__jotluckGetVisibleGhostDiagnostics;
          const dom = this.editorView.contentDOM;
          if (this.__compStart) dom.removeEventListener('compositionstart', this.__compStart);
          if (this.__compEnd) dom.removeEventListener('compositionend', this.__compEnd);
          if (this.__focus) dom.removeEventListener('focus', this.__focus);
          if (this.__blur) dom.removeEventListener('blur', this.__blur);
          if (this.__windowBlur) {
            this.editorView.dom.ownerDocument.defaultView?.removeEventListener(
              'blur',
              this.__windowBlur,
            );
          }
          if (this.__editorPointerdown) {
            this.editorView.dom.removeEventListener('pointerdown', this.__editorPointerdown);
          }
          if (this.__keydown) {
            this.editorView.dom.removeEventListener('keydown', this.__keydown, { capture: true });
          }
          if (this.__rootPointerdown) {
            (this.editorView.root as unknown as EventTarget).removeEventListener(
              'pointerdown',
              this.__rootPointerdown,
              {
                capture: true,
              },
            );
          }
          if (this.__rootKeydown) {
            (this.editorView.root as unknown as EventTarget).removeEventListener(
              'keydown',
              this.__rootKeydown,
              {
                capture: true,
              },
            );
          }
          this.editorInteractionActive = false;
          this.suppressedGhostAt = null;
          this.decorationClearQueued = false;
          this.editorView = null;
        }
      }
    },
  );
}

// ---- Tab / Escape keymap ----

function ghostTextKeymap(pluginSpec: ReturnType<typeof createGhostTextPlugin>) {
  return Prec.highest(
    keymap.of([
      {
        key: 'Tab',
        run: (view) => {
          if (view.composing || view.compositionStarted) return false;
          const plugin = view.plugin(pluginSpec);
          if (!plugin) return false;
          // Accept Tab only when the editor owns focus and the current cursor has
          // a visible ghost text. Otherwise native focus navigation must win.
          if (plugin.canAcceptGhost(view)) {
            return plugin.acceptGhost(view);
          }
          // 否则回退默认行为
          return false;
        },
      },
      {
        key: 'Escape',
        run: (view) => {
          if (view.composing || view.compositionStarted) return false;
          const plugin = view.plugin(pluginSpec);
          if (!plugin) return false;
          if (plugin.currentGhostText) {
            return plugin.rejectGhost(view);
          }
          return false;
        },
      },
    ]),
  );
}

// ---- 导出 ----

export function ghostTextPlugin(
  predictor: MarkdownPredictor,
  settings: CompletionSettings,
): Extension[] {
  const plugin = createGhostTextPlugin(predictor, settings);
  return [
    completionDocumentContextField,
    ghostDecorationField,
    plugin,
    ghostTextKeymap(plugin),
    // DOM-level Tab/Escape intercept as belt-and-suspenders:
    // keymap priority is registration-order dependent and can be defeated
    // by indentWithTab from defaultKeymap in some CM6 configurations.
    // domEventHandlers fires BEFORE any keymap.
    EditorView.domEventHandlers({
      keydown: (event, view) => {
        const p = view.plugin(plugin);
        if (!p) return false;
        // Don't intercept Tab/Escape during IME composition — let the
        // IME consume these keys (e.g. confirm/cancel candidate window).
        // Intercepting would accept/reject ghost text and corrupt the
        // composition state (BUG-032, BUG-036).
        if (view.composing || view.compositionStarted) {
          return false;
        }
        if (event.key === 'Tab' && isUnmodifiedTab(event) && p.canAcceptGhost(view, event.target)) {
          const target = event.target;
          if (target instanceof Node && !view.contentDOM.contains(target)) return false;
          event.preventDefault();
          return p.acceptGhost(view, event.target);
        }
        if (event.key === 'Escape' && p.currentGhostText) {
          event.preventDefault();
          return p.canRejectGhost(view, event.target) ? p.rejectGhost(view) : false;
        }
        return false;
      },
    }),
  ];
}
