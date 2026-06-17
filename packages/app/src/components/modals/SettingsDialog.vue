<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay" @click.self="close" @keydown.escape="close">
      <div class="modal-card">
        <!-- Header -->
        <div class="modal-header">
          <h2>设置</h2>
          <button class="modal-close" @click="close">&times;</button>
        </div>

        <!-- Body: left nav + right content -->
        <div class="modal-body">
          <nav class="settings-nav">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              class="nav-item"
              :class="{ active: activeTab === tab.id }"
              @click="activeTab = tab.id"
            >
              <span class="nav-icon" v-html="tab.icon"></span>
              <span class="nav-label">{{ tab.label }}</span>
            </button>
          </nav>

          <div class="settings-content">
            <!-- ── 编辑器 ── -->
            <div v-show="activeTab === 'editor'" class="section">
              <h3 class="section-title">编辑器</h3>

              <div class="setting-row">
                <div class="setting-info">
                  <span class="setting-label">字体大小</span>
                  <span class="setting-value">{{ fontSize }}px</span>
                </div>
                <input
                  v-model.number="fontSize"
                  type="range"
                  class="slider"
                  min="12"
                  max="24"
                  step="1"
                />
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
                  @click="wordWrap = !wordWrap"
                >
                  <span class="toggle-thumb"></span>
                </span>
              </div>
            </div>

            <!-- ── 外观 ── -->
            <div v-show="activeTab === 'appearance'" class="section">
              <h3 class="section-title">外观</h3>

              <div class="setting-row">
                <span class="setting-label">颜色方案</span>
                <div class="segmented">
                  <button
                    class="segment-btn"
                    :class="{ active: theme.colorScheme === 'light' }"
                    @click="theme.setColorScheme('light')"
                  >
                    &#9788; 亮色
                  </button>
                  <button
                    class="segment-btn"
                    :class="{ active: theme.colorScheme === 'dark' }"
                    @click="theme.setColorScheme('dark')"
                  >
                    &#9790; 暗色
                  </button>
                </div>
              </div>
            </div>

            <!-- ── 自动保存 ── -->
            <div v-show="activeTab === 'autosave'" class="section">
              <h3 class="section-title">自动保存</h3>

              <div class="setting-row">
                <span class="setting-label">启用自动保存</span>
                <span
                  class="toggle-track"
                  :class="{ active: autoSaveEnabled }"
                  @click="autoSaveEnabled = !autoSaveEnabled"
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
            </div>

            <!-- ── 文字补全 ── -->
            <div v-show="activeTab === 'autocomplete'" class="section">
              <h3 class="section-title">文字补全</h3>

              <div class="setting-row">
                <span class="setting-label">启用幽灵文本补全</span>
                <span
                  class="toggle-track"
                  :class="{ active: autoCompleteEnabled }"
                  @click="autoCompleteEnabled = !autoCompleteEnabled"
                >
                  <span class="toggle-thumb"></span>
                </span>
              </div>

              <div class="setting-info" style="margin-top: var(--space-12)">
                <p style="color: var(--ink-secondary); font-size: 0.875rem; line-height: 1.6">
                  输入时在光标后以灰色斜体显示预测文字。按 <kbd>Tab</kbd> 接受，继续输入则自动覆盖。
                  在代码块和 frontmatter 中不生效。
                </p>
              </div>
            </div>

            <!-- ── 更新 ── -->
            <div v-show="activeTab === 'updates'" class="section">
              <h3 class="section-title">版本更新</h3>

              <div class="setting-row">
                <span class="setting-label">自动检查可用更新</span>
                <span
                  class="toggle-track"
                  :class="{ active: autoCheckUpdates }"
                  @click="autoCheckUpdates = !autoCheckUpdates"
                >
                  <span class="toggle-thumb"></span>
                </span>
              </div>

              <div class="setting-info" style="margin-top: var(--space-12)">
                <p style="color: var(--ink-secondary); font-size: 0.875rem; line-height: 1.6">
                  仅查询 GitHub 公开版本号，不上传任何数据。
                </p>
              </div>

              <!-- Sub-options: shown when auto-check is enabled -->
              <div v-if="autoCheckUpdates" class="update-sub-options">
                <div class="setting-row">
                  <label class="radio-row" :class="{ disabled: !canAutoInstall }">
                    <span
                      class="radio-circle"
                      :class="{ active: autoInstall }"
                      @click="autoInstall = true"
                    ></span>
                    <span class="radio-label">自动下载并安装</span>
                    <span v-if="!canAutoInstall" class="lock-badge">&#128274; 证书就位后开放</span>
                  </label>
                </div>
                <div class="setting-row">
                  <label class="radio-row">
                    <span
                      class="radio-circle"
                      :class="{ active: !autoInstall }"
                      @click="autoInstall = false"
                    ></span>
                    <span class="radio-label">仅提醒新版本可用</span>
                  </label>
                </div>

                <div v-if="!canAutoInstall" class="cert-notice">
                  <span style="color: var(--signal-warning)">&#9888;&#65039;</span>
                  <span>当前为先行版，暂未获得代码签名证书。证书就位后"自动安装"将开放。</span>
                </div>
              </div>

              <!-- Check for updates button -->
              <div class="setting-row" style="margin-top: var(--space-16)">
                <button class="check-update-btn" @click="onCheckUpdate">
                  {{ checking ? '检查中...' : '立即检查更新' }}
                </button>
                <span
                  v-if="updateStatus"
                  class="update-status"
                  :class="{ 'has-update': updateHasUpdate }"
                >
                  {{ updateStatus }}
                </span>
              </div>
            </div>

            <!-- ── 关于 ── -->
            <div v-show="activeTab === 'about'" class="section">
              <h3 class="section-title">关于</h3>

              <div class="about-block">
                <p class="about-name">MarkLuck</p>
                <p class="about-version">{{ appVersion }}</p>
                <p class="about-desc">轻量化、本地优先、离线可用的 Markdown 笔记工具。</p>
                <p class="about-desc">每一条笔记就是一个 .md 文件，数据完全由你掌控。</p>
              </div>

              <div class="setting-row" style="justify-content: center; padding-top: var(--space-8)">
                <button class="welcome-replay-btn" @click="onReplayWelcome">
                  重新观看欢迎引导
                </button>
              </div>

              <div class="about-links">
                <a
                  v-for="link in aboutLinks"
                  :key="link.url"
                  :href="link.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="about-link"
                >
                  <span class="link-icon" v-html="link.icon"></span>
                  <span>{{ link.label }}</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useThemeStore } from '@/stores/theme';

