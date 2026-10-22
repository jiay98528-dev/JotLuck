<template>
  <aside class="review-panel" :class="{ collapsed }">
    <header class="review-panel-header" @click="collapsed = !collapsed">
      <span class="review-panel-title">{{ t('review.panel.title') }}</span>
      <span class="review-panel-count" :class="{ zero: hunks.length === 0 }">
        {{ hunks.length }}
      </span>
      <span class="review-panel-chevron" :class="{ collapsed }" aria-hidden="true">▾</span>
    </header>

    <!-- 批量裁决入口（hunks 非空且未折叠时显示）：全部批准/全部丢弃为破坏性
         操作，点击先进内联二次确认条，确认后才 emit decideAll -->
    <div v-if="!collapsed && hunks.length > 0" class="review-bulk-bar">
      <template v-if="!bulkPending">
        <button type="button" class="review-bulk-btn review-bulk-adopt" @click="beginBulk('adopt')">
          {{ t('review.bulk.adoptAll') }}
        </button>
        <button
          type="button"
          class="review-bulk-btn review-bulk-discard"
          @click="beginBulk('discard')"
        >
          {{ t('review.bulk.discardAll') }}
        </button>
      </template>
      <template v-else>
        <span class="review-bulk-confirm-text">
          {{
            bulkPending === 'adopt'
              ? t('review.bulk.confirmAdopt', { n: hunks.length })
              : t('review.bulk.confirmDiscard', { n: hunks.length })
          }}
        </span>
        <button type="button" class="review-bulk-btn review-bulk-confirm-ok" @click="confirmBulk">
          {{ t('review.bulk.confirmLabel') }}
        </button>
        <button
          type="button"
          class="review-bulk-btn review-bulk-confirm-cancel"
          @click="bulkPending = null"
        >
          {{ t('review.bulk.cancel') }}
        </button>
      </template>
    </div>

    <ul v-if="!collapsed && hunks.length > 0" class="review-panel-list">
      <li
        v-for="(hunk, index) in hunks"
        :key="hunk.id"
        class="review-panel-item"
        :data-hunk-id="hunk.id"
        @click="onRowClick(hunk, $event)"
        @mouseenter="onRowEnter(hunk)"
        @mouseleave="onRowLeave(hunk)"
      >
        <span class="review-panel-index">{{ index + 1 }}</span>
        <span class="review-badge" :class="`review-badge-${hunk.type}`">
          {{ t(`review.type.${hunk.type}`) }}
        </span>
        <span class="review-summary">
          <template v-if="hunk.type !== 'insert'">
            <span class="review-sum-left">{{ summarize(hunk.leftText) }}</span>
            <span v-if="hunk.type === 'modify'" class="review-sum-arrow">→</span>
          </template>
          <span class="review-sum-right">{{ summarize(hunk.rightText) }}</span>
        </span>
      </li>
    </ul>
    <p v-else-if="!collapsed" class="review-panel-empty">{{ t('review.panel.empty') }}</p>

    <!-- 批准/丢弃二元小弹窗：fixed 定位在条目点击的鼠标位置附近 -->
    <Teleport to="body">
      <div
        v-if="popup"
        class="review-decide-popup"
        :style="{ left: `${popup.x}px`, top: `${popup.y}px` }"
        @mouseenter="cancelClose"
        @mouseleave="scheduleClose"
      >
        <span class="review-decide-hint">{{ t('review.decide.hint') }}</span>
        <button class="review-decide-adopt" @click="onDecide('adopt')">
          {{ t('review.decide.adopt') }}
        </button>
        <button class="review-decide-discard" @click="onDecide('discard')">
          {{ t('review.decide.discard') }}
        </button>
      </div>
    </Teleport>
  </aside>
</template>

