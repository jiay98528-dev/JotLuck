import { beforeEach } from 'vitest';
import { config } from '@vue/test-utils';
import { getI18nPlugin, setLocale } from '@/i18n';

config.global.plugins = [getI18nPlugin()];

beforeEach(async () => {
  await setLocale('zh-CN', { persist: false });
});
