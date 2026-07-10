<template>
  <div
    class="single-page-drawer-shell"
    :class="{
      'is-left-pinned': pinned.left,
      'is-right-pinned': pinned.right,
      'is-bottom-pinned': pinned.bottom,
    }"
    :style="shellStyle"
    data-layout-preset="single-page"
  >
    <div
      v-if="hasFloatingDrawer"
      class="single-page-drawer-shell__scrim"
      aria-hidden="true"
      @click="closeFloatingDrawers"
    />

    <aside
      class="single-page-drawer single-page-drawer--left"
      :class="{ 'is-open': isVisible('left'), 'is-pinned': pinned.left }"
      :aria-hidden="!isVisible('left')"
      :aria-label="drawerShell.left.label"
    >
      <div class="single-page-drawer__chrome">
        <strong>{{ drawerShell.left.label }}</strong>
        <div class="single-page-drawer__actions">
          <button type="button" @click="togglePinned('left')">
            {{ pinned.left ? '取消固定' : '固定' }}
          </button>
          <button v-if="!pinned.left" type="button" @click="closeDrawer('left')">关闭</button>
        </div>
      </div>
      <div class="single-page-drawer__body">
        <slot name="left" />
      </div>
    </aside>

    <main class="single-page-drawer-shell__main">
      <slot name="main" />
    </main>

    <aside
      class="single-page-drawer single-page-drawer--right"
      :class="{ 'is-open': isVisible('right'), 'is-pinned': pinned.right }"
      :aria-hidden="!isVisible('right')"
      :aria-label="drawerShell.right.label"
    >
      <div class="single-page-drawer__chrome">
        <strong>{{ drawerShell.right.label }}</strong>
        <div class="single-page-drawer__actions">
          <button type="button" @click="togglePinned('right')">
            {{ pinned.right ? '取消固定' : '固定' }}
          </button>
          <button v-if="!pinned.right" type="button" @click="closeDrawer('right')">关闭</button>
        </div>
      </div>
      <div class="single-page-drawer__body">
        <slot name="right" />
      </div>
    </aside>

    <aside
      class="single-page-drawer single-page-drawer--bottom"
      :class="{ 'is-open': isVisible('bottom'), 'is-pinned': pinned.bottom }"
      :aria-hidden="!isVisible('bottom')"
      :aria-label="drawerShell.bottom.label"
    >
      <div class="single-page-drawer__chrome">
        <strong>{{ drawerShell.bottom.label }}</strong>
        <div class="single-page-drawer__actions">
          <button type="button" @click="togglePinned('bottom')">
            {{ pinned.bottom ? '取消固定' : '固定' }}
          </button>
          <button v-if="!pinned.bottom" type="button" @click="closeDrawer('bottom')">关闭</button>
        </div>
      </div>
      <div class="single-page-drawer__body">
        <slot name="bottom" />
      </div>
    </aside>

    <button
      v-if="!pinned.left"
      type="button"
      class="single-page-drawer-handle single-page-drawer-handle--left"
      :aria-expanded="open.left"
      :aria-label="`${drawerShell.left.label}抽屉`"
      @click="toggleOpen('left')"
    >
      <span />
    </button>
    <button
      v-if="!pinned.right"
      type="button"
      class="single-page-drawer-handle single-page-drawer-handle--right"
      :aria-expanded="open.right"
      :aria-label="`${drawerShell.right.label}抽屉`"
      @click="toggleOpen('right')"
    >
      <span />
    </button>
    <button
      v-if="!pinned.bottom"
      type="button"
      class="single-page-drawer-handle single-page-drawer-handle--bottom"
      :aria-expanded="open.bottom"
      :aria-label="`${drawerShell.bottom.label}抽屉`"
      @click="toggleOpen('bottom')"
    >
      <span />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, watch } from 'vue';
import type {
  ThemeDrawerRegionRecipe,
  ThemeDrawerShellRecipe,
  ThemeDrawerSide,
} from '@/types/theme-pack';

const props = defineProps<{
  themeId: string;
  drawerShell: ThemeDrawerShellRecipe;
}>();

const SIDES: ThemeDrawerSide[] = ['left', 'right', 'bottom'];

const open = reactive<Record<ThemeDrawerSide, boolean>>({
  left: false,
  right: false,
  bottom: false,
});

