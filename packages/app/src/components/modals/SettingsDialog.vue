<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="overlayRef"
      class="modal-overlay"
      tabindex="-1"
      @click.self="close"
      @keydown.escape="close"
    >
      <div
        class="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
      >
        <div class="modal-header">
          <h2 id="settings-dialog-title">设置</h2>
          <button class="modal-close" aria-label="关闭" @click="close">&times;</button>
        </div>

        <div class="modal-body">
          <nav class="settings-nav">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              class="nav-item"
              :class="{ active: activeTab === tab.id }"
              @click="activeTab = tab.id"
            >
              <span class="nav-label">{{ tab.label }}</span>
            </button>
          </nav>

          <div class="settings-content">
            <section v-show="activeTab === 'editor'" class="section">
              <h3 class="section-title">编辑器</h3>

              <div class="setting-row">
                <div class="setting-info">
                  <span class="setting-label">字体大小</span>
                  <span class="setting-value">{{ fontSize }}px</span>
                </div>
                <input v-model.number="fontSize" type="range" class="slider" min="12" max="24" />
              </div>

              <div class="setting-row">
                <div class="setting-info">
                  <span class="setting-label">行高</span>
                  <span class="setting-value">{{ lineHeight.toFixed(1) }}</span>
                </div>
                <input
                  v-model.number="lineHeight"
                  type="range"
                  class="slider"
                  min="1.2"
                  max="2.5"
                  step="0.1"
                />
              </div>

              <div class="setting-row">
                <span class="setting-label">Tab 宽度</span>
                <div class="segmented">
                  <button
                    class="segment-btn"
                    :class="{ active: tabSize === 2 }"
                    @click="tabSize = 2"
                  >
                    2
                  </button>
                  <button
                    class="segment-btn"
                    :class="{ active: tabSize === 4 }"
                    @click="tabSize = 4"
                  >
                    4
                  </button>
                </div>
              </div>

              <div class="setting-row">
                <span class="setting-label">自动换行</span>
                <span
                  class="toggle-track"
                  :class="{ active: wordWrap }"
                  role="switch"
                  tabindex="0"
                  aria-label="自动换行"
                  :aria-checked="wordWrap"
                  @click="wordWrap = !wordWrap"
                  @keydown.enter.prevent="wordWrap = !wordWrap"
                  @keydown.space.prevent="wordWrap = !wordWrap"
                >
                  <span class="toggle-thumb"></span>
                </span>
              </div>

              <div class="setting-row">
                <div class="setting-info">
                  <span class="setting-label">扫描根目录文本文件</span>
                  <span class="setting-value">外部文件</span>
                </div>
                <span
                  class="toggle-track"
                  :class="{ active: externalScanRootTextFiles }"
                  role="switch"
                  tabindex="0"
                  aria-label="扫描根目录文本文件"
                  :aria-checked="externalScanRootTextFiles"
                  @click="externalScanRootTextFiles = !externalScanRootTextFiles"
                  @keydown.enter.prevent="externalScanRootTextFiles = !externalScanRootTextFiles"
                  @keydown.space.prevent="externalScanRootTextFiles = !externalScanRootTextFiles"
                >
                  <span class="toggle-thumb"></span>
                </span>
                <p class="setting-help">
                  仅影响外部只读文件会话的搜索与标签扫描，不会把未打开文件加入最近笔记。
                </p>
              </div>
            </section>

            <section v-show="activeTab === 'autosave'" class="section">
              <h3 class="section-title">自动保存</h3>

              <div class="setting-row">
                <span class="setting-label">启用自动保存</span>
                <span
                  class="toggle-track"
                  :class="{ active: autoSaveEnabled }"
                  role="switch"
                  tabindex="0"
                  aria-label="启用自动保存"
                  :aria-checked="autoSaveEnabled"
                  @click="autoSaveEnabled = !autoSaveEnabled"
                  @keydown.enter.prevent="autoSaveEnabled = !autoSaveEnabled"
                  @keydown.space.prevent="autoSaveEnabled = !autoSaveEnabled"
                >
                  <span class="toggle-thumb"></span>
                </span>
              </div>

              <div class="setting-row" :class="{ disabled: !autoSaveEnabled }">
                <div class="setting-info">
                  <span class="setting-label">保存延迟</span>
                  <span class="setting-value">{{ formatDelay(autoSaveDelay) }}</span>
                </div>
                <input
                  v-model.number="autoSaveDelay"
                  type="range"
                  class="slider"
                  min="500"
                  max="10000"
                  step="100"
                  :disabled="!autoSaveEnabled"
                />
              </div>
            </section>

            <section v-show="activeTab === 'autocomplete'" class="section">
              <h3 class="section-title">文字补全</h3>

              <div class="setting-row">
                <span class="setting-label">启用幽灵文本补全</span>
                <span
                  class="toggle-track"
                  :class="{ active: autoCompleteEnabled }"
                  role="switch"
                  tabindex="0"
                  aria-label="启用幽灵文本补全"
                  :aria-checked="autoCompleteEnabled"
                  @click="autoCompleteEnabled = !autoCompleteEnabled"
                  @keydown.enter.prevent="autoCompleteEnabled = !autoCompleteEnabled"
                  @keydown.space.prevent="autoCompleteEnabled = !autoCompleteEnabled"
                >
                  <span class="toggle-thumb"></span>
                </span>
              </div>

              <div class="setting-row">
                <div class="setting-info">
                  <span class="setting-label">后台训练当前笔记本</span>
                  <span class="setting-value">{{ trainingStatusLabel }}</span>
                </div>
                <span
                  class="toggle-track"
                  :class="{ active: backgroundTraining }"
                  role="switch"
                  tabindex="0"
                  aria-label="后台训练当前笔记本"
                  :aria-checked="backgroundTraining"
                  @click="backgroundTraining = !backgroundTraining"
                  @keydown.enter.prevent="backgroundTraining = !backgroundTraining"
                  @keydown.space.prevent="backgroundTraining = !backgroundTraining"
                >
                  <span class="toggle-thumb"></span>
                </span>
              </div>

              <div class="autocomplete-meta">
                <div class="meta-row">
                  <span>已训练文件</span>
                  <strong>{{ props.completionTrainingMeta?.fileCount ?? 0 }}</strong>
                </div>
                <div class="meta-row">
                  <span>上次训练</span>
                  <strong>{{ formatTrainingTime(props.completionTrainingMeta?.updatedAt) }}</strong>
                </div>
                <p class="local-note">仅处理当前笔记本中的本地 Markdown / 文本文件。</p>
              </div>

              <div class="settings-actions settings-actions--left">
                <button class="segment-btn" type="button" @click="$emit('clear-completion-data')">
                  清空本地学习数据
                </button>
              </div>
            </section>

            <section v-show="activeTab === 'updates'" class="section">
              <h3 class="section-title">更新</h3>

              <div class="setting-row">
                <span class="setting-label">自动检查更新</span>
                <span
                  class="toggle-track"
                  :class="{ active: autoCheckUpdates }"
                  role="switch"
                  tabindex="0"
                  aria-label="自动检查更新"
                  :aria-checked="autoCheckUpdates"
                  @click="autoCheckUpdates = !autoCheckUpdates"
                  @keydown.enter.prevent="autoCheckUpdates = !autoCheckUpdates"
                  @keydown.space.prevent="autoCheckUpdates = !autoCheckUpdates"
                >
                  <span class="toggle-thumb"></span>
                </span>
              </div>

              <div class="setting-row disabled">
                <span class="setting-label">自动安装更新</span>
                <span class="setting-value">暂未开放</span>
              </div>

              <div class="settings-actions">
                <button class="segment-btn" :disabled="checking" @click="onCheckUpdate">
                  {{ checking ? '检查中...' : '立即检查更新' }}
                </button>
                <button class="segment-btn" @click="onReplayWelcome">重新播放欢迎引导</button>
              </div>

              <p v-if="updateStatus" class="setting-help">{{ updateStatus }}</p>
            </section>

            <section v-show="activeTab === 'about'" class="section">
              <h3 class="section-title">关于</h3>
              <div class="about-card">
                <strong>MarkLuck {{ appVersion }}</strong>
                <p>默认羽翼工作台，本地优先，离线可用。</p>
              </div>
              <div class="settings-actions">
                <a
                  v-for="link in aboutLinks"
                  :key="link.url"
                  class="about-link"
                  :href="link.url"
                  target="_blank"
                  rel="noreferrer"
                >
                  {{ link.label }}
                </a>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import {
  DEFAULT_COMPLETION_SETTINGS,
  type CompletionSettings,
} from '@/services/CompletionSettings';
import type { CompletionTrainingMeta } from '@/services/CompletionTrainingService';

