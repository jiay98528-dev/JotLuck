export const APP_NAME = 'JotLuck';

export const APP_VERSION = __APP_VERSION__;
export const APP_VERSION_LABEL = `v${APP_VERSION}`;

export const APP_REPOSITORY_URL =
  import.meta.env.VITE_JOTLUCK_REPOSITORY_URL || 'https://github.com/jiay98528-dev/MarkLuck';

export const APP_ISSUES_URL = `${APP_REPOSITORY_URL}/issues`;
export const APP_LICENSE_URL = `${APP_REPOSITORY_URL}/blob/main/LICENSE`;
export const APP_RELEASES_URL = `${APP_REPOSITORY_URL}/releases`;

export const APP_RELEASES_API_URL =
  import.meta.env.VITE_JOTLUCK_RELEASES_API_URL ||
  'https://api.github.com/repos/jiay98528-dev/MarkLuck/releases/latest';
