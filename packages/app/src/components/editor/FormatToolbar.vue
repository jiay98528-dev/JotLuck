<template>
  <div class="format-toolbar" role="toolbar" aria-label="固定格式工具栏">
    <label class="format-toolbar__preset">
      <span class="sr-only">段落样式</span>
      <select :value="displayPreset" aria-label="段落样式" @change="onPresetChange">
        <option value="paragraph">正文</option>
        <option value="heading1">标题 1</option>
        <option value="heading2">标题 2</option>
        <option value="heading3">标题 3</option>
        <option value="blockquote">引用</option>
      </select>
    </label>

    <span class="format-toolbar__divider" aria-hidden="true" />

    <Button
      v-for="item in inlineActions"
      :key="item.action"
      variant="ghost"
      size="icon-sm"
      :class="[
        'format-toolbar__button',
        item.className,
        { 'is-active': activeAction === item.action },
      ]"
      :title="item.title"
      :aria-label="item.label"
      :aria-pressed="activeAction === item.action"
      @mousedown.prevent
      @click="$emit('format', item.action)"
    >
      {{ item.icon }}
    </Button>

    <span class="format-toolbar__divider" aria-hidden="true" />

    <Button
      variant="ghost"
      size="sm"
      class="format-toolbar__clear"
      title="清除格式"
      aria-label="清除格式"
      @mousedown.prevent
      @click="$emit('format', 'clear')"
    >
      清除格式
    </Button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import Button from '@/components/common/Button.vue';
import type { FormatAction, ParagraphPreset } from '@/types';

const props = withDefaults(
  defineProps<{
    preset?: ParagraphPreset;
    activeAction?: FormatAction | null;
  }>(),
  {
    preset: 'paragraph',
    activeAction: null,
  },
);

const emit = defineEmits<{
  format: [action: FormatAction];
}>();

const paragraphPresets: readonly ParagraphPreset[] = [
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
  'blockquote',
];

const displayPreset = computed<ParagraphPreset>(() =>
  paragraphPresets.includes(props.activeAction as ParagraphPreset)
    ? (props.activeAction as ParagraphPreset)
    : props.preset,
);

const inlineActions: Array<{
  action: FormatAction;
  icon: string;
  label: string;
  title: string;
  className?: string;
}> = [
  { action: 'bold', icon: 'B', label: '加粗', title: '加粗 (Ctrl+B)', className: 'is-bold' },
  { action: 'italic', icon: 'I', label: '斜体', title: '斜体 (Ctrl+I)', className: 'is-italic' },
  { action: 'strikethrough', icon: 'S', label: '删除线', title: '删除线', className: 'is-strike' },
  {
    action: 'inlineCode',
    icon: '</>',
    label: '行内代码',
    title: '行内代码 (Ctrl+`)',
    className: 'is-code',
  },
  { action: 'link', icon: '↗', label: '链接', title: '链接 (Ctrl+K)' },
];

function onPresetChange(event: Event): void {
  emit('format', (event.target as HTMLSelectElement).value as ParagraphPreset);
}
</script>

<style scoped>
.format-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-width: 0;
  overflow-x: auto;
  padding: var(--space-4);
  scrollbar-width: thin;
}

.format-toolbar__preset select {
  height: 28px;
  min-width: 104px;
  padding: 0 var(--space-24) 0 var(--space-8);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
  color: var(--ink-primary);
  font: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
}

.format-toolbar__preset select:focus-visible {
  outline: var(--focus-ring-width) solid var(--accent);
  outline-offset: var(--focus-ring-offset);
}

.format-toolbar__divider {
  width: var(--border-thin);
  height: 20px;
  background: var(--rule);
  flex: 0 0 auto;
}

.format-toolbar__button.is-bold {
  font-weight: var(--fw-bold);
}

.format-toolbar__button.is-italic {
  font-style: italic;
}

.format-toolbar__button.is-strike {
  text-decoration: line-through;
}

.format-toolbar__button.is-code {
  width: 38px;
  font-family: var(--ff-mono);
  font-size: var(--text-xs);
}

.format-toolbar__button.is-active {
  background: var(--accent-soft);
  color: var(--accent);
}

.format-toolbar__clear {
  color: var(--ink-muted);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
</style>
