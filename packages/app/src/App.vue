<template>
  <div id="jotluck-app">
    <router-view />
    <WelcomePage
      :visible="welcomeVisible && route.name === 'workspace'"
      @update:visible="welcomeVisible = $event"
      @complete="welcomeVisible = false"
    />
    <!-- 全局 Toast 单挂载点：Toast 为模块级单例，须全 app 仅挂载一次
         （原 NotebookHome/ExternalReaderPage 局部挂载收敛至此，双挂载会重复渲染列表） -->
    <ToastContainer />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import WelcomePage from '@/pages/WelcomePage.vue';
import ToastContainer from '@/components/common/Toast.vue';
import { WELCOME_REPLAY_EVENT, hasCompletedWelcome } from '@/utils/welcome';

const route = useRoute();
const welcomeVisible = ref(!hasCompletedWelcome());

function replayWelcome(): void {
  welcomeVisible.value = true;
}

onMounted(() => window.addEventListener(WELCOME_REPLAY_EVENT, replayWelcome));
onUnmounted(() => window.removeEventListener(WELCOME_REPLAY_EVENT, replayWelcome));
</script>
