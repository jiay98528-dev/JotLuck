<template>
  <Teleport to="body">
    <div
      v-if="!isHidden"
      ref="cheatsheetRef"
      class="cheatsheet"
      :class="{ 'is-dragging': isDragging, 'is-expanded': isExpanded }"
      :style="positionStyle"
    >
      <Transition name="cheatsheet-toggle" mode="out-in">
        <!-- Collapsed Pill -->
        <button
          v-if="!isExpanded"
          key="pill"
          class="cheatsheet-pill"
          aria-label="打开 Markdown 语法参考"
          @click="expand"
        >
          <span class="pill-text">? 语法</span>
        </button>

        <!-- Expanded Card -->
        <div v-else key="card" class="cheatsheet-card">
          <!-- Header -->
          <div class="cheatsheet-header">
            <span
              class="drag-handle"
              title="拖拽移动"
              aria-label="拖拽移动"
              @pointerdown="startDrag"
              >⠿</span
            >
            <span class="cheatsheet-title">语法参考</span>
            <button class="collapse-btn" aria-label="收起语法参考" @click="collapse()">−</button>
          </div>

          <!-- Content -->
          <div class="cheatsheet-content">
            <div v-for="section in sections" :key="section.label" class="cheatsheet-section">
              <div class="section-label">{{ section.label }}</div>
              <div v-for="entry in section.entries" :key="entry" class="section-entry">
                <code>{{ entry }}</code>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * MarkdownCheatSheet.vue — Floating Markdown Syntax Reference Card
 *
 * A collapsible, draggable reference card that sits in the bottom-right
 * corner of the editor area. Shows common Markdown syntax in a compact,
 * categorized format. Position and state persist via localStorage.
 *
 * @see tool.md §5.3 (Constraint-Driven Development)
 */
import { ref, computed, onMounted, onUnmounted } from 'vue';

// ============================================================
// Constants
// ============================================================
const LS_POSITION = 'markluck:cheatsheet:position';
const LS_COLLAPSED = 'markluck:cheatsheet:collapsed';
const LS_HIDDEN = 'markluck:cheatsheet:hidden';
const SMALL_SCREEN_BREAKPOINT = 800;
const VIEWPORT_MARGIN = 12;

// ============================================================
// Content definition
// ============================================================
interface CheatSection {
  label: string;
  entries: string[];
}

const sections: CheatSection[] = [
  { label: '标题', entries: ['# H1', '## H2', '### H3'] },
  { label: '行内格式', entries: ['**粗体**', '*斜体*', '~~删除线~~', '`代码`'] },
  { label: '列表', entries: ['- 无序', '1. 有序', '- [ ] 任务'] },
  { label: '引用与代码', entries: ['> 引用', '``` 代码块 ```'] },
  { label: '链接与图片', entries: ['[文字](url)', '![图片](url)'] },
  { label: 'Wiki-link', entries: ['[[笔记名]]', '[[笔记名|别名]]'] },
  { label: '模板', entries: ['{{date}}', '{{time}}'] },
];

// ============================================================
// Reactive state
// ============================================================
const cheatsheetRef = ref<HTMLElement | null>(null);
const isExpanded = ref(false);
const isHidden = ref(false);
const isDragging = ref(false);
const isSmallScreen = ref(false);
const position = ref({ x: 0, y: 0 });

// Drag tracking (non-reactive for pointermove performance)
let dragStartX = 0;
let dragStartY = 0;
let dragStartPosX = 0;
let dragStartPosY = 0;
let resizeObserver: ResizeObserver | null = null;

// ============================================================
// Computed
// ============================================================
const positionStyle = computed(() => ({
  '--drag-x': `${position.value.x}px`,
  '--drag-y': `${position.value.y}px`,
}));

// ============================================================
// localStorage helpers
// ============================================================
function readPosition(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(LS_POSITION);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof parsed.x === 'number' &&
        Number.isFinite(parsed.x) &&
        typeof parsed.y === 'number' &&
        Number.isFinite(parsed.y)
      ) {
        return { x: parsed.x, y: parsed.y };
      }
    }
  } catch {
    // Corrupted data — fall through to default
  }
  return { x: 0, y: 0 };
}

function savePosition(pos: { x: number; y: number }): void {
  try {
    localStorage.setItem(LS_POSITION, JSON.stringify(pos));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(LS_COLLAPSED) !== 'false';
  } catch {
    return true;
  }
}

function saveCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(LS_COLLAPSED, collapsed ? 'true' : 'false');
  } catch {
    // silently ignore
  }
}

function readHidden(): boolean {
  try {
    return localStorage.getItem(LS_HIDDEN) === 'true';
  } catch {
    return false;
  }
}

// ============================================================
// Clamp to viewport
// ============================================================
let clampRafId: number | null = null;

