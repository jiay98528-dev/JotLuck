<template>
  <Teleport to="body">
    <div v-if="visible" class="ctx-backdrop" @click.self="close" @contextmenu.prevent>
      <!-- Root Menu -->
      <div ref="menuRef" class="ctx-menu" :style="menuStyle" @keydown="onKeydown">
        <template v-for="item in props.items" :key="item.id">
          <div v-if="item.divider" class="ctx-divider" />
          <div
            v-else
            :ref="(el) => setItemRef(item.id, el)"
            class="ctx-item"
            :class="{
              'ctx-item--danger': item.danger,
              'ctx-item--disabled': item.disabled,
              'ctx-item--active': activeItemId === item.id,
              'ctx-item--has-sub': hasChildren(item),
            }"
            :data-item-id="item.id"
            @click="onSelect(item)"
            @mouseenter="onItemEnter(item, $event)"
          >
            <span v-if="item.icon" class="ctx-icon" aria-hidden="true">{{ item.icon }}</span>
            <span class="ctx-label">{{ item.label }}</span>
            <kbd v-if="item.shortcut" class="ctx-shortcut">{{ item.shortcut }}</kbd>
            <span v-if="hasChildren(item)" class="ctx-chevron" aria-hidden="true">&#8250;</span>
          </div>
        </template>
      </div>

      <!-- Sub-menu -->
      <div v-if="openSub" class="ctx-menu ctx-submenu" :style="subStyle" @mouseleave="onSubLeave">
        <template v-for="child in openSub.children" :key="child.id">
          <div v-if="child.divider" class="ctx-divider" />
          <div
            v-else
            class="ctx-item"
            :class="{
              'ctx-item--danger': child.danger,
              'ctx-item--disabled': child.disabled,
            }"
            @click="onSelect(child)"
          >
            <span v-if="child.icon" class="ctx-icon" aria-hidden="true">{{ child.icon }}</span>
            <span class="ctx-label">{{ child.label }}</span>
            <kbd v-if="child.shortcut" class="ctx-shortcut">{{ child.shortcut }}</kbd>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * ContextMenu.vue — Right-click context menu with sub-menu fly-out support.
 *
 * Props:
 *   visible - show/hide the menu
 *   x, y    - anchor position in viewport pixels
 *   items   - ContextMenuItem[] to render
 *
 * Emits:
 *   update:visible - toggles visibility (v-model:visible)
 *   select         - fires with the selected ContextMenuItem before close
 *
 * Features:
 *   - Teleported to <body> for correct stacking
 *   - Auto-position flip (left when near right edge, top when near bottom)
 *   - One-level sub-menus fly out to the right on hover, with flip
 *   - Keyboard navigation: Up/Down arrows, Enter to select, Escape to close
 *   - Right/Left arrows to open/close sub-menus
 *   - Danger items styled red, disabled items blocked
 *   - Shortcut hints right-aligned in monospace
 *   - Paper surface design: --paper-raised background, --shadow-float, 2px radius
 *   - Dividers rendered between groups
 */
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue';
import type { ContextMenuItem } from '@/types';

// ============================================================
// Props & Emits
// ============================================================
const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
}>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
  select: [item: ContextMenuItem];
}>();

// ============================================================
// Refs for DOM measurement
// ============================================================
const menuRef = ref<HTMLElement | null>(null);
const itemRefs = ref<Record<string, HTMLElement | null>>({});

function setItemRef(id: string, el: unknown) {
  itemRefs.value[id] = el as HTMLElement | null;
}

// ============================================================
// Non-divider items for keyboard navigation
// ============================================================
const flatItems = computed(() => props.items.filter((i) => !i.divider));

// ============================================================
// Auto-positioning — flip to stay inside viewport
// ============================================================
const menuStyle = ref<Record<string, string>>({});

