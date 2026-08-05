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
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="export-dialog-title">
        <!-- Header -->
        <div class="modal-header">
          <h2 id="export-dialog-title">{{ t('dialogs.export.title') }}</h2>
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
          <!-- Idle: format grid + options -->
          <template v-if="exportState === 'idle' || exportState === 'error'">
            <div class="format-grid">
              <button
                v-for="f in formats"
                :key="f.fmt"
                class="format-card"
                :class="{ selected: selectedFormat === f.fmt }"
                @click="selectFormat(f.fmt)"
              >
                <!-- eslint-disable-next-line vue/no-v-html -->
                <span class="format-icon" v-html="f.icon"></span>
                <span class="format-name">{{ f.name }}</span>
                <span class="format-ext">{{ f.ext }}</span>
              </button>
            </div>

            <div class="options-section">
              <label class="toggle-row">
                <span class="toggle-label">{{ t('dialogs.export.frontmatter') }}</span>
                <span
                  class="toggle-track"
                  :class="{ active: includeFrontmatter }"
                  role="switch"
                  tabindex="0"
                  :aria-label="t('dialogs.export.frontmatter')"
                  :aria-checked="includeFrontmatter"
                  @click="includeFrontmatter = !includeFrontmatter"
                  @keydown.enter.prevent="includeFrontmatter = !includeFrontmatter"
                  @keydown.space.prevent="includeFrontmatter = !includeFrontmatter"
                >
                  <span class="toggle-thumb"></span>
                </span>
              </label>
              <label class="toggle-row">
                <span class="toggle-label">{{ t('dialogs.export.codeLineNumbers') }}</span>
                <span
                  class="toggle-track"
                  :class="{ active: codeLineNumbers }"
                  role="switch"
                  tabindex="0"
                  :aria-label="t('dialogs.export.codeLineNumbers')"
                  :aria-checked="codeLineNumbers"
                  @click="codeLineNumbers = !codeLineNumbers"
                  @keydown.enter.prevent="codeLineNumbers = !codeLineNumbers"
                  @keydown.space.prevent="codeLineNumbers = !codeLineNumbers"
                >
                  <span class="toggle-thumb"></span>
                </span>
              </label>
              <label class="toggle-row">
                <span class="toggle-label">{{ t('dialogs.export.wikiLinks') }}</span>
                <span
                  class="toggle-track"
                  :class="{ active: includeWikiLinks }"
                  role="switch"
                  tabindex="0"
                  :aria-label="t('dialogs.export.wikiLinksAria')"
                  :aria-checked="includeWikiLinks"
                  @click="includeWikiLinks = !includeWikiLinks"
                  @keydown.enter.prevent="includeWikiLinks = !includeWikiLinks"
                  @keydown.space.prevent="includeWikiLinks = !includeWikiLinks"
                >
                  <span class="toggle-thumb"></span>
                </span>
              </label>
            </div>
          </template>

          <!-- Exporting: spinner -->
          <div
            v-if="exportState === 'exporting'"
            class="export-status"
            role="status"
            aria-live="polite"
          >
            <span class="spinner"></span>
            <span class="status-text">{{ t('dialogs.export.exporting') }}</span>
          </div>

          <!-- Success -->
          <div v-if="exportState === 'success'" class="export-status" role="status">
            <svg
              class="checkmark"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M8 12l3 3 5-5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span class="status-text success-text">{{ exportSuccessLabel }}</span>
            <span class="file-info">{{ exportMessage }}</span>
          </div>

          <!-- Error -->
          <div v-if="exportState === 'error'" class="export-status error-block" role="alert">
            <svg
              class="error-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" stroke-linecap="round" />
            </svg>
            <span class="status-text error-text">{{ t('dialogs.export.failed') }}</span>
            <span class="error-message">{{ exportError }}</span>
          </div>
        </div>

        <!-- Footer -->
        <div class="modal-footer">
          <template v-if="exportState === 'idle' || exportState === 'error'">
            <Button variant="secondary" @click="cancel">{{ t('common.cancel') }}</Button>
            <Button variant="default" :disabled="!hasContent" @click="doExport">
              {{ t('dialogs.export.export') }}
            </Button>
          </template>
          <template v-if="exportState === 'exporting'">
            <Button variant="secondary" @click="cancel">
              {{ t('dialogs.export.cancelExport') }}
            </Button>
            <Button variant="default" loading disabled>
              {{ t('dialogs.export.exportingButton') }}
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
import { computed, onUnmounted, ref, watch } from 'vue';
import { exportNote } from '@/services/Exporter';
import { ExportFormat } from '@/types';
import type { ExportResult } from '@/types';
import Button from '@/components/common/Button.vue';
import { useDialogFocus } from '@/composables/useDialogFocus';
import { localizeUserError } from '@/services/command-errors';
import { useI18n } from 'vue-i18n';

