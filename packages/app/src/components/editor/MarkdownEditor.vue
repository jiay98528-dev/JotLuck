<template>
  <div ref="editorHost" class="markdown-editor" />
</template>

<script setup lang="ts">
/**
 * MarkdownEditor.vue — CodeMirror 6 编辑器封装
 *
 * 纸张主题。支持 v-model、块解析、拖放/粘贴回调。
 * 暴露 getEditorView() 和 focus() 供父组件调用。
 *
 * @see migration-map.md §1.2
 */
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { EditorView, lineNumbers, keymap } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { jotluckExtensions } from '@/utils/cm6-extensions';
import { livePreviewExtension, unpinFocusedBlock } from '@/utils/cm6-live-preview';
import { ghostTextPlugin } from '@/utils/cm6-ghost-text';
import { MarkdownPredictor } from '@/services/MarkdownPredictor';
import { getCompletionSettings, type CompletionSettings } from '@/services/CompletionSettings';
import type { FormatAction, MarkdownBlock, ParagraphPreset } from '@/types';
import {
  applyParagraphPreset,
  getInlineMarkers,
  isInlineFormatAction,
} from '@/utils/markdown-formatting';
import { getJotLuckE2EBridge } from '@/utils/e2e-bridge';
import { flushCompletionStorageMutations } from '@/services/completion/learning-repository';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    blocks?: MarkdownBlock[];
    readOnly?: boolean;
    showLineNumbers?: boolean;
    livePreview?: boolean;
    sourceOnly?: boolean;
    pendingFormat?: FormatAction | null;
    placeholder?: string;
    enableAutocomplete?: boolean;
    completionSettings?: CompletionSettings;
    /** Workspace-owned predictor. Passing it keeps L3/L2 alive across keyed editor remounts. */
    predictor?: MarkdownPredictor;
    onLivePreviewExternalLinkClick?: (href: string) => void;
    onLivePreviewTagClick?: (tag: string) => void;
    onLivePreviewWikiLinkClick?: (note: string, anchor: null | string) => void;
    wikiLinkExists?: (note: string) => boolean;
    wikiLinkRevision?: number;
    onEditorDrop?: (event: DragEvent) => void;
    onEditorDragOver?: (event: DragEvent) => void;
    onEditorPaste?: (event: ClipboardEvent) => boolean | void | Promise<boolean>;
  }>(),
  {
    blocks: () => [],
    readOnly: false,
    showLineNumbers: false,
    livePreview: false,
    sourceOnly: false,
    pendingFormat: null,
    placeholder: '开始书写…',
    enableAutocomplete: true,
    completionSettings: undefined,
    predictor: undefined,
    onLivePreviewExternalLinkClick: undefined,
    onLivePreviewTagClick: undefined,
    onLivePreviewWikiLinkClick: undefined,
    wikiLinkExists: undefined,
    wikiLinkRevision: 0,
    onEditorDrop: undefined,
    onEditorDragOver: undefined,
    onEditorPaste: undefined,
  },
);

const lineNumberCompartment = new Compartment();
const livePreviewCompartment = new Compartment();
const autocompleteCompartment = new Compartment();

// NotebookHome owns the predictor in the product path. The fallback keeps the
// component independently mountable in unit tests and isolated previews.
const ownsPredictor = props.predictor === undefined;
const predictor = props.predictor ?? new MarkdownPredictor(4);

const emit = defineEmits<{
  'update:modelValue': [value: string];
  'blocks-updated': [blocks: MarkdownBlock[]];
  'selection-change': [sel: { from: number; to: number } | null];
  'pending-format-ended': [];
}>();

const editorHost = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;
let suppressSync = false; // guard against feedback loop: watch → dispatch → updateListener → emit
const internallyEmittedValues = new Set<string>();
let activePendingAction: FormatAction | null = null;
let pendingInlineMarkers: readonly [string, string] | null = null;
let deferredPendingAction: FormatAction | null = null;
let scanOpenedDocumentTimer: ReturnType<typeof setTimeout> | null = null;
let scanPausedForComposition = false;

function currentCompletionSettings(): CompletionSettings {
  return props.completionSettings ?? getCompletionSettings();
}

