<template>
  <Teleport to="body">
    <Transition name="welcome-overlay">
      <div v-if="visible" class="welcome-overlay" @click.self="close">
        <div class="welcome-card">
          <div class="welcome-brand">
            <h1 class="welcome-brand-name">MarkLuck</h1>
            <p class="welcome-brand-sub">轻量、本地、离线</p>
          </div>

          <div class="welcome-steps" role="tablist" aria-label="引导进度">
            <template v-for="i in TOTAL_STEPS" :key="i">
              <span
                class="welcome-step-dot"
                :class="{ active: currentStep >= i }"
                role="tab"
                :aria-selected="currentStep === i"
                :aria-label="`第 ${i} 步`"
              />
              <span
                v-if="i < TOTAL_STEPS"
                class="welcome-step-line"
                :class="{ active: currentStep > i }"
              />
            </template>
          </div>

          <div class="welcome-content">
            <Transition name="step-slide" mode="out-in">
              <div v-if="currentStep === 1" class="welcome-step-body">
                <h2 class="welcome-step-title">你的笔记就是纯文本文件</h2>
                <p class="welcome-step-text">
                  每一条笔记都是本地 Markdown 或文本文件。文件夹就是笔记本，数据不被数据库锁住。
                </p>
              </div>

              <div v-else-if="currentStep === 2" class="welcome-step-body">
                <h2 class="welcome-step-title">默认工作台是羽翼布局</h2>
                <p class="welcome-step-text">
                  左侧管理最近笔记，中间专注编辑，右侧保留大纲、反链和标签。当前版本只保留这一套稳定布局。
                </p>
              </div>

              <div v-else-if="currentStep === 3" class="welcome-step-body">
                <h2 class="welcome-step-title">核心工作流已经就绪</h2>
                <p class="welcome-step-text">
                  支持即时预览、Wiki-link、模板、搜索、导出与本地自动补全，不依赖网络。
                </p>
              </div>

              <div v-else-if="currentStep === 4" class="welcome-step-body">
                <h2 class="welcome-step-title">把我设为默认编辑器？</h2>
                <p class="welcome-step-text">
                  安装版可打开 Windows 默认应用设置，由你手动把 `.md`、`.markdown`、`.mdx` 关联到
                  MarkLuck。
                </p>
                <div class="welcome-actions">
                  <Button variant="default" size="md" @click="onSetDefaultEditor">
                    打开系统设置
                  </Button>
                  <button class="welcome-link-btn" @click="nextStep">暂不设置</button>
                </div>
                <p v-if="defaultEditorNotice" class="welcome-setting-note">
                  {{ defaultEditorNotice }}
                </p>
              </div>

              <div v-else-if="currentStep === 5" class="welcome-step-body">
                <h2 class="welcome-step-title">需要自动检查新版本吗？</h2>
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
                  <p class="welcome-setting-desc">仅查询 GitHub 公开版本号，不上传任何笔记内容。</p>
                </div>
              </div>

              <div v-else class="welcome-step-body">
                <h2 class="welcome-step-title">可以开始了</h2>
                <p class="welcome-step-text">
                  打开一个本地文件夹，继续写作。后续所有设置都可以在应用内调整。
                </p>
              </div>
            </Transition>
          </div>

          <div class="welcome-footer">
            <button v-if="currentStep < TOTAL_STEPS" class="welcome-skip-link" @click="skip">
              跳过
            </button>
            <span v-else class="welcome-footer-spacer" />

            <Button variant="default" size="md" class="welcome-next-btn" @click="nextStep">
              {{ currentStep < TOTAL_STEPS ? '下一步' : '完成设置' }}
            </Button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import Button from '@/components/common/Button.vue';

defineProps<{ visible: boolean }>();
const emit = defineEmits<{ 'update:visible': [boolean]; complete: [] }>();

const WELCOME_KEY = 'markluck:welcome:completed';
const AUTO_CHECK_KEY = 'markluck:version:autoCheck';
const AUTO_INSTALL_KEY = 'markluck:version:autoInstall';
const DEFAULT_EDITOR_PROMPT_KEY = 'markluck:welcome:defaultEditorPrompted';
const TOTAL_STEPS = 6;

const currentStep = ref(1);
const autoCheckEnabled = ref(localStorage.getItem(AUTO_CHECK_KEY) === 'true');
const defaultEditorNotice = ref('');