// ── Props ──────────────────────────────────────────────
const props = defineProps<{
  visible: boolean;
  notePath?: string;
  noteTitle?: string;
  markdownContent?: string;
}>();
const { t } = useI18n();

// ── Emits ──────────────────────────────────────────────
const emit = defineEmits<{
  'update:visible': [boolean];
  cancel: [];
}>();

const overlayRef = ref<HTMLDivElement | null>(null);
useDialogFocus({
  visible: () => props.visible,
  containerRef: overlayRef,
  initialFocus: '[data-dialog-initial-focus]',
});

// ── State ──────────────────────────────────────────────
const selectedFormat = ref<ExportFormat>(ExportFormat.PDF);
const includeFrontmatter = ref<boolean>(true);
const includeWikiLinks = ref<boolean>(true);
const codeLineNumbers = ref<boolean>(false);

type ExportState = 'idle' | 'exporting' | 'success' | 'error';
const exportState = ref<ExportState>('idle');
const exportMessage = ref<string>('');
const exportError = ref<string>('');
const completedFormat = ref<ExportFormat>(ExportFormat.PDF);
let exportRunId = 0;
let activeExportController: AbortController | null = null;

const hasContent = computed(() => {
  return !!(props.markdownContent && props.markdownContent.trim().length > 0);
});
const exportSuccessLabel = computed(() =>
  completedFormat.value === ExportFormat.PDF
    ? t('dialogs.export.printComplete')
    : t('dialogs.export.complete'),
);

// ── Format definitions ─────────────────────────────────
interface FormatEntry {
  fmt: ExportFormat;
  name: string;
  ext: string;
  icon: string;
}

const formats: FormatEntry[] = [
  {
    fmt: ExportFormat.PDF,
    name: 'PDF',
    ext: '.pdf',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="2" width="16" height="8" rx="1"/><path d="M6 10v8a2 2 0 002 2h8a2 2 0 002-2v-8"/><circle cx="8" cy="5" r="1"/><rect x="10" y="14" width="4" height="6" rx="0.5"/><path d="M6 18h12"/></svg>',
  },
  {
    fmt: ExportFormat.DOCX,
    name: 'DOCX',
    ext: '.docx',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>',
  },
  {
    fmt: ExportFormat.XLSX,
    name: 'XLSX',
    ext: '.xlsx',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>',
  },
  {
    fmt: ExportFormat.CSV,
    name: 'CSV',
    ext: '.csv',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/><path d="M3 15h18"/></svg>',
  },
  {
    fmt: ExportFormat.TXT,
    name: 'TXT',
    ext: '.txt',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h4M8 17h7"/></svg>',
  },
  {
    fmt: ExportFormat.HTML,
    name: 'HTML',
    ext: '.html',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10M12 2a15.3 15.3 0 00-4 10 15.3 15.3 0 004 10"/></svg>',
  },
];

// ── Methods ────────────────────────────────────────────
function selectFormat(fmt: ExportFormat): void {
  selectedFormat.value = fmt;
  if (exportState.value === 'error') {
    exportState.value = 'idle';
  }
}

function cancel(): void {
  invalidateExportRun();
  emit('cancel');
  emit('update:visible', false);
}

function invalidateExportRun(): void {
  exportRunId++;
  activeExportController?.abort();
  activeExportController = null;
}

function resetState(): void {
  selectedFormat.value = ExportFormat.PDF;
  includeFrontmatter.value = true;
  includeWikiLinks.value = true;
  codeLineNumbers.value = false;
  completedFormat.value = ExportFormat.PDF;
  exportState.value = 'idle';
  exportMessage.value = '';
  exportError.value = '';
}

