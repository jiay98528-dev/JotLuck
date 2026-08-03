import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const locale = process.env.SITE_LOCALE ?? 'zh-hans';

export default defineConfig({
  plugins: [vue()],
  define: {
    __SITE_LOCALE__: JSON.stringify(locale),
  },
  build: {
    outDir: `dist/${locale}`,
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 4178,
  },
});
