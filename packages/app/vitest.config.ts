import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
      coverage: {
        provider: 'v8',
        reportsDirectory: '../../coverage/app',
        include: ['src/**/*.{ts,vue}'],
        exclude: [
          'src/**/*.d.ts',
          'src/**/*.test.ts',
          'src/**/*.spec.ts',
          'src-tauri/**',
          'playwright.config.ts',
          'vite.config.ts',
          'vitest.config.ts',
        ],
      },
    },
  }),
);
