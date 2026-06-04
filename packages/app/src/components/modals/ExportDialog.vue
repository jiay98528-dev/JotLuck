<template>
  <Teleport to="body">
    <div v-if="visible" class="dialog-overlay" @click.self="cancel">
      <div class="export-dialog">
        <div class="dialog-header">
          <h2>导出笔记</h2>
          <button class="dialog-close" @click="cancel">×</button>
        </div>

        <!-- Format Selection -->
        <template v-if="step === 'format'">
          <div class="dialog-body">
            <p class="section-label">选择导出格式</p>
            <div class="format-grid">
              <button
                v-for="fmt in formats"
                :key="fmt.value"
                class="format-card"
                :class="{ 'format-card--selected': selectedFormat === fmt.value }"
                @click="selectedFormat = fmt.value"
              >
                <span class="format-name">{{ fmt.label }}</span>
                <span v-if="fmt.note" class="format-note">{{ fmt.note }}</span>
              </button>
            </div>

            <div class="export-options">
              <label class="option-item">
                <input v-model="includeFrontmatter" type="checkbox" />
                包含 YAML frontmatter
              </label>
              <p class="option-hint">
                YAML frontmatter 是笔记顶部 <code>---</code> 之间的元数据（标题/标签/日期）。
                关闭后导出内容将去除该块。<br />
                <em
                  >注：PDF
                  打印时浏览器可能自动添加页眉（标题/日期），可在打印对话框的"更多设置"中关闭"页眉和页脚"。</em
                >
              </p>
            </div>
          </div>

          <div class="dialog-footer">
            <button class="btn btn--secondary" @click="cancel">取消</button>
            <button class="btn btn--primary" @click="doExport">导出</button>
          </div>
        </template>

        <!-- Progress -->
        <template v-if="step === 'converting'">
          <div class="dialog-body dialog-body--progress">
            <div class="progress-spinner" />
            <p class="progress-text">正在生成 {{ selectedFormatLabel }} 文件...</p>
            <div class="progress-bar">
              <div class="progress-bar-fill" :style="{ width: progressPct + '%' }" />
            </div>
          </div>
        </template>

        <!-- Done / Error -->
        <template v-if="step === 'done'">
          <div class="dialog-body">
            <div v-if="!errorMsg" class="export-success">{{ selectedFormatLabel }} 导出完成</div>
            <div v-else class="export-error">{{ errorMsg }}</div>
          </div>
          <div class="dialog-footer">
            <button class="btn btn--primary" @click="cancel">完成</button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * ExportDialog.vue — 导出对话框
 *
 * M3-06: 格式选择 + 选项配置 + 进度指示 + 执行导出。
 *
 * @see components.md §25
 */
import { ref, watch, computed, onUnmounted } from 'vue';
import { exportNote } from '@/services/Exporter';
import { ExportFormat } from '@/types';

const props = defineProps<{
  visible: boolean;
  notePath?: string;
  noteTitle?: string;
  markdownContent?: string;
  /** P2-1: async image resolver for embed mode */
  readBinary?: (path: string) => Promise<string>;
}>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
  cancel: [];
}>();

const formats: Array<{ value: ExportFormat; label: string; note?: string }> = [
  { value: ExportFormat.PDF, label: 'PDF', note: '浏览器打印' },
  { value: ExportFormat.DOCX, label: 'DOCX', note: 'Word 文档' },
  { value: ExportFormat.XLSX, label: 'XLSX', note: 'Excel 表格' },
  { value: ExportFormat.CSV, label: 'CSV', note: '逗号分隔' },
  { value: ExportFormat.TXT, label: 'TXT', note: '纯文本' },
  { value: ExportFormat.HTML, label: 'HTML', note: '自包含网页' },
];

const step = ref<'format' | 'converting' | 'done'>('format');
const selectedFormat = ref<ExportFormat>(ExportFormat.PDF);
const includeFrontmatter = ref(true);
const progressPct = ref(0);
const errorMsg = ref('');

let progressTimer: ReturnType<typeof setInterval> | null = null;

const selectedFormatLabel = computed(
  () => formats.find((f) => f.value === selectedFormat.value)?.label ?? '',
);

function clearProgressTimer(): void {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
}

// Reset all state when dialog opens
watch(
  () => props.visible,
  (v) => {
    if (v) {
      clearProgressTimer();
      step.value = 'format';
      progressPct.value = 0;
      errorMsg.value = '';
    }
  },
);

onUnmounted(() => clearProgressTimer());

function cancel(): void {
  clearProgressTimer();
  emit('update:visible', false);
  emit('cancel');
}

async function doExport(): Promise<void> {
  if (!props.markdownContent) return;

  step.value = 'converting';
  progressPct.value = 0;
  errorMsg.value = '';

  try {
    const fileName =
      props.noteTitle?.replace(/\.md$/, '') ||
      props.notePath?.replace(/\.md$/, '').replace(/^\//, '') ||
      'export';

    // Animate progress (safe — cleared on close/unmount)
    clearProgressTimer();
    progressTimer = setInterval(() => {
      if (progressPct.value < 85) progressPct.value += 12;
    }, 80);

    const result = await exportNote(props.markdownContent, fileName, {
      format: selectedFormat.value,
      includeFrontmatter: includeFrontmatter.value,
      imageHandling: props.readBinary ? 'embed' : 'omit',
      readBinary: props.readBinary,
    });

    clearProgressTimer();
    progressPct.value = 100;
    await new Promise((r) => setTimeout(r, 150));

    if (!result.success) {
      errorMsg.value = result.error ?? '导出失败';
    }
    step.value = 'done';
  } catch (e) {
    clearProgressTimer();
    errorMsg.value = e instanceof Error ? e.message : '导出失败';
    step.value = 'done';
  }
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay, var(--paper-bg, oklch(0.975 0.003 85)));
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
}