function isAutocompleteScanEnabled(): boolean {
  const settings = currentCompletionSettings();
  return props.enableAutocomplete !== false && settings.enabled;
}

function clearOpenedDocumentScanTimer(): void {
  if (!scanOpenedDocumentTimer) return;
  clearTimeout(scanOpenedDocumentTimer);
  scanOpenedDocumentTimer = null;
}

function refreshOpenedDocumentScan(text?: string): void {
  if (!isAutocompleteScanEnabled()) return;
  predictor.scanOpenedDocument(text ?? view?.state.doc.toString() ?? '');
}

function scheduleOpenedDocumentScan(editorView: EditorView | null = view): void {
  if (!editorView || !isAutocompleteScanEnabled()) return;
  if (scanPausedForComposition || editorView.composing || editorView.compositionStarted) return;
  clearOpenedDocumentScanTimer();
  scanOpenedDocumentTimer = setTimeout(() => {
    scanOpenedDocumentTimer = null;
    if (!view || scanPausedForComposition || view.composing || view.compositionStarted) return;
    refreshOpenedDocumentScan(view.state.doc.toString());
  }, 400);
}

function autocompleteExtensions() {
  const settings = currentCompletionSettings();
  predictor.configure(settings);
  return props.enableAutocomplete !== false && settings.enabled
    ? ghostTextPlugin(predictor, settings)
    : [];
}

// E2E content reader — registered in onMounted (NOT setup!) because Vue 3 :key patching
// runs setup before old component's onUnmounted, causing old unmount to delete new registration.
// @see BUG-027, memory/bug_log.md
const getEditorContentFn = () => view?.state.doc.toString() ?? '';
const INSTANCE_ID = Math.random().toString(36).slice(2, 8);

function registerE2EEditorBridge(): void {
  const e2eBridge = getJotLuckE2EBridge();
  if (!e2eBridge || !view) return;
  e2eBridge.editor = {
    id: INSTANCE_ID,
    getContent: getEditorContentFn,
    setContent: (content) => {
      if (!view) return;
      (
        view.dom as HTMLElement & { __jotluckClearGhostText?: () => void }
      ).__jotluckClearGhostText?.();
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
        selection: { anchor: content.length },
      });
      emit('update:modelValue', view.state.doc.toString());
      refreshOpenedDocumentScan(content);
      view.focus();
    },
    getCursor: () => view?.state.selection.main.head ?? 0,
    getPrediction: () => {
      if (!view) return null;
      return (
        (
          view.dom as HTMLElement & {
            __jotluckGetVisibleGhostPrediction?: () => ReturnType<
              MarkdownPredictor['getGhostText']
            >;
          }
        ).__jotluckGetVisibleGhostPrediction?.() ?? null
      );
    },
    getVisiblePredictionDiagnostics: () => {
      if (!view) return null;
      return (
        (
          view.dom as HTMLElement & {
            __jotluckGetVisibleGhostDiagnostics?: () => {
              prediction: NonNullable<ReturnType<MarkdownPredictor['getGhostText']>>;
              elapsedMs: number;
              cursor: number;
              documentLength: number;
            } | null;
          }
        ).__jotluckGetVisibleGhostDiagnostics?.() ?? null
      );
    },
    requestCompletionDiagnostics: (content, cursorOffset = content.length, deadlineMs = 110) =>
      predictor.requestGhostTextWithDiagnostics(cursorOffset, content, { deadlineMs }),
    seedCompletionCorpus: (excerpts) => {
      // N2 intentionally requires cross-document support. Mirror two distinct
      // notebook files per excerpt instead of inflating one synthetic file.
      excerpts.forEach((excerpt, index) => {
        predictor.replaceDocumentContribution(`__e2e_seed__/${index}-a.md`, excerpt);
        predictor.replaceDocumentContribution(`__e2e_seed__/${index}-b.md`, excerpt);
      });
    },
    seedWorkspaceDocuments: async (documents) => {
      // Independent workspace evaluation provides distinct support documents.
      // Reset first so legacy exact-copy fixtures cannot leak into the result.
      predictor.resetNotebookContributions();
      for (const document of documents) {
        predictor.replaceDocumentContribution(document.path, document.content);
      }
      await predictor.flushHybridRetrievalMutations();
    },
    getHybridRetrievalHealth: () => predictor.getHybridRetrievalHealth(),
    seedPersonalCompletion: async (context, acceptedText) => {
      // Reset the last-candidate metadata through the requested L2-only probe,
      // then record the explicit acceptance exactly as the product path does.
      predictor.getGhostText(context.length, context);
      predictor.acceptCompletion(context, acceptedText, { learn: true });
      await flushCompletionStorageMutations();
    },
    setCompletionAblationMode: (mode) => predictor.setAblationMode(mode),
  };
}

