<template>
  <div ref="editorContainer" class="markdown-editor" />
</template>

<script setup lang="ts">
/**
 * MarkdownEditor.vue — CodeMirror 6 编辑器封装
 *
 * M1-05: CodeMirror 6 集成
 * M1-07~11: BlockDecorator, BlockWidget, FormatAutoDetector,
 *            RestoreButton, IME handler, keyboard shortcuts
 *
 * @see TAD.md §3
 * @see components.md §12
 */
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import {
  markluckExtensions,
  markdownKeymap,
  setBlocksForDecorations,
} from '@/utils/cm6-extensions';
import { livePreviewExtension, toggleBlockRender } from '@/utils/cm6-live-preview';
import { useThemeStore } from '@/stores/theme';
import type { MarkdownBlock } from '@/types';

// M5-02/04: Dark syntax highlighting (VSCode Dark+ inspired)
const darkHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: 'oklch(0.68 0.1 240)', fontWeight: 'bold' },
  { tag: tags.heading1, fontSize: '1.6em' },
  { tag: tags.heading2, fontSize: '1.4em' },
  { tag: tags.heading3, fontSize: '1.2em' },
  { tag: tags.comment, color: 'oklch(0.55 0.07 145)', fontStyle: 'italic' },
  { tag: tags.string, color: 'oklch(0.65 0.1 50)' },
  { tag: tags.keyword, color: 'oklch(0.62 0.13 250)', fontWeight: 'bold' },
  { tag: tags.number, color: 'oklch(0.72 0.06 150)' },
  { tag: tags.typeName, color: 'oklch(0.67 0.1 180)' },
  { tag: tags.bool, color: 'oklch(0.62 0.13 250)' },
  { tag: tags.regexp, color: 'oklch(0.68 0.14 30)' },
  { tag: tags.url, color: 'oklch(0.58 0.16 250)', textDecoration: 'underline' },
  { tag: tags.link, color: 'oklch(0.58 0.16 250)', textDecoration: 'underline' },
  { tag: tags.escape, color: 'oklch(0.65 0.1 70)' },
  { tag: tags.operator, color: 'oklch(0.8 0.003 260)' },
  { tag: tags.punctuation, color: 'oklch(0.68 0.005 260)' },
  { tag: tags.tagName, color: 'oklch(0.62 0.13 250)' },
  { tag: tags.attributeName, color: 'oklch(0.72 0.08 220)' },
  { tag: tags.attributeValue, color: 'oklch(0.65 0.1 50)' },
  { tag: tags.quote, color: 'oklch(0.6 0.02 145)' },
  { tag: tags.list, color: 'oklch(0.62 0.13 250)' },
  { tag: tags.monospace, color: 'oklch(0.7 0.08 30)', fontFamily: 'monospace' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.content, color: 'oklch(0.85 0.003 260)' },
]);

// M1 syntax highlighting theme (light mode)
const lightHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: 'oklch(0.22 0.01 260)', fontWeight: 'bold' },
  { tag: tags.heading1, fontSize: '1.6em' },
  { tag: tags.heading2, fontSize: '1.4em' },
  { tag: tags.heading3, fontSize: '1.2em' },
  { tag: tags.comment, color: 'oklch(0.55 0.02 145)', fontStyle: 'italic' },
  { tag: tags.string, color: 'oklch(0.45 0.12 145)' },
  { tag: tags.keyword, color: 'oklch(0.45 0.15 285)', fontWeight: 'bold' },
  { tag: tags.number, color: 'oklch(0.5 0.14 50)' },
  { tag: tags.typeName, color: 'oklch(0.45 0.13 230)' },
  { tag: tags.bool, color: 'oklch(0.45 0.15 285)' },
  { tag: tags.regexp, color: 'oklch(0.5 0.15 15)' },
  { tag: tags.url, color: 'oklch(0.5 0.13 230)', textDecoration: 'underline' },
  { tag: tags.link, color: 'oklch(0.5 0.13 230)', textDecoration: 'underline' },
  { tag: tags.escape, color: 'oklch(0.45 0.15 50)' },
  { tag: tags.operator, color: 'oklch(0.3 0.005 260)' },
  { tag: tags.punctuation, color: 'oklch(0.5 0.01 260)' },
  { tag: tags.tagName, color: 'oklch(0.45 0.13 285)' },
  { tag: tags.attributeName, color: 'oklch(0.45 0.12 230)' },
  { tag: tags.attributeValue, color: 'oklch(0.45 0.12 145)' },
  { tag: tags.quote, color: 'oklch(0.5 0.02 145)' },
  { tag: tags.list, color: 'oklch(0.5 0.13 230)' },
  { tag: tags.monospace, color: 'oklch(0.45 0.12 15)', fontFamily: 'monospace' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.content, color: 'oklch(0.28 0.005 260)' },
]);