// ── Props / Emits ────────────────────────────────────────
defineProps<{ visible: boolean }>();
const emit = defineEmits<{ 'update:visible': [boolean] }>();

// ── Theme ────────────────────────────────────────────────
const theme = useThemeStore();

// ── Navigation tabs ──────────────────────────────────────
interface TabDef {
  id: 'editor' | 'appearance' | 'autosave' | 'autocomplete' | 'updates' | 'about';
  label: string;
  icon: string;
}

const tabs: TabDef[] = [
  {
    id: 'editor',
    label: '编辑器',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  },
  {
    id: 'appearance',
    label: '外观',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>',
  },
  {
    id: 'autosave',
    label: '自动保存',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>',
  },
  {
    id: 'autocomplete' as TabDef['id'],
    label: '文字补全',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/><line x1="9" y1="10" x2="15" y2="10"/><line x1="12" y1="7" x2="12" y2="13"/></svg>',
  },
  {
    id: 'updates',
    label: '更新',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  },
  {
    id: 'about',
    label: '关于',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
  },
];

const activeTab = ref<TabDef['id']>('editor');

// ── Editor settings ──────────────────────────────────────
const fontSize = ref(16);
const lineHeight = ref(1.6);
const tabSize = ref(2);
const wordWrap = ref(true);

// ── Auto-save settings ───────────────────────────────────
const autoSaveEnabled = ref(true);
const autoSaveDelay = ref(3000);

// ── Autocomplete settings ─────────────────────────────────
const AUTOCOMPLETE_KEY = 'markluck:autocomplete:enabled';
const autoCompleteEnabled = ref(localStorage.getItem(AUTOCOMPLETE_KEY) !== 'false');

watch(autoCompleteEnabled, (v: boolean) => {
  localStorage.setItem(AUTOCOMPLETE_KEY, String(v));
});

// ── Update settings ──────────────────────────────────────
const AUTO_CHECK_KEY = 'markluck:version:autoCheck';
const AUTO_INSTALL_KEY = 'markluck:version:autoInstall';
const autoCheckUpdates = ref(localStorage.getItem(AUTO_CHECK_KEY) === 'true');
const autoInstall = ref(localStorage.getItem(AUTO_INSTALL_KEY) === 'true');
// Auto-install is locked until code signing certificate is obtained
const canAutoInstall = ref(false);

watch(autoCheckUpdates, (v: boolean) => {
  localStorage.setItem(AUTO_CHECK_KEY, String(v));
  if (!v) {
    // Reset autoInstall when autoCheck is turned off
    autoInstall.value = false;
    localStorage.setItem(AUTO_INSTALL_KEY, 'false');
  }
});

