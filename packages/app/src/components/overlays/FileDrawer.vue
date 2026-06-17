<template>
  <Teleport to="body">
    <Transition name="drawer" @after-leave="onAfterLeave">
      <div
        v-if="visible"
        class="drawer-overlay"
        role="presentation"
        @click.self="close"
        @keydown="handleKeydown"
      >
        <aside
          class="file-drawer"
          role="dialog"
          aria-label="文件浏览器"
          aria-modal="true"
          @click="closeContextMenu"
        >
          <!-- ===== Header ===== -->
          <div class="drawer-header">
            <!-- Breadcrumb -->
            <div class="drawer-breadcrumb">
              <button
                class="breadcrumb-item breadcrumb-root"
                title="返回根目录"
                @click="$emit('navigate-dir', rootDir)"
              >
                <svg
                  class="breadcrumb-icon"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  aria-hidden="true"
                >
                  <path
                    d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                <span class="breadcrumb-name">{{ notebookName }}</span>
              </button>
            </div>

            <!-- Action Row: Search + New -->
            <div class="drawer-actions">
              <div class="search-box">
                <svg
                  class="search-icon"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" stroke-linecap="round" />
                </svg>
                <input
                  v-model="searchQuery"
                  class="search-input"
                  type="text"
                  placeholder="筛选文件..."
                  aria-label="筛选文件"
                  autocomplete="off"
                  spellcheck="false"
                  @input="onSearchInput"
                />
                <button
                  v-if="searchQuery.length > 0"
                  class="search-clear"
                  aria-label="清除筛选"
                  @click="searchQuery = ''"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" stroke-linecap="round" />
                    <line x1="6" y1="6" x2="18" y2="18" stroke-linecap="round" />
                  </svg>
                </button>
              </div>

              <button class="new-note-btn" title="新建笔记" @click="$emit('create-file')">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <line x1="12" y1="5" x2="12" y2="19" stroke-linecap="round" />
                  <line x1="5" y1="12" x2="19" y2="12" stroke-linecap="round" />
                </svg>
                <span>新建笔记</span>
              </button>
            </div>
          </div>

          <!-- ===== Divider ===== -->
          <div class="drawer-rule" aria-hidden="true" />

          <!-- ===== Body: States ===== -->
          <div class="drawer-body">
            <!-- Loading: Skeleton -->
            <div v-if="loading" class="drawer-skeleton" role="status" aria-label="加载中">
              <div
                v-for="i in 8"
                :key="i"
                class="skeleton-row"
                :style="{
                  '--skel-depth': `${(i % 3) * 20 + 8}px`,
                  '--skel-delay': `${i * 80}ms`,
                }"
              >
                <span class="skeleton-icon" />
                <span class="skeleton-line" />
              </div>
            </div>

            <!-- Error -->
            <div v-else-if="error" class="drawer-state" role="alert">
              <svg
                class="state-icon state-icon-error"
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" stroke-linecap="round" />
                <line x1="12" y1="16" x2="12.01" y2="16" stroke-linecap="round" />
              </svg>
              <p class="state-text">{{ error }}</p>
              <button class="state-action" @click="$emit('retry')">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <polyline
                    points="23,4 23,10 17,10"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                <span>重试</span>
              </button>
            </div>

            <!-- Empty -->
            <div v-else-if="files.length === 0 && !loading && !error" class="drawer-state">
              <svg
                class="state-icon"
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                aria-hidden="true"
              >
                <path
                  d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <polyline points="14,2 14,8 20,8" stroke-linecap="round" stroke-linejoin="round" />
                <line x1="12" y1="18" x2="12" y2="12" stroke-linecap="round" />
                <line x1="9" y1="15" x2="15" y2="15" stroke-linecap="round" />
              </svg>
              <p class="state-text">还没有笔记</p>
              <p class="state-hint">创建你的第一篇笔记，开始记录</p>
              <button class="state-action" @click="$emit('create-file')">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <line x1="12" y1="5" x2="12" y2="19" stroke-linecap="round" />
                  <line x1="5" y1="12" x2="19" y2="12" stroke-linecap="round" />
                </svg>
                <span>新建笔记</span>
              </button>
            </div>

            <!-- File Tree -->
            <div
              v-else
              ref="treeContainerRef"
              class="drawer-tree"
              role="tree"
              aria-label="文件列表"
            >
              <template v-if="displayNodes.length > 0">
                <div
                  v-for="node in displayNodes"
                  :key="node.entry.path"
                  class="tree-item"
                  :class="{
                    active: node.entry.path === activePath,
                    'is-directory': node.entry.isDirectory,
                    'is-expanded': node.isExpanded,
                    'no-children': node.entry.isDirectory && !node.hasChildren,
                  }"
                  :style="{ paddingInlineStart: `${node.depth * 16 + 8}px` }"
                  role="treeitem"
                  :aria-expanded="node.entry.isDirectory ? node.isExpanded : undefined"
                  :aria-selected="node.entry.path === activePath"
                  @click="handleItemClick(node)"
                  @dblclick="handleItemDblClick(node)"
                  @contextmenu.prevent="openContextMenu($event, node)"
                >
                  <!-- Active Indicator -->
                  <span
                    v-if="node.entry.path === activePath && !node.entry.isDirectory"
                    class="active-indicator"
                    aria-hidden="true"
                  />

                  <!-- Chevron -->
                  <button
                    v-if="node.entry.isDirectory"
                    class="tree-chevron"
                    :class="{ expanded: node.isExpanded }"
                    tabindex="-1"
                    aria-hidden="true"
                    @click.stop="toggleDir(node.entry.path)"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                    >
                      <polyline
                        points="9,18 15,12 9,6"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                  </button>

                  <!-- Icon -->
                  <span class="tree-icon" :class="iconClass(node)" aria-hidden="true">
                    <!-- Directory: Closed -->
                    <svg
                      v-if="node.entry.isDirectory && !node.isExpanded"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                    >
                      <path
                        d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                    <!-- Directory: Open -->
                    <svg
                      v-else-if="node.entry.isDirectory && node.isExpanded"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                    >
                      <path
                        d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                      <line x1="9" y1="14" x2="16" y2="14" stroke-linecap="round" />
                    </svg>
                    <!-- Markdown File -->
                    <svg
                      v-else-if="isMarkdownFile(node.entry.name)"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                    >
                      <path
                        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                      <polyline
                        points="14,2 14,8 20,8"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                      <line x1="8" y1="13" x2="16" y2="13" stroke-linecap="round" />
                      <line x1="8" y1="17" x2="13" y2="17" stroke-linecap="round" />
                    </svg>
                    <!-- Image File -->
                    <svg
                      v-else-if="isImageFile(node.entry.name)"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline
                        points="21,15 16,10 5,21"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                    <!-- Generic File -->
                    <svg
                      v-else
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                    >
                      <path
                        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                      <polyline
                        points="14,2 14,8 20,8"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                  </span>

                  <!-- Name / Inline Rename -->
                  <span v-if="renamingPath !== node.entry.path" class="tree-name">
                    {{ node.entry.name }}
                  </span>
                  <input
                    v-else
                    :ref="setRenameInputRef"
                    v-model="renameValue"
                    class="tree-rename-input"
                    type="text"
                    spellcheck="false"
                    @keydown.enter.prevent="commitRename"
                    @keydown.escape.prevent="cancelRename"
                    @blur="commitRename"
                    @click.stop
                  />
                </div>
              </template>

              <!-- No search results -->
              <div
                v-if="searchQuery.length > 0 && displayNodes.length === 0"
                class="drawer-state drawer-state-search"
              >
                <p class="state-text">无匹配文件</p>
                <p class="state-hint">尝试其他关键词</p>
              </div>
            </div>
          </div>
        </aside>

        <!-- ===== Context Menu ===== -->
        <Teleport to="body">
          <div
            v-if="contextMenu.visible"
            class="context-menu"
            :style="contextMenuStyle"
            role="menu"
            aria-label="文件操作"
            @click.stop
          >
            <button class="context-menu-item" role="menuitem" @click="handleContextMenuRename">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <path
                  d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <span>重命名</span>
            </button>
            <button
              class="context-menu-item context-menu-item--danger"
              role="menuitem"
              @click="handleContextMenuDelete"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <polyline points="3,6 5,6 21,6" stroke-linecap="round" stroke-linejoin="round" />
                <path
                  d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <span>删除</span>
            </button>
          </div>
        </Teleport>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * FileDrawer.vue — 左侧滑出文件树面板
 *
 * 从窗口左侧滑出，覆盖在编辑器之上（无布局偏移）。
 * 展示完整的笔记本文件树，支持展开/折叠、搜索筛选、
 * 右键菜单（重命名、删除）和双击内联重命名。
 *
 * States: Loading (骨架屏), Empty (尚无笔记), Error (消息+重试), Normal (文件树)
 *
 * @see spec/frontend/components.md
 */
