import { ViteSSG } from 'vite-ssg';
import App from './App.vue';
import { routes } from './router';
import { LOCALE_TAGS, type Locale } from './content';
import './styles/site.css';

// unhead 由 vite-ssg 自动安装（SSR=server head、浏览器=client head），序列化的正是它创建的实例；
// 切勿手动 app.use(createHead())——第二个 head 会接管组件 injectHead，SSG 注入将永远为空。
export const createApp = ViteSSG(App, { routes, base: '/' }, ({ router, isClient }) => {
  if (isClient) {
    // 弱网适配：展示字体就位（或 600ms 兜底）后才放行 hero 入场动画，
    // 避免字体交换导致的入场中途错位（FOUT）；无 JS 时内容始终静态可见。
    const fontSettled =
      'fonts' in document
        ? Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 600))])
        : Promise.resolve();
    void fontSettled.then(() => document.documentElement.classList.add('fonts-ready'));

    router.afterEach((to) => {
      const locale = to.meta.locale as Locale | undefined;
      if (locale) {
        document.documentElement.lang = LOCALE_TAGS[locale];
        document.documentElement.dataset.locale = locale;
      }
    });
  }
});