const props = defineProps<{
  modelValue: string;
  blocks?: MarkdownBlock[];
  readOnly?: boolean;
  /** P2-1: Drop event handler (image/file drag into editor) */
  onEditorDrop?: (event: DragEvent) => void;
  /** P2-1: Dragover event handler */
  onEditorDragOver?: (event: DragEvent) => void;
  /** P2-1: Paste event handler (returns true/void if handled) */
  onEditorPaste?: (event: ClipboardEvent) => boolean | void | Promise<boolean>;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  'blocks-updated': [blocks: MarkdownBlock[]];
}>();

const themeStore = useThemeStore();
const editorContainer = ref<HTMLElement | null>(null);
let editorView: EditorView | null = null;

/** Compartment for dynamic syntax highlighting theme switching */
const syntaxCompartment = new Compartment();

/** Get the correct HighlightStyle based on current color scheme */
function getHighlightStyle() {
  return themeStore.colorScheme === 'dark' ? darkHighlightStyle : lightHighlightStyle;
}

/** Reconfigure syntax highlighting without recreating the editor */
function reconfigureHighlight() {
  if (!editorView) return;
  editorView.dispatch({
    effects: syntaxCompartment.reconfigure(syntaxHighlighting(getHighlightStyle())),
  });
}

/** 初始化 CodeMirror 6 编辑器 */
onMounted(() => {
  if (!editorContainer.value) return;

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      const content = update.state.doc.toString();
      emit('update:modelValue', content);
    }
  });

  const state = EditorState.create({
    doc: props.modelValue,
    extensions: [
      lineNumbers(),
      highlightActiveLine(),
      markdown(),
      syntaxCompartment.of(syntaxHighlighting(getHighlightStyle())),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      keymap.of(Object.entries(markdownKeymap()).map(([key, fn]) => ({ key, run: fn }))),
      // Tab: toggle block between source/live-preview mode
      keymap.of([{ key: 'Tab', run: toggleBlockRender, shift: () => true }]),
      updateListener,
      ...markluckExtensions(),
      ...livePreviewExtension(),
      EditorView.editable.of(!props.readOnly),
      EditorView.updateListener.of((_update) => {
        // Pass blocks to decoration system when available
        if (props.blocks) {
          setBlocksForDecorations(props.blocks);
        }
      }),
    ],
  });

  editorView = new EditorView({
    state,
    parent: editorContainer.value,
  });

  // Listen for throttle parser events
  editorView.dom.addEventListener('markluck-parse', ((event: CustomEvent) => {
    emit('update:modelValue', event.detail.content);
  }) as EventListener);

  // P2-1: Register drag-drop and paste handlers on editor DOM
  if (props.onEditorDragOver) {
    editorView.dom.addEventListener('dragover', props.onEditorDragOver);
  }
  if (props.onEditorDrop) {
    editorView.dom.addEventListener('drop', props.onEditorDrop);
  }
  if (props.onEditorPaste) {
    editorView.dom.addEventListener('paste', async (e: Event) => {
      const handled = await props.onEditorPaste!(e as ClipboardEvent);
      if (handled === true) e.preventDefault();
    });
  }

  // M5: Watch theme changes and reconfigure syntax highlighting
  watch(
    () => themeStore.colorScheme,
    () => {
      reconfigureHighlight();
    },
  );
});

