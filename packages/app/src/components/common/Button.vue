<template>
  <button :class="computedClasses" :disabled="disabled || loading" :type="type" v-bind="$attrs">
    <!-- Loading spinner -->
    <span v-if="loading" class="mk-btn__spinner" aria-hidden="true" />

    <!-- Left icon -->
    <span v-if="$slots['icon-left'] && !loading" class="mk-btn__icon mk-btn__icon--left">
      <slot name="icon-left" />
    </span>

    <!-- Label -->
    <span v-if="$slots.default" class="mk-btn__label">
      <slot />
    </span>

    <!-- Right icon -->
    <span v-if="$slots['icon-right']" class="mk-btn__icon mk-btn__icon--right">
      <slot name="icon-right" />
    </span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { buttonVariants } from './button-variants';
import type { ButtonVariant, ButtonSize } from './button-variants';

// ── Props ──────────────────────────────────────────────
const props = withDefaults(
  defineProps<{
    variant?: ButtonVariant;
    size?: ButtonSize;
    disabled?: boolean;
    loading?: boolean;
    type?: 'button' | 'submit' | 'reset';
  }>(),
  {
    variant: 'default',
    size: 'md',
    disabled: false,
    loading: false,
    type: 'button',
  },
);

// ── Computed ───────────────────────────────────────────
const computedClasses = computed<string>(() =>
  buttonVariants({ variant: props.variant, size: props.size }),
);
</script>

<style scoped>
/* ============================================================
 * mk-btn — Flat Rounded Button System
 *
 * Variants: default, secondary, outline, ghost, destructive, link
 * Sizes:    sm (28px), md (34px), lg (42px),
 *           icon-sm (28px²), icon (34px²), icon-lg (42px²)
 *
 * Design: 6px radius, single-layer shadows, linear press, 120ms hover.
 * ============================================================ */

/* ===== Base Reset ===== */
.mk-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-8);
  border-radius: var(--radius);
  font-family: var(--ff-body);
  font-weight: var(--fw-medium);
  line-height: var(--lh-none);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  border: var(--border-thin) solid transparent;
  outline: none;
  flex-shrink: 0;
  text-decoration: none;

  /* Flat transitions — fast, no overshoot */
  transition:
    transform 120ms ease-out,
    box-shadow 120ms ease-out,
    background 100ms ease-out,
    color 100ms ease-out,
    border-color 100ms ease-out;
}

/* ===== Focus Visible ===== */
.mk-btn:focus-visible {
  outline: var(--focus-ring-width) solid var(--accent);
  outline-offset: var(--focus-ring-offset);
}

/* ===== Disabled ===== */
.mk-btn:disabled {
  opacity: var(--opacity-disabled);
  cursor: not-allowed;
  pointer-events: none;
  transform: none;
  box-shadow: none;
}

/* ===== Hover: Subtle Lift ===== */
.mk-btn:hover:not(:disabled, .mk-btn--loading) {
  transform: translateY(-1px);
  box-shadow: var(--shadow-stack);
}

/* ===== Active: Flat Press ===== */
.mk-btn:active:not(:disabled, .mk-btn--loading) {
  transform: scale(0.97);
  box-shadow: var(--shadow-sheet);
  transition:
    transform 80ms linear,
    box-shadow 80ms linear;
}

/* ===== Loading ===== */
.mk-btn--loading {
  cursor: wait !important;
  pointer-events: none;
}

/* ============================================================
 * Variants
 * ============================================================ */

/* --- default: filled accent --- */
.mk-btn--default {
  background: var(--accent);
  color: oklch(1 0 0);
  border-color: var(--accent);
}

.mk-btn--default:hover:not(:disabled, .mk-btn--loading) {
  background: var(--accent-hover);
}

/* --- secondary: muted paper surface --- */
.mk-btn--secondary {
  background: var(--paper-surface);
  color: var(--ink-secondary);
  border-color: var(--rule);
}

.mk-btn--secondary:hover:not(:disabled, .mk-btn--loading) {
  background: var(--surface-hover);
  color: var(--ink-primary);
}

