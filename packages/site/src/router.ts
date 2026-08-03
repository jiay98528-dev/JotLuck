import type { RouteRecordRaw } from 'vue-router';
import HomePage from './pages/HomePage.vue';
import InfoPage from './pages/InfoPage.vue';
import type { SiteRouteId } from './types';

const routeTable: Array<{ id: SiteRouteId; path: string }> = [
  { id: 'home', path: '/' },
  { id: 'product', path: '/product/' },
  { id: 'download', path: '/download/' },
  { id: 'themes', path: '/themes/' },
  { id: 'support', path: '/support/' },
  { id: 'services', path: '/services/' },
  { id: 'studio', path: '/studio/' },
  { id: 'privacy', path: '/privacy/' },
];

export const routes: RouteRecordRaw[] = routeTable.map(({ id, path }) => ({
  path,
  name: id,
  component: id === 'home' ? HomePage : InfoPage,
  meta: { routeId: id },
}));

export const routePaths = Object.fromEntries(
  routeTable.map(({ id, path }) => [id, path]),
) as Record<SiteRouteId, string>;
