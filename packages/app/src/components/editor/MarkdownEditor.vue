<template>
  <div
    ref="editorHost"
    class="markdown-editor"
    :style="{
      '--editor-font-size': `${fontSize}px`,
      '--editor-line-height': String(lineHeight),
    }"
  />
</template>

<script setup lang="ts">
/**
 * MarkdownEditor.vue — CodeMirror 6 编辑器封装
 *
 * 纸张主题。支持 v-model、块解析、拖放/粘贴回调。
 * 暴露编辑器访问、聚焦与保存边界反馈结算供父组件调用。
 *
 * @see migration-map.md §1.2
 */
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { trackEditorPointer, isTouchInput } from '@/utils/editor-pointer';
import { observeEditorViewport, visibleEditorRect } from '@/utils/editor-overlay';
import {
  rememberEditorSelection,
  nativeEditorSelection,
  clearInteractionSelection,
} from '@/utils/cm6-interaction-selection';
import { DocumentAnalysis } from '@/services/document-analysis';
import { documentAnalysisExtension, docToString } from '@/utils/cm6-document-analysis';
import type { DocumentLocation } from '@/utils/document-location';
import { EditorView, lineNumbers, keymap } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { indentUnit } from '@codemirror/language';
import { isolateHistory } from '@codemirror/commands';
import { jotluckExtensions, jotluckPlaceholder } from '@/utils/cm6-extensions';
import {
  exitLivePreviewOnEscape,
  livePreviewExtension,
  refreshLivePreviewAnnotations,
} from '@/utils/cm6-live-preview';
import type { RenderedBlockAnnotator } from '@/utils/cm6-live-preview';
import { reviewMarksExtension, setReviewMarks, type ReviewMarkRange } from '@/utils/review-marks';
import { findReplaceExtension } from '@/utils/cm6-find-replace';
import { ghostTextPlugin } from '@/utils/cm6-ghost-text';
import { slashCommandsExtension } from '@/utils/cm6-slash-commands';
import { tableEditExtension } from '@/utils/cm6-table-edit';
import {
  smartCancelOnBackspace,
  smartCancelOnEscape,
  smartContinueOnEnter,
} from '@/utils/cm6-smart-continue';
import { MarkdownPredictor } from '@/services/MarkdownPredictor';
import { getCompletionSettings, type CompletionSettings } from '@/services/CompletionSettings';
import type { FormatAction, ParagraphPreset } from '@/types';
import {
  applyParagraphPreset,
  getInlineMarkers,
  isInlineFormatAction,
} from '@/utils/markdown-formatting';
import { getJotLuckE2EBridge } from '@/utils/e2e-bridge';
import { flushCompletionStorageMutations } from '@/services/completion/learning-repository';
import {
  createOpenedDocumentParagraphChange,
  getCompletionDocumentContext,
} from '@/services/completion/document-context';
import type { RendererOptions } from '@jotluck/renderer';
import { currentLocale, translate } from '@/i18n';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    analysis?: DocumentAnalysis;
    readOnly?: boolean;
    showLineNumbers?: boolean;
    livePreview?: boolean;
    sourceOnly?: boolean;
    /** 设置页「编辑器」区下发：字号 px（经宿主 CSS 变量 --editor-font-size） */
    fontSize?: number;
    /** 设置页「编辑器」区下发：行高倍数（经宿主 CSS 变量 --editor-line-height） */
    lineHeight?: number;
    /** 设置页「编辑器」区下发：自动换行（wrapCompartment 运行中重配） */
    wordWrap?: boolean;
    /** 设置页「编辑器」区下发：Tab 宽度（tabSize facet + indentUnit 运行中重配） */
    tabSize?: number;
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
    resolveImageSrc?: RendererOptions['resolveImageSrc'];
    imageRevision?: number;
    /** 外部会话 blob: 资产图的清洗器放行开关（透传 livePreviewExtension）。 */
    allowBlobImageSources?: boolean;
    remoteImages?: RendererOptions['remoteImages'];
    remoteImageRevision?: number;
    onLivePreviewRemoteImageClick?: (event: MouseEvent) => boolean;
    onLivePreviewRemoteImageLoad?: (event: Event) => boolean;
    onLivePreviewRemoteImageError?: (event: Event) => boolean;
    onEditorDrop?: (event: DragEvent) => void;
    onEditorDragOver?: (event: DragEvent) => void;
    onEditorPaste?: (event: ClipboardEvent) => boolean | void | Promise<boolean>;
    /**
     * 改稿模式：非聚焦块渲染 widget 的内嵌批注器（透传 livePreviewExtension）。
     * 身份须在装配期固定（稳定函数 + signature）——批注数据轮换走
     * refreshRenderedAnnotations() 的 StateEffect 事务，不触发 reconfigure。
     */
    annotateRenderedBlock?: RenderedBlockAnnotator;
    /** 改稿模式：源码态马克笔集合（透传 reviewMarksExtension；未用时保持空集合） */
    reviewMarks?: ReviewMarkRange[];
  }>(),
  {
    readOnly: false,
    showLineNumbers: false,
    livePreview: false,
    sourceOnly: false,
    // 默认值对齐接线前实际行为（16px / --lh-body 1.8 / 恒换行 / Tab=2 空格）
    fontSize: 16,
    lineHeight: 1.8,
    wordWrap: true,
    tabSize: 2,
    pendingFormat: null,
    placeholder: undefined,
    enableAutocomplete: true,
    completionSettings: undefined,
    predictor: undefined,
    analysis: undefined,
    onLivePreviewExternalLinkClick: undefined,
    onLivePreviewTagClick: undefined,
    onLivePreviewWikiLinkClick: undefined,
    wikiLinkExists: undefined,
    wikiLinkRevision: 0,
    resolveImageSrc: undefined,
    imageRevision: 0,
    allowBlobImageSources: false,
    remoteImages: undefined,
    remoteImageRevision: 0,
    onLivePreviewRemoteImageClick: undefined,
    onLivePreviewRemoteImageLoad: undefined,
    onLivePreviewRemoteImageError: undefined,
    onEditorDrop: undefined,
    onEditorDragOver: undefined,
    onEditorPaste: undefined,
    annotateRenderedBlock: undefined,
    reviewMarks: undefined,
  },
);