onMounted(() => {
  if (localStorage.getItem(WELCOME_KEY) === '1') {
    emit('update:visible', false);
  }
});

function nextStep(): void {
  if (currentStep.value < TOTAL_STEPS) {
    currentStep.value += 1;
    return;
  }
  complete();
}

function skip(): void {
  complete();
}

function close(): void {
  if (localStorage.getItem(WELCOME_KEY) === '1') {
    emit('update:visible', false);
  }
}

function complete(): void {
  localStorage.setItem(WELCOME_KEY, '1');
  localStorage.setItem(AUTO_CHECK_KEY, String(autoCheckEnabled.value));
  localStorage.setItem(AUTO_INSTALL_KEY, 'false');
  emit('complete');
}

async function onSetDefaultEditor(): Promise<void> {
  localStorage.setItem(DEFAULT_EDITOR_PROMPT_KEY, '1');

  if (!window.__TAURI__) {
    defaultEditorNotice.value =
      '当前是 Web 预览环境。安装版会尝试打开 Windows 默认应用设置，最终仍需你手动选择 MarkLuck。';
    return;
  }

  try {
    await openExternal('ms-settings:defaultapps');
    defaultEditorNotice.value =
      '已打开 Windows 默认应用设置。请搜索 .md、.markdown 或 .mdx，并选择 MarkLuck。';
  } catch {
    defaultEditorNotice.value =
      '无法自动打开系统设置。请手动进入 Windows 设置 > 应用 > 默认应用，并关联 Markdown 文件。';
  }
}
</script>

<style scoped>
.welcome-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: grid;
  place-items: center;
  padding: var(--space-20);
  background: color-mix(in oklch, var(--overlay) 92%, transparent);
}

.welcome-card {
  width: min(720px, calc(100vw - 32px));
  display: flex;
  flex-direction: column;
  gap: var(--space-20);
  padding: clamp(var(--space-24), 4vw, var(--space-36));
  border: var(--border-thin) solid var(--rule);
  border-radius: calc(var(--radius) * 1.5);
  background: var(--paper-raised);
  box-shadow: var(--shadow-float);
}

.welcome-brand {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.welcome-brand-name {
  margin: 0;
  font-size: clamp(2rem, 4vw, 2.6rem);
  line-height: 1;
}

.welcome-brand-sub,
.welcome-step-text,
.welcome-setting-desc,
.welcome-setting-note {
  margin: 0;
  color: var(--ink-secondary);
  line-height: var(--lh-body);
}

.welcome-steps {
  display: flex;
  align-items: center;
  gap: var(--space-8);
}

.welcome-step-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: var(--rule);
}

.welcome-step-dot.active {
  background: var(--accent);
}

.welcome-step-line {
  flex: 1;
  height: 1px;
  background: var(--rule);
}

.welcome-step-line.active {
  background: var(--accent);
}

.welcome-content {
  min-height: 200px;
}

.welcome-step-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-16);
}

.welcome-step-title {
  margin: 0;
  font-size: var(--text-2xl);
  line-height: var(--lh-heading);
}

.welcome-actions,
.welcome-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-12);
}

.welcome-setting-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
  padding: var(--space-16);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
}

.welcome-setting-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-12);
}

.welcome-setting-label {
  color: var(--ink-primary);
  font-weight: var(--fw-medium);
}

.toggle-track {
  position: relative;
  width: 44px;
  height: 24px;
  border-radius: 999px;
  background: var(--rule-strong);
  cursor: pointer;
  transition: background-color var(--dur-micro) var(--ease-fade);
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
  border-radius: 50%;
  background: var(--paper-raised);
  transition: transform var(--dur-micro) var(--ease-fade);
}

.toggle-track.active .toggle-thumb {
  transform: translateX(20px);
}

.welcome-link-btn,
.welcome-skip-link {
  border: none;
  padding: 0;
  background: none;
  color: var(--ink-secondary);
  cursor: pointer;
}

.welcome-link-btn:hover,
.welcome-skip-link:hover {
  color: var(--accent);
}

.welcome-footer-spacer {
  flex: 1;
}

@media (width <= 720px) {
  .welcome-card {
    width: calc(100vw - 24px);
    padding: var(--space-20);
  }

  .welcome-actions,
  .welcome-footer,
  .welcome-setting-info {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
