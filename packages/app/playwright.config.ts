import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.MARKLUCK_E2E_BASE_URL ?? 'http://localhost:5173';
const parsedBaseURL = new URL(baseURL);
const previewHost = parsedBaseURL.hostname === 'localhost' ? '127.0.0.1' : parsedBaseURL.hostname;
const previewPort = parsedBaseURL.port || (parsedBaseURL.protocol === 'https:' ? '443' : '80');
const webServerCommand = [
  'pnpm --filter @markluck/app build:e2e',
  `pnpm --filter @markluck/app preview --host ${previewHost} --port ${previewPort}`,
].join(' && ');

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
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  webServer: {
    command: webServerCommand,
    url: baseURL,
    reuseExistingServer: process.env.MARKLUCK_E2E_REUSE === '1',
    timeout: 60000,
  },
});