const analysis = props.analysis ?? new DocumentAnalysis();
const ownsAnalysis = !props.analysis;

const lineNumberCompartment = new Compartment();
const livePreviewCompartment = new Compartment();
const autocompleteCompartment = new Compartment();
const readOnlyCompartment = new Compartment();
const placeholderCompartment = new Compartment();
// 设置页「编辑器」区：自动换行与 Tab 宽度运行中重配
const wrapCompartment = new Compartment();
const tabSizeCompartment = new Compartment();

/** Tab 宽度扩展：tabSize facet（列宽计数/渲染）+ indentUnit（Tab 键缩进插入）同源 */
function editorTabSizeExtensions(tabSize: number): Extension[] {
  const unit = Number.isInteger(tabSize) && tabSize > 0 ? tabSize : 2;
  return [EditorState.tabSize.of(unit), indentUnit.of(' '.repeat(unit))];
}

// NotebookHome owns the predictor in the product path. The fallback keeps the
// component independently mountable in unit tests and isolated previews.
const ownsPredictor = props.predictor === undefined;
const predictor = props.predictor ?? new MarkdownPredictor(4);

const emit = defineEmits<{
  'update:modelValue': [value: string];
  'selection-change': [sel: { from: number; to: number } | null];
  'pending-format-ended': [];
  'position-change': [location: DocumentLocation];
  interaction: [];
}>();

