<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay" @click.self="cancel" @keydown.escape="cancel">
      <div class="modal-card" role="dialog" aria-labelledby="share-dialog-title">
        <!-- Header -->
        <div class="modal-header">
          <h2 id="share-dialog-title">分享笔记</h2>
          <button class="modal-close" aria-label="关闭" @click="cancel">&times;</button>
        </div>

        <!-- Step Indicator Dots -->
        <div class="step-dots" role="tablist" aria-label="步骤指示器">
          <span
            class="dot"
            :class="{ active: step === 0 }"
            role="tab"
            :aria-selected="step === 0"
            aria-label="步骤 1：选择格式"
          />
          <span
            class="dot"
            :class="{ active: step === 1 }"
            role="tab"
            :aria-selected="step === 1"
            aria-label="步骤 2：选择渠道"
          />
        </div>

        <!-- Body -->
        <div class="modal-body">
          <!-- Step 1: Format Selection -->
          <template v-if="step === 0">
            <p class="step-label">选择导出格式</p>
            <div class="option-grid">
              <button
                v-for="f in formats"
                :key="f.fmt"
                class="option-card"
                :class="{ selected: selectedFormat === f.fmt }"
                :aria-pressed="selectedFormat === f.fmt"
                @click="selectedFormat = f.fmt"
              >
                <span class="option-icon" v-html="f.icon"></span>
                <span class="option-name">{{ f.name }}</span>
                <span class="option-ext">{{ f.ext }}</span>
              </button>
            </div>
          </template>

          <!-- Step 2: Channel Selection -->
          <template v-else>
            <p class="step-label">选择分享渠道</p>
            <div class="option-grid">
              <button
                v-for="ch in channels"
                :key="ch.ch"
                class="option-card"
                @click="doShare(ch.ch)"
              >
                <span class="option-icon" v-html="ch.icon"></span>
                <span class="option-name">{{ ch.name }}</span>
              </button>
            </div>
          </template>
        </div>

        <!-- Footer -->
        <div class="modal-footer">
          <Button v-if="step === 1" variant="secondary" @click="step = 0"> &larr; 返回 </Button>
          <Button variant="secondary" @click="cancel">取消</Button>
          <Button v-if="step === 0" variant="default" :disabled="!hasContent" @click="step = 1">
            下一步
          </Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { ExportFormat, ShareChannel } from '@/types';
import Button from '@/components/common/Button.vue';
import { exportNote } from '@/services/Exporter';

// ============================================================
// Props & Emits
// ============================================================
const props = defineProps<{
  visible: boolean;
  noteTitle?: string;
  markdownContent?: string;
}>();

const emit = defineEmits<{
  'update:visible': [boolean];
  cancel: [];
}>();

// ============================================================
// State
// ============================================================
const step = ref<0 | 1>(0);
const selectedFormat = ref<ExportFormat>(ExportFormat.MD);

const hasContent = computed<boolean>(() => {
  return !!(props.markdownContent && props.markdownContent.trim().length > 0);
});

// ============================================================
// Format Definitions
// ============================================================
interface FormatEntry {
  fmt: ExportFormat;
  name: string;
  ext: string;
  icon: string;
}

const formats: FormatEntry[] = [
  {
    fmt: ExportFormat.MD,
    name: 'Markdown',
    ext: '.md',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="12" y2="16"/></svg>',
  },
  {
    fmt: ExportFormat.TXT,
    name: '纯文本',
    ext: '.txt',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="15" x2="14" y2="15"/><line x1="8" y1="18" x2="11" y2="18"/></svg>',
  },
  {
    fmt: ExportFormat.HTML,
    name: 'HTML',
    ext: '.html',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="9 12 7 15 9 18"/><polyline points="15 12 17 15 15 18"/></svg>',
  },
  {
    fmt: ExportFormat.PDF,
    name: 'PDF',
    ext: '.pdf',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><rect x="8" y="12" width="8" height="7" rx="1"/><line x1="10" y1="14.5" x2="14" y2="14.5"/><line x1="10" y1="16.5" x2="14" y2="16.5"/></svg>',
  },
];

