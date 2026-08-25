import { ViteSSG } from 'vite-ssg';
import App from './App.vue';
import { routes } from './router';
import { LOCALE_TAGS, type Locale } from './content';
import './styles/site.css';

const HERO_FONT_FAMILIES: Record<string, { display: string; body: string }> = {
  'zh-CN': { display: 'JL Display ZH', body: 'JL Body ZH' },
  en: { display: 'JL Display EN', body: 'JL Body EN' },
  fr: { display: 'JL Display FR', body: 'JL Body FR' },
  ja: { display: 'JL Display JA', body: 'JL Body JA' },
  ko: { display: 'JL Display KO', body: 'JL Body KO' },
};

function settleHeroFonts(): Promise<unknown> {
  if (!('fonts' in document)) return Promise.resolve();
  const families = HERO_FONT_FAMILIES[document.documentElement.lang] ?? HERO_FONT_FAMILIES.en!;
  const critical = Promise.all([
    document.fonts.load(`400 1em "${families.display}"`),
    document.fonts.load(`400 1em "${families.body}"`),
    document.fonts.load(`700 1em "${families.body}"`),
    document.fonts.load('400 1em "JL Mono"'),
  ]).catch(() => undefined);
  return Promise.race([critical, new Promise((resolve) => setTimeout(resolve, 600))]);
}

// unhead 由 vite-ssg 自动安装（SSR=server head、浏览器=client head），序列化的正是它创建的实例；
// 切勿手动 app.use(createHead())——第二个 head 会接管组件 injectHead，SSG 注入将永远为空。
export const createApp = ViteSSG(
  App,
  {
    routes,
    base: '/',
    // 站内导航一律回顶部；仅浏览器前进/后退（savedPosition）恢复原滚动位
    scrollBehavior: (_to, _from, savedPosition) => savedPosition ?? { top: 0 },
  },
  ({ router, isClient }) => {
    if (isClient) {
      // 弱网适配：展示字体就位（或 600ms 兜底）后才放行 hero 入场动画，
      // 避免字体交换导致的入场中途错位（FOUT）；无 JS 时内容始终静态可见。
      void settleHeroFonts().then(() => document.documentElement.classList.add('fonts-ready'));

      router.afterEach((to) => {
        const locale = to.meta.locale as Locale | undefined;
        if (locale) {
          document.documentElement.lang = LOCALE_TAGS[locale];
          document.documentElement.dataset.locale = locale;
        }
      });
    }
  },
);
