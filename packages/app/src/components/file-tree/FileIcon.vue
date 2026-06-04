<!-- eslint-disable vue/no-v-html -->
<template>
  <svg
    class="file-icon"
    :class="iconClass"
    :style="svgStyle"
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    v-html="svgContent"
  />
</template>

<script lang="ts">
export default { name: 'FileIcon' };
</script>

<script setup lang="ts">
/**
 * FileIcon.vue — 几何 SVG 图标系统（blueprint / architectural style）
 *
 * 所有图标 16×16 viewBox，solid geometric block style。
 * 矩形、圆、三角形、多边形为主；stroke-based 用于线条类，fill-based 用于块面。
 * 全部使用 currentColor，颜色通过 CSS 自定义属性注入。
 *
 * 向后兼容：支持 <FileIcon :node :is-open> (FileTreeNode 用法)
 * 新 API：<FileIcon icon="plus" :size="14" />
 */
import { computed } from 'vue';
import type { DirEntry } from '@/types';

// ==========================================================================
// Icon 定义 — 每项为 16×16 viewBox 内部 SVG 子元素字符串（无 <svg> 包裹层）。
// 全部硬编码，非用户输入 — v-html 无 XSS 风险。
// ==========================================================================

/** 文件类图标共享基形（dog-ear 折角文档） */
const DOC_BODY =
  `<path d="M3 2H10L13 5V13.5C13 14.33 12.33 15 11.5 15H3.5C2.67 15 2 14.33 2 13.5V3.5C2 2.67 2.67 2 3 2Z" fill="currentColor" opacity=".12"/>` +
  `<path d="M10 2L13 5H10V2Z" fill="currentColor" opacity=".25"/>`;

const ICONS: Record<string, string> = {
  // ── 文件类型 (6) ─────────────────────────────────────────────────

  folder: `<path d="M2 5V13.5C2 14.33 2.67 15 3.5 15H12.5C13.33 15 14 14.33 14 13.5V5H7L6 3H3.5V5Z" fill="currentColor"/>`,

  'folder-open':
    `<path d="M2 6V13.5C2 14.33 2.67 15 3.5 15H12.5C13.33 15 14 14.33 14 13.5V6H2Z" fill="currentColor" opacity=".85"/>` +
    `<path d="M2 6L3.5 3H7L8 5H14V6H2Z" fill="currentColor" opacity=".35"/>`,

  markdown:
    DOC_BODY +
    `<line x1="6.5" y1="8" x2="6.5" y2="13" stroke="currentColor" stroke-width="1.5" opacity=".7"/>` +
    `<line x1="10" y1="8" x2="10" y2="13" stroke="currentColor" stroke-width="1.5" opacity=".7"/>` +
    `<line x1="5" y1="10" x2="11.5" y2="10" stroke="currentColor" stroke-width="1.2" opacity=".7"/>` +
    `<line x1="5" y1="12" x2="11.5" y2="12" stroke="currentColor" stroke-width="1.2" opacity=".7"/>`,

  image:
    DOC_BODY +
    `<circle cx="5.5" cy="8.5" r="1.5" fill="currentColor" opacity=".5"/>` +
    `<polygon points="3,13 6,8.5 9.5,11 12.5,7 14,9 14,13" fill="currentColor" opacity=".35"/>`,

  text:
    DOC_BODY +
    `<rect x="5" y="8.5" width="6.5" height="1.2" fill="currentColor" opacity=".55"/>` +
    `<rect x="5" y="10.5" width="5" height="1.2" fill="currentColor" opacity=".4"/>` +
    `<rect x="5" y="12.5" width="6" height="1.2" fill="currentColor" opacity=".3"/>`,

  generic:
    DOC_BODY +
    `<rect x="5" y="9" width="6" height="1" fill="currentColor" opacity=".35"/>` +
    `<rect x="5" y="11" width="4" height="1" fill="currentColor" opacity=".25"/>`,

  // ── 操作类 (6) ───────────────────────────────────────────────────

  plus: `<rect x="1" y="7" width="14" height="2" fill="currentColor"/><rect x="7" y="1" width="2" height="14" fill="currentColor"/>`,

  search:
    `<circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/>` +
    `<line x1="10" y1="10" x2="14" y2="14" stroke="currentColor" stroke-width="2.5"/>`,

  settings:
    `<rect x="7" y="1.5" width="2" height="2.5" fill="currentColor"/>` +
    `<rect x="7" y="12" width="2" height="2.5" fill="currentColor"/>` +
    `<rect x="1.5" y="7" width="2.5" height="2" fill="currentColor"/>` +
    `<rect x="12" y="7" width="2.5" height="2" fill="currentColor"/>` +
    `<circle cx="8" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="1.5"/>` +
    `<circle cx="8" cy="8" r="1.2" fill="currentColor"/>`,

  delete:
    `<line x1="2.5" y1="2.5" x2="13.5" y2="13.5" stroke="currentColor" stroke-width="2"/>` +
    `<line x1="13.5" y1="2.5" x2="2.5" y2="13.5" stroke="currentColor" stroke-width="2"/>`,

  more:
    `<rect x="2" y="7" width="2" height="2" fill="currentColor"/>` +
    `<rect x="7" y="7" width="2" height="2" fill="currentColor"/>` +
    `<rect x="12" y="7" width="2" height="2" fill="currentColor"/>`,

  refresh:
    `<path d="M3 8C3 4 6 2 9 2C12.5 2 14 5 14 8" fill="none" stroke="currentColor" stroke-width="2"/>` +
    `<polygon points="14,8 11,6 11,9" fill="currentColor"/>`,

  // ── 导航 (4) — 实心三角形 ────────────────────────────────────────

  'chevron-right': `<polygon points="5.5,3 12,8 5.5,13" fill="currentColor"/>`,
  'chevron-down': `<polygon points="3,5.5 8,12 13,5.5" fill="currentColor"/>`,
  'chevron-up': `<polygon points="3,10.5 8,4 13,10.5" fill="currentColor"/>`,
  'chevron-left': `<polygon points="10.5,3 4,8 10.5,13" fill="currentColor"/>`,

  // ── 块/编辑类型 (6) ──────────────────────────────────────────────

  link:
    `<path d="M4.5 4.5H7.5C9.5 4.5 11 6 11 8C11 10 9.5 11.5 7.5 11.5H6" fill="none" stroke="currentColor" stroke-width="2"/>` +
    `<path d="M11.5 11.5H8.5C6.5 11.5 5 10 5 8C5 6 6.5 4.5 8.5 4.5H10" fill="none" stroke="currentColor" stroke-width="2"/>`,

  code:
    `<path d="M5 4L2 8L5 12" fill="none" stroke="currentColor" stroke-width="2"/>` +
    `<path d="M11 4L14 8L11 12" fill="none" stroke="currentColor" stroke-width="2"/>`,

  table:
    `<rect x="2" y="2.5" width="12" height="11" fill="none" stroke="currentColor" stroke-width="1.5"/>` +
    `<line x1="2" y1="6" x2="14" y2="6" stroke="currentColor" stroke-width="1"/>` +
    `<line x1="2" y1="10" x2="14" y2="10" stroke="currentColor" stroke-width="1"/>` +
    `<line x1="6" y1="2.5" x2="6" y2="13.5" stroke="currentColor" stroke-width="1"/>` +
    `<line x1="10" y1="2.5" x2="10" y2="13.5" stroke="currentColor" stroke-width="1"/>`,

  list:
    `<rect x="3" y="3" width="2" height="2" fill="currentColor" opacity=".7"/>` +
    `<rect x="7" y="3" width="7" height="1.5" fill="currentColor" opacity=".5"/>` +
    `<rect x="3" y="7" width="2" height="2" fill="currentColor" opacity=".7"/>` +
    `<rect x="7" y="7" width="7" height="1.5" fill="currentColor" opacity=".5"/>` +
    `<rect x="3" y="11" width="2" height="2" fill="currentColor" opacity=".7"/>` +
    `<rect x="7" y="11" width="7" height="1.5" fill="currentColor" opacity=".5"/>`,

  tag: `<path d="M2 3H8L13 8L8 13H2V3Z" fill="currentColor"/>`,

  'image-block':
    `<rect x="1" y="2" width="14" height="12" fill="currentColor" fill-opacity=".1" stroke="currentColor" stroke-opacity=".35" stroke-width="1"/>` +
    `<polygon points="2,12 5.5,8 9,11 12.5,7 13.5,8 13.5,12" fill="currentColor" fill-opacity=".4"/>` +
    `<circle cx="5" cy="6.5" r="1.2" fill="currentColor" fill-opacity=".55"/>`,
};