async function doExport(): Promise<void> {
  if (!hasContent.value || exportState.value === 'exporting') return;

  activeExportController?.abort();
  const controller = new AbortController();
  activeExportController = controller;
  const runId = ++exportRunId;
  const runFormat = selectedFormat.value;
  exportState.value = 'exporting';
  exportError.value = '';

  try {
    const result: ExportResult = await exportNote(
      props.markdownContent!,
      props.noteTitle || t('dialogs.export.defaultTitle'),
      {
        format: runFormat,
        includeFrontmatter: includeFrontmatter.value,
        includeWikiLinks: includeWikiLinks.value,
        codeLineNumbers: codeLineNumbers.value,
        signal: controller.signal,
      },
    );

    if (!isCurrentExportRun(runId, controller)) return;

    if (result.success) {
      completedFormat.value = runFormat;
      exportState.value = 'success';
      exportMessage.value =
        runFormat === ExportFormat.PDF
          ? result.message || t('export.pdfClosed')
          : result.fileName
            ? t('dialogs.export.savedFile', { fileName: result.fileName })
            : result.message || t('dialogs.export.fileExported');
      return;
    }
    exportState.value = 'error';
    exportError.value = result.error || t('dialogs.export.unknownError');
  } catch (error) {
    if (!isCurrentExportRun(runId, controller)) return;
    exportState.value = 'error';
    exportError.value = localizeUserError(error, 'dialogs.export.unknownError');
  } finally {
    if (runId === exportRunId && activeExportController === controller) {
      activeExportController = null;
    }
  }
}

function isCurrentExportRun(runId: number, controller: AbortController): boolean {
  return runId === exportRunId && !controller.signal.aborted && props.visible;
}

// ── Watch visible to reset on open ─────────────────────
watch(
  () => props.visible,
  (val) => {
    invalidateExportRun();
    if (val) {
      resetState();
    }
  },
);
onUnmounted(invalidateExportRun);
</script>

<style scoped>
/* ===== Card (width override only — skeleton in dialog.css) ===== */
.modal-card {
  width: 480px;
}

/* ===== Body ===== */
.modal-body {
  padding: var(--space-20);
}

/* ===== Format Grid ===== */
.format-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-8);
  margin-bottom: var(--space-20);
}

.format-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-12) var(--space-8);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
  cursor: pointer;
  color: var(--ink-secondary);
  transition: all var(--dur-micro) var(--ease-fade);
}

.format-card:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--ink-primary);
}

.format-card.selected {
  border-color: var(--accent);
  border-width: var(--border-medium);
  background: var(--accent-soft);
  color: var(--ink-primary);
}

.format-icon {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.format-icon :deep(svg) {
  width: 24px;
  height: 24px;
  display: block;
}

.format-name {
  font-size: var(--text-sm);
  font-weight: var(--fw-medium);
  line-height: var(--lh-none);
}

.format-ext {
  font-size: var(--text-xs);
  color: var(--ink-muted);
  line-height: var(--lh-none);
}

/* ===== Options ===== */
.options-section {
  border-top: var(--border-thin) solid var(--rule);
  padding-top: var(--space-16);
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) 0;
  cursor: pointer;
  user-select: none;
}

.toggle-label {
  font-size: var(--text-sm);
  color: var(--ink-secondary);
}

/* Toggle Switch */
.toggle-track {
  display: inline-flex;
  align-items: center;
  width: var(--touch-target-min);
  height: var(--touch-target-min);
  min-width: var(--touch-target-min);
  min-height: var(--touch-target-min);
  border-radius: var(--radius-full);
  background: transparent;
  cursor: pointer;
  position: relative;
  flex-shrink: 0;
}

.toggle-track::before {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 38px;
  height: 20px;
  border-radius: var(--radius-full);
  background: var(--rule);
  content: '';
  transform: translate(-50%, -50%);
  transition: background var(--dur-micro) var(--ease-fade);
}

.toggle-track.active::before {
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
  top: 14px;
  left: 5px;
  transition: transform var(--dur-micro) var(--ease-press);
}

.toggle-track.active .toggle-thumb {
  transform: translateX(18px);
}

/* ===== Export Status ===== */
.export-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-12);
  padding: var(--space-32) var(--space-20);
  min-height: 160px;
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

/* Error block */
.error-block .error-message {
  font-size: var(--text-sm);
  color: var(--ink-muted);
  text-align: center;
  overflow-wrap: break-word;
  max-width: 100%;
}

/* ===== Spinner ===== */
.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--rule);
  border-top-color: var(--accent);
  border-radius: var(--radius-full);
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ===== Checkmark ===== */
.checkmark {
  width: 40px;
  height: 40px;
  color: var(--signal-success);
}

/* ===== Error Icon ===== */
.error-icon {
  width: 40px;
  height: 40px;
  color: var(--signal-error);
}
</style>