import { ref, computed, watch, nextTick } from 'vue';
import type { DirEntry } from '@/types';

// ============================================================
// Props & Emits
// ============================================================

const props = withDefaults(
  defineProps<{
    visible: boolean;
    files: DirEntry[];
    rootDir?: string;
    activePath?: string;
    loading?: boolean;
    error?: string;
  }>(),
  {
    rootDir: '',
    activePath: '',
    loading: false,
    error: '',
  },
);

const emit = defineEmits<{
  'update:visible': [value: boolean];
  'select-file': [path: string];
  'navigate-dir': [path: string];
  'create-file': [];
  'delete-file': [path: string];
  'rename-file': [oldPath: string, newName: string];
  retry: [];
}>();

// ============================================================
// Internal Types
// ============================================================

interface FlatNode {
  entry: DirEntry;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
}

// ============================================================
// Local State
// ============================================================

const searchQuery = ref('');
const expandedDirs = ref<Set<string>>(new Set());
const renamingPath = ref<string | null>(null);
const renameValue = ref('');
const renameInputEl = ref<HTMLInputElement | null>(null);
const treeContainerRef = ref<HTMLElement | null>(null);

const contextMenu = ref<{
  visible: boolean;
  x: number;
  y: number;
  node: FlatNode | null;
}>({
  visible: false,
  x: 0,
  y: 0,
  node: null,
});

