<template>
  <Teleport to="body">
    <div v-if="visible" class="dialog-overlay" @click.self="cancel">
      <div class="share-dialog">
        <div class="dialog-header">
          <h2>分享笔记</h2>
          <button class="dialog-close" @click="cancel">&times;</button>
        </div>

        <!-- Step 1: Format Selection -->
        <template v-if="step === 'format'">
          <div class="dialog-body">
            <p class="section-label">选择分享格式</p>
            <div class="format-list">
              <button
                v-for="fmt in formats"
                :key="fmt.value"
                class="format-option"
                :class="{ 'format-option--selected': selectedFormat === fmt.value }"
                @click="selectedFormat = fmt.value"
              >
                <div class="format-info">
                  <span class="format-name">{{ fmt.label }}</span>
                  <span class="format-desc">{{ fmt.desc }}</span>
                </div>
              </button>
            </div>
          </div>
          <div class="dialog-footer">
            <button class="btn btn--secondary" @click="cancel">取消</button>
            <button class="btn btn--primary" @click="startConvert">下一步</button>
          </div>
        </template>

        <!-- Step 2: Converting (progress) -->
        <template v-if="step === 'converting'">
          <div class="dialog-body dialog-body--progress">
            <div class="progress-spinner" />
            <p class="progress-text">正在生成 {{ selectedFormatLabel }} 文件...</p>
            <div class="progress-bar">
              <div class="progress-bar-fill" :style="{ width: progressPct + '%' }" />
            </div>
          </div>
        </template>

        <!-- Step 3: Channel Selection -->
        <template v-if="step === 'channel'">
          <div class="dialog-body">
            <p class="section-label">{{ selectedFormatLabel }} 就绪 — 选择分享渠道</p>
            <div class="channel-list">
              <button
                v-for="ch in channels"
                :key="ch.value"
                class="channel-option"
                @click="doShare(ch.value)"
              >
                <div class="channel-info">
                  <span class="channel-name">{{ ch.label }}</span>
                  <span class="channel-desc">{{ ch.desc }}</span>
                </div>
              </button>
            </div>
          </div>
          <div class="dialog-footer">
            <button class="btn btn--secondary" @click="backToFormat">返回</button>
            <button class="btn btn--secondary" @click="cancel">取消</button>
          </div>
        </template>

        <!-- Sharing in progress -->
        <div v-if="sharing" class="share-status">正在分享...</div>

        <!-- Result -->
        <template v-if="step === 'result'">
          <div class="share-result" :class="{ 'share-result--error': !shareResult?.success }">
            {{ shareResult?.success ? `已分享到${shareResult.channel}` : shareResult?.error }}
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
import { ref, watch, computed, onUnmounted } from 'vue';
import { ExportFormat, ShareChannel } from '@/types';

const props = defineProps<{
  visible: boolean;
  noteTitle?: string;
  markdownContent?: string;
}>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
  cancel: [];
}>();

const formats: Array<{ value: ExportFormat; label: string; desc: string }> = [
  { value: ExportFormat.MD, label: 'Markdown', desc: '原始 .md 文件' },
  { value: ExportFormat.TXT, label: '纯文本', desc: '去除格式标记的纯文本' },
];

const step = ref<'format' | 'converting' | 'channel' | 'result'>('format');
const selectedFormat = ref<ExportFormat>(ExportFormat.MD);
const progressPct = ref(0);
const exportBlob = ref<Blob | null>(null);
const exportText = ref('');
const exportFileName = ref('');
const sharing = ref(false);
const shareResult = ref<{ success: boolean; channel?: string; error?: string } | null>(null);

let progressTimer: ReturnType<typeof setInterval> | null = null;

const selectedFormatLabel = computed(
  () => formats.find((f) => f.value === selectedFormat.value)?.label ?? '',
);

const channels = computed(() => {
  const all = [
    {
      value: ShareChannel.CLIPBOARD,
      label: '复制到剪贴板',
      desc: '将转换后的内容复制到剪贴板',
      available: true,
    },
    {
      value: ShareChannel.EMAIL,
      label: '邮件发送',
      desc: '通过默认邮件客户端发送',
      available: true,
    },
    {
      value: ShareChannel.SYSTEM_SHARE,
      label: '系统分享',
      desc: '调用操作系统分享面板',
      available: true,
    },
  ];
  return all;
});

// Reset all state when dialog opens
watch(
  () => props.visible,
  (v) => {
    if (v) {
      clearProgressTimer();
      step.value = 'format';
      selectedFormat.value = ExportFormat.MD;
      progressPct.value = 0;
      exportBlob.value = null;
      exportText.value = '';
      exportFileName.value = '';
      sharing.value = false;
      shareResult.value = null;
    }
  },
);

onUnmounted(() => clearProgressTimer());

function clearProgressTimer(): void {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
}

function cancel(): void {
  emit('update:visible', false);
  emit('cancel');
}

function backToFormat(): void {
  step.value = 'format';
}