function createState(doc: string) {
  return EditorState.create({
    doc,
    extensions: [
      // Ghost text keymap must precede defaultKeymap (indentWithTab) so Tab
      // is intercepted for ghost text acceptance before indentation logic.
      autocompleteCompartment.of(autocompleteExtensions()),
      keymap.of([{ key: 'Enter', run: handlePendingFormatEnter }]),
      ...jotluckExtensions(props.placeholder, props.sourceOnly),
      lineNumberCompartment.of(props.showLineNumbers ? lineNumbers() : []),
      livePreviewCompartment.of(
        props.livePreview
          ? livePreviewExtension({
              onExternalLinkClick: props.onLivePreviewExternalLinkClick,
              onTagClick: props.onLivePreviewTagClick,
              onWikiLinkClick: props.onLivePreviewWikiLinkClick,
              wikiLinkExists: props.wikiLinkExists,
            })
          : [],
      ),
      keymap.of([
        {
          key: 'Escape',
          run: (v) => {
            // Don't unpin blocks during IME composition — let the IME
            // consume Escape (e.g. cancel candidate window) first.
            if (v.composing || v.compositionStarted) return false;
            return props.livePreview ? unpinFocusedBlock(v) : false;
          },
        },
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !suppressSync) {
          const value = update.state.doc.toString();
          internallyEmittedValues.add(value);
          if (internallyEmittedValues.size > 32) {
            const oldest = internallyEmittedValues.values().next().value;
            if (oldest !== undefined) internallyEmittedValues.delete(oldest);
          }
          emit('update:modelValue', value);
          scheduleOpenedDocumentScan(update.view);
        }
      }),
    ],
  });
}

function finishPendingInline(): void {
  if (!view || !pendingInlineMarkers) return;
  const [open, close] = pendingInlineMarkers;
  const cursor = view.state.selection.main.head;
  const doc = view.state.doc.toString();
  if (doc.slice(cursor, cursor + close.length) !== close) return;

  if (doc.slice(cursor - open.length, cursor) === open) {
    view.dispatch({
      changes: { from: cursor - open.length, to: cursor + close.length, insert: '' },
      selection: { anchor: cursor - open.length },
    });
  } else {
    view.dispatch({ selection: { anchor: cursor + close.length } });
  }
}

function applyPendingFormat(action: FormatAction | null): void {
  if (!view) return;

  // BUG-052: @mousedown.prevent on toolbar buttons keeps the editor focused
  // while IME is composing.  Dispatching document changes during active
  // composition corrupts the IME transaction → first character after format
  // is swallowed.  Defer until compositionend.
  if (view.composing || view.compositionStarted) {
    deferredPendingAction = action;
    return;
  }

  if (activePendingAction && pendingInlineMarkers) finishPendingInline();

  activePendingAction = action === 'clear' ? null : action;
  pendingInlineMarkers = null;
  if (!activePendingAction) {
    view.focus();
    return;
  }

  const cursor = view.state.selection.main.head;
  if (isInlineFormatAction(activePendingAction)) {
    const [open, close] = getInlineMarkers(activePendingAction);
    view.dispatch({
      changes: { from: cursor, to: cursor, insert: `${open}${close}` },
      selection: { anchor: cursor + open.length },
    });
    pendingInlineMarkers = [open, close];
  } else {
    const preset = activePendingAction as ParagraphPreset;
    const edit = applyParagraphPreset(view.state.doc.toString(), cursor, cursor, preset, true);
    view.dispatch({ changes: edit.changes, selection: edit.selection });
  }
  view.focus();
}