const props = withDefaults(
  defineProps<{
    visible: boolean;
    completionSettings?: CompletionSettings;
    completionTrainingMeta?: CompletionTrainingMeta;
    externalScanRootTextFiles?: boolean;
  }>(),
  {
    completionSettings: () => ({ ...DEFAULT_COMPLETION_SETTINGS }),
    completionTrainingMeta: undefined,
    externalScanRootTextFiles: false,
  },
);

const emit = defineEmits<{
  'update:visible': [boolean];
  'update-completion-settings': [CompletionSettings];
  'update-external-scan-root': [boolean];
  'clear-completion-data': [];
}>();

interface TabDef {
  id: 'editor' | 'autosave' | 'autocomplete' | 'updates' | 'about';
  label: string;
}

const tabs: TabDef[] = [
  { id: 'editor', label: '编辑器' },
  { id: 'autosave', label: '自动保存' },
  { id: 'autocomplete', label: '文字补全' },
  { id: 'updates', label: '更新' },
  { id: 'about', label: '关于' },
];

const overlayRef = ref<HTMLDivElement | null>(null);
const activeTab = ref<TabDef['id']>('editor');

const fontSize = ref(16);
const lineHeight = ref(1.6);
const tabSize = ref(2);
const wordWrap = ref(true);
const externalScanRootTextFiles = ref(props.externalScanRootTextFiles);
const autoSaveEnabled = ref(true);
const autoSaveDelay = ref(3000);

