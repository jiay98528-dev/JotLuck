<template>
  <div id="markluck-app">
    <router-view />
    <WelcomePage
      :visible="showWelcome"
      @update:visible="showWelcome = $event"
      @complete="onWelcomeComplete"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import WelcomePage from '@/pages/WelcomePage.vue';

const WELCOME_KEY = 'markluck:welcome:completed';
const showWelcome = ref(false);

async function hasPendingOpenedFile(): Promise<boolean> {
  if (window.__markluck_mockOpenedFile) return true;
  if (!window.__TAURI__) return false;
  try {
    return !!(await invoke('get_opened_file'));
  } catch {
    return false;
  }
}

function hideWelcomeForExternalFile() {
  showWelcome.value = false;
}

onMounted(async () => {
  window.addEventListener('markluck:external-file-opened', hideWelcomeForExternalFile);
  if (await hasPendingOpenedFile()) return;
  if (localStorage.getItem(WELCOME_KEY) !== '1') {
    showWelcome.value = true;
  }
});

onUnmounted(() => {
  window.removeEventListener('markluck:external-file-opened', hideWelcomeForExternalFile);
});

function onWelcomeComplete() {
  localStorage.setItem(WELCOME_KEY, '1');
  showWelcome.value = false;
}
</script>