function handlePendingFormatEnter(editorView: EditorView): boolean {
  if (!activePendingAction) return false;
  if (editorView.composing || editorView.compositionStarted) return false;

  const cursor = editorView.state.selection.main.head;
  const [open, close] = pendingInlineMarkers ?? ['', ''];
  const hasClose =
    close.length > 0 && editorView.state.doc.sliceString(cursor, cursor + close.length) === close;
  const hasOpen =
    open.length > 0 && editorView.state.doc.sliceString(cursor - open.length, cursor) === open;
  if (hasOpen && hasClose) {
    editorView.dispatch({
      changes: { from: cursor - open.length, to: cursor + close.length, insert: '\n' },
      selection: { anchor: cursor - open.length + 1 },
    });
    activePendingAction = null;
    pendingInlineMarkers = null;
    emit('pending-format-ended');
    return true;
  }
  editorView.dispatch({
    changes: hasClose
      ? { from: cursor, to: cursor + close.length, insert: `${close}\n` }
      : { from: cursor, to: cursor, insert: '\n' },
    selection: { anchor: cursor + close.length + 1 },
  });
  activePendingAction = null;
  pendingInlineMarkers = null;
  emit('pending-format-ended');
  return true;
}

// Dynamic line number toggle
watch(
  () => props.showLineNumbers,
  (visible) => {
    if (!view) return;
    view.dispatch({
      effects: lineNumberCompartment.reconfigure(visible ? lineNumbers() : []),
    });
  },
);

// Dynamic live preview toggle
watch(
  () => [props.livePreview, props.wikiLinkRevision] as const,
  ([active]) => {
    if (!view) return;
    view.dispatch({
      effects: livePreviewCompartment.reconfigure(
        active
          ? livePreviewExtension({
              onExternalLinkClick: props.onLivePreviewExternalLinkClick,
              onTagClick: props.onLivePreviewTagClick,
              onWikiLinkClick: props.onLivePreviewWikiLinkClick,
              wikiLinkExists: props.wikiLinkExists,
            })
          : [],
      ),
    });
  },
);

// Dynamic autocomplete toggle
watch(
  () => [props.enableAutocomplete, props.completionSettings] as const,
  () => {
    if (!view) return;
    view.dispatch({ effects: autocompleteCompartment.reconfigure(autocompleteExtensions()) });
  },
  { deep: true },
);

watch(
  () => props.pendingFormat,
  (action) => applyPendingFormat(action),
);

onMounted(() => {
  if (!editorHost.value) return;

  // Ensure CM6 does NOT use Chrome's EditContext API on Windows.
  // EditContext causes IME composition bugs on Chrome 126+:
  //  - Candidate window mispositioning after Enter
  //  - Cursor jumping to wrong line during composition
  //  - Text appearing on previous line instead of current
  // CM6 6.28+ auto-detects EditContext; this disables it via the
  // internal flag (not exposed as a typed static in 6.43.x).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (EditorView as any).EDIT_CONTEXT = false;

  // E2E diagnostic: log modelValue at editor creation time
  view = new EditorView({
    state: createState(props.modelValue),
    parent: editorHost.value,
  });
  if (props.pendingFormat) applyPendingFormat(props.pendingFormat);
  // Register E2E helpers AFTER view creation and AFTER old component's onUnmounted cleanup.
  // Must be in onMounted, not setup: Vue 3 :key patching runs setup BEFORE old unmount.
  registerE2EEditorBridge();
  view.dom.addEventListener('mousedown', registerE2EEditorBridge);
  view.contentDOM.addEventListener('focus', registerE2EEditorBridge);

  // Fire-and-forget predictor init (BUG-027 fix: 消除 async onMounted 导致的 view=null 窗口期).
  // predict.initialize() 下载 429KB baseline 文件可能耗时 200-500ms，
  // 这段延迟不能阻塞 EditorView 创建，否则 E2E waitForEditorReady 轮询时 view 为 null。
  const settings = currentCompletionSettings();
  predictor.configure(settings);
  if (props.enableAutocomplete !== false && settings.enabled) {
    predictor.initialize().then(() => {
      predictor.scanOpenedDocument(view?.state.doc.toString() ?? props.modelValue);
    });
  }

  // Drag/drop handlers
  if (props.onEditorDrop) {
    editorHost.value.addEventListener('drop', props.onEditorDrop);
  }
  if (props.onEditorDragOver) {
    editorHost.value.addEventListener('dragover', props.onEditorDragOver);
  }
  if (props.onEditorPaste) {
    editorHost.value.addEventListener('paste', async (e) => {
      const result = await props.onEditorPaste!(e);
      if (result === true) e.preventDefault();
    });
  }

  // Selection tracking
  document.addEventListener('selectionchange', onSelectionChange);

  // BUG-052: when format is clicked during IME composition, defer
  // marker insertion until after compositionend so the dispatch
  // doesn't corrupt CM6's composition transaction.
  view.contentDOM.addEventListener('compositionend', onCompositionEndApplyDeferred);
  view.contentDOM.addEventListener('compositionstart', onCompositionStartRefreshScan);
  view.contentDOM.addEventListener('compositionend', onCompositionEndRefreshScan);
});