async function startConvert(): Promise<void> {
  if (!props.markdownContent) return;

  step.value = 'converting';
  progressPct.value = 10;

  const fileName = props.noteTitle?.replace(/\.md$/, '') || '分享';

  // Animate progress
  clearProgressTimer();
  progressTimer = setInterval(() => {
    if (progressPct.value < 85) progressPct.value += 15;
  }, 100);

  try {
    const markdown = props.markdownContent;

    switch (selectedFormat.value) {
      case ExportFormat.MD:
        exportText.value = markdown;
        exportFileName.value = `${fileName}.md`;
        exportBlob.value = new Blob([markdown], { type: 'text/markdown' });
        break;

      case ExportFormat.TXT:
        exportText.value = stripMarkdown(markdown);
        exportFileName.value = `${fileName}.txt`;
        exportBlob.value = new Blob([exportText.value], { type: 'text/plain' });
        break;

      default:
        exportText.value = markdown;
        exportFileName.value = `${fileName}.md`;
    }

    progressPct.value = 100;
    await new Promise((r) => setTimeout(r, 200));
    clearProgressTimer();

    step.value = 'channel';
  } catch (e) {
    clearProgressTimer();
    shareResult.value = { success: false, error: e instanceof Error ? e.message : '转换失败' };
    step.value = 'result';
  }
}

async function doShare(channel: ShareChannel): Promise<void> {
  sharing.value = true;

  try {
    const textContent = exportText.value;
    const fileName = exportFileName.value;
    const blob = exportBlob.value;

    switch (channel) {
      case ShareChannel.CLIPBOARD:
        await navigator.clipboard.writeText(textContent);
        break;

      case ShareChannel.EMAIL: {
        const subject = encodeURIComponent(fileName);
        const body = encodeURIComponent(textContent.slice(0, 2000));
        window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
        break;
      }

      case ShareChannel.SYSTEM_SHARE: {
        if (blob) {
          try {
            const file = new File([blob], fileName, { type: blob.type });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
              await navigator.share({ files: [file] });
            } else {
              await navigator.share({ title: fileName, text: textContent.slice(0, 500) });
            }
          } catch (e) {
            if (e instanceof DOMException && e.name === 'AbortError') throw e;
            try {
              await navigator.share({ title: fileName, text: textContent.slice(0, 500) });
            } catch {
              throw new Error('系统分享暂不支持此文件类型，请尝试"复制到剪贴板"');
            }
          }
        } else {
          await navigator.share({ title: fileName, text: textContent.slice(0, 500) });
        }
        break;
      }
    }

    shareResult.value = { success: true, channel: getChannelLabel(channel) };
    step.value = 'result';
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      shareResult.value = null;
    } else {
      shareResult.value = { success: false, error: e instanceof Error ? e.message : '分享失败' };
      step.value = 'result';
    }
  } finally {
    sharing.value = false;
  }
}

function getChannelLabel(channel: ShareChannel): string {
  const map: Record<string, string> = {
    [ShareChannel.SYSTEM_SHARE]: '系统分享',
    [ShareChannel.EMAIL]: '邮件',
    [ShareChannel.CLIPBOARD]: '剪贴板',
  };
  return map[channel] ?? '';
}

function stripMarkdown(md: string): string {
  return md
    .replace(/^---[\s\S]*?---\s*\n/, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '[图片: $1]')
    .replace(/\[\[([^\]|#]+)(?:#[^\]]*)?(?:\|[^\]]+)?\]\]/g, '$1')
    .replace(/#([\w一-鿿]+)/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^[\s]*[-*+]\s/gm, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay, oklch(0.15 0.005 260 / 0.3));
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
}

.share-dialog {
  width: 420px;
  background: var(--paper-surface, oklch(0.985 0.002 85));
  border-radius: var(--radius, 2px);
  box-shadow: var(--shadow-float, 0 8px 30px oklch(0.15 0.003 85 / 0.2));
  overflow: hidden;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--rule, oklch(0.88 0.003 85));
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
  background: var(--surface-hover, oklch(0.93 0.002 260));
  color: var(--ink-primary, oklch(0.15 0.003 85));
}

.dialog-body {
  padding: 20px;
  background: var(--paper-surface, oklch(0.985 0.002 85));
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

.format-list,
.channel-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.format-option,
.channel-option {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 2px solid var(--rule, oklch(0.88 0.003 85));
  border-radius: var(--radius, 2px);
  background: var(--paper-surface, oklch(0.985 0.002 85));
  cursor: pointer;
  text-align: left;
  transition: border-color var(--dur-micro, 80ms) var(--ease-fade, ease-out);
}

.format-option:hover,
.channel-option:hover {
  border-color: var(--accent, oklch(0.52 0.12 250));
  background: var(--accent-soft, oklch(0.92 0.03 250 / 0.55));
}

.format-option--selected {
  border-color: var(--accent, oklch(0.52 0.12 250));
  background: var(--accent-soft, oklch(0.92 0.03 250 / 0.55));
}

.format-info,
.channel-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.format-name,
.channel-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink-primary, oklch(0.15 0.003 85));
}

.format-desc,
.channel-desc {
  font-size: 11px;
  color: var(--ink-muted, oklch(0.6 0.002 85));
}

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
  width: 240px;
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

.share-status {
  padding: 12px 20px;
  font-size: 13px;
  text-align: center;
  background: var(--accent-soft, oklch(0.92 0.03 250 / 0.55));
  color: var(--accent, oklch(0.52 0.12 250));
}

.share-result {
  padding: 12px 20px;
  font-size: 13px;
  text-align: center;
  background: oklch(0.95 0.01 145 / 0.3);
  color: var(--signal-success, oklch(0.56 0.14 158));
}

.share-result--error {
  background: oklch(0.95 0.01 25 / 0.1);
  color: var(--signal-error, oklch(0.48 0.17 25));
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
}

.btn--primary {
  background: var(--accent, oklch(0.52 0.12 250));
  color: oklch(0.995 0 0);
  border-color: var(--accent, oklch(0.52 0.12 250));
}

.btn--primary:hover {
  background: var(--accent-hover, oklch(0.48 0.13 250));
}
</style>
