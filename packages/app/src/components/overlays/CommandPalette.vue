<template>
  <Teleport to="body">
    <Transition name="palette">
      <div
        v-if="visible"
        class="palette-overlay"
        role="presentation"
        @click.self="close"
        @keydown="handleKeydown"
      >
        <div class="palette" role="dialog" aria-label="命令面板" aria-modal="true">
          <!-- ===== Search Input ===== -->
          <div class="palette-search">
            <svg
              class="search-icon"
              width="18"
              height="18"
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
              ref="searchInputRef"
              v-model="query"
              class="search-input"
              type="text"
              :placeholder="searchPlaceholder"
              aria-label="搜索笔记"
              autocomplete="off"
              spellcheck="false"
              @input="onQueryChange"
            />
            <span class="esc-badge" aria-hidden="true">Esc</span>
          </div>

          <!-- ===== Results List ===== -->
          <div ref="resultsListRef" class="palette-results" role="listbox" aria-label="搜索结果">
            <button
              v-for="(result, index) in displayResults"
              :key="result.notePath"
              class="result-item"
              :class="{ selected: index === selectedIndex }"
              :style="{ '--stagger-delay': `${index * 25}ms` }"
              role="option"
              :aria-selected="index === selectedIndex"
              @click="selectResult(result)"
              @mouseenter="selectedIndex = index"
            >
              <div class="result-title">{{ result.noteTitle }}</div>
              <div class="result-path">{{ result.notePath }}</div>
              <!-- eslint-disable vue/no-v-html -->
              <div
                v-if="result.matches.length > 0"
                class="result-snippet"
                v-html="
                  DOMPurify.sanitize(highlightContext(result), {
                    ALLOWED_TAGS: ['mark'],
                    ALLOWED_ATTR: ['class'],
                  })
                "
              />
              <!-- eslint-enable vue/no-v-html -->
            </button>

            <!-- Empty State -->
            <div v-if="query.length > 0 && displayResults.length === 0" class="no-results">
              <span class="no-results-icon">--</span>
              <span>无匹配结果</span>
            </div>
          </div>

          <!-- ===== Footer ===== -->
          <div class="palette-footer">
            <span class="result-count">{{ resultCountLabel }}</span>
            <div class="quick-actions">
              <button
                class="quick-action-btn"
                title="新建笔记 (Ctrl+N)"
                @click="$emit('quick-action', 'new-note')"
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
                  <line x1="12" y1="5" x2="12" y2="19" stroke-linecap="round" />
                  <line x1="5" y1="12" x2="19" y2="12" stroke-linecap="round" />
                </svg>
                <span>新建笔记</span>
              </button>
              <button
                class="quick-action-btn"
                title="导出当前笔记"
                @click="$emit('quick-action', 'export')"
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
                  <path
                    d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                  <polyline
                    points="7,10 12,15 17,10"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                  <line x1="12" y1="15" x2="12" y2="3" stroke-linecap="round" />
                </svg>
                <span>导出当前</span>
              </button>
              <button
                class="quick-action-btn"
                title="设置"
                @click="$emit('quick-action', 'settings')"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path
                    d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
                  />
                </svg>
                <span>设置</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * CommandPalette.vue — Spotlight 风格命令面板
 *
 * Cmd+P / Ctrl+Shift+P 唤起。居中浮层，全文搜索 + 快速操作。
 * 支持 tag:xxx /regex/ date:YYYY-MM..YYYY-MM 高级搜索语法。
 *
 * @see spec/frontend/components.md
 */
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue';
import { useSearchStore } from '@/stores/search';
import { useSearch } from '@/composables/useSearch';
import type { SearchResult } from '@/types';
import DOMPurify from 'dompurify';

// ============================================================
// Props & Emits
// ============================================================

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
  'select-result': [result: SearchResult];
  'quick-action': [action: 'new-note' | 'export' | 'settings'];
}>();

// ============================================================
// Composables & Store
// ============================================================

const searchStore = useSearchStore();
const { searchWithDebounce } = useSearch();

// ============================================================
// Local State
// ============================================================

const query = ref('');
const selectedIndex = ref(0);
const searchInputRef = ref<HTMLInputElement | null>(null);
const resultsListRef = ref<HTMLElement | null>(null);

const MAX_RESULTS = 10;

// ============================================================
// Derived
// ============================================================