onUnmounted(() => {
  const e2eBridge = getJotLuckE2EBridge();
  if (e2eBridge?.editor?.id === INSTANCE_ID) delete e2eBridge.editor;
  document.removeEventListener('selectionchange', onSelectionChange);
  if (view) {
    view.contentDOM.removeEventListener('compositionend', onCompositionEndApplyDeferred);
    view.contentDOM.removeEventListener('compositionstart', onCompositionStartRefreshScan);
    view.contentDOM.removeEventListener('compositionend', onCompositionEndRefreshScan);
    view.dom.removeEventListener('mousedown', registerE2EEditorBridge);
    view.contentDOM.removeEventListener('focus', registerE2EEditorBridge);
    suppressSync = true;
    view.destroy();
    view = null;
  }
  clearOpenedDocumentScanTimer();
  // A workspace-owned predictor survives keyed editor remounts. Only an
  // isolated component instance owns (and therefore disposes) its fallback,
  // including the V2 Worker and pending async requests.
  if (ownsPredictor) void predictor.dispose();
});

// External modelValue change → sync to editor (suppress feedback to avoid re-dirtying)
watch(
  () => props.modelValue,
  (val) => {
    // Ignore values emitted by this EditorView. During IME composition Vue may
    // deliver an older intermediate value after the editor has already accepted
    // the next punctuation transaction; replaying it would swallow that input.
    if (internallyEmittedValues.delete(val)) return;
    if (view && val !== view.state.doc.toString()) {
      suppressSync = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: val },
      });
      suppressSync = false;
      refreshOpenedDocumentScan(val);
    }
  },
);

function onSelectionChange(): void {
  if (!view || !view.hasFocus) return;
  const sel = view.state.selection.main;
  emit('selection-change', { from: sel.from, to: sel.to });
}

function onCompositionEndApplyDeferred(): void {
  if (deferredPendingAction === null || !view) return;
  // CM6 may not have cleared view.composing yet when compositionend fires.
  // Defer by one macrotask so the composition transaction fully settles
  // before we insert format markers.
  setTimeout(() => {
    if (!view || deferredPendingAction === null) return;
    if (view.composing || view.compositionStarted) return;
    const action = deferredPendingAction;
    deferredPendingAction = null;
    applyPendingFormat(action);
  }, 0);
}

function onCompositionStartRefreshScan(): void {
  scanPausedForComposition = true;
  clearOpenedDocumentScanTimer();
}

function onCompositionEndRefreshScan(): void {
  scanPausedForComposition = false;
  setTimeout(() => {
    if (!view || view.composing || view.compositionStarted) return;
    refreshOpenedDocumentScan(view.state.doc.toString());
  }, 0);
}

function getEditorView(): EditorView | null {
  return view;
}

function focus(): void {
  view?.focus();
}

defineExpose({ getEditorView, focus, predictor });
</script>

<style scoped>
.markdown-editor {
  height: 100%;
  overflow: hidden;
}

.markdown-editor :deep(.cm-editor) {
  height: 100%;
}

.markdown-editor :deep(.cm-scroller) {
  overflow-y: auto;
  height: 100%;
}
</style>