/** 外部更新 modelValue 时同步编辑器内容 */
watch(
  () => props.modelValue,
  (newValue) => {
    if (!editorView) return;
    const currentContent = editorView.state.doc.toString();
    if (newValue !== currentContent) {
      editorView.dispatch({
        changes: { from: 0, to: currentContent.length, insert: newValue },
      });
    }
  },
);

/** 更新块装饰 */
watch(
  () => props.blocks,
  (blocks) => {
    if (blocks) {
      setBlocksForDecorations(blocks);
      editorView?.dispatch({}); // trigger decoration update
    }
  },
  { deep: true },
);

/** 更新只读状态 — M1 保留，后续迭代实现动态切换 */

// Expose editor content getter for E2E tests
(window as unknown as Record<string, unknown>).__markluck_getEditorContent = (): string => {
  return editorView?.state.doc.toString() ?? '';
};

onUnmounted(() => {
  editorView?.destroy();
  editorView = null;
  delete (window as unknown as Record<string, unknown>).__markluck_getEditorContent;
});

/** Expose editorView for parent access */
defineExpose({
  getEditorView: () => editorView,
  focus: () => editorView?.focus(),
});
</script>

<style scoped>
.markdown-editor {
  height: 100%;
  overflow: auto;
}

.markdown-editor :deep(.cm-editor) {
  height: 100%;
  background: var(--editor-bg);
}

.markdown-editor :deep(.cm-scroller) {
  font-family: var(--ff-mono);
  font-size: var(--text-base);
  line-height: 1.7;
  color: var(--ink-primary);
}

.markdown-editor :deep(.cm-content) {
  padding: var(--space-16);
}

.markdown-editor :deep(.cm-line) {
  padding: 0 var(--space-4);
}

.markdown-editor :deep(.cm-gutters) {
  border-right: var(--border-thin) solid var(--rule);
  background: var(--paper-bg);
  color: var(--ink-muted);
}

.markdown-editor :deep(.cm-activeLine) {
  background: var(--editor-line-highlight);
}

.markdown-editor :deep(.cm-cursor) {
  border-left-color: var(--editor-cursor);
}

.markdown-editor :deep(.cm-selectionBackground) {
  background: var(--editor-selection) !important;
}

/* Block marker styles */
.markdown-editor :deep(.cm-block-marker--source) {
  border-left: var(--border-medium) solid var(--accent);
}

.markdown-editor :deep(.cm-block-marker--render) {
  border-left: var(--border-medium) solid var(--signal-success);
}

.markdown-editor :deep(.cm-block-marker--invalid) {
  border-left: var(--border-medium) solid var(--signal-error);
}

/* ===== Live Preview Styles ===== */

/* Hidden syntax markers */
.markdown-editor :deep(.cm-live-hidden) {
  font-size: 0 !important;
  opacity: 0 !important;
  pointer-events: none !important;
  user-select: none !important;
  color: transparent !important;
  display: inline !important;
  line-height: 0 !important;
  letter-spacing: 0 !important;
  word-spacing: 0 !important;
  vertical-align: middle !important;
  text-decoration: none !important;
  max-width: 0 !important;
  padding: 0 !important;
  margin: 0 !important;
  border: none !important;
}

/* Block markers: colored left borders */
.markdown-editor :deep(.cm-live-marker--source) {
  border-left: var(--border-medium) solid var(--accent);
}

.markdown-editor :deep(.cm-live-marker--live) {
  border-left: var(--border-medium) solid var(--signal-success);
}

/* Headings */
.markdown-editor :deep(.cm-live-heading) {
  font-weight: var(--fw-bold);
  color: var(--ink-primary);
}

.markdown-editor :deep(.cm-live-h1) {
  font-size: 1.8em;
  line-height: var(--lh-heading);
}

.markdown-editor :deep(.cm-live-h2) {
  font-size: 1.5em;
  line-height: var(--lh-heading);
}

