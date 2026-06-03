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
import {
  markluckExtensions,
  markdownKeymap,
  setBlocksForDecorations,
} from '@/utils/cm6-extensions';
import type { MarkdownBlock } from '@/types';

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
}

.markdown-editor :deep(.cm-scroller) {
  font-family: var(--font-mono, 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace);
  font-size: var(--text-base, 14px);
  line-height: 1.7;
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
