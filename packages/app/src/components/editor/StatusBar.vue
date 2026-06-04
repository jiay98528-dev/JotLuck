<template>
  <div class="status-bar" role="status" aria-live="polite">
    <div class="status-left">
      <span v-if="cursorLine !== null && cursorLine !== undefined" class="status-item">
        行 {{ cursorLine }}:{{ cursorCol ?? '1' }}
      </span>
      <span class="status-item">{{ wordCount }} 字</span>
      <span class="status-item">{{ lineCount }} 行</span>
    </div>
    <div class="status-right">
      <!-- Saving: breathing dot -->
      <span v-if="isSaving" class="status-item status-saving" aria-busy="true">保存中</span>
      <!-- Error: solid square marker -->
      <span v-else-if="saveError" class="status-item status-error" :title="saveError"
        >保存失败</span
      >
      <!-- Dirty/unsaved: hollow circle pulse -->
      <span v-else-if="isDirty" class="status-item status-dirty">未保存</span>
      <!-- Saved: filled circle, static calm -->
      <span v-else class="status-item status-saved">已保存</span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * StatusBar.vue — 编辑器底部状态栏（纸张主题）
 *
 * Geometric status indicators with motion:
 *   Saving: breathing accent dot (pulse animation)
 *   Error: solid square marker, static
 *   Dirty/unsaved: hollow circle, subtle pulse
 *   Saved: filled circle, static calm
 *
 * Dual-channel encoding: shape (dot/circle/square) + color (accent/amber/red/green)
 */
withDefaults(
  defineProps<{
    charCount?: number;
    wordCount?: number;
    lineCount?: number;
    cursorLine?: number | null;
    cursorCol?: number | null;
    isDirty?: boolean;
    isSaving?: boolean;
    saveError?: string | null;
    lastSavedAt?: number | null;
  }>(),
  {
    charCount: 0,
    wordCount: 0,
    lineCount: 0,
    cursorLine: null,
    cursorCol: null,
    isDirty: false,
    isSaving: false,
    saveError: null,
    lastSavedAt: null,
  },
);
</script>

<script lang="ts">
export default { name: 'StatusBar' };
</script>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px var(--space-12);
  border-top: var(--border-thin) solid var(--rule);
  background: var(--paper-surface);
  font-size: var(--text-xs);
  color: var(--ink-muted);
  user-select: none;
  min-height: 24px;
  font-family: var(--ff-mono);
  letter-spacing: 0.01em;
}

.status-left,
.status-right {
  display: flex;
  gap: var(--space-16);
  align-items: center;
}

.status-item {
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 5px;
}

/* --- Dot separator between stats --- */
.status-left .status-item + .status-item::before {
  content: '·';
  margin-right: var(--space-16);
  color: var(--ink-muted);
  opacity: 0.35;
}

/* ===== Geometric Indicators ===== */

/* Saving: breathing accent dot */
.status-saving {
  color: var(--accent);
}

.status-saving::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  animation: status-breathe 1.2s ease-in-out infinite;
}

/* Error: solid square, static */
.status-error {
  color: var(--signal-error);
  cursor: help;
}

.status-error::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  background: var(--signal-error);
}

/* Dirty/unsaved: hollow circle with subtle pulse */
.status-dirty {
  color: var(--signal-warning);
}

.status-dirty::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  border: 1.5px solid var(--signal-warning);
  background: transparent;
  animation: status-pulse-warn 2s ease-in-out infinite;
}

/* Saved: filled circle, calm */
.status-saved {
  color: var(--signal-success);
}

.status-saved::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--signal-success);

  /* Draw animation: circle fills from center */
  animation: status-fill-in 300ms var(--ease-fold) forwards;
}

/* ===== Keyframes ===== */

@keyframes status-breathe {
  0%,
  100% {
    opacity: 0.3;
    transform: scale(0.8);
  }

  50% {
    opacity: 1;
    transform: scale(1.1);
  }
}

@keyframes status-pulse-warn {
  0%,
  100% {
    opacity: 0.5;
  }

  50% {
    opacity: 1;
  }
}

@keyframes status-fill-in {
  0% {
    transform: scale(0);
    opacity: 0;
  }

  60% {
    transform: scale(1.2);
  }

  100% {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
