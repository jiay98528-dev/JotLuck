<template>
  <main class="bootstrap-page" aria-busy="true" aria-live="polite">
    <span class="bootstrap-page__mark" aria-hidden="true" />
    <span>{{ t('notebook.startup.opening') }}</span>
  </main>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import type { WindowBootstrapPayload } from '@/types';
import { isDesktopRuntime } from '@/utils/runtime';

const router = useRouter();
const { t } = useI18n();

onMounted(async () => {
  if (!isDesktopRuntime()) {
    await router.replace('/workspace');
    return;
  }

  try {
    const bootstrap = await invoke<WindowBootstrapPayload>('get_window_bootstrap');
    await router.replace(
      bootstrap.mode === 'external-readonly' || bootstrap.mode === 'document-import-readonly'
        ? '/reader'
        : '/workspace',
    );
  } catch {
    // A failed bootstrap must still leave users with the normal workspace.
    await router.replace('/workspace');
  }
});
</script>

<style scoped>
.bootstrap-page {
  display: grid;
  min-height: 100vh;
  place-content: center;
  gap: var(--space-8);
  color: var(--ink-secondary);
  font-size: var(--text-sm);
}

.bootstrap-page__mark {
  width: var(--space-8);
  height: var(--space-8);
  margin-inline: auto;
  border: var(--border-thin) solid var(--rule-strong);
  border-radius: 50%;
}
</style>