function computeMenuPosition() {
  void nextTick(() => {
    const menu = menuRef.value;
    if (!menu) return;

    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = props.x;
    let top = props.y;

    // Flip left if menu overflows right edge
    if (left + rect.width > vw - 4) {
      left = props.x - rect.width;
    }
    // Clamp to viewport
    if (left < 4) left = 4;

    // Flip up if menu overflows bottom edge
    if (top + rect.height > vh - 4) {
      top = props.y - rect.height;
    }
    if (top < 4) top = 4;

    menuStyle.value = { left: `${left}px`, top: `${top}px` };
  });
}

// Recompute position whenever the menu appears or its content changes
watch(
  () => [props.visible, props.x, props.y, props.items] as const,
  () => {
    if (props.visible) computeMenuPosition();
  },
  { flush: 'post' },
);

// ============================================================
// Sub-menu state & positioning
// ============================================================
const openSub = ref<ContextMenuItem | null>(null);
const subStyle = ref<Record<string, string>>({});
let closeSubTimer: ReturnType<typeof setTimeout> | null = null;

function hasChildren(item: ContextMenuItem): boolean {
  return !!(item.children && item.children.length > 0);
}

function onItemEnter(item: ContextMenuItem, event: MouseEvent) {
  // Cancel any pending sub-menu close
  if (closeSubTimer) {
    clearTimeout(closeSubTimer);
    closeSubTimer = null;
  }

  // Same sub-menu already open — no-op
  if (openSub.value?.id === item.id) return;

  // No children — close any open sub-menu and stop
  if (!hasChildren(item)) {
    closeSubMenu();
    return;
  }

  // Close previous sub-menu before opening new one
  closeSubMenu();

  // Measure parent item position
  const itemEl = event.currentTarget as HTMLElement;
  const itemRect = itemEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const childCount = item.children?.length ?? 0;
  // Estimate: each item ~36px height, plus padding/divider overhead
  const estWidth = 200;
  const estHeight = Math.min(childCount * 36 + 16, 420);

  let subLeft = itemRect.right + 4;
  let subTop = itemRect.top - 4;

  // Flip left if sub-menu would overflow the right edge
  if (subLeft + estWidth > vw - 4) {
    subLeft = itemRect.left - estWidth - 4;
  }
  if (subLeft < 4) subLeft = 4;

  // Clamp vertically
  if (subTop + estHeight > vh - 4) {
    subTop = vh - estHeight - 4;
  }
  if (subTop < 4) subTop = 4;

  openSub.value = item;
  subStyle.value = { left: `${subLeft}px`, top: `${subTop}px` };
}

function onSubLeave() {
  closeSubTimer = setTimeout(() => {
    closeSubMenu();
  }, 200);
}

function closeSubMenu() {
  openSub.value = null;
  if (closeSubTimer) {
    clearTimeout(closeSubTimer);
    closeSubTimer = null;
  }
}

// ============================================================
// Selection & close
// ============================================================
function onSelect(item: ContextMenuItem) {
  if (item.disabled) return;

  emit('select', item);

  // If item.action is a function, invoke it
  if (typeof item.action === 'function') {
    item.action();
  }

  closeSubMenu();
  emit('update:visible', false);
}

function close() {
  closeSubMenu();
  emit('update:visible', false);
}

// ============================================================
// Keyboard navigation
// ============================================================
const activeItemId = ref<string | null>(null);

// Reset active item when menu opens/closes or items change
watch(
  () => [props.visible, props.items] as const,
  () => {
    activeItemId.value = null;
  },
);