const editorHost = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;
let suppressSync = false; // guard against feedback loop: watch → dispatch → updateListener → emit
const internallyEmittedValues = new Set<string>();
let activePendingAction: FormatAction | null = null;
let pendingInlineMarkers: readonly [string, string] | null = null;
let deferredPendingAction: FormatAction | null = null;
/** 段落预设应用后的光标锚点：选区离开锚点才视为"用户已移走"，防止应用
 *  预设自身的 dispatch 触发 selectionchange 误清待格式态。 */
let pendingFormatAnchor: number | null = null;
let locationFrame: number | null = null;
let userScrolling = false;

function notifyCursor(v: EditorView, changes?: DocumentLocation['changes']): void {
  const native = isTouchInput() && !v.hasFocus ? nativeEditorSelection(v) : null;
  const position = native?.head ?? v.state.selection.main.head;
  const line = v.state.doc.lineAt(position);
  userScrolling = false;
  emit('position-change', {
    analysis,
    revision: analysis.version,
    position,
    reason: 'cursor',
    line: line.number,
    column: position - line.from + 1,
    changes,
    doc: v.state.doc,
  });
}

function onDocumentScroll(): void {
  if (locationFrame !== null || !userScrolling) return;
  locationFrame = requestAnimationFrame(() => {
    locationFrame = null;
    if (!view) return;
    const rect = visibleEditorRect(view.scrollDOM.getBoundingClientRect());
    const position = view.posAtCoords(
      { x: rect.left + 24, y: Math.min(rect.bottom - 1, rect.top + 24) },
      false,
    );
    if (position !== null)
      emit('position-change', { analysis, revision: analysis.version, position, reason: 'scroll' });
  });
}

function onDocumentInteraction(event: Event): void {
  if (!view) return;
  if (event.type === 'wheel' || event.type === 'pointerdown') userScrolling = true;
  emit('interaction');
}

function currentCompletionSettings(): CompletionSettings {
  return props.completionSettings ?? getCompletionSettings();
}

function isAutocompleteScanEnabled(): boolean {
  const settings = currentCompletionSettings();
  return props.enableAutocomplete !== false && settings.enabled;
}

