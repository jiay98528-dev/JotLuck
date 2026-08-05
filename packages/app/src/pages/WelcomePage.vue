<template>
  <Teleport to="body">
    <Transition name="welcome-overlay">
      <div v-if="visible" class="welcome-overlay" @click.self="close">
        <div
          ref="overlayRef"
          class="welcome-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="welcome-title"
          tabindex="-1"
          @keydown.escape.prevent.stop="skip"
        >
          <div class="welcome-brand">
            <h1 id="welcome-title" class="welcome-brand-name">JotLuck</h1>
            <p class="welcome-brand-sub">{{ t('welcome.tagline') }}</p>
          </div>

          <div class="welcome-steps" role="tablist" :aria-label="t('welcome.progress')">
            <template v-for="i in TOTAL_STEPS" :key="i">
              <span
                class="welcome-step-dot"
                :class="{ active: currentStep >= i }"
                role="tab"
                :aria-selected="currentStep === i"
                :aria-label="t('welcome.stepAria', { step: i })"
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
                <h2 class="welcome-step-title">{{ t('welcome.plainTitle') }}</h2>
                <p class="welcome-step-text">{{ t('welcome.plainBody') }}</p>
              </div>

              <div v-else-if="currentStep === 2" class="welcome-step-body">
                <h2 class="welcome-step-title">{{ t('welcome.workspaceTitle') }}</h2>
                <p class="welcome-step-text">{{ t('welcome.workspaceBody') }}</p>
              </div>

              <div v-else-if="currentStep === 3" class="welcome-step-body">
                <h2 class="welcome-step-title">{{ t('welcome.workflowTitle') }}</h2>
                <p class="welcome-step-text">{{ t('welcome.workflowBody') }}</p>
              </div>

              <div v-else-if="currentStep === 4" class="welcome-step-body">
                <h2 class="welcome-step-title">{{ t('welcome.defaultEditorTitle') }}</h2>
                <p class="welcome-step-text">{{ t('welcome.defaultEditorBody') }}</p>
                <fieldset class="welcome-association-summary">
                  <legend class="welcome-association-legend">
                    {{ t('welcome.associationSelectionLegend') }}
                  </legend>
                  <div
                    class="welcome-association-list"
                    aria-live="polite"
                    :aria-busy="associationStatusPending"
                  >
                    <label
                      v-for="group in associationGroups"
                      :key="group.id"
                      class="welcome-association-row"
                      :class="{
                        'welcome-association-row--selected': selectedAssociationGroups[group.id],
                      }"
                    >
                      <input
                        v-model="selectedAssociationGroups[group.id]"
                        class="welcome-association-checkbox"
                        type="checkbox"
                        :data-association-id="group.id"
                        :aria-describedby="`welcome-association-${group.id}-extensions welcome-association-${group.id}-status`"
                      />
                      <span class="welcome-association-copy">
                        <strong>{{ t(`settings.general.associationGroups.${group.id}`) }}</strong>
                        <small :id="`welcome-association-${group.id}-extensions`">
                          {{ group.extensions.join(', ') }}
                        </small>
                      </span>
                      <span
                        :id="`welcome-association-${group.id}-status`"
                        class="welcome-association-state"
                        :class="`welcome-association-state--${group.state}`"
                      >
                        {{ t(`settings.general.associationStates.${group.state}`) }}
                      </span>
                    </label>
                  </div>
                </fieldset>
                <p v-if="associationStatusPending" class="welcome-setting-note" role="status">
                  {{ t('settings.general.associationLoading') }}
                </p>
                <p v-else-if="associationStatusError" class="welcome-setting-note" role="alert">
                  {{ t('settings.general.associationFailed') }}
                </p>
                <div class="welcome-actions">
                  <Button
                    variant="default"
                    size="md"
                    :loading="associationPending"
                    @click="onSetDefaultEditor"
                  >
                    {{ associationActionLabel }}
                  </Button>
                  <button class="welcome-link-btn" @click="nextStep">
                    {{ t('welcome.notNow') }}
                  </button>
                </div>
                <p v-if="defaultEditorNotice" class="welcome-setting-note">
                  {{ defaultEditorNotice }}
                </p>
              </div>

              <div v-else-if="currentStep === 5" class="welcome-step-body">
                <h2 class="welcome-step-title">{{ t('welcome.updatesTitle') }}</h2>
                <div class="welcome-setting-row">
                  <div class="welcome-setting-info">
                    <span class="welcome-setting-label">{{ t('welcome.autoCheck') }}</span>
                    <button
                      class="toggle-track"
                      :class="{ active: autoCheckEnabled }"
                      type="button"
                      role="switch"
                      :aria-checked="autoCheckEnabled"
                      @click="autoCheckEnabled = !autoCheckEnabled"
                    >
                      <span class="toggle-thumb" />
                    </button>
                  </div>
                  <p class="welcome-setting-desc">{{ t('welcome.autoCheckBody') }}</p>
                </div>
              </div>

              <div v-else class="welcome-step-body">
                <h2 class="welcome-step-title">{{ t('welcome.readyTitle') }}</h2>
                <p class="welcome-step-text">{{ t('welcome.readyBody') }}</p>
              </div>
            </Transition>
          </div>

          <div class="welcome-footer">
            <button v-if="currentStep < TOTAL_STEPS" class="welcome-skip-link" @click="skip">
              {{ t('welcome.skip') }}
            </button>
            <span v-else class="welcome-footer-spacer" />

            <Button
              variant="default"
              size="md"
              class="welcome-next-btn"
              data-dialog-initial-focus
              @click="nextStep"
            >
              {{ currentStep < TOTAL_STEPS ? t('common.next') : t('welcome.finish') }}
            </Button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import Button from '@/components/common/Button.vue';
