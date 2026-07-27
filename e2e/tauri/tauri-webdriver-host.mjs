import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path, { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { remote } from 'webdriverio';
import { WEBDRIVER_PROTOCOL_COMMANDS } from '../../scripts/release/installed-app-webdriver-protocol.mjs';

export class TauriWebDriverHost {
  constructor({
    driverCommand,
    nativeDriverPath,
    logLevel = 'error',
    platform = process.platform,
    remoteFactory = remote,
    spawnProcess = spawn,
    resolveCommandPath = resolveExecutableCommand,
    executableIdentityFactory = executableIdentity,
  } = {}) {
    this.driverCommand =
      driverCommand ??
      process.env.JOTLUCK_TAURI_DRIVER ??
      (platform === 'win32' ? 'tauri-driver.exe' : 'tauri-driver');
    this.nativeDriverPath = nativeDriverPath ?? process.env.JOTLUCK_EDGE_DRIVER;
    this.logLevel = logLevel;
    this.platform = platform;
    this.remoteFactory = remoteFactory;
    this.spawnProcess = spawnProcess;
    this.resolveCommandPath = resolveCommandPath;
    this.executableIdentityFactory = executableIdentityFactory;
    this.driverProcess = null;
    this.driverIdentity = null;
    this.nativeDriverIdentity = null;
    this.sessions = new Set();
    this.sessionMetadata = new Map();
    this.observers = new Set();
    this.pendingDriverOutput = [];
    this.stopping = false;
    this.commandSequence = 0;
  }

  start() {
    if (this.driverProcess && this.driverProcess.exitCode === null) return;
    if (this.platform !== 'win32') {
      throw new Error('Tauri WebDriver execution requires Windows/WebView2');
    }
    const driverPath = this.resolveCommandPath(this.driverCommand, this.platform);
    const nativeDriverPath = this.nativeDriverPath
      ? this.resolveCommandPath(this.nativeDriverPath, this.platform)
      : null;
    this.driverIdentity = this.executableIdentityFactory(driverPath);
    this.nativeDriverIdentity = nativeDriverPath
      ? this.executableIdentityFactory(nativeDriverPath)
      : null;
    const args = nativeDriverPath ? ['--native-driver', nativeDriverPath] : [];
    this.stopping = false;
    this.driverProcess = this.spawnProcess(driverPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.pendingDriverOutput = [];
    this.driverProcess.stdout?.on('data', (chunk) =>
      this.captureDriverOutput({ stream: 'stdout', value: String(chunk) }),
    );
    this.driverProcess.stderr?.on('data', (chunk) =>
      this.captureDriverOutput({ stream: 'stderr', value: String(chunk) }),
    );
  }

  async createSession({ application, args = [], onEvent } = {}) {
    if (typeof onEvent !== 'function') {
      throw new Error('a WebDriver observation sink is required');
    }
    if (typeof application !== 'string' || application.length === 0) {
      throw new Error('an installed application path is required');
    }
    const attemptId = randomUUID();
    const requestedApplication = resolve(application);
    const requestedArgs = args.map(String);
    const pendingCommands = [];
    const registration = { attemptId, onEvent };
    let observedSessionId = null;
    try {
      this.start();
      const driverProcess = this.driverProcess;
      onEvent({
        event: 'tauri-driver-ready',
        attemptId,
        processId: driverProcess.pid,
        driver: this.driverIdentity,
        nativeDriver: this.nativeDriverIdentity,
      });
      this.observers.add(registration);
      for (const details of this.pendingDriverOutput.splice(0)) {
        onEvent({ event: 'tauri-driver-output', attemptId, ...details });
      }

      let rejectEarlyExit;
      const earlyExit = new Promise((_, reject) => {
        rejectEarlyExit = reject;
      });
      const onDriverError = (error) => rejectEarlyExit(error);
      const onDriverExit = (code, signal) => {
        if (!this.stopping) {
          rejectEarlyExit(
            new Error(`tauri-driver exited before session creation: code=${code} signal=${signal}`),
          );
        }
      };
      driverProcess.once('error', onDriverError);
      driverProcess.once('exit', onDriverExit);

      let session;
      try {
        const connection = this.remoteFactory({
          hostname: '127.0.0.1',
          port: 4444,
          logLevel: this.logLevel,
          connectionRetryTimeout: 120_000,
          connectionRetryCount: 20,
          beforeCommand: [
            (commandName, commandArgs) => {
              // WebdriverIO completes Driver.newSession before it installs these command hooks.
              // Only commands bound to the returned session are admissible case observations.
              if (!observedSessionId) return;
              if (!WEBDRIVER_PROTOCOL_COMMANDS.has(commandName)) return;
              // WebdriverIO applies this hook at browser and element wrapper layers. Collapse
              // nested duplicate starts for one logical command into one observation pair.
              if (pendingCommands.some((pending) => pending.commandName === commandName)) return;
              const correlationId = `${attemptId}:wd-${++this.commandSequence}`;
              pendingCommands.push({ correlationId, commandName });
              onEvent({
                event: 'webdriver-command-start',
                attemptId,
                sessionId: observedSessionId,
                correlationId,
                commandName,
                args: commandArgs,
              });
            },
          ],
          afterCommand: [
            (commandName, commandArgs, result, error) => {
              if (!observedSessionId) return;
              if (!WEBDRIVER_PROTOCOL_COMMANDS.has(commandName)) return;
              let pendingIndex = -1;
              for (let index = pendingCommands.length - 1; index >= 0; index -= 1) {
                if (pendingCommands[index].commandName === commandName) {
                  pendingIndex = index;
                  break;
                }
              }
              const pending = pendingIndex >= 0 ? pendingCommands.splice(pendingIndex, 1)[0] : null;
              if (!pending) return;
              onEvent({
                event: 'webdriver-command-complete',
                attemptId,
                sessionId: observedSessionId,
                correlationId: pending?.correlationId ?? null,
                commandName,
                args: commandArgs,
                result: result === undefined ? null : result,
                error: error
                  ? { name: error.name, message: error.message, stack: error.stack ?? null }
                  : null,
              });
            },
          ],
          capabilities: {
            'tauri:options': {
              application: requestedApplication,
              ...(requestedArgs.length > 0 ? { args: requestedArgs } : {}),
            },
          },
        });
        session = await Promise.race([connection, earlyExit]);
      } finally {
        driverProcess.removeListener('error', onDriverError);
        driverProcess.removeListener('exit', onDriverExit);
      }
      if (!session || typeof session.sessionId !== 'string' || session.sessionId.length === 0) {
        throw new Error('WebDriver remote handshake returned no session identity');
      }
      observedSessionId = session.sessionId;
      this.sessions.add(session);
      this.sessionMetadata.set(session, {
        attemptId,
        onEvent,
        pendingCommands,
        registration,
      });
      onEvent({
        event: 'webdriver-session-handshake-complete',
        attemptId,
        sessionId: observedSessionId,
        capabilities: session.capabilities ?? null,
        requested: { application: requestedApplication, args: requestedArgs },
      });
      return session;
    } catch (error) {
      this.observers.delete(registration);
      throw error;
    }
  }

  async deleteSession(session) {
    if (!session) return;
    const metadata = this.sessionMetadata.get(session);
    const sessionId = session.sessionId;
    let deletedByDriver = false;
    try {
      await session.deleteSession();
      deletedByDriver = true;
      if (metadata?.pendingCommands.length) {
        throw new Error('WebDriver session closed with incomplete command observations');
      }
      metadata?.onEvent({
        event: 'webdriver-session-deleted',
        attemptId: metadata.attemptId,
        sessionId,
      });
      this.sessions.delete(session);
      this.sessionMetadata.delete(session);
      if (metadata) this.observers.delete(metadata.registration);
    } catch (error) {
      if (deletedByDriver) {
        this.sessions.delete(session);
        this.sessionMetadata.delete(session);
        if (metadata) this.observers.delete(metadata.registration);
      }
      metadata?.onEvent({
        event: 'webdriver-session-delete-failed',
        attemptId: metadata.attemptId,
        sessionId,
        error: { name: error.name, message: error.message },
      });
      throw error;
    }
  }

  async dispose() {
    const errors = [];
    for (const session of [...this.sessions]) {
      try {
        await this.deleteSession(session);
      } catch (error) {
        errors.push(error);
      }
    }
    const driverProcess = this.driverProcess;
    if (driverProcess && driverProcess.exitCode === null) {
      this.stopping = true;
      driverProcess.kill();
      for (let attempt = 0; attempt < 20 && driverProcess.exitCode === null; attempt += 1) {
        await delay(50);
      }
      if (driverProcess.exitCode === null) driverProcess.kill('SIGKILL');
    }
    this.driverProcess = null;
    this.driverIdentity = null;
    this.nativeDriverIdentity = null;
    this.observers.clear();
    this.pendingDriverOutput = [];
    if (errors.length > 0) {
      throw new AggregateError(errors, 'one or more WebDriver sessions could not be deleted');
    }
  }

  emitToObservers(event, details) {
    for (const observer of this.observers) {
      observer.onEvent({ event, attemptId: observer.attemptId, ...details });
    }
  }

  captureDriverOutput(details) {
    if (this.observers.size === 0) {
      this.pendingDriverOutput.push(details);
      return;
    }
    this.emitToObservers('tauri-driver-output', details);
  }
}

function resolveExecutableCommand(command, platform = process.platform) {
  const requested = String(command ?? '');
  if (!requested) throw new Error('WebDriver executable command is missing');
  if (path.isAbsolute(requested)) return realpathSync(requested);
  if (platform !== 'win32') return realpathSync(requested);
  const resolved = execFileSync('where.exe', [requested], {
    encoding: 'utf8',
    windowsHide: true,
  })
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .find(Boolean);
  if (!resolved) throw new Error(`WebDriver executable was not found: ${requested}`);
  return realpathSync(resolved);
}

function executableIdentity(filePath) {
  const requested = path.resolve(filePath);
  const requestedInfo = lstatSync(requested);
  if (requestedInfo.isSymbolicLink() || !requestedInfo.isFile() || requestedInfo.size <= 0) {
    throw new Error(`WebDriver executable is not a non-empty regular file: ${filePath}`);
  }
  const canonicalPath = realpathSync(requested);
  const content = readFileSync(canonicalPath);
  return {
    path: canonicalPath,
    bytes: content.byteLength,
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}

export function createTauriDriverHost(options) {
  return new TauriWebDriverHost(options);
}
