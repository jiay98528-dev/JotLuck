<template>
  <button
    class="toolbar-btn"
    :class="{ 'toolbar-btn--active': active }"
    :disabled="disabled"
    :title="tooltip"
    :aria-pressed="active"
    @click="$emit('click')"
  >
    <span class="toolbar-btn__icon">{{ icon }}</span>
    <span v-if="!compact" class="toolbar-btn__label">{{ label }}</span>
    <span v-if="!compact && shortcut" class="toolbar-btn__shortcut">{{ shortcut }}</span>
  </button>
</template>

<script setup lang="ts">
/**
 * ToolbarButton.vue — 工具栏按钮（纸张主题 + 弹簧物理动画）
 *
 * Four-state button with spring physics:
 *   default → hover: micro-lift + surface tint (120ms)
 *   hover → press: scale(0.96) (60ms)
 *   press → release: scale(1.03) → scale(1.0) spring return (200ms)
 *   disabled: opacity 0.35, no interaction
 *   focus-visible: breathing accent ring (2s cycle)
 *   active/toggled: accent background + border
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    icon: string;
    label: string;
    shortcut?: string;
    active?: boolean;
    disabled?: boolean;
    compact?: boolean;
  }>(),
  {
    shortcut: '',
    active: false,
    disabled: false,
    compact: false,
  },
);

defineEmits<{
  click: [];
}>();

const tooltip = computed(() => {
  const parts = [props.label];
  if (props.shortcut) parts.push(`(${props.shortcut})`);
  return parts.join(' ');
});
</script>

<script lang="ts">
export default { name: 'ToolbarButton' };
</script>

<style scoped>
.toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-8);
  border: var(--border-thin) solid transparent;
  border-radius: var(--radius);
  background: none;
  color: var(--ink-secondary);
  font-size: var(--text-xs);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  position: relative;
  transform: translateY(0) scale(1);
  transition:
    background var(--dur-micro) var(--ease-fade),
    color var(--dur-micro) var(--ease-fade),
    border-color var(--dur-micro) var(--ease-fade),
    transform var(--dur-press) var(--ease-press),
    box-shadow var(--dur-micro) var(--ease-fade);
}

/* --- Disabled --- */
.toolbar-btn:disabled {
  opacity: var(--opacity-disabled);
  cursor: not-allowed;
  transform: none;
  pointer-events: none;
}

/* --- Focus-visible: breathing accent ring --- */
.toolbar-btn:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 var(--focus-ring-offset) var(--paper-bg),
    0 0 0 calc(var(--focus-ring-offset) + var(--focus-ring-width)) var(--accent);
  animation: focus-breathe var(--dur-breathe) ease-in-out infinite;
}

@keyframes focus-breathe {
  0%,
  100% {
    box-shadow:
      0 0 0 var(--focus-ring-offset) var(--paper-bg),
      0 0 0 calc(var(--focus-ring-offset) + var(--focus-ring-width)) var(--accent-ring);
  }

  50% {
    box-shadow:
      0 0 0 var(--focus-ring-offset) var(--paper-bg),
      0 0 0 calc(var(--focus-ring-offset) + 3px) var(--accent);
  }
}

/* --- Spring release after press --- */
.toolbar-btn:not(:active, :disabled) {
  animation: spring-release var(--dur-release) var(--ease-back) forwards;
}

@keyframes spring-release {
  0% {
    transform: scale(0.96);
  }

  40% {
    transform: scale(1.03);
  }

  100% {
    transform: scale(1);
  }
}

/* --- Hover: micro-lift + surface tint --- */
.toolbar-btn:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--ink-primary);
  border-color: var(--rule);
  transform: translateY(-1px);
}

/* --- Active/press: scale down (simulate paper depression) --- */
.toolbar-btn:active:not(:disabled) {
  background: var(--surface-active);
  transform: scale(0.96);
  transition:
    background var(--dur-press) var(--ease-press),
    transform var(--dur-press) var(--ease-press);
}

/* --- Toggled/active state --- */
.toolbar-btn--active {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent);
  opacity: 0.9;
}

.toolbar-btn--active:hover:not(:disabled) {
  background: var(--accent-soft);
  opacity: 1;
  color: var(--accent-hover);
}

/* --- Icon --- */
.toolbar-btn__icon {
  font-size: var(--text-sm);
  font-weight: var(--fw-bold);
  width: 18px;
  text-align: center;
  line-height: var(--lh-none);
}

/* --- Label --- */
.toolbar-btn__label {
  font-size: var(--text-xs);
  font-weight: var(--fw-medium);
}

/* --- Shortcut hint --- */
.toolbar-btn__shortcut {
  font-size: 10px;
  color: var(--ink-muted);
  margin-left: 2px;
  font-family: var(--ff-mono);
}
</style>
