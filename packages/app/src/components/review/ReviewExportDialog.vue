<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="overlayRef"
      tabindex="-1"
      class="modal-overlay"
      @click.self="cancel"
      @keydown.escape="cancel"
    >
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="review-export-title">
        <!-- Header -->
        <div class="modal-header">
          <h2 id="review-export-title">{{ t('review.export.title') }}</h2>
          <button
            class="modal-close"
            data-dialog-initial-focus
            :aria-label="t('common.close')"
            @click="cancel"
          >
            &times;
          </button>
        </div>

        <!-- Body -->
        <div class="modal-body">
          <!-- 规则配置 + 实时预览 -->
          <div v-if="exportState === 'idle' || exportState === 'error'" class="rule-section">
            <label class="rule-row">
              <span class="rule-label">{{ t('review.export.prefix') }}</span>
              <input
                v-model="prefix"
                class="rule-input rule-input-prefix"
                type="text"
                maxlength="8"
                :placeholder="DEFAULT_RULE.prefix"
              />
            </label>
            <label class="rule-row">
              <span class="rule-label">{{ t('review.export.start') }}</span>
              <input v-model.number="start" class="rule-input" type="number" min="1" step="1" />
            </label>
            <div class="rule-row">
              <span class="rule-label">{{ t('review.export.padding') }}</span>
              <div class="rule-padding">
                <button
                  v-for="p in PADDING_CHOICES"
                  :key="p"
                  class="rule-padding-option"
                  :class="{ selected: padding === p }"
                  type="button"
                  @click="padding = p"
                >
                  {{ p }}
                </button>
              </div>
            </div>
            <label class="rule-row">
              <span class="rule-label">{{ t('review.export.includeDate') }}</span>
              <span
                class="toggle-track"
                :class="{ active: includeDate }"
                role="switch"
                tabindex="0"
                :aria-checked="includeDate"
                @click="includeDate = !includeDate"
                @keydown.enter.prevent="includeDate = !includeDate"
                @keydown.space.prevent="includeDate = !includeDate"
              >
                <span class="toggle-thumb"></span>
              </span>
            </label>
            <div class="rule-preview">
              <span class="rule-preview-label">{{ t('review.export.preview') }}</span>
              <code class="rule-preview-name">{{ previewName }}</code>
            </div>
          </div>

          <!-- Exporting -->
          <div
            v-if="exportState === 'exporting'"
            class="export-status"
            role="status"
            aria-live="polite"
          >
            <span class="spinner"></span>
            <span class="status-text">{{ t('review.export.exporting') }}</span>
          </div>

          <!-- Success -->
          <div v-if="exportState === 'success'" class="export-status" role="status">
            <span class="status-text success-text">{{ t('review.export.success') }}</span>
            <span class="file-info">{{ exportedFileName }}</span>
            <Button v-if="copySupported" variant="secondary" @click="copyExportedPath">
              {{ copied ? t('review.export.copied') : t('review.export.copyPath') }}
            </Button>
          </div>

          <!-- Error -->
          <div v-if="exportState === 'error'" class="export-status error-block" role="alert">
            <span class="status-text error-text">{{ t('review.export.failed') }}</span>
            <span class="error-message">{{ exportError }}</span>
          </div>
        </div>

        <!-- Footer -->
        <div class="modal-footer">
          <template v-if="exportState === 'idle' || exportState === 'error'">
            <Button variant="secondary" @click="cancel">{{ t('common.cancel') }}</Button>
            <Button
              variant="default"
              :disabled="!hasContent || !stem"
              data-review-export-confirm
              @click="doExport"
            >
              {{ t('review.export.export') }}
            </Button>
          </template>
          <template v-if="exportState === 'exporting'">
            <Button variant="secondary" :disabled="true">{{ t('common.cancel') }}</Button>
            <Button variant="default" loading disabled>
              {{ t('review.export.exporting') }}
            </Button>
          </template>
          <template v-if="exportState === 'success'">
            <Button variant="default" @click="cancel">{{ t('common.close') }}</Button>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * ReviewExportDialog — 改稿模式「导出批注版本」对话框
 *
 * 自定义命名规则（前缀/起始号/位数/含日期）+ 实时预览（以起始号预览）。
 * 导出流程：listDirectory(笔记所在目录) → nextReviewVersionFileName（版本号在
 * 目录内已有最大号之上自动递进）→ writeFile(同目录新 .md)。极端并发下名字
 * 已被占用时按「+1」重试一次；失败态展示错误。
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import Button from '@/components/common/Button.vue';
import { useDialogFocus } from '@/composables/useDialogFocus';
import type { IFileSystemService } from '@/types/file-system';
import { DEFAULT_REVIEW_VERSION_RULE, type ReviewVersionRule } from '@/utils/review-types';
import {
  formatReviewVersionPreview,
  nextReviewVersionFileName,
} from '@/utils/review-version-naming';

