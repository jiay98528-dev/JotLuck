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
import { ref, onMounted } from 'vue';
import WelcomePage from '@/pages/WelcomePage.vue';

const WELCOME_KEY = 'markluck:welcome:completed';
const showWelcome = ref(false);

onMounted(() => {
  if (localStorage.getItem(WELCOME_KEY) !== '1') {
    showWelcome.value = true;
  }
});

function onWelcomeComplete() {
  localStorage.setItem(WELCOME_KEY, '1');
  showWelcome.value = false;
}
</script>