// ============================================================
// Derived
// ============================================================

const notebookName = computed(() => {
  if (!props.rootDir) return '笔记本';
  const segments = props.rootDir.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments[segments.length - 1] || props.rootDir || '笔记本';
});

const contextMenuStyle = computed(() => ({
  left: `${contextMenu.value.x}px`,
  top: `${contextMenu.value.y}px`,
}));

/**
 * Build a flat, depth-ordered list from the DirEntry array.
 * Directories are sorted before files; each group is sorted alphabetically.
 * Only expanded directories' children are included in the output.
 */
const flatTree = computed<FlatNode[]>(() => {
  const files = props.files;
  if (files.length === 0) return [];

  // Group entries by parent directory path
  const byParent = new Map<string, DirEntry[]>();
  for (const entry of files) {
    const parent = dirname(entry.path);
    if (!byParent.has(parent)) {
      byParent.set(parent, []);
    }
    byParent.get(parent)!.push(entry);
  }

  // Sort: directories first, then alphabetically within each group
  for (const [, entries] of byParent) {
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-Hans', { sensitivity: 'base' });
    });
  }

  const result: FlatNode[] = [];
  const expandedSet = expandedDirs.value;

  /**
   * Recursively walk the tree, appending entries whose parent is `parentPath`.
   * Only descend into directories that exist in `expandedSet`.
   */
  function walk(parentPath: string, depth: number): void {
    const children = byParent.get(parentPath);
    if (!children || children.length === 0) return;

    for (const entry of children) {
      const childCount = byParent.get(entry.path)?.length ?? 0;
      const hasChildren = entry.isDirectory && childCount > 0;
      const isExpanded = entry.isDirectory && expandedSet.has(entry.path);

      result.push({
        entry,
        depth,
        hasChildren,
        isExpanded,
      });

      if (entry.isDirectory && isExpanded) {
        walk(entry.path, depth + 1);
      }
    }
  }

  // Normalize root: '/' → '' so walk matches dirname('/file.md') → ''
  // For subdirectories like '/子文件夹', walk from '/子文件夹'
  const walkRoot = props.rootDir === '/' ? '' : props.rootDir || '';
  walk(walkRoot, 0);
  return result;
});

/**
 * When search is active, show a flat filtered list.
 * Otherwise, show the complete tree.
 */
const displayNodes = computed<FlatNode[]>(() => {
  if (searchQuery.value.trim().length === 0) {
    return flatTree.value;
  }

  const query = searchQuery.value.trim().toLowerCase();
  const results: FlatNode[] = [];

  for (const node of flatTree.value) {
    if (node.entry.name.toLowerCase().includes(query)) {
      results.push({ ...node, depth: 0 });
    }
  }

  return results;
});

