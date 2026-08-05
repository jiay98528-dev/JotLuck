<template>
  <section
    ref="gateRef"
    class="notebook-open-gate"
    :aria-busy="status === 'opening'"
    aria-labelledby="notebook-open-gate-title"
    data-testid="notebook-open-gate"
  >
    <div class="notebook-open-gate__content">
      <span class="notebook-open-gate__kicker">{{ t('workspace.gate.kicker') }}</span>
      <h1 id="notebook-open-gate-title" class="notebook-open-gate__title">
        {{ t('workspace.gate.title') }}
      </h1>
      <p class="notebook-open-gate__description">
        {{ t('workspace.gate.description') }}
      </p>
      <p class="notebook-open-gate__formats">
        {{ t('workspace.gate.formats', { formats: formatsLabel }) }}
      </p>

      <p v-if="status === 'error' && errorMessage" class="notebook-open-gate__error" role="alert">
        {{ errorMessage }}
      </p>

      <Button
        class="notebook-open-gate__action"
        size="lg"
        :loading="status === 'opening'"
        data-testid="open-notebook-button"
        @click="$emit('open-notebook')"
      >
        {{ status === 'opening' ? t('workspace.gate.opening') : t('workspace.gate.choose') }}
      </Button>

      <p class="notebook-open-gate__shortcut">
        {{ t('workspace.gate.shortcut') }}
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import Button from '@/components/common/Button.vue';

const { t } = useI18n();

export type NotebookOpenGateStatus = 'idle' | 'opening' | 'error';

const props = defineProps<{
  status: NotebookOpenGateStatus;
  errorMessage: string | null;
  formatsLabel: string;
}>();

defineEmits<{
  'open-notebook': [];
}>();

const gateRef = ref<HTMLElement | null>(null);

async function focusPrimary(): Promise<void> {
  await nextTick();
  gateRef.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
}

onMounted(() => void focusPrimary());
watch(
  () => props.status,
  (status, previousStatus) => {
    if (status !== 'opening' && status !== previousStatus) void focusPrimary();
  },
);

defineExpose({ focusPrimary });
</script>

<style scoped>
.notebook-open-gate {
  display: grid;
  min-height: 100%;
  place-items: center;
  overflow: auto;
  padding: clamp(var(--space-32), 12vh, var(--space-120)) var(--space-24);
  background: var(--paper-bg);
  color: var(--ink-primary);
}

.notebook-open-gate__content {
  width: min(100%, var(--editor-max-width));
  padding-block: var(--space-32);
  border-block: var(--border-thin) solid var(--rule);
  text-align: center;
}

.notebook-open-gate__kicker {
  display: block;
  color: var(--ink-muted);
  font-size: var(--text-xs);
  font-weight: var(--fw-medium);
  line-height: var(--lh-ui);
  letter-spacing: var(--ls-wide);
}

.notebook-open-gate__title {
  margin: var(--space-16) 0 0;
  color: var(--ink-primary);
  font-size: clamp(var(--text-xl), 6vw, var(--text-hero));
  font-weight: var(--fw-semibold);
  line-height: var(--lh-heading);
  letter-spacing: var(--ls-tight);
}

.notebook-open-gate__description {
  max-width: 46ch;
  margin: var(--space-16) auto 0;
  color: var(--ink-secondary);
  font-size: var(--text-base);
  line-height: var(--lh-body);
}

.notebook-open-gate__formats,
.notebook-open-gate__shortcut {
  margin: var(--space-8) 0 0;
  color: var(--ink-muted);
  font-size: var(--text-xs);
  line-height: var(--lh-ui);
}

.notebook-open-gate__error {
  max-width: 52ch;
  margin: var(--space-20) auto 0;
  padding: var(--space-10) var(--space-12);
  border: var(--border-thin) solid var(--signal-error);
  border-radius: var(--radius);
  background: var(--signal-error-soft);
  color: var(--signal-error);
  font-size: var(--text-sm);
  line-height: var(--lh-ui);
  text-align: start;
}

.notebook-open-gate__action {
  margin-top: var(--space-24);
}

.notebook-open-gate__shortcut {
  margin-top: var(--space-12);
}

.notebook-open-gate__shortcut kbd {
  font-family: var(--ff-mono);
  font-size: inherit;
}

@media (width <= 640px) {
  .notebook-open-gate {
    place-items: start center;
    padding-inline: var(--space-16);
  }

  .notebook-open-gate__content {
    padding-block: var(--space-24);
  }

  .notebook-open-gate__action {
    width: 100%;
  }
}
</style>