watch(autoInstall, (v: boolean) => {
  localStorage.setItem(AUTO_INSTALL_KEY, String(v));
});

const checking = ref(false);
const updateStatus = ref('');
const updateHasUpdate = ref(false);

async function onCheckUpdate(): Promise<void> {
  if (checking.value) return;
  checking.value = true;
  updateStatus.value = '';
  try {
    const resp = await fetch('https://api.github.com/repos/jiay98528-dev/MarkLuck/releases/latest');
    if (!resp.ok) throw new Error('API error');
    const data = await resp.json();
    const latest = data.tag_name || data.name || '';
    // Strip 'v' prefix for consistent comparison (GitHub tags often use v0.2.0)
    const cleanVersion = (v: string) => v.replace(/^v/, '');
    const current = '0.1.0';
    if (latest && cleanVersion(latest) !== current) {
      updateStatus.value = '发现新版本 ' + latest;
      updateHasUpdate.value = true;
    } else {
      updateStatus.value = '已是最新版本';
      updateHasUpdate.value = false;
    }
  } catch {
    updateStatus.value = '检查失败，请稍后重试';
    updateHasUpdate.value = false;
  } finally {
    checking.value = false;
  }
}

// ── Welcome replay ────────────────────────────────────────
function onReplayWelcome(): void {
  localStorage.removeItem('markluck:welcome:completed');
  // Reload to show welcome page
  window.location.reload();
}

// ── About ────────────────────────────────────────────────
const appVersion = 'v0.1.0';

interface AboutLink {
  label: string;
  url: string;
  icon: string;
}

const aboutLinks: AboutLink[] = [
  {
    label: 'GitHub 仓库',
    url: 'https://github.com/jiay98528-dev/MarkLuck',
    icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>',
  },
  {
    label: '问题反馈',
    url: 'https://github.com/jiay98528-dev/MarkLuck/issues',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01"/></svg>',
  },
  {
    label: 'MIT 许可证',
    url: 'https://github.com/jiay98528-dev/MarkLuck/blob/main/LICENSE',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8M16 17H8M10 9H8"/></svg>',
  },
];