function scheduleClamp(): void {
  if (clampRafId !== null) return;
  clampRafId = requestAnimationFrame(() => {
    clampRafId = null;
    clampToViewport();
  });
}

function clampToViewport(): void {
  const el = cheatsheetRef.value;
  if (!el) return;

  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let x = position.value.x;
  let y = position.value.y;

  if (rect.right > vw - VIEWPORT_MARGIN) {
    x -= rect.right - (vw - VIEWPORT_MARGIN);
  }
  if (rect.left < VIEWPORT_MARGIN) {
    x += VIEWPORT_MARGIN - rect.left;
  }
  if (rect.bottom > vh - VIEWPORT_MARGIN) {
    y -= rect.bottom - (vh - VIEWPORT_MARGIN);
  }
  if (rect.top < VIEWPORT_MARGIN) {
    y += VIEWPORT_MARGIN - rect.top;
  }

  if (x !== position.value.x || y !== position.value.y) {
    position.value = { x, y };
  }
}

// ============================================================
// Drag handlers
// ============================================================
function startDrag(e: PointerEvent): void {
  if (isSmallScreen.value) return;
  e.preventDefault();

  const el = cheatsheetRef.value;
  if (!el) return;

  try {
    el.setPointerCapture(e.pointerId);
  } catch {
    // setPointerCapture may fail in some environments
  }

  isDragging.value = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragStartPosX = position.value.x;
  dragStartPosY = position.value.y;
}

function onDrag(e: PointerEvent): void {
  if (!isDragging.value) return;
  e.preventDefault();

  const newX = dragStartPosX + (e.clientX - dragStartX);
  const newY = dragStartPosY + (e.clientY - dragStartY);

  position.value = { x: newX, y: newY };
  scheduleClamp();
}

function endDrag(_e: PointerEvent): void {
  if (!isDragging.value) return;

  isDragging.value = false;
  clampToViewport();
  savePosition(position.value);
}

// ============================================================
// Expand / Collapse
// ============================================================
function expand(): void {
  isExpanded.value = true;
  saveCollapsed(false);
  // Re-clamp after card expands (size changed)
  scheduleClamp();
}

function collapse(save = true): void {
  isExpanded.value = false;
  if (save) saveCollapsed(true);
}

// ============================================================
// ResizeObserver
// ============================================================
function setupResizeObserver(): void {
  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const width = entry.contentRect.width;
      const wasSmall = isSmallScreen.value;
      isSmallScreen.value = width < SMALL_SCREEN_BREAKPOINT;

      // Auto-collapse when crossing below breakpoint (don't persist — temporary)
      if (!wasSmall && isSmallScreen.value && isExpanded.value) {
        collapse(false);
      }

      // Restore saved state when returning to large screen
      if (wasSmall && !isSmallScreen.value) {
        isExpanded.value = !readCollapsed();
        scheduleClamp();
      }

      // Re-clamp position after resize
      if (!isDragging.value) {
        scheduleClamp();
      }
    }
  });

  resizeObserver.observe(document.documentElement);
}

// ============================================================
// Lifecycle
// ============================================================
onMounted(() => {
  // Read persisted state
  isHidden.value = readHidden();
  position.value = readPosition();
  isExpanded.value = !readCollapsed();

  // Only enable drag/expand on large enough screens
  isSmallScreen.value = window.innerWidth < SMALL_SCREEN_BREAKPOINT;
  if (isSmallScreen.value && isExpanded.value) {
    isExpanded.value = false;
  }

  // Setup resize detection
  setupResizeObserver();

  // Global pointer listeners (on document to catch moves outside the element)
  document.addEventListener('pointermove', onDrag);
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);
});

onUnmounted(() => {
  // Cleanup ResizeObserver
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }

  // Cleanup pointer listeners
  document.removeEventListener('pointermove', onDrag);
  document.removeEventListener('pointerup', endDrag);
  document.removeEventListener('pointercancel', endDrag);

  // Cancel pending clamp
  if (clampRafId !== null) {
    cancelAnimationFrame(clampRafId);
    clampRafId = null;
  }
});
</script>

<style scoped>
/* ============================================================
 * Container — Fixed bottom-right
 * ============================================================ */
.cheatsheet {
  position: fixed;
  bottom: 60px;
  right: 24px;
  z-index: var(--z-overlay);
  transform: translate(var(--drag-x, 0), var(--drag-y, 0));
  will-change: transform;
}

.cheatsheet.is-dragging {
  transition: none;
}

/* ============================================================
 * Collapsed Pill
 * ============================================================ */
.cheatsheet-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  padding: 0 var(--space-12);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius-full);
  background: var(--paper-surface);
  color: var(--ink-muted);
  cursor: pointer;
  font-family: var(--ff-body);
  line-height: var(--lh-none);
  user-select: none;
  transform-origin: bottom right;
  transition:
    background var(--dur-hover-lift) var(--ease-fade),
    transform var(--dur-hover-lift) var(--ease-fade),
    box-shadow var(--dur-hover-lift) var(--ease-fade);
}