// ============================================================
// Methods — Utilities
// ============================================================

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash === -1 ? '' : normalized.substring(0, lastSlash);
}

function isMarkdownFile(name: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(name);
}

function isImageFile(name: string): boolean {
  return /\.(png|jpe?g|gif|svg|webp|bmp|ico|avif)$/i.test(name);
}

function iconClass(node: FlatNode): string {
  if (node.entry.isDirectory) {
    return node.isExpanded ? 'icon-folder-open' : 'icon-folder';
  }
  if (isMarkdownFile(node.entry.name)) return 'icon-markdown';
  if (isImageFile(node.entry.name)) return 'icon-image';
  return 'icon-generic';
}

function extractFileNameWithoutExt(fullName: string): string {
  const lastDot = fullName.lastIndexOf('.');
  return lastDot <= 0 ? fullName : fullName.substring(0, lastDot);
}

function setRenameInputRef(el: unknown): void {
  renameInputEl.value = el as HTMLInputElement | null;
}

// ============================================================
// Methods — Drawer
// ============================================================

function close(): void {
  emit('update:visible', false);
}

function onAfterLeave(): void {
  // Reset all transient state when drawer fully closes
  searchQuery.value = '';
  renamingPath.value = null;
  renameValue.value = '';
  contextMenu.value.visible = false;
}

function onSearchInput(): void {
  // When searching, expand all directories so filter sees everything
  if (searchQuery.value.trim().length > 0) {
    const allDirs = new Set<string>();
    for (const entry of props.files) {
      if (entry.isDirectory) {
        allDirs.add(entry.path);
      }
    }
    expandedDirs.value = allDirs;
  }
}

// ============================================================
// Methods — Tree Interaction
// ============================================================

function toggleDir(path: string): void {
  const next = new Set(expandedDirs.value);
  if (next.has(path)) {
    next.delete(path);
  } else {
    next.add(path);
  }
  expandedDirs.value = next;
}

function handleItemClick(node: FlatNode): void {
  closeContextMenu();

  if (node.entry.isDirectory) {
    toggleDir(node.entry.path);
    emit('navigate-dir', node.entry.path);
  } else {
    emit('select-file', node.entry.path);
    close(); // 选择文件后自动关闭抽屉，避免 overlay 永久遮挡编辑器
  }
}

function handleItemDblClick(node: FlatNode): void {
  if (!node.entry.isDirectory) {
    startRename(node.entry.path, node.entry.name);
  }
}

// ============================================================
// Methods — Rename
// ============================================================

function startRename(path: string, currentName: string): void {
  renamingPath.value = path;
  renameValue.value = currentName;
  void nextTick(() => {
    const input = renameInputEl.value;
    if (input) {
      // Select filename without extension for Markdown files
      if (isMarkdownFile(currentName)) {
        const nameWithoutExt = extractFileNameWithoutExt(currentName);
        input.setSelectionRange(0, nameWithoutExt.length);
      } else {
        input.select();
      }
      input.focus();
    }
  });
}

function commitRename(): void {
  if (renamingPath.value === null) return;

  const newName = renameValue.value.trim();
  const oldPath = renamingPath.value;

  renamingPath.value = null;
  renameValue.value = '';

  if (newName.length === 0) return;

  const oldName = oldPath.includes('/') ? oldPath.substring(oldPath.lastIndexOf('/') + 1) : oldPath;

  if (newName === oldName) return;

  emit('rename-file', oldPath, newName);
}

function cancelRename(): void {
  renamingPath.value = null;
  renameValue.value = '';
}

// ============================================================
// Methods — Context Menu
// ============================================================

function openContextMenu(event: MouseEvent, node: FlatNode): void {
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    node,
  };

  // Close on next click outside
  nextTick(() => {
    document.addEventListener('click', closeContextMenu, { once: true });
  });
}

function closeContextMenu(): void {
  if (contextMenu.value.visible) {
    contextMenu.value.visible = false;
    contextMenu.value.node = null;
  }
}

function handleContextMenuRename(): void {
  const node = contextMenu.value.node;
  closeContextMenu();
  if (node) {
    startRename(node.entry.path, node.entry.name);
  }
}

