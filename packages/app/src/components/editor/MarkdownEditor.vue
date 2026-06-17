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
import { markluckExtensions } from '@/utils/cm6-extensions';
import { livePreviewExtension, unpinFocusedBlock } from '@/utils/cm6-live-preview';
import { ghostTextPlugin } from '@/utils/cm6-ghost-text';
import { MarkdownPredictor } from '@/services/MarkdownPredictor';
import type { MarkdownBlock } from '@/types';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    blocks?: MarkdownBlock[];
    readOnly?: boolean;
    showLineNumbers?: boolean;
    livePreview?: boolean;
    enableAutocomplete?: boolean;
    onLivePreviewExternalLinkClick?: (href: string) => void;
    onLivePreviewTagClick?: (tag: string) => void;
    onLivePreviewWikiLinkClick?: (note: string, anchor: null | string) => void;
    onEditorDrop?: (event: DragEvent) => void;
    onEditorDragOver?: (event: DragEvent) => void;
    onEditorPaste?: (event: ClipboardEvent) => boolean | void | Promise<boolean>;
  }>(),
  {
    blocks: () => [],
    readOnly: false,
    showLineNumbers: false,
    livePreview: false,
    enableAutocomplete: true,
    onLivePreviewExternalLinkClick: undefined,
    onLivePreviewTagClick: undefined,
    onLivePreviewWikiLinkClick: undefined,
    onEditorDrop: undefined,
    onEditorDragOver: undefined,
    onEditorPaste: undefined,
  },
);

const lineNumberCompartment = new Compartment();
const livePreviewCompartment = new Compartment();
const autocompleteCompartment = new Compartment();

// Respect user's autocomplete preference from localStorage
const AUTOCOMPLETE_ENABLED_KEY = 'markluck:autocomplete:enabled';
const isAutocompleteEnabled = () => localStorage.getItem(AUTOCOMPLETE_ENABLED_KEY) !== 'false';

// Shared predictor instance for ghost text + structured knowledge
const predictor = new MarkdownPredictor(4);

const emit = defineEmits<{
  'update:modelValue': [value: string];
  'blocks-updated': [blocks: MarkdownBlock[]];
  'selection-change': [sel: { from: number; to: number } | null];
}>();

const editorHost = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;
let suppressSync = false; // guard against feedback loop: watch → dispatch → updateListener → emit

// E2E content reader — registered in onMounted (NOT setup!) because Vue 3 :key patching
// runs setup before old component's onUnmounted, causing old unmount to delete new registration.
// @see BUG-027, memory/bug_log.md
const getEditorContentFn = () => view?.state.doc.toString() ?? '';
const getEditorViewFn = () => view;

// Lifecycle tracer for BUG-027 diagnosis
const INSTANCE_ID = Math.random().toString(36).slice(2, 8);
window.__markluck_lifecycleLog = window.__markluck_lifecycleLog || [];
window.__markluck_lifecycleLog!.push({
  event: 'setup',
  id: INSTANCE_ID,
  t: performance.now(),
});

function createState(doc: string) {
  return EditorState.create({
    doc,
    extensions: [
      // Ghost text keymap must precede defaultKeymap (indentWithTab) so Tab
      // is intercepted for ghost text acceptance before indentation logic.
      autocompleteCompartment.of(
        props.enableAutocomplete !== false ? ghostTextPlugin(predictor) : [],
      ),
      ...markluckExtensions(),
      lineNumberCompartment.of(props.showLineNumbers ? lineNumbers() : []),
      livePreviewCompartment.of(
        props.livePreview
          ? livePreviewExtension({
              onExternalLinkClick: props.onLivePreviewExternalLinkClick,
              onTagClick: props.onLivePreviewTagClick,
              onWikiLinkClick: props.onLivePreviewWikiLinkClick,
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
          emit('update:modelValue', update.state.doc.toString());
        }
      }),
    ],
  });
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
  () => props.livePreview,
  (active) => {
    if (!view) return;
    view.dispatch({
      effects: livePreviewCompartment.reconfigure(
        active
          ? livePreviewExtension({
              onExternalLinkClick: props.onLivePreviewExternalLinkClick,
              onTagClick: props.onLivePreviewTagClick,
              onWikiLinkClick: props.onLivePreviewWikiLinkClick,
            })
          : [],
      ),
    });
  },
);

