<template>
  <aside
    class="right-wing"
    :class="{ collapsed }"
    :data-policy="region.policy"
    :style="{ width: collapsed ? '0px' : `${panelWidth}px` }"
    aria-label="参考面板"
  >
    <!-- Left-edge grab handle for resize / collapse -->
    <div
      class="grab-handle"
      title="双击折叠 / 展开 | 拖拽调整宽度"
      role="separator"
      tabindex="0"
      aria-orientation="vertical"
      :aria-valuemin="0"
      :aria-valuemax="MAX_WIDTH"
      :aria-valuenow="collapsed ? 0 : panelWidth"
      @dblclick="handleDoubleClick"
      @keydown="handleHandleKeydown"
      @pointerdown="handleResizeStart"
    >
      <div class="grab-line" />
    </div>

    <!-- Panel Content -->
    <div v-if="!collapsed" class="wing-content" :data-mode="region.mode">
      <template v-for="(section, index) in orderedSections" :key="section">
        <section class="wing-section" :data-section="section">
          <button class="section-header" @click="toggleSection(section)">
            <svg
              v-if="section === 'outline'"
              class="section-icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <line x1="8" y1="6" x2="21" y2="6" stroke-linecap="round" />
              <line x1="8" y1="12" x2="21" y2="12" stroke-linecap="round" />
              <line x1="8" y1="18" x2="21" y2="18" stroke-linecap="round" />
              <circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none" />
              <circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none" />
              <circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none" />
            </svg>
            <svg
              v-else-if="section === 'backlinks'"
              class="section-icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <path
                d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
                stroke-linecap="round"
              />
              <path
                d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
                stroke-linecap="round"
              />
            </svg>
            <svg
              v-else
              class="section-icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <path
                d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"
                stroke-linecap="round"
              />
              <line x1="7" y1="7" x2="7.01" y2="7" stroke-linecap="round" stroke-width="2" />
            </svg>
            <span class="section-label">{{ sectionLabel(section) }}</span>
            <span v-if="sectionCount(section) > 0" class="count-badge">
              {{ sectionCount(section) }}
            </span>
            <svg
              class="chevron"
              :class="{ open: openSections.has(section) }"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <polyline points="6 9 12 15 18 9" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>

          <div
            v-if="section === 'outline' && openSections.has(section)"
            class="section-body section-body--outline"
          >
            <component
              :is="HeadingTreeNode"
              :nodes="headings"
              :active-id="activeHeadingId"
              @navigate-heading="onNavigateHeading"
            />
            <p v-if="headings.length === 0" class="empty-hint">暂无标题</p>
          </div>

          <div
            v-else-if="section === 'backlinks' && openSections.has(section)"
            class="section-body section-body--backlinks"
          >
            <template v-if="backlinks.length > 0">
              <button
                v-for="entry in backlinks"
                :key="entry.notePath + ':' + entry.lineNumber"
                class="backlink-item"
                @click="emit('navigate-backlink', entry)"
              >
                <span class="backlink-title">{{ entry.noteTitle }}</span>
                <span class="backlink-context">{{ entry.context }}</span>
              </button>
            </template>
            <p v-else class="empty-hint">无反链</p>
          </div>

          <div
            v-else-if="section === 'tags' && openSections.has(section)"
            class="section-body section-body--tags"
          >
            <template v-if="tags.length > 0">
              <div class="tag-cloud">
                <button
                  v-for="tag in styledTags"
                  :key="tag.name"
                  class="tag-chip"
                  :style="{ fontSize: tag.fontSize }"
                  @click="emit('select-tag', tag.name)"
                >
                  {{ tag.name }}
                </button>
              </div>
            </template>
            <p v-else class="empty-hint">无标签</p>
          </div>
        </section>

        <div v-if="index < orderedSections.length - 1" class="section-rule" />
      </template>
    </div>
  </aside>
</template>

<script lang="ts">
/**
 * HeadingTreeNode — 递归标题树节点 (inline, no separate file)
 *
 * 使用 h() 渲染函数实现自引用递归。
 * 自身调用自身：当 node.children 非空时递归渲染子树。
 */
import { defineComponent, h, type PropType } from 'vue';
import type { HeadingItem } from '@/types';