.pill-text {
  font-size: var(--text-sm);
  font-weight: var(--fw-medium);
  letter-spacing: var(--ls-normal);
}

.cheatsheet-pill:hover {
  background: var(--paper-raised);
  box-shadow: var(--shadow-wing-sheet);
  transform: var(--lift-hover);
}

.cheatsheet-pill:active {
  transform: var(--lift-active);
  transition: transform var(--dur-active-press) var(--ease-press);
}

/* ============================================================
 * Expanded Card
 * ============================================================ */
.cheatsheet-card {
  width: 220px;
  max-height: 480px;
  display: flex;
  flex-direction: column;
  background: var(--paper-raised);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  box-shadow: var(--shadow-wing-float);
  overflow: hidden;
  transform-origin: bottom right;
}

/* ============================================================
 * Header
 * ============================================================ */
.cheatsheet-header {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  height: 34px;
  padding: 0 var(--space-8);
  border-bottom: var(--border-thin) solid var(--rule);
  flex-shrink: 0;
  cursor: default;
}

.drag-handle {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-muted);
  font-family: var(--ff-mono);
  font-size: var(--text-sm);
  line-height: var(--lh-none);
  cursor: grab;
  user-select: none;
  border-radius: var(--radius);
  transition: color var(--dur-micro) var(--ease-fade);
}

.drag-handle:hover {
  color: var(--ink-secondary);
}

.drag-handle:active {
  cursor: grabbing;
}

.cheatsheet-title {
  flex: 1;
  font-family: var(--ff-body);
  font-size: var(--text-sm);
  font-weight: var(--fw-medium);
  color: var(--ink-secondary);
  line-height: var(--lh-none);
}

.collapse-btn {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: var(--border-thin) solid transparent;
  border-radius: var(--radius);
  background: none;
  color: var(--ink-muted);
  font-family: var(--ff-mono);
  font-size: var(--text-base);
  line-height: var(--lh-none);
  cursor: pointer;
  transition:
    color var(--dur-micro) var(--ease-fade),
    border-color var(--dur-micro) var(--ease-fade),
    background var(--dur-micro) var(--ease-fade);
}

.collapse-btn:hover {
  color: var(--ink-secondary);
  border-color: var(--rule);
  background: var(--surface-hover);
}

.collapse-btn:active {
  background: var(--surface-active);
  transform: scale(0.94);
  transition: transform var(--dur-press) var(--ease-press);
}

/* ============================================================
 * Content
 * ============================================================ */
.cheatsheet-content {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--space-8) 0;
}

.cheatsheet-section {
  padding: var(--space-4) var(--space-12);
}

.cheatsheet-section + .cheatsheet-section {
  border-top: 1px solid var(--rule);
}

.section-label {
  font-family: var(--ff-body);
  font-size: var(--text-xs);
  font-weight: var(--fw-medium);
  color: var(--ink-muted);
  letter-spacing: var(--ls-wide);
  text-transform: uppercase;
  line-height: var(--lh-ui);
  padding-bottom: var(--space-4);
}

.section-entry {
  font-family: var(--ff-mono);
  font-size: var(--text-xs);
  color: var(--ink-secondary);
  line-height: var(--lh-ui);
  padding: 1px 0;
  white-space: nowrap;
}

/* ============================================================
 * Drag state — disable interaction on content while dragging
 * ============================================================ */
.cheatsheet.is-dragging .cheatsheet-card {
  cursor: grabbing;
}

.cheatsheet.is-dragging * {
  user-select: none;
}

/* ============================================================
 * Transition — Toggle (pill ↔ card)
 * ============================================================ */
.cheatsheet-toggle-enter-active {
  transition:
    transform var(--dur-expand) var(--ease-enter),
    opacity var(--dur-expand) var(--ease-enter);
}

.cheatsheet-toggle-leave-active {
  transition:
    transform var(--dur-collapse) var(--ease-exit),
    opacity var(--dur-collapse) var(--ease-exit);
}

.cheatsheet-toggle-enter-from,
.cheatsheet-toggle-leave-to {
  transform: scale(0.9);
  opacity: 0;
}

/* ============================================================
 * Reduced motion
 * ============================================================ */
@media (prefers-reduced-motion: reduce) {
  .cheatsheet-toggle-enter-active,
  .cheatsheet-toggle-leave-active {
    transition: opacity 0ms;
  }

  .cheatsheet-toggle-enter-from,
  .cheatsheet-toggle-leave-to {
    transform: none;
    opacity: 0;
  }

  .cheatsheet-pill {
    transition: none;
  }
}
</style>
