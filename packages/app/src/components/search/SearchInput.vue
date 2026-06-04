<template>
  <div class="search-input-wrapper">
    <span class="search-icon"></span>
    <input
      ref="inputEl"
      :value="modelValue"
      class="search-input"
      :placeholder="placeholder"
      @input="onInput"
      @keydown.enter="$emit('search', modelValue)"
      @keydown.escape="$emit('escape')"
    />
    <button v-if="modelValue" class="search-clear" @click="onClear">&times;</button>
  </div>
</template>

<script setup lang="ts">
/**
 * SearchInput.vue — 搜索输入框
 *
 * M2-10: 搜索输入框，支持语法高亮提示。
 *
 * @see components.md §19
 */
import { ref } from 'vue';

withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
  }>(),
  {
    placeholder: '搜索笔记... (支持 tag:xxx /regex/ date:YYYY-MM..YYYY-MM)',
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
  search: [value: string];
  escape: [];
  clear: [];
}>();

const inputEl = ref<HTMLInputElement | null>(null);

function onInput(e: Event): void {
  const value = (e.target as HTMLInputElement).value;
  emit('update:modelValue', value);
}

function onClear(): void {
  emit('update:modelValue', '');
  emit('clear');
}

function focus(): void {
  inputEl.value?.focus();
}

defineExpose({ focus });
</script>

<style scoped>
.search-input-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border: 2px solid var(--ink-muted, oklch(0.6 0.002 85));
  border-radius: 50%;
  position: relative;
}

.search-icon::after {
  content: '';
  position: absolute;
  bottom: 2px;
  right: 0;
  width: 5px;
  height: 2px;
  background: var(--ink-muted, oklch(0.6 0.002 85));
  border-radius: 1px;
  transform: rotate(45deg);
  transform-origin: right center;
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 16px;
  font-family: var(--ff-mono, monospace);
  color: var(--ink-primary, oklch(0.15 0.003 85));
  background: transparent;
}

.search-input::placeholder {
  color: var(--ink-muted, oklch(0.6 0.002 85));
  font-size: 13px;
}

.search-clear {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  font-size: 18px;
  color: var(--ink-muted, oklch(0.6 0.002 85));
  cursor: pointer;
  border-radius: var(--radius, 2px);
}

.search-clear:hover {
  background: var(--accent-soft, oklch(0.92 0.03 250 / 0.55));
  color: var(--ink-primary, oklch(0.15 0.003 85));
}
</style>