.export-dialog {
  width: 480px;
  max-height: 80vh;
  background: var(--paper-surface, oklch(0.985 0.002 85));
  border-radius: var(--radius, 2px);
  box-shadow: var(--shadow-float, 0 4px 16px oklch(0.15 0.003 85 / 0.08));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--rule, oklch(0.88 0.003 85));
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--rule, oklch(0.88 0.003 85));
  background: var(--paper-raised, oklch(1 0 0));
}

.dialog-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--ink-primary, oklch(0.15 0.003 85));
}

.dialog-close {
  width: 28px;
  height: 28px;
  border: none;
  background: none;
  font-size: 20px;
  color: var(--ink-muted, oklch(0.6 0.002 85));
  cursor: pointer;
  border-radius: var(--radius, 2px);
}

.dialog-close:hover {
  background: var(--accent-soft, oklch(0.92 0.03 250 / 0.55));
  color: var(--ink-primary, oklch(0.15 0.003 85));
}

.dialog-body {
  padding: 20px;
  flex: 1;
  overflow-y: auto;
  background: var(--paper-surface, oklch(0.985 0.002 85));
  color: var(--ink-primary, oklch(0.15 0.003 85));
}

.dialog-body--progress {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 20px;
  gap: 16px;
}

.section-label {
  font-size: 13px;
  color: var(--ink-secondary, oklch(0.42 0.003 85));
  margin: 0 0 12px;
}

.format-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.format-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 8px;
  border: 2px solid var(--rule, oklch(0.88 0.003 85));
  border-radius: var(--radius, 2px);
  background: var(--paper-surface, oklch(0.985 0.002 85));
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s;
}

.format-card:hover {
  border-color: var(--rule-strong, oklch(0.8 0.005 85));
  background: var(--paper-raised, oklch(1 0 0));
}

.format-card--selected {
  border-color: var(--accent, oklch(0.52 0.12 250));
  background: var(--accent-soft, oklch(0.92 0.03 250 / 0.55));
}

.format-name {
  font-size: 13px;
  font-weight: 600;
}

.format-note {
  font-size: 10px;
  color: var(--ink-muted, oklch(0.6 0.002 85));
}

.export-options {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--rule, oklch(0.88 0.003 85));
}

.option-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--ink-secondary, oklch(0.42 0.003 85));
  cursor: pointer;
}

.option-hint {
  margin: 6px 0 0 24px;
  font-size: 11px;
  color: var(--ink-muted, oklch(0.6 0.002 85));
  line-height: 1.5;
}

.option-hint code {
  font-family: var(--ff-mono, monospace);
  background: var(--code-bg, oklch(0.96 0.002 85));
  color: var(--code-text, oklch(0.18 0.005 85));
  padding: 1px 4px;
  border-radius: var(--radius, 2px);
  font-size: 10px;
}

.option-hint em {
  color: var(--ink-muted, oklch(0.6 0.002 85));
}

/* Progress */
.progress-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid var(--rule, oklch(0.88 0.003 85));
  border-top-color: var(--accent, oklch(0.52 0.12 250));
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.progress-text {
  font-size: 14px;
  color: var(--ink-secondary, oklch(0.42 0.003 85));
  margin: 0;
}

.progress-bar {
  width: 200px;
  height: 4px;
  background: var(--rule, oklch(0.88 0.003 85));
  border-radius: var(--radius, 2px);
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: var(--accent, oklch(0.52 0.12 250));
  border-radius: var(--radius, 2px);
  transition: width 0.3s ease;
}

.export-success {
  padding: 12px 0;
  text-align: center;
  font-size: 15px;
  color: var(--signal-success, oklch(0.56 0.14 158));
  font-weight: 500;
}

.export-error {
  padding: 12px;
  border-radius: var(--radius, 2px);
  text-align: center;
  background: oklch(0.95 0.01 25 / 0.1);
  color: var(--signal-error, oklch(0.48 0.17 25));
  font-size: 14px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--rule, oklch(0.88 0.003 85));
  background: var(--paper-surface, oklch(0.985 0.002 85));
}

.btn {
  padding: 8px 20px;
  border-radius: var(--radius, 2px);
  font-size: 13px;
  cursor: pointer;
  border: 1px solid var(--rule, oklch(0.88 0.003 85));
}

.btn--secondary {
  background: var(--paper-surface, oklch(0.985 0.002 85));
  color: var(--ink-secondary, oklch(0.42 0.003 85));
}

.btn--secondary:hover {
  background: var(--accent-soft, oklch(0.92 0.03 250 / 0.55));
  color: var(--ink-primary, oklch(0.15 0.003 85));
}

.btn--primary {
  background: var(--accent, oklch(0.52 0.12 250));
  color: oklch(0.995 0 0);
  border-color: var(--accent, oklch(0.52 0.12 250));
}

.btn--primary:hover {
  background: oklch(0.5 0.14 255);
}

.btn--primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