const props = defineProps<{
  visible: boolean;
  fs: IFileSystemService;
  /** 笔记本根标识（暂未参与相对路径拼接，保留给主线程后续接入绝对路径场景） */
  root?: string;
  /** 笔记相对路径（如 notes/idea.md），导出到其所在目录 */
  notePath: string;
  /** 导出的工作稿全文 */
  workingText: string;
}>();

const emit = defineEmits<{
  'update:visible': [boolean];
  cancel: [];
  /** 导出成功（新文件相对路径 + 文件名） */
  exported: [path: string, fileName: string];
}>();

const { t } = useI18n();

const DEFAULT_RULE = DEFAULT_REVIEW_VERSION_RULE;
const PADDING_CHOICES: Array<1 | 2 | 3> = [1, 2, 3];

const overlayRef = ref<HTMLDivElement | null>(null);
useDialogFocus({
  visible: () => props.visible,
  containerRef: overlayRef,
  initialFocus: '[data-dialog-initial-focus]',
});

// ── 规则状态 ──
const prefix = ref(DEFAULT_REVIEW_VERSION_RULE.prefix);
const start = ref(DEFAULT_REVIEW_VERSION_RULE.start);
const padding = ref<1 | 2 | 3>(DEFAULT_REVIEW_VERSION_RULE.padding);
const includeDate = ref(DEFAULT_REVIEW_VERSION_RULE.includeDate);

const rule = computed<ReviewVersionRule>(() => ({
  prefix: prefix.value,
  // number input 清空时兜底回默认；非法值取整钳制
  start: Number.isFinite(start.value) ? Math.max(1, Math.trunc(start.value)) : 1,
  padding: padding.value,
  includeDate: includeDate.value,
}));

/** 笔记名去扩展名（路径最后一段） */
const stem = computed(() => {
  const base = props.notePath.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
});

/** 实时预览：规则变化时用「起始号」预览 */
const previewName = computed(() =>
  formatReviewVersionPreview(stem.value, rule.value, rule.value.start),
);

// ── 导出状态机 ──
type ExportState = 'idle' | 'exporting' | 'success' | 'error';
const exportState = ref<ExportState>('idle');
const exportError = ref('');
const exportedFileName = ref('');
const exportedPath = ref('');
const copied = ref(false);
let exportRunId = 0;

const hasContent = computed(() => props.workingText.trim().length > 0);
const copySupported = typeof navigator !== 'undefined' && !!navigator.clipboard;

function resetState(): void {
  prefix.value = DEFAULT_REVIEW_VERSION_RULE.prefix;
  start.value = DEFAULT_REVIEW_VERSION_RULE.start;
  padding.value = DEFAULT_REVIEW_VERSION_RULE.padding;
  includeDate.value = DEFAULT_REVIEW_VERSION_RULE.includeDate;
  exportState.value = 'idle';
  exportError.value = '';
  exportedFileName.value = '';
  exportedPath.value = '';
  copied.value = false;
}

function cancel(): void {
  exportRunId++; // 使在途结果作废
  emit('cancel');
  emit('update:visible', false);
}