export const HeadingTreeNode: ReturnType<typeof defineComponent> = defineComponent({
  name: 'HeadingTreeNode',
  props: {
    nodes: {
      type: Array as PropType<HeadingItem[]>,
      required: true,
    },
    activeId: {
      type: String as PropType<string | null>,
      default: null,
    },
    depth: {
      type: Number,
      default: 0,
    },
  },
  emits: {
    'navigate-heading': (_headingId: string, _lineNumber: number) => true,
  },
  setup(props, { emit }) {
    return () =>
      h(
        'ul',
        { class: 'heading-tree', role: 'list' },
        props.nodes.map((node) =>
          h(
            'li',
            {
              key: node.id,
              class: ['heading-node', { active: node.id === props.activeId }],
            },
            [
              h(
                'button',
                {
                  class: 'heading-link',
                  style: { paddingInlineStart: `${props.depth * 14 + 8}px` },
                  type: 'button',
                  onClick: () => emit('navigate-heading', node.id, node.lineNumber),
                },
                [
                  h('span', { class: 'heading-accent' }),
                  h('span', { class: 'heading-text' }, node.text || '(无标题)'),
                ],
              ),
              node.children.length > 0
                ? h(HeadingTreeNode, {
                    nodes: node.children,
                    activeId: props.activeId,
                    depth: props.depth + 1,
                    onNavigateHeading: (id: string, ln: number) => emit('navigate-heading', id, ln),
                  })
                : null,
            ],
          ),
        ),
      );
  },
});
</script>

<script setup lang="ts">
/**
 * RightWing.vue — 240px 右侧参考面板
 *
 * 羽翼编辑器的右页（批注区）：大纲 / 反链 / 标签云三个折叠区。
 * 左侧抓取手柄可拖拽调整宽度，双击折叠为 0px。
 *
 * @see spec/frontend/components.md — RightWing 组件规格
 */
import { ref, computed, watch } from 'vue';
import type { BacklinkEntry, TagEntry } from '@/types';
import type {
  RightWingRegion,
  ThemeReferenceSection,
  ThemeRightWingPolicy,
} from '@/types/theme-pack';

// ============================================================
// Props
// ============================================================
const props = withDefaults(
  defineProps<{
    headings: HeadingItem[];
    backlinks: BacklinkEntry[];
    tags: TagEntry[];
    activeHeadingId: string | null;
    collapsed?: boolean;
    region?: RightWingRegion;
  }>(),
  {
    collapsed: false,
    region: () => ({
      mode: 'balanced' as const,
      policy: 'outline' as const,
      sections: ['outline', 'backlinks', 'tags'] as const,
      defaultOpenSections: ['outline', 'tags'] as const,
    }),
  },
);

// ============================================================
// Emits
// ============================================================
const emit = defineEmits<{
  'navigate-heading': [headingId: string, lineNumber: number];
  'navigate-backlink': [entry: BacklinkEntry];
  'select-tag': [tagName: string];
  'toggle-collapse': [];
}>();

// ============================================================
// Section accordion — independent toggle
// ============================================================
type SectionKey = ThemeReferenceSection;

const orderedSections = computed<SectionKey[]>(() => {
  const seen = new Set<SectionKey>();
  const result: SectionKey[] = [];
  for (const section of props.region.sections) {
    if (!seen.has(section)) {
      seen.add(section);
      result.push(section);
    }
  }
  return result.length > 0 ? result : ['outline', 'backlinks', 'tags'];
});

const openSections = ref<Set<SectionKey>>(new Set(props.region.defaultOpenSections));

watch(
  () => props.region.policy,
  (policy) => {
    panelWidth.value = widthForPolicy(policy);
  },
);