.markdown-editor :deep(.cm-live-h3) {
  font-size: 1.25em;
  line-height: var(--lh-heading);
}

.markdown-editor :deep(.cm-live-h4) {
  font-size: 1.1em;
}

.markdown-editor :deep(.cm-live-h5) {
  font-size: 1em;
}

.markdown-editor :deep(.cm-live-h6) {
  font-size: 0.9em;
  color: var(--ink-secondary);
}

/* Inline formatting */
.markdown-editor :deep(.cm-live-bold) {
  font-weight: var(--fw-bold);
}
.markdown-editor :deep(.cm-live-italic) {
  font-style: italic;
}

.markdown-editor :deep(.cm-live-strikethrough) {
  text-decoration: line-through;
  color: var(--ink-muted);
}

/* Image rendering */
.markdown-editor :deep(.cm-live-image-wrap) {
  display: inline-block;
  vertical-align: middle;
  margin: 2px 0;
  line-height: 0;
  max-width: 100%;
}

.markdown-editor :deep(.cm-live-image) {
  max-width: 100%;
  max-height: 300px;
  border-radius: var(--radius);
  border: var(--border-thin) solid var(--rule);
}

/* Task checkbox */
.markdown-editor :deep(.cm-live-checkbox-wrap) {
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
  margin-right: 4px;
}

.markdown-editor :deep(.cm-live-checkbox) {
  width: 14px;
  height: 14px;
  margin: 0;
  cursor: pointer;
  accent-color: var(--accent);
}

/* Inline code */
.markdown-editor :deep(.cm-live-code) {
  font-family: var(--ff-mono);
  background: var(--code-bg);
  color: var(--code-text);
  padding: 1px 4px;
  border-radius: var(--radius);
  font-size: 0.9em;
}

/* Code blocks */
.markdown-editor :deep(.cm-live-codeblock) {
  background: var(--code-block-bg);
  font-family: var(--ff-mono);
  font-size: 0.9em;
  padding-left: var(--space-8);
}

/* Blockquote */
.markdown-editor :deep(.cm-live-blockquote) {
  border-left: 4px solid var(--blockquote-rule);
  padding-left: var(--space-12);
  color: var(--ink-secondary);
}

/* Horizontal rule widget */
.markdown-editor :deep(.cm-live-hr) {
  border-top: var(--border-medium) solid var(--rule);
  margin: var(--space-8) 0;
  height: 0;
}

/* Wiki-link */
.markdown-editor :deep(.cm-live-wikilink) {
  color: var(--link);
  text-decoration: underline dotted;
  cursor: pointer;
}

/* Inline tag */
.markdown-editor :deep(.cm-live-tag) {
  color: var(--accent);
  background: var(--accent-soft);
  padding: 0 4px;
  border-radius: var(--radius);
  font-size: 0.85em;
}

/* URL detection */
.markdown-editor :deep(.cm-live-url) {
  color: var(--link);
  text-decoration: underline;
  cursor: pointer;
}

/* Markdown link — display text */
.markdown-editor :deep(.cm-live-link-text) {
  color: var(--link);
  text-decoration: underline;
  cursor: pointer;
}

/* Markdown link — URL portion */
.markdown-editor :deep(.cm-live-link-url) {
  color: var(--ink-muted);
  font-size: 0.85em;
}

/* ===== Dark Mode: Editor Chrome ===== */
[data-color-scheme='dark'] .markdown-editor :deep(.cm-editor) {
  background: var(--editor-bg);
}

[data-color-scheme='dark'] .markdown-editor :deep(.cm-gutters) {
  background: var(--paper-bg);
  border-right-color: var(--rule);
  color: var(--ink-muted);
}

[data-color-scheme='dark'] .markdown-editor :deep(.cm-activeLine) {
  background: var(--editor-line-highlight);
}

[data-color-scheme='dark'] .markdown-editor :deep(.cm-cursor) {
  border-left-color: var(--editor-cursor);
}
</style>
