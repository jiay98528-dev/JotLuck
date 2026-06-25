<template>
  <Teleport to="body">
    <Transition name="welcome-overlay">
      <div v-if="visible" class="welcome-overlay" @click.self="close">
        <div class="welcome-card">
          <!-- Brand -->
          <div class="welcome-brand">
            <h1 class="welcome-brand-name">MarkLuck</h1>
            <p class="welcome-brand-sub">轻量、本地、离线</p>
          </div>

          <!-- Step Indicator -->
          <div class="welcome-steps" role="tablist" aria-label="引导进度">
            <template v-for="i in 5" :key="i">
              <span
                class="welcome-step-dot"
                :class="{ active: currentStep >= i }"
                role="tab"
                :aria-selected="currentStep === i"
                :aria-label="`第 ${i} 步`"
              />
              <span v-if="i < 5" class="welcome-step-line" :class="{ active: currentStep > i }" />
            </template>
          </div>

          <!-- Content Area -->
          <div class="welcome-content">
            <Transition name="step-slide" mode="out-in">
              <!-- Step 1 -->
              <div v-if="currentStep === 1" class="welcome-step-body">
                <h2 class="welcome-step-title">不绑定工具，你的笔记永远属于你</h2>
                <p class="welcome-step-text">
                  每一条笔记就是一个 .md 纯文本文件。文件夹就是笔记本。<br />
                  用 Git 管理版本，用任何编辑器打开，用 OneDrive 同步，用 Everything 搜索。<br />
                  MarkLuck 只提供随心好用的编辑体验。
                </p>
              </div>

              <!-- Step 2 -->
              <div v-else-if="currentStep === 2" class="welcome-step-body">
                <h2 class="welcome-step-title">你的隐私永远是底线</h2>
                <p class="welcome-step-text">
                  完全离线，基于算法的文字补全。<br />
                  无需担心隐私泄露，也不受运行环境波动影响。<br />
                  它会学习你的习惯，越用越好用。
                </p>
              </div>

              <!-- Step 3 -->
              <div v-else-if="currentStep === 3" class="welcome-step-body">
                <h2 class="welcome-step-title">MarkLuck 能为你做什么？</h2>
                <p class="welcome-step-text">
                  Markdown 即时渲染，所见即所得。<br />
                  支持 [[Wiki-link]] 笔记互联、模板创建、全文搜索，沉浸写作不被打扰。<br />
                  一键导出多格式，全链路掌控你的笔记。
                </p>
              </div>

              <!-- Step 4 -->
              <div v-else-if="currentStep === 4" class="welcome-step-body">
                <h2 class="welcome-step-title">把我设为默认编辑器？</h2>
                <p class="welcome-step-text">
                  安装器会把 MarkLuck 注册为 .md/.markdown/.mdx 的可选打开程序。<br />
                  Windows 仍要求你在系统设置中手动选择默认应用。
                </p>
                <div class="welcome-step-4-actions">
                  <Button variant="default" size="md" @click="onSetDefaultEditor">
                    打开系统设置
                  </Button>
                  <button class="welcome-link-btn" @click="nextStep">暂不设置</button>
                </div>
                <p v-if="defaultEditorNotice" class="welcome-setting-note">
                  {{ defaultEditorNotice }}
                </p>
              </div>

              <!-- Step 5 -->
              <div v-else-if="currentStep === 5" class="welcome-step-body">
                <h2 class="welcome-step-title">需要我保持最新版本么？</h2>

                <!-- Auto-check toggle -->
                <div class="welcome-setting-row">
                  <div class="welcome-setting-info">
                    <span class="welcome-setting-label">自动检查可用更新</span>
                    <span
                      class="toggle-track"
                      :class="{ active: autoCheckEnabled }"
                      @click="autoCheckEnabled = !autoCheckEnabled"
                    >
                      <span class="toggle-thumb" />
                    </span>
                  </div>
                  <p class="welcome-setting-desc">
                    仅查询 GitHub 公开版本号，不上传任何数据。随时可在设置中关闭。
                  </p>
                </div>

                <!-- Sub-options (visible when toggle ON) -->
                <Transition name="expand">
                  <div v-if="autoCheckEnabled" class="welcome-sub-options">
                    <label class="welcome-radio-row">
                      <span class="welcome-radio" :class="{ checked: !autoInstallEnabled }">
                        <span v-if="!autoInstallEnabled" class="welcome-radio-dot" />
                      </span>
                      <span class="welcome-radio-label">仅提醒新版本可用</span>
                    </label>

                    <label class="welcome-radio-row welcome-radio-row--locked">
                      <span class="welcome-radio locked">
                        <span class="welcome-lock-icon">&#128274;</span>
                      </span>
                      <span class="welcome-radio-label">
                        自动下载并安装
                        <span class="welcome-radio-muted">（暂不可用）</span>
                      </span>
                    </label>
                    <p class="welcome-lock-explanation">
                      当前为先行版，暂未获得代码签名证书。证书就位后开放。
                    </p>
                  </div>
                </Transition>
              </div>
            </Transition>
          </div>

          <!-- Bottom Action Bar -->
          <div class="welcome-footer">
            <button v-if="currentStep < 5" class="welcome-skip-link" @click="skip">跳过</button>
            <span v-else class="welcome-footer-spacer" />

            <Button variant="default" size="md" class="welcome-next-btn" @click="nextStep">
              {{ currentStep < 5 ? '下一步' : '完成设置' }}
            </Button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import Button from '@/components/common/Button.vue';