// ============================================================
// Channel Definitions
// ============================================================
interface ChannelEntry {
  ch: ShareChannel;
  name: string;
  icon: string;
}

const channels: ChannelEntry[] = [
  {
    ch: ShareChannel.SYSTEM_SHARE,
    name: '系统分享',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
  },
  {
    ch: ShareChannel.EMAIL,
    name: '邮件',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2 4 12 13 22 4"/></svg>',
  },
  {
    ch: ShareChannel.CLIPBOARD,
    name: '剪贴板',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/></svg>',
  },
  {
    ch: ShareChannel.LOCAL_EXPORT,
    name: '本地导出',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 8l-6-6H8a2 2 0 00-2 2v16a2 2 0 002 2h8"/><polyline points="12 10 12 20"/><polyline points="9 17 12 20 15 17"/><path d="M16 2v6h6"/></svg>',
  },
];

// ============================================================
// Methods
// ============================================================

function cancel(): void {
  emit('cancel');
  emit('update:visible', false);
}

function resetState(): void {
  step.value = 0;
  selectedFormat.value = ExportFormat.MD;
}

async function doShare(channel: ShareChannel): Promise<void> {
  if (!hasContent.value) return;

  const content = getFormattedContent();
  const title = props.noteTitle || '未命名笔记';

  try {
    switch (channel) {
      case ShareChannel.SYSTEM_SHARE:
        await shareViaSystem(title, content);
        break;
      case ShareChannel.EMAIL:
        shareViaEmail(title, content);
        break;
      case ShareChannel.CLIPBOARD:
        await shareViaClipboard(content);
        break;
      case ShareChannel.LOCAL_EXPORT:
        await shareViaLocalExport(title, content);
        break;
    }
    emit('update:visible', false);
    resetState();
  } catch (err: unknown) {
    // User cancellation is not an error
    if (err instanceof DOMException && err.name === 'AbortError') return;
    // eslint-disable-next-line no-console
    console.error('分享失败:', err);
  }
}

// -----------------------------------------------------------
// Format Conversion
// -----------------------------------------------------------

function getFormattedContent(): string {
  const md = props.markdownContent!;
  switch (selectedFormat.value) {
    case ExportFormat.MD:
      return md;
    case ExportFormat.TXT:
      return stripMarkdown(md);
    case ExportFormat.HTML:
      return wrapHtml(md, props.noteTitle || '未命名笔记');
    case ExportFormat.PDF:
      return md;
    default:
      return md;
  }
}

function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '[图片: $1]');
}

function wrapHtml(md: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>${escapeHtml(title)}</title>
<style>
  :root {
    --ink-primary: oklch(0.15 0.003 85);
    --ink-muted: oklch(0.6 0.002 85);
    --accent: oklch(0.52 0.12 250);
    --link: oklch(0.5 0.11 250);
    --rule: oklch(0.88 0.003 85);
    --code-block-bg: oklch(0.97 0.002 85);
    --code-bg: oklch(0.96 0.002 85);
    --table-stripe: oklch(0.97 0.002 85);
  }
  body{font-family:'PingFang SC','Microsoft YaHei',sans-serif;max-width:720px;margin:48px auto;padding:0 24px;line-height:1.8;color:var(--ink-primary)}
  h1,h2,h3{line-height:1.3;margin:1.5em 0 .5em}
  pre{background:var(--code-block-bg);padding:16px;border-radius:2px;overflow-x:auto;font-size:14px}
  code{font-family:'Fira Code',monospace;font-size:.9em;background:var(--code-bg);padding:2px 6px;border-radius:2px}
  pre code{background:none;padding:0}
  blockquote{border-left:3px solid var(--accent);padding:.5em 1em;color:var(--ink-muted);margin:1em 0}
  table{border-collapse:collapse;width:100%;margin:1em 0}
  th,td{border:1px solid var(--rule);padding:8px 12px;text-align:left}
  th{background:var(--table-stripe)}
  hr{border:none;border-top:2px solid var(--rule);margin:2em 0}
  img{max-width:100%}
  a{color:var(--link)}
</style></head>
<body>${escapeHtml(md)}</body></html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// -----------------------------------------------------------
// Channel Handlers
// -----------------------------------------------------------

function getMimeType(): string {
  switch (selectedFormat.value) {
    case ExportFormat.MD:
      return 'text/markdown';
    case ExportFormat.TXT:
      return 'text/plain';
    case ExportFormat.HTML:
      return 'text/html';
    case ExportFormat.PDF:
      return 'application/pdf';
    default:
      return 'text/plain';
  }
}

function getExtension(): string {
  switch (selectedFormat.value) {
    case ExportFormat.MD:
      return '.md';
    case ExportFormat.TXT:
      return '.txt';
    case ExportFormat.HTML:
      return '.html';
    case ExportFormat.PDF:
      return '.pdf';
    default:
      return '.txt';
  }
}

async function shareViaSystem(title: string, content: string): Promise<void> {
  const fileName = `${title}${getExtension()}`;
  const mime = getMimeType();
  const file = new File([content], fileName, { type: mime });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ title, files: [file] });
  } else if (navigator.share) {
    await navigator.share({ title, text: content });
  }
}

