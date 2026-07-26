import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { remote } from 'webdriverio';

export class TauriWebDriverHost {
  constructor({ driverCommand, nativeDriverPath, logLevel = 'error' } = {}) {
    this.driverCommand =
      driverCommand ??
      process.env.JOTLUCK_TAURI_DRIVER ??
      (process.platform === 'win32' ? 'tauri-driver.exe' : 'tauri-driver');
    this.nativeDriverPath = nativeDriverPath ?? process.env.JOTLUCK_EDGE_DRIVER;
    this.logLevel = logLevel;
    this.driverProcess = null;
    this.sessions = new Set();
    this.stopping = false;
  }

  start() {
    if (process.platform !== 'win32') {
      throw new Error('Tauri WebDriver execution requires Windows/WebView2');
    }
    if (this.driverProcess && this.driverProcess.exitCode === null) return;
    const args = this.nativeDriverPath ? ['--native-driver', resolve(this.nativeDriverPath)] : [];
    this.stopping = false;
    this.driverProcess = spawn(this.driverCommand, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  }

  async createSession({ application, args = [] }) {
    this.start();
    const driverProcess = this.driverProcess;
    const earlyExit = new Promise((_, reject) => {
      driverProcess.once('error', reject);
      driverProcess.once('exit', (code, signal) => {
        if (!this.stopping) {
          reject(
            new Error(`tauri-driver exited before session creation: code=${code} signal=${signal}`),
          );
        }
      });
    });
    const connection = remote({
      hostname: '127.0.0.1',
      port: 4444,
      logLevel: this.logLevel,
      connectionRetryTimeout: 120_000,
      connectionRetryCount: 20,
      capabilities: {
        'tauri:options': {
          application: resolve(application),
          ...(args.length > 0 ? { args: args.map(String) } : {}),
        },
      },
    });
    const session = await Promise.race([connection, earlyExit]);
    this.sessions.add(session);
    return session;
  }

  async deleteSession(session) {
    if (!session) return;
    this.sessions.delete(session);
    await session.deleteSession().catch(() => undefined);
  }

  async dispose() {
    const sessions = [...this.sessions];
    this.sessions.clear();
    await Promise.all(sessions.map((session) => session.deleteSession().catch(() => undefined)));
    const driverProcess = this.driverProcess;
    if (!driverProcess || driverProcess.exitCode !== null) return;
    this.stopping = true;
    driverProcess.kill();
    for (let attempt = 0; attempt < 20 && driverProcess.exitCode === null; attempt += 1) {
      await delay(50);
    }
    if (driverProcess.exitCode === null) driverProcess.kill('SIGKILL');
  }
}

export function createTauriDriverHost(options) {
  return new TauriWebDriverHost(options);
}