// ── Props / Emits ──────────────────────────────────────────
defineProps<{ visible: boolean }>();
const emit = defineEmits<{ 'update:visible': [boolean]; complete: [] }>();

// ── State ──────────────────────────────────────────────────
const WELCOME_KEY = 'markluck:welcome:completed';
const AUTO_CHECK_KEY = 'markluck:version:autoCheck';
const AUTO_INSTALL_KEY = 'markluck:version:autoInstall';
const DEFAULT_EDITOR_PROMPT_KEY = 'markluck:welcome:defaultEditorPrompted';

const currentStep = ref(1);
const autoCheckEnabled = ref(localStorage.getItem(AUTO_CHECK_KEY) === 'true');
const autoInstallEnabled = ref(localStorage.getItem(AUTO_INSTALL_KEY) === 'true');
const defaultEditorNotice = ref('');

// ── Lifecycle ──────────────────────────────────────────────
onMounted(() => {
  if (localStorage.getItem(WELCOME_KEY) === '1') {
    emit('update:visible', false);
  }
});

// ── Actions ────────────────────────────────────────────────
function nextStep(): void {
  if (currentStep.value < 5) {
    currentStep.value++;
    return;
  }
  complete();
}

function skip(): void {
  complete();
}

function close(): void {
  // Overlay click closes only if already completed
  if (localStorage.getItem(WELCOME_KEY) === '1') {
    emit('update:visible', false);
  }
}

function complete(): void {
  localStorage.setItem(WELCOME_KEY, '1');
  localStorage.setItem(AUTO_CHECK_KEY, String(autoCheckEnabled.value));
  localStorage.setItem(AUTO_INSTALL_KEY, String(autoInstallEnabled.value));
  emit('complete');
}

async function onSetDefaultEditor(): Promise<void> {
  localStorage.setItem(DEFAULT_EDITOR_PROMPT_KEY, '1');
  defaultEditorNotice.value =
    '已为你打开 Windows 默认应用设置。请搜索 .md、.markdown 或 .mdx，并选择 MarkLuck 作为默认应用。';

  if (!window.__TAURI__) {
    defaultEditorNotice.value =
      '当前是 Web 预览环境。安装版会打开 Windows 默认应用设置，默认应用需要你手动选择 MarkLuck。';
    return;
  }

  try {
    await openExternal('ms-settings:defaultapps');
  } catch (e) {
    defaultEditorNotice.value =
      '无法自动打开系统设置。请手动进入 Windows 设置 > 应用 > 默认应用，搜索 .md、.markdown 或 .mdx 后选择 MarkLuck。';
    // eslint-disable-next-line no-console
    console.warn('[WelcomePage] 打开 Windows 默认应用设置失败:', e);
  }
}
</script>

