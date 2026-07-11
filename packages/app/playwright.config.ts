import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.JOTLUCK_E2E_BASE_URL ?? 'http://localhost:5173';
const parsedBaseURL = new URL(baseURL);
const previewHost = parsedBaseURL.hostname === 'localhost' ? '127.0.0.1' : parsedBaseURL.hostname;
const previewPort = parsedBaseURL.port || (parsedBaseURL.protocol === 'https:' ? '443' : '80');
const autocompleteRcEnabled =
  process.env.JOTLUCK_AUTOCOMPLETE_RC === '1' ||
  process.argv.some((argument) => /2[4-6]-autocomplete/u.test(argument));
const webServerCommand = [
  'pnpm --filter @jotluck/app build:e2e',
  `pnpm --filter @jotluck/app preview --host ${previewHost} --port ${previewPort}`,
].join(' && ');

export default defineConfig({
  testDir: '../../e2e/tests',
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  ...(autocompleteRcEnabled ? {} : { grepInvert: /@autocomplete-rc/u }),
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
    reuseExistingServer: process.env.JotLuck_E2E_REUSE === '1',
    timeout: 60000,
  },
});
