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
          <h2 id="settings-dialog-title">{{ t('settings.title') }}</h2>
          <button
            class="modal-close"
            data-dialog-initial-focus
            :aria-label="t('common.close')"
            @click="close"
          >
            &times;
          </button>
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
            <section v-show="activeTab === 'general'" class="section">
              <h3 class="section-title">{{ t('settings.general.title') }}</h3>

              <div class="setting-row">
                <label class="setting-label" for="settings-language">
                  {{ t('settings.general.language') }}
                </label>
                <select
                  id="settings-language"
                  class="language-select"
                  :value="locale"
                  @change="onLocaleSelect"
                >
                  <option
                    v-for="definition in localeDefinitions"
                    :key="definition.code"
                    :value="definition.code"
                  >
                    {{ definition.nativeName }}
                  </option>
                </select>
                <p class="setting-help">{{ t('settings.general.languageHelp') }}</p>
              </div>

              <div class="setting-row association-settings">
                <div class="setting-info">
                  <span class="setting-label">{{ t('settings.general.fileOpeningTitle') }}</span>
                </div>
                <p class="setting-help">{{ t('settings.general.fileOpeningBody') }}</p>

                <p v-if="associationLoading" class="association-loading" role="status">
                  {{ t('settings.general.associationLoading') }}
                </p>
                <div v-else class="association-list" aria-live="polite">
                  <div v-for="group in associationGroups" :key="group.id" class="association-row">
                    <div class="association-copy">
                      <strong>{{ t(`settings.general.associationGroups.${group.id}`) }}</strong>
                      <small>{{ group.extensions.join(', ') }}</small>
                    </div>
                    <span class="association-state" :class="`association-state--${group.state}`">
                      {{ t(`settings.general.associationStates.${group.state}`) }}
                    </span>
                  </div>
                </div>

                <p v-if="associationError" class="association-error" role="alert">
                  {{ t('settings.general.associationFailed') }}
                </p>
                <div class="settings-actions settings-actions--left">
                  <button
                    class="segment-btn"
                    type="button"
                    :disabled="associationLoading || !desktopRuntime"
                    @click="openAssociationSettings"
                  >
                    {{ t('settings.general.associationChange') }}
                  </button>
                  <button
                    class="segment-btn"
                    type="button"
                    :disabled="associationLoading"
                    @click="refreshAssociationStatus"
                  >
                    {{ t('settings.general.associationRefresh') }}
                  </button>
                </div>
              </div>
            </section>

            <section v-show="activeTab === 'editor'" class="section">
              <h3 class="section-title">{{ t('settings.editor.title') }}</h3>

              <div class="setting-row">
                <div class="setting-info">
                  <span class="setting-label">{{ t('settings.editor.fontSize') }}</span>
                  <span class="setting-value">{{ fontSize }}px</span>
                </div>
                <input
                  v-model.number="fontSize"
                  type="range"
                  class="slider"
                  min="12"
                  max="24"
                  :aria-label="t('settings.editor.fontSize')"
                />
              </div>

              <div class="setting-row">
                <div class="setting-info">
                  <span class="setting-label">{{ t('settings.editor.lineHeight') }}</span>
                  <span class="setting-value">{{ lineHeight.toFixed(1) }}</span>
                </div>
                <input
                  v-model.number="lineHeight"
                  type="range"
                  class="slider"
                  min="1.2"
                  max="2.5"
                  step="0.1"
                  :aria-label="t('settings.editor.lineHeight')"
                />
              </div>

              <div class="setting-row">
                <span class="setting-label">{{ t('settings.editor.tabWidth') }}</span>
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
                <span class="setting-label">{{ t('settings.editor.wordWrap') }}</span>
                <span
                  class="toggle-track"
                  :class="{ active: wordWrap }"
                  role="switch"
                  tabindex="0"
                  :aria-label="t('settings.editor.wordWrap')"
                  :aria-checked="wordWrap"
                  @click="wordWrap = !wordWrap"
                  @keydown.enter.prevent="wordWrap = !wordWrap"
                  @keydown.space.prevent="wordWrap = !wordWrap"
                >
                  <span class="toggle-thumb"></span>
                </span>
              </div>
            </section>

            <section v-show="activeTab === 'autosave'" class="section">
              <h3 class="section-title">{{ t('settings.autosave.title') }}</h3>

              <div class="setting-row">
                <span class="setting-label">{{ t('settings.autosave.enabled') }}</span>
                <span
                  class="toggle-track"
                  :class="{ active: autoSaveEnabled }"
                  role="switch"
                  tabindex="0"
                  :aria-label="t('settings.autosave.enabled')"
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
                  <span class="setting-label">{{ t('settings.autosave.delay') }}</span>
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
                  :aria-label="t('settings.autosave.delay')"
                />
              </div>
            </section>

            <section v-show="activeTab === 'autocomplete'" class="section">
              <h3 class="section-title">{{ t('settings.autocomplete.title') }}</h3>

              <div class="setting-row">
                <span class="setting-label">{{ t('settings.autocomplete.enabled') }}</span>
                <span
                  class="toggle-track"
                  :class="{ active: autoCompleteEnabled }"
                  role="switch"
                  tabindex="0"
                  :aria-label="t('settings.autocomplete.enabled')"
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
                  <span class="setting-label">
                    {{ t('settings.autocomplete.backgroundTraining') }}
                  </span>
                  <span class="setting-value">{{ trainingStatusLabel }}</span>
                </div>
                <span
                  class="toggle-track"
                  :class="{ active: backgroundTraining }"
                  role="switch"
                  tabindex="0"
                  :aria-label="t('settings.autocomplete.backgroundTraining')"
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
                  <span>{{ t('settings.autocomplete.trainedFiles') }}</span>
                  <strong>{{ props.completionTrainingMeta?.fileCount ?? 0 }}</strong>
                </div>
                <div class="meta-row">
                  <span>{{ t('settings.autocomplete.lastTraining') }}</span>
                  <strong>{{ formatTrainingTime(props.completionTrainingMeta?.updatedAt) }}</strong>
                </div>
                <p class="local-note">{{ t('settings.autocomplete.localOnly') }}</p>
              </div>

              <div class="settings-actions settings-actions--left">
                <button class="segment-btn" type="button" @click="$emit('clear-completion-data')">
                  {{ t('settings.autocomplete.clearData') }}
                </button>
              </div>
            </section>

            <section v-show="activeTab === 'updates'" class="section">
              <h3 class="section-title">{{ t('settings.updates.title') }}</h3>

              <div class="setting-row">
                <span class="setting-label">{{ t('settings.updates.autoCheck') }}</span>
                <span
                  class="toggle-track"
                  :class="{ active: autoCheckUpdates }"
                  role="switch"
                  tabindex="0"
                  :aria-label="t('settings.updates.autoCheck')"
                  :aria-checked="autoCheckUpdates"
                  @click="autoCheckUpdates = !autoCheckUpdates"
                  @keydown.enter.prevent="autoCheckUpdates = !autoCheckUpdates"
                  @keydown.space.prevent="autoCheckUpdates = !autoCheckUpdates"
                >
                  <span class="toggle-thumb"></span>
                </span>
              </div>

              <div class="setting-row disabled">
                <span class="setting-label">{{ t('settings.updates.autoInstall') }}</span>
                <span class="setting-value">{{ t('settings.updates.notAvailable') }}</span>
              </div>

              <div class="settings-actions">
                <button class="segment-btn" :disabled="checking" @click="onCheckUpdate">
                  {{ checking ? t('settings.updates.checking') : t('settings.updates.checkNow') }}
                </button>
                <button class="segment-btn" @click="onReplayWelcome">
                  {{ t('settings.updates.replayWelcome') }}
                </button>
              </div>

              <p v-if="updateStatus" class="setting-help">{{ updateStatus }}</p>
            </section>

            <section v-show="activeTab === 'about'" class="section">
              <h3 class="section-title">{{ t('settings.about.title') }}</h3>
              <div class="about-card">
                <strong>JotLuck {{ appVersion }}</strong>
                <p>{{ t('settings.about.summary') }}</p>
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
import { invoke } from '@tauri-apps/api/core';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  APP_ISSUES_URL,
  APP_LICENSE_URL,
  APP_RELEASES_API_URL,
  APP_REPOSITORY_URL,
  APP_VERSION,
  APP_VERSION_LABEL,
} from '@/config/app-meta';
import {
  DEFAULT_COMPLETION_SETTINGS,
  type CompletionSettings,
} from '@/services/CompletionSettings';
import type { CompletionTrainingMeta } from '@/services/CompletionTrainingService';
import { useDialogFocus } from '@/composables/useDialogFocus';
import { requestWelcomeReplay } from '@/utils/welcome';
import { formatDate } from '@/i18n';
import { useLocale } from '@/composables/useLocale';
import type { AssociationGroupStatus, WindowsAssociationStatus } from '@/types';
import type { SupportedLocale } from '@/types/i18n';
import { isDesktopRuntime } from '@/utils/runtime';

