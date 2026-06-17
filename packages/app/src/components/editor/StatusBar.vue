<template>
  <footer class="status-bar" role="status" aria-label="编辑器状态栏">
    <!-- Left: cursor position -->
    <span class="status-left">
      <template v-if="cursorLine !== null">Ln {{ cursorLine }}, Col {{ cursorCol }}</template>
      <template v-else>&mdash;</template>
    </span>

    <!-- Center: document statistics + format hint -->
    <span class="status-center"
      >{{ charCount }} 字 &middot; {{ wordCount }} 词 &middot;
      <span class="status-hint">选中文字以格式化 &middot; Ctrl+点击固定区块</span></span
    >

    <!-- Right: save status -->
    <span class="status-right">
      <span v-if="saveError" class="status-error" :title="saveError">&#9888; {{ saveError }}</span>
      <span v-else-if="isSaving" class="status-saving">&#9203; 保存中&hellip;</span>
      <span v-else-if="isDirty" class="status-dirty">&#9679; 未保存</span>
      <span v-else class="status-saved" :class="{ ripple: showRipple }">&#10003; 已保存</span>
    </span>
  </footer>
</template>

<script setup lang="ts">
/**
 * StatusBar.vue — 编辑器底部 28px 状态栏
 *
 * 三区布局：左（光标位置）/ 中（字词统计）/ 右（保存状态）。
 * 保存成功后，对勾图标绿色脉冲一次，随后在 2s 内渐隐为 muted 色。
 *
 * @see migration-map.md §1.2
 * @see spec/frontend/components.md
 */
import { ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    /** 字符总数 */
    charCount?: number;
    /** 单词总数 */
    wordCount?: number;
    /** 行总数 */
    lineCount?: number;
    /** 光标所在行号 (1-based)，无光标时为 null */
    cursorLine?: number | null;
    /** 光标所在列号 (1-based) */
    cursorCol?: number | null;
    /** 是否有未保存的修改 */
    isDirty?: boolean;
    /** 是否正在保存中 */
    isSaving?: boolean;
    /** 保存错误信息，非 null 时优先显示 */
    saveError?: string | null;
    /** 上次保存成功的时间戳 (ms) */
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

// ---- Save Ripple ----
// When isSaving transitions from true → false and the document is clean,
// show a brief green pulse on the checkmark that fades to muted over 2s.
const showRipple = ref(false);
let rippleTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  () => props.isSaving,
  (saving, wasSaving) => {
    if (wasSaving && !saving && !props.isDirty && !props.saveError) {
      showRipple.value = true;
      if (rippleTimer) clearTimeout(rippleTimer);
      rippleTimer = setTimeout(() => {
        showRipple.value = false;
      }, 2000);
    }
  },
);
</script>

<style scoped>
/* ============================================================
 * Root — 28px Fixed Footer
 * ============================================================ */
.status-bar {
  height: var(--statusbar-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-12);
  border-top: var(--border-thin) solid var(--rule);
  background: var(--paper-surface);
  font-size: var(--text-xs);
  color: var(--ink-muted);
  user-select: none;
  flex-shrink: 0;
}

/* ============================================================
 * Three Sections
 * ============================================================ */
.status-left,
.status-center,
.status-right {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-left {
  flex: 0 1 auto;
  text-align: left;
}

.status-center {
  flex: 0 0 auto;
  text-align: center;
}

.status-right {
  flex: 0 1 auto;
  text-align: right;
}

.status-hint {
  color: var(--ink-muted);
  opacity: 0.7;
  font-style: italic;

  /* BUG-013: 微妙的呼吸动画吸引注意力 */
  animation: hint-breathe 4s ease-in-out infinite;
}

@keyframes hint-breathe {
  0%,
  100% {
    opacity: 0.5;
  }

  50% {
    opacity: 0.9;
  }
}

/* ============================================================
 * Save States
 * ============================================================ */

/* Dirty — amber dot */
.status-dirty {
  color: var(--signal-warning);
}

/* Saving — subtle pulse on the hourglass */
.status-saving {
  color: var(--ink-secondary);
  animation: saving-pulse 1.2s ease-in-out infinite;
}

@keyframes saving-pulse {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.45;
  }
}

/* Saved — green, with ripple on transition */
.status-saved {
  color: var(--signal-success);
  transition: color var(--dur-ripple) var(--ease-fade);
}

.status-saved.ripple {
  animation: saved-ripple var(--dur-ripple) var(--ease-fade) forwards;
}

/*
 * Ripple: quick green pulse (scale up → settle),
 * then color fades from green to muted over the remaining duration.
 */
@keyframes saved-ripple {
  0% {
    transform: scale(1.15);
    color: var(--signal-success);
    opacity: 1;
  }

  10% {
    transform: scale(1);
    color: var(--signal-success);
    opacity: 1;
  }

  100% {
    transform: scale(1);
    color: var(--ink-muted);
    opacity: 0.65;
  }
}

/* Error — red with full opacity for legibility */
.status-error {
  color: var(--signal-error);
}

/* ============================================================
 * Accessibility — Reduced Motion
 * ============================================================ */
@media (prefers-reduced-motion: reduce) {
  .status-saving {
    animation: none;
  }

  .status-saved.ripple {
    animation: none;
    color: var(--ink-muted);
    opacity: 0.65;
  }
}
</style>
