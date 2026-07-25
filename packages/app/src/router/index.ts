import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'bootstrap', component: () => import('../pages/BootstrapPage.vue') },
    {
      path: '/reader',
      name: 'external-reader',
      component: () => import('../pages/ExternalReaderPage.vue'),
    },
    { path: '/workspace', name: 'workspace', component: () => import('../pages/NotebookHome.vue') },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('../pages/BootstrapPage.vue'),
    },
  ],
});
