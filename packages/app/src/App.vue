<template>
  <div id="jotluck-app">
    <router-view />
    <WelcomePage
      :visible="welcomeVisible && route.name === 'workspace'"
      @update:visible="welcomeVisible = $event"
      @complete="welcomeVisible = false"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import WelcomePage from '@/pages/WelcomePage.vue';
import { WELCOME_REPLAY_EVENT, hasCompletedWelcome } from '@/utils/welcome';

const route = useRoute();
const welcomeVisible = ref(!hasCompletedWelcome());

function replayWelcome(): void {
  welcomeVisible.value = true;
}

onMounted(() => window.addEventListener(WELCOME_REPLAY_EVENT, replayWelcome));
onUnmounted(() => window.removeEventListener(WELCOME_REPLAY_EVENT, replayWelcome));
</script>
