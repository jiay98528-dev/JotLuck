import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.JOTLUCK_E2E_BASE_URL ?? 'http://127.0.0.1:5173';
const parsedBaseURL = new URL(baseURL);
const previewHost = parsedBaseURL.hostname;
const previewPort = parsedBaseURL.port || (parsedBaseURL.protocol === 'https:' ? '443' : '80');
const packageManager = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const autocompleteRcEnabled =
  process.env.JOTLUCK_AUTOCOMPLETE_RC === '1' ||
  process.argv.some((argument) => /2[4-8]-autocomplete/u.test(argument));
const useFrozenV2REvaluationBundle = process.env.JOTLUCK_AUTOCOMPLETE_V2R_EVALUATION_BUNDLE === '1';
const previewCommand = `${packageManager} --filter @jotluck/app preview --host ${previewHost} --port ${previewPort}`;
const webServerCommand = useFrozenV2REvaluationBundle
  ? previewCommand
  : [`${packageManager} --filter @jotluck/app build:e2e`, previewCommand].join(' && ');

export default defineConfig({
  testDir: '../../e2e/tests',
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // CI runner 资源抖动会让时序敏感用例（性能门/质量探针）以 1-2% 概率
  // 轮替失败；CI 上开 2 次重试吸收抖动，本地保持 0 不掩盖问题。
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  ...(autocompleteRcEnabled
    ? {}
    : {
        grepInvert: /@autocomplete-rc/u,
        testIgnore: /2[4-8]-autocomplete-.*\.spec\.ts/u,
      }),
  reporter: [['html', { outputFolder: '../../e2e/report' }], ['list']],

  use: {
    baseURL,
    trace: 'retain-on-failure',
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
    reuseExistingServer:
      process.env.JOTLUCK_E2E_REUSE === '1' || process.env.JotLuck_E2E_REUSE === '1',
    timeout: 60000,
  },
});