import { useDialogFocus } from '@/composables/useDialogFocus';
import { isDesktopRuntime } from '@/utils/runtime';
import { hasCompletedWelcome, markWelcomeCompleted } from '@/utils/welcome';
import { useI18n } from 'vue-i18n';
import type { AssociationGroupStatus, WindowsAssociationStatus } from '@/types';

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ 'update:visible': [boolean]; complete: [] }>();
const { t } = useI18n();

const AUTO_CHECK_KEY = 'jotluck:version:autoCheck';
const AUTO_INSTALL_KEY = 'jotluck:version:autoInstall';
const DEFAULT_EDITOR_PROMPT_KEY = 'jotluck:welcome:defaultEditorPrompted';
const TOTAL_STEPS = 6;

const currentStep = ref(1);
const autoCheckEnabled = ref(localStorage.getItem(AUTO_CHECK_KEY) === 'true');
type DefaultEditorNotice = '' | 'webPreview' | 'settingsOpened' | 'settingsFailed';
type AssociationGroupId = AssociationGroupStatus['id'];
const associationGroupDefinitions: Array<Pick<AssociationGroupStatus, 'id' | 'extensions'>> = [
  { id: 'markdown', extensions: ['.md', '.markdown', '.mdx'] },
  { id: 'text', extensions: ['.txt'] },
  { id: 'word', extensions: ['.docx'] },
  { id: 'pdf', extensions: ['.pdf'] },
  { id: 'excel', extensions: ['.xlsx', '.xls'] },
];

function defaultAssociationSelections(): Record<AssociationGroupId, boolean> {
  return {
    markdown: true,
    text: false,
    word: false,
    pdf: false,
    excel: false,
  };
}

const defaultEditorNoticeKind = ref<DefaultEditorNotice>('');
const associationStatus = ref<WindowsAssociationStatus | null>(null);
const associationPending = ref(false);
const associationStatusPending = ref(false);
const associationStatusError = ref(false);
const selectedAssociationGroups = ref<Record<AssociationGroupId, boolean>>(
  defaultAssociationSelections(),
);
const associationGroups = computed<AssociationGroupStatus[]>(() => {
  const realGroups = new Map(associationStatus.value?.groups.map((group) => [group.id, group]));
  return associationGroupDefinitions.map(
    (definition) =>
      realGroups.get(definition.id) ?? {
        ...definition,
        state: 'unsupported',
        activeProgIds: [],
      },
  );
});
const hasIncompleteSelectedAssociations = computed(() => {
  return associationGroups.value.some(
    (group) => selectedAssociationGroups.value[group.id] && group.state !== 'applied',
  );
});
const associationActionLabel = computed(() => {
  if (
    defaultEditorNoticeKind.value === 'settingsOpened' &&
    hasIncompleteSelectedAssociations.value
  ) {
    return t('welcome.continueSystemSettings');
  }
  return t('welcome.openSystemSettings');
});
const defaultEditorNotice = computed(() => {
  switch (defaultEditorNoticeKind.value) {
    case 'webPreview':
      return t('welcome.webPreview');
    case 'settingsOpened':
      return t('welcome.settingsOpened');
    case 'settingsFailed':
      return t('welcome.settingsFailed');
    default:
      return '';
  }
});
const overlayRef = ref<HTMLDivElement | null>(null);

useDialogFocus({
  visible: () => props.visible,
  containerRef: overlayRef,
  initialFocus: '[data-dialog-initial-focus]',
  fallbackFocus: () => document.querySelector<HTMLElement>('[data-testid="open-notebook-button"]'),
});

