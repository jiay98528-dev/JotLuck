<template>
  <Teleport to="body">
    <Transition name="bubble">
      <div
        v-if="isShown"
        ref="bubbleRef"
        class="format-bubble"
        :style="bubbleStyle"
        role="toolbar"
        :aria-label="t('editor.toolbar.textFormat')"
        @mouseenter="resetInactivityTimer"
        @mousemove="resetInactivityTimer"
      >
        <Button
          variant="ghost"
          size="icon-sm"
          class="bubble-btn bubble-btn--bold"
          :title="t('editor.toolbar.boldTitle')"
          :aria-label="t('editor.toolbar.bold')"
          @mousedown.prevent
          @click="emitFormat('bold')"
          >B</Button
        >
        <Button
          variant="ghost"
          size="icon-sm"
          class="bubble-btn bubble-btn--italic"
          :title="t('editor.toolbar.italicTitle')"
          :aria-label="t('editor.toolbar.italic')"
          @mousedown.prevent
          @click="emitFormat('italic')"
          >I</Button
        >
        <Button
          variant="ghost"
          size="icon-sm"
          class="bubble-btn"
          :title="t('editor.toolbar.strikethrough')"
          :aria-label="t('editor.toolbar.strikethrough')"
          @mousedown.prevent
          @click="emitFormat('strikethrough')"
          >S</Button
        >
        <Button
          variant="ghost"
          size="icon-sm"
          class="bubble-btn bubble-btn--mono"
          :title="t('editor.toolbar.inlineCodeTitle')"
          :aria-label="t('editor.toolbar.inlineCode')"
          @mousedown.prevent
          @click="emitFormat('inlineCode')"
          >&lt;/&gt;</Button
        >
        <Button
          variant="ghost"
          size="icon-sm"
          class="bubble-btn"
          :title="t('editor.toolbar.linkTitle')"
          :aria-label="t('editor.toolbar.link')"
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
          :title="t('editor.toolbar.clear')"
          :aria-label="t('editor.toolbar.clear')"
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
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import Button from '@/components/common/Button.vue';
import type { FormatAction } from '@/types';
import { guardPointerClicks, isTouchInput } from '@/utils/editor-pointer';
import {
  observeEditorViewport,
  placeEditorOverlay,
  visibleEditorRect,
  type ScreenRect,
} from '@/utils/editor-overlay';

const { t } = useI18n();

// ============================================================
// Constants
// ============================================================
const SHOW_DELAY = 150;
const INACTIVITY_DELAY = 3000;

// ============================================================
// Props & Emits
// ============================================================
const props = withDefaults(
  defineProps<{
    visible?: boolean;
    position?: { x: number; y: number };
    anchor?: () => ScreenRect | null;
    editor?: () => HTMLElement | null;
  }>(),
  {
    visible: false,
    position: () => ({ x: 0, y: 0 }),
    anchor: () => null,
    editor: () => null,
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
let adjustingSelection = false;

// ============================================================
// Computed Styles
// ============================================================
const bubbleStyle = ref<Record<string, string>>({});
let removeGuard: (() => void) | undefined;
const viewport = observeEditorViewport(() => {
  const root = bubbleRef.value;
  if (!root || !isShown.value) return;
  const bounds = visibleEditorRect(props.editor?.()?.getBoundingClientRect());
  const width = Math.max(0, bounds.right - bounds.left);
  root.style.maxWidth = `${width}px`;
  const size = root.getBoundingClientRect();
  const anchor = props.anchor?.() ?? {
    left: props.position.x,
    right: props.position.x,
    top: props.position.y,
    bottom: props.position.y + 20,
  };
  const placed = placeEditorOverlay(
    {
      top: anchor.top,
      bottom: anchor.bottom,
      right: anchor.right,
      left: (anchor.left + anchor.right - size.width) / 2,
    },
    size.width,
    size.height,
    bounds,
  );
  bubbleStyle.value = {
    left: `${placed.left}px`,
    top: `${placed.top}px`,
    maxWidth: `${width}px`,
    maxHeight: `${placed.maxHeight}px`,
  };
});
watch(bubbleRef, (root) => {
  removeGuard?.();
  if (root) removeGuard = guardPointerClicks(root);
  viewport.schedule();
});
watch(() => props.position, viewport.schedule);
function selectionAdjusted(): void {
  if (bubbleRef.value?.dataset.pointerActive === 'true') return;
  if (!isTouchInput() || !props.visible) return;
  if (adjustingSelection) {
    hide();
    return;
  }
  const selection = document.getSelection();
  if (selection?.isCollapsed) {
    hide();
    return;
  }
  if (selection?.anchorNode && props.editor?.()?.contains(selection.anchorNode)) {
    hide();
    show();
  }
}

// ============================================================
// Show / Hide Helpers
// ============================================================
function show(): void {
  if (showTimer) clearTimeout(showTimer);
  showTimer = setTimeout(() => {
    isShown.value = true;
    resetInactivityTimer();
    void nextTick(viewport.schedule);
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
  if (isTouchInput()) return;
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
  if (
    e.pointerType === 'touch' &&
    props.editor?.()?.contains(e.target as Node) &&
    !document.getSelection()?.isCollapsed
  ) {
    adjustingSelection = true;
    hide();
    return;
  }
  if (!isShown.value || !bubbleRef.value) return;
  const target = e.target as HTMLElement;
  if (!bubbleRef.value.contains(target)) {
    isShown.value = false;
  }
}

function onSelectionPointerEnd(): void {
  if (!adjustingSelection) return;
  adjustingSelection = false;
  if (props.visible && !document.getSelection()?.isCollapsed) show();
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
  document.addEventListener('selectionchange', selectionAdjusted);
  document.addEventListener('editor-native-selection-change', selectionAdjusted);
  document.addEventListener('editor-pointer-change', resetInactivityTimer);
  document.addEventListener('pointerdown', onClickOutside);
  document.addEventListener('pointerup', onSelectionPointerEnd);
  document.addEventListener('pointercancel', onSelectionPointerEnd);
});

onUnmounted(() => {
  hide();
  viewport.destroy();
  removeGuard?.();
  document.removeEventListener('selectionchange', selectionAdjusted);
  document.removeEventListener('editor-native-selection-change', selectionAdjusted);
  document.removeEventListener('editor-pointer-change', resetInactivityTimer);
  document.removeEventListener('keydown', onKeydown);
  document.removeEventListener('pointerdown', onClickOutside);
  document.removeEventListener('pointerup', onSelectionPointerEnd);
  document.removeEventListener('pointercancel', onSelectionPointerEnd);
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
  flex-wrap: wrap;
  box-sizing: border-box;
  overflow-y: auto;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4);
  background: var(--paper-raised);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius, 2px);
  box-shadow: var(--shadow-stack);
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
    transform: scale(0.9);
  }

  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes bubble-out {
  from {
    opacity: 1;
    transform: scale(1);
  }

  to {
    opacity: 0;
    transform: scale(0.95);
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
    min-width: var(--touch-target-min);
    min-height: var(--touch-target-min);
  }
}
</style>
