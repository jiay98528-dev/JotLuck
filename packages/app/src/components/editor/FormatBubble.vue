<template>
  <Teleport to="body">
    <Transition name="bubble">
      <div
        v-if="isShown"
        ref="bubbleRef"
        class="format-bubble"
        :style="bubbleStyle"
        role="toolbar"
        aria-label="文本格式"
        @mouseenter="resetInactivityTimer"
        @mousemove="resetInactivityTimer"
      >
        <Button
          variant="ghost"
          size="icon-sm"
          class="bubble-btn bubble-btn--bold"
          title="加粗 (Ctrl+B)"
          aria-label="加粗"
          @mousedown.prevent
          @click="emitFormat('bold')"
          >B</Button
        >
        <Button
          variant="ghost"
          size="icon-sm"
          class="bubble-btn bubble-btn--italic"
          title="斜体 (Ctrl+I)"
          aria-label="斜体"
          @mousedown.prevent
          @click="emitFormat('italic')"
          >I</Button
        >
        <Button
          variant="ghost"
          size="icon-sm"
          class="bubble-btn"
          title="删除线"
          aria-label="删除线"
          @mousedown.prevent
          @click="emitFormat('strikethrough')"
          >S</Button
        >
        <Button
          variant="ghost"
          size="icon-sm"
          class="bubble-btn bubble-btn--mono"
          title="行内代码 (Ctrl+`)"
          aria-label="行内代码"
          @mousedown.prevent
          @click="emitFormat('inlineCode')"
          >&lt;/&gt;</Button
        >
        <Button
          variant="ghost"
          size="icon-sm"
          class="bubble-btn"
          title="链接 (Ctrl+K)"
          aria-label="链接"
          @mousedown.prevent
          @click="emitFormat('link')"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        </Button>
        <span class="bubble-divider" aria-hidden="true" />
        <Button
          variant="ghost"
          size="icon-sm"
          class="bubble-btn bubble-btn--clear"
          title="清除格式"
          aria-label="清除格式"
          @mousedown.prevent
          @click="emitFormat('clear')"
        >
          Tx
        </Button>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * FormatBubble.vue — 浮动格式气泡 (Medium-style)
 *
 * 当编辑器中有文本选中时，出现在选区上方的格式工具栏。
 * 五种格式：加粗、斜体、删除线、行内代码、链接。
 *
 * Props:
 *   visible  — 父组件控制显示/隐藏
 *   position — 选区中心坐标 { x, y }，气泡将定位在 y 上方 48px 处并水平居中
 *
 * Emits:
 *   format — 用户点击了某个格式按钮，payload 为格式类型字符串
 *
 * Behavior:
 *   - 150ms 延迟后以 scale+opacity 动画入场（非过冲 ease-out）
 *   - ease-exit 退场
 *   - 3s 无操作自动隐藏
 *   - Esc 键隐藏
 *   - 点击气泡外隐藏
 *
 * @see MarkdownEditor.vue — 父组件通过 selection-change 事件驱动 position
 * @see spec/frontend/migration-map.md §1.2
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import Button from '@/components/common/Button.vue';
import type { FormatAction } from '@/types';

// ============================================================
// Constants
// ============================================================
const SHOW_DELAY = 150;
const INACTIVITY_DELAY = 3000;
const BUBBLE_OFFSET_Y = 48;

// ============================================================
// Props & Emits
// ============================================================
const props = withDefaults(
  defineProps<{
    visible?: boolean;
    position?: { x: number; y: number };
  }>(),
  {
    visible: false,
    position: () => ({ x: 0, y: 0 }),
  },
);

const emit = defineEmits<{
  format: [type: FormatAction];
}>();

// ============================================================
// Internal State
// ============================================================
const isShown = ref(false);
const bubbleRef = ref<HTMLElement | null>(null);

let showTimer: ReturnType<typeof setTimeout> | null = null;
let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

// ============================================================
// Computed Styles
// ============================================================
const bubbleStyle = computed(() => {
  const top = Math.max(8, props.position.y - BUBBLE_OFFSET_Y);
  const left = props.position.x;
  return {
    top: `${top}px`,
    left: `${left}px`,
  };
});

// ============================================================
// Show / Hide Helpers
// ============================================================
function show(): void {
  if (showTimer) clearTimeout(showTimer);
  showTimer = setTimeout(() => {
    isShown.value = true;
    resetInactivityTimer();
  }, SHOW_DELAY);
}

function hide(): void {
  if (showTimer) clearTimeout(showTimer);
  showTimer = null;
  isShown.value = false;
  clearInactivityTimer();
}

function resetInactivityTimer(): void {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    isShown.value = false;
  }, INACTIVITY_DELAY);
}

function clearInactivityTimer(): void {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
}

// ============================================================
// Event Handlers
// ============================================================
function emitFormat(type: FormatAction): void {
  emit('format', type);
  resetInactivityTimer();
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && isShown.value) {
    isShown.value = false;
  }
}

function onClickOutside(e: PointerEvent): void {
  if (!isShown.value || !bubbleRef.value) return;
  const target = e.target as HTMLElement;
  if (!bubbleRef.value.contains(target)) {
    isShown.value = false;
  }
}

// ============================================================
// Watchers
// ============================================================
watch(
  () => props.visible,
  (val) => {
    if (val) show();
    else hide();
  },
  { immediate: true },
);

// ============================================================
// Lifecycle
// ============================================================
onMounted(() => {
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('pointerdown', onClickOutside);
});

onUnmounted(() => {
  hide();
  document.removeEventListener('keydown', onKeydown);
  document.removeEventListener('pointerdown', onClickOutside);
});
</script>

<style scoped>
/* ============================================================
 * Root — Floating Bubble
 * ============================================================ */
.format-bubble {
  position: fixed;
  z-index: var(--z-dropdown, 900);
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4);
  background: var(--paper-raised);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius, 2px);
  box-shadow: var(--shadow-stack);
  transform: translateX(-50%);
  will-change: transform, opacity;
  user-select: none;
}

.bubble-divider {
  width: var(--border-thin);
  height: 20px;
  background: var(--rule);
}

.bubble-btn--clear {
  font-family: var(--ff-body);
  font-size: var(--text-xs);
  color: var(--ink-muted);
}

/* ============================================================
 * Vue Transition — Enter / Leave Animations
 * ============================================================ */
.bubble-enter-active {
  animation: bubble-in var(--dur-release) var(--ease-back);
}

.bubble-leave-active {
  animation: bubble-out var(--dur-collapse) var(--ease-exit);
}

@keyframes bubble-in {
  from {
    opacity: 0;
    transform: translateX(-50%) scale(0.9);
  }

  to {
    opacity: 1;
    transform: translateX(-50%) scale(1);
  }
}

@keyframes bubble-out {
  from {
    opacity: 1;
    transform: translateX(-50%) scale(1);
  }

  to {
    opacity: 0;
    transform: translateX(-50%) scale(0.95);
  }
}

/* ============================================================
 * Accessibility — Reduced Motion
 * ============================================================ */
@media (prefers-reduced-motion: reduce) {
  .bubble-enter-active,
  .bubble-leave-active {
    animation: none;
  }

  .mk-btn {
    transition: none !important;
  }
}

/* ============================================================
 * Touch — Larger tap targets on coarse pointers
 * ============================================================ */
@media (pointer: coarse) {
  .bubble-btn {
    width: 36px;
    height: 36px;
  }
}
</style>
