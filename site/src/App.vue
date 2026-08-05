<script setup lang="ts">
import { useRoute } from 'vue-router';
import SiteHeader from './components/SiteHeader.vue';
import SiteFooter from './components/SiteFooter.vue';

const route = useRoute();
</script>

<template>
  <SiteHeader v-if="route.name !== 'gate'" />
  <main>
    <RouterView />
  </main>
  <SiteFooter v-if="route.name !== 'gate'" />
</template>