function refreshOpenedDocumentScan(text: string): void {
  if (!isAutocompleteScanEnabled()) return;
  predictor.scanOpenedDocument(text);
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
      view.focus();
    },
    setCursor: (cursorOffset) => {
      if (!view) return;
      const anchor = Math.max(0, Math.min(view.state.doc.length, Math.trunc(cursorOffset)));
      view.dispatch({ selection: { anchor } });
      view.focus();
    },
    focus: () => view?.focus(),
    getCursor: () => view?.state.selection.main.head ?? 0,
    getCoordsAtPos: (pos) => {
      if (!view) return null;
      const offset = Math.max(0, Math.min(view.state.doc.length, Math.trunc(pos)));
      return view.coordsAtPos(offset);
    },
    posAtCoordsAt: (x, y) => {
      if (!view) return null;
      return view.posAtCoords({ x, y });
    },
    getSelection: () => {
      if (!view) return { from: 0, to: 0, anchor: 0, head: 0 };
      const sel = view.state.selection.main;
      return { from: sel.from, to: sel.to, anchor: sel.anchor, head: sel.head };
    },
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
    requestCompletionDiagnostics: (content, cursorOffset = content.length, deadlineMs = 110) => {
      // Mirror the live ghost-text path when the editor already reflects the
      // requested document: diagnostics then see the same CM6 snapshot (heading
      // trail + paragraphs) a real keystroke does. Otherwise fall back to the
      // text-only context so synthetic warmup probes keep working.
      const editorView = view;
      const snapshotMatchesRequest =
        editorView !== null &&
        editorView.state.doc.toString() === content &&
        editorView.state.selection.main.head === cursorOffset;
      return predictor.requestGhostTextWithDiagnostics(cursorOffset, content, {
        deadlineMs,
        contextSnapshot: snapshotMatchesRequest
          ? getCompletionDocumentContext(editorView.state)
          : undefined,
      });
    },
    getCompletionEngineHealthSnapshot: () => predictor.getPublicEngineDiagnostics(),
    clearLearningState: () => predictor.clearLearningData(),
    seedCompletionCorpus: async (excerpts) => {
      // N2 intentionally requires cross-document support. Mirror two distinct
      // notebook files per excerpt instead of inflating one synthetic file.
      excerpts.forEach((excerpt, index) => {
        predictor.replaceDocumentContribution(`__e2e_seed__/${index}-a.md`, excerpt);
        predictor.replaceDocumentContribution(`__e2e_seed__/${index}-b.md`, excerpt);
      });
      await predictor.flushHybridRetrievalMutations();
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
      ...documentAnalysisExtension(analysis),
      // Ghost text keymap must precede defaultKeymap (indentWithTab) so Tab
      // is intercepted for ghost text acceptance before indentation logic.
      autocompleteCompartment.of(autocompleteExtensions()),
      readOnlyCompartment.of([
        EditorState.readOnly.of(props.readOnly),
        EditorView.editable.of(!props.readOnly),
      ]),
      // 只读态 contenteditable=false 会让内容区不可聚焦，键盘入口（Ctrl+F 等
      // readOnly 放行键）整体不可达——tabindex 保持聚焦能力。注册在
      // compartment 之外：watcher reconfigure 会整组替换 compartment 内容，
      // 放里面会在同实例只读翻转时被静默丢弃。
      EditorView.contentAttributes.of({ tabindex: '0' }),
      ...slashCommandsExtension(),
      ...tableEditExtension(),
      // 续格式仲裁：Enter 先走 pendingFormat 再走智能续格式；Backspace/Escape
      // 的空格式块取消在这里注册（位于 defaultKeymap 与 live-preview Escape 之前；
      // ghost text 的 Tab/Escape 在 Prec.highest，天然更先执行）。
      keymap.of([
        {
          key: 'Enter',
          run: (v) =>
            v.state.readOnly ? false : handlePendingFormatEnter(v) || smartContinueOnEnter(v),
        },
        {
          key: 'Backspace',
          run: (v) => (v.state.readOnly ? false : smartCancelOnBackspace(v)),
        },
        {
          key: 'Escape',
          run: (v) => (v.state.readOnly ? false : smartCancelOnEscape(v)),
        },
      ]),
      ...jotluckExtensions(props.sourceOnly, false),
      // 自动换行与 Tab 宽度经独立 Compartment 支持「设置页改值→运行中重配」
      wrapCompartment.of(props.wordWrap === false ? [] : EditorView.lineWrapping),
      tabSizeCompartment.of(editorTabSizeExtensions(props.tabSize)),
      // 改稿模式源码态马克笔：空集合时零渲染输出，对非改稿调用方无副作用。
      reviewMarksExtension(),
      // 查找替换：静态扩展（不支持 Compartment 动态切换）；search() 默认面板
      // + phrases 五语文案 + readOnly 门控详见 utils/cm6-find-replace.ts。
      ...findReplaceExtension(),
      placeholderCompartment.of(
        jotluckPlaceholder(props.placeholder ?? translate('editor.placeholder')),
      ),
      lineNumberCompartment.of(props.showLineNumbers ? lineNumbers() : []),
      livePreviewCompartment.of(
        props.livePreview
          ? livePreviewExtension({
              onExternalLinkClick: props.onLivePreviewExternalLinkClick,
              onTagClick: props.onLivePreviewTagClick,
              onWikiLinkClick: props.onLivePreviewWikiLinkClick,
              wikiLinkExists: props.wikiLinkExists,
              resolveImageSrc: props.resolveImageSrc,
              allowBlobImageSources: props.allowBlobImageSources,
              remoteImages: props.remoteImages,
              onRemoteImageClick: props.onLivePreviewRemoteImageClick,
              onRemoteImageLoad: props.onLivePreviewRemoteImageLoad,
              onRemoteImageError: props.onLivePreviewRemoteImageError,
              annotateRenderedBlock: props.annotateRenderedBlock,
            })
          : [],
      ),
      keymap.of([
        {
          key: 'Escape',
          run: (v) => {
            return props.livePreview ? exitLivePreviewOnEscape(v) : false;
          },
        },
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged || update.selectionSet)
          notifyCursor(update.view, update.docChanged ? update.changes : undefined);
        if (update.docChanged && isAutocompleteScanEnabled()) {
          const change = createOpenedDocumentParagraphChange(
            update.startState.doc,
            update.state.doc,
            update.changes,
          );
          if (change) predictor.applyOpenedDocumentParagraphChange(change);
        }
        if (update.docChanged) {
          clearInteractionSelection(update.view);
          emit('selection-change', null);
        }
        if (update.docChanged && !suppressSync) {
          // 共享取串：analysis 扩展（先注册先跑）已对同一 doc 物化过全文串，
          // 此处 WeakMap 命中，避免每击键第二次 O(N) 全文 toString。
          const value = docToString(update.state.doc);
          internallyEmittedValues.add(value);
          if (internallyEmittedValues.size > 2) {
            const oldest = internallyEmittedValues.values().next().value;
            if (oldest !== undefined) internallyEmittedValues.delete(oldest);
          }
          emit('update:modelValue', value);
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

/**
 * 段落预设待格式态泄漏清理（E4）：预设（标题/引用）置 pending 后不随交互
 * 清理，下一次任意位置 Enter 会被劫持为裸换行、短路智能续格式。指针落下
 * （编辑器内外皆算"移走"）或选区离开预设锚点时清空；inline 动作语义保持
 * 现状（其定界符对与位置绑定，Enter 退出语义不变）。
 */
function clearStaleParagraphPendingFormat(): void {
  if (!activePendingAction || isInlineFormatAction(activePendingAction)) return;
  activePendingAction = null;
  pendingInlineMarkers = null;
  pendingFormatAnchor = null;
  emit('pending-format-ended');
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

  const previousAction = activePendingAction;
  activePendingAction = action === 'clear' ? null : action;
  pendingInlineMarkers = null;
  pendingFormatAnchor = null;
  if (!activePendingAction) {
    // 清理型回灌（如交互清理后宿主把 prop 置 null）：先前无活动态时不抢焦点
    //（用户可能正点击编辑器之外的面板）。
    if (previousAction) view.focus();
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
    // 段落预设锚点 = 应用后的光标位：选区仍在锚点说明是本应用的回声事件
    pendingFormatAnchor = view.state.selection.main.head;
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
      annotations: isolateHistory.of('full'),
    });
    activePendingAction = null;
    pendingInlineMarkers = null;
    pendingFormatAnchor = null;
    emit('pending-format-ended');
    return true;
  }
  editorView.dispatch({
    changes: hasClose
      ? { from: cursor, to: cursor + close.length, insert: `${close}\n` }
      : { from: cursor, to: cursor, insert: '\n' },
    selection: { anchor: cursor + close.length + 1 },
    annotations: isolateHistory.of('full'),
  });
  activePendingAction = null;
  pendingInlineMarkers = null;
  pendingFormatAnchor = null;
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

// 设置页「编辑器」区：自动换行/Tab 宽度运行中重配（字号/行高走宿主 CSS 变量响应式生效，
// 无需触碰编辑器状态）。tabSize 重配保留文档与选区（reconfigure 仅替换扩展内容）。
watch(
  () => [props.wordWrap, props.tabSize] as const,
  ([wordWrap, tabSize]) => {
    if (!view) return;
    view.dispatch({
      effects: [
        wrapCompartment.reconfigure(wordWrap === false ? [] : EditorView.lineWrapping),
        tabSizeCompartment.reconfigure(editorTabSizeExtensions(tabSize)),
      ],
    });
  },
);

// Keep the same editor instance while note/workspace transitions briefly lock writes.
// A non-editable content DOM remains selectable, so Ctrl/Cmd+A and Ctrl/Cmd+C still work.
watch(
  () => props.readOnly,
  (readOnly) => {
    if (!view) return;
    if (readOnly) {
      clearInteractionSelection(view);
      emit('selection-change', null);
    }
    view.dispatch({
      effects: readOnlyCompartment.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  },
);

function onEditorHostDrop(event: DragEvent): void {
  props.onEditorDrop?.(event);
}

function onEditorHostDragOver(event: DragEvent): void {
  props.onEditorDragOver?.(event);
}

function onEditorHostPaste(event: ClipboardEvent): void {
  // preventDefault must happen in the browser's original event turn. Image handlers
  // therefore synchronously return true when they take ownership, then do I/O in the background.
  if (props.onEditorPaste?.(event) === true) event.preventDefault();
}

// Delay display-only refreshes while native handles or IME own the current DOM.
let previewRefreshPending = false;
function refreshLivePreview(): void {
  if (!view) return;
  if (
    props.livePreview &&
    (view.dom.dataset.touchGesture === 'true' ||
      view.composing ||
      view.compositionStarted ||
      (isTouchInput() && nativeEditorSelection(view)))
  ) {
    previewRefreshPending = true;
    return;
  }
  previewRefreshPending = false;
  view.dispatch({
    effects: livePreviewCompartment.reconfigure(
      props.livePreview
        ? livePreviewExtension({
            onExternalLinkClick: props.onLivePreviewExternalLinkClick,
            onTagClick: props.onLivePreviewTagClick,
            onWikiLinkClick: props.onLivePreviewWikiLinkClick,
            wikiLinkExists: props.wikiLinkExists,
            resolveImageSrc: props.resolveImageSrc,
            allowBlobImageSources: props.allowBlobImageSources,
            remoteImages: props.remoteImages,
            onRemoteImageClick: props.onLivePreviewRemoteImageClick,
            onRemoteImageLoad: props.onLivePreviewRemoteImageLoad,
            onRemoteImageError: props.onLivePreviewRemoteImageError,
            annotateRenderedBlock: props.annotateRenderedBlock,
          })
        : [],
    ),
  });
}
watch(
  () => [
    props.livePreview,
    props.wikiLinkRevision,
    props.imageRevision,
    props.remoteImageRevision,
    currentLocale.value,
  ],
  refreshLivePreview,
);

// 改稿模式源码态马克笔：集合变化 → 全量替换标注（reviewMarksField 的 effect 语义）
watch(
  () => props.reviewMarks,
  (marks) => {
    if (!view) return;
    setReviewMarks(view, marks ?? []);
  },
);

// Dynamic autocomplete toggle
watch(
  () => [props.enableAutocomplete, props.completionSettings] as const,
  () => {
    if (!view) return;
    if (isAutocompleteScanEnabled()) refreshOpenedDocumentScan(view.state.doc.toString());
    view.dispatch({ effects: autocompleteCompartment.reconfigure(autocompleteExtensions()) });
  },
  { deep: true },
);

watch(
  () => props.pendingFormat,
  (action) => applyPendingFormat(action),
);

watch([() => props.placeholder, currentLocale], ([placeholder]) => {
  if (!view) return;
  view.dispatch({
    effects: placeholderCompartment.reconfigure(
      jotluckPlaceholder(placeholder ?? translate('editor.placeholder')),
    ),
  });
});

let stopPointerTracking: (() => void) | undefined;
let stopViewportTracking: (() => void) | undefined;
onMounted(() => {
  stopPointerTracking = trackEditorPointer();
  if (!editorHost.value) return;

  const settings = currentCompletionSettings();
  predictor.configure(settings);
  if (props.enableAutocomplete !== false && settings.enabled) {
    // One complete initialization is allowed when the document opens. Every
    // subsequent edit is applied as a bounded CM6 paragraph contribution delta.
    refreshOpenedDocumentScan(props.modelValue);
  }

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
  // 改稿模式：挂载时已携带马克笔集合（watch 拿不到 pre-mount 值）→ 补一次初始应用
  if (props.reviewMarks && props.reviewMarks.length > 0) setReviewMarks(view, props.reviewMarks);
  const viewport = observeEditorViewport(() => {
    if (!view?.hasFocus || view.composing || view.compositionStarted) return;
    const caret = view.coordsAtPos(view.state.selection.main.head);
    if (!caret) return;
    const bounds = visibleEditorRect(view.scrollDOM.getBoundingClientRect());
    if (caret.bottom > bounds.bottom) view.scrollDOM.scrollTop += caret.bottom - bounds.bottom + 48;
    else if (caret.top < bounds.top) view.scrollDOM.scrollTop -= bounds.top - caret.top + 48;
  }, false);
  stopViewportTracking = viewport.destroy;
  view.scrollDOM.addEventListener('scroll', onDocumentScroll, { passive: true });
  for (const event of ['wheel', 'pointerdown', 'keydown', 'beforeinput', 'compositionstart'])
    view.scrollDOM.addEventListener(event, onDocumentInteraction, { passive: true, capture: true });
  notifyCursor(view);
  if (performance.getEntriesByName('jotluck:editor-ready').length === 0) {
    performance.mark('jotluck:editor-ready');
    if (performance.getEntriesByName('jotluck:bootstrap-start').length > 0) {
      performance.measure(
        'jotluck:cold-start-to-editor',
        'jotluck:bootstrap-start',
        'jotluck:editor-ready',
      );
    }
  }
  if (props.pendingFormat) applyPendingFormat(props.pendingFormat);
  // Register E2E helpers AFTER view creation and AFTER old component's onUnmounted cleanup.
  // Must be in onMounted, not setup: Vue 3 :key patching runs setup BEFORE old unmount.
  registerE2EEditorBridge();
  view.dom.addEventListener('mousedown', registerE2EEditorBridge);
  view.contentDOM.addEventListener('focus', registerE2EEditorBridge);

  // Fire-and-forget predictor init. Public L3 remains fail-closed unless an
  // evidence-gated engine is explicitly injected by a dev/E2E build.
  if (props.enableAutocomplete !== false && settings.enabled) {
    void predictor.initialize();
  }

  // Stable wrappers read the latest props, so a transition can disable uploads without remounting.
  editorHost.value.addEventListener('drop', onEditorHostDrop);
  editorHost.value.addEventListener('dragover', onEditorHostDragOver);
  editorHost.value.addEventListener('paste', onEditorHostPaste);

  // Selection tracking
  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('editor-native-selection-change', onSelectionChange);
  view.dom.addEventListener('editor-touch-finished', flushPreviewRefresh);
  document.addEventListener('pointerdown', onInteractionPointerDown, true);
  document.addEventListener('keydown', onInteractionKeyDown);

  // BUG-052: when format is clicked during IME composition, defer
  // marker insertion until after compositionend so the dispatch
  // doesn't corrupt CM6's composition transaction.
  view.contentDOM.addEventListener('compositionend', onCompositionEndApplyDeferred);
  view.contentDOM.addEventListener('keydown', onComposingKeyDown, true);
});

onUnmounted(() => {
  stopPointerTracking?.();
  stopViewportTracking?.();
  if (locationFrame !== null) cancelAnimationFrame(locationFrame);
  if (view) {
    view.scrollDOM.removeEventListener('scroll', onDocumentScroll);
    for (const event of ['wheel', 'pointerdown', 'keydown', 'beforeinput', 'compositionstart'])
      view.scrollDOM.removeEventListener(event, onDocumentInteraction, true);
  }
  if (ownsAnalysis) analysis.destroy();
  const e2eBridge = getJotLuckE2EBridge();
  if (e2eBridge?.editor?.id === INSTANCE_ID) delete e2eBridge.editor;
  document.removeEventListener('selectionchange', onSelectionChange);
  document.removeEventListener('editor-native-selection-change', onSelectionChange);
  view?.dom.removeEventListener('editor-touch-finished', flushPreviewRefresh);
  document.removeEventListener('pointerdown', onInteractionPointerDown, true);
  document.removeEventListener('keydown', onInteractionKeyDown);
  editorHost.value?.removeEventListener('drop', onEditorHostDrop);
  editorHost.value?.removeEventListener('dragover', onEditorHostDragOver);
  editorHost.value?.removeEventListener('paste', onEditorHostPaste);
  if (view) {
    view.contentDOM.removeEventListener('compositionend', onCompositionEndApplyDeferred);
    view.contentDOM.removeEventListener('keydown', onComposingKeyDown, true);
    view.dom.removeEventListener('mousedown', registerE2EEditorBridge);
    view.contentDOM.removeEventListener('focus', registerE2EEditorBridge);
    suppressSync = true;
    view.destroy();
    view = null;
  }
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
    }
  },
);

function onInteractionPointerDown(event: PointerEvent): void {
  if (!view) return;
  const target = event.target as HTMLElement;
  if (
    target.closest(
      '.format-toolbar, .format-bubble, .cm-jotluck-table-toolbar, .cm-jotluck-slash-menu',
    )
  )
    return;
  // 交互指针落下（格式 UI 之外皆算"移走"）：清理段落预设待格式态
  clearStaleParagraphPendingFormat();
  if (!view.contentDOM.contains(target)) {
    clearInteractionSelection(view);
    emit('selection-change', null);
  }
}

function onComposingKeyDown(event: KeyboardEvent): void {
  // A confirming IME key can arrive after the browser has cleared CM's composition
  // state. Leave its default action to the IME, but do not run editor keymaps.
  if (event.isComposing || event.keyCode === 229) event.stopImmediatePropagation();
}

function onInteractionKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !view) return;
  clearInteractionSelection(view);
  emit('selection-change', null);
}

function flushPreviewRefresh(): void {
  if (previewRefreshPending) queueMicrotask(refreshLivePreview);
}
function onSelectionChange(): void {
  if (previewRefreshPending) queueMicrotask(refreshLivePreview);
  if (
    !view ||
    (!view.hasFocus && !view.contentDOM.contains(document.getSelection()?.anchorNode ?? null))
  )
    return;
  // 选区变化离开预设锚点（点击他处/方向键/输入推进）：清理段落预设待格式态。
  // 锚点相等时为 applyPendingFormat 自身 dispatch 的回声，保留待格式态。
  if (pendingFormatAnchor !== null && view.state.selection.main.head !== pendingFormatAnchor) {
    clearStaleParagraphPendingFormat();
  }
  const sel = rememberEditorSelection(view);
  if (sel.native) notifyCursor(view);
  emit('selection-change', { from: sel.from, to: sel.to });
}

function onCompositionEndApplyDeferred(): void {
  if (previewRefreshPending) queueMicrotask(refreshLivePreview);
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

function getEditorView(): EditorView | null {
  return view;
}

/**
 * 改稿模式：通知 live preview 批注数据已更新（换数据不换扩展，范式同下方
 * reviewMarks watch）。view 不存在或 livePreview 关闭时为安全 no-op。
 */
function refreshRenderedAnnotations(): void {
  if (!view || !props.livePreview) return;
  refreshLivePreviewAnnotations(view);
}

function focus(): void {
  view?.focus();
}

async function settlePendingAutocompleteFeedback(): Promise<void> {
  if (view) {
    (
      view.dom as HTMLElement & {
        __jotluckSettlePendingAccepted?: () => void;
      }
    ).__jotluckSettlePendingAccepted?.();
  }
  await flushCompletionStorageMutations();
}

defineExpose({
  getEditorView,
  focus,
  predictor,
  settlePendingAutocompleteFeedback,
  refreshRenderedAnnotations,
});
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
