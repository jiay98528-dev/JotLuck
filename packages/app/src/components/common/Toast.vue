<template>
  <Teleport to="body">
    <div
      class="toast-container"
      :class="`toast-container--${position}`"
      role="status"
      aria-live="polite"
      aria-atomic="false"
    >
      <TransitionGroup name="toast" tag="div" class="toast-stack">
        <div v-for="t in toasts" :key="t.id" class="toast" :class="`toast--${t.type}`" role="alert">
          <span class="toast-icon">
            <slot name="icon" :toast="t">{{ t.icon ?? defaultIcons[t.type] }}</slot>
          </span>
          <span class="toast-msg">
            <slot name="message" :toast="t">{{ t.message }}</slot>
          </span>
          <button
            v-if="t.closable"
            class="toast-close"
            :aria-label="'关闭通知：' + t.message"
            title="关闭"
            @click="dismissToast(t.id)"
          >
            &times;
          </button>
          <button v-if="t.action" class="toast-action" @click="handleAction(t)">
            <slot name="action" :toast="t">{{ t.actionLabel }}</slot>
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<!-- ── Module exports (types + composable) ───────────────────────────── -->

<script lang="ts">
import { ref } from 'vue';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  icon?: string;
  duration: number;
  closable: boolean;
  timer?: ReturnType<typeof setTimeout>;
  action?: () => void;
  actionLabel?: string;
}

export interface ToastAPI {
  /** Show a toast notification. duration in ms, 0 = persist until dismissed. */
  show(message: string, type?: ToastType, duration?: number): void;
  /** Show a success toast (3000ms default). */
  success(message: string, duration?: number): void;
  /** Show a warning toast (3000ms default). */
  warning(message: string, duration?: number): void;
  /** Show an error toast (0ms default — persists until dismissed). */
  error(message: string, duration?: number): void;
  /** Show an info toast (3000ms default). */
  info(message: string, duration?: number): void;
  /** Dismiss all visible toasts immediately. */
  dismiss(): void;
}

// ── Module-level reactive state (singleton, no provide/inject needed) ──

const moduleToasts = ref<ToastItem[]>([]);
let moduleNextId = 0;
const MAX_VISIBLE = 5;

function moduleRemove(id: number): void {
  const idx = moduleToasts.value.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const t = moduleToasts.value[idx]!;
  if (t.timer) clearTimeout(t.timer);
  moduleToasts.value.splice(idx, 1);
}

function moduleAdd(toast: ToastItem): void {
  // Enforce max visible
  while (moduleToasts.value.length >= MAX_VISIBLE) {
    const oldest = moduleToasts.value.shift()!;
    if (oldest.timer) clearTimeout(oldest.timer);
  }
  moduleToasts.value.push(toast);
  if (toast.duration > 0) {
    toast.timer = setTimeout(() => moduleRemove(toast.id), toast.duration);
  }
}

export function useToast(): ToastAPI {
  function show(message: string, type: ToastType = 'info', duration = 3000): void {
    moduleAdd({
      id: moduleNextId++,
      message,
      type,
      duration: duration < 0 ? 0 : duration,
      closable: true,
    });
  }
  return {
    show,
    success: (msg, dur = 3000) => show(msg, 'success', dur),
    warning: (msg, dur = 3000) => show(msg, 'warning', dur),
    error: (msg, dur = 0) => show(msg, 'error', dur),
    info: (msg, dur = 3000) => show(msg, 'info', dur),
    dismiss: () => {
      moduleToasts.value.forEach((t) => {
        if (t.timer) clearTimeout(t.timer);
      });
      moduleToasts.value = [];
    },
  };
}
</script>

<!-- ── Component (reads module-level reactive state) ─────────────────── -->

<script setup lang="ts">
/**
 * Toast.vue — Global notification system
 *
 * Module-level reactive state. Mount `<Toast />` once per app. Any code
 * can call `useToast()` regardless of component hierarchy.
 */
import { onBeforeUnmount } from 'vue';

withDefaults(
  defineProps<{
    position?: 'top-center' | 'top-right' | 'bottom-center' | 'bottom-right';
    maxVisible?: number;
  }>(),
  {
    position: 'top-center',
    maxVisible: 5,
  },
);

const emit = defineEmits<{
  close: [toastId: number];
  action: [toastId: number, toast: ToastItem];
}>();

const defaultIcons: Record<ToastType, string> = {
  info: 'ℹ',
  success: '✓',
  warning: '⚠',
  error: '✕',
};

// Expose module state to template
const toasts = moduleToasts;

function dismissToast(id: number): void {
  emit('close', id);
  moduleRemove(id);
}

function handleAction(t: ToastItem): void {
  emit('action', t.id, t);
  if (t.action) t.action();
  moduleRemove(t.id);
}

onBeforeUnmount(() => {
  moduleToasts.value.forEach((t) => {
    if (t.timer) clearTimeout(t.timer);
  });
  moduleToasts.value = [];
});
</script>

<!-- ── Styles ────────────────────────────────────────────────────────── -->