const { t } = useI18n();
const { locale, localeDefinitions, setLocale } = useLocale();

const props = withDefaults(
  defineProps<{
    visible: boolean;
    completionSettings?: CompletionSettings;
    completionTrainingMeta?: CompletionTrainingMeta;
  }>(),
  {
    completionSettings: () => ({ ...DEFAULT_COMPLETION_SETTINGS }),
    completionTrainingMeta: undefined,
  },
);

const emit = defineEmits<{
  'update:visible': [boolean];
  'update-completion-settings': [CompletionSettings];
  'clear-completion-data': [];
}>();

interface TabDef {
  id: 'general' | 'editor' | 'autosave' | 'autocomplete' | 'updates' | 'about';
  label: string;
}

const tabs = computed<TabDef[]>(() => [
  { id: 'general', label: t('settings.tabs.general') },
  { id: 'editor', label: t('settings.tabs.editor') },
  { id: 'autosave', label: t('settings.tabs.autosave') },
  { id: 'autocomplete', label: t('settings.tabs.autocomplete') },
  { id: 'updates', label: t('settings.tabs.updates') },
  { id: 'about', label: t('settings.tabs.about') },
]);

const overlayRef = ref<HTMLDivElement | null>(null);
useDialogFocus({
  visible: () => props.visible,
  containerRef: overlayRef,
  initialFocus: '[data-dialog-initial-focus]',
});
const activeTab = ref<TabDef['id']>('general');
const desktopRuntime = isDesktopRuntime();
const associationStatus = ref<WindowsAssociationStatus | null>(null);
const associationLoading = ref(false);
const associationError = ref(false);
const unsupportedAssociationGroups: AssociationGroupStatus[] = [
  {
    id: 'markdown',
    extensions: ['.md', '.markdown', '.mdx'],
    state: 'unsupported',
    activeProgIds: [],
  },
  { id: 'text', extensions: ['.txt'], state: 'unsupported', activeProgIds: [] },
  { id: 'word', extensions: ['.docx'], state: 'unsupported', activeProgIds: [] },
  { id: 'pdf', extensions: ['.pdf'], state: 'unsupported', activeProgIds: [] },
  { id: 'excel', extensions: ['.xlsx', '.xls'], state: 'unsupported', activeProgIds: [] },
];
const associationGroups = computed(
  () => associationStatus.value?.groups ?? unsupportedAssociationGroups,
);