function shareViaEmail(title: string, content: string): void {
  const subject = encodeURIComponent(title);
  const body = encodeURIComponent(content);
  window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
}

async function shareViaClipboard(content: string): Promise<void> {
  if (selectedFormat.value === ExportFormat.HTML) {
    const blob = new Blob([content], { type: 'text/html' });
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': blob,
        'text/plain': new Blob([content], { type: 'text/plain' }),
      }),
    ]);
  } else {
    await navigator.clipboard.writeText(content);
  }
}

async function shareViaLocalExport(title: string, content: string): Promise<void> {
  if (selectedFormat.value === ExportFormat.PDF) {
    await exportNote(props.markdownContent!, title, { format: ExportFormat.PDF });
    return;
  }

  // Other formats: trigger file download via Blob
  const fileName = `${title}${getExtension()}`;
  const mime = getMimeType();
  const blob = new Blob([content], { type: `${mime};charset=UTF-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================
// Watchers
// ============================================================
watch(
  () => props.visible,
  (val) => {
    if (val) resetState();
  },
);
</script>

<style scoped>
/* ===== Card (width override only — skeleton in dialog.css) ===== */
.modal-card {
  width: 480px;
}

/* ===== Step Dots ===== */
.step-dots {
  display: flex;
  gap: var(--space-8);
  justify-content: center;
  padding: var(--space-12) 0;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--rule);
  transition: background var(--dur-micro) var(--ease-fade);
}

.dot.active {
  background: var(--accent);
}

/* ===== Body ===== */
.modal-body {
  padding: 0 var(--space-20) var(--space-20);
  overflow-y: auto;
  flex: 1;
}

.step-label {
  font-size: var(--text-sm);
  color: var(--ink-secondary);
  margin: 0 0 var(--space-12);
}

/* ===== Option Grid ===== */
.option-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-8);
}

.option-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-16) var(--space-12);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
  cursor: pointer;
  color: var(--ink-secondary);
  transition: all var(--dur-micro) var(--ease-fade);
  user-select: none;
}

.option-card:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--ink-primary);
}

.option-card.selected {
  border-color: var(--accent);
  border-width: var(--border-medium);
  background: var(--accent-soft);
  color: var(--ink-primary);
}

.option-card:active {
  transform: scale(0.97);
}

.option-icon {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-secondary);
}

.option-card:hover .option-icon,
.option-card.selected .option-icon {
  color: var(--accent);
}

.option-icon :deep(svg) {
  width: 24px;
  height: 24px;
  display: block;
}

.option-name {
  font-size: var(--text-sm);
  font-weight: var(--fw-medium);
  line-height: var(--lh-none);
}

.option-ext {
  font-size: var(--text-xs);
  color: var(--ink-muted);
  line-height: var(--lh-none);
}
</style>