const autoCompleteEnabled = ref(props.completionSettings.enabled);
const backgroundTraining = ref(props.completionSettings.backgroundTraining);

const AUTO_CHECK_KEY = 'markluck:version:autoCheck';
const AUTO_INSTALL_KEY = 'markluck:version:autoInstall';
const autoCheckUpdates = ref(localStorage.getItem(AUTO_CHECK_KEY) === 'true');
const checking = ref(false);
const updateStatus = ref('');
const appVersion = 'v0.15';

const aboutLinks = [
  { label: 'GitHub 仓库', url: 'https://github.com/jiay98528-dev/MarkLuck' },
  { label: '问题反馈', url: 'https://github.com/jiay98528-dev/MarkLuck/issues' },
  {
    label: 'MIT 许可',
    url: 'https://github.com/jiay98528-dev/MarkLuck/blob/main/LICENSE',
  },
];

const trainingStatusLabel = computed(() => {
  const status = props.completionTrainingMeta?.status ?? 'idle';
  if (status === 'training') return '训练中';
  if (status === 'partial') return '部分完成';
  if (status === 'error') return '失败';
  if (status === 'done') return '已完成';
  return '待训练';
});

watch(
  () => props.externalScanRootTextFiles,
  (value) => {
    externalScanRootTextFiles.value = value;
  },
);

watch(externalScanRootTextFiles, (value) => {
  localStorage.setItem('markluck:external:scanRootTextFiles', String(value));
  emit('update-external-scan-root', value);
});

watch(
  () => props.completionSettings,
  (settings) => {
    autoCompleteEnabled.value = settings.enabled;
    backgroundTraining.value = settings.backgroundTraining;
  },
  { deep: true },
);

