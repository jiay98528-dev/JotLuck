import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['../../scripts/**/*.test.{ts,mjs}'],
      maxWorkers: 1,
      minWorkers: 1,
      fileParallelism: false,
    },
  }),
);