// ── Helpers ──────────────────────────────────────────────
function formatDelay(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 1 : 2)}s`;
}

function close(): void {
  emit('update:visible', false);
}
</script>

<style scoped>
/* ===== Card (width and max-height override — skeleton in dialog.css) ===== */
.modal-card {
  width: 520px;
  max-height: 70vh;
}

/* ===== Body ===== */
.modal-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

/* ===== Left Nav ===== */
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
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-8) var(--space-12);
  border: none;
  border-radius: var(--radius);
  background: none;
  color: var(--ink-secondary);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: all var(--dur-micro) var(--ease-fade);
}

.nav-item:hover {
  background: var(--surface-hover);
  color: var(--ink-primary);
}

.nav-item.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: var(--fw-medium);
}

.nav-icon {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.nav-icon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.nav-label {
  line-height: var(--lh-ui);
}

/* ===== Right Content ===== */
.settings-content {
  flex: 1;
  padding: var(--space-20);
  overflow-y: auto;
  min-width: 0;
}

.section {
  display: flex;
  flex-direction: column;
  gap: var(--space-16);
}

.section-title {
  font-size: var(--text-sm);
  font-weight: var(--fw-semibold);
  color: var(--ink-muted);
  text-transform: uppercase;
  letter-spacing: var(--ls-wide);
  margin: 0;
  padding-bottom: var(--space-8);
  border-bottom: var(--border-thin) solid var(--rule);
}

/* ===== Setting Row ===== */
.setting-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.setting-row.disabled {
  opacity: var(--opacity-disabled);
  pointer-events: none;
}

.setting-label {
  font-size: var(--text-sm);
  color: var(--ink-primary);
  line-height: var(--lh-ui);
}

.setting-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.setting-value {
  font-size: var(--text-xs);
  font-weight: var(--fw-medium);
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
  min-width: 36px;
  text-align: right;
}

/* ===== Slider ===== */
.slider {
  appearance: none;
  width: 100%;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--rule);
  outline: none;
  cursor: pointer;
}

.slider::-webkit-slider-thumb {
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: var(--radius-full);
  background: var(--accent);
  border: 2px solid var(--paper-raised);
  box-shadow: var(--shadow-sheet);
  cursor: pointer;
  transition: transform var(--dur-press) var(--ease-press);
}

.slider::-webkit-slider-thumb:hover {
  transform: scale(1.15);
}

.slider::-webkit-slider-thumb:active {
  transform: scale(0.95);
}

.slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: var(--radius-full);
  background: var(--accent);
  border: 2px solid var(--paper-raised);
  box-shadow: var(--shadow-sheet);
  cursor: pointer;
}

.slider:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ===== Segmented Button Group ===== */
.segmented {
  display: inline-flex;
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  overflow: hidden;
  align-self: flex-start;
}

.segment-btn {
  padding: 4px 14px;
  border: none;
  border-right: var(--border-thin) solid var(--rule);
  background: var(--paper-surface);
  color: var(--ink-muted);
  cursor: pointer;
  font-size: var(--text-xs);
  line-height: var(--lh-ui);
  transition: all var(--dur-press) var(--ease-press);
}

.segment-btn:last-child {
  border-right: none;
}

.segment-btn:hover {
  background: var(--surface-hover);
  color: var(--ink-secondary);
}

.segment-btn.active {
  background: var(--accent);
  color: oklch(1 0 0);
  border-color: var(--accent);
}

/* ===== Toggle Switch ===== */
.toggle-track {
  display: inline-flex;
  align-items: center;
  width: 38px;
  height: 20px;
  border-radius: var(--radius-full);
  background: var(--rule);
  cursor: pointer;
  position: relative;
  transition: background var(--dur-micro) var(--ease-fade);
  flex-shrink: 0;
  align-self: flex-start;
}

.toggle-track.active {
  background: var(--accent);
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

/* ===== About ===== */
.about-block {
  text-align: center;
  padding: var(--space-16) 0;
  border-bottom: var(--border-thin) solid var(--rule);
}

.about-name {
  font-size: var(--text-xl);
  font-weight: var(--fw-bold);
  color: var(--ink-primary);
  margin: 0 0 var(--space-4);
}

.about-version {
  font-size: var(--text-sm);
  color: var(--ink-muted);
  font-family: var(--ff-mono);
  margin: 0 0 var(--space-12);
}

.about-desc {
  font-size: var(--text-xs);
  color: var(--ink-secondary);
  margin: 0;
  line-height: var(--lh-ui);
}

.about-desc + .about-desc {
  margin-top: var(--space-4);
}

.about-links {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding-top: var(--space-8);
}

.about-link {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-8) var(--space-12);
  border-radius: var(--radius);
  text-decoration: none;
  color: var(--ink-secondary);
  font-size: var(--text-sm);
  transition: all var(--dur-micro) var(--ease-fade);
}

.about-link:hover {
  background: var(--surface-hover);
  color: var(--link);
}

.link-icon {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.link-icon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

/* Update sub-options */
.update-sub-options {
  margin-top: var(--space-8);
  padding: var(--space-12);
  background: var(--paper-surface);
  border-radius: var(--radius);
  border: var(--border-thin) solid var(--rule);
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
}

.radio-row {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  cursor: pointer;
  font-size: var(--text-sm);
  color: var(--ink-primary);
}

.radio-row.disabled {
  opacity: var(--opacity-disabled);
  cursor: not-allowed;
}

.radio-circle {
  width: 16px;
  height: 16px;
  border-radius: var(--radius-full);
  border: 2px solid var(--rule);
  flex-shrink: 0;
  transition: all var(--dur-press) var(--ease-press);
}

.radio-circle.active {
  border-color: var(--accent);
  background: var(--accent);
  box-shadow: inset 0 0 0 3px var(--paper-raised);
}

.radio-label {
  line-height: var(--lh-ui);
}

.lock-badge {
  font-size: var(--text-xs);
  color: var(--ink-muted);
  margin-left: auto;
}

.cert-notice {
  display: flex;
  align-items: flex-start;
  gap: var(--space-8);
  font-size: var(--text-xs);
  color: var(--ink-muted);
  line-height: 1.5;
  padding: var(--space-8);
  background: var(--signal-warning-soft);
  border-radius: var(--radius);
}

.check-update-btn {
  padding: var(--space-8) var(--space-16);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
  color: var(--ink-secondary);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: all var(--dur-press) var(--ease-press);
}

.check-update-btn:hover {
  background: var(--surface-hover);
  color: var(--ink-primary);
}

.update-status {
  font-size: var(--text-sm);
  color: var(--ink-muted);
}

.update-status.has-update {
  color: var(--accent);
  font-weight: var(--fw-medium);
}

.welcome-replay-btn {
  padding: var(--space-8) var(--space-20);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
  color: var(--ink-secondary);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: all var(--dur-press) var(--ease-press);
}

.welcome-replay-btn:hover {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent);
}
</style>