<script setup lang="ts">
/**
 * ReviewAnnotationPanel — 改稿模式批注面板（工作台右上角，可折叠）
 *
 * 列出全部批注（书签式快速预览）；点击条目 → emit locate（工作台滚动定位两栏）
 * 并在鼠标位置附近弹「批准/丢弃」二元小弹窗；弹窗按钮 → emit decide。
 * 鼠标移出弹窗或移出该条目行 300ms 后弹窗自动关闭；点击按钮执行后立即关闭。
 * 头部下方另有「全部批准/全部丢弃」批量入口（hunks 非空时显示），经内联
 * 二次确认后 emit decideAll（由工作台调用会话层 adoptAll/discardAll）。
 */
import { onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ReviewHunk } from '@/utils/review-types';

defineProps<{
  hunks: readonly ReviewHunk[];
}>();

const emit = defineEmits<{
  locate: [hunk: ReviewHunk];
  decide: [hunk: ReviewHunk, action: 'adopt' | 'discard'];
  /** 批量裁决（内联二次确认通过后触发），action 语义同 decide */
  decideAll: [action: 'adopt' | 'discard'];
}>();

const { t } = useI18n();

const collapsed = ref(false);

/** 弹窗状态：目标 hunk + 视口坐标（fixed） */
const popup = ref<{ hunk: ReviewHunk; x: number; y: number } | null>(null);
let closeTimer: ReturnType<typeof setTimeout> | null = null;
const CLOSE_DELAY_MS = 300;
const POPUP_WIDTH = 190;
const POPUP_HEIGHT = 86;

function cancelClose(): void {
  if (closeTimer !== null) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
}

function closePopup(): void {
  cancelClose();
  popup.value = null;
}

function scheduleClose(): void {
  cancelClose();
  closeTimer = setTimeout(closePopup, CLOSE_DELAY_MS);
}

function onRowClick(hunk: ReviewHunk, event: MouseEvent): void {
  emit('locate', hunk);
  cancelClose();
  // 鼠标位置右下偏移；越出视口时回收（popup 尺寸为估算值）
  const x = Math.min(event.clientX + 8, Math.max(8, window.innerWidth - POPUP_WIDTH - 8));
  const y = Math.min(event.clientY + 8, Math.max(8, window.innerHeight - POPUP_HEIGHT - 8));
  popup.value = { hunk, x, y };
}

function onRowEnter(hunk: ReviewHunk): void {
  if (popup.value?.hunk === hunk) cancelClose();
}

function onRowLeave(hunk: ReviewHunk): void {
  if (popup.value?.hunk === hunk) scheduleClose();
}

function onDecide(action: 'adopt' | 'discard'): void {
  const current = popup.value;
  if (!current) return;
  closePopup();
  emit('decide', current.hunk, action);
}

// ── 批量裁决（内联二次确认；确认条只在面板内部，不弹 modal/confirm()） ──

/** null=默认按钮态；'adopt'/'discard'=待确认（已进入二次确认条） */
const bulkPending = ref<'adopt' | 'discard' | null>(null);

function beginBulk(action: 'adopt' | 'discard'): void {
  closePopup(); // 批量入口与单条弹窗互斥，顺手清理
  bulkPending.value = action;
}

function confirmBulk(): void {
  const action = bulkPending.value;
  bulkPending.value = null; // 先复位再 emit，避免执行期间残留待确认态
  if (action) emit('decideAll', action);
}

/** 摘要：折叠空白后截断到 40 字符 */
function summarize(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 40 ? `${flat.slice(0, 40)}…` : flat;
}

onUnmounted(closePopup);
</script>

<style scoped>
.review-panel {
  display: flex;
  flex-direction: column;
  width: 280px;
  max-height: 60%;
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-raised);
  box-shadow: var(--shadow-sheet);
  overflow: hidden;
}

.review-panel.collapsed {
  max-height: none;
}

.review-panel-header {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-8) var(--space-12);
  cursor: pointer;
  user-select: none;
  border-bottom: var(--border-thin) solid var(--rule);
}

.review-panel.collapsed .review-panel-header {
  border-bottom: none;
}