const displayResults = computed<SearchResult[]>(() => {
  return searchStore.results.slice(0, MAX_RESULTS);
});

const resultCountLabel = computed(() => {
  const total = searchStore.results.length;
  if (total === 0) return '无结果';
  return `${total} 条结果`;
});

const searchPlaceholder = '搜索笔记... (支持 tag:xxx /regex/ date:YYYY-MM..YYYY-MM)';

// ============================================================
// Methods
// ============================================================

function close(): void {
  emit('update:visible', false);
}

function onQueryChange(): void {
  selectedIndex.value = 0;
  if (query.value.trim().length > 0) {
    searchWithDebounce(query.value);
  }
}

function selectResult(result: SearchResult): void {
  emit('select-result', result);
  close();
}

function highlightContext(result: SearchResult): string {
  if (result.matches.length === 0) return '';
  const match = result.matches[0]!;
  const ctx = match.context;
  const term = match.text;
  if (!term) return escapeHtml(ctx);
  // Escape HTML in context, then wrap matched term in <mark>
  const escaped = escapeHtml(ctx);
  const escapedTerm = escapeHtml(term);
  // Case-insensitive highlight
  const regex = new RegExp(`(${escapeRegex(escapedTerm)})`, 'gi');
  return escaped.replace(regex, '<mark class="match-highlight">$1</mark>');
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (ch) => map[ch] || ch);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function scrollSelectedIntoView(): void {
  nextTick(() => {
    const list = resultsListRef.value;
    if (!list) return;
    const selected = list.querySelector('.result-item.selected') as HTMLElement | null;
    if (selected) {
      selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
}

// ============================================================
// Keyboard Navigation
// ============================================================

function handleKeydown(e: KeyboardEvent): void {
  switch (e.key) {
    case 'Escape':
      e.preventDefault();
      close();
      break;

    case 'ArrowDown':
      e.preventDefault();
      if (displayResults.value.length > 0) {
        selectedIndex.value = (selectedIndex.value + 1) % displayResults.value.length;
        scrollSelectedIntoView();
      }
      break;

    case 'ArrowUp':
      e.preventDefault();
      if (displayResults.value.length > 0) {
        selectedIndex.value =
          (selectedIndex.value - 1 + displayResults.value.length) % displayResults.value.length;
        scrollSelectedIntoView();
      }
      break;

    case 'Enter':
      e.preventDefault();
      if (displayResults.value.length > 0 && selectedIndex.value < displayResults.value.length) {
        selectResult(displayResults.value[selectedIndex.value]!);
      }
      break;

    default:
      break;
  }
}

/**
 * The palette input owns focus in normal use, but WebKit can retarget Escape
 * while results are updating. Keep the visible overlay as the final close owner.
 */
function handleWindowKeydown(event: KeyboardEvent): void {
  if (!props.visible || event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  close();
}

// ============================================================
// Lifecycle
// ============================================================

watch(
  () => props.visible,
  async (isVisible) => {
    if (isVisible) {
      window.addEventListener('keydown', handleWindowKeydown, true);
      // 如果有外部预设查询（如标签点击 → tag:xxx），
      // 同步到输入框并立即执行搜索；否则正常打开空白面板。
      if (searchStore.query) {
        query.value = searchStore.query;
        searchWithDebounce(query.value);
      } else {
        query.value = '';
      }
      selectedIndex.value = 0;
      await nextTick();
      searchInputRef.value?.focus();
    } else {
      window.removeEventListener('keydown', handleWindowKeydown, true);
    }
  },
);

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleWindowKeydown, true);
});
</script>

<style scoped>
/* ============================================================
 * Overlay
 * ============================================================ */
.palette-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-palette);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 16vh;
  background: var(--overlay);
  backdrop-filter: blur(4px);
}

/* ============================================================
 * Palette Card
 * ============================================================ */
.palette {
  width: var(--palette-width);
  max-width: calc(100vw - 32px);
  max-height: 480px;
  display: flex;
  flex-direction: column;
  background: var(--paper-raised);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  box-shadow: var(--shadow-float);
  overflow: hidden;
  will-change: transform, opacity;
}

/* ============================================================
 * Search Input Row
 * ============================================================ */
.palette-search {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  height: 44px;
  padding: 0 var(--space-12);
  border-bottom: var(--border-thin) solid var(--rule);
  flex-shrink: 0;
}

