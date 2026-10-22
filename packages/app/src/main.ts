import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { initializeLocale, installI18n } from './i18n';
import { installDesktopContextMenuGuard } from './utils/contextMenuGuard';
import { initializePlatform } from './utils/platform';
import { useToast } from '@/components/common/Toast.vue';
import './assets/styles/main.css';

performance.mark('jotluck:bootstrap-start');

// ── 全局异常兜底（工单 B 鲁棒核心） ──
// 双通道：渲染错误（app.config.errorHandler）→ error 级 toast；unhandled rejection →
// warning 级 toast。console.error 全量保留；按 message 去重防刷屏；toast 文案取技术
// 信息（error.message 截断 ~200 字符），不新增 i18n 键（locales 归属 W2/G 工单）。
const GLOBAL_ERROR_TOAST_MESSAGE_LIMIT = 200;
const reportedGlobalErrorMessages = new Set<string>();

function globalErrorToastText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > GLOBAL_ERROR_TOAST_MESSAGE_LIMIT
    ? `${message.slice(0, GLOBAL_ERROR_TOAST_MESSAGE_LIMIT)}…`
    : message;
}

function reportGlobalError(error: unknown, type: 'error' | 'warning'): void {
  const message = globalErrorToastText(error);
  if (reportedGlobalErrorMessages.has(message)) return; // 同 message 去重防刷屏
  reportedGlobalErrorMessages.add(message);
  // error 级常驻待手动关闭；warning 级 3s 自动消失（对齐 Toast API 默认档）
  useToast().show(message, type, type === 'error' ? 0 : 3000);
}

// 注册先于 bootstrap await：初始化阶段的 promise 泄漏同样纳入兜底
window.addEventListener('unhandledrejection', (event) => {
  // eslint-disable-next-line no-console
  console.error('[global] unhandled rejection:', event.reason);
  reportGlobalError(event.reason, 'warning');
});

await initializePlatform();
await initializeLocale();
installDesktopContextMenuGuard();
const app = createApp(App);
app.use(createPinia());
app.use(router);
installI18n(app);
// 自定义 errorHandler 会接管 Vue 默认控制台输出，须在此显式重放（console 全量保留）
app.config.errorHandler = (error, _instance, info) => {
  // eslint-disable-next-line no-console
  console.error(`[global] vue error (${info}):`, error);
  reportGlobalError(error, 'error');
};
app.mount('#app');
