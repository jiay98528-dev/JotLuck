import { resolve } from 'node:path';

const appBinaryPath = resolve(
  process.env.JOTLUCK_TAURI_BINARY ?? 'packages/app/src-tauri/target/release/jotluck.exe',
);

/** @type {import('@wdio/types').Options.Testrunner} */
export const config = {
  runner: 'local',
  specs: ['./e2e/tauri/tauri-webview-smoke.spec.mjs'],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'tauri',
      'tauri:options': {
        application: appBinaryPath,
      },
    },
  ],
  services: [
    [
      '@wdio/tauri-service',
      {
        appBinaryPath,
        driverProvider: 'external',
        autoInstallTauriDriver: true,
        autoDownloadEdgeDriver: true,
        captureBackendLogs: false,
        captureFrontendLogs: false,
        startTimeout: 90_000,
        commandTimeout: 30_000,
      },
    ],
  ],
  logLevel: 'info',
  bail: 1,
  waitforTimeout: 15_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 120_000,
  },
};