<style scoped>
/* ============================================================
 * WelcomePage — Onboarding Wizard (Paper Metaphor)
 *
 * Teleported modal overlay with 5-step guided setup.
 * All colors via CSS variables (tokens.css + paper.css).
 * ============================================================ */

/* ===== Overlay ===== */
.welcome-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: var(--overlay);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ===== Overlay Transition ===== */
.welcome-overlay-enter-active {
  transition: opacity var(--dur-page) var(--ease-fade);
}

.welcome-overlay-leave-active {
  transition: opacity var(--dur-collapse) var(--ease-exit);
}

.welcome-overlay-enter-from,
.welcome-overlay-leave-to {
  opacity: 0;
}

/* ===== Card ===== */
.welcome-card {
  width: 480px;
  max-width: calc(100vw - var(--space-32));
  max-height: 85vh;
  background: var(--paper-raised);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-wing-float);
  display: flex;
  flex-direction: column;
  animation: welcome-card-in var(--dur-page) var(--ease-enter);
}

@keyframes welcome-card-in {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(8px);
  }

  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

/* ===== Brand ===== */
.welcome-brand {
  text-align: center;
  padding: var(--space-32) var(--space-24) var(--space-16);
}

.welcome-brand-name {
  font-size: var(--text-2xl);
  font-weight: var(--fw-bold);
  color: var(--ink-primary);
  margin: 0 0 var(--space-4);
  letter-spacing: var(--ls-tight);
  line-height: var(--lh-heading);
}

.welcome-brand-sub {
  font-size: var(--text-sm);
  color: var(--ink-muted);
  margin: 0;
  line-height: var(--lh-ui);
}

/* ===== Step Indicator ===== */
.welcome-steps {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  padding: 0 var(--space-24) var(--space-20);
}

.welcome-step-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--rule);
  flex-shrink: 0;
  transition:
    background var(--dur-expand) var(--ease-enter),
    transform var(--dur-expand) var(--ease-enter);
}

.welcome-step-dot.active {
  background: var(--accent);
  transform: scale(1.25);
}

.welcome-step-line {
  width: 32px;
  height: 2px;
  background: var(--rule);
  flex-shrink: 0;
  transition: background var(--dur-expand) var(--ease-enter);
}

.welcome-step-line.active {
  background: var(--accent);
}

/* ===== Content Area ===== */
.welcome-content {
  flex: 1;
  min-height: 200px;
  padding: 0 var(--space-24);
  overflow-y: auto;
}

/* ===== Step Transition: slide + fade ===== */
.step-slide-enter-active {
  transition:
    opacity var(--dur-page) var(--ease-enter),
    transform var(--dur-page) var(--ease-enter);
}

.step-slide-leave-active {
  transition:
    opacity var(--dur-collapse) var(--ease-exit),
    transform var(--dur-collapse) var(--ease-exit);
  position: absolute;
}

.step-slide-enter-from {
  opacity: 0;
  transform: translateX(24px);
}

.step-slide-leave-to {
  opacity: 0;
  transform: translateX(-24px);
}

/* ===== Step Body ===== */
.welcome-step-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--space-12);
}

.welcome-step-title {
  font-size: var(--text-lg);
  font-weight: var(--fw-semibold);
  color: var(--ink-primary);
  margin: 0;
  line-height: var(--lh-heading);
}

.welcome-step-text {
  font-size: var(--text-sm);
  color: var(--ink-secondary);
  margin: 0;
  line-height: var(--lh-body);
  max-width: 400px;
}

/* ===== Step 4: Action Buttons ===== */
.welcome-step-4-actions {
  display: flex;
  align-items: center;
  gap: var(--space-12);
  margin-top: var(--space-8);
}

.welcome-link-btn {
  background: none;
  border: none;
  color: var(--ink-muted);
  font-size: var(--text-sm);
  cursor: pointer;
  padding: var(--space-4) var(--space-8);
  border-radius: var(--radius);
  transition:
    color var(--dur-micro) var(--ease-fade),
    background var(--dur-micro) var(--ease-fade);
}