watch([autoCompleteEnabled, backgroundTraining], ([enabled, training]) => {
  emit('update-completion-settings', {
    ...props.completionSettings,
    enabled,
    backgroundTraining: training,
  });
});

watch(autoCheckUpdates, (value) => {
  localStorage.setItem(AUTO_CHECK_KEY, String(value));
  if (!value) {
    localStorage.setItem(AUTO_INSTALL_KEY, 'false');
  }
});

watch(
  () => props.visible,
  async (isVisible) => {
    if (isVisible) {
      await nextTick();
      overlayRef.value?.focus();
    }
  },
);

function formatDelay(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 1 : 2)}s`;
}

function formatTrainingTime(value?: number): string {
  if (!value) return '尚未训练';
  return new Date(value).toLocaleString();
}

async function onCheckUpdate(): Promise<void> {
  if (checking.value) return;
  checking.value = true;
  updateStatus.value = '';
  try {
    const resp = await fetch('https://api.github.com/repos/jiay98528-dev/MarkLuck/releases/latest');
    if (!resp.ok) throw new Error('API error');
    const data = await resp.json();
    const latest = data.tag_name || data.name || '';
    const current = '0.15.0';
    const cleanVersion = (value: string) => value.replace(/^v/, '');
    updateStatus.value =
      latest && cleanVersion(latest) !== current ? `发现新版本 ${latest}` : '已是最新版本';
  } catch {
    updateStatus.value = '检查失败，请稍后重试';
  } finally {
    checking.value = false;
  }
}

function onReplayWelcome(): void {
  localStorage.removeItem('markluck:welcome:completed');
  window.location.reload();
}

function close(): void {
  emit('update:visible', false);
}
</script>

<style scoped>
.modal-card {
  width: min(680px, calc(100vw - 32px));
  max-height: 70vh;
}

.modal-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.settings-nav {
  width: 140px;
  flex-shrink: 0;
  padding: var(--space-8);
  border-right: var(--border-thin) solid var(--rule);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.nav-item {
  border: none;
  border-radius: var(--radius);
  padding: var(--space-8) var(--space-12);
  background: none;
  color: var(--ink-secondary);
  text-align: left;
  cursor: pointer;
}

.nav-item.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: var(--fw-medium);
}

.settings-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: var(--space-20);
}

.section {
  display: flex;
  flex-direction: column;
  gap: var(--space-16);
}

.section-title {
  margin: 0;
  padding-bottom: var(--space-8);
  border-bottom: var(--border-thin) solid var(--rule);
  color: var(--ink-muted);
  font-size: var(--text-sm);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-wide);
  text-transform: uppercase;
}

.setting-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.setting-row.disabled {
  opacity: var(--opacity-disabled);
  pointer-events: none;
}

.setting-info,
.meta-row,
.settings-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-12);
}

.setting-label {
  color: var(--ink-primary);
  font-size: var(--text-sm);
}

.setting-value {
  color: var(--ink-muted);
  font-size: var(--text-xs);
}

.setting-help,
.local-note,
.about-card p {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--text-xs);
  line-height: var(--lh-ui);
}

.autocomplete-meta,
.about-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  padding: var(--space-12);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
}

.segmented {
  display: inline-flex;
  gap: var(--space-6);
}

.segment-btn,
.about-link {
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  padding: var(--space-8) var(--space-12);
  background: var(--paper-raised);
  color: var(--ink-primary);
  text-decoration: none;
}

.segment-btn.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.toggle-track {
  position: relative;
  width: 44px;
  height: 24px;
  border-radius: 999px;
  background: var(--rule-strong);
  cursor: pointer;
}

.toggle-track.active {
  background: var(--accent);
}

.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: var(--paper-raised);
  transition: transform var(--dur-micro) var(--ease-fade);
}

.toggle-track.active .toggle-thumb {
  transform: translateX(20px);
}

.slider {
  width: 100%;
}

@media (width <= 720px) {
  .modal-body {
    flex-direction: column;
  }

  .settings-nav {
    width: auto;
    border-right: 0;
    border-bottom: var(--border-thin) solid var(--rule);
  }
}
</style>
