<template>
  <footer
    class="status-bar"
    :class="[`status-bar--${region.density}`, `status-bar--layout-${region.layout}`]"
    :data-density="region.density"
    :data-layout="region.layout"
    data-theme-part="status"
    role="status"
    aria-label="编辑器状态栏"
  >
    <template v-if="region.layout === 'save-only'">
      <span class="status-reader-save" data-theme-part="status-save">
        <span v-if="saveError" class="status-error" :title="saveError"
          >&#9888; {{ saveError }}</span
        >
        <span v-else-if="isSaving" class="status-saving">&#9203; 保存中...</span>
        <span v-else-if="isDirty" class="status-dirty">&#9679; 未保存</span>
        <span v-else class="status-saved" :class="{ ripple: showRipple }">&#10003; 已保存</span>
      </span>
    </template>

    <template v-else-if="region.layout === 'dashboard'">
      <span class="status-left status-left--dashboard" data-theme-part="status-metrics">
        <strong>{{ lineCount }} 行</strong>
        <span>{{ charCount }} 字 &middot; {{ wordCount }} 词</span>
      </span>
      <span class="status-center status-center--dashboard" data-theme-part="status-position">
        <template v-if="cursorLine !== null">Ln {{ cursorLine }}, Col {{ cursorCol }}</template>
        <template v-else>Ready</template>
      </span>
      <span class="status-dashboard-actions" data-theme-part="status-actions">
        <ShellActionButton
          v-for="action in actions"
          :key="action.id"
          :action="action"
          label-mode="short"
          size="sm"
        />
        <span class="status-right" data-theme-part="status-save">
          <span v-if="saveError" class="status-error" :title="saveError"
            >&#9888; {{ saveError }}</span
          >
          <span v-else-if="isSaving" class="status-saving">&#9203; 保存中...</span>
          <span v-else-if="isDirty" class="status-dirty">&#9679; 未保存</span>
          <span v-else class="status-saved" :class="{ ripple: showRipple }">&#10003; 已保存</span>
        </span>
      </span>
    </template>

    <template v-else>
      <span class="status-left" data-theme-part="status-position">
        <template v-if="cursorLine !== null">Ln {{ cursorLine }}, Col {{ cursorCol }}</template>
        <template v-else>&mdash;</template>
      </span>
      <span class="status-center" data-theme-part="status-metrics">
        {{ charCount }} 字 &middot; {{ wordCount }} 词
        <span v-if="region.layout !== 'compact'" class="status-hint">
          &middot; 选中文字以格式化 &middot; Ctrl+点击固定区块
        </span>
      </span>
      <span class="status-right" data-theme-part="status-save">
        <span v-if="saveError" class="status-error" :title="saveError"
          >&#9888; {{ saveError }}</span
        >
        <span v-else-if="isSaving" class="status-saving">&#9203; 保存中...</span>
        <span v-else-if="isDirty" class="status-dirty">&#9679; 未保存</span>
        <span v-else class="status-saved" :class="{ ripple: showRipple }">&#10003; 已保存</span>
      </span>
    </template>
  </footer>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import ShellActionButton from '@/components/layout/ShellActionButton.vue';
import type { ShellAction, StatusBarRegion } from '@/types/theme-pack';

const props = withDefaults(
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
    region?: StatusBarRegion;
    actions?: ShellAction[];
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
    region: () => ({ layout: 'full' as const, density: 'calm' as const }),
    actions: () => [],
  },
);

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

.status-bar--compact,
.status-bar--layout-compact {
  padding: 0 var(--space-8);
  font-size: 11px;
}

.status-bar--productive {
  border-top-color: var(--rule-strong);
  background: var(--paper-raised);
}

.status-bar--layout-save-only {
  justify-content: center;
  border-top-color: transparent;
  background: color-mix(in oklch, var(--paper-bg) 86%, transparent);
}

.status-bar--layout-quiet {
  background: color-mix(in oklch, var(--paper-surface) 86%, transparent);
}

.status-bar--layout-dashboard {
  gap: var(--space-12);
  height: calc(var(--statusbar-height) + 4px);
  border-top-color: color-mix(in oklch, var(--rule-strong) 88%, transparent);
  background:
    linear-gradient(
      90deg,
      color-mix(in oklch, var(--accent-soft) 24%, transparent),
      transparent 28%
    ),
    var(--paper-raised);
}

.status-left,
.status-center,
.status-right,
.status-reader-save {
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

.status-reader-save {
  color: var(--ink-muted);
}

.status-left--dashboard {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}

.status-left--dashboard strong {
  color: var(--ink-primary);
  font-weight: var(--fw-semibold);
}

.status-center--dashboard {
  color: var(--ink-secondary);
}

.status-dashboard-actions {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  min-width: 0;
  margin-left: auto;
}

.status-dashboard-actions :deep(.shell-action) {
  flex: 0 0 auto;
}

.status-hint {
  color: var(--ink-muted);
  opacity: 0.72;
  font-style: italic;
  animation: hint-breathe 4s ease-in-out infinite;
}

.status-saved {
  color: var(--signal-success);
}

.status-dirty {
  color: var(--ink-muted);
}

.status-saving {
  color: var(--accent);
}

.status-error {
  color: var(--signal-error);
  max-width: 300px;
  display: inline-block;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
}

.ripple {
  animation: save-ripple 0.6s var(--ease-fade);
}

@keyframes save-ripple {
  0% {
    opacity: 0.4;
  }

  100% {
    opacity: 1;
  }
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

@media (prefers-reduced-motion: reduce) {
  .status-hint,
  .ripple {
    animation: none;
  }
}

@media (width <= 760px) {
  .status-bar--layout-dashboard {
    flex-wrap: wrap;
    height: auto;
    padding-block: var(--space-6);
  }

  .status-dashboard-actions {
    width: 100%;
    justify-content: space-between;
  }
}
</style>