const pinned = reactive<Record<ThemeDrawerSide, boolean>>({
  left: false,
  right: false,
  bottom: false,
});

const storageKey = computed(() => `jotluck:theme:${props.themeId}:drawer-shell-pins:v1`);

const shellStyle = computed<Record<string, string>>(() => ({
  '--single-drawer-left-size': `${clampDrawerSize(props.drawerShell.left)}px`,
  '--single-drawer-right-size': `${clampDrawerSize(props.drawerShell.right)}px`,
  '--single-drawer-bottom-size': `${clampDrawerSize(props.drawerShell.bottom)}px`,
  '--single-drawer-left-track': pinned.left
    ? `${clampDrawerSize(props.drawerShell.left)}px`
    : '0px',
  '--single-drawer-right-track': pinned.right
    ? `${clampDrawerSize(props.drawerShell.right)}px`
    : '0px',
  '--single-drawer-bottom-track': pinned.bottom
    ? `${clampDrawerSize(props.drawerShell.bottom)}px`
    : '0px',
}));

const hasFloatingDrawer = computed(() => SIDES.some((side) => open[side] && !pinned[side]));

function clampDrawerSize(region: ThemeDrawerRegionRecipe): number {
  const min = region.minSize ?? 120;
  const max = region.maxSize ?? 520;
  return Math.min(Math.max(region.size, min), max);
}

function isVisible(side: ThemeDrawerSide): boolean {
  return pinned[side] || open[side];
}

function toggleOpen(side: ThemeDrawerSide): void {
  open[side] = !open[side];
}

function closeDrawer(side: ThemeDrawerSide): void {
  if (!pinned[side]) open[side] = false;
}

function closeFloatingDrawers(): void {
  for (const side of SIDES) {
    if (!pinned[side]) open[side] = false;
  }
}

function togglePinned(side: ThemeDrawerSide): void {
  pinned[side] = !pinned[side];
  open[side] = pinned[side];
  persistPinnedState();
}

function readPinnedState(): void {
  for (const side of SIDES) {
    pinned[side] = Boolean(props.drawerShell[side].defaultPinned);
    open[side] = pinned[side];
  }

  if (typeof localStorage === 'undefined') return;
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey.value) ?? '{}') as Partial<
      Record<ThemeDrawerSide, unknown>
    >;
    for (const side of SIDES) {
      if (typeof parsed[side] === 'boolean') {
        pinned[side] = parsed[side];
        open[side] = parsed[side];
      }
    }
  } catch {
    persistPinnedState();
  }
}

function persistPinnedState(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(
    storageKey.value,
    JSON.stringify({
      left: pinned.left,
      right: pinned.right,
      bottom: pinned.bottom,
    }),
  );
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && hasFloatingDrawer.value) {
    closeFloatingDrawers();
  }
}

watch(
  () => props.themeId,
  () => readPinnedState(),
);