const fontSize = ref(16);
const lineHeight = ref(1.6);
const tabSize = ref(2);
const wordWrap = ref(true);
const autoSaveEnabled = ref(true);
const autoSaveDelay = ref(3000);

const autoCompleteEnabled = ref(props.completionSettings.enabled);
const backgroundTraining = ref(props.completionSettings.backgroundTraining);

const AUTO_CHECK_KEY = 'jotluck:version:autoCheck';
const AUTO_INSTALL_KEY = 'jotluck:version:autoInstall';
const autoCheckUpdates = ref(localStorage.getItem(AUTO_CHECK_KEY) === 'true');
const checking = ref(false);
const updateStatus = ref('');
const appVersion = APP_VERSION_LABEL;

const aboutLinks = computed(() => [
  { label: t('settings.about.repository'), url: APP_REPOSITORY_URL },
  { label: t('settings.about.issues'), url: APP_ISSUES_URL },
  {
    label: t('settings.about.license'),
    url: APP_LICENSE_URL,
  },
]);

const trainingStatusLabel = computed(() => {
  const status = props.completionTrainingMeta?.status ?? 'idle';
  if (status === 'training') return t('settings.autocomplete.status.training');
  if (status === 'partial') return t('settings.autocomplete.status.partial');
  if (status === 'error') return t('settings.autocomplete.status.error');
  if (status === 'done') return t('settings.autocomplete.status.done');
  return t('settings.autocomplete.status.idle');
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
  [() => props.visible, activeTab],
  ([visible, tab]) => {
    if (visible && tab === 'general') void refreshAssociationStatus();
  },
  { immediate: true },
);

onMounted(() => window.addEventListener('focus', refreshAssociationStatus));
onBeforeUnmount(() => window.removeEventListener('focus', refreshAssociationStatus));

function formatDelay(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 1 : 2)}s`;
}

function formatTrainingTime(value?: number): string {
  if (!value) return t('settings.autocomplete.neverTrained');
  return formatDate(value, { dateStyle: 'medium', timeStyle: 'short' });
}

function onLocaleSelect(event: Event): void {
  const selected = (event.target as HTMLSelectElement).value as SupportedLocale;
  void setLocale(selected);
}

async function refreshAssociationStatus(): Promise<void> {
  if (!props.visible || activeTab.value !== 'general') return;
  associationError.value = false;

  if (!desktopRuntime) {
    associationStatus.value = { supported: false, groups: unsupportedAssociationGroups };
    return;
  }

  associationLoading.value = true;
  try {
    associationStatus.value = await invoke<WindowsAssociationStatus>(
      'get_windows_association_status',
    );
  } catch {
    associationStatus.value = null;
    associationError.value = true;
  } finally {
    associationLoading.value = false;
  }
}

async function openAssociationSettings(): Promise<void> {
  if (!desktopRuntime || associationLoading.value) return;
  try {
    await invoke('open_jotluck_default_apps_settings');
  } catch {
    associationError.value = true;
  }
}

async function onCheckUpdate(): Promise<void> {
  if (checking.value) return;
  checking.value = true;
  updateStatus.value = '';
  try {
    const resp = await fetch(APP_RELEASES_API_URL);
    if (!resp.ok) {
      updateStatus.value = t('settings.updates.failed');
      return;
    }
    const data = await resp.json();
    const latest = data.tag_name || data.name || '';
    const current = APP_VERSION;
    const cleanVersion = (value: string) => value.replace(/^v/, '');
    updateStatus.value =
      latest && cleanVersion(latest) !== current
        ? t('settings.updates.newVersion', { version: latest })
        : t('settings.updates.latest');
  } catch {
    updateStatus.value = t('settings.updates.failed');
  } finally {
    checking.value = false;
  }
}

function onReplayWelcome(): void {
  requestWelcomeReplay();
  close();
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

.association-settings {
  padding-top: var(--space-8);
  border-top: var(--border-thin) solid var(--rule);
}

.association-list {
  display: grid;
  gap: var(--space-6);
}

.association-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-12);
  min-height: var(--touch-target-min);
  padding: var(--space-8) var(--space-10);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
}

.association-copy {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.association-copy strong {
  color: var(--ink-primary);
  font-size: var(--text-sm);
}

.association-copy small,
.association-loading,
.association-error {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--text-xs);
  line-height: var(--lh-ui);
}

.association-state {
  flex-shrink: 0;
  padding: var(--space-2) var(--space-8);
  border-radius: var(--radius-full);
  background: var(--paper-raised);
  color: var(--ink-muted);
  font-size: var(--text-xs);
  font-weight: var(--fw-medium);
}

.association-state--applied {
  background: var(--signal-success-soft);
  color: var(--signal-success);
}

.association-state--partial {
  background: var(--signal-warning-soft);
  color: var(--signal-warning);
}

.association-error {
  color: var(--signal-error);
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
  width: var(--touch-target-min);
  height: var(--touch-target-min);
  min-width: var(--touch-target-min);
  min-height: var(--touch-target-min);
  border-radius: var(--radius-full);
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
}

.toggle-track::before {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 44px;
  height: 24px;
  border-radius: var(--radius-full);
  background: var(--rule-strong);
  content: '';
  transform: translate(-50%, -50%);
}

.toggle-track.active::before {
  background: var(--accent);
}

.toggle-track:focus-visible {
  outline: var(--focus-ring-width) solid var(--accent);
  outline-offset: var(--focus-ring-offset);
}

.toggle-thumb {
  position: absolute;
  top: 12px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-full);
  background: var(--paper-raised);
  transition: transform var(--dur-micro) var(--ease-fade);
}

.toggle-track.active .toggle-thumb {
  transform: translateX(20px);
}

.slider {
  width: 100%;
}

.language-select {
  width: 100%;
  min-height: var(--touch-target-min);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  padding: 0 var(--space-12);
  background: var(--paper-raised);
  color: var(--ink-primary);
  font: inherit;
}

.language-select:focus-visible {
  outline: var(--focus-ring-width) solid var(--accent);
  outline-offset: var(--focus-ring-offset);
}

@media (width <= 720px) {
  .modal-body {
    flex-direction: column;
  }

  .settings-nav {
    width: auto;
    border-right: 0;
    border-bottom: var(--border-thin) solid var(--rule);
    flex-flow: row wrap;
  }

  .nav-item {
    min-height: var(--touch-target-min);
  }
}
</style>
