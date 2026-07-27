import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { remote as webdriverRemote } from 'webdriverio';
import { TauriWebDriverHost } from '../../e2e/tauri/tauri-webdriver-host.mjs';
import { __test as verifierTest } from './verify-installed-app-evidence-v2.mjs';

describe('Tauri WebDriver host evidence lifecycle', () => {
  it('records the remote handshake and only commands bound to the returned session', async () => {
    const events = [];
    const process = fakeDriverProcess();
    const host = createHost(process, async (options) => fakeSession(options, 'session-1'));

    const session = await host.createSession({
      application: 'C:\\Program Files\\JotLuck\\JotLuck.exe',
      args: ['C:\\notes\\one.md'],
      onEvent: (event) => events.push(event),
    });
    await session.getTitle();
    await host.deleteSession(session);

    expect(events.map((event) => event.event)).toEqual([
      'tauri-driver-ready',
      'webdriver-session-handshake-complete',
      'webdriver-command-start',
      'webdriver-command-complete',
      'webdriver-command-start',
      'webdriver-command-complete',
      'webdriver-session-deleted',
    ]);
    const handshake = events[1];
    expect(handshake).toMatchObject({
      sessionId: 'session-1',
      capabilities: { browserName: 'webview2' },
      requested: {
        application: expect.stringMatching(/JotLuck\\JotLuck\.exe$/u),
        args: ['C:\\notes\\one.md'],
      },
    });
    expect(events.slice(2).every((event) => event.attemptId === handshake.attemptId)).toBe(true);
    expect(events[3]).toMatchObject({
      sessionId: 'session-1',
      correlationId: expect.stringContaining(handshake.attemptId),
      commandName: 'getTitle',
      result: 'JotLuck',
      error: null,
    });
    expect(events.some((event) => event.commandName === 'newSession')).toBe(false);
  });

  it('matches interleaved same-name commands inside their own session attempt', async () => {
    const process = fakeDriverProcess();
    const sessions = [];
    const host = createHost(process, async (options) => {
      const session = fakeSession(options, `session-${sessions.length + 1}`);
      sessions.push({ options, session });
      return session;
    });
    const eventsA = [];
    const eventsB = [];
    const [sessionA, sessionB] = await Promise.all([
      host.createSession({
        application: 'C:\\JotLuck.exe',
        onEvent: (event) => eventsA.push(event),
      }),
      host.createSession({
        application: 'C:\\JotLuck.exe',
        onEvent: (event) => eventsB.push(event),
      }),
    ]);

    sessions[0].options.beforeCommand[0]('getTitle', []);
    sessions[1].options.beforeCommand[0]('getTitle', []);
    sessions[1].options.afterCommand[0]('getTitle', [], 'B', null);
    sessions[0].options.afterCommand[0]('getTitle', [], 'A', null);

    const completeA = eventsA.find(
      (event) => event.event === 'webdriver-command-complete' && event.commandName === 'getTitle',
    );
    const completeB = eventsB.find(
      (event) => event.event === 'webdriver-command-complete' && event.commandName === 'getTitle',
    );
    expect(completeA).toMatchObject({ sessionId: 'session-1', result: 'A' });
    expect(completeB).toMatchObject({ sessionId: 'session-2', result: 'B' });
    expect(completeA.correlationId).not.toBe(completeB.correlationId);

    await host.deleteSession(sessionA);
    await host.deleteSession(sessionB);
  });

  it('removes early-exit listeners after every successful session creation', async () => {
    const process = fakeDriverProcess();
    let sequence = 0;
    const host = createHost(process, async (options) =>
      fakeSession(options, `session-${++sequence}`),
    );

    for (let index = 0; index < 25; index += 1) {
      const session = await host.createSession({
        application: 'C:\\JotLuck.exe',
        onEvent: () => {},
      });
      expect(process.listenerCount('error')).toBe(0);
      expect(process.listenerCount('exit')).toBe(0);
      await host.deleteSession(session);
    }
  });

  it('removes early-exit listeners when the driver exits before the handshake', async () => {
    const process = fakeDriverProcess();
    const host = createHost(process, () => new Promise(() => {}));
    const creation = host.createSession({ application: 'C:\\JotLuck.exe', onEvent: () => {} });
    process.exitCode = 7;
    process.emit('exit', 7, null);

    await expect(creation).rejects.toThrow(/exited before session creation/u);
    expect(process.listenerCount('error')).toBe(0);
    expect(process.listenerCount('exit')).toBe(0);
  });

  it('removes early-exit listeners when the remote factory throws synchronously', async () => {
    const process = fakeDriverProcess();
    const host = createHost(process, () => {
      throw new Error('invalid WebdriverIO hook configuration');
    });

    await expect(
      host.createSession({ application: 'C:\\JotLuck.exe', onEvent: () => {} }),
    ).rejects.toThrow(/invalid WebdriverIO hook configuration/u);
    expect(process.listenerCount('error')).toBe(0);
    expect(process.listenerCount('exit')).toBe(0);
  });

  it('does not forget a session whose deletion failed', async () => {
    const events = [];
    const process = fakeDriverProcess();
    const session = {
      sessionId: 'session-failed',
      capabilities: { browserName: 'webview2' },
      async deleteSession() {
        throw new Error('driver refused cleanup');
      },
    };
    const host = createHost(process, async () => session);

    const created = await host.createSession({
      application: 'C:\\Program Files\\JotLuck\\JotLuck.exe',
      onEvent: (event) => events.push(event),
    });
    await expect(host.deleteSession(created)).rejects.toThrow(/driver refused cleanup/u);

    expect(host.sessions.has(session)).toBe(true);
    expect(events.at(-1)).toMatchObject({
      event: 'webdriver-session-delete-failed',
      sessionId: 'session-failed',
    });
  });

  it('matches the real WebdriverIO remote protocol shape without a newSession hook', async () => {
    const requests = [];
    const server = createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      requests.push({ method: request.method, url: request.url, body });
      response.setHeader('content-type', 'application/json');
      if (request.method === 'POST' && request.url === '/session') {
        response.end(
          JSON.stringify({
            value: {
              sessionId: 'real-session',
              capabilities: { browserName: 'webview2', platformName: 'windows' },
            },
          }),
        );
        return;
      }
      if (request.method === 'GET' && request.url === '/session/real-session/title') {
        response.end(JSON.stringify({ value: 'JotLuck real protocol' }));
        return;
      }
      if (request.method === 'GET' && request.url === '/session/real-session/window') {
        response.end(JSON.stringify({ value: 'window-1' }));
        return;
      }
      if (request.method === 'POST' && request.url === '/session/real-session/element') {
        response.end(
          JSON.stringify({
            value: { 'element-6066-11e4-a52e-4f735466cecf': 'element-1' },
          }),
        );
        return;
      }
      if (
        request.method === 'GET' &&
        request.url === '/session/real-session/element/element-1/text'
      ) {
        response.end(JSON.stringify({ value: 'Save' }));
        return;
      }
      if (
        request.method === 'POST' &&
        [
          '/session/real-session/element/element-1/click',
          '/session/real-session/element/element-1/clear',
          '/session/real-session/element/element-1/value',
        ].includes(request.url)
      ) {
        response.end(JSON.stringify({ value: null }));
        return;
      }
      if (request.method === 'POST' && request.url === '/session/real-session/actions') {
        response.end(JSON.stringify({ value: null }));
        return;
      }
      if (request.method === 'DELETE' && request.url === '/session/real-session') {
        response.end(JSON.stringify({ value: null }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ value: { error: 'unknown command', message: request.url } }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    const events = [];
    const process = fakeDriverProcess();
    const host = createHost(process, (options) =>
      webdriverRemote({
        ...options,
        port: address.port,
        connectionRetryCount: 0,
        connectionRetryTimeout: 5_000,
      }),
    );

    try {
      const session = await host.createSession({
        application: 'C:\\Program Files\\JotLuck\\JotLuck.exe',
        args: ['C:\\evidence\\real-protocol.md'],
        onEvent: (event) => events.push(event),
      });
      expect(await session.getTitle()).toBe('JotLuck real protocol');
      const element = await session.$('#save');
      expect(await element.getText()).toBe('Save');
      await element.click();
      await element.setValue('saved');
      await session.keys(['Escape']);
      expect(host.sessionMetadata.get(session).pendingCommands).toEqual([]);
      await host.deleteSession(session);
    } finally {
      server.close();
      await once(server, 'close');
    }

    expect(requests.map((entry) => `${entry.method} ${entry.url}`)).toEqual([
      'POST /session',
      'GET /session/real-session/window',
      'GET /session/real-session/title',
      'POST /session/real-session/element',
      'GET /session/real-session/element/element-1/text',
      'POST /session/real-session/element/element-1/click',
      'POST /session/real-session/element/element-1/clear',
      'POST /session/real-session/element/element-1/value',
      'POST /session/real-session/actions',
      'DELETE /session/real-session',
    ]);
    expect(events.some((event) => event.commandName === 'newSession')).toBe(false);
    expect(events.some((event) => event.event === 'webdriver-session-handshake-complete')).toBe(
      true,
    );
    expect(
      events.some(
        (event) => event.event === 'webdriver-command-complete' && event.commandName === 'getTitle',
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.event === 'webdriver-command-complete' && event.commandName === 'deleteSession',
      ),
    ).toBe(true);
    const completedCommands = events.filter(
      (event) => event.event === 'webdriver-command-complete',
    );
    expect(completedCommands.every((event) => event.correlationId)).toBe(true);
    expect(completedCommands.map((event) => event.commandName)).toEqual(
      expect.arrayContaining([
        'getTitle',
        'findElement',
        'getElementText',
        'elementClick',
        'elementClear',
        'elementSendKeys',
        'performActions',
        'deleteSession',
      ]),
    );
    const execution = { caseId: 'GUI-03-SEARCH-EDIT', adapter: 'gui-search-edit' };
    expect(
      verifierTest.validateWebDriverEvents(
        events.map((event, index) => ({
          schema: 'jotluck.installed-app.webdriver-event.v3',
          sequence: index + 1,
          timestamp: '2026-07-25T00:00:00Z',
          ...execution,
          ...event,
        })),
        execution,
      ),
    ).toMatchObject({
      applicationPaths: ['c:\\program files\\jotluck\\jotluck.exe'],
    });
  });
});

function createHost(process, remoteFactory) {
  return new TauriWebDriverHost({
    platform: 'win32',
    spawnProcess: () => process,
    remoteFactory,
    resolveCommandPath: (value) => value,
    executableIdentityFactory: (value) => ({
      path: value,
      bytes: 128,
      sha256: value.includes('edge') ? 'b'.repeat(64) : 'a'.repeat(64),
    }),
    driverCommand: 'C:\\tools\\tauri-driver.exe',
    nativeDriverPath: 'C:\\tools\\msedgedriver.exe',
  });
}

function fakeSession(options, sessionId) {
  return {
    sessionId,
    capabilities: { browserName: 'webview2' },
    async getTitle() {
      options.beforeCommand[0]('getTitle', []);
      options.afterCommand[0]('getTitle', [], 'JotLuck', null);
      return 'JotLuck';
    },
    async deleteSession() {
      options.beforeCommand[0]('deleteSession', []);
      options.afterCommand[0]('deleteSession', [], null, null);
    },
  };
}

function fakeDriverProcess() {
  const process = new EventEmitter();
  process.pid = 1234;
  process.exitCode = null;
  process.stdout = new EventEmitter();
  process.stderr = new EventEmitter();
  process.kill = () => {
    process.exitCode = 0;
    process.emit('exit', 0, null);
    return true;
  };
  return process;
}