<style scoped>
/* ─── Container ─────────────────────────────────────────────────────── */

.toast-container {
  position: fixed;
  z-index: var(--z-toast);
  pointer-events: none;
}

.toast-stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

/* top-center (default) */
.toast-container--top-center {
  top: var(--space-16);
  left: 50%;
  transform: translateX(-50%);
}

/* top-right */
.toast-container--top-right {
  top: var(--space-16);
  right: var(--space-16);
}

/* bottom-center */
.toast-container--bottom-center {
  bottom: var(--space-16);
  left: 50%;
  transform: translateX(-50%);
}

/* bottom-right */
.toast-container--bottom-right {
  bottom: var(--space-16);
  right: var(--space-16);
}

/* ─── Toast Card ────────────────────────────────────────────────────── */

.toast {
  display: flex;
  align-items: flex-start;
  gap: var(--space-8);
  padding: var(--space-12) var(--space-16);
  border-radius: var(--radius);
  font-size: var(--text-sm);
  line-height: var(--lh-ui);
  pointer-events: auto;
  box-shadow: var(--shadow-float);
  min-width: 220px;
  max-width: 420px;
  border: var(--border-thin) solid transparent;
}

/* ─── Type Variants (signal tokens) ─────────────────────────────────── */

.toast--info {
  background: var(--paper-raised);
  color: var(--ink-primary);
  border-color: var(--rule);
}

.toast--success {
  background: var(--signal-success-soft);
  color: var(--signal-success);
  border-color: var(--signal-success);
}

.toast--warning {
  background: var(--signal-warning-soft);
  color: var(--signal-warning);
  border-color: var(--signal-warning);
}

.toast--error {
  background: var(--signal-error-soft);
  color: var(--signal-error);
  border-color: var(--signal-error);
}

/* ─── Icon ──────────────────────────────────────────────────────────── */

.toast-icon {
  font-size: var(--text-base);
  line-height: var(--lh-none);
  flex-shrink: 0;
  margin-top: 1px;
}

/* ─── Message ───────────────────────────────────────────────────────── */

.toast-msg {
  flex: 1;
  overflow-wrap: break-word;
}

/* ─── Close Button ──────────────────────────────────────────────────── */

.toast-close {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  color: inherit;
  font-size: var(--text-lg);
  line-height: var(--lh-none);
  cursor: pointer;
  opacity: var(--opacity-inactive);
  border-radius: var(--radius);
  transition: opacity var(--dur-press) var(--ease-press);
  margin-top: -1px;
}

.toast-close:hover {
  opacity: 1;
}

/* ─── Action Button ─────────────────────────────────────────────────── */

.toast-action {
  flex-shrink: 0;
  border: var(--border-thin) solid currentcolor;
  background: none;
  color: inherit;
  font-size: var(--text-xs);
  font-weight: var(--fw-semibold);
  padding: var(--space-4) var(--space-8);
  border-radius: var(--radius);
  cursor: pointer;
  white-space: nowrap;
  transition:
    background var(--dur-press) var(--ease-press),
    opacity var(--dur-press) var(--ease-press);
}

.toast-action:hover {
  opacity: 0.8;
}

/* ─── Transitions ───────────────────────────────────────────────────── */

/*
 * Enter: slideDown + fadeIn (~300ms via --dur-page)
 * Exit:  slideUp + fadeOut (~200ms via --dur-release)
 *
 * Direction adapts to container position:
 *   top    → enter slides down from above, exit slides up out
 *   bottom → enter slides up from below,  exit slides down out
 */

/* --- Top positions --- */
.toast-container--top-center .toast-enter-active,
.toast-container--top-right .toast-enter-active {
  animation: toast-slide-down-in var(--dur-page) var(--ease-enter);
}

.toast-container--top-center .toast-leave-active,
.toast-container--top-right .toast-leave-active {
  animation: toast-slide-up-out var(--dur-release) var(--ease-exit);
}

/* --- Bottom positions --- */
.toast-container--bottom-center .toast-enter-active,
.toast-container--bottom-right .toast-enter-active {
  animation: toast-slide-up-in var(--dur-page) var(--ease-enter);
}

.toast-container--bottom-center .toast-leave-active,
.toast-container--bottom-right .toast-leave-active {
  animation: toast-slide-down-out var(--dur-release) var(--ease-exit);
}

/* --- TransitionGroup move (when items shift after removal) --- */
.toast-move {
  transition: transform var(--dur-collapse) var(--ease-enter);
}

/* --- Keyframes --- */

@keyframes toast-slide-down-in {
  from {
    opacity: 0;
    transform: translateY(-16px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes toast-slide-up-out {
  from {
    opacity: 1;
    transform: translateY(0);
  }

  to {
    opacity: 0;
    transform: translateY(-16px);
  }
}

@keyframes toast-slide-up-in {
  from {
    opacity: 0;
    transform: translateY(16px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes toast-slide-down-out {
  from {
    opacity: 1;
    transform: translateY(0);
  }

  to {
    opacity: 0;
    transform: translateY(16px);
  }
}
</style>
