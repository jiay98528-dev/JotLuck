/**
 * cm6-ghost-text — CodeMirror 6 Ghost Text 补全插件
 *
 * 统一幽灵文本管道：150ms 防抖触发预测 → Decoration.widget 渲染 → Tab 接受
 * 语法上下文检测内置于 MarkdownPredictor 服务层。
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
import { StateEffect, StateField, type Extension } from '@codemirror/state';
import type { MarkdownPredictor } from '@/services/MarkdownPredictor';
import type { CompletionSettings } from '@/services/CompletionSettings';

// ---- Ghost Text Widget ----

const setGhostDecorations = StateEffect.define<DecorationSet>();

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

// ---- ViewPlugin ----

function createGhostTextPlugin(predictor: MarkdownPredictor, settings: CompletionSettings) {
  const debounce: DebounceState = { timer: null };

  return ViewPlugin.fromClass(
    class {
      /** 当前 ghost text 内容，用于 Tab 接受时获取 */
      currentGhostText: string = '';
      private currentPredictionSource: 'ngram' | 'structured' | null = null;
      private currentContext = '';
      private acceptingGhost = false;
      /** True during IME composition — skip prediction scheduling */
      private isComposing = false;
      private editorView: EditorView | null = null;
      private compositionPredictTimer: ReturnType<typeof setTimeout> | null = null;
      // IME listener refs for cleanup in destroy()
      private __compStart: ((e: Event) => void) | null = null;
      private __compEnd: ((e: Event) => void) | null = null;

      constructor(view: EditorView) {
        this.editorView = view;

        // ── IME composition guard ────────────────────────────
        const onCompStart = () => {
          this.isComposing = true;
          this.clearPendingTimers();
          this.clearGhost(view);
        };
        const onCompEnd = () => {
          this.isComposing = false;
          this.scheduleAfterComposition(view);
        };
        view.contentDOM.addEventListener('compositionstart', onCompStart, { passive: true });
        view.contentDOM.addEventListener('compositionend', onCompEnd, { passive: true });
        this.__compStart = onCompStart;
        this.__compEnd = onCompEnd;

        this.schedulePredict(view);
      }

      update(update: ViewUpdate) {
        // Skip during IME composition to avoid corrupting composition state
        if (this.isImeActive(update.view, update)) {
          this.clearPendingTimers();
          this.clearGhost(update.view, false);
          return;
        }
        if (update.docChanged || update.selectionSet) {
          // Backspace immediately after compositionend must cancel both the
          // normal debounce and the delayed composition prediction. Otherwise
          // two predictions race and reinsert/flicker a stale widget.
          this.clearPendingTimers();

          // 如果文档或选区变化 → 清除当前 ghost text
          this.recordMismatch(update);
          if (this.currentGhostText) {
            this.currentGhostText = '';
            this.currentPredictionSource = null;
            this.currentContext = '';
            update.view.dispatch({ effects: setGhostDecorations.of(Decoration.none) });
          }

          // 150ms 防抖后重新预测
          this.schedulePredict(update.view);
        }
      }

      schedulePredict(view: EditorView) {
        if (this.isImeActive(view)) return;
        debounce.timer = setTimeout(
          () => {
            debounce.timer = null;
            this.doPredict(view);
          },
          settings.aggressiveness === 'balanced' ? 120 : 150,
        );
      }

      doPredict(view: EditorView) {
        if (this.isImeActive(view)) {
          this.clearGhost(view);
          return;
        }
        const doc = view.state.doc.toString();
        const cursor = view.state.selection.main.head;

        // 只有光标在文档末尾或单光标无选区时预测
        if (!view.state.selection.main.empty) {
          this.clearGhost(view);
          return;
        }

        const result = predictor.getGhostText(cursor, doc);
        if (result && result.text) {
          // BUG-030: 防止重复预测同一文本导致的预测级联
          if (result.text === this.currentGhostText) return;

          // When cursor is mid-line (not at end of text), the N-gram predictor
          // can match patterns spanning multiple lines, causing ghost text to
          // render on the WRONG line (typically the line below).
          // Guard: mid-line only shows STRUCTURED completions (format closure,
          // Wiki-link close, etc.) which have deterministic correctness.
          // N-gram predictions mid-line are suppressed to avoid false positives.
          const atEndOfLine = cursor === doc.length || doc[cursor] === '\n';
          const isStructured = result.source === 'structured';
          if (!atEndOfLine && !isStructured) return;

          this.currentGhostText = result.text;
          this.currentPredictionSource = result.source ?? 'ngram';
          this.currentContext = doc.slice(Math.max(0, cursor - 4), cursor);
          view.dispatch({
            effects: setGhostDecorations.of(
              Decoration.set([
                Decoration.widget({
                  widget: new GhostTextWidget(result.text),
                  side: 1,
                }).range(cursor),
              ]),
            ),
          });
        } else {
          this.clearGhost(view);
        }
      }

      clearGhost(view: EditorView, shouldDispatch = true) {
        if (this.currentGhostText) {
          this.currentGhostText = '';
          this.currentPredictionSource = null;
          this.currentContext = '';
          if (shouldDispatch) view.dispatch({ effects: setGhostDecorations.of(Decoration.none) });
        }
      }

      private isImeActive(view: EditorView, update?: ViewUpdate): boolean {
        void view;
        void update;
        return this.isComposing;
      }

      private clearPendingTimers(): void {
        if (debounce.timer) {
          clearTimeout(debounce.timer);
          debounce.timer = null;
        }
        if (this.compositionPredictTimer) {
          clearTimeout(this.compositionPredictTimer);
          this.compositionPredictTimer = null;
        }
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
      acceptGhost(view: EditorView): boolean {
        if (!this.currentGhostText) return false;

        const cursor = view.state.selection.main.head;
        const text = this.currentGhostText;
        const predictionSource = this.currentPredictionSource;
        const doc = view.state.doc.toString();
        const ctx = this.currentContext || doc.slice(Math.max(0, cursor - 4), cursor);

        // Clear plugin state before dispatch: dispatch synchronously triggers
        // update(), and stale ghost state can otherwise re-enter prediction.
        this.clearPendingTimers();
        this.acceptingGhost = true;
        this.currentGhostText = '';
        this.currentPredictionSource = null;
        this.currentContext = '';

        // 插入 ghost text
        view.dispatch({
          changes: { from: cursor, insert: text },
          selection: { anchor: cursor + text.length },
        });
        this.acceptingGhost = false;

        // Structured completions are deterministic editor assistance, not user prose.
        // Feeding them into N-gram creates loops such as `**` -> `********`.
        if (predictionSource !== 'structured') {
          predictor.acceptCompletion(ctx, text);
        }

        return true;
      }

      /** Escape 拒绝 */
      rejectGhost(view: EditorView): boolean {
        if (!this.currentGhostText) return false;

        const cursor = view.state.selection.main.head;
        const doc = view.state.doc.toString();
        const ctx = this.currentContext || doc.slice(Math.max(0, cursor - 4), cursor);

        predictor.rejectCompletion(ctx, this.currentGhostText);
        this.clearGhost(view);
        return true;
      }

      private recordMismatch(update: ViewUpdate): void {
        if (
          this.acceptingGhost ||
          !update.docChanged ||
          !this.currentGhostText ||
          this.currentPredictionSource === 'structured'
        ) {
          return;
        }
        const inserted: string[] = [];
        for (const tr of update.transactions) {
          tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, text) => {
            inserted.push(text.toString());
          });
        }
        const typed = inserted.join('');
        if (typed && !this.currentGhostText.startsWith(typed)) {
          predictor.rejectCompletion(this.currentContext, this.currentGhostText);
        }
      }

      destroy() {
        this.clearPendingTimers();
        if (this.editorView) {
          const dom = this.editorView.contentDOM;
          if (this.__compStart) dom.removeEventListener('compositionstart', this.__compStart);
          if (this.__compEnd) dom.removeEventListener('compositionend', this.__compEnd);
          this.editorView = null;
        }
      }
    },
  );
}

// ---- Tab / Escape keymap ----

function ghostTextKeymap(pluginSpec: ReturnType<typeof createGhostTextPlugin>) {
  return keymap.of([
    {
      key: 'Tab',
      run: (view) => {
        if (view.composing || view.compositionStarted) return false;
        const plugin = view.plugin(pluginSpec);
        if (!plugin) return false;
        // 如果有 ghost text → 接受
        if (plugin.currentGhostText) {
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
  ]);
}

// ---- 导出 ----

export function ghostTextPlugin(
  predictor: MarkdownPredictor,
  settings: CompletionSettings,
): Extension[] {
  const plugin = createGhostTextPlugin(predictor, settings);
  return [
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
        if (event.key === 'Tab' && p.currentGhostText) {
          event.preventDefault();
          return p.acceptGhost(view);
        }
        if (event.key === 'Escape' && p.currentGhostText) {
          event.preventDefault();
          return p.rejectGhost(view);
        }
        return false;
      },
    }),
  ];
}