/** 笔记所在目录（相对路径；根级笔记为 ''） */
function noteDirectory(): string {
  const parts = props.notePath.split('/');
  parts.pop();
  return parts.join('/');
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

async function writeVersioned(names: readonly string[]): Promise<string> {
  const dir = noteDirectory();
  const first = nextReviewVersionFileName(stem.value, names, rule.value);
  try {
    const firstPath = joinPath(dir, first);
    await props.fs.writeFile(firstPath, props.workingText);
    return firstPath;
  } catch {
    // 极端并发：名字在 listDirectory 之后被占用 → 名字后缀再 +1 重试一次
    const second = nextReviewVersionFileName(stem.value, [...names, first], rule.value);
    const secondPath = joinPath(dir, second);
    await props.fs.writeFile(secondPath, props.workingText);
    return secondPath;
  }
}

async function doExport(): Promise<void> {
  if (exportState.value === 'exporting' || !hasContent.value || !stem.value) return;
  const runId = ++exportRunId;
  exportState.value = 'exporting';
  exportError.value = '';
  try {
    const dir = noteDirectory();
    const entries = await props.fs.listDirectory(dir || '/');
    if (runId !== exportRunId) return;
    const names = entries.map((entry) => entry.name);
    const path = await writeVersioned(names);
    if (runId !== exportRunId) return;
    exportedPath.value = path;
    exportedFileName.value = path.split('/').pop() ?? path;
    exportState.value = 'success';
    emit('exported', path, exportedFileName.value);
  } catch (error) {
    if (runId !== exportRunId) return;
    exportState.value = 'error';
    exportError.value = error instanceof Error ? error.message : String(error);
  }
}

async function copyExportedPath(): Promise<void> {
  try {
    await navigator.clipboard.writeText(exportedPath.value);
    copied.value = true;
  } catch {
    copied.value = false;
  }
}

watch(
  () => props.visible,
  (val) => {
    exportRunId++;
    if (val) resetState();
  },
);
onUnmounted(() => {
  exportRunId++;
});
</script>

<style scoped>
.modal-card {
  width: 440px;
}

.modal-body {
  padding: var(--space-20);
}

/* ===== 规则配置 ===== */
.rule-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
}

.rule-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-12);
}

.rule-label {
  font-size: var(--text-sm);
  color: var(--ink-secondary);
}

.rule-input {
  width: 120px;
  padding: var(--space-4) var(--space-8);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
  font-size: var(--text-sm);
  color: var(--ink-primary);
}

.rule-input:focus-visible {
  outline: var(--focus-ring-width) solid var(--accent);
  outline-offset: var(--focus-ring-offset);
}

.rule-input-prefix {
  width: 96px;
  text-align: center;
}

.rule-padding {
  display: inline-flex;
  gap: var(--space-4);
}

.rule-padding-option {
  min-width: 40px;
  padding: var(--space-4) var(--space-8);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
  font-size: var(--text-sm);
  color: var(--ink-secondary);
  cursor: pointer;
}

.rule-padding-option.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--ink-primary);
}

/* Toggle（复用 ExportDialog 的开关形态） */
.toggle-track {
  display: inline-flex;
  align-items: center;
  width: 38px;
  height: 20px;
  border-radius: var(--radius-full);
  background: var(--rule);
  cursor: pointer;
  position: relative;
  flex-shrink: 0;
  transition: background var(--dur-micro) var(--ease-fade);
}

.toggle-track.active {
  background: var(--accent);
}

.toggle-track:focus-visible {
  outline: var(--focus-ring-width) solid var(--accent);
  outline-offset: var(--focus-ring-offset);
}

.toggle-thumb {
  width: 16px;
  height: 16px;
  border-radius: var(--radius-full);
  background: var(--paper-raised);
  box-shadow: var(--shadow-sheet);
  position: absolute;
  top: 2px;
  left: 2px;
  transition: transform var(--dur-micro) var(--ease-press);
}

.toggle-track.active .toggle-thumb {
  transform: translateX(18px);
}

/* ===== 实时预览 ===== */
.rule-preview {
  display: flex;
  align-items: center;
  gap: var(--space-12);
  padding: var(--space-8) var(--space-12);
  border: var(--border-thin) dashed var(--rule);
  border-radius: var(--radius);
}

.rule-preview-label {
  font-size: var(--text-xs);
  color: var(--ink-muted);
}

.rule-preview-name {
  font-size: var(--text-sm);
  color: var(--ink-primary);
  word-break: break-all;
}

/* ===== 状态区（复用 ExportDialog 形态） ===== */
.export-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-12);
  padding: var(--space-32) var(--space-20);
  min-height: 140px;
}

.status-text {
  font-size: var(--text-base);
  font-weight: var(--fw-medium);
  color: var(--ink-primary);
}

.success-text {
  color: var(--signal-success);
}

.error-text {
  color: var(--signal-error);
}

.file-info {
  font-size: var(--text-sm);
  color: var(--ink-muted);
  text-align: center;
  word-break: break-all;
}

.error-block .error-message {
  font-size: var(--text-sm);
  color: var(--ink-muted);
  text-align: center;
  overflow-wrap: break-word;
  max-width: 100%;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--rule);
  border-top-color: var(--accent);
  border-radius: var(--radius-full);
  animation: review-export-spin 0.7s linear infinite;
}

@keyframes review-export-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