.search-icon {
  color: var(--ink-muted);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  height: 100%;
  border: none;
  background: none;
  outline: none;
  font-family: var(--ff-body);
  font-size: var(--text-base);
  color: var(--ink-primary);
  caret-color: var(--accent);
}

.search-input::placeholder {
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

.esc-badge {
  flex-shrink: 0;
  padding: 2px 6px;
  font-family: var(--ff-mono);
  font-size: var(--text-xs);
  color: var(--ink-muted);
  background: var(--surface-hover);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  line-height: var(--lh-none);
}

/* ============================================================
 * Results List
 * ============================================================ */
.palette-results {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--space-4) 0;
}

.result-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: var(--space-8) var(--space-12);
  border: none;
  border-radius: 0;
  background: none;
  text-align: left;
  cursor: pointer;
  opacity: 0;
  animation: item-enter var(--dur-palette) var(--ease-enter) forwards;
  animation-delay: var(--stagger-delay, 0ms);
  transition: background var(--dur-micro) var(--ease-fade);
}

.result-item:hover,
.result-item.selected {
  background: var(--accent-soft);
}

.result-title {
  font-size: var(--text-sm);
  font-weight: var(--fw-medium);
  color: var(--ink-primary);
  line-height: var(--lh-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.result-path {
  font-family: var(--ff-mono);
  font-size: var(--text-xs);
  color: var(--ink-muted);
  line-height: var(--lh-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.result-snippet {
  font-size: var(--text-xs);
  color: var(--ink-secondary);
  line-height: var(--lh-ui);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.result-snippet :deep(.match-highlight) {
  color: var(--accent);
  font-weight: var(--fw-semibold);
  background: var(--accent-soft);
  border-radius: var(--radius);
  padding: 0 1px;
}

/* ============================================================
 * Empty State
 * ============================================================ */
.no-results {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-32) var(--space-16);
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

.no-results-icon {
  font-family: var(--ff-mono);
  font-size: var(--text-lg);
  opacity: var(--opacity-inactive);
}

/* ============================================================
 * Footer
 * ============================================================ */
.palette-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  padding: 0 var(--space-12);
  border-top: var(--border-thin) solid var(--rule);
  flex-shrink: 0;
}

.result-count {
  font-size: var(--text-xs);
  color: var(--ink-muted);
}

.quick-actions {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.quick-action-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  height: 24px;
  padding: 0 var(--space-8);
  border: var(--border-thin) solid transparent;
  border-radius: var(--radius);
  background: none;
  color: var(--ink-muted);
  font-family: var(--ff-body);
  font-size: var(--text-xs);
  cursor: pointer;
  transition:
    color var(--dur-micro) var(--ease-fade),
    border-color var(--dur-micro) var(--ease-fade),
    background var(--dur-micro) var(--ease-fade);
}

.quick-action-btn:hover {
  color: var(--ink-secondary);
  border-color: var(--rule);
  background: var(--surface-hover);
}

.quick-action-btn:active {
  background: var(--accent-soft);
  transform: scale(0.96);
  transition: transform var(--dur-press) var(--ease-press);
}

/* ============================================================
 * Transition — Enter / Exit
 * ============================================================ */
.palette-enter-active {
  transition:
    opacity var(--dur-palette) var(--ease-enter),
    transform var(--dur-palette) var(--ease-enter);
}

.palette-leave-active {
  transition:
    opacity var(--dur-collapse) var(--ease-exit),
    transform var(--dur-collapse) var(--ease-exit);
}

.palette-enter-from {
  opacity: 0;
}

.palette-enter-from .palette {
  transform: scale(0.95);
  opacity: 0;
}

.palette-leave-to {
  opacity: 0;
}

.palette-leave-to .palette {
  transform: scale(0.97);
  opacity: 0;
}

/* ============================================================
 * Item Stagger Animation
 * ============================================================ */
@keyframes item-enter {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (width <= 480px) {
  .palette-overlay {
    padding: var(--space-12);
    align-items: flex-start;
  }

  .palette {
    width: 100%;
    max-width: 100%;
    max-height: calc(100vh - 24px);
  }

  .palette-footer {
    height: auto;
    min-height: 36px;
    align-items: flex-start;
    gap: var(--space-8);
    padding-block: var(--space-8);
  }

  .quick-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
  }
}
</style>