/* --- outline: bordered transparent --- */
.mk-btn--outline {
  background: transparent;
  color: var(--ink-primary);
  border-color: var(--rule);
}

.mk-btn--outline:hover:not(:disabled, .mk-btn--loading) {
  background: var(--surface-hover);
}

/* --- ghost: bare, bg appears on hover --- */
.mk-btn--ghost {
  background: transparent;
  color: var(--ink-secondary);
  border-color: transparent;
}

.mk-btn--ghost:hover:not(:disabled, .mk-btn--loading) {
  background: var(--surface-hover);
  color: var(--ink-primary);
}

/* --- destructive: signal-error --- */
.mk-btn--destructive {
  background: var(--signal-error);
  color: oklch(1 0 0);
  border-color: var(--signal-error);
}

.mk-btn--destructive:focus-visible {
  outline-color: var(--signal-error);
}

.mk-btn--destructive:hover:not(:disabled, .mk-btn--loading) {
  background: var(--signal-error-hover);
}

/* --- link: text-only, underline on hover --- */
.mk-btn--link {
  background: transparent;
  color: var(--link);
  border-color: transparent;
  box-shadow: none;
}

.mk-btn--link:hover:not(:disabled, .mk-btn--loading) {
  background: transparent;
  text-decoration: underline;
  text-underline-offset: 0.2em;
  box-shadow: none;
  transform: none;
}

.mk-btn--link:active:not(:disabled, .mk-btn--loading) {
  transform: scale(0.97);
  box-shadow: none;
}

/* ============================================================
 * Sizes
 * ============================================================ */

.mk-btn--sm {
  height: 28px;
  padding: 0 var(--space-8);
  font-size: var(--text-xs);
  gap: var(--space-4);
}

.mk-btn--md {
  height: 34px;
  padding: 0 var(--space-12);
  font-size: var(--text-sm);
}

.mk-btn--lg {
  height: 42px;
  padding: 0 var(--space-16);
  font-size: var(--text-base);
}

/* Icon sizes — square, no padding */
.mk-btn--icon-sm {
  width: 28px;
  height: 28px;
  padding: 0;
}

.mk-btn--icon {
  width: 34px;
  height: 34px;
  padding: 0;
}

.mk-btn--icon-lg {
  width: 42px;
  height: 42px;
  padding: 0;
}

/* ============================================================
 * Inner Elements
 * ============================================================ */

/* --- Spinner --- */
.mk-btn__spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid currentcolor;
  border-top-color: transparent;
  border-right-color: transparent;
  border-radius: var(--radius-full);
  animation: mk-btn-spin 0.6s linear infinite;
  flex-shrink: 0;
}

.mk-btn--sm .mk-btn__spinner {
  width: 12px;
  height: 12px;
  border-width: 1.5px;
}

.mk-btn--lg .mk-btn__spinner {
  width: 20px;
  height: 20px;
  border-width: 2.5px;
}

@keyframes mk-btn-spin {
  to {
    transform: rotate(360deg);
  }
}

/* --- Icons --- */
.mk-btn__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.mk-btn__icon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.mk-btn--sm .mk-btn__icon :deep(svg) {
  width: 14px;
  height: 14px;
}

.mk-btn--lg .mk-btn__icon :deep(svg) {
  width: 18px;
  height: 18px;
}

/* Icon-only sizes — slightly larger SVGs */
.mk-btn--icon-sm .mk-btn__icon :deep(svg),
.mk-btn--icon .mk-btn__icon :deep(svg),
.mk-btn--icon-lg .mk-btn__icon :deep(svg) {
  width: 18px;
  height: 18px;
}

/* --- Label --- */
.mk-btn__label {
  display: inline;
}

/* ============================================================
 * Reduced Motion
 * ============================================================ */
@media (prefers-reduced-motion: reduce) {
  .mk-btn {
    transition-duration: 0.01ms !important;
    transform: none !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1;
  }
}
</style>
