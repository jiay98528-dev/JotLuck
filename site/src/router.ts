import type { RouteRecordRaw } from 'vue-router';
import HomePage from './pages/HomePage.vue';
import DownloadPage from './pages/DownloadPage.vue';
import ThemesPage from './pages/ThemesPage.vue';
import StudioPage from './pages/StudioPage.vue';
import PrivacyPage from './pages/PrivacyPage.vue';
import LocaleGate from './pages/LocaleGate.vue';
import { LOCALES, type Locale } from './content';

export type SitePage = 'home' | 'download' | 'themes' | 'studio' | 'privacy';

const pages = [
  { segment: '', name: 'home', component: HomePage },
  { segment: 'download', name: 'download', component: DownloadPage },
  { segment: 'themes', name: 'themes', component: ThemesPage },
  { segment: 'studio', name: 'studio', component: StudioPage },
  { segment: 'privacy', name: 'privacy', component: PrivacyPage },
] as const;

/** 语言感知的站内路径。 */
export function pagePath(locale: Locale, page: SitePage): string {
  return page === 'home' ? `/${locale}/` : `/${locale}/${page}`;
}

export const routes: RouteRecordRaw[] = [
  // `/` 语言门页：客户端按 navigator.language 重定向，静态态给出五语入口
  { path: '/', name: 'gate', component: LocaleGate },
  ...LOCALES.flatMap((locale): RouteRecordRaw[] =>
    pages.map((p) => ({
      path: `/${locale}${p.segment ? `/${p.segment}` : ''}`,
      name: `${locale}-${p.name}`,
      component: p.component,
      meta: { locale, page: p.name as SitePage },
    })),
  ),
  { path: '/:pathMatch(.*)*', redirect: '/' },
];