function handleContextMenuDelete(): void {
  const node = contextMenu.value.node;
  closeContextMenu();
  if (node) {
    emit('delete-file', node.entry.path);
  }
}

// ============================================================
// Keyboard
// ============================================================

function handleKeydown(e: KeyboardEvent): void {
  // Priority 1: If context menu is open, Escape closes it
  if (contextMenu.value.visible && e.key === 'Escape') {
    e.preventDefault();
    closeContextMenu();
    return;
  }

  // Priority 2: If in rename mode, internal handlers for Enter/Escape apply
  if (renamingPath.value !== null) return;

  // Priority 3: Escape closes the drawer
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
  }
}

// ============================================================
// Watchers
// ============================================================

// When drawer opens, reset transient state and auto-expand to activePath
watch(
  () => props.visible,
  (isVisible) => {
    if (isVisible) {
      searchQuery.value = '';
      renamingPath.value = null;
      renameValue.value = '';
      contextMenu.value.visible = false;
      // Expand ancestor directories of active file
      if (props.activePath) {
        const next = new Set(expandedDirs.value);
        const parts = props.activePath.replace(/\\/g, '/').split('/');
        for (let i = 0; i < parts.length - 1; i++) {
          const ancestor = parts.slice(0, i + 1).join('/');
          if (ancestor) next.add(ancestor);
        }
        expandedDirs.value = next;
      }
    }
  },
);

// When files change externally (e.g., after rename/delete), cancel rename
watch(
  () => props.files,
  () => {
    if (renamingPath.value !== null) {
      const stillExists = props.files.some((f) => f.path === renamingPath.value);
      if (!stillExists) {
        cancelRename();
      }
    }
  },
);
</script>

<style scoped>
/* ============================================================
 * Overlay & Drawer Container
 * ============================================================ */
.drawer-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-drawer);
  background: var(--overlay);
}

.file-drawer {
  position: fixed;
  inset: 0 auto 0 0;
  width: var(--drawer-width);
  display: flex;
  flex-direction: column;
  background: var(--paper-left);
  border-right: var(--border-thin) solid var(--rule-wing);
  box-shadow: var(--shadow-stack);
  z-index: calc(var(--z-drawer) + 1);
  contain: layout style paint;
  will-change: transform;
}

/* ============================================================
 * Header
 * ============================================================ */
.drawer-header {
  flex-shrink: 0;
  padding: var(--space-12) var(--space-12) 0;
}

/* --- Breadcrumb --- */
.drawer-breadcrumb {
  display: flex;
  align-items: center;
  margin-bottom: var(--space-8);
}

.breadcrumb-item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  border: none;
  background: none;
  cursor: pointer;
  font-family: var(--ff-body);
  font-size: var(--text-sm);
  color: var(--ink-secondary);
  padding: var(--space-4) var(--space-8);
  border-radius: var(--radius);
  transition:
    color var(--dur-micro) var(--ease-fade),
    background var(--dur-micro) var(--ease-fade);
}

.breadcrumb-item:hover {
  color: var(--ink-primary);
  background: var(--surface-hover);
}

.breadcrumb-item:active {
  background: var(--surface-active);
  transform: scale(0.97);
  transition: transform var(--dur-press) var(--ease-press);
}

.breadcrumb-icon {
  flex-shrink: 0;
  color: var(--accent);
}

.breadcrumb-name {
  font-weight: var(--fw-medium);
}

/* --- Action Row --- */
.drawer-actions {
  display: flex;
  align-items: center;
  gap: var(--space-8);
}

.search-box {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--space-4);
  height: 32px;
  padding: 0 var(--space-8);
  background: var(--paper-surface);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  transition: border-color var(--dur-micro) var(--ease-fade);
}

.search-box:focus-within {
  border-color: var(--accent);
}

.search-icon {
  flex-shrink: 0;
  color: var(--ink-muted);
}

.search-input {
  flex: 1;
  height: 100%;
  border: none;
  background: none;
  outline: none;
  font-family: var(--ff-body);
  font-size: var(--text-xs);
  color: var(--ink-primary);
  caret-color: var(--accent);
}

.search-input::placeholder {
  color: var(--ink-muted);
  font-size: var(--text-xs);
}

.search-clear {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-full);
  background: none;
  color: var(--ink-muted);
  cursor: pointer;
  padding: 0;
  transition: color var(--dur-micro) var(--ease-fade);
}

