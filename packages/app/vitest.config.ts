import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.ts', 'src/**/*.spec.ts', '../../scripts/**/*.test.ts'],
      // Official themes inject CSS strings through ThemeRegistry. Keep the Halo
      // asset real in Vitest so fallback and accessibility contracts are tested.
      css: {
        include: [/halo-canvas\.css(?:\?.*)?$/],
      },
      coverage: {
        provider: 'v8',
        reportsDirectory: '../../coverage/app',
        include: [
          'src/services/MarkdownPredictor.ts',
          'src/services/SearchEngine.ts',
          'src/services/ThemeCommerceProvider.ts',
          'src/services/ThemeRegistry.ts',
          'src/utils/draft-file-name.ts',
          'src/utils/markdown-formatting.ts',
          'src/utils/ngram-engine.ts',
          'src/utils/note-files.ts',
        ],
        exclude: [
          'src/**/*.d.ts',
          'src/**/*.test.ts',
          'src/**/*.spec.ts',
          'src-tauri/**',
          'playwright.config.ts',
          'vite.config.ts',
          'vitest.config.ts',
        ],
        thresholds: {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
      },
    },
  }),
);