onMounted(() => {
  readPinnedState();
  window.addEventListener('keydown', onKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<style scoped>
.single-page-drawer-shell {
  position: relative;
  isolation: isolate;
  display: grid;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  grid-template-columns:
    var(--single-drawer-left-track) minmax(0, 1fr)
    var(--single-drawer-right-track);
  grid-template-rows: minmax(0, 1fr) var(--single-drawer-bottom-track);
  background: var(--paper-bg);
  color: var(--ink-primary);
}

.single-page-drawer-shell__main {
  min-width: 0;
  min-height: 0;
  grid-column: 2;
  grid-row: 1;
  overflow: hidden;
  background: var(--paper-surface);
}

.single-page-drawer-shell__scrim {
  position: absolute;
  inset: 0;
  z-index: 18;
  background: var(--overlay);
}

.single-page-drawer {
  position: absolute;
  z-index: 22;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border: var(--border-thin) solid var(--rule);
  background: var(--paper-raised);
  box-shadow: var(--shadow-float);
  transition:
    transform var(--dur-release) var(--ease-enter),
    opacity var(--dur-micro) var(--ease-fade);
}

.single-page-drawer--left {
  inset: 0 auto 0 0;
  width: var(--single-drawer-left-size);
  transform: translateX(calc(-1 * var(--single-drawer-left-size) - var(--space-12)));
}

.single-page-drawer--right {
  inset: 0 0 0 auto;
  width: var(--single-drawer-right-size);
  transform: translateX(calc(var(--single-drawer-right-size) + var(--space-12)));
}

.single-page-drawer--bottom {
  right: 0;
  bottom: 0;
  left: 0;
  height: var(--single-drawer-bottom-size);
  transform: translateY(calc(var(--single-drawer-bottom-size) + var(--space-12)));
}

.single-page-drawer.is-open,
.single-page-drawer.is-pinned {
  transform: none;
}

.single-page-drawer.is-pinned {
  position: relative;
  z-index: 2;
  box-shadow: none;
}

.single-page-drawer--left.is-pinned {
  grid-column: 1;
  grid-row: 1 / span 2;
  width: auto;
}

.single-page-drawer--right.is-pinned {
  grid-column: 3;
  grid-row: 1 / span 2;
  width: auto;
}

.single-page-drawer--bottom.is-pinned {
  grid-column: 2;
  grid-row: 2;
  height: auto;
}

.single-page-drawer__chrome {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-12);
  min-height: 38px;
  padding: 0 var(--space-12);
  border-bottom: var(--border-thin) solid var(--rule);
  color: var(--ink-secondary);
  font-size: var(--text-xs);
}

.single-page-drawer__chrome strong {
  min-width: 0;
  overflow: hidden;
  color: var(--ink-primary);
  font-weight: var(--fw-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.single-page-drawer__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-6);
}

.single-page-drawer__actions button,
.single-page-drawer-handle {
  border: var(--border-thin) solid color-mix(in oklch, var(--accent) 38%, var(--rule));
  border-radius: var(--radius-sm);
  background: color-mix(in oklch, var(--paper-raised) 90%, transparent);
  color: var(--ink-secondary);
  font: inherit;
  cursor: pointer;
}

.single-page-drawer__actions button {
  min-width: 58px;
  min-height: 30px;
  padding: 0 var(--space-12);
  font-size: var(--text-xs);
  line-height: var(--lh-ui);
  white-space: nowrap;
}

.single-page-drawer__actions button:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.single-page-drawer__body {
  flex: 1;
  min-height: 0;
  overflow: hidden auto;
}

.single-page-drawer-handle {
  position: absolute;
  z-index: 14;
  display: grid;
  place-items: center;
  padding: 0;
  box-shadow: var(--shadow-sheet);
}

.single-page-drawer-handle:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.single-page-drawer-handle span {
  display: block;
  border-radius: var(--radius-full);
  background: currentcolor;
}

.single-page-drawer-handle--left,
.single-page-drawer-handle--right {
  top: 50%;
  width: 22px;
  height: 68px;
  transform: translateY(-50%);
}

.single-page-drawer-handle--left {
  left: var(--space-8);
}

.single-page-drawer-handle--right {
  right: var(--space-8);
}

.single-page-drawer-handle--left span,
.single-page-drawer-handle--right span {
  width: 3px;
  height: 34px;
}

.single-page-drawer-handle--bottom {
  right: 50%;
  bottom: var(--space-8);
  width: 86px;
  height: 24px;
  transform: translateX(50%);
}

.single-page-drawer-handle--bottom span {
  width: 42px;
  height: 3px;
}

@media (width <= 760px) {
  .single-page-drawer-shell {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
  }

  .single-page-drawer-shell__main,
  .single-page-drawer--left.is-pinned,
  .single-page-drawer--right.is-pinned,
  .single-page-drawer--bottom.is-pinned {
    grid-column: 1;
    grid-row: 1;
  }

  .single-page-drawer.is-pinned {
    position: absolute;
    z-index: 22;
    box-shadow: var(--shadow-float);
  }

  .single-page-drawer--left {
    width: min(var(--single-drawer-left-size), calc(100vw - var(--space-32)));
  }

  .single-page-drawer--right {
    width: min(var(--single-drawer-right-size), calc(100vw - var(--space-32)));
  }

  .single-page-drawer--bottom {
    height: min(var(--single-drawer-bottom-size), 55vh);
  }
}

@media (prefers-reduced-motion: reduce) {
  .single-page-drawer {
    transition: none;
  }
}
</style>