.search-clear:hover {
  color: var(--ink-secondary);
}

/* --- New Note Button --- */
.new-note-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  height: 32px;
  padding: 0 var(--space-8);
  border: var(--border-thin) solid var(--rule-wing);
  border-radius: var(--radius);
  background: none;
  color: var(--ink-muted);
  font-family: var(--ff-body);
  font-size: var(--text-xs);
  cursor: pointer;
  white-space: nowrap;
  transition:
    color var(--dur-micro) var(--ease-fade),
    border-color var(--dur-micro) var(--ease-fade),
    background var(--dur-micro) var(--ease-fade);
}

.new-note-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.new-note-btn:active {
  background: var(--accent-soft);
  transform: scale(0.96);
  transition: transform var(--dur-press) var(--ease-press);
}

/* ============================================================
 * Divider
 * ============================================================ */
.drawer-rule {
  height: var(--border-thin);
  background: var(--rule-wing);
  margin: var(--space-8) var(--space-12);
  flex-shrink: 0;
}

/* ============================================================
 * Body
 * ============================================================ */
.drawer-body {
  flex: 1;
  overflow: hidden auto;
  overscroll-behavior: contain;
}

/* ============================================================
 * Skeleton Loading
 * ============================================================ */
.drawer-skeleton {
  padding: var(--space-8) 0;
}

.skeleton-row {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  height: 32px;
  padding: 0 var(--space-12);
  padding-inline-start: var(--skel-depth, 8px);
}

.skeleton-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border-radius: var(--radius);
  background: var(--rule);
  animation: skeleton-shimmer var(--dur-shimmer) var(--ease-fade) infinite;
  animation-delay: var(--skel-delay, 0ms);
}

.skeleton-line {
  flex: 1;
  height: 10px;
  border-radius: var(--radius);
  background: var(--rule);
  max-width: 70%;
  animation: skeleton-shimmer var(--dur-shimmer) var(--ease-fade) infinite;
  animation-delay: var(--skel-delay, 0ms);
}

@keyframes skeleton-shimmer {
  0%,
  100% {
    opacity: 0.3;
  }

  50% {
    opacity: 0.6;
  }
}

/* ============================================================
 * State: Error / Empty
 * ============================================================ */
.drawer-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-8);
  padding: var(--space-40) var(--space-16);
  text-align: center;
}

.drawer-state-search {
  padding: var(--space-24) var(--space-16);
}

.state-icon {
  color: var(--ink-muted);
  margin-bottom: var(--space-4);
}

.state-icon-error {
  color: var(--signal-error);
}

.state-text {
  font-size: var(--text-sm);
  font-weight: var(--fw-medium);
  color: var(--ink-secondary);
  line-height: var(--lh-ui);
  margin: 0;
}

.state-hint {
  font-size: var(--text-xs);
  color: var(--ink-muted);
  line-height: var(--lh-ui);
  margin: 0;
}

.state-action {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  margin-top: var(--space-4);
  padding: var(--space-4) var(--space-12);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
  color: var(--ink-secondary);
  font-family: var(--ff-body);
  font-size: var(--text-xs);
  cursor: pointer;
  transition:
    color var(--dur-micro) var(--ease-fade),
    border-color var(--dur-micro) var(--ease-fade),
    background var(--dur-micro) var(--ease-fade);
}

.state-action:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}

.state-action:active {
  transform: scale(0.96);
  transition: transform var(--dur-press) var(--ease-press);
}

/* ============================================================
 * File Tree
 * ============================================================ */
.drawer-tree {
  padding: var(--space-4) 0;
}

/* --- Tree Item --- */
.tree-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-4);
  height: 32px;
  padding: 0 var(--space-12);
  cursor: pointer;
  user-select: none;
  font-family: var(--ff-body);
  font-size: var(--text-sm);
  line-height: var(--lh-ui);
  color: var(--ink-secondary);
  background: none;
  border: none;
  border-radius: 0;
  transition:
    background var(--dur-micro) var(--ease-fade),
    color var(--dur-micro) var(--ease-fade);
}

.tree-item:hover {
  background: var(--surface-hover);
  color: var(--ink-primary);
}

.tree-item:active {
  background: var(--surface-active);
}

/* --- Active State --- */
.tree-item.active {
  color: var(--ink-primary);
  background: var(--accent-soft);
}

.active-indicator {
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--border-medium);
  background: var(--accent);
}