function toggleSection(key: SectionKey) {
  const next = new Set(openSections.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  openSections.value = next;
}

function sectionLabel(section: SectionKey): string {
  if (section === 'backlinks') return '反链';
  if (section === 'tags') return '标签';
  return '大纲';
}

function sectionCount(section: SectionKey): number {
  if (section === 'backlinks') return props.backlinks.length;
  if (section === 'tags') return props.tags.length;
  return props.headings.length;
}

// ============================================================
// Grab handle — double-click collapse
// ============================================================
function handleDoubleClick() {
  emit('toggle-collapse');
}

// ============================================================
// Resize (minimal: constrains to token range, mouseup cleanup)
// ============================================================
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;
const panelWidth = ref(widthForPolicy(props.region.policy));

let resizeActive = false;

function setPanelWidth(width: number): void {
  panelWidth.value = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
}

function handleHandleKeydown(event: KeyboardEvent): void {
  const step = event.shiftKey ? 24 : 12;

  switch (event.key) {
    case 'Enter':
    case ' ':
      event.preventDefault();
      emit('toggle-collapse');
      break;
    case 'ArrowLeft':
      event.preventDefault();
      if (props.collapsed) emit('toggle-collapse');
      else setPanelWidth(panelWidth.value + step);
      break;
    case 'ArrowRight':
      event.preventDefault();
      if (!props.collapsed) setPanelWidth(panelWidth.value - step);
      break;
    case 'Home':
      event.preventDefault();
      setPanelWidth(MIN_WIDTH);
      break;
    case 'End':
      event.preventDefault();
      setPanelWidth(MAX_WIDTH);
      break;
  }
}

function handleResizeStart(e: PointerEvent) {
  if (e.detail >= 2) return; // ignore double-click drag
  e.preventDefault();
  resizeActive = true;
  const startX = e.clientX;
  const startWidth = panelWidth.value;

  const onMove = (ev: PointerEvent) => {
    if (!resizeActive) return;
    const delta = ev.clientX - startX;
    setPanelWidth(startWidth - delta);
  };

  const onUp = () => {
    resizeActive = false;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

function widthForPolicy(policy: ThemeRightWingPolicy): number {
  if (policy === 'research') return 360;
  if (policy === 'production') return 320;
  if (policy === 'atlas') return 344;
  return 240;
}

// ============================================================
// Tag cloud — 5-level font-size by frequency
// ============================================================
const FONT_LEVELS = ['12px', '14px', '16px', '18px', '20px'] as const;

interface StyledTag extends TagEntry {
  fontSize: string;
}

const styledTags = computed<StyledTag[]>(() => {
  const list = props.tags;
  if (list.length === 0) return [];
  const maxCount = Math.max(...list.map((t) => t.count));
  if (maxCount === 0) {
    return list.map((t) => ({ ...t, fontSize: FONT_LEVELS[0] as string }));
  }
  return list.map((t) => {
    const ratio = t.count / maxCount; // 0..1
    const level = Math.min(Math.ceil(ratio * 5), 5); // 1..5
    return { ...t, fontSize: FONT_LEVELS[level - 1] as string };
  });
});

// ============================================================
// Navigate heading — relay to parent
// ============================================================
function onNavigateHeading(headingId: string, lineNumber: number) {
  emit('navigate-heading', headingId, lineNumber);
}
</script>

<style scoped>
/* ============================================================
 * Wing Layout
 * ============================================================ */
.right-wing {
  position: relative;
  width: var(--wing-right-width);
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--paper-right);
  user-select: none;
  overflow: visible;
  transition:
    background-color var(--dur-micro) var(--ease-fade),
    border-color var(--dur-micro) var(--ease-fade);
}

.right-wing.collapsed {
  width: 0;
  min-width: 0;
  padding: 0;
  overflow: hidden;
}

.right-wing[data-policy='research'] {
  background: color-mix(in oklch, var(--paper-right) 86%, var(--accent-soft));
}

.right-wing[data-policy='production'] {
  border-left: var(--border-thin) solid var(--rule-strong);
  background: var(--paper-raised);
}

.right-wing[data-policy='atlas'] {
  border-left: var(--border-thin) solid color-mix(in oklch, var(--accent) 32%, transparent);
  background:
    linear-gradient(
      180deg,
      color-mix(in oklch, var(--accent-soft) 30%, transparent),
      transparent 26%
    ),
    var(--paper-right);
}

/* ============================================================
 * Grab Handle (left edge)
 * ============================================================ */
.grab-handle {
  position: absolute;
  left: calc(var(--touch-target-min) / -2);
  top: 0;
  bottom: 0;
  width: var(--touch-target-min);
  cursor: col-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
  touch-action: none;
}

.grab-handle:focus-visible {
  outline: var(--focus-ring-width) solid var(--accent);
  outline-offset: calc(-1 * var(--focus-ring-offset));
}

.grab-line {
  width: 2px;
  height: 32px;
  border-radius: 1px;
  background: var(--rule);
  opacity: 0;
  transition:
    background var(--dur-micro) var(--ease-fade),
    opacity var(--dur-micro) var(--ease-fade);
}

.grab-handle:hover .grab-line,
.grab-handle:active .grab-line {
  background: var(--accent);
  opacity: 0.6;
}

.right-wing:hover .grab-line {
  opacity: 0.35;
}

/* ============================================================
 * Panel Content
 * ============================================================ */
.wing-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden auto;
  padding: var(--space-12) 0;
  scrollbar-width: thin;
}

.wing-content[data-mode='research'] {
  padding-top: var(--space-8);
  background:
    linear-gradient(
      180deg,
      color-mix(in oklch, var(--accent-soft) 36%, transparent),
      transparent 42%
    ),
    transparent;
}

.wing-content[data-mode='quiet'] {
  opacity: 0.78;
}

.wing-content[data-mode='rail'] {
  padding-block: var(--space-8);
}

.wing-content[data-mode='atlas'] {
  padding-top: var(--space-10);
}

/* ============================================================
 * Sections
 * ============================================================ */
.wing-section {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

/* --- Section Header --- */
.section-header {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  width: 100%;
  padding: var(--space-8) var(--space-12);
  border: none;
  background: none;
  color: var(--ink-secondary);
  font-family: var(--ff-body);
  font-size: var(--text-sm);
  font-weight: var(--fw-medium);
  line-height: var(--lh-ui);
  cursor: pointer;
  transition:
    color var(--dur-micro) var(--ease-fade),
    background var(--dur-micro) var(--ease-fade);
}

.section-header:hover {
  color: var(--ink-primary);
  background: var(--surface-hover);
}

.section-header:active {
  background: var(--surface-active);
}

.wing-content[data-mode='rail'] .section-header {
  padding-block: var(--space-6);
}

.wing-section[data-section='backlinks'] .section-header,
.wing-section[data-section='tags'] .section-header {
  min-height: 34px;
}

.wing-content[data-mode='atlas'] .section-header {
  padding-inline: var(--space-14);
}

.wing-content[data-mode='research'] .wing-section:first-child .section-header {
  border-block: var(--border-thin) solid var(--rule);
  background: var(--paper-raised);
}

.wing-content[data-mode='atlas'] .wing-section:first-child .section-header {
  border-block: var(--border-thin) solid color-mix(in oklch, var(--rule) 82%, transparent);
  background: color-mix(in oklch, var(--paper-raised) 86%, transparent);
}

.section-icon {
  flex-shrink: 0;
  opacity: 0.6;
}

.section-header:hover .section-icon {
  opacity: 0.85;
}

.section-label {
  flex: 1;
  text-align: left;
  letter-spacing: var(--ls-wide);
  text-transform: uppercase;
  font-size: var(--text-xs);
  font-weight: var(--fw-semibold);
}

.count-badge {
  flex-shrink: 0;
  min-width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--rule);
  color: var(--ink-muted);
  font-size: 10px;
  font-weight: var(--fw-semibold);
  border-radius: var(--radius-full);
  padding: 0 4px;
  line-height: var(--lh-none);
}

.chevron {
  flex-shrink: 0;
  opacity: 0.45;
  transition: transform var(--dur-expand) var(--ease-fold);
}

.chevron.open {
  transform: rotate(180deg);
}

/* --- Section Rule (divider between sections) --- */
.section-rule {
  height: var(--border-thin);
  margin: 0 var(--space-12);
  background: var(--rule);
  flex-shrink: 0;
}

/* --- Section Body --- */
.section-body {
  overflow: hidden auto;
  max-height: 280px;
  scrollbar-width: thin;
}

.section-body--outline {
  padding: var(--space-4) 0;
}

.section-body--backlinks {
  padding: var(--space-4) 0;
}

.section-body--tags {
  padding: var(--space-8) var(--space-12);
}

/* ============================================================
 * Outline — Heading Tree
 * ============================================================ */
.heading-tree {
  list-style: none;
  margin: 0;
  padding: 0;
}

.heading-node {
  margin: 0;
  padding: 0;
}

.heading-link {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  width: 100%;
  padding: var(--space-4) var(--space-12);
  border: none;
  background: none;
  color: var(--ink-secondary);
  font-family: var(--ff-body);
  font-size: var(--text-xs);
  line-height: var(--lh-ui);
  text-align: left;
  cursor: pointer;
  transition:
    color var(--dur-micro) var(--ease-fade),
    background var(--dur-micro) var(--ease-fade);
  position: relative;
}

.heading-link:hover {
  color: var(--ink-primary);
  background: var(--surface-hover);
}

.heading-node.active .heading-link {
  color: var(--ink-primary);
  background: var(--accent-soft);
}

.heading-accent {
  flex-shrink: 0;
  width: 2px;
  height: 14px;
  border-radius: 1px;
  background: transparent;
  transition: background var(--dur-micro) var(--ease-fade);
}

.heading-node.active .heading-accent {
  background: var(--accent);
}

.heading-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-body--outline :deep(.heading-tree) {
  list-style: none;
  margin: 0;
  padding: 0;
}

.section-body--outline :deep(.heading-node) {
  margin: 0;
  padding: 0;
}

.section-body--outline :deep(.heading-link) {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  width: 100%;
  min-height: 28px;
  padding-block: var(--space-4);
  padding-inline-end: var(--space-12);
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--ink-secondary);
  font-family: var(--ff-body);
  font-size: var(--text-xs);
  font-weight: var(--fw-regular);
  line-height: var(--lh-ui);
  text-align: left;
  cursor: pointer;
  box-shadow: none;
}