function onKeydown(e: KeyboardEvent) {
  const idx = activeItemId.value
    ? flatItems.value.findIndex((i) => i.id === activeItemId.value)
    : -1;

  switch (e.key) {
    case 'ArrowDown': {
      e.preventDefault();
      const next = idx + 1 < flatItems.value.length ? idx + 1 : 0;
      activeItemId.value = flatItems.value[next]?.id ?? null;
      break;
    }
    case 'ArrowUp': {
      e.preventDefault();
      const prev = idx - 1 >= 0 ? idx - 1 : flatItems.value.length - 1;
      activeItemId.value = flatItems.value[prev]?.id ?? null;
      break;
    }
    case 'Enter': {
      e.preventDefault();
      if (activeItemId.value) {
        const item = flatItems.value.find((i) => i.id === activeItemId.value);
        if (item) onSelect(item);
      }
      break;
    }
    case 'Escape': {
      e.preventDefault();
      if (openSub.value) {
        closeSubMenu();
        // Return focus to the parent item
        activeItemId.value = openSub.value.id;
        openSub.value = null;
      } else {
        close();
      }
      break;
    }
    case 'ArrowRight': {
      e.preventDefault();
      if (activeItemId.value) {
        const item = flatItems.value.find((i) => i.id === activeItemId.value);
        if (item && hasChildren(item)) {
          const el = itemRefs.value[item.id];
          if (el) {
            onItemEnter(item, { currentTarget: el } as unknown as MouseEvent);
          }
        }
      }
      break;
    }
    case 'ArrowLeft': {
      e.preventDefault();
      if (openSub.value) {
        closeSubMenu();
        activeItemId.value = openSub.value.id;
        openSub.value = null;
      }
      break;
    }
  }
}

// ============================================================
// Lifecycle cleanup
// ============================================================
onBeforeUnmount(() => {
  if (closeSubTimer) clearTimeout(closeSubTimer);
});
</script>

<style scoped>
/* ============================================================
 * Backdrop — full-screen click-catcher
 * ============================================================ */
.ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-palette);
}

/* ============================================================
 * Menu panel — paper surface
 * ============================================================ */
.ctx-menu {
  position: absolute;
  min-width: 180px;
  max-width: 320px;
  padding: var(--space-4);
  background: var(--paper-raised);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  box-shadow: var(--shadow-float);
  overflow-y: auto;
  overscroll-behavior: contain;
  max-height: min(480px, calc(100vh - 16px));
  animation: ctx-in var(--dur-micro) var(--ease-enter);
}

@keyframes ctx-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }

  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* ============================================================
 * Items
 * ============================================================ */
.ctx-item {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  width: 100%;
  padding: var(--space-6) var(--space-8);
  border: none;
  border-radius: var(--radius);
  background: none;
  font-family: var(--ff-body);
  font-size: var(--text-sm);
  line-height: var(--lh-ui);
  color: var(--ink-primary);
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  transition: background var(--dur-press) var(--ease-press);
}

.ctx-item:hover {
  background: var(--surface-hover);
}

.ctx-item--active {
  background: var(--surface-selected);
}

.ctx-item--danger {
  color: var(--signal-error);
}

.ctx-item--has-sub:hover,
.ctx-item--has-sub.ctx-item--active {
  /* Slightly darker when sub-menu is open — signals the relationship */
  background: var(--surface-active);
}

.ctx-item--disabled {
  opacity: var(--opacity-disabled);
  cursor: not-allowed;
}

/* ============================================================
 * Icon
 * ============================================================ */
.ctx-icon {
  width: 16px;
  text-align: center;
  flex-shrink: 0;
  font-size: var(--text-sm);
}

/* ============================================================
 * Label
 * ============================================================ */
.ctx-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ============================================================
 * Shortcut hint — right-aligned, muted, monospace
 * ============================================================ */
.ctx-shortcut {
  flex-shrink: 0;
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--ink-muted);
  font-family: var(--ff-mono);
  letter-spacing: var(--ls-normal);
}

.ctx-item--has-sub .ctx-shortcut {
  /* When sub-menu chevron is also present, shortcut goes before it */
  margin-left: var(--space-12);
}

/* ============================================================
 * Sub-menu chevron
 * ============================================================ */
.ctx-chevron {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--ink-muted);
}

/* ============================================================
 * Divider
 * ============================================================ */
.ctx-divider {
  height: var(--border-thin);
  background: var(--rule);
  margin: var(--space-4) 0;
}

/* ============================================================
 * Sub-menu panel
 * ============================================================ */
.ctx-submenu {
  position: fixed;
  z-index: 1;
  animation: ctx-sub-in var(--dur-micro) var(--ease-enter);
}

@keyframes ctx-sub-in {
  from {
    opacity: 0;
    transform: translateX(-4px) scale(0.96);
  }

  to {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
}
</style>
