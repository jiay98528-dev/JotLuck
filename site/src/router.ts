import type { RouteRecordRaw } from 'vue-router';
import HomePage from './pages/HomePage.vue';
import LocaleGate from './pages/LocaleGate.vue';
import { LOCALES, type Locale } from './content';

export type SitePage = 'home' | 'download' | 'themes' | 'studio' | 'privacy';

const pages = [
  { segment: '', name: 'home', component: HomePage },
  { segment: 'download', name: 'download', component: () => import('./pages/DownloadPage.vue') },
  { segment: 'themes', name: 'themes', component: () => import('./pages/ThemesPage.vue') },
  { segment: 'studio', name: 'studio', component: () => import('./pages/StudioPage.vue') },
  { segment: 'privacy', name: 'privacy', component: () => import('./pages/PrivacyPage.vue') },
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
  // 未知路径：就地复用门页渲染五语入口，保留原 URL（真实 404 语义，避免软 404 改址）。
  // 是否自动分发由 LocaleGate 按 route.name 判定：仅真门页 'gate' 分发。
  { path: '/:pathMatch(.*)*', name: 'not-found', component: LocaleGate },
];