.section-body--outline :deep(.heading-link:hover) {
  background: var(--surface-hover);
  color: var(--ink-primary);
}

.section-body--outline :deep(.heading-node.active > .heading-link) {
  background: var(--accent-soft);
  color: var(--ink-primary);
}

.section-body--outline :deep(.heading-accent) {
  flex: 0 0 2px;
  width: 2px;
  height: 14px;
  border-radius: var(--radius-full);
  background: transparent;
}

.section-body--outline :deep(.heading-node.active > .heading-link .heading-accent) {
  background: var(--accent);
}

.section-body--outline :deep(.heading-text) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ============================================================
 * Backlinks
 * ============================================================ */
.backlink-item {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: var(--space-8) var(--space-12);
  border: none;
  background: none;
  text-align: left;
  cursor: pointer;
  transition: background var(--dur-micro) var(--ease-fade);
}

.backlink-item:hover {
  background: var(--surface-hover);
}

.backlink-item:active {
  background: var(--surface-active);
}

.backlink-title {
  font-family: var(--ff-body);
  font-size: var(--text-xs);
  font-weight: var(--fw-medium);
  color: var(--ink-primary);
  line-height: var(--lh-ui);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.backlink-context {
  font-family: var(--ff-body);
  font-size: var(--text-xs);
  color: var(--ink-muted);
  line-height: var(--lh-ui);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ============================================================
 * Tag Cloud
 * ============================================================ */
.tag-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-8);
  align-items: center;
}

.tag-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border: var(--border-thin) solid transparent;
  border-radius: var(--radius);
  background: none;
  color: var(--ink-secondary);
  font-family: var(--ff-body);
  line-height: var(--lh-ui);
  cursor: pointer;
  transition:
    color var(--dur-micro) var(--ease-fade),
    border-color var(--dur-micro) var(--ease-fade),
    background var(--dur-micro) var(--ease-fade);
}

.tag-chip:hover {
  color: var(--accent);
  border-color: var(--accent-ring);
  background: var(--accent-soft);
}

.tag-chip:active {
  background: var(--surface-active);
  transform: scale(0.95);
  transition: transform var(--dur-press) var(--ease-press);
}

/* ============================================================
 * Empty Hint
 * ============================================================ */
.empty-hint {
  padding: var(--space-12);
  text-align: center;
  font-family: var(--ff-body);
  font-size: var(--text-xs);
  color: var(--ink-muted);
  line-height: var(--lh-ui);
  font-style: italic;
}
</style>
