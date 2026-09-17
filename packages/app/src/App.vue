<template>
  <div id="jotluck-app">
    <router-view />
    <WelcomePage :visible="welcomeVisible" :mode="welcomeMode" @complete="welcomeVisible = false" />
    <UpdateNotification
      :visible="notificationVisible"
      :latest-version="updates.latestVersion.value"
      :release-url="updates.releaseUrl.value"
      :release-notes="notificationNotes"
      :unverified="updates.state.value.status === 'unverified'"
      :source="updates.state.value.candidate?.source"
      :download-url="
        updates.state.value.status === 'available'
          ? updates.state.value.candidate?.downloadUrl
          : null
      "
      @update:visible="notificationVisible = $event"
      @dismiss-version="updates.dismissVersion"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import WelcomePage from '@/pages/WelcomePage.vue';
import { WELCOME_REPLAY_EVENT } from '@/utils/welcome';
import UpdateNotification from '@/components/overlays/UpdateNotification.vue';
import { useVersionCheck } from '@/composables/useVersionCheck';
import { useI18n } from 'vue-i18n';

const route = useRoute();
const updates = useVersionCheck();
const { t } = useI18n();
const welcomeVisible = ref(false);
const welcomeMode = ref<'new' | 'upgrade'>('new');
const notificationVisible = ref(false);
const notificationNotes = computed(() =>
  updates.state.value.status === 'unverified'
    ? `${t('updateService.unverified')} ${updates.releaseNotes.value}`
    : updates.releaseNotes.value,
);
let claiming = false;
let reconcileAgain = false;
let replayAgain = false;
let unmounted = false;

async function reconcile(replay = false) {
  if (unmounted || !['workspace', 'external-reader'].includes(String(route.name))) return;
  if (claiming) {
    reconcileAgain = true;
    replayAgain ||= replay;
    return;
  }
  claiming = true;
  try {
    if (!welcomeVisible.value) {
      const claim = await updates.claimWelcome(replay);
      if (unmounted) {
        if (claim.show) await updates.releaseWelcome();
        return;
      }
      if (claim.show) {
        welcomeMode.value = claim.mode;
        welcomeVisible.value = true;
        notificationVisible.value = false;
      }
    }
    if (
      !welcomeVisible.value &&
      !notificationVisible.value &&
      document.hasFocus() &&
      updates.autoCheck.value &&
      updates.hasUpdate.value
    ) {
      notificationVisible.value = await updates.claimNotification();
    }
  } catch {
    /* Localized service error is exposed in settings. */
  } finally {
    claiming = false;
    if (reconcileAgain && !unmounted) {
      const replay = replayAgain;
      reconcileAgain = false;
      replayAgain = false;
      void reconcile(replay);
    }
  }
}

function replayWelcome(): void {
  void reconcile(true);
}
function onFocus() {
  void reconcile();
}
watch([() => route.name, () => updates.state.value.revision, welcomeVisible], () => {
  if (!updates.hasUpdate.value || !updates.autoCheck.value) notificationVisible.value = false;
  void reconcile();
});
onMounted(() => {
  window.addEventListener(WELCOME_REPLAY_EVENT, replayWelcome);
  window.addEventListener('focus', onFocus);
  void reconcile();
});
onUnmounted(() => {
  unmounted = true;
  window.removeEventListener(WELCOME_REPLAY_EVENT, replayWelcome);
  window.removeEventListener('focus', onFocus);
  if (welcomeVisible.value) void updates.releaseWelcome().catch(() => {});
});
</script>