// ==========================================================================
// Props — 兼容现有用法 + 新 API
// ==========================================================================

const props = withDefaults(
  defineProps<{
    /** 直接指定图标名称（新 API — 优先级高于 node） */
    icon?: string;
    /** 旧 API：DirEntry，从文件类型推导图标 */
    node?: DirEntry;
    /** 旧 API：目录是否展开 */
    isOpen?: boolean;
    /** 图标尺寸 px（默认 16） */
    size?: number;
  }>(),
  { isOpen: false, size: 16, icon: undefined, node: undefined },
);

// ==========================================================================
// Computed
// ==========================================================================

/** 解析图标名：icon prop > node 推导 > 'generic' */
const resolvedIcon = computed<string>(() => {
  if (props.icon) return props.icon;
  if (props.node) {
    if (props.node.isDirectory) return props.isOpen ? 'folder-open' : 'folder';
    if (props.node.name.endsWith('.md')) return 'markdown';
    if (props.node.mimeType?.startsWith('image/')) return 'image';
    if (props.node.name.endsWith('.txt')) return 'text';
    return 'generic';
  }
  return 'generic';
});

/** 解析后的 SVG 内部子元素 — 模板中通过 v-html 使用 */
const svgContent = computed(() => ICONS[resolvedIcon.value] ?? ICONS['generic']);

/** CSS class 用于外部主题挂钩 */
const iconClass = computed(() => {
  const name = resolvedIcon.value;
  if (name === 'folder' || name === 'folder-open') return 'file-icon--folder';
  if (name === 'markdown') return 'file-icon--md';
  if (name === 'image' || name === 'image-block') return 'file-icon--image';
  if (name === 'text') return 'file-icon--text';
  return 'file-icon--generic';
});

/** 图标颜色 — 通过 currentColor 映射到 CSS 自定义属性 */
const iconColor = computed(() => {
  const name = resolvedIcon.value;
  if (name === 'folder' || name === 'folder-open') return 'var(--icon-folder)';
  if (name === 'markdown') return 'var(--icon-md)';
  if (name === 'image' || name === 'image-block') return 'var(--icon-image)';
  const actions: ReadonlySet<string> = new Set([
    'plus',
    'search',
    'settings',
    'delete',
    'more',
    'refresh',
    'chevron-right',
    'chevron-down',
    'chevron-up',
    'chevron-left',
  ]);
  if (actions.has(name)) return 'var(--icon-action)';
  return 'var(--icon-generic)';
});

/** 内联 style 对象 */
const svgStyle = computed(() => ({ color: iconColor.value }));
</script>

<style scoped>
.file-icon {
  flex-shrink: 0;
  transition: color var(--transition-micro, 150ms ease-out);
}
</style>