.review-panel-title {
  font-size: var(--text-sm);
  font-weight: var(--fw-medium);
  color: var(--ink-primary);
}

.review-panel-count {
  min-width: 20px;
  padding: 0 6px;
  border-radius: var(--radius-full);
  background: var(--accent);
  color: var(--paper-raised);
  font-size: var(--text-xs);
  line-height: 18px;
  text-align: center;
}

.review-panel-count.zero {
  background: var(--rule);
  color: var(--ink-muted);
}

.review-panel-chevron {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--ink-muted);
  transition: transform var(--dur-micro) var(--ease-fade);
}

.review-panel-chevron.collapsed {
  transform: rotate(-90deg);
}

.review-panel-list {
  margin: 0;
  padding: var(--space-4);
  list-style: none;
  overflow-y: auto;
}

.review-panel-item {
  display: flex;
  align-items: baseline;
  gap: var(--space-8);
  padding: var(--space-8);
  border-radius: var(--radius);
  cursor: pointer;
}

.review-panel-item:hover {
  background: var(--accent-soft);
}

.review-panel-index {
  flex: none;
  min-width: 18px;
  font-size: var(--text-xs);
  color: var(--ink-muted);
  text-align: right;
}

/* 类型徽标：del 红 / add 绿 / modify 中性（配色与马克笔语义一致） */
.review-badge {
  flex: none;
  padding: 1px 6px;
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  line-height: 16px;
}

.review-badge-modify {
  background: var(--accent-soft);
  color: var(--ink-secondary);
}

.review-badge-insert {
  background: var(--signal-success-soft);
  color: var(--signal-success);
}

.review-badge-delete {
  background: var(--signal-error-soft);
  color: var(--signal-error);
}

.review-summary {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-4);
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--ink-secondary);
}

.review-sum-left,
.review-sum-right {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.review-sum-left {
  max-width: 96px;
  color: var(--ink-muted);
}

.review-sum-right {
  max-width: 128px;
}

.review-sum-arrow {
  flex: none;
  color: var(--ink-muted);
}

.review-panel-empty {
  margin: 0;
  padding: var(--space-16) var(--space-12);
  font-size: var(--text-xs);
  color: var(--ink-muted);
  text-align: center;
}

/* ── 批量裁决入口（全部批准/全部丢弃 + 内联二次确认条） ── */
.review-bulk-bar {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  flex-wrap: wrap;
  padding: var(--space-8) var(--space-12) 0;
}

.review-bulk-btn {
  padding: 2px 8px;
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
  font-size: var(--text-xs);
  color: var(--ink-secondary);
  cursor: pointer;
}

.review-bulk-adopt {
  border-color: var(--signal-success);
  color: var(--signal-success);
}

.review-bulk-discard {
  border-color: var(--signal-error);
  color: var(--signal-error);
}

.review-bulk-btn:hover {
  background: var(--accent-soft);
}

/* 确认文案占满整行，确认/取消按钮折到下一行 */
.review-bulk-confirm-text {
  flex: 1 1 100%;
  font-size: var(--text-xs);
  color: var(--ink-secondary);
}
</style>

<style scoped>
/* 二元小弹窗：Teleport 到 body，fixed 定位（不受工作台 overflow 裁剪） */
.review-decide-popup {
  position: fixed;
  z-index: 90;
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-8) var(--space-12);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-raised);
  box-shadow: var(--shadow-sheet);
}

.review-decide-hint {
  font-size: var(--text-xs);
  color: var(--ink-muted);
}

.review-decide-adopt,
.review-decide-discard {
  padding: 4px 10px;
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
  font-size: var(--text-xs);
  cursor: pointer;
}

.review-decide-adopt {
  border-color: var(--signal-success);
  color: var(--signal-success);
}

.review-decide-discard {
  border-color: var(--signal-error);
  color: var(--signal-error);
}

.review-decide-adopt:hover,
.review-decide-discard:hover {
  background: var(--accent-soft);
}
</style>
