import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['../../scripts/release/verify-installed-app-evidence-v2.test.mjs'],
      maxWorkers: 1,
      minWorkers: 1,
      fileParallelism: false,
      env: { JOTLUCK_INSTALLED_EVIDENCE_TEST_SHARD: '2' },
    },
  }),
);
