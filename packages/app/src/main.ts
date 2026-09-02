import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { initializeLocale, installI18n } from './i18n';
import { installDesktopContextMenuGuard } from './utils/contextMenuGuard';
import './assets/styles/main.css';

performance.mark('jotluck:bootstrap-start');
await initializeLocale();
installDesktopContextMenuGuard();
const app = createApp(App);
app.use(createPinia());
app.use(router);
installI18n(app);
app.mount('#app');