.welcome-link-btn:hover {
  color: var(--ink-primary);
  background: var(--surface-hover);
}

.welcome-setting-note {
  max-width: 400px;
  margin: var(--space-8) 0 0;
  color: var(--ink-secondary);
  font-size: var(--text-xs);
  line-height: var(--lh-body);
}

/* ===== Step 5: Version Settings ===== */
.welcome-setting-row {
  width: 100%;
  text-align: left;
}

.welcome-setting-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-8) 0;
}

.welcome-setting-label {
  font-size: var(--text-sm);
  color: var(--ink-primary);
  line-height: var(--lh-ui);
}

.welcome-setting-desc {
  font-size: var(--text-xs);
  color: var(--ink-muted);
  margin: 0;
  line-height: var(--lh-ui);
}

/* ===== Sub-options Expand Transition ===== */
.expand-enter-active {
  transition:
    opacity var(--dur-expand) var(--ease-enter),
    max-height var(--dur-expand) var(--ease-enter);
  overflow: hidden;
}

.expand-leave-active {
  transition:
    opacity var(--dur-collapse) var(--ease-exit),
    max-height var(--dur-collapse) var(--ease-exit);
  overflow: hidden;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  max-height: 0;
}

.expand-enter-to,
.expand-leave-from {
  opacity: 1;
  max-height: 200px;
}

.welcome-sub-options {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  padding: var(--space-12) 0 0 var(--space-4);
  border-top: var(--border-thin) solid var(--rule);
  margin-top: var(--space-8);
}

/* ===== Radio Rows ===== */
.welcome-radio-row {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  cursor: pointer;
  padding: var(--space-4) 0;
}

.welcome-radio-row--locked {
  cursor: not-allowed;
  opacity: var(--opacity-disabled);
}

.welcome-radio {
  width: 18px;
  height: 18px;
  border-radius: var(--radius-full);
  border: 2px solid var(--rule);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: border-color var(--dur-micro) var(--ease-fade);
}

.welcome-radio.checked {
  border-color: var(--accent);
}

.welcome-radio.locked {
  border-color: var(--rule);
  background: var(--surface-hover);
}

.welcome-radio-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--accent);
}

.welcome-lock-icon {
  font-size: 10px;
  line-height: 1;
}

.welcome-radio-label {
  font-size: var(--text-sm);
  color: var(--ink-primary);
  line-height: var(--lh-ui);
}

.welcome-radio-muted {
  color: var(--ink-muted);
  font-size: var(--text-xs);
}

.welcome-lock-explanation {
  font-size: var(--text-xs);
  color: var(--ink-muted);
  margin: 0;
  line-height: var(--lh-ui);
  font-style: italic;
}

/* ===== Toggle Switch (matches SettingsDialog.vue) ===== */
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

/* ===== Footer ===== */
.welcome-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-16) var(--space-24) var(--space-20);
  border-top: var(--border-thin) solid var(--rule);
  flex-shrink: 0;
}

.welcome-skip-link {
  background: none;
  border: none;
  color: var(--ink-muted);
  font-size: var(--text-sm);
  cursor: pointer;
  padding: var(--space-4) var(--space-8);
  border-radius: var(--radius);
  transition:
    color var(--dur-micro) var(--ease-fade),
    background var(--dur-micro) var(--ease-fade);
}

.welcome-skip-link:hover {
  color: var(--ink-primary);
  background: var(--surface-hover);
}

.welcome-footer-spacer {
  flex: 1;
}

/* ===== Reduced Motion ===== */
@media (prefers-reduced-motion: reduce) {
  .welcome-card {
    animation: none;
  }

  .welcome-overlay-enter-active,
  .welcome-overlay-leave-active,
  .step-slide-enter-active,
  .step-slide-leave-active,
  .expand-enter-active,
  .expand-leave-active {
    transition-duration: 0.01ms !important;
  }

  .toggle-thumb {
    transition-duration: 0.01ms !important;
  }
}
</style>