/* --- Directory --- */
.tree-item.is-directory {
  font-weight: var(--fw-medium);
}

.tree-item.no-children {
  color: var(--ink-muted);
}

/* --- Chevron --- */
.tree-chevron {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius);
  background: none;
  color: var(--ink-muted);
  cursor: pointer;
  padding: 0;
  transition:
    color var(--dur-micro) var(--ease-fade),
    transform var(--dur-micro) var(--ease-fade);
}

.tree-chevron.expanded {
  transform: rotate(90deg);
}

.tree-chevron:hover {
  color: var(--ink-secondary);
}

/* --- Icon --- */
.tree-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-muted);
}

.tree-icon.icon-folder-open {
  color: var(--accent);
}

.tree-icon.icon-markdown {
  color: var(--accent);
}

.tree-icon.icon-image {
  color: var(--signal-success);
}

/* --- Name --- */
.tree-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* --- Inline Rename Input --- */
.tree-rename-input {
  flex: 1;
  height: 22px;
  padding: 0 var(--space-4);
  border: var(--border-thin) solid var(--accent);
  border-radius: var(--radius);
  background: var(--paper-surface);
  color: var(--ink-primary);
  font-family: var(--ff-body);
  font-size: var(--text-sm);
  outline: none;
  caret-color: var(--accent);
  min-width: 0;
}

/* ============================================================
 * Context Menu
 * ============================================================ */
.context-menu {
  position: fixed;
  z-index: var(--z-modal);
  min-width: 140px;
  padding: var(--space-4);
  background: var(--paper-raised);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  box-shadow: var(--shadow-float);
  display: flex;
  flex-direction: column;
  gap: 2px;
  will-change: transform, opacity;
  animation: menu-enter var(--dur-micro) var(--ease-enter) forwards;
}

@keyframes menu-enter {
  from {
    opacity: 0;
    transform: scale(0.92) translateY(-4px);
  }

  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  height: 32px;
  padding: 0 var(--space-8);
  border: none;
  border-radius: var(--radius);
  background: none;
  color: var(--ink-primary);
  font-family: var(--ff-body);
  font-size: var(--text-sm);
  cursor: pointer;
  text-align: left;
  transition:
    background var(--dur-micro) var(--ease-fade),
    color var(--dur-micro) var(--ease-fade);
}

.context-menu-item:hover {
  background: var(--surface-hover);
}

.context-menu-item:active {
  background: var(--surface-active);
  transform: scale(0.97);
  transition: transform var(--dur-press) var(--ease-press);
}

.context-menu-item--danger {
  color: var(--signal-error);
}

.context-menu-item--danger:hover {
  background: var(--signal-error-soft);
}

/* ============================================================
 * Transition — Drawer Enter / Exit
 * ============================================================ */
.drawer-enter-active {
  transition: opacity var(--dur-drawer) var(--ease-fold);
}

.drawer-enter-active .file-drawer {
  transition: transform var(--dur-drawer) var(--ease-fold);
}

.drawer-leave-active {
  transition: opacity var(--dur-collapse) var(--ease-exit);
}

.drawer-leave-active .file-drawer {
  transition: transform var(--dur-collapse) var(--ease-exit);
}

.drawer-enter-from {
  opacity: 0;
}

.drawer-enter-from .file-drawer {
  transform: translateX(calc(var(--drawer-width) * -1));
}

.drawer-leave-to {
  opacity: 0;
}

.drawer-leave-to .file-drawer {
  transform: translateX(calc(var(--drawer-width) * -1));
}

/* ============================================================
 * Accessibility — Reduced Motion
 * ============================================================ */
@media (prefers-reduced-motion: reduce) {
  .drawer-enter-active,
  .drawer-leave-active,
  .drawer-enter-active .file-drawer,
  .drawer-leave-active .file-drawer {
    transition-duration: 0.01ms !important;
  }

  .skeleton-icon,
  .skeleton-line {
    animation-duration: 0.01ms !important;
  }

  .context-menu {
    animation-duration: 0.01ms !important;
  }
}

/* ============================================================
 * Coarse Pointer (Touch) — Larger hit targets
 * ============================================================ */
@media (pointer: coarse) {
  .tree-item {
    min-height: 44px;
  }

  .tree-chevron {
    width: 24px;
    height: 24px;
  }
}
</style>
