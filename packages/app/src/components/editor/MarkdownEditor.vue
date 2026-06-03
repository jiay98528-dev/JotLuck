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
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import {
  markluckExtensions,
  markdownKeymap,
  setBlocksForDecorations,
} from '@/utils/cm6-extensions';
import type { MarkdownBlock } from '@/types';

// M1 syntax highlighting theme (OKLCH-based minimal light)
const markluckHighlightStyle = HighlightStyle.define([
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
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  'blocks-updated': [blocks: MarkdownBlock[]];
}>();

const editorContainer = ref<HTMLElement | null>(null);
let editorView: EditorView | null = null;

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
      syntaxHighlighting(markluckHighlightStyle),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      keymap.of(Object.entries(markdownKeymap()).map(([key, fn]) => ({ key, run: fn }))),
      updateListener,
      ...markluckExtensions(),
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

onUnmounted(() => {
  editorView?.destroy();
  editorView = null;
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
  background: #fff;
}

.markdown-editor :deep(.cm-scroller) {
  font-family: var(--font-mono, 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace);
  font-size: var(--text-base, 14px);
  line-height: 1.7;
}

.markdown-editor :deep(.cm-content) {
  padding: 16px;
}

.markdown-editor :deep(.cm-line) {
  padding: 0 4px;
}

.markdown-editor :deep(.cm-gutters) {
  border-right: 1px solid #e8e8e8;
  background: #fafafa;
  color: #999;
}

.markdown-editor :deep(.cm-activeLine) {
  background: oklch(0.97 0.003 260);
}

.markdown-editor :deep(.cm-cursor) {
  border-left-color: oklch(0.3 0.01 260);
}

.markdown-editor :deep(.cm-selectionBackground) {
  background: oklch(0.6 0.15 230 / 0.25) !important;
}

/* Block marker styles */
.markdown-editor :deep(.cm-block-marker--source) {
  border-left: 3px solid oklch(0.6 0.15 255);
}

.markdown-editor :deep(.cm-block-marker--render) {
  border-left: 3px solid oklch(0.6 0.15 145);
}

.markdown-editor :deep(.cm-block-marker--invalid) {
  border-left: 3px solid oklch(0.5 0.15 25);
}

/* Rendered block widget */
.markdown-editor :deep(.cm-rendered-block) {
  padding: var(--space-4, 4px) 0;
}
</style>