onMounted(() => {
  window.addEventListener('focus', refreshAssociationStatus);
  if (hasCompletedWelcome()) {
    emit('update:visible', false);
  }
});

onBeforeUnmount(() => window.removeEventListener('focus', refreshAssociationStatus));

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return;
    currentStep.value = 1;
    autoCheckEnabled.value = localStorage.getItem(AUTO_CHECK_KEY) === 'true';
    defaultEditorNoticeKind.value = '';
    selectedAssociationGroups.value = defaultAssociationSelections();
    void refreshAssociationStatus();
  },
);

watch(currentStep, (step) => {
  if (step === 4) void refreshAssociationStatus();
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
  skip();
}

function complete(): void {
  markWelcomeCompleted();
  localStorage.setItem(AUTO_CHECK_KEY, String(autoCheckEnabled.value));
  localStorage.setItem(AUTO_INSTALL_KEY, 'false');
  emit('update:visible', false);
  emit('complete');
}

async function onSetDefaultEditor(): Promise<void> {
  localStorage.setItem(DEFAULT_EDITOR_PROMPT_KEY, '1');

  if (!isDesktopRuntime()) {
    defaultEditorNoticeKind.value = 'webPreview';
    return;
  }

  try {
    associationPending.value = true;
    await invoke('open_jotluck_default_apps_settings');
    defaultEditorNoticeKind.value = 'settingsOpened';
  } catch {
    defaultEditorNoticeKind.value = 'settingsFailed';
  } finally {
    associationPending.value = false;
  }
}

async function refreshAssociationStatus(): Promise<void> {
  if (!props.visible || currentStep.value !== 4) return;
  associationStatusError.value = false;

  if (!isDesktopRuntime()) {
    associationStatus.value = null;
    return;
  }

  associationStatusPending.value = true;
  try {
    associationStatus.value = await invoke<WindowsAssociationStatus>(
      'get_windows_association_status',
    );
  } catch {
    associationStatus.value = null;
    associationStatusError.value = true;
  } finally {
    associationStatusPending.value = false;
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
  max-height: calc(100dvh - var(--space-40));
  display: flex;
  flex-direction: column;
  gap: var(--space-20);
  overflow-y: auto;
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
  font-size: var(--text-hero);
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

.welcome-association-summary {
  min-inline-size: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.welcome-association-legend {
  margin-block-end: var(--space-8);
  color: var(--ink-secondary);
  font-size: var(--text-sm);
  font-weight: var(--fw-medium);
}

.welcome-association-list {
  display: grid;
  overflow: hidden;
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
}

.welcome-association-row {
  display: grid;
  grid-template-columns: var(--touch-target-min) minmax(0, 1fr) auto;
  gap: var(--space-8);
  align-items: center;
  min-height: var(--touch-target-min);
  padding: var(--space-6) var(--space-12) var(--space-6) 0;
  background: var(--paper-surface);
  cursor: pointer;
  transition: background-color var(--dur-micro) var(--ease-fade);
}

.welcome-association-row + .welcome-association-row {
  border-top: var(--border-thin) solid var(--rule);
}

.welcome-association-row--selected {
  background: var(--accent-soft);
}

.welcome-association-checkbox {
  inline-size: var(--space-16);
  block-size: var(--space-16);
  margin: 0;
  justify-self: center;
  accent-color: var(--accent);
}

.welcome-association-checkbox:focus-visible {
  outline: var(--focus-ring-width) solid var(--accent);
  outline-offset: var(--focus-ring-offset);
}

.welcome-association-copy {
  display: grid;
  gap: var(--space-4);
  min-width: 0;
}

.welcome-association-copy strong {
  color: var(--ink-primary);
  font-size: var(--text-sm);
}

.welcome-association-copy small {
  overflow: hidden;
  color: var(--ink-secondary);
  line-height: var(--lh-ui);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.welcome-association-state {
  justify-self: end;
  padding: var(--space-4) var(--space-8);
  border-radius: 999px;
  background: var(--rule);
  color: var(--ink-secondary);
  font-size: var(--text-xs);
  font-weight: var(--fw-medium);
  white-space: nowrap;
}

.welcome-association-state--applied {
  background: var(--accent-soft);
  color: var(--accent);
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
  width: var(--touch-target-min);
  height: var(--touch-target-min);
  padding: 0;
  border: none;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
}

.toggle-track::before {
  content: '';
  position: absolute;
  inset: 10px 0;
  border-radius: 999px;
  background: var(--rule-strong);
  transition: background-color var(--dur-micro) var(--ease-fade);
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

  .welcome-association-row {
    grid-template-columns: var(--touch-target-min) minmax(0, 1fr);
  }

  .welcome-association-state {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
