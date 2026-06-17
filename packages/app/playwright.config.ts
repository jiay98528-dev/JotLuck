import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '../../e2e/tests',
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { outputFolder: '../../e2e/report' }], ['list']],

  use: {
    baseURL: 'http://localhost:5177',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'pnpm --filter @markluck/app dev',
    url: 'http://localhost:5177',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