// Dynamic autocomplete toggle
watch(
  () => props.enableAutocomplete,
  (enabled) => {
    if (!view) return;
    view.dispatch({
      effects: autocompleteCompartment.reconfigure(
        enabled !== false ? ghostTextPlugin(predictor) : [],
      ),
    });
  },
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
  window.__markluck_editorInitValue = props.modelValue;
  view = new EditorView({
    state: createState(props.modelValue),
    parent: editorHost.value,
  });
  // Register E2E helpers AFTER view creation and AFTER old component's onUnmounted cleanup.
  // Must be in onMounted, not setup: Vue 3 :key patching runs setup BEFORE old unmount.
  window.__markluck_getEditorContent = getEditorContentFn;
  window.__markluck_getEditorView = getEditorViewFn;
  window.__markluck_lifecycleLog!.push({
    event: 'mounted',
    id: INSTANCE_ID,
    docLen: view.state.doc.length,
    t: performance.now(),
  });

  window.__markluck_predictor = predictor;

  // Fire-and-forget predictor init (BUG-027 fix: 消除 async onMounted 导致的 view=null 窗口期).
  // predict.initialize() 下载 429KB baseline 文件可能耗时 200-500ms，
  // 这段延迟不能阻塞 EditorView 创建，否则 E2E waitForEditorReady 轮询时 view 为 null。
  if (props.enableAutocomplete !== false && isAutocompleteEnabled()) {
    predictor.initialize().then(() => {
      predictor.scanOpenedDocument(props.modelValue);
    });
  }

  // Sync changes back to v-model (DOM events as safety net; updateListener is the primary path)
  view.dom.addEventListener('keyup', syncContent);
  view.dom.addEventListener('mouseup', syncContent);
  view.dom.addEventListener('paste', syncContent);

  // Drag/drop handlers
  if (props.onEditorDrop) {
    editorHost.value.addEventListener('drop', props.onEditorDrop);
  }
  if (props.onEditorDragOver) {
    editorHost.value.addEventListener('dragover', props.onEditorDragOver);
  }
  if (props.onEditorPaste) {
    editorHost.value.addEventListener('paste', (e) => {
      const result = props.onEditorPaste!(e);
      if (result === true) e.preventDefault();
    });
  }

  // Selection tracking
  document.addEventListener('selectionchange', onSelectionChange);
});

onUnmounted(() => {
  window.__markluck_lifecycleLog!.push({
    event: 'unmounting',
    id: INSTANCE_ID,
    hasView: !!view,
    docLen: view?.state?.doc?.length,
    t: performance.now(),
  });
  delete window.__markluck_getEditorContent;
  delete window.__markluck_getEditorView;
  delete window.__markluck_editorInitValue;
  delete window.__markluck_modelOverwrites;
  document.removeEventListener('selectionchange', onSelectionChange);
  if (view) {
    view.dom.removeEventListener('keyup', syncContent);
    view.dom.removeEventListener('mouseup', syncContent);
    view.dom.removeEventListener('paste', syncContent);
    suppressSync = true;
    view.destroy();
    view = null;
  }
  // Persist L1→L2 before component is destroyed.
  // Without this, L2 never accumulates and ghost text always cold-starts.
  predictor.closeDocument();
  window.__markluck_lifecycleLog!.push({
    event: 'unmounted',
    id: INSTANCE_ID,
    t: performance.now(),
  });
});

// External modelValue change → sync to editor (suppress feedback to avoid re-dirtying)
watch(
  () => props.modelValue,
  (val) => {
    if (view && val !== view.state.doc.toString()) {
      // E2E diagnostic: log modelValue overwrites
      window.__markluck_modelOverwrites = window.__markluck_modelOverwrites || [];
      window.__markluck_modelOverwrites.push({
        fromLen: view.state.doc.length,
        toLen: val.length,
        fromStart: view.state.doc.toString().substring(0, 40),
        toStart: val.substring(0, 40),
        time: Date.now(),
      });
      suppressSync = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: val },
      });
      suppressSync = false;
    }
  },
);

function syncContent(): void {
  if (!view || suppressSync) return;
  const content = view.state.doc.toString();
  emit('update:modelValue', content);
}

function onSelectionChange(): void {
  if (!view || !view.hasFocus) return;
  const sel = view.state.selection.main;
  emit('selection-change', { from: sel.from, to: sel.to });
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
